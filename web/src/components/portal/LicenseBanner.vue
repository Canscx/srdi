<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LicenseProfile } from '@srdi/shared'

const props = defineProps<{
  status: 'idle' | 'busy' | 'done' | 'failed'
  profile: LicenseProfile | null
  error: string
}>()

const emit = defineEmits<{
  select: [File]
  retry: []
}>()

const ACCEPT = '.pdf,.jpg,.jpeg,.png'

const input = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const expanded = ref(false)

const open = () => {
  if (props.status === 'busy') return
  input.value?.click()
}

const hand = (file: File | undefined) => {
  if (!file) return
  emit('select', file)
}

const onPick = (event: Event) => {
  const target = event.target as HTMLInputElement
  hand(target.files?.[0])
  target.value = ''
}

const onDrop = (event: DragEvent) => {
  dragging.value = false
  hand(event.dataTransfer?.files?.[0])
}

const capital = computed(() => {
  const value = props.profile?.registeredCapital
  if (typeof value !== 'number' || value <= 0) return ''
  if (value >= 100000000) return `${(value / 100000000).toFixed(2).replace(/\.?0+$/, '')} 亿元`
  if (value >= 10000) return `${(value / 10000).toFixed(2).replace(/\.?0+$/, '')} 万元`
  return `${value} 元`
})

const scope = computed(() => props.profile?.businessScope ?? '')
const established = computed(() => props.profile?.establishedDate ?? '')
const empty = computed(
  () => props.status === 'done' && !scope.value && !capital.value && !established.value
)

const facts = computed(() => {
  const registry = [
    capital.value ? `注册资本 ${capital.value}` : '',
    established.value ? `成立 ${established.value}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
  return registry ? [{ label: '工商登记', value: registry }] : []
})
</script>

<template>
  <div
    class="license"
    :class="[status, { dragging }]"
    role="button"
    tabindex="0"
    @click="status === 'done' || status === 'failed' ? undefined : open()"
    @keydown.enter="open"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="input" type="file" :accept="ACCEPT" hidden @change="onPick" />

    <div class="mark">
      <svg v-if="status === 'idle' || status === 'busy'" viewBox="0 0 24 24" width="22" height="22">
        <path
          d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linejoin="round"
        />
        <path d="M14 3v5h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" />
        <path d="M7.5 13h9M7.5 16.5h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
      </svg>
      <svg v-else-if="status === 'done' && !empty" viewBox="0 0 24 24" width="22" height="22">
        <path
          d="m4.5 12.5 5 5 10-10"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <svg v-else viewBox="0 0 24 24" width="22" height="22">
        <path d="M12 7v7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        <circle cx="12" cy="17.4" r="1.3" fill="currentColor" />
      </svg>
    </div>

    <div class="body">
      <template v-if="status === 'idle'">
        <p class="title">上传营业执照，报告信息更完整</p>
        <p class="hint">支持 JPG / PNG / PDF，约 10 秒读出经营范围、注册资本和成立日期；不传也能出分。</p>
      </template>

      <template v-else-if="status === 'busy'">
        <p class="title"><span class="spin" />正在识别营业执照…</p>
        <p class="hint">通常在 10 秒内完成，请不要关闭页面。</p>
      </template>

      <template v-else-if="status === 'done' && !empty">
        <p class="title">已识别，报告里会带上这些信息</p>
        <div class="facts">
          <span v-for="item in facts" :key="item.label">
            <em>{{ item.label }}</em>
            {{ item.value }}
          </span>
        </div>
        <p v-if="scope" class="scope" :class="{ open: expanded }" @click.stop="expanded = !expanded">
          <em>经营范围</em>{{ scope }}
        </p>
        <p v-else class="hint">没读到经营范围，可以重传一张更清晰的照片。</p>
      </template>

      <template v-else-if="status === 'failed'">
        <p class="title">这张没读出来</p>
        <p class="hint">{{ error || '可能拍歪了或光线太暗，可以重传，也可以直接手动填写。' }}</p>
      </template>

      <template v-else>
        <p class="title">这份材料里没找到可用的企业信息</p>
        <p class="hint">确认上传的是营业执照；也可以直接手动填写，不影响出报告。</p>
      </template>
    </div>

    <div class="act">
      <button v-if="status === 'idle' || status === 'busy'" class="btn" type="button" :disabled="status === 'busy'" @click.stop="open">
        {{ status === 'busy' ? '识别中' : '上传营业执照' }}
      </button>
      <button v-else class="btn ghost" type="button" @click.stop="emit('retry')">重传</button>
    </div>
  </div>
</template>

<style scoped>
.license {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 96px;
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px dashed #bfdbfe;
  background: linear-gradient(180deg, #f7fbff, #fff);
  cursor: pointer;
  transition: border-color 0.18s, background 0.18s, box-shadow 0.18s;
}

.license.idle:hover,
.license.dragging {
  border-color: #2563eb;
  background: #f2f8ff;
  box-shadow: 0 12px 28px -24px rgba(37, 99, 235, 0.9);
}

.license.busy {
  cursor: progress;
  border-style: solid;
  border-color: #bfdbfe;
}

.license.done {
  cursor: default;
  border-style: solid;
  border-color: #bbf7d0;
  background: #f6fef9;
}

.license.failed {
  cursor: default;
  border-style: solid;
  border-color: #fed7aa;
  background: #fffbf5;
}

.mark {
  flex: 0 0 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: #e8f1ff;
  color: #2563eb;
}

.done .mark {
  background: #dcfce7;
  color: #16a34a;
}

.failed .mark {
  background: #ffedd5;
  color: #d97706;
}

.body {
  flex: 1;
  min-width: 0;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: #0f172a;
  display: flex;
  align-items: center;
  gap: 8px;
}

.hint {
  margin-top: 4px;
  font-size: 12.5px;
  color: #64748b;
}

.facts {
  margin-top: 6px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  font-size: 12.5px;
  color: #334155;
}

.facts em,
.scope em {
  font-style: normal;
  color: #94a3b8;
  margin-right: 6px;
}

.scope {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.7;
  color: #475569;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  cursor: pointer;
}

.scope.open {
  -webkit-line-clamp: unset;
}

.act {
  flex: 0 0 auto;
}

.btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid #2563eb;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: opacity 0.18s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: progress;
}

.btn.ghost {
  background: #fff;
  color: #2563eb;
}

.spin {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  border: 2px solid #bfdbfe;
  border-top-color: #2563eb;
  animation: turn 0.8s linear infinite;
}

@keyframes turn {
  to {
    transform: rotate(360deg);
  }
}
</style>
