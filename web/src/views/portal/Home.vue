<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import type { PortalSlot } from '@srdi/shared'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, errorText } from '@/api'
import { goto } from '@/router'
import { useAssessment } from '@/composables/useAssessment'
import MaterialSlot from '@/components/portal/MaterialSlot.vue'
import HistoryList from '@/components/portal/HistoryList.vue'

const slots = ref<PortalSlot[]>([])
const passLine = ref(60)
const loading = ref(true)
const loadError = ref('')

const currentYear = new Date().getFullYear()
const years = Array.from({ length: 6 }, (_, index) => currentYear - index)

const form = reactive({
  name: '',
  creditCode: '',
  phone: '',
  endYear: currentYear - 1,
  inventionCount: 0,
  softCopyrightCount: 0
})

const files = reactive<Record<string, File[]>>({})
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

const validate = () => {
  if (!form.name.trim()) return '请填写企业名称'
  const creditCode = form.creditCode.trim()
  if (creditCode && !/^[0-9A-Za-z]{18}$/.test(creditCode)) {
    return '统一社会信用代码应为 18 位数字或字母，不填也可以'
  }
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
      creditCode: form.creditCode.trim().toUpperCase(),
      phone: form.phone.replace(/[\s-]/g, ''),
      inventionCount: Number(form.inventionCount) || 0,
      softCopyrightCount: Number(form.softCopyrightCount) || 0
    },
    period: period.value,
    slots: slots.value.map((slot) => ({ slot: slot.id, files: files[slot.id] ?? [] }))
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
        同时列出距离 {{ passLine }} 分参考线还差什么、怎么补。
      </p>
    </header>

    <p v-if="loadError" class="banner">{{ loadError }}</p>

    <HistoryList />

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
        <label class="field wide">
          <span>统一社会信用代码</span>
          <el-input
            v-model="form.creditCode"
            placeholder="选填，18 位数字或字母；填了会印在报告抬头"
            maxlength="18"
            style="text-transform: uppercase"
          />
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
      <div class="grid">
        <label class="field">
          <span>近三年获得发明专利数</span>
          <el-input-number v-model="form.inventionCount" :min="0" :max="999" controls-position="right" />
        </label>
        <label class="field">
          <span>软件著作权数量</span>
          <el-input-number v-model="form.softCopyrightCount" :min="0" :max="999" controls-position="right" />
        </label>
        <p class="note">
          软件著作权按 3 件折算 1 件发明专利计入评分（最多折算 3 件），报告中会标注为参考折算。
        </p>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <h2>上传材料</h2>
        <span class="tip">缺几份也能出分，只是那部分会按中性值估算</span>
      </div>
      <div class="slots">
        <MaterialSlot
          v-for="slot in slots"
          :key="slot.id"
          :slot="slot"
          :files="files[slot.id] ?? []"
          @update:files="(next) => (files[slot.id] = next)"
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
      <el-button type="primary" size="large" :loading="busy" @click="submit">
        {{ busy ? '处理中' : '开始评估' }}
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
  grid-column: span 2;
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
</style>
