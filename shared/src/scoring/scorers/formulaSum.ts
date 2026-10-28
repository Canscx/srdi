import type { FormulaSumSpec } from '../types'

export interface FormulaSumResult {
  s: number | null
  raw: number
  capped: boolean
  termDetail: number[]
  missing: boolean
}

export const scoreFormulaSum = (spec: FormulaSumSpec, counts: (number | null)[]): FormulaSumResult => {
  let raw = 0
  const termDetail: number[] = []
  let missing = false

  spec.terms.forEach((term, index) => {
    const count = counts[index]
    if (count === null || count === undefined) {
      missing = true
      termDetail.push(0)
      return
    }
    raw += count * term.coef
    termDetail.push(count * term.coef)
  })

  if (missing) {
    return { s: null, raw, capped: false, termDetail, missing: true }
  }

  const capped = raw >= spec.cap
  const s = spec.cap === 0 ? 0 : Math.min(raw, spec.cap) / spec.cap
  return { s, raw, capped, termDetail, missing: false }
}
