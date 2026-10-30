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
      <button class="exit" @click="signOut">退出</button>
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
  padding: 6px 14px;
  border: 1px solid #e8eef6;
  border-radius: 8px;
  background: #fff;
  color: #64748b;
  font-size: 12px;
  cursor: pointer;
}

.exit:hover {
  color: #dc2626;
  border-color: #fecaca;
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
