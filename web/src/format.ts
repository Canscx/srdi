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

export {
  CONCLUSION_TEXT,
  DOC_TYPE_TEXT,
  FLAG_TEXT,
  GATE_BASIS_TEXT,
  GATE_VERDICT_TEXT,
  INDICATOR_STATUS_TEXT
} from '@srdi/shared'

export const formatIndicatorRaw = (value: number | null, unit?: string): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  const text = formatValue(value, unit)
  if (unit === 'year') return `${text} 年`
  if (unit === 'point') return `${text} 分`
  return text
}

export const formatScoreRate = (score: number | null): string =>
  score === null ? '—' : `${(score * 100).toFixed(1)}%`
