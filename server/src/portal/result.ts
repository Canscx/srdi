import type {
  EvidenceDoc,
  IndicatorDef,
  IndicatorResult,
  PortalAdvice,
  PortalCheck,
  PortalDimension,
  PortalMark,
  PortalResultResponse,
  ProjectMeta,
  RulesDoc,
  ScoreRecord,
  ScoringSpec
} from '@srdi/shared'
import { loadPortalConfig } from '../config/portal'
import { loadRules } from '../config/rules'

const PASS_RATE = 0.8

const SLOT_DOCS: Record<string, string[]> = {
  finance: ['audit', 'finance'],
  tax: ['tax'],
  ledger: [],
  extra: ['patent', 'cert', 'standard', 'application', 'other', 'hr']
}

const markOf = (item: IndicatorResult): PortalMark | null => {
  if (item.status === 'excluded') return null
  if (item.basis === 'absent' || item.basis === 'substituted') return 'missing'
  if (item.status === 'notApplicable') return 'gap'
  if (item.status === 'missing') return 'missing'
  return (item.score ?? 0) >= PASS_RATE ? 'pass' : 'gap'
}

const targetOf = (spec: ScoringSpec, item: IndicatorResult): number | null => {
  if (spec.type === 'piecewise' || spec.type === 'hhi') {
    const last = spec.points[spec.points.length - 1]
    return last ? last[0] : null
  }
  if (spec.type === 'tier' || spec.type === 'manualTier') return spec.maxPoints
  if (spec.type === 'formulaSum') return spec.cap
  if (spec.type === 'benchmark') return item.benchmark?.value ?? null
  return null
}

const missingSlotsOf = (project: ProjectMeta) => {
  const config = loadPortalConfig()
  const slots = new Set(project.files.map((file) => file.slot).filter(Boolean) as string[])
  const docTypes = new Set(
    project.files.map((file) => (file.docType ?? '').toLowerCase()).filter(Boolean)
  )
  return config.slots
    .filter((slot) => {
      if (slots.has(slot.id)) return false
      const allowed = SLOT_DOCS[slot.id]
      if (!allowed || allowed.length === 0) return false
      return !allowed.some((docType) => docTypes.has(docType))
    })
    .map((slot) => ({ id: slot.id, title: slot.title, required: slot.required }))
}

const materialRateOf = (evidence: EvidenceDoc) => {
  let total = 0
  let confirmed = 0
  for (const entry of Object.values(evidence.fields)) {
    if (entry.resolution?.strategy === 'declared') continue
    total += 1
    if (entry.status === 'confirmed') confirmed += 1
  }
  return total === 0 ? 0 : confirmed / total
}

export interface PortalResultInput {
  project: ProjectMeta
  evidence: EvidenceDoc
  record: ScoreRecord
  advices: PortalAdvice[]
  status: 'ready' | 'partial' | 'failed'
  warnings: string[]
}

export const buildPortalResult = (input: PortalResultInput): PortalResultResponse => {
  const { project, evidence, record } = input
  const rules: RulesDoc = loadRules()
  const config = loadPortalConfig()
  const result = record.result

  const definitions = new Map<string, IndicatorDef>()
  for (const dimension of rules.dimensions) {
    for (const indicator of dimension.indicators) {
      definitions.set(indicator.id, indicator)
    }
  }

  const dimensionNames = new Map(result.dimensions.map((item) => [item.id, item.name]))
  const maxByDimension: Record<string, number> = {}
  for (const item of result.indicators) {
    maxByDimension[item.dimensionId] =
      (maxByDimension[item.dimensionId] ?? 0) + item.effectiveWeight
  }

  const dimensions: PortalDimension[] = result.dimensions.map((item) => ({
    id: item.id,
    name: item.name,
    weight: item.weight,
    max: Number((maxByDimension[item.id] ?? item.weight).toFixed(2)),
    score: Number(item.score.official.toFixed(2)),
    optimistic: Number(item.score.optimistic.toFixed(2))
  }))

  const checks: PortalCheck[] = []
  for (const item of result.indicators) {
    const mark = markOf(item)
    if (!mark) continue
    const definition = definitions.get(item.id)
    const spec = definition?.scoring
    const unit = definition?.unit
    checks.push({
      id: item.id,
      code: item.code,
      name: item.name,
      dimensionId: item.dimensionId,
      dimensionName: dimensionNames.get(item.dimensionId) ?? item.dimensionId,
      mark,
      score: item.score,
      weight: Number(item.effectiveWeight.toFixed(2)),
      raw: item.raw,
      target: spec ? targetOf(spec, item) : null,
      unit,
      benchmark: item.benchmark?.value ?? null,
      text: item.explain.text,
      missingFields: result.missing.find((entry) => entry.indicatorId === item.id)?.fieldKeys ?? []
    })
  }

  const official = Number(result.totals.official.toFixed(2))
  const optimistic = Number(result.totals.optimistic.toFixed(2))

  return {
    projectId: project.projectId,
    company: project.company ?? {
      name: project.name,
      creditCode: '',
      phone: ''
    },
    period: project.period,
    status: input.status,
    score: {
      official,
      optimistic,
      passLine: config.passLine,
      passed: official >= config.passLine,
      gap: Number(Math.max(0, config.passLine - official).toFixed(2)),
      potential: Number(Math.max(0, optimistic - official).toFixed(2)),
      confidence: Number(result.totals.confidence.toFixed(4)),
      materialRate: Number(materialRateOf(evidence).toFixed(4)),
      industry: {
        code: result.industry.code,
        name: result.industry.name,
        source: result.industry.benchmarkSource
      }
    },
    dimensions,
    checks,
    advices: input.advices,
    missingSlots: missingSlotsOf(project),
    warnings: input.warnings,
    generatedAt: new Date().toISOString()
  }
}
