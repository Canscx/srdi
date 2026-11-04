import { describe, expect, it } from 'vitest'
import { isLowConfidenceZero } from '../src/portal/confirm'

describe('零值自动确认保护', () => {
  it('非按年字段的低置信度 0 不自动确认', () => {
    expect(isLowConfidenceZero(false, 0, 0.7)).toBe(true)
    expect(isLowConfidenceZero(undefined, 0, 0.5)).toBe(true)
  })

  it('置信度足够时 0 仍可确认', () => {
    expect(isLowConfidenceZero(false, 0, 0.95)).toBe(false)
  })

  it('按年字段的 0 是合法值', () => {
    expect(isLowConfidenceZero(true, 0, 0.2)).toBe(false)
  })

  it('非零值不受影响', () => {
    expect(isLowConfidenceZero(false, 3, 0.2)).toBe(false)
  })
})
