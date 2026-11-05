<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { LicenseProfile, PortalSlot } from '@srdi/shared'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ApiError, api, errorText } from '@/api'
import { goto } from '@/router'
import { useAssessment } from '@/composables/useAssessment'
import MaterialSlot from '@/components/portal/MaterialSlot.vue'
import LicenseBanner from '@/components/portal/LicenseBanner.vue'
import HistoryList from '@/components/portal/HistoryList.vue'

const slots = ref<PortalSlot[]>([])
const passLine = ref<number | null>(null)
const loading = ref(true)
const loadError = ref('')

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 6 }, (_, index) => currentYear - index)

const form = reactive({
  name: '',
  phone: '',
  endYear: currentYear - 1,
  inventionCount: 0,
  layoutDesignCount: 0,
  softCopyrightCount: 0,
  utilityModelCount: 0,
  designPatentCount: 0,
  selfDevelopedI: true,
  highValueI: false
})

const files = reactive<Record<string, File[]>>({})
const licenseStatus = ref<'idle' | 'busy' | 'done' | 'failed'>('idle')
const licenseProfile = ref<LicenseProfile | null>(null)
const licenseError = ref('')

const licenseSlot = computed(() => slots.value.find((slot) => slot.id === 'license') ?? null)
const materialSlots = computed(() => slots.value.filter((slot) => slot.id !== 'license'))
const slotMeta = reactive<Record<string, { docType: string; referenceOnly: boolean }>>({})
const { phase, uploaded, total, message, error, start } = useAssessment()

const busy = computed(() => ['creating', 'uploading', 'starting'].includes(phase.value))
const period = computed(() => ({
  y0: form.endYear,
  y1: form.endYear - 1,
  y2: form.endYear - 2
}))

const fileCount = computed(() =>
  Object.values(files).reduce((sum, list) => sum + (list?.length ?? 0), 0)
)

const load = async () => {
  loading.value = true
  try {
    const response = await api.portalConfig()
    slots.value = response.config.slots
    passLine.value = response.config.passLine
    for (const slot of response.config.slots) files[slot.id] = []
  } catch (err) {
    loadError.value = errorText(err)
  } finally {
    loading.value = false
  }
}

const pickLicense = async (file: File) => {
  if (file.size > 10 * 1024 * 1024) {
    licenseStatus.value = 'failed'
    licenseError.value = '营业执照照片不能超过 10MB，压缩后再传。'
    return
  }
  files.license = [file]
  licenseStatus.value = 'busy'
  licenseError.value = ''
  try {
    licenseProfile.value = await api.portalRecognize(file)
    licenseStatus.value = 'done'
  } catch (err) {
    licenseStatus.value = 'failed'
    licenseError.value =
      err instanceof ApiError ? errorText(err) : '识别服务暂时不可用，可以重传，也可以直接手动填写。'
    if (!(err instanceof ApiError)) console.error(err)
  }
}

const retryLicense = () => {
  licenseStatus.value = 'idle'
  licenseProfile.value = null
  licenseError.value = ''
  files.license = []
}

const validate = () => {
  if (!form.name.trim()) return '请填写企业名称'
  const phone = form.phone.replace(/[\s-]/g, '')
  if (!phone) return '请填写联系手机，换设备时靠它找回报告'
  if (!/^\d{6,20}$/.test(phone)) return '联系电话应为 6 至 20 位数字'
  return ''
}

const submit = async () => {
  if (busy.value) return
  const invalid = validate()
  if (invalid) {
    ElMessage.warning(invalid)
    return
  }

  const financeFiles = files.finance?.length ?? 0
  const taxFiles = files.tax?.length ?? 0
  if (financeFiles === 0 || taxFiles === 0) {
    const missing = [financeFiles === 0 ? '财务报表' : '', taxFiles === 0 ? '所得税年报' : '']
      .filter(Boolean)
      .join('、')
    try {
      await ElMessageBox.confirm(
        `没有上传${missing}，评估结果参考价值会明显偏低。仍要继续吗？`,
        '材料不完整',
        { confirmButtonText: '仍要继续', cancelButtonText: '回去补传', type: 'warning' }
      )
    } catch {
      return
    }
  }

  const outcome = await start({
    company: {
      name: form.name.trim(),
      phone: form.phone.replace(/[\s-]/g, ''),
      inventionCount: Number(form.inventionCount) || 0,
      layoutDesignCount: Number(form.layoutDesignCount) || 0,
      softCopyrightCount: Number(form.softCopyrightCount) || 0,
      utilityModelCount: Number(form.utilityModelCount) || 0,
      designPatentCount: Number(form.designPatentCount) || 0,
      selfDevelopedI: form.selfDevelopedI,
      highValueI: form.highValueI
    },
    period: period.value,
    slots: slots.value.map((slot) => ({
      slot: slot.id,
      files: files[slot.id] ?? [],
      docType: slotMeta[slot.id]?.docType || slot.docType || undefined,
      referenceOnly: slotMeta[slot.id]?.referenceOnly === true
    }))
  })

  if (outcome) {
    goto(`/assess/${outcome.jobId}?p=${outcome.projectId}`)
  } else if (error.value) {
    ElMessage.error(error.value)
  }
}

onMounted(load)
</script>

<template>
  <div class="home" v-loading="loading">
    <header class="hero">
      <h1>专精特新自评，一次讲清楚</h1>
      <p>
        填企业信息、传几份材料，系统会自动识别财务数据并给出参考得分，
        同时列出距离 {{ passLine ?? '—' }} 分参考线还差什么、怎么补。
      </p>
    </header>

    <p v-if="loadError" class="banner">{{ loadError }}</p>

    <HistoryList />

    <LicenseBanner
      v-if="licenseSlot"
      :status="licenseStatus"
      :profile="licenseProfile"
      :error="licenseError"
      @select="pickLicense"
      @retry="retryLicense"
    />

    <section class="card">
      <div class="card-head">
        <h2>企业信息</h2>
        <span class="tip">带 * 为必填，其余可跳过</span>
      </div>

      <div class="grid">
        <label class="field wide">
          <span>企业名称 *</span>
          <el-input v-model="form.name" placeholder="营业执照上的完整名称" maxlength="80" />
        </label>
        <label class="field">
          <span>联系手机 *</span>
          <el-input v-model="form.phone" placeholder="用于换设备后找回报告" maxlength="20" />
        </label>
        <label class="field">
          <span>统计截止年</span>
          <el-select v-model="form.endYear" style="width: 100%">
            <el-option v-for="year in years" :key="year" :label="`${year} 年`" :value="year" />
          </el-select>
        </label>
      </div>

      <div class="period">
        统计期间 {{ period.y2 }}–{{ period.y0 }}（向前取三年）
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>知识产权</h2>
        <span class="tip">只填数量，不用传证书</span>
      </div>

      <div class="group">Ⅰ 类（核心，须与主导产品相关）</div>
      <div class="grid">
        <label class="field">
          <span>发明专利（含国防专利）</span>
          <el-input-number v-model="form.inventionCount" :min="0" :max="999" controls-position="right" />
        </label>
        <label class="field">
          <span>集成电路布图设计专有权</span>
          <el-input-number
            v-model="form.layoutDesignCount"
            :min="0"
            :max="999"
            controls-position="right"
          />
        </label>
        <div class="check">
          <el-checkbox v-model="form.selfDevelopedI">
            含自主研发（自主申请，非受让取得）
          </el-checkbox>
        </div>
        <div class="check">
          <el-checkbox v-model="form.highValueI">
            含高价值（海外同族 / 维持超过 10 年 / 大额质押融资 / 国家科技奖或中国专利奖）
          </el-checkbox>
        </div>
      </div>

      <div class="group">Ⅱ 类（仅在无 Ⅰ 类时兜底 2 分）</div>
      <div class="grid three">
        <label class="field">
          <span>软件著作权</span>
          <el-input-number
            v-model="form.softCopyrightCount"
            :min="0"
            :max="999"
            controls-position="right"
          />
        </label>
        <label class="field">
          <span>实用新型（授权满 2 年）</span>
          <el-input-number
            v-model="form.utilityModelCount"
            :min="0"
            :max="999"
            controls-position="right"
          />
        </label>
        <label class="field">
          <span>外观设计（授权满 2 年）</span>
          <el-input-number
            v-model="form.designPatentCount"
            :min="0"
            :max="999"
            controls-position="right"
          />
        </label>
      </div>

      <p class="note">
        按官方口径就高选一档：高价值 Ⅰ 类 10 分 / 自主研发 Ⅰ 类 8 分 / Ⅰ 类 6 分 / 仅 Ⅱ 类 2
        分，不叠加。商标不计入，转让未满 1 年的不计入。
      </p>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>上传材料</h2>
        <span class="tip">缺几份也能出分，只是那部分会按中性值估算</span>
      </div>
      <div class="slots">
        <MaterialSlot
          v-for="slot in materialSlots"
          :key="slot.id"
          :slot="slot"
          :files="files[slot.id] ?? []"
          :doc-type="slotMeta[slot.id]?.docType"
          :reference-only="slotMeta[slot.id]?.referenceOnly"
          @update:files="(next) => (files[slot.id] = next)"
          @update:doc-type="(value) => (slotMeta[slot.id] = { docType: value, referenceOnly: slotMeta[slot.id]?.referenceOnly === true })"
          @update:reference-only="(value) => (slotMeta[slot.id] = { docType: slotMeta[slot.id]?.docType ?? '', referenceOnly: value })"
        />
      </div>
    </section>

    <div v-if="busy" class="progress">
      <div class="bar">
        <div class="fill" :style="{ width: `${total > 0 ? (uploaded / total) * 100 : 0}%` }" />
      </div>
      <span>{{ message }}（{{ uploaded }}/{{ total }}）</span>
    </div>

    <footer class="actions">
      <div class="summary">
        已选 {{ fileCount }} 份材料 · 统计期间 {{ period.y2 }}–{{ period.y0 }}
      </div>
      <el-button class="btn-cta" type="primary" :loading="busy" @click="submit">
        {{ busy ? '处理中' : '开始评估' }}
        <svg
          v-if="!busy"
          class="arrow"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M5 12h13" />
          <path d="M12 6l6 6-6 6" />
        </svg>
      </el-button>
    </footer>
  </div>
</template>

<style scoped>
.home {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero {
  padding: 6px 2px 2px;
}

.hero h1 {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 0.4px;
  color: #0f172a;
}

.hero p {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.8;
  color: #64748b;
}

.banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12.5px;
}

.card {
  padding: 20px 22px 18px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e8eef6;
  box-shadow: 0 16px 40px -34px rgba(15, 23, 42, 0.6);
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.card-head h2 {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.tip {
  font-size: 11.5px;
  color: #a3adbb;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px 18px;
}

.grid.three {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.group {
  margin: 2px 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #384152;
}

.group + .grid {
  margin-bottom: 16px;
}

.check {
  grid-column: span 2;
  font-size: 12.5px;
  color: #5b6474;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field.wide {
  grid-column: span 2;
}

.field > span {
  font-size: 12.5px;
  color: #5b6474;
}

.note {
  margin-top: 14px;
  font-size: 11.5px;
  line-height: 1.7;
  color: #94a3b8;
}

.period {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #eef2f7;
  font-size: 11.5px;
  color: #a3adbb;
}

.slots {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.progress {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 12px;
  background: #f5f9ff;
  font-size: 12px;
  color: #2563eb;
}

.progress .bar {
  flex: 1;
  height: 6px;
  border-radius: 4px;
  background: #dbeafe;
  overflow: hidden;
}

.progress .fill {
  height: 100%;
  border-radius: 4px;
  background: #2563eb;
  transition: width 0.2s ease;
}

.actions {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 20px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #e8eef6;
  backdrop-filter: blur(8px);
  box-shadow: 0 -8px 30px -24px rgba(15, 23, 42, 0.8);
}

.summary {
  font-size: 12.5px;
  color: #64748b;
}

.btn-cta {
  min-width: 150px;
  padding: 0 22px;
  flex-shrink: 0;
}

.btn-cta svg {
  width: 15px;
  height: 15px;
}
</style>
