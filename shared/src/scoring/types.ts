export type PeriodKey = 'y0' | 'y1' | 'y2'
export type Flag = string

export type FieldStatus = 'missing' | 'candidate' | 'confirmed' | 'rejected'

export interface FieldEntry {
  key: string
  type?: 'money' | 'percent' | 'int' | 'ratio' | 'enum' | 'bool' | 'list' | 'text' | 'date'
  unit?: string
  periodic?: boolean
  status: FieldStatus
  value?: number | string | boolean | unknown[] | Record<string, unknown> | null
  flags?: string[]
}

export interface EvidenceDoc {
  schemaVersion: string
  projectId: string
  level: 'SRDI' | 'LITTLE_GIANT'
  rulesId: string
  benchmarksVersion?: string
  period: Record<PeriodKey, number>
  company?: {
    name?: string
    industryCode?: string
    industryName?: string
    subMarket?: string
    scope?: string
  }
  files?: unknown[]
  fields: Record<string, FieldEntry>
}

export interface BenchmarkMeta {
  source: string
  year: number
  sampleSize?: number
  confidence: string
}

export interface BenchmarkProfile {
  revenuePerEmployee: number
  roe: number
  costProfitMargin: number
  expenseRatio: number
  grossMargin: number
  revenueGrowth: number
  profitGrowth: number
  netAssetGrowth: number
  meta: BenchmarkMeta
}

export interface IndustryEntry {
  code: string
  name: string
  profile: BenchmarkProfile
}

export interface BenchmarksDoc {
  version: string
  note?: string
  default: BenchmarkProfile
  industries: IndustryEntry[]
}

export interface RuleCheck {
  id: string
  label: string
  expr: string
  exemption?: boolean
}

export type UnknownPolicy = 'notPass' | 'pending' | 'ignore'

export interface ExprGate {
  id: string
  name: string
  type: 'expr'
  logic: 'all' | 'anyOf'
  unknownPolicy: UnknownPolicy
  checks: RuleCheck[]
}

export interface ScoreGate {
  id: string
  name: string
  type: 'scoreGate'
  passLine: number
  totalKey: 'official' | 'conservative' | 'optimistic'
  unknownPolicy: UnknownPolicy
}

export type GateDef = ExprGate | ScoreGate

export interface PiecewiseSpec {
  type: 'piecewise'
  points: [number, number][]
  clamp?: [number, number]
  tail?: 'hold'
}

export interface TierSpec {
  type: 'tier'
  maxPoints: number
  tiers: { when: string; points: number; label: string }[]
}

export interface BenchmarkSpec {
  type: 'benchmark'
  direction: 'positive' | 'negative'
  benchmarkKey: keyof Omit<BenchmarkProfile, 'meta'>
  curve: { base: number; kUp: number; kDown: number }
}

export interface FormulaSumSpec {
  type: 'formulaSum'
  terms: { ref: string; coef: number }[]
  cap: number
}

export interface HhiSpec {
  type: 'hhi'
  distributionRef: string
  totalRef: string
  points: [number, number][]
}

export interface CompositePart {
  weight: number
  scoring: ScoringSpec
}

export interface CompositeSpec {
  type: 'composite'
  parts: CompositePart[]
}

export interface ManualTierSpec {
  type: 'manualTier'
  maxPoints: number
  options: { key: string; points: number; label: string }[]
}

export type ScoringSpec =
  | PiecewiseSpec
  | TierSpec
  | BenchmarkSpec
  | FormulaSumSpec
  | HhiSpec
  | CompositeSpec
  | ManualTierSpec

export type ScoringType = ScoringSpec['type']

export interface IndicatorFallback {
  type: 'neutral' | 'exclude'
  score?: number
  confidence?: string
  reason?: string
}

export interface AggregationSpec {
  method?: 'mean' | 'last' | 'sum'
  window?: PeriodKey[]
}

export interface FormulaSpec {
  expr: string
  inputs?: string[]
  guard?: string
}

export interface IndicatorDef {
  id: string
  code: number
  name: string
  share: number
  dataClass: 'A' | 'B' | 'C'
  unit?: string
  aggregation?: AggregationSpec
  formula?: FormulaSpec
  scoring: ScoringSpec
  evidenceRefs?: string[]
  fallback?: IndicatorFallback
  explain?: { template: string }
}

export interface DimensionDef {
  id: string
  name: string
  weight: number
  indicators: IndicatorDef[]
}

export interface RulesDoc {
  schemaVersion: string
  rulesId: string
  level: string
  levelName?: string
  effectiveFrom?: string
  passLine?: number
  policies?: {
    rounding?: { decimals: number; mode: 'half_up' | 'half_even' | 'floor' }
    cClassFallback?: { score: number; confidence: string }
  }
  gates: GateDef[]
  dimensions: DimensionDef[]
  assumptions?: { id: string; text: string; impact: string }[]
}

export type SlotState = 'ok' | 'missing' | 'pending' | 'excluded'

export interface Slot {
  state: SlotState
  num: number
  flags: Flag[]
}

export interface Series {
  slots: Slot[]
}

export interface RowValue {
  num?: number
  str?: string
  bool?: boolean
}

export type Row = Record<string, RowValue | undefined>

export type Val =
  | { kind: 'num'; v: number; flags: Flag[] }
  | { kind: 'bool'; v: boolean; flags: Flag[] }
  | { kind: 'str'; v: string; flags: Flag[] }
  | { kind: 'series'; s: Series; flags: Flag[] }
  | { kind: 'rows'; r: Row[]; flags: Flag[] }
  | { kind: 'none'; reason: 'missing' | 'pending' | 'error'; refs: string[]; flags: Flag[] }

export interface Tri {
  v: boolean | null
  missing: string[]
  pending: string[]
  flags: Flag[]
}

export type IndexKey =
  | { kind: 'period'; key: PeriodKey }
  | { kind: 'others' }
  | { kind: 'year'; year: number }
  | { kind: 'range'; from: IndexKey; to: IndexKey }

export interface Rewrite {
  kind: 'range' | 'count'
  from: string
  to: string
  index: number
}

export interface NormalizedExpr {
  text: string
  rewrites: Rewrite[]
}

export interface BenchmarkLookup {
  key: string
  value: number
  source: 'industry' | 'default'
}

export type IndicatorStatus = 'scored' | 'estimated' | 'missing' | 'notApplicable' | 'excluded'
export type IndicatorBasis = 'measured' | 'substituted' | 'absent' | 'notApplicable' | 'excluded'
export type Quality = 'verified' | 'estimated' | 'unknown'

export interface IndicatorResult {
  id: string
  code: number
  name: string
  dimensionId: string
  status: IndicatorStatus
  basis: IndicatorBasis
  quality: Quality
  raw: number | null
  score: number | null
  weight: number
  effectiveWeight: number
  contribution: { official: number; conservative: number; optimistic: number }
  benchmark: BenchmarkLookup | null
  flags: Flag[]
  explain: { template: string; text: string }
  reason?: string
  trace?: {
    normalizedExpr: string
    rewrites: Rewrite[]
    valueKind: 'num' | 'series' | 'rows' | 'bool' | 'str' | 'none'
  }
}

export type GateVerdict = 'pass' | 'fail' | 'unknown' | 'pending'
export type GateEffective = 'pass' | 'fail' | 'pending'
export type GateBasis = 'evidence' | 'missing' | 'unconfirmed' | 'mixed' | 'policy' | 'score'

export interface GateCheckResult {
  id: string
  label: string
  verdict: GateVerdict
  exemption: boolean
  missing: string[]
  pending: string[]
  flags: Flag[]
}

export interface GateResult {
  id: string
  name: string
  verdict: GateVerdict
  effective: GateEffective
  basis: GateBasis
  checks: GateCheckResult[]
  passedVia?: string
  explain: string
}

export interface Totals {
  official: number
  conservative: number
  optimistic: number
  confidence: number
}

export interface ScoreResult {
  schemaVersion: string
  projectId: string
  rulesId: string
  rulesVersion: string
  period: Record<PeriodKey, number>
  industry: { code: string; name: string | null; benchmarkSource: 'industry' | 'default' }
  totals: Totals
  dimensions: { id: string; name: string; weight: number; score: Totals }[]
  indicators: IndicatorResult[]
  gates: GateResult[]
  excluded: { indicatorId: string; baseWeight: number; reason: string }[]
  missing: { indicatorId: string; fieldKeys: string[] }[]
  flags: Flag[]
  conclusion: 'pass' | 'fail' | 'pending'
  meta: { engineVersion: string; scale: 'renormalized'; assumptions: string[] }
}

export interface EvaluateOptions {
  includeTrace?: boolean
}

export interface ScoringModel {
  evidence: EvidenceDoc
  benchmarks: BenchmarksDoc
  industryCode?: string
  options?: EvaluateOptions
}
