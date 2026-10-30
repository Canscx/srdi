<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PortalHistoryItem } from '@srdi/shared'
import { api, errorText } from '@/api'
import { goto } from '@/router'
import LookupDialog from '@/components/portal/LookupDialog.vue'

const items = ref<PortalHistoryItem[]>([])
const loading = ref(true)
const error = ref('')
const dialog = ref(false)

const load = async () => {
  loading.value = true
  try {
    const response = await api.portalProjects()
    items.value = response.projects
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}

const fmt = (value: string) =>
  new Date(value).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })

onMounted(load)
</script>

<template>
  <section class="history" v-loading="loading">
    <div class="head">
      <h2>我的历史报告</h2>
      <button class="lookup" type="button" @click="dialog = true">查询其他报告</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="items.length > 0" class="grid">
      <button
        v-for="item in items"
        :key="item.projectId"
        type="button"
        class="item"
        @click="goto(`/r/${item.projectId}`)"
      >
        <div class="line">
          <b>{{ item.companyName }}</b>
          <span v-if="item.hasScore" class="score" :class="{ pass: item.passed }">
            {{ item.official }}
          </span>
          <span v-else class="score muted">未完成</span>
        </div>
        <div class="meta">
          <span>{{ item.period.y2 }}–{{ item.period.y0 }}</span>
          <span>{{ fmt(item.submittedAt) }}</span>
          <span v-if="item.hasScore">{{ item.passed ? '已达标' : '待补足' }}</span>
        </div>
      </button>
    </div>

    <p v-else-if="!loading" class="empty">
      还没有历史评估。换过设备或清过缓存？点右上角「查询其他报告」，用企业全称加手机号后四位找回。
    </p>

    <LookupDialog v-model="dialog" />
  </section>
</template>

<style scoped>
.history {
  padding: 16px 20px 18px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e8eef6;
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.head h2 {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.lookup {
  padding: 4px 10px;
  border: 1px solid #e8eef6;
  border-radius: 7px;
  background: #fff;
  color: #2563eb;
  font-size: 12px;
  cursor: pointer;
}

.lookup:hover {
  border-color: #bcd4fb;
  background: #f5f9ff;
}

.error {
  margin-top: 10px;
  font-size: 12px;
  color: #b91c1c;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.item {
  padding: 11px 14px;
  border: 1px solid #eef2f7;
  border-radius: 11px;
  background: #fcfdff;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
}

.item:hover {
  border-color: #bcd4fb;
  background: #f5f9ff;
  box-shadow: 0 10px 24px -22px rgba(37, 99, 235, 0.9);
}

.line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.line b {
  font-size: 13px;
  font-weight: 500;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.score {
  font-size: 15px;
  font-weight: 600;
  color: #b45309;
}

.score.pass {
  color: #15803d;
}

.score.muted {
  font-size: 11.5px;
  font-weight: 400;
  color: #a3adbb;
}

.meta {
  display: flex;
  gap: 10px;
  margin-top: 6px;
  font-size: 11px;
  color: #a3adbb;
}

.empty {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.7;
  color: #a3adbb;
}
</style>
