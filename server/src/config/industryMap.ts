import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CONFIG_ROOT } from '../paths'

export interface IndustryRule {
  code: string
  name: string
  keywords: string[]
}

export interface IndustryMap {
  version: string
  rules: IndustryRule[]
}

const INDUSTRY_FILE = 'industry-map.json'

const FALLBACK: IndustryMap = { version: '0.0.0', rules: [] }

let cached: IndustryMap | null = null

export const loadIndustryMap = (): IndustryMap => {
  if (cached) return cached
  try {
    const raw = JSON.parse(
      readFileSync(path.join(CONFIG_ROOT, INDUSTRY_FILE), 'utf8')
    ) as Partial<IndustryMap>
    const rules = Array.isArray(raw.rules)
      ? raw.rules
          .filter((rule) => typeof rule?.code === 'string' && typeof rule?.name === 'string')
          .map((rule) => ({
            code: rule.code.toUpperCase(),
            name: rule.name,
            keywords: Array.isArray(rule.keywords)
              ? rule.keywords.filter((item) => typeof item === 'string' && item.length > 0)
              : []
          }))
      : []
    cached = { version: raw.version ?? FALLBACK.version, rules }
  } catch {
    cached = FALLBACK
  }
  return cached
}

export const lookupIndustryName = (code: string): string | null => {
  const hit = loadIndustryMap().rules.find((rule) => rule.code === code.toUpperCase())
  return hit ? hit.name : null
}
