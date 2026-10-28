<script setup lang="ts">
import { STATUS_TEXT, STATUS_TYPE } from '@/format'
import type { FieldRow } from '@/types'

defineProps<{ row: FieldRow; active: boolean }>()
defineEmits<{ select: [key: string] }>()
</script>

<template>
  <button class="row" :class="{ active, [row.status]: true }" @click="$emit('select', row.key)">
    <span class="top">
      <span class="label">{{ row.label }}</span>
      <el-tag size="small" effect="plain" :type="STATUS_TYPE[row.status]">
        {{ STATUS_TEXT[row.status] }}
      </el-tag>
    </span>
    <span class="meta">
      <code>{{ row.key }}</code>
      <span v-if="row.count > 0" class="count" :class="{ conflict: row.conflict }">
        {{ row.conflict ? `${row.count} 条候选 · 冲突` : `${row.count} 条候选` }}
      </span>
    </span>
    <span v-if="row.preview" class="preview">{{ row.preview }}</span>
  </button>
</template>

<style scoped>
.row {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 9px 11px;
  border: 1px solid transparent;
  border-radius: 11px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.row:hover {
  background: #f6f9fe;
  border-color: #e3ebf6;
}

.row.active {
  background: #eff5ff;
  border-color: #bcd4fb;
  box-shadow: inset 3px 0 0 #2563eb;
}

.row.rejected .label {
  color: #9aa5b5;
  text-decoration: line-through;
}

.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #98a2b3;
}

.meta code {
  background: transparent;
  padding: 0;
  font-size: 11px;
  color: #a3adbb;
}

.count {
  color: #b7791f;
}

.count.conflict {
  color: #dc2626;
  font-weight: 600;
}

.preview {
  font-size: 12px;
  color: #4b5563;
  font-variant-numeric: tabular-nums;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
