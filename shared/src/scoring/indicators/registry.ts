import type { IndicatorDef } from '../types'

export type ValueSource = 'formula' | 'tierExpr' | 'manualEnum' | 'hhi' | 'formulaSum' | 'composite'

export const COMPOSITE_REFS: Record<string, string[]> = {
  IND_20: ['hr.rdHeadcount', 'hr.rdHeadcount / hr.totalHeadcount']
}

export const MANUAL_FIELD_OVERRIDES: Record<string, string> = {}

export const sourceOf = (def: IndicatorDef): ValueSource => {
  switch (def.scoring.type) {
    case 'tier':
      return 'tierExpr'
    case 'manualTier':
      return 'manualEnum'
    case 'hhi':
      return 'hhi'
    case 'formulaSum':
      return 'formulaSum'
    case 'composite':
      return 'composite'
    default:
      return 'formula'
  }
}
