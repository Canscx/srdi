import { formatValue } from '@srdi/shared'
import type { FieldEntry, GateResult, IndicatorResult, Totals } from '@srdi/shared'
import { FLAG_TEXT, GATE_BASIS_TEXT, GATE_EFFECT_TEXT, GATE_VERDICT_TEXT } from '@srdi/shared'

export const GROUP_ORDER = ['company', 'fin', 'ip', 'std', 'qual', 'hr', 'other']

export const n2 = (value: number): string => value.toFixed(2)

export const pct1 = (value: number): string => `${(value * 100).toFixed(1)}%`

export const rangeText = (totals: Totals): string =>
  totals.conservative === totals.optimistic
    ? n2(totals.official)
    : `${n2(totals.conservative)} – ${n2(totals.optimistic)}`

export const rangeShort = (totals: Totals): string =>
  totals.conservative === totals.optimistic
    ? n2(totals.official)
    : `${n2(totals.conservative)}–${n2(totals.optimistic)}`

export const formatDateTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const fieldGroupOf = (key: string): string => {
  const index = key.indexOf('.')
  const prefix = index > 0 ? key.slice(0, index) : 'other'
  return GROUP_ORDER.includes(prefix) ? prefix : 'other'
}

const entryUnit = (entry: FieldEntry): string | undefined => {
  if (entry.type === 'money') return 'CNY'
  if (entry.type === 'ratio') return 'percent'
  return undefined
}

export const formatEvidenceValue = (entry: FieldEntry): string => {
  const value = entry.value
  if (value === undefined || value === null || value === '') return '—'

  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    if (value.every((item) => typeof item === 'number')) {
      return (value as number[]).map((item) => formatValue(item)).join(' / ')
    }
    if (value.every((item) => typeof item === 'string')) {
      return (value as string[]).join('、')
    }
    return `${value.length} 条`
  }

  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'number') return formatValue(value, entryUnit(entry))
  if (typeof value === 'string') return value

  const rows = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => Number(left) - Number(right)
  )
  return rows
    .map(([key, item]) =>
      typeof item === 'number'
        ? `${key} ${formatValue(item, entryUnit(entry))}`
        : `${key} ${String(item)}`
    )
    .join(' · ')
}

export const indicatorRawText = (value: number | null, unit?: string): string => {
  if (value === null || !Number.isFinite(value)) return '—'
  const text = formatValue(value, unit)
  if (unit === 'year') return `${text} 年`
  if (unit === 'point') return `${text} 分`
  return text
}

export const scoreRateText = (score: number | null): string =>
  score === null ? '—' : `${(score * 100).toFixed(1)}%`

export const flagText = (flag: string): string => FLAG_TEXT[flag] ?? flag

export const indicatorFlagsText = (item: IndicatorResult, missingFields: string[]): string => {
  const flags = item.flags.map(flagText)
  if (item.basis === 'absent' && flags.length === 0) {
    flags.push(missingFields.length > 0 ? `缺 ${missingFields.length} 字段` : '缺证据')
  }
  return flags.length > 0 ? flags.join('、') : '—'
}

export const gateVerdictText = (gate: GateResult): string =>
  GATE_VERDICT_TEXT[gate.verdict] ?? gate.verdict

export const gateEffectText = (gate: GateResult): string =>
  GATE_EFFECT_TEXT[gate.effective] ?? gate.effective

export const gateBasisText = (gate: GateResult): string =>
  GATE_BASIS_TEXT[gate.basis] ?? gate.basis
