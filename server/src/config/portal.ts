import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { PortalConfig, PortalSlot } from '@srdi/shared'
import { CONFIG_ROOT } from '../paths'

const PORTAL_FILE = 'portal.json'

const FALLBACK: PortalConfig = {
  version: '0.0.0',
  passLine: 60,
  softCopyright: { ratio: 3, cap: 3 },
  lookup: { windowMinutes: 10, maxAttempts: 10 },
  slots: []
}

const normalizeSlot = (raw: PortalSlot): PortalSlot => ({
  id: String(raw.id),
  title: String(raw.title),
  hint: String(raw.hint ?? ''),
  required: raw.required === true,
  accept: Array.isArray(raw.accept) ? raw.accept.map((item) => String(item).toLowerCase()) : []
})

let cached: PortalConfig | null = null

export const loadPortalConfig = (): PortalConfig => {
  if (cached) return cached
  try {
    const raw = JSON.parse(
      readFileSync(path.join(CONFIG_ROOT, PORTAL_FILE), 'utf8')
    ) as Partial<PortalConfig>
    cached = {
      version: raw.version ?? FALLBACK.version,
      passLine:
        typeof raw.passLine === 'number' && raw.passLine > 0 ? raw.passLine : FALLBACK.passLine,
      softCopyright: {
        ratio:
          typeof raw.softCopyright?.ratio === 'number' && raw.softCopyright.ratio > 0
            ? raw.softCopyright.ratio
            : FALLBACK.softCopyright.ratio,
        cap:
          typeof raw.softCopyright?.cap === 'number' && raw.softCopyright.cap >= 0
            ? raw.softCopyright.cap
            : FALLBACK.softCopyright.cap
      },
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
      slots: Array.isArray(raw.slots) ? raw.slots.map(normalizeSlot) : FALLBACK.slots
    }
  } catch {
    cached = FALLBACK
  }
  return cached
}
