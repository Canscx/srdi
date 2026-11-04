import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PortalConfig, PortalSlot } from '@srdi/shared'
import { CONFIG_ROOT } from '../paths'
import { loadRules } from './rules'

const PORTAL_FILE = 'portal.json'

const FALLBACK: PortalConfig = {
  version: '0.0.0',
  passLine: 50,
  lookup: { windowMinutes: 10, maxAttempts: 10 },
  recognize: {
    enabled: true,
    maxBytes: 10 * 1024 * 1024,
    maxPages: 3,
    hourlyLimit: 20,
    ttlHours: 720
  },
  slots: []
}

const normalizeSlot = (raw: PortalSlot): PortalSlot => ({
  id: String(raw.id),
  title: String(raw.title),
  hint: String(raw.hint ?? ''),
  required: raw.required === true,
  accept: Array.isArray(raw.accept) ? raw.accept.map((item) => String(item).toLowerCase()) : [],
  ...(typeof raw.docType === 'string' && raw.docType ? { docType: raw.docType } : {}),
  ...(Array.isArray(raw.docTypes) && raw.docTypes.length > 0
    ? {
        docTypes: raw.docTypes
          .filter((item) => item && typeof item.value === 'string')
          .map((item) => ({ value: String(item.value), label: String(item.label ?? item.value) }))
      }
    : {})
})

let cached: PortalConfig | null = null

export const loadPortalConfig = (): PortalConfig => {
  if (cached) return cached
  // 达标线的唯一来源是规则包,portal.json 不再重复声明,避免两处口径漂移。
  const rules = loadRules()
  const passLine = rules.passLine ?? FALLBACK.passLine
  try {
    const raw = JSON.parse(
      readFileSync(path.join(CONFIG_ROOT, PORTAL_FILE), 'utf8')
    ) as Partial<PortalConfig>
    cached = {
      version: raw.version ?? FALLBACK.version,
      passLine,
      lookup: {
        windowMinutes:
          typeof raw.lookup?.windowMinutes === 'number' && raw.lookup.windowMinutes > 0
            ? raw.lookup.windowMinutes
            : FALLBACK.lookup.windowMinutes,
        maxAttempts:
          typeof raw.lookup?.maxAttempts === 'number' && raw.lookup.maxAttempts > 0
            ? Math.floor(raw.lookup.maxAttempts)
            : FALLBACK.lookup.maxAttempts
      },
      recognize: {
        enabled: raw.recognize?.enabled !== false,
        maxBytes:
          typeof raw.recognize?.maxBytes === 'number' && raw.recognize.maxBytes > 0
            ? Math.floor(raw.recognize.maxBytes)
            : FALLBACK.recognize.maxBytes,
        maxPages:
          typeof raw.recognize?.maxPages === 'number' && raw.recognize.maxPages > 0
            ? Math.floor(raw.recognize.maxPages)
            : FALLBACK.recognize.maxPages,
        hourlyLimit:
          typeof raw.recognize?.hourlyLimit === 'number' && raw.recognize.hourlyLimit > 0
            ? Math.floor(raw.recognize.hourlyLimit)
            : FALLBACK.recognize.hourlyLimit,
        ttlHours:
          typeof raw.recognize?.ttlHours === 'number' && raw.recognize.ttlHours > 0
            ? Math.floor(raw.recognize.ttlHours)
            : FALLBACK.recognize.ttlHours
      },
      slots: Array.isArray(raw.slots) ? raw.slots.map(normalizeSlot) : FALLBACK.slots
    }
  } catch {
    cached = { ...FALLBACK, passLine }
  }
  return cached ?? FALLBACK
}
