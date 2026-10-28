export interface CompositeResult {
  s: number | null
  partial: boolean
  usedWeight: number
}

export const scoreComposite = (parts: { weight: number; s: number | null }[]): CompositeResult => {
  const available = parts.filter((part) => part.s !== null) as { weight: number; s: number }[]
  const usedWeight = available.reduce((sum, part) => sum + part.weight, 0)

  if (usedWeight === 0) return { s: null, partial: true, usedWeight: 0 }

  const s = available.reduce((sum, part) => sum + part.weight * part.s, 0) / usedWeight
  return { s, partial: available.length < parts.length, usedWeight }
}
