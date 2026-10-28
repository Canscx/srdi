import path from 'node:path'
import { projectTokenLimit } from '../config/pricing'
import { readJson, writeJson } from '../store/atomic'

export interface BudgetUsage {
  limit: number
  used: number
  updatedAt: string
}

export const BUDGET_FILE = 'ai-usage.json'

export class BudgetExhaustedError extends Error {
  readonly used: number
  readonly limit: number

  constructor(used: number, limit: number) {
    super(`项目 token 预算已用尽(${used}/${limit})`)
    this.name = 'BudgetExhaustedError'
    this.used = used
    this.limit = limit
  }
}

export interface Budget {
  limit: number
  used: () => number
  remaining: () => number
  exhausted: () => boolean
  charge: (promptTokens: number, completionTokens: number) => Promise<number>
  save: () => Promise<void>
}

export const createBudget = async (projectDir: string): Promise<Budget> => {
  const file = path.join(projectDir, BUDGET_FILE)
  const limit = projectTokenLimit()
  const loaded = await readJson<BudgetUsage>(file)
  let used = Math.max(0, loaded?.used ?? 0)

  const charge = async (promptTokens: number, completionTokens: number) => {
    used += Math.max(0, Math.round(promptTokens)) + Math.max(0, Math.round(completionTokens))
    return used
  }

  const save = async () => {
    const payload: BudgetUsage = {
      limit,
      used,
      updatedAt: new Date().toISOString()
    }
    await writeJson(file, payload)
  }

  return {
    limit,
    used: () => used,
    remaining: () => Math.max(0, limit - used),
    exhausted: () => used >= limit,
    charge,
    save
  }
}
