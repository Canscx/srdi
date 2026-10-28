import { contributionOf } from '../aggregate'
import type { EvalContext } from '../context'
import { evalNode, evalTri, toNumber } from '../evaluate'
import { formatValue, renderExplain } from '../explain'
import { FLAG, guardFlag } from '../flags'
import { applyGrowthSignRule, detectGrowthShape } from '../guards'
import { parseExpr } from '../parser'
import { isComplete } from '../series'
import { mapBenchmarkCurve } from '../scorers/benchmark'
import { computeHhi } from '../scorers/hhi'
import { scoreComposite } from '../scorers/composite'
import { scoreFormulaSum } from '../scorers/formulaSum'
import { scoreManualTier } from '../scorers/manualTier'
import { scorePiecewise } from '../scorers/piecewise'
import { scoreTier } from '../scorers/tier'
import { COMPOSITE_REFS, MANUAL_FIELD_OVERRIDES, sourceOf } from './registry'
import type {
  BenchmarkLookup,
  CompositeSpec,
  Flag,
  FormulaSumSpec,
  HhiSpec,
  IndicatorBasis,
  IndicatorDef,
  IndicatorResult,
  IndicatorStatus,
  ManualTierSpec,
  PiecewiseSpec,
  Quality,
  Rewrite,
  ScoringSpec,
  TierSpec,
  Val
} from '../types'

type ValueKind = 'num' | 'series' | 'rows' | 'bool' | 'str' | 'none'

interface Trace {
  normalizedExpr: string
  rewrites: Rewrite[]
  valueKind: ValueKind
}

interface Derived {
  state: 'ok' | 'missing' | 'pending' | 'notApplicable'
  basis: IndicatorBasis
  s: number | null
  raw: number | null
  flags: Flag[]
  benchmark: BenchmarkLookup | null
  quality: Quality
  refs: string[]
  ratio?: number
  label?: string
  displayRaw?: number
  trace?: Trace
}

const emptyDerived = (state: Derived['state'], refs: string[], flags: Flag[] = [], trace?: Derived['trace']): Derived => ({
  state,
  basis: 'absent',
  s: null,
  raw: null,
  flags,
  benchmark: null,
  quality: 'unknown',
  refs,
  trace
})

const fromNone = (val: Extract<Val, { kind: 'none' }>, trace?: Derived['trace']): Derived =>
  emptyDerived(val.reason === 'pending' ? 'pending' : 'missing', val.refs, val.flags, trace)

const applyNumericSpec = (
  spec: ScoringSpec,
  x: number,
  ctx: EvalContext
): { s: number | null; flags: Flag[]; benchmark: BenchmarkLookup | null; quality: Quality } => {
  if (spec.type === 'piecewise') {
    return { s: scorePiecewise(spec, x).s, flags: [], benchmark: null, quality: 'verified' }
  }

  if (spec.type === 'benchmark') {
    const lookup = ctx.benchmark(spec.benchmarkKey)
    if (!lookup) {
      return { s: null, flags: [FLAG.BENCHMARK_MISSING], benchmark: null, quality: 'unknown' }
    }
    const result = mapBenchmarkCurve(x, lookup.value, spec.curve, spec.direction)
    return {
      s: result.s,
      flags: lookup.source === 'default' ? [FLAG.BENCHMARK_DEFAULT] : [],
      benchmark: lookup,
      quality: lookup.source === 'default' ? 'estimated' : 'verified'
    }
  }

  return { s: null, flags: [], benchmark: null, quality: 'unknown' }
}

const isPartialWindow = (def: IndicatorDef, ctx: EvalContext): boolean => {
  const window = def.aggregation?.window
  if (!window || window.length < 3) return false

  const refs = def.formula?.inputs ?? def.evidenceRefs ?? []
  for (const ref of refs) {
    const value = ctx.readField(ref)
    if (value.kind === 'series' && !isComplete(value.s)) return true
  }
  return false
}

const deriveFormula = (def: IndicatorDef, ctx: EvalContext): Derived => {
  if (!def.formula) return emptyDerived('missing', def.evidenceRefs ?? [])

  const parsed = parseExpr(def.formula.expr)
  const trace: Trace = { normalizedExpr: parsed.normalized, rewrites: parsed.rewrites, valueKind: 'num' }

  if (def.formula.guard) {
    const guard = parseExpr(def.formula.guard)
    const tri = evalTri(guard.ast, { ctx })
    if (tri.v === null) {
      return {
        state: tri.pending.length > 0 ? 'pending' : 'missing',
        basis: 'absent',
        s: null,
        raw: null,
        flags: tri.flags,
        benchmark: null,
        quality: 'unknown',
        refs: [...tri.missing, ...tri.pending],
        trace
      }
    }
    if (tri.v === false) {
      return {
        state: 'notApplicable',
        basis: 'notApplicable',
        s: 0,
        raw: null,
        flags: Array.from(new Set([guardFlag(def.formula.guard), FLAG.GUARD_FAILED])),
        benchmark: null,
        quality: 'unknown',
        refs: [...tri.missing, ...tri.pending],
        trace
      }
    }
  }

  const growth = detectGrowthShape(parsed.ast)
  if (growth) {
    const baseVal = evalNode(growth.base, { ctx })
    const currentVal = evalNode(growth.current, { ctx })
    if (baseVal.kind === 'none') return fromNone(baseVal, trace)
    if (currentVal.kind === 'none') return fromNone(currentVal, trace)
    if (baseVal.kind !== 'num' || currentVal.kind !== 'num') {
      return emptyDerived('missing', def.evidenceRefs ?? [], [], trace)
    }

    const rule = applyGrowthSignRule(baseVal.v, currentVal.v)
    if (!Number.isFinite(rule.value)) {
      return emptyDerived('missing', def.evidenceRefs ?? [], rule.flags, trace)
    }

    const applied = applyNumericSpec(def.scoring, rule.value, ctx)
    return {
      state: 'ok',
      basis: 'measured',
      s: applied.s,
      raw: rule.value,
      flags: [...rule.flags, ...applied.flags],
      benchmark: applied.benchmark,
      quality: applied.quality,
      refs: [],
      trace
    }
  }

  const value = evalNode(parsed.ast, { ctx })
  if (value.kind === 'none') return fromNone(value, trace)
  if (value.kind === 'rows' || value.kind === 'bool' || value.kind === 'str') {
    return emptyDerived('missing', def.evidenceRefs ?? [], [], trace)
  }

  const method = def.aggregation?.method ?? 'mean'
  const numeric = toNumber(value, method)
  if (numeric.value === null || !Number.isFinite(numeric.value)) {
    return emptyDerived('missing', def.evidenceRefs ?? [], numeric.flags, trace)
  }

  const partial = isPartialWindow(def, ctx)
  const applied = applyNumericSpec(def.scoring, numeric.value, ctx)

  return {
    state: 'ok',
    basis: 'measured',
    s: applied.s,
    raw: numeric.value,
    flags: [...numeric.flags, ...applied.flags, ...(partial ? [FLAG.PARTIAL_WINDOW] : [])],
    benchmark: applied.benchmark,
    quality: partial ? 'estimated' : applied.quality,
    refs: [],
    trace: { ...trace, valueKind: value.kind }
  }
}

const deriveTier = (def: IndicatorDef, ctx: EvalContext): Derived => {
  const spec = def.scoring as TierSpec
  const result = scoreTier(spec, (when) => evalTri(parseExpr(when).ast, { ctx }))

  if (result.status === 'indeterminate' || result.s === null) {
    return emptyDerived('missing', def.evidenceRefs ?? [])
  }

  return {
    state: 'ok',
    basis: 'measured',
    s: result.s,
    raw: result.points,
    flags: [],
    benchmark: null,
    quality: 'verified',
    refs: [],
    label: result.label ?? undefined
  }
}

const deriveManual = (def: IndicatorDef, ctx: EvalContext): Derived => {
  const spec = def.scoring as ManualTierSpec
  const field = MANUAL_FIELD_OVERRIDES[def.id] ?? def.evidenceRefs?.[0]
  if (!field) return emptyDerived('missing', [])

  const value = ctx.readField(field)
  if (value.kind === 'none') return fromNone(value)
  if (value.kind !== 'str') return emptyDerived('missing', [field])

  const result = scoreManualTier(spec, value.v)
  if (result.status !== 'hit' || result.s === null) return emptyDerived('missing', [field])

  return {
    state: 'ok',
    basis: 'measured',
    s: result.s,
    raw: result.points,
    flags: [],
    benchmark: null,
    quality: 'verified',
    refs: [],
    label: result.label ?? undefined
  }
}

const deriveHhi = (def: IndicatorDef, ctx: EvalContext): Derived => {
  const spec = def.scoring as HhiSpec
  const distribution = ctx.readField(spec.distributionRef)
  const total = ctx.readField(spec.totalRef)

  if (distribution.kind === 'none') return fromNone(distribution)
  if (total.kind === 'none') return fromNone(total)
  if (distribution.kind !== 'rows' || total.kind !== 'num') {
    return emptyDerived('missing', [spec.distributionRef, spec.totalRef])
  }

  const result = computeHhi(distribution.r, total.v)
  if (!result) return emptyDerived('missing', [spec.totalRef], [FLAG.DENOMINATOR_ZERO])

  const piecewise: PiecewiseSpec = { type: 'piecewise', points: spec.points, clamp: [0, 1], tail: 'hold' }
  return {
    state: 'ok',
    basis: 'measured',
    s: scorePiecewise(piecewise, result.hhi).s,
    raw: result.hhi,
    flags: [],
    benchmark: null,
    quality: 'verified',
    refs: []
  }
}

const deriveFormulaSum = (def: IndicatorDef, ctx: EvalContext): Derived => {
  const spec = def.scoring as FormulaSumSpec
  const counts = spec.terms.map((term) => {
    const value = evalNode(parseExpr(term.ref).ast, { ctx })
    return value.kind === 'num' ? value.v : null
  })

  const result = scoreFormulaSum(spec, counts)
  if (result.missing || result.s === null) return emptyDerived('missing', def.evidenceRefs ?? [])

  return {
    state: 'ok',
    basis: 'measured',
    s: result.s,
    raw: result.raw,
    flags: [],
    benchmark: null,
    quality: 'verified',
    refs: [],
    displayRaw: spec.terms.length === 1 && counts[0] !== null ? (counts[0] as number) : undefined
  }
}

const deriveComposite = (def: IndicatorDef, ctx: EvalContext): Derived => {
  const spec = def.scoring as CompositeSpec
  const refs = COMPOSITE_REFS[def.id] ?? []

  const numbers = refs.map((ref) => toNumber(evalNode(parseExpr(ref).ast, { ctx }), 'mean').value)

  const parts = spec.parts.map((part, index) => {
    const value = numbers[index]
    if (value === null || value === undefined || !Number.isFinite(value)) {
      return { weight: part.weight, s: null }
    }
    return { weight: part.weight, s: applyNumericSpec(part.scoring, value, ctx).s }
  })

  const result = scoreComposite(parts)
  if (result.s === null) return emptyDerived('missing', def.evidenceRefs ?? [])

  const headcount = numbers[0]
  const ratio = numbers[1]

  return {
    state: 'ok',
    basis: result.partial ? 'substituted' : 'measured',
    s: result.s,
    raw: headcount ?? null,
    flags: result.partial ? [FLAG.PARTIAL_COMPOSITE] : [],
    benchmark: null,
    quality: result.partial ? 'estimated' : 'verified',
    refs: [],
    ratio: ratio ?? undefined
  }
}

const derive = (def: IndicatorDef, ctx: EvalContext): Derived => {
  switch (sourceOf(def)) {
    case 'tierExpr':
      return deriveTier(def, ctx)
    case 'manualEnum':
      return deriveManual(def, ctx)
    case 'hhi':
      return deriveHhi(def, ctx)
    case 'formulaSum':
      return deriveFormulaSum(def, ctx)
    case 'composite':
      return deriveComposite(def, ctx)
    default:
      return deriveFormula(def, ctx)
  }
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

const explainText = (def: IndicatorDef, derived: Derived): string => {
  const template = def.explain?.template ?? ''
  if (!template) return def.name

  const ratio = derived.ratio !== undefined
    ? formatValue(derived.ratio, def.id === 'IND_20' ? 'percent' : def.unit)
    : '—'

  return renderExplain(template, {
    raw: derived.label ?? formatValue(derived.displayRaw ?? derived.raw, def.unit),
    benchmark: derived.benchmark ? formatValue(derived.benchmark.value, def.unit) : '—',
    ratio
  })
}

export const evaluateIndicator = (
  def: IndicatorDef,
  dimensionId: string,
  ctx: EvalContext,
  weight: { base: number; effective: number }
): IndicatorResult => {
  const base = {
    id: def.id,
    code: def.code,
    name: def.name,
    dimensionId,
    weight: weight.base,
    effectiveWeight: weight.effective
  }

  if (def.fallback?.type === 'exclude') {
    return {
      ...base,
      status: 'excluded',
      basis: 'excluded',
      quality: 'unknown',
      raw: null,
      score: null,
      contribution: { official: 0, conservative: 0, optimistic: 0 },
      benchmark: null,
      flags: [FLAG.EXCLUDED],
      explain: { template: def.explain?.template ?? '', text: def.fallback.reason ?? '按策略排除,不计分' },
      reason: def.fallback.reason
    }
  }

  const derived = derive(def, ctx)
  const text = explainText(def, derived)

  if (derived.state === 'ok' && derived.s !== null) {
    const s = clamp01(derived.s)
    return {
      ...base,
      status: (derived.quality === 'verified' ? 'scored' : 'estimated') as IndicatorStatus,
      basis: derived.basis,
      quality: derived.quality,
      raw: derived.raw,
      score: s,
      contribution: contributionOf(derived.basis, s, weight.effective),
      benchmark: derived.benchmark,
      flags: derived.flags,
      explain: { template: def.explain?.template ?? '', text },
      trace: derived.trace
    }
  }

  if (derived.state === 'notApplicable') {
    return {
      ...base,
      status: 'notApplicable',
      basis: 'notApplicable',
      quality: 'unknown',
      raw: null,
      score: 0,
      contribution: contributionOf('notApplicable', 0, weight.effective),
      benchmark: null,
      flags: derived.flags,
      explain: { template: def.explain?.template ?? '', text: `${text} · 指标不适用` },
      reason: derived.flags[0]
    }
  }

  if (def.fallback?.type === 'neutral') {
    const s = clamp01(def.fallback.score ?? 0.5)
    return {
      ...base,
      status: 'estimated',
      basis: 'substituted',
      quality: 'estimated',
      raw: null,
      score: s,
      contribution: contributionOf('substituted', s, weight.effective),
      benchmark: null,
      flags: [...derived.flags, FLAG.FALLBACK_NEUTRAL],
      explain: { template: def.explain?.template ?? '', text: `${def.name} · 按中性 ${s} 估算` },
      reason: def.fallback.reason
    }
  }

  return {
    ...base,
    status: 'missing',
    basis: 'absent',
    quality: 'unknown',
    raw: null,
    score: null,
    contribution: contributionOf('absent', 0, weight.effective),
    benchmark: null,
    flags: derived.flags,
    explain: { template: def.explain?.template ?? '', text: `${def.name} · 材料不足` },
    reason: derived.refs.length > 0 ? `缺少 ${derived.refs.join('、')}` : undefined
  }
}
