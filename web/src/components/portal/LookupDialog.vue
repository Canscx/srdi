<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import type { PortalHistoryItem } from '@srdi/shared'
import { api, errorText } from '@/api'
import { goto } from '@/router'

const visible = defineModel<boolean>({ default: false })

const companyName = ref('')
const phoneTail = ref('')
const error = ref('')
const loading = ref(false)
const results = ref<PortalHistoryItem[]>([])

const canSubmit = computed(
  () => companyName.value.trim().length > 0 && phoneTail.value.length === 4
)

watch(visible, (next) => {
  if (!next) return
  error.value = ''
  results.value = []
})

const onTailInput = (value: string) => {
  phoneTail.value = value.replace(/\D/g, '').slice(0, 4)
}

const open = (projectId: string) => {
  visible.value = false
  goto(`/r/${projectId}`)
}

const submit = async () => {
  if (loading.value || !canSubmit.value) return
  loading.value = true
  error.value = ''
  results.value = []
  try {
    const response = await api.portalLookup({
      companyName: companyName.value.trim(),
      phoneTail: phoneTail.value
    })
    if (response.projects.length === 1) {
      open(response.projects[0].projectId)
      return
    }
    results.value = response.projects
  } catch (err) {
    error.value = errorText(err)
    if (error.value.includes('429')) {
      ElMessage.warning('查询太频繁了，歇几分钟再试')
    }
  } finally {
    loading.value = false
  }
}

const fmt = (value: string) =>
  new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
</script>

<template>
  <el-dialog v-model="visible" title="找回历史报告" width="440px" append-to-body>
    <p class="lead">
      填企业营业执照上的全称，和您提交时留的手机号后四位，就能找回之前的报告。
    </p>

    <label class="field">
      <span>企业全称</span>
      <el-input
        v-model="companyName"
        placeholder="与营业执照完全一致"
        maxlength="80"
        @keyup.enter="submit"
      />
    </label>

    <label class="field">
      <span>手机号后四位</span>
      <el-input
        :model-value="phoneTail"
        placeholder="例如 1111"
        maxlength="4"
        inputmode="numeric"
        @update:model-value="onTailInput"
        @keyup.enter="submit"
      />
    </label>

    <p v-if="error" class="error">{{ error }}</p>

    <ul v-if="results.length > 0" class="results">
      <li v-for="item in results" :key="item.projectId" @click="open(item.projectId)">
        <div class="left">
          <b>{{ item.period.y2 }}–{{ item.period.y0 }}</b>
          <em>{{ fmt(item.submittedAt) }} 提交</em>
        </div>
        <div class="right">
          <span v-if="item.hasScore">{{ item.official }} 分</span>
          <span v-else class="muted">未完成</span>
        </div>
      </li>
    </ul>

    <template #footer>
      <div class="footer">
        <span class="hint">同名企业有多条记录时，按期间选择</span>
        <div class="ops">
          <el-button @click="visible = false">取消</el-button>
          <el-button type="primary" :loading="loading" :disabled="!canSubmit" @click="submit">
            查询
          </el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.lead {
  margin-bottom: 16px;
  font-size: 12px;
  line-height: 1.7;
  color: #8a94a6;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 14px;
}

.field > span {
  font-size: 12.5px;
  color: #5b6474;
}

.error {
  margin: 2px 0 8px;
  font-size: 12px;
  color: #b91c1c;
}

.results {
  margin: 6px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.results li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border: 1px solid #e8eef6;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.results li:hover {
  border-color: #bcd4fb;
  background: #f5f9ff;
}

.left {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.left b {
  font-size: 13px;
  color: #1f2937;
}

.left em {
  font-style: normal;
  font-size: 11px;
  color: #a3adbb;
}

.right span {
  font-size: 13px;
  color: #2563eb;
  font-weight: 500;
}

.right .muted {
  color: #a3adbb;
  font-weight: 400;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hint {
  font-size: 11px;
  color: #a3adbb;
}

.ops {
  display: flex;
  gap: 8px;
}
</style>
