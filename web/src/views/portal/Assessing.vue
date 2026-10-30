<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { JobProgressEvent } from '@srdi/shared'
import { api, errorText } from '@/api'
import { goto } from '@/router'

const props = defineProps<{ jobId: string; projectId?: string }>()

const STEPS = [
  { key: 'parsing', label: '解析材料', hint: '把 PDF / 表格拆成可读的页' },
  { key: 'extracting', label: '识别字段', hint: '读取营收、研发费用、人员等' },
  { key: 'confirming', label: '汇总数据', hint: '把三年数据对齐到统计期间' },
  { key: 'scoring', label: '计算得分', hint: '按 23 项指标逐项打分' }
]

const job = ref<(JobProgressEvent & { error?: string }) | null>(null)
const queueAhead = ref(0)
const failure = ref('')
const elapsed = ref(0)
let timer: number | null = null
let ticker: number | null = null

const stageIndex = computed(() => {
  const stage = job.value?.stage ?? 'queued'
  const index = STEPS.findIndex((step) => step.key === stage)
  if (stage === 'done') return STEPS.length
  return index < 0 ? 0 : index
})

const pct = computed(() => Math.max(2, Math.min(100, job.value?.pct ?? 0)))

const elapsedText = computed(() => {
  const seconds = Math.floor(elapsed.value / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

const stop = () => {
  if (timer !== null) window.clearTimeout(timer)
  if (ticker !== null) window.clearInterval(ticker)
  timer = null
  ticker = null
}

const poll = async () => {
  try {
    const response = await api.portalJob(props.jobId)
    job.value = response.job
    queueAhead.value = response.job.queueAhead ?? 0

    if (response.job.stage === 'done') {
      stop()
      if (props.projectId) {
        goto(`/r/${props.projectId}`)
      } else {
        failure.value = '评估已完成，但缺少项目编号，请回首页重新进入'
      }
      return
    }

    if (response.job.stage === 'failed') {
      stop()
      failure.value = response.job.error ?? '评估未完成，请检查材料后重试'
      return
    }

    timer = window.setTimeout(poll, 1200)
  } catch (err) {
    stop()
    failure.value = errorText(err)
  }
}

onMounted(() => {
  void poll()
  ticker = window.setInterval(() => {
    elapsed.value += 1000
  }, 1000)
})

onBeforeUnmount(stop)
</script>

<template>
  <div class="assessing">
    <template v-if="!failure">
      <div class="head">
        <h1>正在评估</h1>
        <p>大约需要 1-3 分钟。财务年报和所得税表通常要逐页识别，请不要关闭页面。</p>
      </div>

      <div class="panel">
        <div class="meter">
          <div class="meter-fill" :style="{ width: `${pct}%` }" />
        </div>
        <div class="meter-foot">
          <span>{{ job?.message ?? '排队中' }}</span>
          <span>{{ pct }}% · 已用时 {{ elapsedText }}</span>
        </div>
        <p v-if="queueAhead > 0" class="queue">前面还有 {{ queueAhead }} 份材料在排队</p>
      </div>

      <ol class="steps">
        <li
          v-for="(step, index) in STEPS"
          :key="step.key"
          :class="{ done: index < stageIndex, now: index === stageIndex }"
        >
          <span class="dot">{{ index < stageIndex ? '✓' : index + 1 }}</span>
          <div class="step-text">
            <b>{{ step.label }}</b>
            <em>{{ step.hint }}</em>
          </div>
        </li>
      </ol>
    </template>

    <template v-else>
      <div class="failed">
        <h1>评估没有跑完</h1>
        <p class="reason">{{ failure }}</p>
        <p class="hint">常见原因：材料是加密 PDF、扫描件过于模糊、或模型接口暂时不可用。</p>
        <div class="ops">
          <el-button type="primary" @click="goto('/')">重新提交</el-button>
          <el-button v-if="projectId" @click="goto(`/r/${projectId}`)">看看已有的结果</el-button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.assessing {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding-top: 40px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.head h1 {
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
}

.head p {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.8;
  color: #64748b;
}

.panel {
  padding: 20px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e8eef6;
  box-shadow: 0 16px 40px -34px rgba(15, 23, 42, 0.6);
}

.meter {
  height: 8px;
  border-radius: 5px;
  background: #eef2f7;
  overflow: hidden;
}

.meter-fill {
  height: 100%;
  border-radius: 5px;
  background: linear-gradient(90deg, #2563eb, #0ea5e9);
  transition: width 0.4s ease;
}

.meter-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  font-size: 12px;
  color: #64748b;
}

.queue {
  margin-top: 8px;
  font-size: 11.5px;
  color: #b45309;
}

.steps {
  margin: 0;
  padding: 0 4px;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.steps li {
  display: flex;
  align-items: center;
  gap: 12px;
  opacity: 0.45;
  transition: opacity 0.2s ease;
}

.steps li.now,
.steps li.done {
  opacity: 1;
}

.dot {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: 12px;
  color: #94a3b8;
  background: #f1f5f9;
  border: 1px solid #e2e8f0;
}

.steps li.now .dot {
  color: #fff;
  background: #2563eb;
  border-color: #2563eb;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.12);
}

.steps li.done .dot {
  color: #15803d;
  background: #ecfdf5;
  border-color: #bbf7d0;
}

.step-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-text b {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
}

.step-text em {
  font-style: normal;
  font-size: 11.5px;
  color: #a3adbb;
}

.failed {
  padding: 32px 28px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #fecaca;
}

.failed h1 {
  font-size: 20px;
  color: #b91c1c;
}

.reason {
  margin-top: 12px;
  font-size: 13px;
  color: #7f1d1d;
  line-height: 1.8;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  color: #94a3b8;
}

.ops {
  margin-top: 22px;
  display: flex;
  gap: 10px;
}
</style>
