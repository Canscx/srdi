<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { PageDoc } from '@srdi/shared'
import { api } from '@/api'
import { highlightSegments } from '@/format'

const props = defineProps<{
  projectId: string
  fileId: string
  page: number
  fileName: string
  pageDoc: PageDoc | null
  quote?: string
  loading: boolean
}>()

const zoom = ref(false)
const imageError = ref(false)

const imageUrl = computed(() =>
  props.pageDoc?.image
    ? api.pageImageUrl(props.projectId, props.fileId, props.page)
    : ''
)

const displayText = computed(() => {
  const doc = props.pageDoc
  if (!doc) return ''
  const tables = doc.tables
    .filter((table) => table.text && !doc.text.includes(table.text))
    .map((table) => `[表 ${table.index + 1}]\n${table.text}`)
  return [doc.text, ...tables].join('\n\n').trim()
})

const route = computed(() => props.pageDoc?.route ?? 'text')
const segments = computed(() => highlightSegments(displayText.value, props.quote))
const matched = computed(() => segments.value.some((segment) => segment.hit))

watch(imageUrl, () => {
  imageError.value = false
})
</script>

<template>
  <section class="viewer">
    <header class="head">
      <span class="file">{{ fileName }}</span>
      <span class="page">第 {{ page }} 页</span>
      <el-tag size="small" effect="plain" :type="route === 'vision' ? 'warning' : 'info'">
        {{ route === 'vision' ? '视觉通道' : '文本通道' }}
      </el-tag>
      <el-button v-if="imageUrl && !imageError" size="small" text @click="zoom = true">
        放大页图
      </el-button>
    </header>

    <div v-loading="loading" class="canvas">
      <img
        v-if="imageUrl && !imageError"
        :src="imageUrl"
        :alt="`${fileName} 第 ${page} 页`"
        @error="imageError = true"
      />
      <p v-else-if="loading" class="placeholder">正在读取页图…</p>
      <p v-else class="placeholder">
        {{ imageError ? '页图读取失败，建议重新解析' : '该格式不生成页图（DOCX / XLSX 仅保留文本层）' }}
      </p>
    </div>

    <div class="text-block">
      <div class="text-head">
        <span>页面文本</span>
        <span v-if="quote && matched" class="hit-note">已定位原文摘录</span>
        <span v-else-if="quote" class="miss-note">未定位到摘录，请人工比对</span>
      </div>
      <pre v-if="displayText" class="text"><template v-for="(segment, index) in segments" :key="index"><mark v-if="segment.hit">{{ segment.text }}</mark><template v-else>{{ segment.text }}</template></template></pre>
      <p v-else class="placeholder">该页无文本层，只有页图可对照</p>
    </div>

    <p class="foot">高亮基于原文摘录的字符串匹配；模型未回传坐标，因此不做 bbox 框选</p>

    <el-dialog v-model="zoom" width="90%" top="4vh" append-to-body>
      <img class="zoom-img" :src="imageUrl" :alt="`${fileName} 第 ${page} 页`" />
      <template #footer>
        <span class="zoom-note">{{ fileName }} · 第 {{ page }} 页</span>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.viewer {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
}

.head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.file {
  font-size: 12.5px;
  font-weight: 600;
  color: #1f2937;
  max-width: 340px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.page {
  font-size: 12px;
  color: #6b7280;
}

.canvas {
  flex: 1;
  min-height: 340px;
  max-height: 52vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  border: 1px solid #e6ebf2;
  border-radius: 12px;
  background: #f8fafc;
  overflow: auto;
}

.canvas img {
  max-width: 100%;
  max-height: 49vh;
  object-fit: contain;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 10px 24px -18px rgba(15, 23, 42, 0.6);
}

.placeholder {
  font-size: 12px;
  color: #9aa5b5;
  text-align: center;
  line-height: 1.7;
}

.text-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-height: 0;
}

.text-head {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11.5px;
  color: #8a94a6;
  letter-spacing: 0.3px;
}

.hit-note {
  color: #059669;
}

.miss-note {
  color: #b45309;
}

.text {
  margin: 0;
  max-height: 22vh;
  overflow: auto;
  padding: 10px 12px;
  border: 1px solid #e6ebf2;
  border-radius: 10px;
  background: #fbfcfe;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 12px;
  line-height: 1.75;
  color: #334155;
  white-space: pre-wrap;
  word-break: break-all;
}

.text mark {
  padding: 1px 2px;
  border-radius: 4px;
  background: #fde68a;
  color: #7c2d12;
  font-weight: 600;
}

.foot {
  font-size: 11px;
  color: #a3adbb;
}

.zoom-img {
  width: 100%;
  max-height: 78vh;
  object-fit: contain;
}

.zoom-note {
  font-size: 12px;
  color: #8a94a6;
}
</style>
