<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api, errorText } from '@/api'
import { clearSavedLogin, loadSavedLogin, saveSavedLogin } from '@/savedLogin'

const emit = defineEmits<{ done: [] }>()

const username = ref('admin')
const password = ref('')
const remember = ref(false)
const error = ref('')
const busy = ref(false)

onMounted(() => {
  const saved = loadSavedLogin()
  if (!saved) return
  username.value = saved.username
  password.value = saved.password
  remember.value = true
})

watch(remember, (value) => {
  if (!value) clearSavedLogin()
})

const submit = async () => {
  if (busy.value) return
  if (!username.value.trim() || !password.value) {
    error.value = '请输入账号与密码'
    return
  }
  busy.value = true
  error.value = ''
  try {
    await api.login(username.value.trim(), password.value)
    if (remember.value) {
      if (!saveSavedLogin(username.value.trim(), password.value)) {
        ElMessage.warning('浏览器禁用了本地存储，本次不会记住密码')
      }
    } else {
      clearSavedLogin()
    }
    ElMessage.success('登录成功')
    emit('done')
  } catch (err) {
    error.value = errorText(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="gate">
    <form class="card" @submit.prevent="submit">
      <span class="mark">专</span>
      <h1>专精特新申报自评打分系统</h1>
      <p class="sub">上传材料 · 抽取证据 · 人工确认 · 参考打分</p>

      <label class="field">
        <span>账号</span>
        <el-input v-model="username" autocomplete="username" placeholder="账号" />
      </label>
      <label class="field">
        <span>密码</span>
        <el-input
          v-model="password"
          type="password"
          autocomplete="current-password"
          placeholder="密码"
          show-password
        />
      </label>

      <div class="remember">
        <el-checkbox v-model="remember">记住密码</el-checkbox>
        <span>仅存本机浏览器</span>
      </div>

      <p v-if="error" class="err">{{ error }}</p>

      <el-button type="primary" size="large" :loading="busy" native-type="submit">
        {{ busy ? '登录中' : '登录' }}
      </el-button>

      <p class="tip">仅限授权人员使用 · 数据与操作记录留存于服务器</p>
    </form>
  </div>
</template>

<style scoped>
.gate {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.card {
  width: 400px;
  padding: 38px 36px 30px;
  border-radius: 18px;
  background: #fff;
  border: 1px solid #e6ebf2;
  box-shadow: 0 24px 60px -28px rgba(15, 23, 42, 0.35);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mark {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 15px;
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
  color: #fff;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: 1px;
  box-shadow: 0 12px 26px -10px rgba(37, 99, 235, 0.65);
}

h1 {
  margin-top: 16px;
  font-size: 18px;
  font-weight: 600;
  text-align: center;
}

.sub {
  margin: 6px 0 26px;
  font-size: 12px;
  color: #8a94a6;
}

.field {
  width: 100%;
  margin-bottom: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.field span {
  font-size: 12.5px;
  color: #5b6474;
  font-weight: 500;
}

.el-button {
  width: 100%;
  margin-top: 8px;
  letter-spacing: 6px;
}

.remember {
  width: 100%;
  margin: -2px 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.remember :deep(.el-checkbox__label) {
  font-size: 12.5px;
  color: #5b6474;
}

.remember span {
  font-size: 11px;
  color: #a3adbb;
}

.err {
  width: 100%;
  margin: 2px 0 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  font-size: 12.5px;
}

.tip {
  margin-top: 18px;
  font-size: 11px;
  color: #a3adbb;
  letter-spacing: 0.3px;
}
</style>
