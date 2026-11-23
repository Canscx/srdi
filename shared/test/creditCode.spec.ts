import { describe, expect, it } from 'vitest'
import { creditCodeCheckChar, isValidCreditCode, normalizeCreditCode } from '../src/creditCode'

describe('统一社会信用代码 GB 32100 校验', () => {
  it('接受合法号码', () => {
    expect(isValidCreditCode('91320100MA1AB2CD3N')).toBe(true)
  })

  it('拒绝含非法字符的号码', () => {
    expect(isValidCreditCode('91320100MAIAB2CD3N')).toBe(false)
    expect(isValidCreditCode('91320100MAOAB2CD3P')).toBe(false)
  })

  it('拒绝校验位错误的号码', () => {
    expect(isValidCreditCode('91320100MA1AB2CD3M')).toBe(false)
  })

  it('拒绝长度与空值', () => {
    expect(isValidCreditCode('')).toBe(false)
    expect(isValidCreditCode('123')).toBe(false)
    expect(isValidCreditCode('91320100MA1AB2CD3')).toBe(false)
    expect(isValidCreditCode('91320100MA1AB2CD3NN')).toBe(false)
  })

  it('归一化大小写与空白', () => {
    expect(normalizeCreditCode(' 91320100 ma1ab2cd3n ')).toBe('91320100MA1AB2CD3N')
    expect(isValidCreditCode('91320100ma1ab2cd3n')).toBe(true)
    expect(isValidCreditCode('91320100 MA1AB2CD3N')).toBe(true)
    expect(isValidCreditCode('\u300091320100MA1AB2CD3N')).toBe(true)
  })

  it('校验位可单独计算', () => {
    expect(creditCodeCheckChar('91320100MA1AB2CD3')).toBe('N')
    expect(creditCodeCheckChar('91320100MAIAB2CD3')).toBeNull()
    expect(creditCodeCheckChar('91320100MA1AB2CD')).toBeNull()
  })
})
