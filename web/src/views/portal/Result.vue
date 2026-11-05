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

    <button
      class="back-fab"
      type="button"
      title="返回上传材料"
      aria-label="返回上传材料"
      @click="goto('/')"
    >
      <span class="txt">返回上传材料</span>
      <span class="ico">←</span>
    </button>

    <ScoreReport v-if="data" :data="data">
      <template #ops>
        <el-button class="btn-line" @click="goto('/')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
          重新评估
        </el-button>
        <el-button class="btn-cta download" type="primary" @click="download">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 3v12" />
            <path d="M7 11l5 5 5-5" />
            <path d="M4 20h16" />
          </svg>
          下载 PDF 报告
        </el-button>
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

.back-fab {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 30;
  display: inline-flex;
  align-items: center;
  height: 42px;
  padding: 0 11px;
  border: 1px solid #dbe6f5;
  border-right: none;
  border-radius: 11px 0 0 11px;
  background: rgba(255, 255, 255, 0.94);
  color: #2563eb;
  font-size: 12.5px;
  line-height: 1;
  cursor: pointer;
  overflow: hidden;
  white-space: nowrap;
  box-shadow: -10px 0 26px -20px rgba(37, 99, 235, 0.95);
  transition: background 0.16s ease, box-shadow 0.16s ease;
}

.back-fab .ico {
  font-size: 15px;
}

.back-fab .txt {
  max-width: 0;
  opacity: 0;
  margin-right: 0;
  transition: max-width 0.22s ease, opacity 0.16s ease, margin-right 0.22s ease;
}

.back-fab:hover {
  background: #fff;
  box-shadow: -12px 0 30px -18px rgba(37, 99, 235, 0.9);
}

.back-fab:focus-visible {
  outline: 2px solid #93c5fd;
  outline-offset: -2px;
}

.back-fab:hover .txt,
.back-fab:focus-visible .txt {
  max-width: 120px;
  opacity: 1;
  margin-right: 6px;
}

.btn-line svg {
  width: 13px;
  height: 13px;
}

.btn-cta svg {
  width: 14px;
  height: 14px;
}

.btn-cta.download {
  height: 42px;
  padding: 0 24px;
  font-size: 13.5px;
  letter-spacing: 0.5px;
}
</style>
