import { describe, expect, it } from 'vitest'
import { TARGET_RATE, goalContributionOf, rollupGoal } from '../src/portal'
import type { IndicatorResult } from '../src/scoring/types'

const make = (patch: Partial<IndicatorResult>): IndicatorResult => ({
  id: 'IND_X',
  code: 1,
  name: '测试指标',
  dimensionId: 'DIM_TEST',
  status: 'scored',
  basis: 'measured',
  quality: 'verified',
  raw: null,
  score: null,
  weight: 10,
  effectiveWeight: 10,
  contribution: { official: 0, conservative: 0, optimistic: 0 },
  benchmark: null,
  flags: [],
  explain: { template: '', text: '' },
  ...patch
})

describe('补齐并达标口径', () => {
  it('达标线为 80%', () => {
    expect(TARGET_RATE).toBe(0.8)
  })

  it('measured 低于达标线按 80% 权重兜底', () => {
    const item = make({ contribution: { official: 1, conservative: 1, optimistic: 1 } })
    expect(goalContributionOf(item)).toBe(8)
    expect(goalContributionOf(item)).toBeGreaterThanOrEqual(item.contribution.official)
  })

  it('measured 高于达标线取实际贡献', () => {
    const item = make({ contribution: { official: 9, conservative: 9, optimistic: 9 } })
    expect(goalContributionOf(item)).toBe(9)
  })

  it('absent 与 substituted 记满权重', () => {
    const absent = make({
      status: 'missing',
      basis: 'absent',
      quality: 'unknown',
      contribution: { official: 5, conservative: 0, optimistic: 10 }
    })
    const substituted = make({
      status: 'estimated',
      basis: 'substituted',
      quality: 'estimated',
      contribution: { official: 5, conservative: 0, optimistic: 10 }
    })
    expect(goalContributionOf(absent)).toBe(10)
    expect(goalContributionOf(substituted)).toBe(10)
  })

  it('notApplicable 与 excluded 记 0', () => {
    const notApplicable = make({ status: 'notApplicable', basis: 'notApplicable' })
    const excluded = make({ status: 'excluded', basis: 'excluded', effectiveWeight: 0 })
    expect(goalContributionOf(notApplicable)).toBe(0)
    expect(goalContributionOf(excluded)).toBe(0)
  })

  it('总分封顶 100 且不低于 official', () => {
    const items = Array.from({ length: 13 }, () =>
      make({
        status: 'missing',
        basis: 'absent',
        quality: 'unknown',
        contribution: { official: 5, conservative: 0, optimistic: 10 }
      })
    )
    expect(rollupGoal(items)).toBe(100)

    const mixed = [
      make({ contribution: { official: 1, conservative: 1, optimistic: 1 } }),
      make({
        status: 'missing',
        basis: 'absent',
        quality: 'unknown',
        contribution: { official: 5, conservative: 0, optimistic: 10 }
      })
    ]
    const official = mixed.reduce((sum, item) => sum + item.contribution.official, 0)
    expect(rollupGoal(mixed)).toBeGreaterThanOrEqual(official)
  })
})
