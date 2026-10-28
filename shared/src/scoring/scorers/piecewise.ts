import type { PiecewiseSpec } from '../types'

export interface PiecewiseResult {
  s: number
  segment: number
  belowFirst: boolean
  aboveLast: boolean
}

export const scorePiecewise = (spec: PiecewiseSpec, x: number): PiecewiseResult => {
  const points = spec.points
  const clamp = spec.clamp ?? [0, 1]
  const apply = (value: number) => Math.min(clamp[1], Math.max(clamp[0], value))

  if (points.length === 0) return { s: 0, segment: -1, belowFirst: false, aboveLast: false }

  const first = points[0]
  if (x <= first[0]) return { s: apply(first[1]), segment: 0, belowFirst: true, aboveLast: false }

  const last = points[points.length - 1]
  if (x >= last[0]) {
    return { s: apply(last[1]), segment: points.length - 1, belowFirst: false, aboveLast: true }
  }

  for (let i = 1; i < points.length; i += 1) {
    const [x1, y1] = points[i]
    const [x0, y0] = points[i - 1]
    if (x <= x1) {
      const ratio = x1 === x0 ? 0 : (x - x0) / (x1 - x0)
      return { s: apply(y0 + (y1 - y0) * ratio), segment: i, belowFirst: false, aboveLast: false }
    }
  }

  return { s: apply(last[1]), segment: points.length - 1, belowFirst: false, aboveLast: true }
}
