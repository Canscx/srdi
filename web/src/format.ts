import type { CatalogFieldMeta, FieldEntry } from '@srdi/shared'

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
