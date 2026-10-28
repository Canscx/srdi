export const INDICATOR_STATUS_TEXT: Record<string, string> = {
  scored: '已计分',
  estimated: '估算',
  missing: '缺证据',
  notApplicable: '不适用',
  excluded: '已排除'
}

export const GATE_VERDICT_TEXT: Record<string, string> = {
  pass: '满足',
  fail: '不满足',
  unknown: '材料不足',
  pending: '需人工确认'
}

export const GATE_EFFECT_TEXT: Record<string, string> = {
  pass: '通过',
  fail: '阻断',
  pending: '待定'
}

export const GATE_BASIS_TEXT: Record<string, string> = {
  evidence: '证据判定',
  missing: '材料不足',
  unconfirmed: '待确认',
  mixed: '缺失 + 待确认',
  policy: '按策略放行',
  score: '分数判定'
}

export const CONCLUSION_TEXT: Record<string, string> = {
  pass: '门槛全过',
  fail: '存在硬性不满足',
  pending: '待补材料'
}

export const FLAG_TEXT: Record<string, string> = {
  negative_equity: '净资产为负',
  cost_nonpositive: '成本非正',
  revenue_nonpositive: '营收非正',
  base_negative: '基期为负',
  denominator_zero: '分母为零',
  partial_window: '窗口不完整',
  period_assumed: '期间推定',
  period_order_assumed: '年份顺序推定',
  period_not_in_window: '期间超窗',
  benchmark_default: '行业基准缺失',
  benchmark_missing: '基准缺失',
  partial_composite: '合成项不全',
  fallback_neutral: '中性兜底',
  guard_failed: '边界保护',
  not_finite: '非有限值',
  excluded: '按策略排除',
  gate_passed_by_policy: '策略放行',
  quote_unverified: '原文未匹配'
}

export const FIELD_GROUP_TITLES: Record<string, string> = {
  company: '企业主体',
  fin: '财务',
  ip: '知识产权',
  std: '标准',
  qual: '资质与荣誉',
  hr: '人员',
  other: '其他'
}

export const DOC_TYPE_TEXT: Record<string, string> = {
  audit: '审计报告',
  application: '申报书',
  tax: '纳税证明',
  patent: '专利清单',
  cert: '证书资质',
  standard: '标准文本',
  finance: '财务报表',
  other: '其他'
}
