import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CONFIG_ROOT } from '../paths'

export interface AdviceTemplate {
  title: string
  body: string
  impact: 'high' | 'medium' | 'low'
}

export interface AdviceBook {
  version: string
  items: Record<string, AdviceTemplate>
}

const ADVICE_FILE = 'advice.json'

const FALLBACK: AdviceBook = { version: '0.0.0', items: {} }

let cached: AdviceBook | null = null

export const loadAdviceBook = (): AdviceBook => {
  if (cached) return cached
  try {
    const raw = JSON.parse(
      readFileSync(path.join(CONFIG_ROOT, ADVICE_FILE), 'utf8')
    ) as Partial<AdviceBook>
    const items: Record<string, AdviceTemplate> = {}
    for (const [key, value] of Object.entries(raw.items ?? {})) {
      if (!value || typeof value.title !== 'string' || typeof value.body !== 'string') continue
      items[key] = {
        title: value.title,
        body: value.body,
        impact: value.impact === 'high' || value.impact === 'low' ? value.impact : 'medium'
      }
    }
    cached = { version: raw.version ?? FALLBACK.version, items }
  } catch {
    cached = FALLBACK
  }
  return cached
}
