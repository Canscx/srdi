<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ProjectSummary } from '@srdi/shared'
import { ElMessage } from 'element-plus'
import { api, errorText } from '@/api'
import { goto } from '@/router'

const projects = ref<ProjectSummary[]>([])
const loading = ref(true)
const error = ref('')
const creating = ref(false)
const name = ref('')
const currentYear = new Date().getFullYear()
const endYear = ref(currentYear - 1)
const yearOptions = Array.from({ length: 6 }, (_, index) => currentYear - 1 - index)
const periodLabel = computed(() => `${endYear.value - 2}–${endYear.value}`)

const load = async () => {
  loading.value = true
  error.value = ''
  try {
    projects.value = (await api.projects()).projects
  } catch (err) {
    error.value = errorText(err)
  } finally {
    loading.value = false
  }
}

const create = async () => {
  if (creating.value) return
  creating.value = true
  try {
    const created = await api.createProject({
      name: name.value.trim() || undefined,
      period: {
        y0: endYear.value,
        y1: endYear.value - 1,
        y2: endYear.value - 2
      }
    })
    ElMessage.success('项目已创建，接下来上传材料')
    name.value = ''
    goto(`/p/${created.projectId}/review`)
  } catch (err) {
    ElMessage.error(errorText(err))
  } finally {
    creating.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="view">
    <header class="bar">
      <div>
        <h2>项目</h2>
        <p>一个项目对应一家企业的一次申报 · 统计期间 {{ periodLabel }}（截止年向前取三年）</p>
      </div>
      <div class="create">
        <el-select v-model="endYear" style="width: 118px">
          <el-option
            v-for="year in yearOptions"
            :key="year"
            :label="`${year} 年`"
            :value="year"
          />
        </el-select>
        <el-input
          v-model="name"
          placeholder="企业名称，例如 某某精密机械有限公司"
          clearable
          style="width: 280px"
          @keyup.enter="create"
        />
        <el-button type="primary" :loading="creating" @click="create">新建项目</el-button>
      </div>
    </header>

    <div v-loading="loading" class="list">
      <button
        v-for="project in projects"
        :key="project.projectId"
        class="project"
        @click="goto(`/p/${project.projectId}/review`)"
      >
        <span class="title">{{ project.name }}</span>
        <span class="meta">
          <em>{{ project.level === 'SRDI' ? '专精特新中小企业' : '小巨人' }}</em>
          <span>{{ project.period.y2 }}–{{ project.period.y0 }}</span>
          <span>{{ project.files }} 份材料</span>
        </span>
        <span class="foot">
          更新于 {{ new Date(project.updatedAt).toLocaleString('zh-CN', { hour12: false }) }}
          <b>进入确认 →</b>
        </span>
      </button>

      <el-empty
        v-if="!loading && projects.length === 0"
        :description="error || '还没有项目，先新建一个'"
        :image-size="88"
      />
    </div>
  </section>
</template>

<style scoped>
.view {
  display: flex;
  flex-direction: column;
  gap: 16px;
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

.create {
  display: flex;
  gap: 10px;
}

.list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-height: 160px;
}

.project {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 16px 18px;
  border: 1px solid #e6ebf2;
  border-radius: 14px;
  background: #fff;
  text-align: left;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.project:hover {
  border-color: #bcd4fb;
  box-shadow: 0 14px 30px -26px rgba(37, 99, 235, 0.8);
  transform: translateY(-1px);
}

.title {
  font-size: 14.5px;
  font-weight: 600;
  color: #111827;
}

.meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #6b7280;
}

.meta em {
  font-style: normal;
  padding: 1px 7px;
  border-radius: 6px;
  background: #eff5ff;
  color: #2563eb;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11.5px;
  color: #a3adbb;
}

.foot b {
  color: #2563eb;
  font-weight: 600;
}
</style>
