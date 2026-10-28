import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CONFIG_ROOT } from '../paths'

export interface ModelPricing {
  inputPerMTok: number
  cachedInputPerMTok?: number
  outputPerMTok: number
  peakMultiplier?: number
  visionTokensPerImage?: number
  contextWindow: number
  maxOutput: number
  supportsVision: boolean
  supportsJsonOutput: boolean
  supportsToolCalls?: boolean
}

export interface PricingBudget {
  perProjectTokens: number
  perProjectCostLimit?: number
  visionConcurrency?: number
  textConcurrency?: number
}

export interface PricingDoc {
  currency: string
  updatedAt: string
  note?: string
  models: Record<string, ModelPricing>
  budget: PricingBudget
}

const PRICING_FILE = 'pricing.json'

let cached: PricingDoc | null = null

export const loadPricing = (): PricingDoc => {
  if (cached) return cached
  const raw = JSON.parse(readFileSync(path.join(CONFIG_ROOT, PRICING_FILE), 'utf8')) as PricingDoc
  if (!raw.models || Object.keys(raw.models).length === 0) {
    throw new Error('config/pricing.json 未配置任何模型')
  }
  cached = raw
  return cached
}

export const defaultModel = () => Object.keys(loadPricing().models)[0]

export const modelPricing = (model: string) => loadPricing().models[model]

export const projectTokenLimit = () => loadPricing().budget.perProjectTokens
