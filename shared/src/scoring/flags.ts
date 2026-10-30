export const FLAG = {
  NEGATIVE_EQUITY: 'negative_equity',
  COST_NONPOSITIVE: 'cost_nonpositive',
  REVENUE_NONPOSITIVE: 'revenue_nonpositive',
  BASE_NEGATIVE: 'base_negative',
  DENOMINATOR_ZERO: 'denominator_zero',
  PARTIAL_WINDOW: 'partial_window',
  PERIOD_ASSUMED: 'period_assumed',
  PERIOD_ORDER_ASSUMED: 'period_order_assumed',
  PERIOD_NOT_IN_WINDOW: 'period_not_in_window',
  BENCHMARK_DEFAULT: 'benchmark_default',
  BENCHMARK_MISSING: 'benchmark_missing',
  PARTIAL_COMPOSITE: 'partial_composite',
  FALLBACK_NEUTRAL: 'fallback_neutral',
  GUARD_FAILED: 'guard_failed',
  NOT_FINITE: 'not_finite',
  EXCLUDED: 'excluded',
  GATE_PASSED_BY_POLICY: 'gate_passed_by_policy',
  QUOTE_UNVERIFIED: 'quote_unverified',
  SERIES_PERIOD_CONFLICT: 'series_period_conflict',
  OUT_OF_WINDOW_DROPPED: 'out_of_window_dropped',
  DECLARED_VALUE: 'declared_value'
} as const

export const GUARD_FLAG_BY_FIELD: Record<string, string> = {
  'fin.netAssets': FLAG.NEGATIVE_EQUITY,
  'fin.productSalesCost': FLAG.COST_NONPOSITIVE,
  'fin.revenue': FLAG.REVENUE_NONPOSITIVE
}

export const guardFlag = (guardExpr: string): string => {
  for (const [key, flag] of Object.entries(GUARD_FLAG_BY_FIELD)) {
    if (guardExpr.includes(key)) return flag
  }
  return FLAG.GUARD_FAILED
}
