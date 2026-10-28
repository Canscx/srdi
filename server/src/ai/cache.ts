import { createHash } from 'node:crypto'
import path from 'node:path'
import type { DocType } from '@srdi/shared'
import { readJson, writeJson } from '../store/atomic'
import type { ValidatedField } from './validate'

export interface CacheKeyParts {
  sha256: string
  promptVersion: string
  model: string
  subsetHash: string
}

export interface CachedExtraction {
  key: string
  promptVersion: string
  model: string
  subsetHash: string
  sha256: string
  docType: DocType
  fields: ValidatedField[]
  unreadable: { page: number; reason: string }[]
  usage: { promptTokens: number; completionTokens: number }
  chunks: { total: number; failed: number }
  flags: Record<string, number>
  createdAt: string
}

export const extractionCacheKey = (parts: CacheKeyParts) =>
  createHash('sha256')
    .update([parts.sha256, parts.promptVersion, parts.model, parts.subsetHash].join('|'))
    .digest('hex')

export interface ExtractionCache {
  dir: string
  read: (key: string) => Promise<CachedExtraction | null>
  write: (entry: CachedExtraction) => Promise<void>
}

export const createExtractionCache = (projectDir: string): ExtractionCache => {
  const dir = path.join(projectDir, 'cache', 'ai')
  return {
    dir,
    read: async (key) => {
      const entry = await readJson<CachedExtraction>(path.join(dir, `${key}.json`))
      if (!entry || entry.key !== key) return null
      if (!Array.isArray(entry.fields)) return null
      return entry
    },
    write: async (entry) => {
      await writeJson(path.join(dir, `${entry.key}.json`), entry)
    }
  }
}
