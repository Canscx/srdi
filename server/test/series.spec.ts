import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import { evaluate } from '@srdi/shared'
import type { BenchmarksDoc, FieldCandidate, RulesDoc } from '@srdi/shared'
import benchmarksJson from '../../config/benchmarks/industry-benchmarks.v1.2.0.json'
import rulesJson from '../../config/rules/rules.srdi.v1.0.0.json'
import { createStore } from '../src/store'
import { withTempDir } from './helpers'

const schemaFile = fileURLToPath(new URL('../../shared/schema/evidence.schema.json', import.meta.url))
const validateEvidence = new Ajv({ allErrors: true, strict: false }).compile(
  JSON.parse(readFileSync(schemaFile, 'utf8'))
)

const rules = rulesJson as unknown as RulesDoc
const benchmarks = benchmarksJson as unknown as BenchmarksDoc

const PERIOD = { y0: 2025, y1: 2024, y2: 2023 }

const candidate = (
  candidateId: string,
  period: number,
  value: number,
  confidence = 0.9
): FieldCandidate => ({
  candidateId,
  value,
  period,
  unit: 'CNY',
  confidence,
  source: {
    fileId: 'f_test',
    fileName: '财报.pdf',
    page: 2,
    route: 'text',
    quote: `${value}`,
    quoteMatched: true
  }
})

describe('按年合并候选', () => {
  it('三年候选合并成按年字典,成长性指标拿到真实增速', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '合并测试', period: PERIOD })

      await store.evidence.appendCandidates(project, 'fin.revenue', [
        candidate('c2025', 2025, 14733263.93, 0.96),
        candidate('c2024zero', 2024, 0, 0.4),
        candidate('c2024', 2024, 339100.94, 0.92),
        candidate('c2023', 2023, 1, 0.9)
      ])

      const entry = await store.evidence.confirmSeries(project, 'fin.revenue', [
        { period: 2025, candidateId: 'c2025' },
        { period: 2024, candidateId: 'c2024' },
        { period: 2023, candidateId: 'c2023' }
      ])

      expect(entry.status).toBe('confirmed')
      expect(entry.value).toEqual({ '2023': 1, '2024': 339100.94, '2025': 14733263.93 })
      expect(entry.resolution?.strategy).toBe('auto_series')
      expect(entry.resolution?.pickedCandidateIds).toEqual(['c2025', 'c2024', 'c2023'])

      const doc = await store.evidence.get(project)
      expect(validateEvidence(doc), JSON.stringify(validateEvidence.errors)).toBe(true)

      const result = evaluate({ evidence: doc, benchmarks }, rules)
      const growth = result.indicators.find((item) => item.id === 'IND_21')
      expect(growth?.raw).toBeCloseTo((14733263.93 - 339100.94) / 339100.94, 6)
      expect(growth?.basis).toBe('measured')
    })
  })

  it('窗口外年份被丢弃并打标,同年重复只留第一个', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '边界测试', period: PERIOD })

      await store.evidence.appendCandidates(project, 'fin.netAssets', [
        candidate('a2025', 2025, 100, 0.9),
        candidate('a2025dup', 2025, 999, 0.95),
        candidate('a2019', 2019, 50, 0.9),
        candidate('a2024', 2024, 80, 0.9)
      ])

      const entry = await store.evidence.confirmSeries(project, 'fin.netAssets', [
        { period: 2025, candidateId: 'a2025' },
        { period: 2025, candidateId: 'a2025dup' },
        { period: 2019, candidateId: 'a2019' },
        { period: 2024, candidateId: 'a2024' }
      ])

      expect(entry.value).toEqual({ '2025': 100, '2024': 80 })
      expect(entry.flags).toContain('out_of_window_dropped')
      expect(entry.flags).toContain('series_period_conflict')
    })
  })

  it('非数值候选与空年份列表都被拒绝', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '拒绝测试', period: PERIOD })

      await store.evidence.appendCandidates(project, 'fin.revenue', [
        {
          candidateId: 'text',
          value: '约一千三百万',
          period: 2025,
          source: { fileId: 'f_test', page: 1, route: 'text' }
        }
      ])

      await expect(
        store.evidence.confirmSeries(project, 'fin.revenue', [
          { period: 2025, candidateId: 'text' }
        ])
      ).rejects.toThrow(/没有可用的数值/)

      await expect(
        store.evidence.confirmSeries(project, 'fin.revenue', [])
      ).rejects.toThrow(/至少需要一个年份/)
    })
  })
})

describe('客户自述数据', () => {
  it('写入 declared 策略并保留出处说明', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '自述测试', period: PERIOD })

      const entry = await store.evidence.declareValue(project, 'ip.inventionGrantedByYear', {
        value: [{ year: 2025, count: 4 }],
        note: '客户自述：近三年发明专利 1 件 + 软著折算 3 件'
      })

      expect(entry.status).toBe('confirmed')
      expect(entry.resolution?.strategy).toBe('declared')
      expect(entry.resolution?.resolvedBy).toBe('client')
      expect(entry.declared?.by).toBe('client')
      expect(entry.flags).toContain('declared_value')

      const doc = await store.evidence.get(project)
      expect(validateEvidence(doc), JSON.stringify(validateEvidence.errors)).toBe(true)

      const result = evaluate({ evidence: doc, benchmarks }, rules)
      const invention = result.indicators.find((item) => item.id === 'IND_17')
      expect(invention?.raw).toBeCloseTo(8, 6)
    })
  })

  it('数值型字段拒绝字符串', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '类型测试', period: PERIOD })
      await expect(
        store.evidence.declareValue(project, 'hr.totalHeadcount', {
          value: '三十人',
          note: '客户自述'
        })
      ).rejects.toThrow(/需要数值/)
    })
  })
})
