import type { IndicatorBasis, IndicatorResult, RulesDoc, Totals } from './types'

export interface WeightEntry {
  indicatorId: string
  dimensionId: string
  baseWeight: number
  effectiveWeight: number
}

export const computeBaseWeights = (rules: RulesDoc): WeightEntry[] => {
  const entries: WeightEntry[] = []

  for (const dimension of rules.dimensions) {
    const totalShare = dimension.indicators.reduce((sum, item) => sum + (item.share ?? 1), 0)
    for (const indicator of dimension.indicators) {
      const share = indicator.share ?? 1
      const baseWeight = totalShare === 0 ? 0 : (dimension.weight * share) / totalShare
      entries.push({
        indicatorId: indicator.id,
        dimensionId: dimension.id,
        baseWeight,
        effectiveWeight: baseWeight
      })
    }
  }

  return entries
}

export const renormalizeWeights = (entries: WeightEntry[], excluded: ReadonlySet<string>): WeightEntry[] => {
  const removed = entries
    .filter((entry) => excluded.has(entry.indicatorId))
    .reduce((sum, entry) => sum + entry.baseWeight, 0)

  const remaining = 100 - removed
  const factor = remaining <= 0 ? 0 : 100 / remaining

  return entries.map((entry) =>
    excluded.has(entry.indicatorId)
      ? { ...entry, effectiveWeight: 0 }
      : { ...entry, effectiveWeight: entry.baseWeight * factor }
  )
}

export const contributionOf = (
  basis: IndicatorBasis,
  score: number,
  weight: number
): { official: number; conservative: number; optimistic: number } => {
  if (basis === 'measured') {
    const value = score * weight
    return { official: value, conservative: value, optimistic: value }
  }
  if (basis === 'substituted') {
    return { official: score * weight, conservative: 0, optimistic: weight }
  }
  if (basis === 'absent') {
    return { official: 0.5 * weight, conservative: 0, optimistic: weight }
  }
  return { official: 0, conservative: 0, optimistic: 0 }
}

export const roundTo = (value: number, decimals: number, mode: 'half_up' | 'half_even' | 'floor' = 'half_up'): number => {
  const factor = 10 ** decimals
  if (!Number.isFinite(value)) return 0
  if (mode === 'floor') return Math.floor(value * factor) / factor
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export const rollupTotals = (indicators: IndicatorResult[], decimals: number): Totals => {
  const official = indicators.reduce((sum, item) => sum + item.contribution.official, 0)
  const conservative = indicators.reduce((sum, item) => sum + item.contribution.conservative, 0)
  const optimistic = indicators.reduce((sum, item) => sum + item.contribution.optimistic, 0)

  const trustedWeight = indicators
    .filter((item) => item.quality !== 'verified')
    .reduce((sum, item) => sum + item.effectiveWeight, 0)

  const confidence = Math.min(1, Math.max(0, 1 - trustedWeight / 100))

  return {
    official: roundTo(Math.min(100, Math.max(0, official)), decimals),
    conservative: roundTo(Math.min(100, Math.max(0, conservative)), decimals),
    optimistic: roundTo(Math.min(100, Math.max(0, optimistic)), decimals),
    confidence: roundTo(confidence, 4)
  }
}

export const roundTotals = (totals: Totals, decimals: number): Totals => ({
  official: roundTo(totals.official, decimals),
  conservative: roundTo(totals.conservative, decimals),
  optimistic: roundTo(totals.optimistic, decimals),
  confidence: roundTo(totals.confidence, 4)
})
