<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, errorText, type SubmissionRow } from '@/api'
import { goto } from '@/router'

const rows = ref<SubmissionRow[]>([])
const passLine = ref(60)
const query = ref('')
const loading = ref(false)
const error = ref('')

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    const response = await api.adminSubmissions(query.value.trim())
    rows.value = response.items
    passLine.value = response.passLine
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}

const fixIndustry = async (row: SubmissionRow) => {
  try {
    const input = await ElMessageBox.prompt(
      `当前行业：${row.industryCode || '未识别'}。填 14 个基准行业代码之一，例如 I65（软件和信息技术服务业）。`,
      '修正行业基准',
      { inputValue: row.industryCode || 'I65', confirmButtonText: '重算', cancelButtonText: '取消' }
    )
    const code = (input.value ?? '').trim().toUpperCase()
    if (!code) return
    const result = await api.fixIndustry(row.projectId, code)
    ElMessage.success(`已按 ${result.industryName ?? code} 重算，当前 ${result.official} 分`)
    void load()
  } catch (err) {
    if (err === 'cancel' || err === 'close') return
    ElMessage.error(errorText(err))
  }
}

const fmt = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

onMounted(load)
</script>

<template>
  <section class="view">
    <header class="bar">
      <div>
        <h2>客户提交</h2>
        <p>所有通过客户入口提交的评估，按提交时间倒序。达标线 {{ passLine }} 分。</p>
      </div>
      <div class="search">
        <el-input
          v-model="query"
          placeholder="企业名称或信用代码"
          clearable
          style="width: 260px"
          @keyup.enter="load"
          @clear="load"
        />
        <el-button type="primary" @click="load">搜索</el-button>
      </div>
    </header>

    <p v-if="error" class="banner">{{ error }}</p>

    <el-table v-loading="loading" :data="rows" stripe style="width: 100%">
      <el-table-column prop="companyName" label="企业名称" min-width="200" show-overflow-tooltip />
      <el-table-column prop="creditCode" label="统一社会信用代码" width="180" />
      <el-table-column prop="phone" label="手机" width="120" />
      <el-table-column label="行业" width="110">
        <template #default="{ row }">
          <span>{{ row.industryCode || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column prop="fileCount" label="材料" width="70" />
      <el-table-column label="当前 / 补齐后" width="140">
        <template #default="{ row }">
          <span v-if="row.hasScore">{{ row.official }} / {{ row.optimistic }}</span>
          <span v-else class="muted">未评分</span>
        </template>
      </el-table-column>
      <el-table-column label="达标" width="90">
        <template #default="{ row }">
          <el-tag v-if="row.passed === true" type="success" size="small">已达标</el-tag>
          <el-tag v-else-if="row.passed === false" type="warning" size="small">待补足</el-tag>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="最大缺口" width="150">
        <template #default="{ row }">
          <span v-if="row.weakestDimension">{{ row.weakestDimension }} {{ row.weakestGap }}</span>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="提交时间" width="130">
        <template #default="{ row }">{{ fmt(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="230" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="goto(`/p/${row.projectId}/review`)">确认页</el-button>
          <el-button link type="primary" @click="goto(`/p/${row.projectId}/score`)">评分页</el-button>
          <el-button link @click="fixIndustry(row)">改行业</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="还没有客户提交" :image-size="80" />
      </template>
    </el-table>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.bar {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 18px 20px;
  background: #fff;
  border: 1px solid #e6ebf2;
  border-radius: 16px;
  box-shadow: 0 12px 28px -26px rgba(16, 24, 40, 0.5);
}

h2 {
  font-size: 16px;
  font-weight: 600;
}

.bar p {
  margin-top: 5px;
  font-size: 12.5px;
  color: #8a94a6;
}

.search {
  display: flex;
  gap: 10px;
}

.banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 12.5px;
}

.muted {
  color: #a3adbb;
  font-size: 12px;
}
</style>
