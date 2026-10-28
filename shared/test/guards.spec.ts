import { describe, expect, it } from 'vitest'
import { applyGrowthSignRule, detectGrowthShape } from '../src/scoring/guards'
import { parseExpr } from '../src/scoring/parser'
import { FLAG } from '../src/scoring/flags'

describe('增长率符号规则', () => {
  it('基期为负、本期为正补 1.0', () => {
    const result = applyGrowthSignRule(-500000, 800000)
    expect(result.value).toBe(1)
    expect(result.flags).toContain(FLAG.BASE_NEGATIVE)
  })

  it('基期为负、本期更负补 0.0', () => {
    const result = applyGrowthSignRule(-500000, -800000)
    expect(result.value).toBe(0)
    expect(result.flags).toContain(FLAG.BASE_NEGATIVE)
  })

  it('基期为零记分母为零', () => {
    const result = applyGrowthSignRule(0, 800000)
    expect(Number.isNaN(result.value)).toBe(true)
    expect(result.flags).toContain(FLAG.DENOMINATOR_ZERO)
  })

  it('正常区间用 (本期-基期)/|基期|', () => {
    expect(applyGrowthSignRule(1000000, 1200000).value).toBeCloseTo(0.2, 12)
    expect(applyGrowthSignRule(1000000, 800000).value).toBeCloseTo(-0.2, 12)
  })
})

describe('增长率公式识别', () => {
  it('识别 (a[y0]-a[y1])/abs(a[y1]) 形态', () => {
    const parsed = parseExpr('(fin.revenue[y0] - fin.revenue[y1]) / abs(fin.revenue[y1])')
    expect(detectGrowthShape(parsed.ast)).not.toBeNull()
  })

  it('普通比值不误判', () => {
    const parsed = parseExpr('mean(fin.rdExpense) / mean(fin.revenue)')
    expect(detectGrowthShape(parsed.ast)).toBeNull()
  })

  it('分母不是 abs(基期) 时不误判', () => {
    const parsed = parseExpr('(fin.revenue[y0] - fin.revenue[y1]) / fin.revenue[y2]')
    expect(detectGrowthShape(parsed.ast)).toBeNull()
  })
})
