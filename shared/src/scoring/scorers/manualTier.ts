import type { ManualTierSpec } from '../types'

export interface ManualTierResult {
  status: 'hit' | 'empty' | 'unmatched'
  s: number | null
  points: number | null
  label: string | null
}

export const scoreManualTier = (spec: ManualTierSpec, key: string | null): ManualTierResult => {
  if (!key) return { status: 'empty', s: null, points: null, label: null }

  const hit = spec.options.find((option) => option.key === key)
  if (!hit) return { status: 'unmatched', s: null, points: null, label: null }

  return {
    status: 'hit',
    s: spec.maxPoints === 0 ? 0 : hit.points / spec.maxPoints,
    points: hit.points,
    label: hit.label
  }
}
