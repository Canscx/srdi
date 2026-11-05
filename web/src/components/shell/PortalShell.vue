<script setup lang="ts">
import { api } from '@/api'
import { goto } from '@/router'

const signOut = async () => {
  try {
    await api.logout()
  } catch {
  }
  goto('/login')
}
</script>

<template>
  <div class="shell">
    <header class="bar">
      <div class="brand" @click="goto('/')">
        <span class="mark">专</span>
        <div>
          <h1>专精特新自评</h1>
          <p>上传材料 · 自动打分 · 出具补足建议</p>
        </div>
      </div>
      <button class="exit" type="button" @click="signOut">
        退出登录
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3" />
          <path d="M15 16l4-4-4-4" />
          <path d="M19 12H9" />
        </svg>
      </button>
    </header>

    <main class="body">
      <slot />
    </main>

    <footer class="foot">
      参考得分非官方口径，仅供申报前自查 · 材料仅用于本次评估
    </footer>
  </div>
</template>

<style scoped>
.shell {
  width: 100%;
  max-width: 1080px;
  min-height: 100vh;
  margin: 0 auto;
  padding: 18px 26px 28px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.mark {
  width: 38px;
  height: 38px;
  display: grid;
  place-items: center;
  border-radius: 11px;
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
  color: #fff;
  font-size: 17px;
  font-weight: 600;
  box-shadow: 0 10px 22px -12px rgba(37, 99, 235, 0.7);
}

h1 {
  font-size: 15px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: 0.3px;
}

.brand p {
  margin-top: 2px;
  font-size: 11.5px;
  color: #94a3b8;
}

.exit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 1px solid #f6dcdc;
  border-radius: 999px;
  background: #fff;
  color: #dc2626;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.3px;
  cursor: pointer;
  transition: all 0.16s ease;
}

.exit svg {
  width: 13px;
  height: 13px;
  transition: transform 0.16s ease;
}

.exit:hover {
  border-color: #fecaca;
  background: #fef2f2;
  color: #b91c1c;
  box-shadow: 0 6px 14px -12px rgba(220, 38, 38, 0.9);
}

.exit:hover svg {
  transform: translateX(2px);
}

.exit:active {
  background: #fee2e2;
}

.exit:focus-visible {
  outline: 2px solid rgba(220, 38, 38, 0.3);
  outline-offset: 3px;
}

.body {
  flex: 1;
}

.foot {
  padding-top: 6px;
  text-align: center;
  font-size: 11px;
  color: #cbd5e1;
  letter-spacing: 0.2px;
}
</style>
