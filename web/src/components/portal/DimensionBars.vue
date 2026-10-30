<script setup lang="ts">
import type { PortalDimension } from '@srdi/shared'

defineProps<{ dimensions: PortalDimension[] }>()

const pct = (value: number, max: number) => (max > 0 ? Math.min(100, (value / max) * 100) : 0)
</script>

<template>
  <div class="bars">
    <div v-for="item in dimensions" :key="item.id" class="row">
      <div class="label">
        <span class="name">{{ item.name }}</span>
        <span class="weight">权重 {{ item.weight }}%</span>
      </div>
      <div class="track">
        <div class="fill" :style="{ width: `${pct(item.score, item.max)}%` }" />
        <div
          class="ghost"
          :style="{ width: `${Math.max(pct(item.score, item.max), pct(item.optimistic, item.max))}%` }"
        />
      </div>
      <div class="value">
        <b>{{ item.score.toFixed(1) }}</b>
        <span>/ {{ item.max.toFixed(1) }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bars {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.row {
  display: grid;
  grid-template-columns: 136px 1fr 104px;
  align-items: center;
  gap: 14px;
}

.label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.name {
  font-size: 13px;
  color: #111827;
  font-weight: 500;
}

.weight {
  font-size: 11px;
  color: #a3adbb;
}

.track {
  position: relative;
  height: 10px;
  border-radius: 6px;
  background: #eef2f7;
  overflow: hidden;
}

.ghost {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 6px;
  background: repeating-linear-gradient(
    90deg,
    rgba(14, 165, 233, 0.28) 0,
    rgba(14, 165, 233, 0.28) 5px,
    transparent 5px,
    transparent 9px
  );
}

.fill {
  position: absolute;
  inset: 0 auto 0 0;
  border-radius: 6px;
  background: linear-gradient(90deg, #2563eb, #3b82f6);
  z-index: 1;
}

.value {
  text-align: right;
  font-size: 11.5px;
  color: #94a3b8;
}

.value b {
  font-size: 14px;
  color: #111827;
  font-weight: 600;
  margin-right: 3px;
}
</style>
