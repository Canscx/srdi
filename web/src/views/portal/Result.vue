<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { PortalResultResponse } from '@srdi/shared'
import { api, errorText } from '@/api'
import { goto } from '@/router'
import ScoreReport from '@/components/portal/ScoreReport.vue'

const props = defineProps<{ projectId: string }>()

const data = ref<PortalResultResponse | null>(null)
const loading = ref(true)
const error = ref('')

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    data.value = await api.portalResult(props.projectId)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}

const download = () => {
  window.open(api.portalReportUrl(props.projectId), '_blank')
}

onMounted(load)
</script>

<template>
  <div class="result" v-loading="loading">
    <p v-if="error" class="banner">{{ error }}</p>

    <ScoreReport v-if="data" :data="data">
      <template #ops>
        <el-button @click="goto('/')">重新评估</el-button>
        <el-button type="primary" @click="download">下载 PDF 报告</el-button>
      </template>
    </ScoreReport>
  </div>
</template>

<style scoped>
.result {
  width: 100%;
}

.banner {
  max-width: 980px;
  margin: 0 auto 12px;
  padding: 12px 16px;
  border-radius: 10px;
  background: #fef2f2;
  color: #b91c1c;
  font-size: 13px;
}
</style>
