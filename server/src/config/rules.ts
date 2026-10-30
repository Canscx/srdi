import { readFileSync } from 'node:fs'
import path from 'node:path'
import { RULES_FILE } from '@srdi/shared'
import type { RulesDoc, RulesMetaResponse, RulesSummary } from '@srdi/shared'
import { AppError } from '../errors'
import { RULES_DIR } from '../paths'

let cachedRules: RulesDoc | null = null

interface RawRules {
  rulesId?: string
  schemaVersion?: string
  level?: string
  effectiveFrom?: string
  gates?: unknown[]
  dimensions?: { indicators?: unknown[] }[]
}

export const loadRules = (): RulesDoc => {
  if (cachedRules) return cachedRules
  try {
    cachedRules = JSON.parse(
      readFileSync(path.join(RULES_DIR, RULES_FILE), 'utf8')
    ) as RulesDoc
  } catch (err) {
    throw new AppError(
      500,
      'rules_unavailable',
      '规则包读取失败,无法打分',
      (err as Error).message
    )
  }
  return cachedRules
}

export const rulesMeta = (): RulesMetaResponse => {
  const rules = loadRules()
  return {
    rulesId: rules.rulesId,
    version: rules.schemaVersion,
    level: rules.level,
    levelName: rules.levelName,
    passLine: rules.passLine,
    dimensions: rules.dimensions.map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      weight: dimension.weight,
      indicators: dimension.indicators.map((indicator) => ({
        id: indicator.id,
        code: indicator.code,
        name: indicator.name,
        unit: indicator.unit,
        dataClass: indicator.dataClass,
        share: indicator.share,
        scoringType: indicator.scoring.type,
        evidenceRefs: indicator.evidenceRefs ?? [],
        formula: indicator.formula?.expr,
        fallback: indicator.fallback
          ? { type: indicator.fallback.type, reason: indicator.fallback.reason }
          : undefined
      }))
    })),
    assumptions: rules.assumptions ?? []
  }
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
