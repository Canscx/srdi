<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type {
  CatalogResponse,
  EvidenceDoc,
  FieldCandidate,
  FieldEntry,
  FilePages,
  JobProgressEvent,
  PageDoc,
  ProjectMeta
} from '@srdi/shared'
import { ElMessage } from 'element-plus'
import { api, errorText, fileLabel } from '@/api'
import { useAiSettings } from '@/composables/useAiSettings'
import { DOC_TYPE_TEXT, formatFieldValue, SKIP_TEXT, STATUS_TEXT, STATUS_TYPE } from '@/format'
import { goto, useRoute } from '@/router'
import type { FieldRow, FilterKey } from '@/types'
import CandidateCard from '@/components/CandidateCard.vue'
import EvidenceFieldRow from '@/components/EvidenceFieldRow.vue'
import SourceViewer from '@/components/SourceViewer.vue'

const route = useRoute()
const projectId = computed(() => route.value.projectId ?? '')

const project = ref<ProjectMeta | null>(null)
const evidence = ref<EvidenceDoc | null>(null)
const catalog = ref<CatalogResponse | null>(null)
const loading = ref(true)
const busy = ref(false)
const loadError = ref('')

const filter = ref<FilterKey>('pending')
const keyword = ref('')
const selectedKey = ref('')
const activeCandidateId = ref('')
const manualValue = ref('')
const manualNote = ref('')

const pagesCache = reactive(new Map<string, FilePages>())
const activeSource = ref<{ fileId: string; page: number } | null>(null)
const sourceLoading = ref(false)

const job = ref({ running: false, pct: 0, message: '', stage: '' })
let jobStream: EventSource | null = null
const uploadInput = ref<HTMLInputElement | null>(null)
const { hasKey, open: openAiSettings, ensure: ensureAiSettings } = useAiSettings()

const GROUPS: { id: string; title: string; prefixes: string[] }[] = [
  { id: 'company', title: '企业主体', prefixes: ['company.'] },
  { id: 'fin', title: '财务', prefixes: ['fin.'] },
  { id: 'ip', title: '知识产权', prefixes: ['ip.'] },
  { id: 'std', title: '标准', prefixes: ['std.'] },
  { id: 'qual', title: '资质与荣誉', prefixes: ['qual.'] },
  { id: 'hr', title: '人员', prefixes: ['hr.'] }
]

const rows = computed<FieldRow[]>(() => {
  const doc = evidence.value
  const meta = catalog.value
  if (!doc || !meta) return []
  return meta.fields.map((field) => {
    const entry: FieldEntry = doc.fields[field.key] ?? { key: field.key, status: 'missing' }
    const candidates = entry.candidates ?? []
    const best = candidates.reduce<FieldCandidate | undefined>(
      (acc, item) => (!acc || (item.confidence ?? 0) > (acc.confidence ?? 0) ? item : acc),
      undefined
    )
    const preview =
      entry.status === 'confirmed'
        ? formatFieldValue(field, entry.value)
        : best
          ? formatFieldValue(field, best.value)
          : ''
    return {
      key: field.key,
      label: field.label,
      type: field.type,
      unit: field.unit,
      status: entry.status,
      count: candidates.length,
      conflict: entry.status === 'candidate' && candidates.length > 1,
      preview,
      entry
    }
  })
})

const matchFilter = (row: FieldRow) => {
  if (filter.value === 'pending') return row.status === 'candidate'
  if (filter.value === 'confirmed') return row.status === 'confirmed'
  if (filter.value === 'missing') return row.status === 'missing' || row.status === 'rejected'
  return true
}

const filteredRows = computed(() =>
  rows.value.filter((row) => {
    if (!matchFilter(row)) return false
    const text = keyword.value.trim()
    if (!text) return true
    return row.label.includes(text) || row.key.includes(text)
  })
)

const groupedRows = computed(() =>
  GROUPS.map((group) => ({
    ...group,
    rows: filteredRows.value.filter((row) =>
      group.prefixes.some((prefix) => row.key.startsWith(prefix))
    )
  })).filter((group) => group.rows.length > 0)
)

const stats = computed(() => {
  const list = rows.value
  return {
    total: list.length,
    confirmed: list.filter((row) => row.status === 'confirmed').length,
    candidate: list.filter((row) => row.status === 'candidate').length,
    missing: list.filter((row) => row.status === 'missing').length,
    rejected: list.filter((row) => row.status === 'rejected').length,
    conflict: list.filter((row) => row.conflict).length
  }
})

const percent = computed(() =>
  stats.value.total === 0 ? 0 : Math.round((stats.value.confirmed / stats.value.total) * 100)
)

const selectedRow = computed(() => rows.value.find((row) => row.key === selectedKey.value) ?? null)
const selectedField = computed(() =>
  catalog.value?.fields.find((field) => field.key === selectedKey.value) ?? null
)
const selectedCandidates = computed(() =>
  [...(selectedRow.value?.entry.candidates ?? [])].sort(
    (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0)
  )
)
const activeCandidate = computed(
  () => selectedCandidates.value.find((item) => item.candidateId === activeCandidateId.value) ?? null
)

const pageDoc = computed<PageDoc | null>(() => {
  const source = activeSource.value
  if (!source) return null
  const pages = pagesCache.get(source.fileId)
  return pages?.pages.find((page) => page.page === source.page) ?? null
})

const sourceFileName = computed(() =>
  activeSource.value ? fileLabel(project.value, activeSource.value.fileId) : ''
)

const parsedCount = computed(
  () => project.value?.files.filter((file) => file.status === 'parsed').length ?? 0
)

const manualPlaceholder = computed(() => {
  const field = selectedField.value
  if (!field) return ''
  if (field.type === 'money') return '按元填写，可带千分位'
  if (field.type === 'ratio') return '按百分比填写，例如 52.3'
  if (field.type === 'int') return '整数'
  if (field.type === 'list') return '多个值用逗号分隔'
  return '填写数值或文本'
})

const ensurePages = async (fileId: string) => {
  if (pagesCache.has(fileId)) return
  sourceLoading.value = true
  try {
    const pages = await api.pages(projectId.value, fileId)
    pagesCache.set(fileId, pages)
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    sourceLoading.value = false
  }
}

const focusSource = async (fileId: string, page: number) => {
  activeSource.value = { fileId, page }
  await ensurePages(fileId)
}

const selectRow = (key: string) => {
  selectedKey.value = key
  manualValue.value = ''
  manualNote.value = ''
  const row = rows.value.find((item) => item.key === key)
  const first = row?.entry.candidates?.[0]
  if (first) {
    activeCandidateId.value = first.candidateId
    void focusSource(first.source.fileId, first.source.page)
  } else {
    activeCandidateId.value = ''
  }
}

const pickCandidateFocus = (candidate: FieldCandidate) => {
  activeCandidateId.value = candidate.candidateId
  void focusSource(candidate.source.fileId, candidate.source.page)
}

const applyEntry = (key: string, entry: FieldEntry) => {
  if (!evidence.value) return
  evidence.value = {
    ...evidence.value,
    fields: { ...evidence.value.fields, [key]: entry }
  }
}

const jumpNext = (fromIndex: number) => {
  if (filter.value !== 'pending') return
  const list = filteredRows.value
  if (list.length === 0) {
    if (selectedKey.value) {
      selectedKey.value = ''
      activeCandidateId.value = ''
    }
    return
  }
  const next = list[Math.min(Math.max(fromIndex, 0), list.length - 1)]
  selectRow(next.key)
}

const confirmCandidate = async (candidate: FieldCandidate) => {
  const row = selectedRow.value
  if (!row || busy.value) return
  const index = filteredRows.value.findIndex((item) => item.key === row.key)
  busy.value = true
  try {
    const result = await api.patch(projectId.value, row.key, {
      candidateId: candidate.candidateId
    })
    applyEntry(result.key, result.entry)
    ElMessage.success(`已确认「${row.label}」`)
    jumpNext(index)
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    busy.value = false
  }
}

const submitManual = async () => {
  const row = selectedRow.value
  if (!row || busy.value) return
  const raw = manualValue.value.trim()
  if (!raw) {
    ElMessage.warning('请先填写数值')
    return
  }
  let value: number | string = raw
  if (row.type === 'ratio') {
    const numeric = Number(raw.replace(/[,，%\s]/g, ''))
    if (!Number.isFinite(numeric)) {
      ElMessage.warning('比率需要数值')
      return
    }
    value = numeric / 100
  }
  const index = filteredRows.value.findIndex((item) => item.key === row.key)
  busy.value = true
  try {
    const result = await api.patch(projectId.value, row.key, {
      manualValue: value,
      note: manualNote.value.trim() || undefined
    })
    applyEntry(result.key, result.entry)
    manualValue.value = ''
    manualNote.value = ''
    ElMessage.success(`已手工确认「${row.label}」`)
    jumpNext(index)
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    busy.value = false
  }
}

const rejectField = async () => {
  const row = selectedRow.value
  if (!row || busy.value) return
  const index = filteredRows.value.findIndex((item) => item.key === row.key)
  busy.value = true
  try {
    const result = await api.patch(projectId.value, row.key, { status: 'rejected' })
    applyEntry(result.key, result.entry)
    ElMessage.info(`已否决「${row.label}」`)
    jumpNext(index)
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    busy.value = false
  }
}

const markMissing = async () => {
  const row = selectedRow.value
  if (!row || busy.value) return
  busy.value = true
  try {
    const result = await api.patch(projectId.value, row.key, { status: 'missing' })
    applyEntry(result.key, result.entry)
    ElMessage.info(`「${row.label}」已标记为材料不足`)
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    busy.value = false
  }
}

const runAutoConfirm = async () => {
  if (!catalog.value?.autoConfirm.enabled) {
    ElMessage.warning('自动确认已在 config/review.json 中关闭')
    return
  }
  busy.value = true
  try {
    const result = await api.autoConfirm(projectId.value)
    const skipped = result.skipped
      .slice(0, 6)
      .map((item) => `${item.key}（${SKIP_TEXT[item.reason] ?? item.reason}）`)
      .join('、')
    if (result.confirmed.length === 0) {
      ElMessage.info(skipped ? `没有可自动确认的字段：${skipped}` : '没有可自动确认的字段')
    } else {
      ElMessage.success(
        `自动确认 ${result.confirmed.length} 项${result.skipped.length ? `，跳过 ${result.skipped.length} 项` : ''}`
      )
    }
    await reloadEvidence()
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    busy.value = false
  }
}

const reloadEvidence = async () => {
  const doc = await api.evidence(projectId.value)
  evidence.value = doc
  const target = selectedKey.value
  if (target) selectRow(target)
  else jumpNext(0)
}

const load = async () => {
  if (!projectId.value) {
    goto('/projects')
    return
  }
  loading.value = true
  loadError.value = ''
  try {
    const [projectRes, evidenceRes, catalogRes] = await Promise.all([
      api.project(projectId.value),
      api.evidence(projectId.value),
      catalog.value ? Promise.resolve(catalog.value) : api.catalog()
    ])
    project.value = projectRes.project
    evidence.value = evidenceRes
    catalog.value = catalogRes
    if (stats.value.candidate === 0 && rows.value.length > 0) filter.value = 'all'
    if (selectedKey.value) selectRow(selectedKey.value)
    else jumpNext(0)
    if (!selectedKey.value && rows.value.length > 0) selectRow(rows.value[0].key)
  } catch (err) {
    loadError.value = errorText(err)
  } finally {
    loading.value = false
  }
}

const onFiles = async (event: Event) => {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  if (files.length === 0) return
  busy.value = true
  try {
    for (const file of files) await api.upload(projectId.value, file)
    ElMessage.success(`已上传 ${files.length} 份材料`)
    await load()
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    busy.value = false
  }
}

const closeStream = () => {
  jobStream?.close()
  jobStream = null
}

const listenJob = (jobId: string) => {
  closeStream()
  job.value = { running: true, pct: 0, message: '排队中', stage: 'queued' }
  const source = new EventSource(api.streamUrl(jobId))
  jobStream = source
  const handle = (event: MessageEvent) => {
    const data = JSON.parse(event.data) as JobProgressEvent
    const done = data.stage === 'done' || data.stage === 'failed'
    job.value = {
      running: !done,
      pct: data.pct,
      message: data.message ?? '',
      stage: data.stage
    }
    if (!done) return
    closeStream()
    if (data.stage === 'failed') ElMessage.error(data.message ?? '任务失败')
    else ElMessage.success(data.message ?? '任务完成')
    void load()
  }
  source.addEventListener('snapshot', handle as EventListener)
  source.addEventListener('progress', handle as EventListener)
  source.onerror = () => {
    if (!job.value.running) closeStream()
  }
}

const runJob = async (kind: 'parse' | 'extract') => {
  if (job.value.running) return
  try {
    const result = kind === 'parse' ? await api.parse(projectId.value) : await api.extract(projectId.value)
    listenJob(result.jobId)
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

const runExtract = () => {
  if (!hasKey.value) {
    ElMessage.warning('先填写模型 API 地址与 Key，保存后即可抽取')
    openAiSettings()
    return
  }
  void runJob('extract')
}

watch(selectedRow, (row) => {
  if (!row) return
  const first = row.entry.candidates?.[0]
  if (first && !activeCandidateId.value) {
    activeCandidateId.value = first.candidateId
    void focusSource(first.source.fileId, first.source.page)
  }
})

onMounted(() => {
  void load()
  void ensureAiSettings()
})
onBeforeUnmount(closeStream)
</script>

<template>
  <section v-loading="loading" class="review">
    <header class="topbar">
      <div class="identity">
        <el-button text size="small" @click="goto('/projects')">← 项目</el-button>
        <h2>{{ project?.name ?? '加载中…' }}</h2>
        <span v-if="project" class="period">
          {{ project.period.y2 }}–{{ project.period.y0 }}
        </span>
      </div>
      <div class="progress">
        <span class="counter">
          已确认 <b>{{ stats.confirmed }}</b> / {{ stats.total }}
          <em v-if="stats.conflict">{{ stats.conflict }} 项冲突</em>
        </span>
        <el-progress :percentage="percent" :stroke-width="6" :show-text="false" class="bar" />
        <el-button
          size="small"
          type="primary"
          plain
          :loading="busy"
          :disabled="!catalog?.autoConfirm.enabled"
          @click="runAutoConfirm"
        >
          自动确认高置信度
        </el-button>
        <el-button size="small" type="primary" @click="goto(`/p/${projectId}/score`)">
          评分 →
        </el-button>
      </div>
    </header>

    <div class="materials">
      <div class="files">
        <span v-for="file in project?.files ?? []" :key="file.fileId" class="file-chip">
          <b>{{ file.name }}</b>
          <em>{{ DOC_TYPE_TEXT[file.docType ?? 'other'] }}</em>
          <span>{{ file.pages ?? 0 }} 页</span>
          <span class="state" :class="file.status">{{ file.status === 'parsed' ? '已解析' : file.status === 'failed' ? '解析失败' : '待解析' }}</span>
        </span>
        <span v-if="!project?.files.length" class="no-file">还没有材料，先上传申报材料</span>
      </div>
      <div class="tools">
        <input ref="uploadInput" type="file" multiple hidden @change="onFiles" />
        <el-button size="small" @click="uploadInput?.click()">上传材料</el-button>
        <el-button size="small" :disabled="job.running || !project?.files.length" @click="runJob('parse')">
          解析
        </el-button>
        <el-button size="small" :disabled="job.running || parsedCount === 0" @click="runExtract">
          抽取字段
        </el-button>
        <el-button v-if="!hasKey" text size="small" type="warning" @click="openAiSettings">
          模型未配置
        </el-button>
        <span v-if="job.running" class="job">
          <i :style="{ width: `${job.pct}%` }" />
          {{ job.message || job.stage }}
        </span>
      </div>
    </div>

    <div v-if="loadError" class="error">
      <span>{{ loadError }}</span>
      <el-button size="small" @click="load">重试</el-button>
    </div>

    <div v-else class="workspace">
      <aside class="panel list-panel">
        <div class="filters">
          <button :class="{ on: filter === 'pending' }" @click="filter = 'pending'">
            待确认 {{ stats.candidate }}
          </button>
          <button :class="{ on: filter === 'confirmed' }" @click="filter = 'confirmed'">
            已确认 {{ stats.confirmed }}
          </button>
          <button :class="{ on: filter === 'missing' }" @click="filter = 'missing'">
            缺失 {{ stats.missing + stats.rejected }}
          </button>
          <button :class="{ on: filter === 'all' }" @click="filter = 'all'">全部</button>
        </div>
        <el-input v-model="keyword" size="small" placeholder="搜索字段名或 key" clearable />

        <div class="field-list">
          <div v-for="group in groupedRows" :key="group.id" class="group">
            <p class="group-title">{{ group.title }}<span>{{ group.rows.length }}</span></p>
            <EvidenceFieldRow
              v-for="row in group.rows"
              :key="row.key"
              :row="row"
              :active="row.key === selectedKey"
              @select="selectRow"
            />
          </div>
          <el-empty v-if="groupedRows.length === 0" description="当前筛选下没有字段" :image-size="64" />
        </div>
      </aside>

      <main class="panel source-panel">
        <SourceViewer
          v-if="activeSource"
          :project-id="projectId"
          :file-id="activeSource.fileId"
          :page="activeSource.page"
          :file-name="sourceFileName"
          :page-doc="pageDoc"
          :quote="activeCandidate?.source.quote"
          :loading="sourceLoading"
        />
        <el-empty v-else description="左侧选一个字段，这里显示它的出处" :image-size="72" />
      </main>

      <aside class="panel detail-panel">
        <template v-if="selectedRow && selectedField">
          <header class="detail-head">
            <div>
              <h3>{{ selectedField.label }}</h3>
              <code>{{ selectedField.key }}</code>
            </div>
            <el-tag size="small" effect="plain" :type="STATUS_TYPE[selectedRow.status]">
              {{ STATUS_TEXT[selectedRow.status] }}
            </el-tag>
          </header>

          <p class="detail-meta">
            <span>{{ selectedField.type }}</span>
            <span v-if="selectedField.unit">单位 {{ selectedField.unit }}</span>
            <span v-if="selectedField.periodic">按年</span>
            <span v-if="selectedField.dataClass">数据级 {{ selectedField.dataClass }}</span>
          </p>
          <p v-if="selectedField.description" class="detail-desc">{{ selectedField.description }}</p>

          <div v-if="selectedRow.status === 'confirmed'" class="confirmed-box">
            <span>当前确认值</span>
            <strong>{{ formatFieldValue(selectedField, selectedRow.entry.value) }}</strong>
            <em v-if="selectedRow.entry.resolution?.strategy">
              {{ selectedRow.entry.resolution.strategy === 'manual' ? '手工填写' : '候选采纳' }}
            </em>
          </div>

          <div class="candidates">
            <p class="section-title">
              候选 {{ selectedCandidates.length }}
              <span v-if="selectedCandidates.length > 1" class="conflict-note">存在冲突，必须人工二选一</span>
            </p>
            <CandidateCard
              v-for="(candidate, index) in selectedCandidates"
              :key="candidate.candidateId"
              :candidate="candidate"
              :field="selectedField"
              :index="index"
              :active="candidate.candidateId === activeCandidateId"
              :file-name="fileLabel(project, candidate.source.fileId)"
              @focus="pickCandidateFocus(candidate)"
              @pick="confirmCandidate(candidate)"
            />
            <p v-if="selectedCandidates.length === 0" class="none">
              没有候选。可在下方手工填写，或标记为材料不足。
            </p>
          </div>

          <div class="manual">
            <p class="section-title">手工确认</p>
            <el-select
              v-if="selectedField.type === 'bool'"
              v-model="manualValue"
              size="small"
              placeholder="选择"
              style="width: 100%"
            >
              <el-option label="是" value="是" />
              <el-option label="否" value="否" />
            </el-select>
            <el-select
              v-else-if="selectedField.type === 'enum'"
              v-model="manualValue"
              size="small"
              placeholder="选择枚举值"
              style="width: 100%"
            >
              <el-option
                v-for="option in selectedField.enumValues ?? []"
                :key="option"
                :label="option"
                :value="option"
              />
            </el-select>
            <el-input
              v-else
              v-model="manualValue"
              size="small"
              :placeholder="manualPlaceholder"
              :type="selectedField.type === 'list' ? 'textarea' : 'text'"
              :rows="2"
            >
              <template v-if="selectedField.type === 'money'" #append>元</template>
              <template v-else-if="selectedField.type === 'ratio'" #append>%</template>
            </el-input>

            <el-input v-model="manualNote" size="small" placeholder="备注（可选）" />
            <div class="manual-actions">
              <el-button size="small" type="primary" :loading="busy" @click="submitManual">
                保存为手工值
              </el-button>
              <el-button size="small" @click="markMissing">标记材料不足</el-button>
              <el-button size="small" type="danger" plain @click="rejectField">否决</el-button>
            </div>
          </div>
        </template>
        <el-empty v-else description="左侧选一个字段开始确认" :image-size="72" />
      </aside>
    </div>
  </section>
</template>

<style scoped>
.review {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 720px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 12px 18px;
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 14px;
}

.identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.period {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f4f7fb;
  border: 1px solid #e6ebf2;
  font-size: 11.5px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}

h2 {
  font-size: 15.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.progress {
  display: flex;
  align-items: center;
  gap: 12px;
}

.counter {
  font-size: 12.5px;
  color: #6b7280;
  white-space: nowrap;
}

.counter b {
  color: #111827;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}

.counter em {
  margin-left: 8px;
  font-style: normal;
  color: #dc2626;
}

.bar {
  width: 140px;
}

.materials {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 16px;
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 14px;
}

.files {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.file-chip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 9px;
  border-radius: 999px;
  background: #f6f9fe;
  border: 1px solid #e3ebf6;
  font-size: 11.5px;
  color: #4b5563;
  max-width: 320px;
}

.file-chip b {
  font-weight: 600;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-chip em {
  font-style: normal;
  color: #2563eb;
}

.file-chip .state.parsed {
  color: #059669;
}

.file-chip .state.failed {
  color: #dc2626;
}

.no-file {
  font-size: 12px;
  color: #9aa5b5;
}

.tools {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.job {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 140px;
  padding: 3px 10px;
  border-radius: 999px;
  background: #eff5ff;
  font-size: 11.5px;
  color: #2563eb;
  overflow: hidden;
}

.job i {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(37, 99, 235, 0.12);
  transition: width 0.3s ease;
}

.error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
  font-size: 13px;
}

.workspace {
  display: grid;
  grid-template-columns: 304px minmax(0, 1fr) 372px;
  gap: 12px;
  align-items: stretch;
  height: calc(100vh - 216px);
  min-height: 520px;
}

.panel {
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 14px;
  padding: 12px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.list-panel {
  padding: 12px 8px 8px 12px;
}

.filters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.filters button {
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid #e6ebf2;
  background: #fbfcfe;
  font-size: 11.5px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s ease;
}

.filters button.on {
  border-color: #bcd4fb;
  background: #eff5ff;
  color: #2563eb;
  font-weight: 600;
}

.field-list {
  flex: 1;
  overflow: auto;
  padding-right: 4px;
}

.group + .group {
  margin-top: 10px;
}

.group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px 4px;
  font-size: 11px;
  letter-spacing: 1px;
  color: #8a94a6;
}

.group-title span {
  color: #b6bfcc;
}

.source-panel {
  overflow: auto;
}

.detail-panel {
  overflow: auto;
}

.detail-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

h3 {
  font-size: 15px;
  font-weight: 600;
}

.detail-head code {
  display: inline-block;
  margin-top: 4px;
  background: transparent;
  padding: 0;
  font-size: 11px;
  color: #a3adbb;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 11.5px;
  color: #8a94a6;
}

.detail-meta span {
  padding: 1px 7px;
  border-radius: 6px;
  background: #f4f7fb;
}

.detail-desc {
  font-size: 12px;
  line-height: 1.65;
  color: #6b7280;
  padding: 8px 10px;
  border-radius: 9px;
  background: #fbfcfe;
  border: 1px dashed #e6ebf2;
}

.confirmed-box {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
}

.confirmed-box span {
  font-size: 11.5px;
  color: #15803d;
}

.confirmed-box strong {
  font-size: 16px;
  color: #14532d;
  font-variant-numeric: tabular-nums;
}

.confirmed-box em {
  margin-left: auto;
  font-style: normal;
  font-size: 11px;
  color: #16a34a;
}

.candidates {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11.5px;
  letter-spacing: 0.4px;
  color: #8a94a6;
}

.conflict-note {
  padding: 1px 7px;
  border-radius: 6px;
  background: #fef2f2;
  color: #dc2626;
}

.none {
  font-size: 12px;
  color: #9aa5b5;
  line-height: 1.7;
}

.manual {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding-top: 4px;
  border-top: 1px dashed #e8edf4;
  margin-top: auto;
}

.manual-actions {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
}
</style>
