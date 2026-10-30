<script setup lang="ts">
import { computed } from 'vue'
import type { PortalResultResponse } from '@srdi/shared'
import DimensionBars from '@/components/portal/DimensionBars.vue'
import DimensionRadar from '@/components/portal/DimensionRadar.vue'
import ChecklistTable from '@/components/portal/ChecklistTable.vue'

const props = withDefaults(defineProps<{ data: PortalResultResponse; saved?: boolean }>(), {
  saved: true
})

const score = computed(() => props.data.score)

const headline = computed(() => {
  if (!score.value) return ''
  if (score.value.passed) {
    return `已过 ${score.value.passLine} 分参考线。补齐下面列出的缺口，还能再提 ${score.value.potential.toFixed(1)} 分。`
  }
  return `距离 ${score.value.passLine} 分参考线还差 ${score.value.gap.toFixed(1)} 分。缺口全部补齐后，预计可达 ${score.value.optimistic.toFixed(1)} 分。`
})

const missingText = computed(() =>
  props.data.missingSlots
    .filter((slot) => slot.required)
    .map((slot) => slot.title)
    .join('、')
)
</script>

<template>
  <div class="report">
    <section class="hero">
      <div class="id">
        <h1>{{ data.company.name }}</h1>
        <p>
          <template v-if="data.company.creditCode">
            统一社会信用代码 {{ data.company.creditCode }} ·
          </template>
          统计期间 {{ data.period.y2 }}–{{ data.period.y0 }}
        </p>
      </div>

      <div class="scores">
        <div class="main">
          <span class="num">{{ score ? score.official.toFixed(1) : '—' }}</span>
          <span class="unit">/ 100</span>
          <span class="cap">当前参考得分</span>
        </div>
        <div class="side">
          <div>
            <span class="cap">补齐后可达</span>
            <b>{{ score ? score.optimistic.toFixed(1) : '—' }}</b>
          </div>
          <div>
            <span class="cap">达标参考线</span>
            <b>{{ score?.passLine ?? 60 }}</b>
          </div>
          <em :class="score?.passed ? 'ok' : 'warn'">
            {{ score?.passed ? '已达标' : `差 ${score?.gap.toFixed(1)} 分` }}
          </em>
        </div>
      </div>

      <p class="headline">{{ headline }}</p>
      <p v-if="saved" class="saved">
        这份报告已经存好。下次在首页「我的历史报告」里可以直接打开；换设备时用企业全称 +
        手机号后四位找回。
      </p>
    </section>

    <p v-if="missingText" class="alert">
      缺少 {{ missingText }}，这几项按中性值估算，补齐后分数会明显变化。
    </p>

    <p v-for="warning in data.warnings.slice(0, 3)" :key="warning" class="alert soft">
      {{ warning }}
    </p>

    <section class="card">
      <h2>五个维度</h2>
      <p class="sub">深色为当前得分，浅色虚线为补齐缺口后能达到的位置。</p>
      <div class="dims">
        <DimensionRadar :dimensions="data.dimensions" />
        <DimensionBars :dimensions="data.dimensions" />
      </div>
    </section>

    <section class="card">
      <h2>逐项自查</h2>
      <p class="sub">✅ 符合要求　⭕ 材料缺失　❌ 需要补足</p>
      <ChecklistTable :checks="data.checks" />
    </section>

    <section class="card">
      <h2>补足建议</h2>
      <p class="sub">按可提升分数排序，最多显示 8 条。</p>
      <ul class="advices">
        <li v-for="(advice, index) in data.advices" :key="advice.key">
          <div class="advice-head">
            <span class="rank">{{ index + 1 }}</span>
            <b>{{ advice.title }}</b>
            <em>可提升 {{ advice.gain.toFixed(1) }} 分</em>
          </div>
          <p>{{ advice.body }}</p>
        </li>
      </ul>
      <p v-if="data.advices.length === 0" class="empty">本次没有生成建议。</p>
    </section>

    <footer class="actions">
      <div class="tips">
        <span>参考得分非官方口径，仅供申报前自查。</span>
        <span v-if="score">
          行业基准 {{ score.industry.code }} {{ score.industry.name ?? '未匹配' }} · 有效证据
          {{ (score.materialRate * 100).toFixed(0) }}%
        </span>
      </div>
      <div class="ops">
        <slot name="ops" />
      </div>
    </footer>
  </div>
</template>

<style scoped>
.report {
  width: 100%;
  max-width: 980px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero {
  padding: 24px 24px 20px;
  border-radius: 18px;
  background: linear-gradient(135deg, #f8fbff, #ffffff 55%);
  border: 1px solid #e2ecfa;
  box-shadow: 0 20px 50px -40px rgba(37, 99, 235, 0.9);
}

.id h1 {
  font-size: 20px;
  font-weight: 600;
  color: #0f172a;
}

.id p {
  margin-top: 6px;
  font-size: 12px;
  color: #8a94a6;
}

.scores {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  margin-top: 20px;
}

.main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.main .num {
  font-size: 56px;
  font-weight: 600;
  line-height: 1;
  color: #2563eb;
  letter-spacing: -1px;
}

.main .unit {
  font-size: 14px;
  color: #94a3b8;
}

.main .cap {
  font-size: 12px;
  color: #8a94a6;
}

.side {
  display: flex;
  align-items: center;
  gap: 26px;
}

.side > div {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.side .cap {
  font-size: 11.5px;
  color: #a3adbb;
}

.side b {
  font-size: 22px;
  font-weight: 600;
  color: #0f172a;
}

.side em {
  font-style: normal;
  padding: 4px 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 500;
}

.side em.ok {
  background: #ecfdf5;
  color: #15803d;
}

.side em.warn {
  background: #fff7ed;
  color: #b45309;
}

.headline {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed #e2ecfa;
  font-size: 13px;
  line-height: 1.8;
  color: #334155;
}

.saved {
  margin-top: 10px;
  font-size: 11.5px;
  line-height: 1.7;
  color: #a3adbb;
}

.alert {
  padding: 11px 15px;
  border-radius: 10px;
  background: #fff7ed;
  color: #b45309;
  font-size: 12.5px;
  line-height: 1.7;
}

.alert.soft {
  background: #f8fafc;
  color: #64748b;
}

.card {
  padding: 20px 22px;
  border-radius: 16px;
  background: #fff;
  border: 1px solid #e8eef6;
}

.card h2 {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.sub {
  margin: 6px 0 18px;
  font-size: 11.5px;
  color: #a3adbb;
}

.dims {
  display: grid;
  grid-template-columns: 400px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
}

.advices {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.advices li {
  padding-bottom: 14px;
  border-bottom: 1px dashed #f1f5f9;
}

.advices li:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.advice-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rank {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  background: #eff5ff;
  color: #2563eb;
  font-size: 11px;
}

.advice-head b {
  flex: 1;
  font-size: 13.5px;
  font-weight: 600;
  color: #111827;
}

.advice-head em {
  font-style: normal;
  font-size: 12px;
  color: #0ea5e9;
}

.advices p {
  margin-top: 7px;
  padding-left: 26px;
  font-size: 12.5px;
  line-height: 1.85;
  color: #475569;
}

.empty {
  font-size: 12.5px;
  color: #94a3b8;
}

.actions {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 14px 20px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #e8eef6;
  backdrop-filter: blur(8px);
}

.tips {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
  color: #a3adbb;
}

.ops {
  display: flex;
  gap: 10px;
}
</style>
