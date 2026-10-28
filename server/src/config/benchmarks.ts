import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BENCHMARKS_FILE } from '@srdi/shared'
import { BENCHMARKS_DIR } from '../paths'

let cached: string | undefined

export const loadBenchmarksVersion = (): string | undefined => {
  if (cached !== undefined) return cached
  try {
    const raw = JSON.parse(readFileSync(path.join(BENCHMARKS_DIR, BENCHMARKS_FILE), 'utf8')) as {
      version?: string
    }
    cached = raw.version
  } catch {
    cached = undefined
  }
  return cached
}
