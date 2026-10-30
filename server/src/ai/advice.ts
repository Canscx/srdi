import { createHash } from 'node:crypto'
import path from 'node:path'
import type { PortalAdvice, ProjectMeta, ScoreRecord } from '@srdi/shared'
import { loadAdviceBook } from '../config/advice'
import { loadRules } from '../config/rules'
import type { AppStore } from '../store'
import { readJson, writeJson } from '../store/atomic'
import type { ModelClient } from './client'

export interface AdviceFact {
  id: string
  name: string
  raw: number | null
  unit?: string
  target: number | null
  gain: number
  mark: 'gap' | 'missing'
  detail: string
}

export interface AdviceInput {
  store: AppStore
  project: ProjectMeta
  record: ScoreRecord
  client?: ModelClient
  model?: string
}

const MAX_ITEMS = 8
const MAX_BODY = 150

const money = (value: number) =>
  Math.abs(value) >= 10000 ? `${(value / 10000).toFixed(1)} 万元` : `${value.toFixed(0)} 元`

const formatNumber = (value: number, unit?: string) => {
  if (unit === 'CNY') return money(value)
  if (unit === 'percent' || unit === 'ratio') {
    return `${(Math.abs(value) <= 1.5 ? value * 100 : value).toFixed(1)}%`
  }
  if (unit === 'year') return `${value.toFixed(0)} 年`
  return Number.isInteger(value) ? `${value}` : value.toFixed(2)
}

export const collectFacts = (record: ScoreRecord): AdviceFact[] => {
  const rules = loadRules()
  const definitions = new Map<string, { unit?: string; name: string }>()
  for (const dimension of rules.dimensions) {
    for (const indicator of dimension.indicators) {
      definitions.set(indicator.id, { unit: indicator.unit, name: indicator.name })
    }
  }

  const facts: AdviceFact[] = []
  for (const item of record.result.indicators) {
    if (item.status === 'excluded') continue
    const gap = item.effectiveWeight - item.contribution.official
    if (gap <= 0.01) continue
    if (item.basis === 'measured' && (item.score ?? 0) >= 0.8) continue

    const definition = definitions.get(item.id)
    facts.push({
      id: item.id,
      name: definition?.name ?? item.name,
      raw: item.raw,
      unit: definition?.unit,
      target: item.benchmark?.value ?? null,
      gain: Number(gap.toFixed(2)),
      mark: item.basis === 'measured' ? 'gap' : 'missing',
      detail: item.explain.text
    })
  }

  return facts.sort((left, right) => right.gain - left.gain).slice(0, MAX_ITEMS)
}

const stripGain = (body: string) =>
  body
    .replace(/[，,]?\s*可提升\s*[\d.]+\s*分[。.]?/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

const renderTemplate = (template: string, fact: AdviceFact) => {
  const value = fact.raw === null ? '暂无数据' : formatNumber(fact.raw, fact.unit)
  const target = fact.target === null ? '—' : formatNumber(fact.target, fact.unit)
  return stripGain(
    template
      .replace(/\{value\}/g, value)
      .replace(/\{target\}/g, target)
      .replace(/\{gain\}/g, fact.gain.toFixed(1))
  )
}

const fallbackAdvices = (facts: AdviceFact[]): PortalAdvice[] => {
  const book = loadAdviceBook()
  return facts.map((fact) => {
    const template = book.items[fact.id]
    return {
      key: fact.id,
      title: template?.title ?? fact.name,
      body: template ? renderTemplate(template.body, fact) : fact.detail,
      impact: template?.impact ?? (fact.gain >= 4 ? 'high' : 'medium'),
      gain: fact.gain,
      source: 'rule' as const
    }
  })
}

const PROMPT = `你是专精特新申报辅导顾问。根据给定的指标事实，为每一条写一段面向企业负责人的整改建议。

要求：
1. 只写"该补什么、补到什么程度、怎么补"，不要写客套话，不要提任何服务或收费。
2. 每条正文不超过 150 个字，中文，口语化，企业负责人能看懂。
3. 严禁编造事实里没有的数字。可以复述事实里的数字，但不要自己算新数字。
4. 只输出 JSON 数组，形如 [{"id":"IND_15","title":"不超过14字的短标题","body":"正文"}]，不要输出其它内容。
5. 按事实给出的顺序输出，条数与事实条数相同。`

const normalizeForCheck = (text: string) => text.replace(/\s/g, '')

const allowedQuantity = (value: number) => [value, value / 10000, value * 100]

const numbersAcceptable = (text: string, facts: AdviceFact[]) => {
  const tokens = text.match(/\d+(?:\.\d+)?/g) ?? []
  const quantities: number[] = []
  for (const fact of facts) {
    for (const value of [fact.raw, fact.target, fact.gain]) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        quantities.push(...allowedQuantity(value))
      }
    }
  }
  for (const token of tokens) {
    const value = Number(token)
    if (!Number.isFinite(value)) continue
    if (Number.isInteger(value) && value >= 0 && value <= 12) continue
    if (Number.isInteger(value) && value >= 1990 && value <= 2100) continue
    const hit = quantities.some((quantity) => {
      if (!Number.isFinite(quantity) || quantity === 0) return value === quantity
      return Math.abs(value - quantity) / Math.abs(quantity) <= 0.05
    })
    if (!hit) return false
  }
  return true
}

interface RawAdvice {
  id: string
  title: string
  body: string
}

const parseAdvices = (text: string): RawAdvice[] | null => {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    if (!Array.isArray(parsed)) return null
    const items: RawAdvice[] = []
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue
      const raw = entry as Record<string, unknown>
      if (typeof raw.id !== 'string' || typeof raw.body !== 'string') continue
      const body = raw.body.replace(/\s+/g, ' ').trim()
      if (body.length === 0) continue
      const cleaned = stripGain(body)
      items.push({
        id: raw.id,
        title: typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : '',
        body: cleaned.length > MAX_BODY ? `${cleaned.slice(0, MAX_BODY - 1)}…` : cleaned
      })
    }
    return items.length > 0 ? items : null
  } catch {
    return null
  }
}

const mergeAdvices = (raw: RawAdvice[], facts: AdviceFact[]): PortalAdvice[] => {
  const byId = new Map(facts.map((fact) => [fact.id, fact]))
  const book = loadAdviceBook()
  const items: PortalAdvice[] = []
  for (const entry of raw) {
    const fact = byId.get(entry.id)
    if (!fact) continue
    const template = book.items[fact.id]
    items.push({
      key: fact.id,
      title: entry.title || template?.title || fact.name,
      body: entry.body,
      impact: template?.impact ?? (fact.gain >= 4 ? 'high' : 'medium'),
      gain: fact.gain,
      source: 'ai'
    })
  }
  return items
}

const cachePath = (store: AppStore, projectId: string, hash: string) =>
  path.join(store.projects.dir(projectId), 'cache', 'advice', `${hash}.json`)

export const generateAdvice = async (input: AdviceInput): Promise<PortalAdvice[]> => {
  const facts = collectFacts(input.record)
  if (facts.length === 0) return []

  const hash = createHash('sha1')
    .update(JSON.stringify(facts))
    .update(input.model ?? '')
    .digest('hex')
    .slice(0, 16)

  const cached = await readJson<PortalAdvice[]>(cachePath(input.store, input.project.projectId, hash))
  if (cached && Array.isArray(cached) && cached.length > 0) return cached

  if (!input.client) return fallbackAdvices(facts)

  const payload = facts.map((fact) => ({
    id: fact.id,
    name: fact.name,
    current: fact.raw === null ? null : formatNumber(fact.raw, fact.unit),
    target: fact.target === null ? null : formatNumber(fact.target, fact.unit),
    gain: fact.gain,
    state: fact.mark === 'missing' ? '缺材料' : '已测到但偏低',
    detail: normalizeForCheck(fact.detail)
  }))

  const messages = [
    { role: 'system' as const, content: PROMPT },
    { role: 'user' as const, content: `指标事实：\n${JSON.stringify(payload, null, 2)}` }
  ]

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await input.client.complete({
        model: input.model ?? '',
        temperature: 0,
        json: true,
        messages
      })
      const parsed = parseAdvices(response.text)
      if (!parsed) continue
      const joined = parsed.map((item) => item.body).join('\n')
      if (!numbersAcceptable(joined, facts)) continue
      const merged = mergeAdvices(parsed, facts)
      if (merged.length === 0) continue
      await writeJson(cachePath(input.store, input.project.projectId, hash), merged)
      return merged
    } catch {
      break
    }
  }

  return fallbackAdvices(facts)
}
