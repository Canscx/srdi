<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, errorText } from '@/api'

const props = defineProps<{ visible: boolean; projectId: string; name: string }>()
const emit = defineEmits<{ 'update:visible': [boolean]; renamed: [string] }>()

const value = ref('')
const error = ref('')
const busy = ref(false)

watch(
  () => props.visible,
  (visible) => {
    if (!visible) return
    value.value = props.name
    error.value = ''
  }
)

const close = () => {
  if (busy.value) return
  emit('update:visible', false)
}

const onVisibleChange = (next: boolean) => {
  if (!next && busy.value) return
  emit('update:visible', next)
}

const submit = async () => {
  if (busy.value) return
  const next = value.value.trim()
  if (next.length === 0) {
    error.value = '项目名称不能为空'
    return
  }
  if (next.length > 80) {
    error.value = '项目名称不超过 80 个字符'
    return
  }
  if (next === props.name.trim()) {
    emit('update:visible', false)
    return
  }
  busy.value = true
  error.value = ''
  try {
    const result = await api.renameProject(props.projectId, { name: next })
    ElMessage.success('项目已重命名')
    emit('renamed', result.project.name)
    emit('update:visible', false)
  } catch (err) {
    error.value = errorText(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    title="重命名项目"
    width="420px"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="onVisibleChange"
  >
    <el-form label-position="top" @submit.prevent>
      <el-form-item label="项目名称">
        <el-input
          v-model="value"
          maxlength="80"
          show-word-limit
          clearable
          placeholder="企业名称，例如 某某精密机械有限公司"
          @keyup.enter="submit"
        />
        <p class="hint">改名不影响已上传材料与打分结果，报告标题与下载文件名会随之更新</p>
      </el-form-item>
    </el-form>

    <p v-if="error" class="err">{{ error }}</p>

    <template #footer>
      <div class="foot">
        <el-button @click="close">取消</el-button>
        <el-button type="primary" :loading="busy" @click="submit">保存</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  margin-top: 6px;
  font-size: 11.5px;
  line-height: 1.7;
  color: #8a94a3;
}

.err {
  margin-top: 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  font-size: 12.5px;
}

.foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
