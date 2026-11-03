import { describe, expect, it } from 'vitest'
import { creditCodeCheckChar, isValidCreditCode, normalizeCreditCode } from '../src/creditCode'

describe('统一社会信用代码 GB 32100 校验', () => {
  it('接受合法号码', () => {
    expect(isValidCreditCode('91310105MA1FW5R45P')).toBe(true)
  })

  it('拒绝含非法字符的号码', () => {
    expect(isValidCreditCode('91310105MAIFWSR4SP')).toBe(false)
    expect(isValidCreditCode('91310105MAOFWSR45P')).toBe(false)
  })

  it('拒绝校验位错误的号码', () => {
    expect(isValidCreditCode('91310105MA1FW5R45Q')).toBe(false)
  })

  it('拒绝长度与空值', () => {
    expect(isValidCreditCode('')).toBe(false)
    expect(isValidCreditCode('123')).toBe(false)
    expect(isValidCreditCode('91310105MA1FW5R45')).toBe(false)
    expect(isValidCreditCode('91310105MA1FW5R45PP')).toBe(false)
  })

  it('归一化大小写与空白', () => {
    expect(normalizeCreditCode(' 91310105 ma1fw5r45p ')).toBe('91310105MA1FW5R45P')
    expect(isValidCreditCode('91310105ma1fw5r45p')).toBe(true)
    expect(isValidCreditCode('91310105 MA1FW5R45P')).toBe(true)
    expect(isValidCreditCode('\u300091310105MA1FW5R45P')).toBe(true)
  })

  it('校验位可单独计算', () => {
    expect(creditCodeCheckChar('91310105MA1FW5R45')).toBe('P')
    expect(creditCodeCheckChar('91310105MAIFWSR4S')).toBeNull()
    expect(creditCodeCheckChar('91310105MA1FW5R4')).toBeNull()
  })
})
