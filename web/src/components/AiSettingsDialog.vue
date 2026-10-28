<script setup lang="ts">
import { ref, watch } from 'vue'
import type { AiConfigSource, AiSettingsPatchRequest } from '@srdi/shared'
import { ElMessage } from 'element-plus'
import { errorText } from '@/api'
import { useAiSettings } from '@/composables/useAiSettings'

const { state, hasKey, save, test, close } = useAiSettings()

const baseUrl = ref('')
const model = ref('')
const apiKey = ref('')

const SOURCE_TEXT: Record<AiConfigSource, string> = {
  file: '页面配置',
  env: '环境变量',
  default: '默认值'
}

const reset = () => {
  baseUrl.value = state.config?.baseUrl ?? ''
  model.value = state.config?.model ?? ''
  apiKey.value = ''
}

watch(
  () => state.dialogOpen,
  (open) => {
    if (open) reset()
  }
)

watch(
  () => state.config?.updatedAt,
  () => {
    if (state.dialogOpen && !apiKey.value) reset()
  }
)

const buildPatch = (): AiSettingsPatchRequest => {
  const patch: AiSettingsPatchRequest = {}
  if (baseUrl.value.trim()) patch.baseUrl = baseUrl.value.trim()
  if (model.value.trim()) patch.model = model.value.trim()
  if (apiKey.value.trim()) patch.apiKey = apiKey.value.trim()
  return patch
}

const persist = async (notify: boolean) => {
  const patch = buildPatch()
  if (Object.keys(patch).length === 0) return true
  try {
    await save(patch)
    apiKey.value = ''
    if (notify) ElMessage.success('已保存，抽取字段会立即使用新配置')
    return true
  } catch (err) {
    ElMessage.error(errorText(err))
    return false
  }
}

const onSave = async () => {
  if (!baseUrl.value.trim()) {
    ElMessage.warning('先填写 API 地址')
    return
  }
  if (await persist(true)) close()
}

const onTest = async () => {
  if (!baseUrl.value.trim()) {
    ElMessage.warning('先填写 API 地址')
    return
  }
  if (!apiKey.value.trim() && !hasKey.value) {
    ElMessage.warning('先填写 API Key')
    return
  }
  if (!(await persist(false))) return
  try {
    const result = await test()
    ElMessage.success(`连接成功 · ${result.model} · ${result.latencyMs} ms`)
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}

const onClearKey = async () => {
  try {
    await save({ clearKey: true })
    apiKey.value = ''
    ElMessage.success('已清除本机保存的 Key')
  } catch (err) {
    ElMessage.error(errorText(err))
  }
}
</script>

<template>
  <el-dialog
    v-model="state.dialogOpen"
    title="模型设置"
    width="560px"
    :close-on-click-modal="false"
    append-to-body
  >
    <p class="lead">
      填写兼容 OpenAI 协议的接口，保存后立即生效，<b>不需要重启服务</b>。
    </p>
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="API 地址">
        <el-input v-model="baseUrl" placeholder="https://api.deepseek.com/v1" clearable />
        <p class="hint">
          只填域名会自动补 <code>/v1</code>，请求发往
          <code>{{ baseUrl || state.config?.baseUrl }}/chat/completions</code>
        </p>
      </el-form-item>
      <el-form-item label="API Key">
        <el-input
          v-model="apiKey"
          type="password"
          show-password
          clearable
          :placeholder="hasKey ? `已保存 ${state.config?.keyMasked}，留空表示不修改` : 'sk-...'"
        />
        <p class="hint">
          仅存本机 <code>data/ai-settings.json</code>，接口只回显掩码，不会打进前端包。
          <el-button v-if="hasKey" text size="small" type="danger" @click="onClearKey">
            清除 Key
          </el-button>
        </p>
      </el-form-item>
      <el-form-item label="模型名">
        <el-input v-model="model" :placeholder="state.config?.defaults.model" clearable />
        <p class="hint">默认 {{ state.config?.defaults.model }}，自定义网关按对方文档填写</p>
      </el-form-item>
    </el-form>

    <div class="meta">
      <span>地址来源：{{ SOURCE_TEXT[state.config?.source.baseUrl ?? 'default'] }}</span>
      <span>
        Key：{{ hasKey ? `已配置 · ${SOURCE_TEXT[state.config?.source.apiKey ?? 'default']}` : '未配置' }}
      </span>
    </div>

    <template #footer>
      <div class="foot">
        <el-button :loading="state.testing" @click="onTest">测试连接</el-button>
        <div>
          <el-button @click="close">取消</el-button>
          <el-button type="primary" :loading="state.saving" @click="onSave">保存</el-button>
        </div>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.lead {
  margin-bottom: 14px;
  font-size: 13px;
  color: #4b5563;
}

.lead b {
  color: #2563eb;
}

.hint {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.7;
  color: #8a94a3;
}

.hint code {
  padding: 1px 5px;
  border-radius: 4px;
  background: #f1f5f9;
  color: #475569;
  font-size: 11px;
}

.meta {
  display: flex;
  gap: 18px;
  padding-top: 10px;
  border-top: 1px dashed #e6ebf2;
  font-size: 11.5px;
  color: #8a94a3;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
</style>
