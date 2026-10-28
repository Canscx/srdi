import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BENCHMARKS_FILE } from '@srdi/shared'
import type { BenchmarksDoc } from '@srdi/shared'
import { AppError } from '../errors'
import { BENCHMARKS_DIR } from '../paths'

let cached: string | undefined
let cachedDoc: BenchmarksDoc | null = null

const filePath = () => path.join(BENCHMARKS_DIR, BENCHMARKS_FILE)

export const loadBenchmarks = (): BenchmarksDoc => {
  if (cachedDoc) return cachedDoc
  try {
    cachedDoc = JSON.parse(readFileSync(filePath(), 'utf8')) as BenchmarksDoc
  } catch (err) {
    throw new AppError(
      500,
      'benchmarks_unavailable',
      '行业基准表读取失败,无法打分',
      (err as Error).message
    )
  }
  return cachedDoc
}

export const loadBenchmarksVersion = (): string | undefined => {
  if (cached !== undefined) return cached
  try {
    const raw = JSON.parse(readFileSync(filePath(), 'utf8')) as {
      version?: string
    }
    cached = raw.version
  } catch {
    cached = undefined
  }
  return cached
}
