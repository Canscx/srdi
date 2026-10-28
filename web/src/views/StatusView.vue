<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { HealthResponse } from '@srdi/shared'

type StreamState = 'idle' | 'connecting' | 'open' | 'error'

interface LogLine {
  time: string
  name: string
  payload: string
}

const health = ref<HealthResponse | null>(null)
const healthError = ref('')
const probing = ref(false)
const streamState = ref<StreamState>('idle')
const logLines = ref<LogLine[]>([])

let stream: EventSource | null = null

const stateLabel = computed(() => {
  const map: Record<StreamState, string> = {
    idle: '未连接',
    connecting: '连接中',
    open: '通道已建立',
    error: '连接中断'
  }
  return map[streamState.value]
})

const indicators = computed(() => health.value?.rules?.indicators ?? '—')
const gates = computed(() => health.value?.rules?.gates ?? '—')
const dimensions = computed(() => health.value?.rules?.dimensions ?? '—')
const port = computed(() => health.value?.runtime.port ?? 8787)
const nodeVersion = computed(() => health.value?.runtime.node ?? '—')

const rows = computed(() => {
  if (!health.value) return []
  return [
    { k: '服务标识', v: health.value.service },
    { k: '版本 / 阶段', v: `${health.value.version} · ${health.value.stage}` },
    { k: '规则包', v: health.value.rules ? `${health.value.rules.id}` : '未加载' },
    { k: '规则生效日', v: health.value.rules?.effectiveFrom ?? '—' },
    { k: '门槛 / 维度 / 指标', v: `${gates.value} / ${dimensions.value} / ${indicators.value}` },
    { k: 'Node / PID', v: `${health.value.runtime.node} / ${health.value.runtime.pid}` },
    { k: '已运行', v: `${health.value.runtime.uptimeSec}s · 端口 ${health.value.runtime.port}` },
    { k: '服务器时间', v: new Date(health.value.time).toLocaleString('zh-CN', { hour12: false }) }
  ]
})

const steps = [
  { id: '01', title: '脚手架 + 最小可运行服务', desc: '三包 workspace / 静态托管 / health / SSE', state: 'done' },
  { id: '02', title: '打分引擎 + golden', desc: '23 指标 / 6 门槛 / 三口径 / 三家企业快照', state: 'done' },
  { id: '03', title: '存储 + 上传 + 判型', desc: '原子写 / sha256 去重 / 只读字节判型', state: 'done' },
  { id: '04', title: '解析链路 + 队列', desc: 'PDF 双通道 / DOCX / XLSX / 图片', state: 'done' },
  { id: '05', title: '四类 docType 抽取', desc: '四层 prompt / 字段子集 / 五级校验', state: 'done' },
  { id: '06', title: '确认页', desc: '字段行 / 页图对照 / 冲突二选一', state: 'done' },
  { id: '07', title: '评分页', desc: '雷达图 / 23 项表 / 门槛表 / 三口径', state: 'done' },
  { id: '08', title: '报告导出', desc: 'Markdown / PDF 双格式 / 数字白名单', state: 'done' }
]

const doneSteps = steps.filter((step) => step.state === 'done').length

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false })

const pushLog = (name: string, payload: string) => {
  logLines.value = [{ time: stamp(), name, payload }, ...logLines.value].slice(0, 8)
}

const loadHealth = async () => {
  probing.value = true
  healthError.value = ''
  try {
    const res = await fetch('/api/health')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    health.value = (await res.json()) as HealthResponse
  } catch (err) {
    health.value = null
    healthError.value = err instanceof Error ? err.message : '探测失败'
  } finally {
    probing.value = false
  }
}

const disconnect = () => {
  if (stream) {
    stream.close()
    stream = null
  }
  streamState.value = 'idle'
}

const connect = () => {
  disconnect()
  streamState.value = 'connecting'
  const source = new EventSource('/api/jobs/demo/stream')
  stream = source

  source.onopen = () => {
    streamState.value = 'open'
    pushLog('open', '/api/jobs/demo/stream')
  }

  source.addEventListener('snapshot', (event) => {
    pushLog('snapshot', (event as MessageEvent<string>).data)
  })

  source.addEventListener('progress', (event) => {
    pushLog('progress', (event as MessageEvent<string>).data)
  })

  source.onerror = () => {
    streamState.value = 'error'
    pushLog('error', '浏览器将在 3s 后自动重连')
  }
}

onMounted(() => {
  loadHealth()
  connect()
})

onBeforeUnmount(disconnect)
</script>

<template>
  <section class="view">
    <div class="grid grid-3">
      <article class="card stat">
        <span class="stat-label">工作区</span>
        <strong class="stat-value">3<small>个包</small></strong>
        <p class="stat-note">shared · server · web</p>
      </article>
      <article class="card stat">
        <span class="stat-label">规则包</span>
        <strong class="stat-value">{{ indicators }}<small>项指标</small></strong>
        <p class="stat-note">{{ gates }} 道门槛 · {{ dimensions }} 个维度</p>
      </article>
      <article class="card stat">
        <span class="stat-label">运行端口</span>
        <strong class="stat-value">{{ port }}</strong>
        <p class="stat-note">{{ nodeVersion }} · 静态托管 web/dist</p>
      </article>
    </div>

    <div class="grid grid-2">
      <article class="card panel">
        <header class="panel-head">
          <h2>健康检查</h2>
          <el-button size="small" :loading="probing" @click="loadHealth">重新探测</el-button>
        </header>

        <dl v-if="rows.length" class="kv">
          <div v-for="row in rows" :key="row.k" class="kv-row">
            <dt>{{ row.k }}</dt>
            <dd>{{ row.v }}</dd>
          </div>
        </dl>
        <p v-else class="empty">{{ healthError || '正在探测…' }}</p>

        <details class="raw">
          <summary>原始响应</summary>
          <pre>{{ JSON.stringify(health, null, 2) }}</pre>
        </details>
      </article>

      <article class="card panel">
        <header class="panel-head">
          <h2>SSE 进度通道</h2>
          <span class="stream-state">
            <span class="dot" :class="streamState"></span>
            {{ stateLabel }}
          </span>
        </header>

        <p class="endpoint"><code>GET /api/jobs/demo/stream</code></p>

        <div class="log">
          <p v-for="(line, index) in logLines" :key="`${line.time}-${index}`" class="log-line">
            <span class="log-time">{{ line.time }}</span>
            <span class="log-name">{{ line.name }}</span>
            <span class="log-payload">{{ line.payload }}</span>
          </p>
          <p v-if="!logLines.length" class="empty">等待事件…</p>
        </div>

        <p class="stream-note">心跳 15s · 断线自动重连 3s · 仅传输进度，不携带业务数据</p>

        <div class="actions">
          <el-button size="small" type="primary" plain :disabled="streamState === 'open'" @click="connect">
            连接
          </el-button>
          <el-button size="small" :disabled="streamState !== 'open'" @click="disconnect">断开</el-button>
        </div>
      </article>
    </div>

    <article class="card timeline">
      <header class="panel-head">
        <h2>第二阶段路线</h2>
        <span class="progress-note">{{ doneSteps }} / {{ steps.length }} 完成</span>
      </header>
      <ol class="steps">
        <li v-for="step in steps" :key="step.id" :class="step.state">
          <span class="idx">{{ step.id }}</span>
          <div class="step-body">
            <strong>{{ step.title }}</strong>
            <p>{{ step.desc }}</p>
          </div>
          <em>{{ step.state === 'done' ? '已完成' : '待开工' }}</em>
        </li>
      </ol>
    </article>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.grid {
  display: grid;
  gap: 16px;
}

.grid-3 {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.grid-2 {
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
}

.card {
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 16px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04), 0 12px 28px -24px rgba(16, 24, 40, 0.5);
}

.stat {
  padding: 20px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.stat-label {
  font-size: 12px;
  letter-spacing: 1.2px;
  color: #8a94a6;
}

.stat-value {
  font-size: 34px;
  line-height: 1.1;
  font-weight: 600;
  color: #111827;
  font-variant-numeric: tabular-nums;
}

.stat-value small {
  margin-left: 6px;
  font-size: 13px;
  font-weight: 500;
  color: #6b7280;
}

.stat-note {
  font-size: 12.5px;
  color: #98a2b3;
}

.panel {
  padding: 20px 22px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-height: 372px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h2 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

.kv {
  display: flex;
  flex-direction: column;
  gap: 0;
  border-top: 1px dashed #e8edf4;
}

.kv-row {
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr);
  gap: 12px;
  padding: 9px 0;
  border-bottom: 1px dashed #e8edf4;
  font-size: 13px;
}

.kv-row dt {
  color: #8a94a6;
}

.kv-row dd {
  margin: 0;
  color: #1f2937;
  font-variant-numeric: tabular-nums;
  word-break: break-all;
}

.raw {
  margin-top: auto;
  font-size: 12.5px;
  color: #6b7280;
}

.raw summary {
  cursor: pointer;
  user-select: none;
  color: #2563eb;
}

.raw pre {
  margin: 10px 0 0;
  max-height: 180px;
  overflow: auto;
  padding: 12px 14px;
  border-radius: 10px;
  background: #0f172a;
  color: #cbd5e1;
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 11.5px;
  line-height: 1.65;
}

.stream-state {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12.5px;
  color: #4b5563;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #cbd5e1;
}

.dot.connecting {
  background: #f59e0b;
  box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.16);
}

.dot.open {
  background: #10b981;
  box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.16);
}

.dot.error {
  background: #ef4444;
  box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.16);
}

.endpoint {
  font-size: 12.5px;
  color: #6b7280;
}

.log {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 12px;
  background: #f8fafc;
  border: 1px solid #edf1f7;
  overflow: auto;
  max-height: 216px;
}

.log-line {
  display: grid;
  grid-template-columns: 62px 68px minmax(0, 1fr);
  gap: 10px;
  align-items: baseline;
  font-size: 12px;
  line-height: 1.6;
}

.log-time {
  color: #94a3b8;
  font-variant-numeric: tabular-nums;
}

.log-name {
  color: #2563eb;
  font-weight: 600;
}

.log-payload {
  color: #334155;
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  word-break: break-all;
}

.empty {
  font-size: 12.5px;
  color: #9aa5b5;
  padding: 6px 0;
}

.stream-note {
  font-size: 11.5px;
  color: #a3adbb;
  letter-spacing: 0.2px;
}

.actions {
  display: flex;
  gap: 10px;
}

.timeline {
  padding: 20px 22px 22px;
}

.progress-note {
  font-size: 12.5px;
  color: #6b7280;
}

.steps {
  list-style: none;
  padding: 0;
  margin-top: 14px;
  display: grid;
  gap: 10px;
}

.steps li {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) 72px;
  gap: 14px;
  align-items: center;
  padding: 12px 14px;
  border-radius: 12px;
  background: #fbfcfe;
  border: 1px solid #eef2f7;
}

.steps li.done {
  background: linear-gradient(180deg, #f6fbf8, #fbfdfc);
  border-color: #d8efe4;
}

.idx {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 9px;
  background: #eef2f7;
  color: #64748b;
  font-size: 12px;
  font-weight: 600;
}

.steps li.done .idx {
  background: #d9f3e6;
  color: #047857;
}

.step-body strong {
  font-size: 13.5px;
  font-weight: 600;
}

.step-body p {
  margin-top: 3px;
  font-size: 12px;
  color: #94a3b8;
}

.steps em {
  font-style: normal;
  font-size: 12px;
  text-align: right;
  color: #a3adbb;
}

.steps li.done em {
  color: #059669;
}
</style>
