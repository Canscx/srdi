<script setup lang="ts">
import { computed } from 'vue'
import type { CatalogFieldMeta, FieldCandidate } from '@srdi/shared'
import { confidenceTone, formatFieldValue } from '@/format'

const props = defineProps<{
  candidate: FieldCandidate
  field: CatalogFieldMeta
  index: number
  active: boolean
  fileName: string
}>()

defineEmits<{ focus: []; pick: [] }>()

const confidence = computed(() => props.candidate.confidence ?? 0)
const tone = computed(() => confidenceTone(props.candidate.confidence))
const valueText = computed(() => formatFieldValue(props.field, props.candidate.value))
const pickable = computed(
  () => props.candidate.value !== undefined && props.candidate.value !== null
)
const quoteState = computed(() => {
  const matched = props.candidate.source.quoteMatched
  if (matched === true) return 'ok'
  if (matched === false) return 'bad'
  return 'na'
})
</script>

<template>
  <article class="candidate" :class="{ active }" @click="$emit('focus')">
    <header class="head">
      <span class="index">候选 {{ index + 1 }}</span>
      <span class="conf" :class="tone">
        <span class="bar"><i :style="{ width: `${Math.round(confidence * 100)}%` }" /></span>
        {{ Math.round(confidence * 100) }}%
      </span>
    </header>

    <p class="value">
      {{ valueText || '—' }}
      <span v-if="field.unit && field.type !== 'money' && valueText" class="unit">{{ field.unit }}</span>
      <span v-if="candidate.period" class="period">{{ candidate.period }} 年</span>
    </p>

    <p v-if="candidate.raw" class="raw">{{ candidate.raw }}</p>

    <blockquote v-if="candidate.source.quote" class="quote">
      {{ candidate.source.quote }}
    </blockquote>

    <p v-if="quoteState === 'bad'" class="warn">
      原文未匹配：该摘录在页面文本中找不到，置信度已压至 0.5
    </p>
    <p v-else-if="quoteState === 'na'" class="na">
      图像通道：无文本层可比对，请直接核对页图
    </p>

    <footer class="foot">
      <span class="source">
        {{ fileName }} · 第 {{ candidate.source.page }} 页
        <em>{{ candidate.source.route === 'vision' ? '视觉' : '文本' }}</em>
      </span>
      <el-button
        size="small"
        type="primary"
        :disabled="!pickable"
        @click.stop="$emit('pick')"
      >
        采纳
      </el-button>
    </footer>
  </article>
</template>

<style scoped>
.candidate {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px 12px;
  border: 1px solid #e6ebf2;
  border-radius: 12px;
  background: #fff;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.candidate:hover {
  border-color: #c7d8f2;
}

.candidate.active {
  border-color: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.09);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.index {
  font-size: 11.5px;
  font-weight: 600;
  color: #64748b;
  letter-spacing: 0.3px;
}

.conf {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  color: #4b5563;
}

.bar {
  width: 46px;
  height: 4px;
  border-radius: 999px;
  background: #eef2f7;
  overflow: hidden;
}

.bar i {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: #94a3b8;
}

.conf.high .bar i {
  background: #10b981;
}

.conf.mid .bar i {
  background: #f59e0b;
}

.conf.low .bar i {
  background: #ef4444;
}

.value {
  font-size: 19px;
  font-weight: 600;
  color: #111827;
  font-variant-numeric: tabular-nums;
  line-height: 1.3;
}

.unit,
.period {
  margin-left: 7px;
  font-size: 11.5px;
  font-weight: 500;
  color: #8a94a6;
}

.raw {
  font-size: 12px;
  color: #6b7280;
}

.quote {
  margin: 0;
  padding: 7px 9px;
  border-left: 3px solid #c7d8f2;
  border-radius: 0 7px 7px 0;
  background: #f8fafc;
  font-size: 12px;
  line-height: 1.6;
  color: #334155;
  word-break: break-all;
}

.warn {
  font-size: 11.5px;
  color: #b45309;
  background: #fffbeb;
  border: 1px solid #fde68a;
  border-radius: 8px;
  padding: 5px 8px;
}

.na {
  font-size: 11.5px;
  color: #64748b;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding-top: 2px;
}

.source {
  font-size: 11.5px;
  color: #98a2b3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source em {
  margin-left: 5px;
  font-style: normal;
  padding: 0 5px;
  border-radius: 5px;
  background: #eef2f7;
  color: #64748b;
}
</style>
