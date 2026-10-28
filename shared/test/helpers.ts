import benchmarksJson from '../../config/benchmarks/industry-benchmarks.v1.2.0.json'
import rulesJson from '../../config/rules/rules.srdi.v1.0.0.json'
import type { BenchmarksDoc, FieldEntry, RulesDoc, ScoringModel } from '../src/scoring/types'

export const rules = rulesJson as unknown as RulesDoc
export const benchmarks = benchmarksJson as unknown as BenchmarksDoc

export const entry = (value: unknown, extra: Partial<FieldEntry> = {}): FieldEntry => ({
  key: '',
  status: 'confirmed',
  value: value as FieldEntry['value'],
  ...extra
})

export const period = { y0: 2025, y1: 2024, y2: 2023 }

export const buildModel = (fields: Record<string, FieldEntry>, industryCode = 'C35'): ScoringModel => {
  const normalized: Record<string, FieldEntry> = {}
  for (const [key, value] of Object.entries(fields)) {
    normalized[key] = { ...value, key }
  }

  return {
    evidence: {
      schemaVersion: '1.0.0',
      projectId: 'test-project',
      level: 'SRDI',
      rulesId: rules.rulesId,
      period,
      company: { name: '测试企业', industryCode },
      fields: normalized
    },
    benchmarks,
    industryCode
  }
}
