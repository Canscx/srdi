import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RULES_FILE } from '@srdi/shared'
import type { RulesSummary } from '@srdi/shared'
import { RULES_DIR } from '../paths'

interface RawRules {
  rulesId?: string
  schemaVersion?: string
  level?: string
  effectiveFrom?: string
  gates?: unknown[]
  dimensions?: { indicators?: unknown[] }[]
}

export const loadRulesSummary = (): RulesSummary | null => {
  try {
    const raw = JSON.parse(readFileSync(path.join(RULES_DIR, RULES_FILE), 'utf8')) as RawRules
    const dimensions = raw.dimensions ?? []
    return {
      id: raw.rulesId ?? 'unknown',
      version: raw.schemaVersion ?? '0.0.0',
      level: raw.level ?? 'SRDI',
      effectiveFrom: raw.effectiveFrom ?? '',
      gates: raw.gates?.length ?? 0,
      dimensions: dimensions.length,
      indicators: dimensions.reduce((sum, dim) => sum + (dim.indicators?.length ?? 0), 0)
    }
  } catch {
    return null
  }
}
