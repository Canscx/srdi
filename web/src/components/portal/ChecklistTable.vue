<script setup lang="ts">
import { computed } from 'vue'
import type { PortalCheck, PortalMark } from '@srdi/shared'

const props = defineProps<{ checks: PortalCheck[] }>()

const MARK: Record<PortalMark, { icon: string; text: string; cls: string }> = {
  pass: { icon: '✅', text: '符合要求', cls: 'pass' },
  missing: { icon: '⭕', text: '材料缺失', cls: 'missing' },
  gap: { icon: '❌', text: '需要补足', cls: 'gap' }
}

const groups = computed(() => {
  const order: string[] = []
  const map = new Map<string, { name: string; items: PortalCheck[] }>()
  for (const item of props.checks) {
    if (!map.has(item.dimensionId)) {
      map.set(item.dimensionId, { name: item.dimensionName, items: [] })
      order.push(item.dimensionId)
    }
    map.get(item.dimensionId)?.items.push(item)
  }
  return order.map((id) => ({ id, ...map.get(id)! }))
})
</script>

<template>
  <div class="checklist">
    <div v-for="group in groups" :key="group.id" class="group">
      <div class="group-head">
        <span class="group-name">{{ group.name }}</span>
        <span class="group-count">
          符合 {{ group.items.filter((item) => item.mark === 'pass').length }} ·
          待补 {{ group.items.filter((item) => item.mark !== 'pass').length }}
        </span>
      </div>

      <ul>
        <li v-for="item in group.items" :key="item.id" :class="MARK[item.mark].cls">
          <span class="mark">{{ MARK[item.mark].icon }}</span>
          <span class="text">{{ item.text }}</span>
          <span v-if="item.mark !== 'missing'" class="rate">
            {{ ((item.score ?? 0) * 100).toFixed(0) }}%
          </span>
          <span v-else class="rate dash">—</span>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.checklist {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.group-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 0 2px 7px;
  border-bottom: 1px solid #eef2f7;
  margin-bottom: 4px;
}

.group-name {
  font-size: 13px;
  font-weight: 600;
  color: #111827;
}

.group-count {
  font-size: 11.5px;
  color: #a3adbb;
}

ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

li {
  display: grid;
  grid-template-columns: 22px 1fr 48px;
  align-items: start;
  gap: 8px;
  padding: 7px 2px;
  font-size: 12.5px;
  color: #475569;
  border-bottom: 1px dashed #f1f5f9;
}

li:last-child {
  border-bottom: none;
}

.mark {
  font-size: 13px;
  line-height: 1.3;
}

.text {
  line-height: 1.6;
}

.rate {
  text-align: right;
  font-size: 11.5px;
  color: #94a3b8;
}

.rate.dash {
  color: #cbd5e1;
}

li.pass .text {
  color: #334155;
}

li.gap .rate {
  color: #b45309;
}

li.missing .text {
  color: #8a94a6;
}
</style>
