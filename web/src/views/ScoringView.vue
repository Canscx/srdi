<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type {
  AdminPortalResult,
  GateResult,
  IndicatorResult,
  RulesMetaIndicator,
  ScoreRecord
} from '@srdi/shared'
import { formatValue } from '@srdi/shared'
import { ElMessage } from 'element-plus'
import { ApiError, api, errorText } from '@/api'
import {
  CONCLUSION_TEXT,
  FLAG_TEXT,
  GATE_BASIS_TEXT,
  GATE_VERDICT_TEXT,
  INDICATOR_STATUS_TEXT,
  formatIndicatorRaw,
  formatScoreRate
} from '@/format'
import { goto, useRoute } from '@/router'
import RenameProjectDialog from '@/components/RenameProjectDialog.vue'
import ScoreReport from '@/components/portal/ScoreReport.vue'

type StatusFilter = 'all' | 'scored' | 'estimated' | 'missing' | 'notApplicable' | 'excluded'

const route = useRoute()
const projectId = computed(() => route.value.projectId ?? '')

const data = ref<AdminPortalResult | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref('')
const filter = ref<StatusFilter>('all')
const dimFilter = ref('all')
const openRows = ref<string[]>([])
const openGates = ref<string[]>([])
const openPro = ref<string[]>([])
const renameOpen = ref(false)

const record = computed<ScoreRecord | null>(() => data.value?.professional.record ?? null)
const meta = computed(() => data.value?.professional.rules ?? null)
const result = computed(() => record.value?.result ?? null)
const projectName = computed(() => data.value?.projectName ?? '加载中…')

const metaMap = computed(() => {
  const map = new Map<string, RulesMetaIndicator>()
  for (const dimension of meta.value?.dimensions ?? []) {
    for (const indicator of dimension.indicators) map.set(indicator.id, indicator)
  }
  return map
})

const periodText = computed(() => {
  const period = result.value?.period ?? data.value?.period
  return period ? `${period.y2}–${period.y0}` : ''
})

const industryText = computed(() => {
  const industry = result.value?.industry
  if (!industry) return '—'
  const name = industry.name ?? '未匹配行业'
  const suffix = industry.benchmarkSource === 'default' ? '（中性基准估算）' : ''
  return `${industry.code || '—'} ${name}${suffix}`
})

const savedText = computed(() =>
  record.value ? new Date(record.value.savedAt).toLocaleString('zh-CN', { hour12: false }) : ''
)

const rangeLabel = computed(() => {
  const totals = result.value?.totals
  if (!totals) return '—'
  return totals.conservative === totals.optimistic
    ? `区间收敛于 ${totals.conservative.toFixed(2)}`
    : `区间 ${totals.conservative.toFixed(2)}–${totals.optimistic.toFixed(2)}`
})

const dimensionRange = (score: { conservative: number; optimistic: number }) =>
  score.conservative === score.optimistic
    ? `收敛 ${score.conservative.toFixed(2)}`
    : `${score.conservative.toFixed(2)}–${score.optimistic.toFixed(2)}`

const dimensionMax = (dimensionId: string, fallback: number) => {
  const sum = (result.value?.indicators ?? [])
    .filter((item) => item.dimensionId === dimensionId)
    .reduce((total, item) => total + item.effectiveWeight, 0)
  return sum > 0 ? Math.round(sum * 100) / 100 : fallback
}

interface IndicatorRow {
  item: IndicatorResult
  unit?: string
  formula?: string
  refs: string[]
  missingKeys: string[]
}

const rows = computed<IndicatorRow[]>(() => {
  const current = result.value
  if (!current) return []
  return current.indicators.map((item) => {
    const def = metaMap.value.get(item.id)
    return {
      item,
      unit: def?.unit,
      formula: def?.formula,
      refs: def?.evidenceRefs ?? [],
      missingKeys: current.missing.find((entry) => entry.indicatorId === item.id)?.fieldKeys ?? []
    }
  })
})

const nameOf = (indicatorId: string) =>
  rows.value.find((row) => row.item.id === indicatorId)?.item.name ?? indicatorId

const counts = computed(() => {
  const tally: Record<StatusFilter, number> = {
    all: rows.value.length,
    scored: 0,
    estimated: 0,
    missing: 0,
    notApplicable: 0,
    excluded: 0
  }
  for (const row of rows.value) tally[row.item.status] += 1
  return tally
})

const filterOptions = computed(() =>
  (
    [
      ['all', '全部'],
      ['scored', '已计分'],
      ['estimated', '估算'],
      ['missing', '缺证据'],
      ['notApplicable', '不适用'],
      ['excluded', '已排除']
    ] as [StatusFilter, string][]
  ).map(([key, text]) => ({ key, text, count: counts.value[key] }))
)

const filteredRows = computed(() =>
  rows.value.filter((row) => filter.value === 'all' || row.item.status === filter.value)
)

const groups = computed(() =>
  (result.value?.dimensions ?? [])
    .filter((dimension) => dimFilter.value === 'all' || dimension.id === dimFilter.value)
    .map((dimension) => ({
      ...dimension,
      rows: filteredRows.value.filter((row) => row.item.dimensionId === dimension.id)
    }))
    .filter((group) => group.rows.length > 0)
)

const gateFailureCount = computed(
  () => result.value?.gates.filter((gate) => gate.effective === 'fail').length ?? 0
)

const gatePendingCount = computed(
  () => result.value?.gates.filter((gate) => gate.effective === 'pending').length ?? 0
)

const evidenceStats = computed(() => record.value?.evidence ?? null)

const completeness = computed(() => {
  const stats = evidenceStats.value
  if (!stats || stats.total === 0) return 0
  return Math.round((stats.confirmed / stats.total) * 100)
})

const lowEvidence = computed(() => (evidenceStats.value?.confirmed ?? 0) < 12)

const rawText = (row: IndicatorRow) => formatIndicatorRaw(row.item.raw, row.unit)

const benchmarkText = (row: IndicatorRow) => {
  const benchmark = row.item.benchmark
  return benchmark ? formatValue(benchmark.value, row.unit) : '—'
}

const contributionText = (row: IndicatorRow) =>
  `参考 ${row.item.contribution.official.toFixed(2)} · 保守 ${row.item.contribution.conservative.toFixed(2)} · 乐观 ${row.item.contribution.optimistic.toFixed(2)}`

const flagText = (flag: string) => FLAG_TEXT[flag] ?? flag

const flagList = (row: IndicatorRow) => {
  const flags = row.item.flags.map((flag) => ({ key: flag, text: flagText(flag) }))
  if (row.item.basis === 'absent' && flags.length === 0) {
    flags.push({
      key: 'fields_missing',
      text: row.missingKeys.length > 0 ? `缺 ${row.missingKeys.length} 字段` : '缺证据'
    })
  }
  return flags
}

const gateVerdictText = (gate: GateResult) => GATE_VERDICT_TEXT[gate.effective] ?? gate.effective

const gateBasisText = (gate: GateResult) => GATE_BASIS_TEXT[gate.basis] ?? gate.basis

const isRowOpen = (id: string) => openRows.value.includes(id)
const isGateOpen = (id: string) => openGates.value.includes(id)

const toggleRow = (id: string) => {
  openRows.value = isRowOpen(id)
    ? openRows.value.filter((item) => item !== id)
    : [...openRows.value, id]
}

const toggleGate = (id: string) => {
  openGates.value = isGateOpen(id)
    ? openGates.value.filter((item) => item !== id)
    : [...openGates.value, id]
}

const onRenamed = (name: string) => {
  if (data.value) data.value = { ...data.value, projectName: name }
}

const bootstrap = async () => {
  if (!projectId.value) {
    goto('/projects')
    return
  }
  loading.value = true
  error.value = ''
  try {
    data.value = await api.adminResult(projectId.value)
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      try {
        await api.score(projectId.value)
        data.value = await api.adminResult(projectId.value)
      } catch (inner) {
        error.value = errorText(inner)
      }
    } else if (err instanceof ApiError && err.status === 404) {
      goto('/projects')
      return
    } else {
      error.value = errorText(err)
    }
  } finally {
    loading.value = false
  }
}

const recalc = async () => {
  if (busy.value) return
  busy.value = true
  try {
    await api.score(projectId.value)
    data.value = await api.adminResult(projectId.value)
    ElMessage.success('已按当前证据重新计算')
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    busy.value = false
  }
}

const exportPdf = () => {
  if (!record.value) {
    ElMessage.warning('先生成参考得分')
    return
  }
  window.open(api.adminReportUrl(projectId.value), '_blank')
}

onMounted(bootstrap)
</script>

<template>
  <section v-loading="loading" class="score">
    <header class="topbar">
      <div class="identity">
        <el-button text size="small" @click="goto('/projects')">← 工作台</el-button>
        <el-button text size="small" @click="goto(`/p/${projectId}/review`)">← 确认页</el-button>
        <h2>{{ projectName }}</h2>
        <el-button v-if="data" text size="small" @click="renameOpen = true">重命名</el-button>
        <span v-if="periodText" class="period">{{ periodText }}</span>
        <span v-if="result" class="industry">{{ industryText }}</span>
      </div>
      <div class="actions">
        <span v-if="record" class="stamp">打分于 {{ savedText }}</span>
        <el-button size="small" :disabled="!record" @click="exportPdf">导出报告</el-button>
        <el-button size="small" type="primary" plain :loading="busy" @click="recalc">
          重新计算
        </el-button>
      </div>
    </header>

    <div v-if="error" class="error">
      <span>{{ error }}</span>
      <el-button size="small" @click="bootstrap">重试</el-button>
    </div>

    <template v-else-if="data">
      <ScoreReport :data="data" :saved="false">
        <template #ops>
          <el-button @click="goto('/projects')">返回工作台</el-button>
          <el-button type="primary" :disabled="!record" @click="exportPdf">导出报告</el-button>
        </template>
      </ScoreReport>

      <section v-if="result" class="pro">
        <el-collapse v-model="openPro">
          <el-collapse-item
            name="pro"
            title="专业视图 · 六道门槛 / 三口径 / 23 项明细 / 口径与假设"
          >
            <div class="pro-body">
              <p v-if="lowEvidence" class="warn">
                <b>证据偏少</b>
                <span>
                  40 个字段仅确认 {{ evidenceStats?.confirmed ?? 0 }} 项，缺失项按 0.5 权重的中性值计入参考分。
                  回确认页补齐证据后重新计算，分数结构会明显变化。
                </span>
              </p>

              <section class="panel">
                <header class="panel-head">
                  <h3>三口径与证据</h3>
                  <span>{{ rangeLabel }}</span>
                </header>

                <div class="calibers">
                  <div>
                    <span>保守口径</span>
                    <b>{{ result.totals.conservative.toFixed(2) }}</b>
                  </div>
                  <div class="main">
                    <span>参考得分</span>
                    <b>{{ result.totals.official.toFixed(2) }}</b>
                  </div>
                  <div>
                    <span>乐观口径</span>
                    <b>{{ result.totals.optimistic.toFixed(2) }}</b>
                  </div>
                </div>

                <div class="verdict" :class="result.conclusion">
                  <span>{{ CONCLUSION_TEXT[result.conclusion] }}</span>
                  <em>
                    六门槛 {{ gateFailureCount }} 项不满足 · {{ gatePendingCount }} 项待补
                    · {{ rangeLabel }}
                  </em>
                </div>

                <dl class="facts">
                  <div>
                    <dt>行业基准</dt>
                    <dd>{{ industryText }}</dd>
                  </div>
                  <div>
                    <dt>确认字段</dt>
                    <dd>
                      {{ evidenceStats?.confirmed }} / {{ evidenceStats?.total }}（{{ completeness }}%）
                    </dd>
                  </div>
                  <div>
                    <dt>证据可信度</dt>
                    <dd>{{ (result.totals.confidence * 100).toFixed(1) }}%</dd>
                  </div>
                  <div>
                    <dt>引擎</dt>
                    <dd>v{{ result.meta.engineVersion }} · {{ result.rulesId }}</dd>
                  </div>
                </dl>

                <p class="caliber-note">
                  保守口径把估算项与缺失项记 0，乐观口径把它们记满权重；参考口径中缺失项按半个权重、估算项按估算分计入。
                  三者重合说明当前没有估算项与缺失项。
                </p>

                <div class="states">
                  <span v-for="option in filterOptions.slice(1)" :key="option.key" :class="option.key">
                    {{ option.text }}<b>{{ option.count }}</b>
                  </span>
                </div>
              </section>

              <p v-if="result.excluded.length" class="weight-note">
                <b>权重排除</b>
                <span v-for="item in result.excluded" :key="item.indicatorId">
                  {{ item.indicatorId }} {{ nameOf(item.indicatorId) }} · 原权重
                  {{ item.baseWeight.toFixed(2) }} · {{ item.reason }}
                </span>
                <em>
                  其余 {{ result.indicators.length - result.excluded.length }} 项等比放大，有效权重合计 100。
                </em>
              </p>

              <section class="panel">
                <header class="panel-head">
                  <h3>六道门槛判词</h3>
                  <span>判词只看证据与规则，不由得分反推 · 点行展开检查项</span>
                </header>
                <table class="gate-grid">
                  <thead>
                    <tr>
                      <th style="width: 210px">门槛</th>
                      <th style="width: 88px">判词</th>
                      <th style="width: 104px">依据</th>
                      <th>说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="gate in result.gates" :key="gate.id">
                      <tr class="gate-row" @click="toggleGate(gate.id)">
                        <td class="gate-name">
                          <b>{{ gate.id }}</b>{{ gate.name }}
                        </td>
                        <td>
                          <span class="verdict-chip" :class="gate.effective">
                            {{ gateVerdictText(gate) }}
                          </span>
                        </td>
                        <td class="basis">{{ gateBasisText(gate) }}</td>
                        <td class="gate-explain">
                          {{ gate.explain }}
                          <em v-if="gate.passedVia">（经 {{ gate.passedVia }} 通过）</em>
                        </td>
                      </tr>
                      <tr v-if="isGateOpen(gate.id)" class="gate-detail">
                        <td colspan="4">
                          <div v-if="gate.checks.length" class="checks">
                            <div v-for="check in gate.checks" :key="check.id" :class="check.verdict">
                              <span class="dot" />
                              <b>{{ check.id }}</b>
                              {{ check.label }}
                              <em>{{ GATE_VERDICT_TEXT[check.verdict] }}</em>
                            </div>
                          </div>
                          <p v-else class="gate-note">该门槛按三口径分数判定，无独立检查项。</p>
                        </td>
                      </tr>
                    </template>
                  </tbody>
                </table>
              </section>

              <section class="panel">
                <header class="panel-head table-head">
                  <h3>23 项指标明细</h3>
                  <div class="filters">
                    <button
                      v-for="option in filterOptions"
                      :key="option.key"
                      :class="{ on: filter === option.key }"
                      @click="filter = option.key"
                    >
                      {{ option.text }} {{ option.count }}
                    </button>
                    <el-select v-model="dimFilter" size="small" style="width: 118px">
                      <el-option label="全部维度" value="all" />
                      <el-option
                        v-for="dimension in result.dimensions"
                        :key="dimension.id"
                        :label="dimension.name"
                        :value="dimension.id"
                      />
                    </el-select>
                  </div>
                </header>

                <table class="grid">
                  <thead>
                    <tr>
                      <th class="num" style="width: 40px">编号</th>
                      <th style="width: 240px">指标</th>
                      <th style="width: 76px">状态</th>
                      <th class="num" style="width: 110px">原始值</th>
                      <th class="num" style="width: 70px">得分率</th>
                      <th class="num" style="width: 58px">权重</th>
                      <th class="num" style="width: 70px">有效权重</th>
                      <th>标记</th>
                    </tr>
                  </thead>
                  <tbody>
                    <template v-for="group in groups" :key="group.id">
                      <tr class="dim-row">
                        <td colspan="8">
                          <b>{{ group.name }}</b>
                          <span>
                            名义权重 {{ group.weight }} · 重归一满分
                            {{ dimensionMax(group.id, group.weight).toFixed(2) }} · 参考
                            {{ group.score.official.toFixed(2) }} · {{ dimensionRange(group.score) }}
                          </span>
                        </td>
                      </tr>
                      <template v-for="row in group.rows" :key="row.item.id">
                        <tr class="item" :class="row.item.status" @click="toggleRow(row.item.id)">
                          <td class="num">{{ row.item.code }}</td>
                          <td class="name">
                            {{ row.item.name }}
                            <em>{{ row.item.id }}</em>
                          </td>
                          <td>
                            <span class="badge" :class="row.item.status">
                              {{ INDICATOR_STATUS_TEXT[row.item.status] }}
                            </span>
                          </td>
                          <td class="num">{{ rawText(row) }}</td>
                          <td class="num">{{ formatScoreRate(row.item.score) }}</td>
                          <td class="num muted">{{ row.item.weight.toFixed(2) }}</td>
                          <td class="num">{{ row.item.effectiveWeight.toFixed(2) }}</td>
                          <td class="flags">
                            <span v-for="flag in flagList(row)" :key="flag.key">{{ flag.text }}</span>
                          </td>
                        </tr>
                        <tr v-if="isRowOpen(row.item.id)" class="detail">
                          <td colspan="8">
                            <div class="detail-grid">
                              <p><span>引擎说明</span>{{ row.item.explain.text }}</p>
                              <p v-if="row.formula"><span>公式</span><code>{{ row.formula }}</code></p>
                              <p v-if="row.refs.length"><span>证据字段</span>{{ row.refs.join('、') }}</p>
                              <p v-if="row.missingKeys.length">
                                <span>缺失字段</span>{{ row.missingKeys.join('、') }}
                              </p>
                              <p v-if="row.item.benchmark">
                                <span>行业基准</span>
                                {{ row.item.benchmark.key }} = {{ benchmarkText(row) }} ·
                                {{ row.item.benchmark.source === 'industry' ? '行业值' : '中性估算' }}
                              </p>
                              <p><span>三口径贡献</span>{{ contributionText(row) }}</p>
                              <p v-if="row.item.reason"><span>判定原因</span>{{ row.item.reason }}</p>
                            </div>
                          </td>
                        </tr>
                      </template>
                    </template>
                  </tbody>
                </table>
                <el-empty
                  v-if="groups.length === 0"
                  description="当前筛选下没有指标"
                  :image-size="64"
                />
              </section>

              <section class="panel notes">
                <header class="panel-head">
                  <h3>口径与假设</h3>
                  <span>{{ meta?.rulesId }} · 生效 {{ meta?.version }}</span>
                </header>
                <ol>
                  <li v-for="item in meta?.assumptions ?? []" :key="item.id">
                    <b>{{ item.id }}</b>{{ item.text }}
                    <em>{{ item.impact }}</em>
                  </li>
                </ol>
                <p class="foot-note">
                  参考得分非官方口径：三级指标采用维度内等权，排除项按策略不计分并把其余指标权重等比放大到 100；
                  缺失项以中性值参与三口径区间。分数只作申报前自查，不能作为对外承诺。
                </p>
              </section>
            </div>
          </el-collapse-item>
        </el-collapse>
      </section>
    </template>

    <el-empty v-else-if="!loading" description="尚无评分结果" :image-size="80" />

    <RenameProjectDialog
      v-model:visible="renameOpen"
      :project-id="projectId"
      :name="data?.projectName ?? ''"
      @renamed="onRenamed"
    />
  </section>
</template>

<style scoped>
.score {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pro {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
}

.pro :deep(.el-collapse) {
  border: 1px solid #e8eef6;
  border-radius: 14px;
  background: #fff;
  overflow: hidden;
}

.pro :deep(.el-collapse-item__header) {
  height: 46px;
  padding: 0 18px;
  border-bottom: none;
  background: #fcfdff;
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.pro :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}

.pro :deep(.el-collapse-item__content) {
  padding: 0 18px 16px;
}

.pro-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 12px;
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

h2 {
  font-size: 15.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.period,
.industry {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 6px;
  background: #f4f7fb;
  border: 1px solid #e6ebf2;
  font-size: 11.5px;
  color: #6b7280;
}

.industry {
  background: #eff5ff;
  border-color: #dbe8fb;
  color: #2563eb;
}

.actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.stamp {
  font-size: 11.5px;
  color: #a3adbb;
  font-variant-numeric: tabular-nums;
}

.disclaimer,
.warn,
.weight-note {
  display: flex;
  align-items: baseline;
  gap: 10px;
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.65;
}

.disclaimer {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #92400e;
}

.disclaimer b,
.warn b,
.weight-note b {
  flex-shrink: 0;
}

.warn {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.weight-note {
  background: #f7f9fc;
  border: 1px dashed #dbe3ee;
  color: #5b6675;
  flex-wrap: wrap;
}

.weight-note b {
  color: #6b7280;
}

.weight-note em {
  font-style: normal;
  color: #9aa5b5;
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

.panel {
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 14px;
  padding: 14px 16px;
}

.panel-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.panel-head h3 {
  font-size: 13.5px;
  font-weight: 600;
}

.panel-head span {
  font-size: 11px;
  color: #a3adbb;
}

.calibers {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.calibers > div {
  padding: 10px 14px;
  border-radius: 11px;
  background: #f7f9fc;
  border: 1px solid #eef2f7;
}

.calibers > div.main {
  background: #eff5ff;
  border-color: #cfe0fb;
}

.calibers span {
  font-size: 11px;
  color: #8a94a6;
}

.calibers b {
  display: block;
  margin-top: 2px;
  font-size: 23px;
  letter-spacing: -0.2px;
  color: #1f2937;
  font-variant-numeric: tabular-nums;
}

.calibers > div.main b {
  font-size: 32px;
  color: #1d4ed8;
}

.verdict {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.verdict > span {
  padding: 3px 11px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

.verdict.pass > span {
  background: #ecfdf5;
  border: 1px solid #a7f3d0;
  color: #047857;
}

.verdict.fail > span {
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #b91c1c;
}

.verdict.pending > span {
  background: #fffbeb;
  border: 1px solid #fde68a;
  color: #b45309;
}

.verdict em {
  font-style: normal;
  font-size: 11.5px;
  color: #8a94a6;
}

.facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 20px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed #eef2f7;
}

.facts > div {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  min-width: 0;
}

.facts dt {
  flex-shrink: 0;
  color: #8a94a6;
}

.facts dd {
  margin: 0;
  color: #374151;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.caliber-note {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 10px;
  border: 1px dashed #e6ebf2;
  background: #fbfcfe;
  font-size: 11.5px;
  line-height: 1.7;
  color: #6b7280;
}

.states {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.states span {
  padding: 2px 9px;
  border-radius: 999px;
  border: 1px solid #eef2f7;
  background: #f4f7fb;
  font-size: 11px;
  color: #5b6675;
}

.states b {
  margin-left: 5px;
  font-variant-numeric: tabular-nums;
}

.states .scored {
  background: #f0fdf4;
  border-color: #d1fae5;
  color: #047857;
}

.states .estimated {
  background: #fffbeb;
  border-color: #fde68a;
  color: #b45309;
}

.states .missing {
  background: #f8fafc;
  border-color: #e6ebf2;
  color: #4b5563;
}

.states .notApplicable {
  background: #fef2f2;
  border-color: #fecaca;
  color: #b91c1c;
}

.states .excluded {
  color: #6b7280;
}

.gate-grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.gate-grid th {
  padding: 6px 8px;
  border-bottom: 1px solid #eef2f7;
  font-size: 11px;
  font-weight: 500;
  text-align: left;
  color: #8a94a6;
}

.gate-grid td {
  padding: 8px;
  border-bottom: 1px solid #f4f7fb;
  vertical-align: top;
  color: #374151;
}

.gate-row {
  cursor: pointer;
}

.gate-row:hover td {
  background: #fbfcfe;
}

.gate-name b {
  margin-right: 6px;
  font-size: 10.5px;
  font-weight: 500;
  color: #a3adbb;
}

.verdict-chip {
  display: inline-block;
  padding: 1px 9px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
}

.verdict-chip.pass {
  background: #ecfdf5;
  color: #047857;
}

.verdict-chip.fail {
  background: #fef2f2;
  color: #b91c1c;
}

.verdict-chip.pending {
  background: #fffbeb;
  color: #b45309;
}

.basis {
  font-size: 11.5px;
  color: #6b7280;
}

.gate-explain {
  font-size: 11.5px;
  color: #6b7280;
  line-height: 1.6;
}

.gate-explain em {
  font-style: normal;
  color: #2563eb;
}

.gate-detail td {
  background: #fbfcfe;
  padding: 9px 12px 11px;
}

.checks {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.checks > div {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 7px;
  border: 1px solid #eef2f7;
  background: #fff;
  font-size: 11px;
  color: #4b5563;
}

.checks b {
  font-weight: 600;
  color: #6b7280;
}

.checks em {
  font-style: normal;
  color: #8a94a6;
}

.checks .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #cbd5e1;
}

.checks .pass .dot {
  background: #10b981;
}

.checks .fail .dot {
  background: #ef4444;
}

.checks .pending .dot {
  background: #f59e0b;
}

.checks .unknown .dot {
  background: #cbd5e1;
}

.gate-note {
  font-size: 11.5px;
  color: #9aa5b5;
}

.table-head {
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.filters {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.filters button {
  padding: 3px 9px;
  border-radius: 7px;
  border: 1px solid #e6ebf2;
  background: #fbfcfe;
  font-size: 11px;
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

.grid {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.grid th {
  padding: 6px 8px;
  border-bottom: 1px solid #eef2f7;
  font-size: 11px;
  font-weight: 500;
  text-align: left;
  color: #8a94a6;
}

.grid td {
  padding: 7px 8px;
  border-bottom: 1px solid #f4f7fb;
  color: #374151;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.muted {
  color: #9aa5b5;
}

.dim-row td {
  padding: 6px 8px;
  border-top: 1px solid #eef2f7;
  border-bottom: 1px solid #eef2f7;
  background: #f7f9fc;
  font-size: 11.5px;
  color: #5b6675;
}

.dim-row b {
  margin-right: 8px;
  color: #1f2937;
}

.dim-row span {
  color: #8a94a6;
}

.item {
  cursor: pointer;
}

.item:hover td {
  background: #fbfcfe;
}

.item.excluded td {
  color: #9aa5b5;
}

.name em {
  display: block;
  margin-top: 1px;
  font-style: normal;
  font-size: 10.5px;
  color: #b6bfcc;
}

.badge {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  white-space: nowrap;
}

.badge.scored {
  background: #ecfdf5;
  color: #047857;
}

.badge.estimated {
  background: #fffbeb;
  color: #b45309;
}

.badge.missing {
  background: #f1f5f9;
  color: #566274;
}

.badge.notApplicable {
  background: #fef2f2;
  color: #b91c1c;
}

.badge.excluded {
  background: #f4f7fb;
  color: #8a94a6;
}

.flags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.flags span {
  padding: 1px 6px;
  border-radius: 6px;
  background: #f4f7fb;
  color: #6b7280;
  font-size: 10.5px;
  white-space: nowrap;
}

.detail td {
  padding: 10px 14px 12px;
  background: #fbfcfe;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 24px;
}

.detail-grid p {
  font-size: 11.5px;
  line-height: 1.65;
  color: #4b5563;
}

.detail-grid span {
  display: inline-block;
  min-width: 68px;
  margin-right: 6px;
  color: #9aa5b5;
}

.detail-grid code {
  font-size: 11px;
}

.notes ol {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 26px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.notes li {
  font-size: 11.5px;
  line-height: 1.7;
  color: #4b5563;
}

.notes li b {
  margin-right: 6px;
  color: #2563eb;
}

.notes li em {
  display: block;
  font-style: normal;
  color: #9aa5b5;
}

.foot-note {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px dashed #eef2f7;
  font-size: 11.5px;
  line-height: 1.7;
  color: #8a94a6;
}
</style>
