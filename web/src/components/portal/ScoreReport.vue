<script setup lang="ts">
import { computed } from 'vue'
import { TARGET_RATE, yearsSinceDate } from '@srdi/shared'
import type { PortalResultResponse } from '@srdi/shared'
import DimensionBars from '@/components/portal/DimensionBars.vue'
import DimensionRadar from '@/components/portal/DimensionRadar.vue'
import ChecklistTable from '@/components/portal/ChecklistTable.vue'

const props = withDefaults(defineProps<{ data: PortalResultResponse; saved?: boolean }>(), {
  saved: true
})

const score = computed(() => props.data.score)
const targetRate = Math.round(TARGET_RATE * 100)

const needsEvidence = computed(() => {
  const value = score.value
  return Boolean(value && value.official >= value.passLine && !value.evidenceSufficient)
})

const verdict = computed(() => {
  const value = score.value
  if (!value) return ''
  if (value.passed) return '已达标'
  return needsEvidence.value ? '待补证' : `差 ${value.gap.toFixed(1)} 分`
})

const headline = computed(() => {
  if (!score.value) return ''
  if (score.value.passed) {
    return `已过 ${score.value.passLine} 分参考线。缺口补齐并按每项 ${targetRate}% 得分率计分后，还能再提 ${score.value.potential.toFixed(1)} 分。`
  }
  if (needsEvidence.value) {
    return `分数已过 ${score.value.passLine} 分线，但材料覆盖不足，先补齐下方缺口再确认申报。`
  }
  if (score.value.goal < score.value.passLine) {
    return `距离 ${score.value.passLine} 分参考线还差 ${score.value.gap.toFixed(1)} 分；即使补齐材料并按每项 ${targetRate}% 得分率计分，预计也只有 ${score.value.goal.toFixed(1)} 分，需先补强低分维度。`
  }
  return `距离 ${score.value.passLine} 分参考线还差 ${score.value.gap.toFixed(1)} 分。缺口补齐并按每项 ${targetRate}% 得分率计分后，预计可达 ${score.value.goal.toFixed(1)} 分。`
})

const missingText = computed(() =>
  props.data.missingSlots
    .filter((slot) => slot.required)
    .map((slot) => slot.title)
    .join('、')
)

const extraText = computed(() =>
  props.data.missingSlots
    .filter((slot) => !slot.required)
    .map((slot) => slot.title)
    .join('、')
)

const materials = computed(() => props.data.materials ?? [])

const referenceCount = computed(() => materials.value.filter((item) => item.referenceOnly).length)

const stale = computed(
  () => new Date(props.data.updatedAt).getTime() > new Date(props.data.scoredAt).getTime() + 1000
)

const scoredAtText = computed(() => new Date(props.data.scoredAt).toLocaleString('zh-CN'))

const formatMoney = (value: number | undefined) => {
  if (typeof value !== 'number' || value <= 0) return ''
  if (value >= 100000000) return `${(value / 100000000).toFixed(2).replace(/\.?0+$/, '')} 亿元`
  if (value >= 10000) return `${(value / 10000).toFixed(2).replace(/\.?0+$/, '')} 万元`
  return `${value} 元`
}

const industryText = computed(
  () => props.data.company.industryName || props.data.company.industryCode || ''
)

const businessScope = computed(() => (props.data.company.businessScope ?? '').trim())

const capitalText = computed(() => formatMoney(props.data.company.registeredCapital))

const establishedText = computed(() => {
  const raw = (props.data.company.establishedDate ?? '').trim()
  if (!raw) return ''
  const span = yearsSinceDate(raw)
  return span === null ? raw : `${raw}（${span} 年）`
})

const facts = computed(
  () =>
    [
      industryText.value ? { label: '行业', value: industryText.value } : null,
      capitalText.value ? { label: '注册资本', value: capitalText.value } : null,
      establishedText.value ? { label: '成立日期', value: establishedText.value } : null,
      businessScope.value ? { label: '经营范围', value: businessScope.value, scope: true } : null
    ].filter(Boolean) as { label: string; value: string; scope?: boolean }[]
)
</script>

<template>
  <div class="report">
    <section class="hero">
      <div class="id">
        <h1>{{ data.company.name }}</h1>
        <p>统计期间 {{ data.period.y2 }}–{{ data.period.y0 }}</p>
        <dl v-if="facts.length > 0" class="facts">
          <div v-for="item in facts" :key="item.label">
            <dt>{{ item.label }}</dt>
            <dd :class="{ scope: item.scope }">{{ item.value }}</dd>
          </div>
        </dl>
      </div>

      <div class="scores">
        <div class="main">
          <span class="num">{{ score ? score.official.toFixed(1) : '—' }}</span>
          <span class="unit">/ 100</span>
          <span class="cap">当前参考得分</span>
        </div>
        <div class="side">
          <div>
            <span class="cap">补齐并达标后</span>
            <b>{{ score ? score.goal.toFixed(1) : '—' }}</b>
          </div>
          <div>
            <span class="cap">达标参考线</span>
            <b>{{ score?.passLine ?? '—' }}</b>
          </div>
          <em :class="score?.passed ? 'ok' : 'warn'">
            {{ verdict }}
          </em>
        </div>
      </div>

      <p class="score-note">（打分口径从严，参考分偏低；实际申报会按政策放宽）</p>

      <p class="headline">{{ headline }}</p>
      <p v-if="saved" class="saved">
        这份报告已经存好。下次在首页「我的历史报告」里可以直接打开；换设备时用企业全称 +
        手机号后四位找回。
      </p>
    </section>

    <p v-if="missingText" class="alert">
      缺少 {{ missingText }}，这几项按中性值估算，补齐后分数会明显变化。
    </p>

    <p v-if="extraText" class="alert soft">未提交 {{ extraText }}，相关条目在下方按材料缺失显示。</p>

    <p v-if="stale" class="alert">
      材料已更新，但这份报告是 {{ scoredAtText }} 的快照。重新评估后才会按新材料计分。
    </p>

    <section class="card">
      <h2>五个维度</h2>
      <p class="sub">深色为当前得分，浅色虚线为材料补齐并按每项 {{ targetRate }}% 得分率计分后的估算位置。</p>
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

    <section v-if="materials.length > 0" class="card">
      <details class="fold">
        <summary>
          <span class="fold-title">本次收到的材料</span>
          <span class="fold-meta">
            共 {{ materials.length }} 份<template v-if="referenceCount > 0">，参考 {{ referenceCount }} 份</template>
          </span>
          <span class="fold-toggle" />
        </summary>
        <ul class="materials">
          <li v-for="item in materials" :key="item.fileId">
            <span class="m-name">{{ item.name }}</span>
            <span class="m-slot">{{ item.slotTitle ?? '未分槽' }}</span>
            <span class="m-type">{{ item.docType ?? '待判型' }}</span>
            <em v-if="item.referenceOnly" class="m-ref">参考</em>
          </li>
        </ul>
      </details>
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

    <section v-if="data.warnings.length > 0" class="card">
      <details class="fold">
        <summary>
          <span class="fold-title">解析提示</span>
          <span class="fold-meta">{{ data.warnings.length }} 条</span>
          <span class="fold-toggle" />
        </summary>
        <ul class="warnings">
          <li v-for="warning in data.warnings" :key="warning">{{ warning }}</li>
        </ul>
      </details>
    </section>

    <section v-if="businessScope" class="card appendix">
      <h2>附录 · 企业基本信息</h2>
      <dl>
        <div>
          <dt>企业名称</dt>
          <dd>{{ data.company.name }}</dd>
        </div>
        <div v-if="industryText">
          <dt>行业</dt>
          <dd>{{ industryText }}</dd>
        </div>
        <div>
          <dt>经营范围</dt>
          <dd class="full">{{ businessScope }}</dd>
        </div>
      </dl>
      <p class="source">经营范围识别自营业执照，以营业执照原件为准。</p>
    </section>

    <footer class="actions">
      <div class="tips">
        <span>参考得分非官方口径，仅供申报前自查。</span>
        <span>「补齐并达标后」按每项 {{ targetRate }}% 得分率推算，不是承诺分。</span>
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

.facts {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #e2ecfa;
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-width: 640px;
}

.facts > div,
.appendix dl > div {
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.facts dt,
.appendix dt {
  flex: 0 0 76px;
  font-size: 11.5px;
  color: #a3adbb;
}

.facts dd,
.appendix dd {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: #475569;
}

.facts dd.scope {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.appendix h2 {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}

.appendix dl {
  margin: 14px 0 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.appendix dd.full {
  line-height: 1.9;
  white-space: pre-wrap;
}

.appendix .source {
  margin-top: 12px;
  font-size: 11px;
  color: #a3adbb;
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

.score-note {
  margin-top: 10px;
  font-size: 11.5px;
  line-height: 1.6;
  color: #a3adbb;
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

.fold > summary {
  display: flex;
  align-items: baseline;
  gap: 10px;
  cursor: pointer;
  list-style: none;
}

.fold > summary::-webkit-details-marker {
  display: none;
}

.fold-title {
  font-size: 15px;
  font-weight: 600;
  color: #111827;
}

.fold-meta {
  font-size: 11.5px;
  color: #a3adbb;
}

.fold-toggle {
  margin-left: auto;
  font-size: 11.5px;
  color: #2563eb;
}

.fold-toggle::after {
  content: '展开';
}

.fold[open] .fold-toggle::after {
  content: '收起';
}

.fold[open] > summary {
  margin-bottom: 12px;
}

.warnings {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.warnings li {
  padding: 9px 12px;
  border-radius: 8px;
  background: #f8fafc;
  color: #64748b;
  font-size: 12px;
  line-height: 1.7;
}

.dims {
  display: grid;
  grid-template-columns: 400px minmax(0, 1fr);
  align-items: center;
  gap: 18px;
}

.materials {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.materials li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 10px;
  border-radius: 8px;
  background: #fafbfd;
  font-size: 12px;
}

.m-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
}

.m-slot,
.m-type {
  color: #94a3b8;
  font-size: 11px;
}

.m-ref {
  font-style: normal;
  padding: 1px 6px;
  border-radius: 5px;
  background: #f1f5f9;
  color: #64748b;
  font-size: 10.5px;
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
