import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import benchmarksJson from '../../config/benchmarks/industry-benchmarks.v1.2.0.json'
import rulesJson from '../../config/rules/rules.srdi.v1.0.0.json'
import { evaluate } from '../src/scoring/engine'
import type { BenchmarksDoc, EvidenceDoc, RulesDoc, ScoreResult } from '../src/scoring/types'

interface GateSnapshot {
  id: string
  verdict: string
  effective: string
  passedVia: string | null
}

interface Golden {
  fixture: string
  engine: string
  totals: { official: number; conservative: number; optimistic: number; confidence: number }
  conclusion: string
  gates: GateSnapshot[]
  dimensions: Record<string, number>
  excluded: string[]
  absent: string[]
  flags: string[]
  anchors: Record<string, { score: number | null; basis: string | null }>
}

const rules = rulesJson as unknown as RulesDoc
const benchmarks = benchmarksJson as unknown as BenchmarksDoc

const readJson = <T>(relative: string): T =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as T

const fixtures = ['firm-a', 'firm-b', 'firm-c'] as const

const run = (name: string): { result: ScoreResult; golden: Golden } => {
  const evidence = readJson<EvidenceDoc>(`./fixtures/${name}.json`)
  const golden = readJson<Golden>(`./expected/${name}.golden.json`)
  const result = evaluate(
    { evidence, benchmarks, industryCode: evidence.company?.industryCode },
    rules
  )
  return { result, golden }
}

describe.each(fixtures)('%s 与 golden 快照一致', (name) => {
  const { result, golden } = run(name)

  it('三口径与置信度', () => {
    expect(result.totals).toEqual(golden.totals)
  })

  it('总体结论', () => {
    expect(result.conclusion).toBe(golden.conclusion)
  })

  it('六道门槛的判词与依据', () => {
    const actual = result.gates.map((gate) => ({
      id: gate.id,
      verdict: gate.verdict,
      effective: gate.effective,
      passedVia: gate.passedVia ?? null
    }))
    expect(actual).toEqual(golden.gates)
  })

  it('五个维度的 official 分', () => {
    const actual = Object.fromEntries(result.dimensions.map((dim) => [dim.id, dim.score.official]))
    expect(actual).toEqual(golden.dimensions)
  })

  it('排除项与缺失项清单', () => {
    expect(result.indicators.filter((item) => item.basis === 'excluded').map((item) => item.id)).toEqual(golden.excluded)
    expect(result.indicators.filter((item) => item.basis === 'absent').map((item) => item.id)).toEqual(golden.absent)
  })

  it('全局标记集合', () => {
    expect([...result.flags].sort()).toEqual(golden.flags)
  })

  it('八个锚点指标与手算一致', () => {
    for (const [id, expected] of Object.entries(golden.anchors)) {
      const item = result.indicators.find((entry) => entry.id === id)
      expect(item, id).toBeDefined()
      expect(item?.basis, id).toBe(expected.basis)
      if (expected.score === null) {
        expect(item?.score, id).toBeNull()
      } else {
        expect(item?.score ?? Number.NaN, id).toBeCloseTo(expected.score, 6)
      }
    }
  })

  it('结构不变量', () => {
    expect(result.totals.conservative).toBeLessThanOrEqual(result.totals.official)
    expect(result.totals.official).toBeLessThanOrEqual(result.totals.optimistic)

    const weightSum = result.indicators.reduce((sum, item) => sum + item.effectiveWeight, 0)
    expect(weightSum).toBeCloseTo(100, 9)

    for (const item of result.indicators) {
      if (item.score !== null) {
        expect(item.score).toBeGreaterThanOrEqual(0)
        expect(item.score).toBeLessThanOrEqual(1)
      }
      expect(item.explain.text.length).toBeGreaterThan(0)
    }

    expect(result.totals.confidence).toBeGreaterThanOrEqual(0)
    expect(result.totals.confidence).toBeLessThanOrEqual(1)
  })
})

describe('三家企业的形态差异', () => {
  const firmA = run('firm-a').result
  const firmB = run('firm-b').result
  const firmC = run('firm-c').result

  it('A 家数据齐备,六门槛全过且高分', () => {
    expect(firmA.conclusion).toBe('pass')
    expect(firmA.gates.every((gate) => gate.effective === 'pass')).toBe(true)
    expect(firmA.totals.conservative).toBeGreaterThanOrEqual(70)
    expect(firmA.totals.confidence).toBe(1)
    expect(firmA.indicators.filter((item) => item.basis === 'absent')).toHaveLength(0)
  })

  it('B 家门槛全过但材料缺口让区间拉开,门槛 6 判有条件达标', () => {
    expect(firmB.gates.slice(0, 5).every((gate) => gate.effective === 'pass')).toBe(true)
    expect(firmB.gates[5].verdict).toBe('pending')
    expect(firmB.totals.conservative).toBeLessThan(50)
    expect(firmB.totals.official).toBeGreaterThanOrEqual(50)
    expect(firmB.conclusion).toBe('pending')
    expect(firmB.indicators.filter((item) => item.basis === 'absent')).toHaveLength(5)
  })

  it('C 家硬性不达标且结论为不通过', () => {
    expect(firmC.conclusion).toBe('fail')
    expect(firmC.gates[1].effective).toBe('fail')
    expect(firmC.gates[2].effective).toBe('fail')
    expect(firmC.gates[4].effective).toBe('fail')
    expect(firmC.totals.conservative).toBeLessThan(30)
  })

  it('C 家四类边界保护全部触发', () => {
    expect(firmC.flags).toContain('negative_equity')
    expect(firmC.flags).toContain('cost_nonpositive')
    expect(firmC.flags).toContain('base_negative')
    expect(firmC.flags).toContain('denominator_zero')

    const roe = firmC.indicators.find((item) => item.id === 'IND_06')
    expect(roe?.status).toBe('notApplicable')
    expect(roe?.score).toBe(0)

    const costMargin = firmC.indicators.find((item) => item.id === 'IND_07')
    expect(costMargin?.status).toBe('notApplicable')

    const profitGrowth = firmC.indicators.find((item) => item.id === 'IND_22')
    expect(profitGrowth?.raw).toBeCloseTo(1, 9)

    const assetGrowth = firmC.indicators.find((item) => item.id === 'IND_23')
    expect(assetGrowth?.raw).toBeCloseTo(0, 9)
  })

  it('B 家的 GATE_4 走自主专利通过,GATE_5 走省内前十通过', () => {
    expect(firmB.gates[3].passedVia).toBe('G4a')
    expect(firmB.gates[4].passedVia).toBe('G5b')
  })

  it('A 家的 GATE_4 优先记豁免条目', () => {
    expect(firmA.gates[3].passedVia).toBe('G4c')
  })
})
