import { FLAG } from './flags'
import { PERIOD_KEYS, scalarSeries, slotIndex } from './series'
import type {
  BenchmarkLookup,
  BenchmarksDoc,
  EvidenceDoc,
  FieldEntry,
  IndexKey,
  PeriodKey,
  Row,
  RulesDoc,
  ScoringModel,
  Series,
  Slot,
  Val
} from './types'

export interface EvalContext {
  period: Record<PeriodKey, number>
  benchmark(key: string): BenchmarkLookup | null
  readField(key: string): Val
  readIndexed(key: string, idx: IndexKey): Val
}

const none = (reason: 'missing' | 'pending' | 'error', refs: string[]): Val => ({
  kind: 'none',
  reason,
  refs,
  flags: []
})

const isYearKey = (key: string): boolean => /^\d{4}$/.test(key)

const toRow = (item: unknown): Row => {
  if (typeof item === 'string') return { value: { str: item } }
  if (typeof item === 'number') return { value: { num: item } }
  if (typeof item === 'boolean') return { value: { bool: item } }
  if (item && typeof item === 'object') {
    const row: Row = {}
    for (const [key, raw] of Object.entries(item as Record<string, unknown>)) {
      if (typeof raw === 'number') row[key] = { num: raw }
      else if (typeof raw === 'string') row[key] = { str: raw }
      else if (typeof raw === 'boolean') row[key] = { bool: raw }
    }
    return row
  }
  return {}
}

const seriesFromArray = (values: number[]): Series => ({
  slots: PERIOD_KEYS.map((_, index) => {
    const value = values[index]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return { state: 'ok', num: value, flags: [FLAG.PERIOD_ORDER_ASSUMED] }
    }
    return { state: 'missing', num: 0, flags: [] }
  })
})

const seriesFromYearDict = (dict: Record<string, unknown>, period: Record<PeriodKey, number>): Series => ({
  slots: PERIOD_KEYS.map((key) => {
    const raw = dict[String(period[key])]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return { state: 'ok', num: raw, flags: [] }
    }
    return { state: 'missing', num: 0, flags: [] }
  })
})

const entryToVal = (entry: FieldEntry | undefined, key: string, period: Record<PeriodKey, number>): Val => {
  if (!entry) return none('missing', [key])
  if (entry.status === 'candidate') return none('pending', [key])
  if (entry.status !== 'confirmed') return none('missing', [key])

  const value = entry.value
  if (value === null || value === undefined) return none('missing', [key])

  if (Array.isArray(value)) {
    if (value.length === 0) return { kind: 'rows', r: [], flags: [] }
    if (value.every((item) => typeof item === 'number')) {
      return { kind: 'series', s: seriesFromArray(value as number[]), flags: [FLAG.PERIOD_ORDER_ASSUMED] }
    }
    return { kind: 'rows', r: value.map(toRow), flags: [] }
  }

  if (typeof value === 'number') {
    if (entry.periodic) {
      const series = scalarSeries(value, [FLAG.PERIOD_ASSUMED])
      return {
        kind: 'series',
        s: { slots: [series.slots[0], { state: 'missing', num: 0, flags: [] }, { state: 'missing', num: 0, flags: [] }] },
        flags: [FLAG.PERIOD_ASSUMED]
      }
    }
    return { kind: 'num', v: value, flags: [] }
  }

  if (typeof value === 'boolean') return { kind: 'bool', v: value, flags: [] }
  if (typeof value === 'string') return { kind: 'str', v: value, flags: [] }

  const keys = Object.keys(value)
  if (keys.length > 0 && keys.every(isYearKey)) {
    return { kind: 'series', s: seriesFromYearDict(value as Record<string, unknown>, period), flags: [] }
  }

  return { kind: 'rows', r: [toRow(value)], flags: [] }
}

const slotToVal = (item: Slot, key: string): Val => {
  if (item.state === 'ok') return { kind: 'num', v: item.num, flags: item.flags }
  if (item.state === 'pending') return none('pending', [key])
  if (item.state === 'excluded') return none('missing', [key])
  return none('missing', [key])
}

const rowYear = (row: Row): number | null => {
  const year = row.year
  if (year && typeof year.num === 'number') return year.num
  return null
}

const filterRows = (rows: Row[], keep: (row: Row) => boolean): Val => ({
  kind: 'rows',
  r: rows.filter(keep),
  flags: []
})

const indexYears = (idx: IndexKey, period: Record<PeriodKey, number>): number[] => {
  if (idx.kind === 'period') return [period[idx.key]]
  if (idx.kind === 'year') return [idx.year]
  if (idx.kind === 'range') return [...indexYears(idx.from, period), ...indexYears(idx.to, period)]
  return Object.values(period)
}

export const buildContext = (model: ScoringModel, rules: RulesDoc): EvalContext => {
  const evidence: EvidenceDoc = model.evidence
  const period = evidence.period
  const cache = new Map<string, Val>()

  const industryCode = model.industryCode ?? evidence.company?.industryCode ?? null
  const benchEntry = industryCode
    ? model.benchmarks.industries.find((item) => item.code === industryCode)
    : undefined
  const profile = benchEntry ? benchEntry.profile : model.benchmarks.default
  const source: 'industry' | 'default' = benchEntry ? 'industry' : 'default'

  const readField = (key: string): Val => {
    const hit = cache.get(key)
    if (hit) return hit
    const val = entryToVal(evidence.fields[key], key, period)
    cache.set(key, val)
    return val
  }

  const readIndexed = (key: string, idx: IndexKey): Val => {
    const base = readField(key)

    if (base.kind === 'none') return base

    if (idx.kind === 'range') {
      const years = indexYears(idx, period)
      const min = Math.min(...years)
      const max = Math.max(...years)
      if (base.kind === 'rows') return filterRows(base.r, (row) => {
        const year = rowYear(row)
        return year !== null && year >= min && year <= max
      })
      if (base.kind === 'series') {
        return {
          kind: 'series',
          s: {
            slots: base.s.slots.map((item, index) => {
              const yearValue = period[PERIOD_KEYS[index]]
              return yearValue >= min && yearValue <= max ? item : { state: 'excluded', num: 0, flags: [] }
            })
          },
          flags: base.flags
        }
      }
      return none('error', [key])
    }

    if (idx.kind === 'others') {
      if (base.kind === 'rows') {
        const window = new Set(Object.values(period))
        return filterRows(base.r, (row) => {
          const year = rowYear(row)
          return year !== null && !window.has(year)
        })
      }
      return none('missing', [key])
    }

    if (idx.kind === 'year') {
      if (base.kind === 'rows') return filterRows(base.r, (row) => rowYear(row) === idx.year)
      if (base.kind === 'series') {
        const target = PERIOD_KEYS.findIndex((pk) => period[pk] === idx.year)
        if (target < 0) return none('missing', [key])
        return slotToVal(base.s.slots[target], key)
      }
      return base.kind === 'num' && period.y0 === idx.year ? base : none('missing', [key])
    }

    const position = slotIndex(idx.key)
    if (base.kind === 'series') return slotToVal(base.s.slots[position], key)
    if (base.kind === 'num') return position === 0 ? base : none('missing', [key])
    if (base.kind === 'rows') return filterRows(base.r, (row) => rowYear(row) === period[idx.key])

    return none('error', [key])
  }

  const benchmark = (key: string): BenchmarkLookup | null => {
    const value = (profile as unknown as Record<string, unknown>)[key]
    if (typeof value !== 'number') return null
    return { key, value, source }
  }

  return { period, benchmark, readField, readIndexed }
}
