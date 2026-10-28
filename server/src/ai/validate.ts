import Ajv from 'ajv'
import type { PageDoc, PeriodWindow } from '@srdi/shared'
import { findCatalogField, type CatalogField } from '../config/catalog'
import { DOC_TYPE_VALUES } from './prompt'

export interface RawField {
  key: string
  found: boolean
  period?: number | null
  value?: unknown
  unit?: string
  raw?: string
  page?: number
  quote?: string
  confidence?: number
}

export interface RawExtraction {
  pageRange?: number[]
  fields: RawField[]
  documentMeta?: {
    docType?: string
    companyName?: string
    reportYear?: number
  }
  unreadable?: { page: number; reason: string }[]
}

export interface ValidatedField {
  key: string
  value: number | string | boolean | unknown[]
  unit?: string
  period: number | null
  raw: string
  confidence: number
  page: number
  quote?: string
  quoteMatched: boolean | null
  route: 'text' | 'vision'
  flags: string[]
}

export interface FieldDrop {
  key: string
  page: number | null
  reason: string
}

export interface ValidateContext {
  allowedKeys: Set<string>
  pages: Map<number, PageDoc>
  period: PeriodWindow
  reportYear?: number
}

export interface ValidateResult {
  accepted: ValidatedField[]
  dropped: FieldDrop[]
  notFound: number
}

export const EXTRACTION_SHAPE = {
  type: 'object',
  required: ['fields'],
  properties: {
    pageRange: {
      type: 'array',
      items: { type: 'integer' },
      minItems: 2,
      maxItems: 2
    },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'found'],
        properties: {
          key: { type: 'string', minLength: 3 },
          found: { type: 'boolean' },
          period: { type: ['integer', 'null'] },
          value: { type: ['number', 'string', 'boolean', 'array', 'object', 'null'] },
          unit: { type: 'string' },
          raw: { type: 'string' },
          page: { type: 'integer', minimum: 1 },
          quote: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    },
    documentMeta: {
      type: 'object',
      properties: {
        docType: { enum: DOC_TYPE_VALUES },
        companyName: { type: 'string' },
        reportYear: { type: 'integer', minimum: 1900, maximum: 2100 }
      }
    },
    unreadable: {
      type: 'array',
      items: {
        type: 'object',
        required: ['page', 'reason'],
        properties: {
          page: { type: 'integer', minimum: 1 },
          reason: { type: 'string' }
        }
      }
    }
  }
}

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true })
const validateShape = ajv.compile(EXTRACTION_SHAPE)

export interface ShapeCheck {
  ok: boolean
  errors: string[]
  badKeys: string[]
}

export const checkShape = (data: unknown): ShapeCheck => {
  const ok = validateShape(data) as boolean
  if (ok) return { ok: true, errors: [], badKeys: [] }
  const errors = (validateShape.errors ?? []).map(
    (error) => `${error.instancePath || '/'} ${error.message ?? ''}`.trim()
  )
  const badKeys: string[] = []
  const fields = (data as { fields?: unknown })?.fields
  for (const error of validateShape.errors ?? []) {
    const matched = /^\/fields\/(\d+)/.exec(error.instancePath)
    if (!matched || !Array.isArray(fields)) continue
    const item = fields[Number(matched[1])] as { key?: unknown } | undefined
    if (item && typeof item.key === 'string') badKeys.push(item.key)
  }
  return { ok: false, errors, badKeys: [...new Set(badKeys)] }
}

export const parseExtractionText = (text: string): RawExtraction | null => {
  let raw = text.trim()
  if (!raw) return null
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(raw)
  if (fence) raw = fence[1].trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  const candidate = raw.slice(start, end + 1)
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const fields = (parsed as { fields?: unknown }).fields
    if (!Array.isArray(fields)) return null
    return parsed as RawExtraction
  } catch {
    return null
  }
}

export const readDocumentMeta = (data: RawExtraction | null) => {
  const docType = data?.documentMeta?.docType
  const reportYear = data?.documentMeta?.reportYear
  const companyName = data?.documentMeta?.companyName
  return {
    docType: typeof docType === 'string' && (DOC_TYPE_VALUES as string[]).includes(docType)
      ? (docType as (typeof DOC_TYPE_VALUES)[number])
      : undefined,
    reportYear: typeof reportYear === 'number' && Number.isInteger(reportYear) ? reportYear : undefined,
    companyName: typeof companyName === 'string' ? companyName.trim() : undefined
  }
}

interface UnitInfo {
  unit: string
  factor: number
  assumed: boolean
  scaled: boolean
}

const UNIT_TABLE: Record<string, { unit: string; factor: number }> = {
  cny: { unit: 'CNY', factor: 1 },
  rmb: { unit: 'CNY', factor: 1 },
  元: { unit: 'CNY', factor: 1 },
  人民币: { unit: 'CNY', factor: 1 },
  人民币元: { unit: 'CNY', factor: 1 },
  万元: { unit: 'CNY', factor: 10000 },
  万: { unit: 'CNY', factor: 10000 },
  cny_wan: { unit: 'CNY', factor: 10000 },
  亿元: { unit: 'CNY', factor: 100000000 },
  亿: { unit: 'CNY', factor: 100000000 },
  cny_yi: { unit: 'CNY', factor: 100000000 },
  '%': { unit: 'ratio', factor: 0.01 },
  '％': { unit: 'ratio', factor: 0.01 },
  percent: { unit: 'ratio', factor: 0.01 },
  percentage: { unit: 'ratio', factor: 0.01 },
  ratio: { unit: 'ratio', factor: 1 },
  count: { unit: 'count', factor: 1 },
  个: { unit: 'count', factor: 1 },
  项: { unit: 'count', factor: 1 },
  件: { unit: 'count', factor: 1 },
  家: { unit: 'count', factor: 1 },
  person: { unit: 'person', factor: 1 },
  人: { unit: 'person', factor: 1 },
  year: { unit: 'year', factor: 1 },
  年: { unit: 'year', factor: 1 },
  bool: { unit: 'bool', factor: 1 },
  text: { unit: 'text', factor: 1 },
  list: { unit: 'list', factor: 1 },
  date: { unit: 'date', factor: 1 }
}

const defaultUnit = (field: CatalogField) => {
  if (field.unit) return field.unit
  if (field.type === 'money') return 'CNY'
  if (field.type === 'ratio' || field.type === 'percent') return 'ratio'
  if (field.type === 'int') return 'count'
  if (field.type === 'bool') return 'bool'
  if (field.type === 'list') return 'list'
  if (field.type === 'date') return 'date'
  return 'text'
}

const NUMERIC_TYPES = new Set(['money', 'percent', 'ratio', 'int'])

const resolveUnit = (field: CatalogField, rawUnit: unknown): UnitInfo | null => {
  const target = defaultUnit(field)
  if (typeof rawUnit !== 'string' || !rawUnit.trim()) {
    return { unit: target, factor: 1, assumed: true, scaled: false }
  }
  const key = rawUnit
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（(].*?[)）]/g, '')
  const base = key.split('/')[0] || key
  const found = UNIT_TABLE[key] ?? UNIT_TABLE[base]
  if (!found) return null
  if (field.unit && found.unit !== field.unit) return null
  if (!NUMERIC_TYPES.has(field.type) && found.unit === 'CNY') return null
  const percentAsPoint = field.type === 'percent' && found.unit === 'ratio'
  const factor = percentAsPoint ? 1 : found.factor
  return {
    unit: target,
    factor,
    assumed: false,
    scaled: factor !== 1 || (found.unit !== target && target !== 'CNY')
  }
}

const parseNumeric = (input: unknown): { value: number; factor: number } | null => {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? { value: input, factor: 1 } : null
  }
  if (typeof input !== 'string') return null
  let text = input.trim()
  if (!text) return null
  let sign = 1
  if (/^\(.*\)$/.test(text)) {
    sign = -1
    text = text.slice(1, -1)
  }
  text = text.replace(/[,，\s¥￥]/g, '')
  let factor = 1
  if (/亿$/.test(text)) {
    factor = 100000000
    text = text.slice(0, -1)
  } else if (/万$/.test(text)) {
    factor = 10000
    text = text.slice(0, -1)
  }
  if (/[%％]$/.test(text)) {
    factor *= 0.01
    text = text.slice(0, -1)
  }
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return { value: value * sign, factor }
}

const BOOL_TRUE = new Set(['是', '有', 'true', 'yes', 'y', '1', '具备', '符合'])
const BOOL_FALSE = new Set(['否', '无', 'false', 'no', 'n', '0', '不具备', '不符合'])

const coerceBool = (input: unknown): boolean | null => {
  if (typeof input === 'boolean') return input
  if (typeof input === 'number') return input === 1 ? true : input === 0 ? false : null
  if (typeof input !== 'string') return null
  const text = input.trim().toLowerCase()
  if (BOOL_TRUE.has(text)) return true
  if (BOOL_FALSE.has(text)) return false
  return null
}

const normalizeForMatch = (text: string) =>
  text.replace(/\s+/g, '').replace(/[,，¥￥]/g, '').toLowerCase()

const pageHaystack = (page: PageDoc) => {
  const tables = page.tables.filter((table) => table.text && !page.text.includes(table.text))
  return [page.text, ...tables.map((table) => table.text)].join('\n')
}

const round = (value: number) => Math.round(value * 1000) / 1000

export const validateFields = (raw: RawField[], ctx: ValidateContext): ValidateResult => {
  const accepted: ValidatedField[] = []
  const dropped: FieldDrop[] = []
  const seen = new Set<string>()
  let notFound = 0

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const key = typeof item.key === 'string' ? item.key : ''
    const page = typeof item.page === 'number' && Number.isInteger(item.page) ? item.page : null
    if (item.found !== true) {
      notFound += 1
      continue
    }
    if (!ctx.allowedKeys.has(key)) {
      dropped.push({ key, page, reason: 'key_not_allowed' })
      continue
    }
    const field = findCatalogField(key)
    if (!field) {
      dropped.push({ key, page, reason: 'field_not_in_catalog' })
      continue
    }

    let resolvedPage = page
    const flags: string[] = []
    if (resolvedPage === null) {
      if (ctx.pages.size === 1) {
        resolvedPage = [...ctx.pages.keys()][0]
        flags.push('page_assumed')
      } else {
        dropped.push({ key, page: null, reason: 'page_missing' })
        continue
      }
    }
    const pageDoc = ctx.pages.get(resolvedPage)
    if (!pageDoc) {
      dropped.push({ key, page: resolvedPage, reason: 'page_out_of_range' })
      continue
    }

    let unitInfo: UnitInfo | null = null
    if (NUMERIC_TYPES.has(field.type)) {
      unitInfo = resolveUnit(field, item.unit)
      if (!unitInfo) {
        dropped.push({ key, page: resolvedPage, reason: 'unit_invalid' })
        continue
      }
    }

    let value: ValidatedField['value'] | undefined
    if (NUMERIC_TYPES.has(field.type)) {
      const parsed = parseNumeric(item.value)
      if (!parsed) {
        dropped.push({ key, page: resolvedPage, reason: 'value_not_numeric' })
        continue
      }
      const factor = parsed.factor * (unitInfo?.factor ?? 1)
      let numeric = parsed.value * factor
      if (field.type === 'int') {
        const rounded = Math.round(numeric)
        if (Math.abs(numeric - rounded) > 0.001) flags.push('int_rounded')
        numeric = rounded
      }
      if ((field.type === 'ratio' || field.type === 'percent') && Math.abs(numeric) > 5) {
        dropped.push({ key, page: resolvedPage, reason: 'ratio_out_of_range' })
        continue
      }
      value = round(numeric)
      if (unitInfo?.scaled) flags.push('unit_scaled')
      if (unitInfo?.assumed) flags.push('unit_assumed')
    } else if (field.type === 'bool') {
      const bool = coerceBool(item.value)
      if (bool === null) {
        dropped.push({ key, page: resolvedPage, reason: 'value_not_boolean' })
        continue
      }
      value = bool
    } else if (field.type === 'enum') {
      const text = typeof item.value === 'string' ? item.value.trim() : ''
      const allowed = field.enumValues ?? []
      if (!text || (allowed.length > 0 && !allowed.includes(text))) {
        dropped.push({ key, page: resolvedPage, reason: 'enum_invalid' })
        continue
      }
      value = text
    } else if (field.type === 'list') {
      if (Array.isArray(item.value)) {
        value = item.value
      } else if (typeof item.value === 'string' && item.value.trim()) {
        value = item.value.split(/[,，、;；\n]/).map((part) => part.trim()).filter(Boolean)
        flags.push('list_from_string')
      }
      if (!Array.isArray(value)) {
        dropped.push({ key, page: resolvedPage, reason: 'value_not_list' })
        continue
      }
    } else if (field.type === 'date') {
      const text = typeof item.value === 'string' ? item.value.trim() : ''
      if (!/^\d{4}(-\d{2}){0,2}$/.test(text)) {
        dropped.push({ key, page: resolvedPage, reason: 'value_not_date' })
        continue
      }
      value = text
    } else {
      const text =
        typeof item.value === 'string'
          ? item.value.trim()
          : typeof item.value === 'number'
            ? String(item.value)
            : ''
      if (!text) {
        dropped.push({ key, page: resolvedPage, reason: 'value_empty' })
        continue
      }
      value = text.length > 2000 ? text.slice(0, 2000) : text
      if (text.length > 2000) flags.push('text_truncated')
    }

    let period: number | null = null
    if (field.periodic) {
      const candidate = typeof item.period === 'number' && Number.isInteger(item.period) ? item.period : null
      if (candidate !== null && candidate >= ctx.period.y2 - 5 && candidate <= ctx.period.y0 + 1) {
        period = candidate
      } else if (ctx.reportYear !== undefined && ctx.reportYear >= ctx.period.y2 - 5) {
        period = ctx.reportYear
        flags.push('period_assumed')
      } else {
        dropped.push({ key, page: resolvedPage, reason: 'period_invalid' })
        continue
      }
    }

    let confidence =
      typeof item.confidence === 'number' && item.confidence >= 0 && item.confidence <= 1
        ? item.confidence
        : 0.5
    if (item.confidence === undefined) flags.push('confidence_default')

    const quote = typeof item.quote === 'string' ? item.quote.trim() : ''
    let quoteMatched: boolean | null = null
    if (pageDoc.route === 'text') {
      if (!quote) {
        quoteMatched = null
        confidence = Math.min(confidence, 0.5)
        flags.push('quote_missing')
      } else {
        const haystack = normalizeForMatch(pageHaystack(pageDoc))
        const needle = normalizeForMatch(quote)
        quoteMatched = needle.length > 0 && haystack.includes(needle)
        if (!quoteMatched) {
          confidence = Math.min(confidence, 0.5)
          flags.push('quote_unverified')
        }
      }
    }

    const rawText =
      typeof item.raw === 'string' && item.raw.trim()
        ? item.raw.trim()
        : typeof item.value === 'string'
          ? item.value.trim()
          : String(item.value)
    const dedupeKey = `${key}|${resolvedPage}|${typeof value === 'object' ? JSON.stringify(value) : String(value)}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    accepted.push({
      key,
      value,
      unit: unitInfo?.unit ?? (field.unit || undefined),
      period,
      raw: rawText.slice(0, 500),
      confidence: Math.round(confidence * 100) / 100,
      page: resolvedPage,
      quote: quote || undefined,
      quoteMatched,
      route: pageDoc.route,
      flags
    })
  }

  return { accepted, dropped, notFound }
}
