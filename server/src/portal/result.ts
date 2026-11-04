import { MIN_PASS_CONFIDENCE, goalContributionOf, isPortalPassed, rollupGoal } from '@srdi/shared'
import type {
  EvidenceDoc,
  ProjectCompany,
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
import { catalogFields } from '../config/catalog'
import { resolveIdentity } from './identity'
import { loadPortalConfig } from '../config/portal'
import { loadRules } from '../config/rules'

const PASS_RATE = 0.8

const NEUTRAL_HINT = new Set(['IND_05', 'IND_07'])

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
  const fieldLabels = new Map(catalogFields().map((field) => [field.key, field.label]))
  const slotTitles = new Map(config.slots.map((slot) => [slot.id, slot.title]))
  const maxByDimension: Record<string, number> = {}
  const goalByDimension: Record<string, number> = {}
  for (const item of result.indicators) {
    maxByDimension[item.dimensionId] =
      (maxByDimension[item.dimensionId] ?? 0) + item.effectiveWeight
    goalByDimension[item.dimensionId] =
      (goalByDimension[item.dimensionId] ?? 0) + goalContributionOf(item)
  }

  const dimensions: PortalDimension[] = result.dimensions.map((item) => ({
    id: item.id,
    name: item.name,
    weight: item.weight,
    max: Number((maxByDimension[item.id] ?? item.weight).toFixed(2)),
    score: Number(item.score.official.toFixed(2)),
    goal: Number(
      Math.min(maxByDimension[item.id] ?? item.weight, goalByDimension[item.id] ?? 0).toFixed(2)
    )
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
      missingFields: (result.missing.find((entry) => entry.indicatorId === item.id)?.fieldKeys ?? [])
        .map((key) => fieldLabels.get(key) ?? key),
      ...(item.basis === 'absent' && NEUTRAL_HINT.has(item.id) ? { neutral: true } : {})
    })
  }

  const official = Number(result.totals.official.toFixed(2))
  const goal = Number(rollupGoal(result.indicators).toFixed(2))
  const confidence = Number(result.totals.confidence.toFixed(4))

  const identity = resolveIdentity({ project, evidence })
  const base = project.company
  const company: ProjectCompany = {
    name: identity.name || project.name,
    phone: base?.phone ?? '',
    ...(identity.creditCode ? { creditCode: identity.creditCode } : {}),
    ...(identity.creditCodeSource ? { creditCodeSource: identity.creditCodeSource } : {}),
    ...(identity.businessScope ? { businessScope: identity.businessScope } : {}),
    ...(identity.registeredCapital !== null ? { registeredCapital: identity.registeredCapital } : {}),
    ...(identity.establishedDate ? { establishedDate: identity.establishedDate } : {}),
    ...(identity.industryCode ? { industryCode: identity.industryCode } : {}),
    ...(identity.industryName ? { industryName: identity.industryName } : {}),
    ...(typeof base?.inventionCount === 'number' ? { inventionCount: base.inventionCount } : {}),
    ...(typeof base?.layoutDesignCount === 'number'
      ? { layoutDesignCount: base.layoutDesignCount }
      : {}),
    ...(typeof base?.softCopyrightCount === 'number'
      ? { softCopyrightCount: base.softCopyrightCount }
      : {}),
    ...(typeof base?.utilityModelCount === 'number'
      ? { utilityModelCount: base.utilityModelCount }
      : {}),
    ...(typeof base?.designPatentCount === 'number'
      ? { designPatentCount: base.designPatentCount }
      : {}),
    ...(typeof base?.selfDevelopedI === 'boolean' ? { selfDevelopedI: base.selfDevelopedI } : {}),
    ...(typeof base?.highValueI === 'boolean' ? { highValueI: base.highValueI } : {})
  }

  return {
    projectId: project.projectId,
    company,
    period: project.period,
    status: input.status,
    materials: project.files.map((file) => ({
      fileId: file.fileId,
      name: file.name,
      slot: file.slot,
      slotTitle: file.slot ? slotTitles.get(file.slot) : undefined,
      status: file.status,
      docType: file.docType,
      docTypeSource: file.docTypeSource,
      referenceOnly: file.referenceOnly === true,
      pages: file.pages
    })),
    score: {
      official,
      goal,
      passLine: config.passLine,
      passed: isPortalPassed(official, config.passLine, confidence),
      evidenceSufficient: confidence >= MIN_PASS_CONFIDENCE,
      gap: Number(Math.max(0, config.passLine - official).toFixed(2)),
      potential: Number(Math.max(0, goal - official).toFixed(2)),
      confidence,
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
    warnings: [...new Set([...input.warnings, ...identity.warnings])],
    generatedAt: new Date().toISOString(),
    scoredAt: record.savedAt,
    updatedAt: project.updatedAt
  }
}
