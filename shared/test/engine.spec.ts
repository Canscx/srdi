import { describe, expect, it } from 'vitest'
import { evaluate } from '../src/scoring/engine'
import { buildModel, entry, rules } from './helpers'

const baseFields = {
  'company.name': entry('鼎新精工(虚构)'),
  'company.scitechSmeTitle': entry(true),
  'company.subMarketYears': entry(6),
  'company.employeeYearAvg': entry(260),

  'fin.revenue': entry({ 2025: 160000000, 2024: 135000000, 2023: 110000000 }),
  'fin.mainBusinessRevenue': entry({ 2025: 150000000, 2024: 128000000, 2023: 104000000 }),
  'fin.assetLiabilityRatio': entry(0.55),
  'fin.equityInvested': entry(25000000),
  'fin.rdExpense': entry({ 2025: 12000000, 2024: 9500000, 2023: 7000000 }),
  'fin.netProfit': entry({ 2025: 11000000, 2024: 9000000, 2023: 8000000 }),
  'fin.netAssets': entry({ 2025: 90000000, 2024: 80000000, 2023: 72000000 }),
  'fin.totalProfit': entry({ 2025: 13000000, 2024: 10500000, 2023: 9000000 }),
  'fin.productSalesCost': entry({ 2025: 120000000, 2024: 100000000, 2023: 82000000 }),
  'fin.operatingCost': entry({ 2025: 118000000, 2024: 99000000, 2023: 81000000 }),
  'fin.salesExpense': entry({ 2025: 9000000, 2024: 8000000, 2023: 7000000 }),
  'fin.adminExpense': entry({ 2025: 8000000, 2024: 7500000, 2023: 7000000 }),

  'ip.inventionGrantedByYear': entry([
    { year: 2025, count: 3 },
    { year: 2024, count: 2 },
    { year: 2023, count: 2 },
    { year: 2020, count: 4 }
  ]),
  'ip.ipcDistribution': entry([
    { ipc: 'B23', count: 4 },
    { ipc: 'G01', count: 2 },
    { ipc: 'H02', count: 1 }
  ]),
  'ip.inventionFirstApplicant': entry(7),
  'ip.inventionI': entry([
    { selfApplied: true, applicantRank: 1, transferredIn: false },
    { selfApplied: true, applicantRank: 2, transferredIn: false }
  ]),
  'ip.pctCount': entry(6),

  'std.hostedIntl': entry([]),
  'std.hostedNatInd': entry(['GB/T 1', 'JB/T 2']),
  'std.joinedIntl': entry([]),
  'std.joinedNatInd': entry(['GB/T 3']),

  'qual.qualityAward': entry('province_award'),
  'qual.productCert': entry(true),
  'qual.digitalTransformation': entry('ministry_title'),
  'qual.greenTitles': entry(['绿色工厂', '绿色供应链', '绿色设计产品']),
  'qual.rdInstitution': entry('province'),
  'qual.marketRanking': entry('province_top3'),
  'qual.scienceAward': entry(false),

  'hr.rdHeadcount': entry(60),
  'hr.totalHeadcount': entry(260)
}

const model = buildModel(baseFields)
const result = evaluate(model, rules)
const byId = (id: string) => result.indicators.find((item) => item.id === id)

describe('引擎整体', () => {
  it('输出 23 项指标与 6 道门槛', () => {
    expect(result.indicators).toHaveLength(23)
    expect(result.gates).toHaveLength(6)
    expect(result.dimensions).toHaveLength(5)
  })

  it('权重归一后合计 100', () => {
    const sum = result.indicators.reduce((acc, item) => acc + item.effectiveWeight, 0)
    expect(sum).toBeCloseTo(100, 9)
  })

  it('C 类不可得项被排除且权重已分摊', () => {
    const excluded = byId('IND_18')
    expect(excluded?.status).toBe('excluded')
    expect(excluded?.effectiveWeight).toBe(0)
    expect(result.excluded.map((item) => item.indicatorId)).toContain('IND_18')
  })

  it('三口径满足 conservative ≤ official ≤ optimistic', () => {
    expect(result.totals.conservative).toBeLessThanOrEqual(result.totals.official)
    expect(result.totals.official).toBeLessThanOrEqual(result.totals.optimistic)
  })

  it('强指标企业 six 门槛全过且结论为通过', () => {
    expect(result.gates.every((gate) => gate.effective === 'pass')).toBe(true)
    expect(result.conclusion).toBe('pass')
    expect(result.totals.conservative).toBeGreaterThan(50)
  })

  it('单项得分率落在 [0,1]', () => {
    for (const item of result.indicators) {
      if (item.score !== null) {
        expect(item.score).toBeGreaterThanOrEqual(0)
        expect(item.score).toBeLessThanOrEqual(1)
      }
    }
  })

  it('区间加权指标按近三年×2 + 其他年份×1 计分', () => {
    expect(byId('IND_17')?.raw).toBe(18)
  })

  it('标准计分不触顶时按 cap 折算', () => {
    const ind = byId('IND_04')
    expect(ind?.raw).toBe(7)
    expect(ind?.score).toBeCloseTo(0.7, 9)
  })

  it('含公式的指标都带出处文字', () => {
    for (const item of result.indicators) {
      expect(item.explain.text.length).toBeGreaterThan(0)
    }
  })
})

describe('缺失字段的三口径展开', () => {
  const { 'qual.productCert': _omitted, ...partialFields } = baseFields
  const partial = evaluate(buildModel(partialFields), rules)
  const target = partial.indicators.find((item) => item.id === 'IND_10')

  it('缺证据的指标按 absent 处理', () => {
    expect(target?.status).toBe('missing')
    expect(target?.basis).toBe('absent')
    expect(target?.score).toBeNull()
  })

  it('official 取中性 0.5,conservative 记 0,optimistic 记满分', () => {
    const weight = target?.effectiveWeight ?? 0
    expect(target?.contribution.official).toBeCloseTo(weight * 0.5, 9)
    expect(target?.contribution.conservative).toBe(0)
    expect(target?.contribution.optimistic).toBeCloseTo(weight, 9)
  })

  it('三口径区间被拉开且 confidence 下降', () => {
    expect(partial.totals.conservative).toBeLessThan(partial.totals.official)
    expect(partial.totals.official).toBeLessThan(partial.totals.optimistic)
    expect(partial.totals.confidence).toBeLessThan(1)
  })

  it('缺失项进入缺失清单', () => {
    expect(partial.missing.map((item) => item.indicatorId)).toContain('IND_10')
  })
})
