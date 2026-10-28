import type { EvalContext } from './context'
import { evalTri } from './evaluate'
import { FLAG } from './flags'
import { parseExpr } from './parser'
import type { ExprGate, GateBasis, GateCheckResult, GateEffective, GateResult, GateVerdict, ScoreGate, Totals } from './types'
import { triVerdict } from './tri'

const combine = (gate: ExprGate, checks: GateCheckResult[]): { verdict: GateVerdict; passedVia?: string } => {
  if (gate.logic === 'all') {
    if (checks.some((check) => check.verdict === 'fail')) return { verdict: 'fail' }
    if (checks.every((check) => check.verdict === 'pass')) return { verdict: 'pass' }
    if (checks.some((check) => check.verdict === 'pending')) return { verdict: 'pending' }
    return { verdict: 'unknown' }
  }

  const passed = checks.find((check) => check.verdict === 'pass')
  if (passed) {
    const exemption = checks.find((check) => check.verdict === 'pass' && check.exemption)
    return { verdict: 'pass', passedVia: (exemption ?? passed).id }
  }
  if (checks.some((check) => check.verdict === 'pending')) return { verdict: 'pending' }
  if (checks.some((check) => check.verdict === 'unknown')) return { verdict: 'unknown' }
  return { verdict: 'fail' }
}

const resolveEffective = (
  verdict: GateVerdict,
  policy: ExprGate['unknownPolicy']
): { effective: GateEffective; basis: GateBasis; flags: string[] } => {
  if (verdict === 'pass') return { effective: 'pass', basis: 'evidence', flags: [] }
  if (verdict === 'fail') return { effective: 'fail', basis: 'evidence', flags: [] }
  if (policy === 'pending') return { effective: 'pending', basis: 'missing', flags: [] }
  if (policy === 'ignore') return { effective: 'pass', basis: 'policy', flags: [FLAG.GATE_PASSED_BY_POLICY] }
  return { effective: 'fail', basis: 'missing', flags: [] }
}

export const evaluateExprGate = (gate: ExprGate, ctx: EvalContext): GateResult => {
  const checks: GateCheckResult[] = gate.checks.map((check) => {
    const parsed = parseExpr(check.expr)
    const tri = evalTri(parsed.ast, { ctx })
    return {
      id: check.id,
      label: check.label,
      verdict: triVerdict(tri),
      exemption: check.exemption === true,
      missing: tri.missing,
      pending: tri.pending,
      flags: tri.flags
    }
  })

  const { verdict, passedVia } = combine(gate, checks)
  const resolved = resolveEffective(verdict, gate.unknownPolicy)

  const hasMissing = checks.some((check) => check.missing.length > 0)
  const hasPending = checks.some((check) => check.pending.length > 0)
  const basis: GateBasis = resolved.effective === 'pass' || resolved.effective === 'fail'
    ? resolved.basis
    : hasMissing && hasPending
      ? 'mixed'
      : hasPending
        ? 'unconfirmed'
        : 'missing'

  const detail = checks
    .map((check) => `${check.id} ${check.verdict === 'pass' ? '满足' : check.verdict === 'fail' ? '不满足' : check.verdict === 'pending' ? '需确认' : '材料不足'}`)
    .join(' · ')

  return {
    id: gate.id,
    name: gate.name,
    verdict,
    effective: resolved.effective,
    basis,
    checks,
    passedVia,
    explain: detail
  }
}

export const evaluateScoreGate = (gate: ScoreGate, totals: Totals): GateResult => {
  const official = totals.official
  const conservative = totals.conservative
  const line = gate.passLine

  let verdict: GateVerdict
  if (conservative >= line) verdict = 'pass'
  else if (official >= line) verdict = 'pending'
  else verdict = 'fail'

  return {
    id: gate.id,
    name: gate.name,
    verdict,
    effective: verdict,
    basis: 'score',
    checks: [],
    explain: `conservative ${conservative} / official ${official} / 线 ${line}`
  }
}

export const aggregateConclusion = (gates: GateResult[]): 'pass' | 'fail' | 'pending' => {
  if (gates.some((gate) => gate.effective === 'fail')) return 'fail'
  if (gates.some((gate) => gate.effective === 'pending')) return 'pending'
  return 'pass'
}
