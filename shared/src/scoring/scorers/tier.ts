import type { Tri } from '../types'

export interface TierResult {
  status: 'hit' | 'indeterminate'
  s: number | null
  points: number | null
  label: string | null
  matchedIndex: number
}

export const scoreTier = (
  spec: { maxPoints: number; tiers: { when: string; points: number; label: string }[] },
  test: (when: string) => Tri
): TierResult => {
  let sawIndeterminate = false

  for (let i = 0; i < spec.tiers.length; i += 1) {
    const tier = spec.tiers[i]
    const isFallback = tier.when.trim() === 'true'

    if (isFallback) {
      if (sawIndeterminate) {
        return { status: 'indeterminate', s: null, points: null, label: null, matchedIndex: -1 }
      }
      return {
        status: 'hit',
        s: spec.maxPoints === 0 ? 0 : tier.points / spec.maxPoints,
        points: tier.points,
        label: tier.label,
        matchedIndex: i
      }
    }

    const verdict = test(tier.when)
    if (verdict.v === true) {
      return {
        status: 'hit',
        s: spec.maxPoints === 0 ? 0 : tier.points / spec.maxPoints,
        points: tier.points,
        label: tier.label,
        matchedIndex: i
      }
    }
    if (verdict.v === null) sawIndeterminate = true
  }

  return { status: 'indeterminate', s: null, points: null, label: null, matchedIndex: -1 }
}
