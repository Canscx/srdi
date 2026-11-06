<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { RULES_ID } from '@srdi/shared'
import { api, errorText } from '@/api'
import { clearSavedLogin, loadSavedLogin, saveSavedLogin } from '@/savedLogin'

const emit = defineEmits<{ done: [] }>()

const username = ref('customer')
const password = ref('vip666666')
const mode = ref<'customer' | 'admin'>('customer')
const remember = ref(false)
const error = ref('')
const busy = ref(false)

const rulesId = RULES_ID

const previewDims = [
  { name: '专业化', value: '11.2', ratio: '75%' },
  { name: '精细化', value: '13.4', ratio: '67%' },
  { name: '特色化', value: '9.6', ratio: '64%' },
  { name: '创新能力', value: '14.6', ratio: '42%' },
  { name: '成长性', value: '5.5', ratio: '37%' }
]

const facts = [
  { value: '5', label: '个评价维度' },
  { value: '23', label: '项自查指标' },
  { value: '1', label: '份可下载报告' }
]

const useRole = (next: 'customer' | 'admin') => {
  mode.value = next
  error.value = ''
  if (next === 'customer') {
    username.value = 'customer'
    password.value = 'vip666666'
  } else {
    username.value = 'admin'
    password.value = ''
  }
}

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
    <aside class="brand">
      <div class="brand-body">
        <div class="brand-head">
          <span class="mark">专</span>
          <div class="brand-text">
            <strong>专精特新自评</strong>
            <span>上传材料 · 自动打分 · 出具补足建议</span>
          </div>
        </div>

        <div class="brand-main">
          <div class="kicker-row">
            <span class="kicker">SRDI SELF-ASSESSMENT</span>
            <i class="rule" />
          </div>

          <h2 class="brand-title">把每一份材料<br />变成可解释的分数</h2>
          <p class="brand-lede">
            上传营业执照、财报与知识产权证明，系统自动抽取证据、按 23
            项指标逐条打分，并给出可以马上动手的补足建议。
          </p>

          <div class="preview">
            <div class="pv-head">
              <div class="pv-org"><b>示例企业</b><span>装备制造</span></div>
              <span class="pv-tag">示例</span>
            </div>
            <div class="pv-score">
              <span class="pv-num">54.3</span>
              <span class="pv-unit">/ 100</span>
              <span class="pv-cap">当前参考得分</span>
            </div>
            <div class="pv-bars">
              <div v-for="row in previewDims" :key="row.name" class="pv-row">
                <span class="pv-name">{{ row.name }}</span>
                <div class="pv-track"><i class="pv-fill" :style="{ width: row.ratio }" /></div>
                <span class="pv-val">{{ row.value }}</span>
              </div>
            </div>
            <span class="pv-chip pv-chip-a"><i />23 项指标 · 证据已抽取</span>
            <span class="pv-chip pv-chip-b"><i />五个维度</span>
          </div>
        </div>

        <div class="brand-foot">
          <div class="facts">
            <div v-for="fact in facts" :key="fact.label" class="fact">
              <b>{{ fact.value }}</b>
              <span>{{ fact.label }}</span>
            </div>
          </div>

          <div class="status">
            <i class="dot" />
            <span>评分引擎运行正常</span>
            <em>{{ rulesId }}</em>
          </div>
        </div>
      </div>
    </aside>

    <form class="form-pane" @submit.prevent="submit">
      <div class="form-inner">
        <span class="badge"><i />仅限授权人员</span>

        <p class="pane-kicker">{{ mode === 'customer' ? 'CLIENT PORTAL' : 'ADMIN CONSOLE' }}</p>
        <h1 class="form-title">{{ mode === 'customer' ? '登录专精特新自评' : '登录管理后台' }}</h1>
        <p class="form-lede">
          {{
            mode === 'customer'
              ? '输入账号与密码，进入你的评估工作台'
              : '输入管理员账号与密码，进入工作台'
          }}
        </p>

        <div class="roles">
          <button type="button" :class="{ on: mode === 'customer' }" @click="useRole('customer')">
            我是客户
          </button>
          <button type="button" :class="{ on: mode === 'admin' }" @click="useRole('admin')">
            管理员
          </button>
        </div>

        <div class="fields">
          <label class="field">
            <span>账号</span>
            <el-input v-model="username" size="large" autocomplete="username" placeholder="账号">
              <template #prefix>
                <svg
                  class="ico"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="10" cy="8" r="3.2" />
                  <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
                </svg>
              </template>
            </el-input>
          </label>
          <label class="field">
            <span>密码</span>
            <el-input
              v-model="password"
              size="large"
              type="password"
              autocomplete="current-password"
              placeholder="密码"
              show-password
            >
              <template #prefix>
                <svg
                  class="ico"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.6"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
                  <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
                </svg>
              </template>
            </el-input>
          </label>
        </div>

        <div class="remember">
          <el-checkbox v-model="remember">记住密码</el-checkbox>
          <span>仅存本机浏览器</span>
        </div>

        <p v-if="error" class="err">{{ error }}</p>

        <el-button
          class="submit"
          type="primary"
          size="large"
          :loading="busy"
          native-type="submit"
        >
          <span class="submit-label">{{ busy ? '登录中' : '登录' }}</span>
          <svg
            class="submit-arrow"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M5 12h13" />
            <path d="M12 6l6 6-6 6" />
          </svg>
        </el-button>

        <p class="tip">仅限授权人员使用 · 数据与操作记录留存于服务器</p>
      </div>

      <div class="foot">
        <span>参考得分非官方口径 · 仅供申报前自查</span>
        <span>{{ rulesId }}</span>
      </div>
    </form>
  </div>
</template>

<style scoped>
.gate {
  position: relative;
  z-index: 1;
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  background: #fff;
  --el-color-primary: #2563eb;
  --el-color-primary-light-3: #6692f1;
  --el-color-primary-light-5: #92b1f5;
  --el-color-primary-light-7: #bcd4fb;
  --el-color-primary-light-8: #d3e0fb;
  --el-color-primary-light-9: #eff5ff;
  --el-color-primary-dark-2: #1e4fbc;
  --el-border-radius-base: 10px;
  --el-border-radius-small: 4px;
  --el-component-size-large: 46px;
  --el-input-icon-color: #a3adbb;
  --el-input-clear-hover-color: #2563eb;
}

.brand {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: flex;
  padding: 48px clamp(40px, 4vw, 72px) 40px;
  background: linear-gradient(150deg, #fbfdff 0%, #f3f8ff 42%, #e7f1ff 100%);
  border-right: 1px solid #e8eef6;
}

.brand::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(760px 560px at 4% -6%, rgba(37, 99, 235, 0.14), transparent 66%),
    radial-gradient(640px 480px at 96% 104%, rgba(14, 165, 233, 0.16), transparent 64%);
}

.brand::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-image: repeating-linear-gradient(
      0deg,
      rgba(37, 99, 235, 0.06) 0,
      rgba(37, 99, 235, 0.06) 1px,
      transparent 1px,
      transparent 40px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(37, 99, 235, 0.06) 0,
      rgba(37, 99, 235, 0.06) 1px,
      transparent 1px,
      transparent 40px
    );
  -webkit-mask-image: radial-gradient(
    120% 96% at 6% 0%,
    #000 0%,
    rgba(0, 0, 0, 0.55) 40%,
    rgba(0, 0, 0, 0.12) 68%,
    transparent 82%
  );
  mask-image: radial-gradient(
    120% 96% at 6% 0%,
    #000 0%,
    rgba(0, 0, 0, 0.55) 40%,
    rgba(0, 0, 0, 0.12) 68%,
    transparent 82%
  );
}

.brand-body {
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 800px;
  display: flex;
  flex-direction: column;
}

.brand-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.mark {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: linear-gradient(135deg, #2563eb, #0ea5e9);
  color: #fff;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: 1px;
  box-shadow: 0 14px 28px -16px rgba(37, 99, 235, 0.75);
}

.brand-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.brand-text strong {
  font-size: 16.5px;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: 0.3px;
}

.brand-text span {
  font-size: 12px;
  color: #a3adbb;
  letter-spacing: 0.2px;
}

.brand-main {
  margin: auto 0;
  padding: clamp(28px, 4vh, 56px) 0;
}

.kicker-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.kicker {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 3px;
  color: #2563eb;
  white-space: nowrap;
}

.rule {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, #bcd4fb, rgba(188, 212, 251, 0));
}

.brand-title {
  margin-top: 18px;
  font-size: clamp(26px, 2.4vw, 40px);
  line-height: 1.4;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: 0.2px;
}

.brand-lede {
  margin-top: 18px;
  max-width: 520px;
  font-size: 13.5px;
  line-height: 1.9;
  color: #5b6474;
}

.preview {
  position: relative;
  max-width: 560px;
  margin: clamp(24px, 3.4vh, 40px) 0 10px;
  padding: 20px 22px 18px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e8eef6;
  box-shadow: 0 24px 48px -34px rgba(37, 99, 235, 0.55);
}

.preview::before {
  content: '';
  position: absolute;
  z-index: -1;
  inset: 12px -12px -12px 12px;
  border-radius: 16px;
  background: #f5f9ff;
  border: 1px solid #e2ecfa;
}

.pv-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pv-org b {
  font-size: 13.5px;
  font-weight: 600;
  color: #111827;
}

.pv-org span {
  margin-left: 7px;
  font-size: 11.5px;
  color: #a3adbb;
}

.pv-tag {
  padding: 3px 8px;
  border-radius: 6px;
  background: #eff5ff;
  color: #2563eb;
  font-size: 11.5px;
}

.pv-score {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.pv-num {
  font-size: 42px;
  line-height: 1;
  font-weight: 600;
  color: #2563eb;
  letter-spacing: -1px;
  font-variant-numeric: tabular-nums;
}

.pv-unit {
  padding-bottom: 4px;
  font-size: 12.5px;
  color: #94a3b8;
}

.pv-cap {
  margin-left: auto;
  padding-bottom: 4px;
  font-size: 11.5px;
  color: #a3adbb;
}

.pv-bars {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pv-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) 44px;
  align-items: center;
  gap: 10px;
}

.pv-name {
  font-size: 11.5px;
  color: #5b6474;
}

.pv-track {
  height: 6px;
  border-radius: 4px;
  background: #eef2f7;
  overflow: hidden;
}

.pv-fill {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: linear-gradient(90deg, #2563eb, #3b82f6);
}

.pv-val {
  font-size: 11.5px;
  color: #8a94a6;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.pv-chip {
  position: absolute;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 8px;
  background: #fff;
  border: 1px solid #dbe6f7;
  box-shadow: 0 10px 20px -16px rgba(37, 99, 235, 0.9);
  font-size: 11.5px;
  line-height: 1;
  color: #2563eb;
  white-space: nowrap;
}

.pv-chip i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #0ea5e9;
}

.pv-chip-a {
  top: -13px;
  right: 16px;
}

.pv-chip-b {
  left: 16px;
  bottom: -13px;
  color: #5b6474;
}

.facts {
  padding-top: 20px;
  border-top: 1px solid #e3ebf7;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

.fact b {
  display: block;
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
  font-variant-numeric: tabular-nums;
}

.fact span {
  display: block;
  margin-top: 4px;
  font-size: 12px;
  color: #a3adbb;
  line-height: 1.4;
}

.status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 12px;
  color: #8a94a6;
}

.status .dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #2563eb;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.14);
}

.status em {
  margin-left: auto;
  font-style: normal;
  color: #a3adbb;
  letter-spacing: 0.4px;
  font-variant-numeric: tabular-nums;
}

.form-pane {
  position: relative;
  margin: 0;
  display: flex;
  flex-direction: column;
  padding: clamp(56px, 7vh, 88px) clamp(36px, 4vw, 64px) 72px;
  background: #fff;
}

.form-inner {
  width: 100%;
  max-width: 440px;
  margin: auto;
}

.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: 8px;
  background: #eff5ff;
  border: 1px solid #dbe6f7;
  font-size: 11.5px;
  letter-spacing: 0.4px;
  color: #2563eb;
}

.badge i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #2563eb;
}

.pane-kicker {
  margin-top: 20px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 2.6px;
  color: #2563eb;
}

.form-title {
  margin-top: 12px;
  font-size: clamp(22px, 1.8vw, 26px);
  line-height: 1.4;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: 0.2px;
}

.form-lede {
  margin-top: 10px;
  max-width: 340px;
  font-size: 13px;
  line-height: 1.8;
  color: #8a94a6;
}

.roles {
  margin-top: 28px;
  height: 42px;
  padding: 4px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  border-radius: 10px;
  background: #f4f6fa;
  border: 1px solid #e8eef6;
}

.roles button {
  border: 0;
  border-radius: 7px;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  letter-spacing: 0.4px;
  color: #64748b;
  cursor: pointer;
  transition: background-color 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
}

.roles button.on {
  background: #fff;
  color: #2563eb;
  font-weight: 600;
  box-shadow: 0 2px 8px -4px rgba(15, 23, 42, 0.4);
}

.roles button:focus-visible {
  outline: 2px solid #bcd4fb;
  outline-offset: 1px;
}

.fields {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field > span {
  font-size: 13px;
  font-weight: 500;
  color: #5b6474;
  letter-spacing: 0.2px;
}

.field :deep(.el-input__wrapper) {
  padding: 1px 14px;
  border-radius: 10px;
  background: #fff;
  box-shadow: 0 0 0 1px #e6ebf2 inset;
  transition: box-shadow 0.18s ease;
}

.field :deep(.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px #bcd4fb inset;
}

.field :deep(.el-input__wrapper.is-focus),
.field :deep(.el-input__wrapper.is-focus:hover) {
  box-shadow: 0 0 0 1px #2563eb inset, 0 0 0 4px rgba(37, 99, 235, 0.1);
}

.field :deep(.el-input__inner) {
  font-size: 14px;
  color: #0f172a;
  letter-spacing: 0.2px;
}

.field :deep(.el-input__prefix) {
  color: #a3adbb;
}

.ico {
  width: 15px;
  height: 15px;
  display: block;
}

.remember {
  margin-top: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.remember :deep(.el-checkbox) {
  margin-right: 0;
  height: 20px;
}

.remember :deep(.el-checkbox__label) {
  padding-left: 7px;
  font-size: 13px;
  color: #5b6474;
}

.remember > span {
  font-size: 11.5px;
  color: #a3adbb;
}

.err {
  margin-top: 12px;
  padding: 9px 12px;
  border-radius: 8px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  color: #dc2626;
  font-size: 12.5px;
  line-height: 1.6;
}

.submit {
  width: 100%;
  height: 50px;
  margin-top: 24px;
  border: 0;
  border-radius: 10px;
  background-image: linear-gradient(135deg, #2563eb, #0ea5e9);
  box-shadow: 0 14px 26px -16px rgba(37, 99, 235, 0.9);
  font-size: 15px;
  font-weight: 500;
  letter-spacing: 3px;
  transition: transform 0.18s ease, box-shadow 0.18s ease;
}

.submit:hover {
  background-image: linear-gradient(135deg, #1d4ed8, #0284c7);
  transform: translateY(-1px);
  box-shadow: 0 18px 30px -16px rgba(37, 99, 235, 0.95);
}

.submit:active {
  transform: translateY(0);
}

.submit:focus-visible {
  outline: 2px solid rgba(37, 99, 235, 0.35);
  outline-offset: 2px;
}

.submit.is-loading::before {
  background-color: rgba(255, 255, 255, 0.14);
}

.submit-label {
  padding-left: 2px;
}

.submit-arrow {
  width: 15px;
  height: 15px;
  margin-left: 10px;
  transition: transform 0.18s ease;
}

.submit:hover .submit-arrow {
  transform: translateX(3px);
}

.tip {
  margin-top: 18px;
  font-size: 11.5px;
  line-height: 1.7;
  color: #a3adbb;
  text-align: center;
  letter-spacing: 0.2px;
}

.foot {
  position: absolute;
  left: 50%;
  bottom: 26px;
  width: min(440px, calc(100% - 2 * clamp(36px, 4vw, 64px)));
  transform: translateX(-50%);
  display: flex;
  justify-content: space-between;
  gap: 16px;
  font-size: 11.5px;
  color: #a3adbb;
  letter-spacing: 0.2px;
}

@media (max-height: 780px) {
  .brand {
    padding-top: 32px;
    padding-bottom: 28px;
  }

  .brand-main {
    padding: 24px 0;
  }

  .preview {
    margin-top: 22px;
  }

  .form-pane {
    padding-top: 40px;
    padding-bottom: 60px;
  }

  .foot {
    bottom: 18px;
  }
}

@media (min-width: 1800px) {
  .brand {
    padding-left: 5vw;
    padding-right: 5vw;
  }

  .brand-body {
    max-width: 900px;
  }

  .brand-title {
    font-size: 44px;
  }

  .preview {
    max-width: 620px;
  }

  .pv-num {
    font-size: 46px;
  }
}
</style>
