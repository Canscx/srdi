import { describe, expect, it } from 'vitest'
import { buildContext } from '../src/scoring/context'
import { evalNode, evalTri } from '../src/scoring/evaluate'
import { parseExpr } from '../src/scoring/parser'
import { ExprSyntaxError, normalizeExpr } from '../src/scoring/normalize'
import { buildModel, entry, rules } from './helpers'

const model = buildModel({
  'fin.revenue': entry({ '2025': 100000000, '2024': 50000000, '2023': 200000000 }),
  'fin.rdExpense': entry({ '2025': 5000000, '2024': 4000000, '2023': 6000000 }),
  'ip.inventionGrantedByYear': entry([
    { year: 2025, count: 3 },
    { year: 2024, count: 2 },
    { year: 2023, count: 2 },
    { year: 2020, count: 4 }
  ]),
  'ip.inventionI': entry([
    { selfApplied: true, applicantRank: 1, transferredIn: false },
    { selfApplied: true, applicantRank: 3, transferredIn: false },
    { selfApplied: false, applicantRank: 1, transferredIn: false },
    { selfApplied: true, applicantRank: 5, transferredIn: false }
  ]),
  'std.hostedIntl': entry(['ISO 1', 'ISO 2'])
})

const ctx = buildContext(model, rules)

const number = (expr: string): number => {
  const value = evalNode(parseExpr(expr).ast, { ctx })
  if (value.kind !== 'num') throw new Error(`期望数值,实际 ${value.kind}`)
  return value.v
}

describe('normalizeExpr', () => {
  it('区间改写为 @ 运算符', () => {
    expect(normalizeExpr('sum(x[y0..y2])').text).toBe('sum(x[y0 @ y2])')
    expect(normalizeExpr('sum(x[ y0 .. y2 ])').text).toBe('sum(x[ y0 @ y2 ])')
  })

  it('#count 改写为 count()', () => {
    expect(normalizeExpr('std.hostedIntl#count').text).toBe('count(std.hostedIntl)')
    expect(normalizeExpr('qual.greenTitles#count').text).toBe('count(qual.greenTitles)')
  })

  it('不动普通下标与字符串内容', () => {
    expect(normalizeExpr('fin.revenue[y0]').text).toBe('fin.revenue[y0]')
    expect(normalizeExpr("qual.rdInstitution == 'a..b'").text).toBe("qual.rdInstitution == 'a..b'")
  })

  it('括号不配对时报错', () => {
    expect(() => normalizeExpr('sum(x[y0..y2]')).toThrow(ExprSyntaxError)
  })
})

describe('表达式求值', () => {
  it('时间索引取单年值', () => {
    expect(number('fin.revenue[y0]')).toBe(100000000)
    expect(number('fin.revenue[y2]')).toBe(200000000)
  })

  it('区间求和只覆盖三年窗口', () => {
    expect(number('sum(ip.inventionGrantedByYear[y0..y2])')).toBe(7)
    expect(number('sum(ip.inventionGrantedByYear[others])')).toBe(4)
  })

  it('无索引的周期字段返回序列,mean 求三年均值', () => {
    expect(number('mean(fin.revenue)')).toBeCloseTo(116666666.6667, 3)
  })

  it('比值之均值不等于均值之比', () => {
    const ratioOfMean = number('mean(fin.rdExpense / fin.revenue)')
    const meanOfRatio = number('mean(fin.rdExpense) / mean(fin.revenue)')
    expect(ratioOfMean).toBeCloseTo(0.0533333, 6)
    expect(meanOfRatio).toBeCloseTo(0.0428571, 6)
    expect(ratioOfMean).not.toBeCloseTo(meanOfRatio, 4)
  })

  it('where 过滤按行作用域求值', () => {
    expect(number('count(ip.inventionI where selfApplied == true && applicantRank <= 3 && transferredIn == false)')).toBe(2)
  })

  it('#count 统计集合元素', () => {
    expect(number('std.hostedIntl#count')).toBe(2)
  })

  it('abs 与四则运算', () => {
    expect(number('(fin.revenue[y0] - fin.revenue[y1]) / abs(fin.revenue[y1])')).toBeCloseTo(1, 10)
  })

  it('count 多参数必须报错', () => {
    expect(() => parseExpr('count(a, b)')).toThrow(ExprSyntaxError)
  })

  it('where 裸用必须报错', () => {
    expect(() => parseExpr('a where b')).toThrow(ExprSyntaxError)
  })
})

describe('三值逻辑', () => {
  const empty = buildContext(buildModel({}), rules)

  it('缺失字段比较得到 unknown', () => {
    const tri = evalTri(parseExpr('fin.revenue[y0] >= 15000000').ast, { ctx: empty })
    expect(tri.v).toBeNull()
    expect(tri.missing.length).toBeGreaterThan(0)
  })

  it('任一分支为真则 or 为真,不受另一侧缺失影响', () => {
    const tri = evalTri(parseExpr('1 > 0 || fin.revenue[y0] >= 15000000').ast, { ctx: empty })
    expect(tri.v).toBe(true)
  })

  it('任一分支为假则 and 为假', () => {
    const tri = evalTri(parseExpr('1 < 0 && fin.revenue[y0] >= 15000000').ast, { ctx: empty })
    expect(tri.v).toBe(false)
  })
})
