import type { Row } from '../types'

export interface HhiResult {
  hhi: number
  parts: number[]
  total: number
}

export const computeHhi = (rows: Row[], total: number): HhiResult | null => {
  if (!(total > 0)) return null

  const parts = rows
    .map((row) => row.count?.num)
    .filter((value): value is number => typeof value === 'number')

  if (parts.length === 0) return null

  const shares = parts.map((value) => value / total)
  const hhi = shares.reduce((sum, share) => sum + share * share, 0)
  return { hhi, parts, total }
}
