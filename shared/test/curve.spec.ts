import { describe, expect, it } from 'vitest'
import { mapBenchmarkCurve } from '../src/scoring/scorers/benchmark'
import { scorePiecewise } from '../src/scoring/scorers/piecewise'
import { scoreTier } from '../src/scoring/scorers/tier'
import { triFalse, triNull, triTrue } from '../src/scoring/tri'

const curve = { base: 0.6, kUp: 0.5, kDown: 1.0 }
const benchmark = 100

describe('B 类映射曲线', () => {
  const cases: [number, number][] = [
    [-1, 0],
    [-0.5, 0.3],
    [0, 0.6],
    [0.25, 0.8],
    [0.5, 1],
    [1, 1]
  ]

  it.each(cases)('δ=%s 时得分率为 %s', (delta, expected) => {
    const x = benchmark * (1 + delta)
    expect(mapBenchmarkCurve(x, benchmark, curve, 'positive').s).toBeCloseTo(expected, 12)
  })

  it('逆向指标把费用率更低视为更好', () => {
    expect(mapBenchmarkCurve(50, 100, curve, 'negative').s).toBeCloseTo(1, 12)
    expect(mapBenchmarkCurve(200, 100, curve, 'negative').s).toBeCloseTo(0, 12)
  })
})

describe('分段线性', () => {
  const spec = { type: 'piecewise' as const, points: [[0, 0], [2, 0.2], [4, 0.4]] as [number, number][], clamp: [0, 1] as [number, number], tail: 'hold' as const }

  it('中间点线性插值', () => {
    expect(scorePiecewise(spec, 3).s).toBeCloseTo(0.3, 12)
  })

  it('低于首点保持首值', () => {
    expect(scorePiecewise(spec, -5).s).toBe(0)
  })

  it('高于末点保持末值', () => {
    expect(scorePiecewise(spec, 100).s).toBeCloseTo(0.4, 12)
  })
})

describe('档位求值', () => {
  const spec = {
    maxPoints: 10,
    tiers: [
      { when: "q == 'a'", points: 10, label: 'A' },
      { when: "q == 'b'", points: 5, label: 'B' },
      { when: 'true', points: 0, label: '其他' }
    ]
  }

  it('首个命中即返回,不累加', () => {
    const result = scoreTier(spec, (when) => (when === "q == 'a'" ? triTrue() : triFalse()))
    expect(result.points).toBe(10)
    expect(result.s).toBe(1)
  })

  it('前面档位不确定时不能落到兜底档', () => {
    const result = scoreTier(spec, (when) => (when === 'true' ? triTrue() : triNull(['q'])))
    expect(result.status).toBe('indeterminate')
  })
})
