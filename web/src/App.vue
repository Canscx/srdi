<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { goto, useRoute } from '@/router'
import { api } from '@/api'
import { useAiSettings } from '@/composables/useAiSettings'
import AiSettingsDialog from '@/components/AiSettingsDialog.vue'
import LoginView from '@/views/LoginView.vue'
import ProjectsView from '@/views/ProjectsView.vue'
import ReviewView from '@/views/ReviewView.vue'
import ScoringView from '@/views/ScoringView.vue'
import StatusView from '@/views/StatusView.vue'

const route = useRoute()
const { hasKey, state: aiState, ensure, open: openAiSettings } = useAiSettings()
const authChecked = ref(false)

const view = computed(() => {
  if (route.value.name === 'review') return ReviewView
  if (route.value.name === 'score') return ScoringView
  if (route.value.name === 'status') return StatusView
  return ProjectsView
})

const navClass = (name: string) => (route.value.name === name ? 'on' : '')

const onLoggedIn = () => {
  goto('/projects')
  void ensure()
}

const signOut = async () => {
  try {
    await api.logout()
  } catch {
  }
  goto('/login')
}

onMounted(async () => {
  try {
    const status = await api.authStatus()
    if (!status.authenticated) {
      goto('/login')
      authChecked.value = true
      return
    }
  } catch {
    goto('/login')
    authChecked.value = true
    return
  }
  authChecked.value = true
  void ensure()
})
</script>

<template>
  <div v-if="!authChecked" class="boot" />

  <LoginView v-else-if="route.name === 'login'" @done="onLoggedIn" />

  <div v-else class="shell">
    <header class="masthead">
      <div class="brand">
        <span class="mark">专</span>
        <div>
          <h1>专精特新申报自评打分系统</h1>
          <p class="sub">上传材料 · 抽取证据 · 人工确认 · 参考打分</p>
        </div>
      </div>
      <nav class="nav">
        <button :class="navClass('projects')" @click="goto('/projects')">工作台</button>
        <button :class="navClass('status')" @click="goto('/status')">自检</button>
        <button class="settings" @click="openAiSettings">
          <i class="dot" :class="{ ready: hasKey }" />
          模型设置
          <em v-if="aiState.loading">…</em>
        </button>
        <button class="exit" @click="signOut">退出</button>
      </nav>
    </header>

    <component :is="view" />

    <AiSettingsDialog />

    <footer class="foot">
      数据不出本机 · 参考得分非官方口径 · 证据只认人工确认，打分引擎为纯函数
    </footer>
  </div>
</template>

<style scoped>
.boot {
  min-height: 100vh;
}

.shell {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1420px;
  min-width: 1180px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 22px 26px 32px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.masthead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mark {
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 13px;
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 1px;
  box-shadow: 0 10px 22px -10px rgba(37, 99, 235, 0.65);
}

h1 {
  font-size: 19px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.sub {
  margin-top: 4px;
  font-size: 12.5px;
  color: #6b7280;
}

.nav {
  display: flex;
  gap: 6px;
  padding: 4px;
  border-radius: 11px;
  background: #fff;
  border: 1px solid #e6ebf2;
}

.nav button {
  padding: 6px 16px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  color: #6b7280;
  cursor: pointer;
  transition: all 0.15s ease;
}

.nav button:hover {
  color: #2563eb;
}

.nav button.on {
  background: #eff5ff;
  color: #2563eb;
  font-weight: 600;
}

.nav button.settings {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.nav button.exit:hover {
  color: #dc2626;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f59e0b;
  box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
}

.dot.ready {
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14);
}

.nav em {
  font-style: normal;
  color: #a3adbb;
}

.foot {
  margin-top: auto;
  padding-top: 2px;
  text-align: center;
  font-size: 11.5px;
  color: #a3adbb;
  letter-spacing: 0.3px;
}
</style>
