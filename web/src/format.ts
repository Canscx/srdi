import type { CatalogFieldMeta, FieldEntry } from '@srdi/shared'
import { formatValue } from '@srdi/shared'

export interface Segment {
  text: string
  hit: boolean
}

const escapeReg = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const highlightSegments = (text: string, quote?: string): Segment[] => {
  if (!text) return []
  const needle = (quote ?? '').trim()
  if (!needle) return [{ text, hit: false }]

  const direct = text.indexOf(needle)
  if (direct >= 0) {
    return [
      { text: text.slice(0, direct), hit: false },
      { text: needle, hit: true },
      { text: text.slice(direct + needle.length), hit: false }
    ].filter((segment) => segment.text.length > 0)
  }

  const pattern = needle
    .replace(/\s+/g, '')
    .split('')
    .map(escapeReg)
    .join('\\s*')
  if (!pattern) return [{ text, hit: false }]
  const matched = new RegExp(pattern).exec(text)
  if (!matched) return [{ text, hit: false }]
  return [
    { text: text.slice(0, matched.index), hit: false },
    { text: matched[0], hit: true },
    { text: text.slice(matched.index + matched[0].length), hit: false }
  ].filter((segment) => segment.text.length > 0)
}

const numberText = (value: number) =>
  value.toLocaleString('zh-CN', { maximumFractionDigits: 3 })

export const formatFieldValue = (
  field: Pick<CatalogFieldMeta, 'type' | 'unit'>,
  value: unknown
): string => {
  if (value === undefined || value === null || value === '') return ''
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== null && item !== undefined && item !== '')
      .sort(([left], [right]) => Number(left) - Number(right))
    if (entries.length === 0) return ''
    return entries
      .map(([key, item]) => `${key} ${formatFieldValue(field, item)}`)
      .join(' · ')
  }
  if (field.type === 'money') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? `¥${numberText(numeric)}` : String(value)
  }
  if (field.type === 'ratio') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(2)}%` : String(value)
  }
  if (field.type === 'percent') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? `${numberText(numeric)}%` : String(value)
  }
  if (field.type === 'bool') return value ? '是' : '否'
  if (field.type === 'int') {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? numberText(numeric) : String(value)
  }
  if (Array.isArray(value)) return `${value.length} 项`
  return String(value)
}

export const entryDisplay = (
  field: CatalogFieldMeta,
  entry: FieldEntry,
  fallback?: unknown
) => {
  if (entry.status === 'confirmed') return formatFieldValue(field, entry.value)
  if (fallback === undefined || fallback === null) return ''
  return formatFieldValue(field, fallback)
}

export const STATUS_TEXT: Record<string, string> = {
  missing: '缺失',
  candidate: '待确认',
  confirmed: '已确认',
  rejected: '已否决'
}

export const STATUS_TYPE: Record<string, 'info' | 'warning' | 'success' | 'danger'> = {
  missing: 'info',
  candidate: 'warning',
  confirmed: 'success',
  rejected: 'danger'
}

export const DOC_TYPE_TEXT: Record<string, string> = {
  audit: '审计报告',
  application: '申报书',
  tax: '纳税证明',
  patent: '专利清单',
  cert: '证书资质',
  standard: '标准文本',
  finance: '财务报表',
  other: '其他'
}

export const SKIP_TEXT: Record<string, string> = {
  multiple_candidates: '多候选冲突',
  low_confidence: '置信度不足',
  empty_value: '候选无数值',
  quote_unverified: '原文未匹配'
}

export const confidenceTone = (confidence?: number) => {
  if (confidence === undefined) return 'unknown'
  if (confidence >= 0.9) return 'high'
  if (confidence >= 0.7) return 'mid'
  return 'low'
}

export const INDICATOR_STATUS_TEXT: Record<string, string> = {
  scored: '已计分',
  estimated: '估算',
  missing: '缺证据',
  notApplicable: '不适用',
  excluded: '已排除'
}

export const GATE_VERDICT_TEXT: Record<string, string> = {
  pass: '满足',
  fail: '不满足',
  unknown: '材料不足',
  pending: '待确认'
}

export const GATE_BASIS_TEXT: Record<string, string> = {
  evidence: '证据判定',
  missing: '材料不足',
  unconfirmed: '待确认',
  mixed: '缺失 + 待确认',
  policy: '按策略放行',
  score: '分数判定'
}

export const CONCLUSION_TEXT: Record<string, string> = {
  pass: '门槛全过',
  fail: '存在硬性不满足',
  pending: '待补材料'
}

export const FLAG_TEXT: Record<string, string> = {
  negative_equity: '净资产为负',
  cost_nonpositive: '成本非正',
  revenue_nonpositive: '营收非正',
  base_negative: '基期为负',
  denominator_zero: '分母为零',
  partial_window: '窗口不完整',
  period_assumed: '期间推定',
  period_order_assumed: '年份顺序推定',
  period_not_in_window: '期间超窗',
  benchmark_default: '行业基准缺失',
  benchmark_missing: '基准缺失',
  partial_composite: '合成项不全',
  fallback_neutral: '中性兜底',
  guard_failed: '边界保护',
  not_finite: '非有限值',
  excluded: '按策略排除',
  gate_passed_by_policy: '策略放行',
  quote_unverified: '原文未匹配'
}

export const formatIndicatorRaw = (value: number | null, unit?: string): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  const text = formatValue(value, unit)
  if (unit === 'year') return `${text} 年`
  if (unit === 'point') return `${text} 分`
  return text
}

export const formatScoreRate = (score: number | null): string =>
  score === null ? '—' : `${(score * 100).toFixed(1)}%`
