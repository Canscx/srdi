import { describe, expect, it } from 'vitest'
import { yearsSinceDate } from '../src/portal'

const at = (iso: string) => new Date(`${iso}T12:00:00`)

describe('成立年限', () => {
  it('按当前日期算满整年', () => {
    expect(yearsSinceDate('2017-01-20', at('2026-11-03'))).toBe(9)
    expect(yearsSinceDate('2017-01-20', at('2026-01-20'))).toBe(9)
    expect(yearsSinceDate('2017-01-20', at('2026-01-19'))).toBe(8)
    expect(yearsSinceDate('2017-12-31', at('2026-01-01'))).toBe(8)
  })

  it('缺日时按 1 日处理', () => {
    expect(yearsSinceDate('2017-01', at('2026-01-01'))).toBe(9)
    expect(yearsSinceDate('2017-01', at('2025-12-31'))).toBe(8)
  })

  it('非法值返回 null', () => {
    expect(yearsSinceDate('', at('2026-11-03'))).toBeNull()
    expect(yearsSinceDate('2017', at('2026-11-03'))).toBeNull()
    expect(yearsSinceDate('2017-13-01', at('2026-11-03'))).toBeNull()
    expect(yearsSinceDate('未来', at('2026-11-03'))).toBeNull()
  })

  it('成立日期晚于当前时间时不返回负数', () => {
    expect(yearsSinceDate('2027-05-01', at('2026-11-03'))).toBeNull()
  })
})
