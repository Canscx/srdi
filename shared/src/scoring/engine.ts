import { computeBaseWeights, renormalizeWeights, roundTo, rollupTotals } from './aggregate'
import { buildContext } from './context'
import { aggregateConclusion, evaluateExprGate, evaluateScoreGate } from './gates'
import { evaluateIndicator } from './indicators'
import type { Flag, IndicatorResult, RulesDoc, ScoreResult, ScoringModel, Totals } from './types'

export const ENGINE_VERSION = '1.0.0'

export class ScoringError extends Error {
  code: 'E91_BAD_RULES' | 'E92_BAD_EVIDENCE' | 'E93_ENGINE'
  detail?: unknown

  constructor(code: ScoringError['code'], message: string, detail?: unknown) {
    super(message)
    this.name = 'ScoringError'
    this.code = code
    this.detail = detail
  }
}

const sumContrib = (items: IndicatorResult[]) => ({
  official: items.reduce((sum, item) => sum + item.contribution.official, 0),
  conservative: items.reduce((sum, item) => sum + item.contribution.conservative, 0),
  optimistic: items.reduce((sum, item) => sum + item.contribution.optimistic, 0)
})

export const evaluate = (model: ScoringModel, rules: RulesDoc): ScoreResult => {
  if (!rules || !Array.isArray(rules.dimensions) || rules.dimensions.length === 0) {
    throw new ScoringError('E91_BAD_RULES', '规则包缺少指标定义')
  }

  const evidence = model.evidence
  if (!evidence || !evidence.period) {
    throw new ScoringError('E92_BAD_EVIDENCE', '证据缺少期间信息')
  }

  if (evidence.rulesId && evidence.rulesId !== rules.rulesId) {
    throw new ScoringError('E92_BAD_EVIDENCE', `规则包不匹配: 证据 ${evidence.rulesId}, 规则 ${rules.rulesId}`)
  }

  const ctx = buildContext(model, rules)
  const defs = rules.dimensions.flatMap((dimension) =>
    dimension.indicators.map((def) => ({ def, dimension }))
  )

  const excludedIds = new Set(
    defs.filter((item) => item.def.fallback?.type === 'exclude').map((item) => item.def.id)
  )

  const weights = renormalizeWeights(computeBaseWeights(rules), excludedIds)
  const weightMap = new Map(weights.map((entry) => [entry.indicatorId, entry]))

  const indicators: IndicatorResult[] = defs.map(({ def, dimension }) => {
    const weight = weightMap.get(def.id)
    return evaluateIndicator(def, dimension.id, ctx, {
      base: weight?.baseWeight ?? 0,
      effective: weight?.effectiveWeight ?? 0
    })
  })

  const decimals = rules.policies?.rounding?.decimals ?? 2
  const totals = rollupTotals(indicators, decimals)

  const gates = rules.gates.map((gate) =>
    gate.type === 'scoreGate' ? evaluateScoreGate(gate, totals) : evaluateExprGate(gate, ctx)
  )

  const dimensions = rules.dimensions.map((dimension) => {
    const items = indicators.filter((item) => item.dimensionId === dimension.id)
    const contribution = sumContrib(items)
    const dimWeight = items.reduce((sum, item) => sum + item.effectiveWeight, 0)
    const trusted = items
      .filter((item) => item.quality !== 'verified')
      .reduce((sum, item) => sum + item.effectiveWeight, 0)

    const score: Totals = {
      official: roundTo(contribution.official, decimals),
      conservative: roundTo(contribution.conservative, decimals),
      optimistic: roundTo(contribution.optimistic, decimals),
      confidence: roundTo(dimWeight === 0 ? 0 : Math.max(0, 1 - trusted / dimWeight), 4)
    }

    return { id: dimension.id, name: dimension.name, weight: dimension.weight, score }
  })

  const industryCode = model.industryCode ?? evidence.company?.industryCode ?? ''
  const industryHit = model.benchmarks.industries.find((item) => item.code === industryCode)

  const excluded = indicators
    .filter((item) => item.basis === 'excluded')
    .map((item) => ({
      indicatorId: item.id,
      baseWeight: item.weight,
      reason: item.reason ?? '按策略排除'
    }))

  const missing = indicators
    .filter((item) => item.basis === 'absent' || item.basis === 'substituted')
    .map((item) => {
      const def = defs.find((entry) => entry.def.id === item.id)?.def
      return { indicatorId: item.id, fieldKeys: def?.evidenceRefs ?? [] }
    })

  const flags: Flag[] = Array.from(new Set(indicators.flatMap((item) => item.flags)))

  return {
    schemaVersion: '1.0.0',
    projectId: evidence.projectId,
    rulesId: rules.rulesId,
    rulesVersion: rules.schemaVersion,
    period: evidence.period,
    industry: {
      code: industryCode,
      name: industryHit?.name ?? null,
      benchmarkSource: industryHit ? 'industry' : 'default'
    },
    totals,
    dimensions,
    indicators,
    gates,
    excluded,
    missing,
    flags,
    conclusion: aggregateConclusion(gates),
    meta: {
      engineVersion: ENGINE_VERSION,
      scale: 'renormalized',
      assumptions: (rules.assumptions ?? []).map((item) => item.text)
    }
  }
}
