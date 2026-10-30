<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PortalSlot } from '@srdi/shared'

const props = defineProps<{
  slot: PortalSlot
  files: File[]
}>()

const emit = defineEmits<{ 'update:files': [File[]] }>()

const input = ref<HTMLInputElement | null>(null)
const dragging = ref(false)

const accept = computed(() => props.slot.accept.map((item) => `.${item}`).join(','))

const add = (incoming: FileList | null) => {
  if (!incoming) return
  const merged = [...props.files]
  for (const file of Array.from(incoming)) {
    if (merged.some((item) => item.name === file.name && item.size === file.size)) continue
    merged.push(file)
  }
  emit('update:files', merged)
}

const onDrop = (event: DragEvent) => {
  dragging.value = false
  add(event.dataTransfer?.files ?? null)
}

const remove = (index: number) => {
  const next = [...props.files]
  next.splice(index, 1)
  emit('update:files', next)
}

const sizeText = (size: number) =>
  size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`
</script>

<template>
  <div
    class="slot"
    :class="{ filled: files.length > 0, dragging }"
    @dragover.prevent="dragging = true"
    @dragleave.prevent="dragging = false"
    @drop.prevent="onDrop"
  >
    <div class="head">
      <div class="title">
        <span>{{ slot.title }}</span>
        <em v-if="slot.required" class="need">必传</em>
        <em v-else class="opt">选填</em>
      </div>
      <button class="pick" type="button" @click="input?.click()">
        {{ files.length > 0 ? '继续添加' : '选择文件' }}
      </button>
      <input
        ref="input"
        type="file"
        multiple
        hidden
        :accept="accept"
        @change="add(($event.target as HTMLInputElement).files)"
      />
    </div>

    <p class="hint">{{ slot.hint }}</p>

    <ul v-if="files.length > 0" class="list">
      <li v-for="(file, index) in files" :key="`${file.name}-${index}`">
        <span class="name">{{ file.name }}</span>
        <span class="size">{{ sizeText(file.size) }}</span>
        <button class="drop" type="button" @click="remove(index)">移除</button>
      </li>
    </ul>
    <p v-else class="empty">把文件拖到这里，或点右上角选择</p>
  </div>
</template>

<style scoped>
.slot {
  padding: 14px 16px 12px;
  border: 1.5px dashed #d8e0ec;
  border-radius: 14px;
  background: #fff;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
}

.slot.dragging {
  border-color: #2563eb;
  background: #f5f9ff;
}

.slot.filled {
  border-style: solid;
  border-color: #bcd4fb;
  box-shadow: 0 10px 24px -22px rgba(37, 99, 235, 0.9);
}

.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.need,
.opt {
  font-style: normal;
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 5px;
  font-weight: 500;
}

.need {
  background: #fef2f2;
  color: #dc2626;
}

.opt {
  background: #f1f5f9;
  color: #64748b;
}

.pick {
  padding: 5px 12px;
  border: 1px solid #d8e0ec;
  border-radius: 8px;
  background: #fff;
  color: #2563eb;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.pick:hover {
  border-color: #bcd4fb;
  background: #f5f9ff;
}

.hint {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.6;
  color: #8a94a6;
}

.empty {
  margin-top: 10px;
  padding: 10px;
  border-radius: 8px;
  background: #fafbfd;
  font-size: 11.5px;
  color: #a3adbb;
  text-align: center;
}

.list {
  margin: 10px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 8px;
  background: #f5f9ff;
  font-size: 12px;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #1f2937;
}

.size {
  color: #8a94a6;
  font-size: 11px;
}

.drop {
  border: none;
  background: transparent;
  color: #94a3b8;
  font-size: 11.5px;
  cursor: pointer;
}

.drop:hover {
  color: #dc2626;
}
</style>
