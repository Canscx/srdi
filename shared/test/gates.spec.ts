import { describe, expect, it } from 'vitest'
import rulesJson from '../../config/rules/rules.srdi.v1.0.0.json'
import { isPortalPassed } from '../src/portal'
import { evaluate } from '../src/scoring/engine'
import { evaluateScoreGate } from '../src/scoring/gates'
import type { RulesDoc, ScoreGate, Totals } from '../src/scoring/types'
import { buildModel, entry, rules } from './helpers'

const scoreGate: ScoreGate = {
  id: 'GATE_6',
  name: '发展评价得分',
  type: 'scoreGate',
  passLine: 50,
  totalKey: 'official',
  unknownPolicy: 'notPass'
}

const totals = (official: number, optimistic = official): Totals => ({
  official,
  conservative: Math.min(official, optimistic),
  optimistic,
  confidence: 1
})

describe('门槛 6：50 分线', () => {
  it('50.00 通过', () => {
    expect(evaluateScoreGate(scoreGate, totals(50)).verdict).toBe('pass')
  })

  it('50.01 通过', () => {
    expect(evaluateScoreGate(scoreGate, totals(50.01)).verdict).toBe('pass')
  })

  it('49.99 且乐观口径也到不了线 → 不通过', () => {
    expect(evaluateScoreGate(scoreGate, totals(49.99)).verdict).toBe('fail')
  })

  it('49.99 但乐观口径可达 → 待定', () => {
    expect(evaluateScoreGate(scoreGate, totals(49.99, 60)).verdict).toBe('pending')
  })
})

const gate3 = (rdExpense: Record<number, number>) => {
  const result = evaluate(
    buildModel({
      'fin.revenue': entry({ 2025: 30000000, 2024: 30000000, 2023: 30000000 }),
      'fin.rdExpense': entry(rdExpense)
    }),
    rules
  )
  return result.gates.find((item) => item.id === 'GATE_3')
}

describe('GATE_3：近两年 = 上年度 + 前年度', () => {
  it('2025 研发不足 100 万则失败（旧口径会误放行）', () => {
    const gate = gate3({ 2025: 500000, 2024: 2000000, 2023: 2000000 })
    expect(gate?.verdict).toBe('fail')
  })

  it('2023 研发不足但 2024/2025 达标仍通过', () => {
    const gate = gate3({ 2025: 2000000, 2024: 2000000, 2023: 100000 })
    expect(gate?.verdict).toBe('pass')
  })
})

describe('政策口径哨兵', () => {
  it('规则包与 GATE_6 都是 50', () => {
    const doc = rulesJson as unknown as RulesDoc
    expect(doc.passLine).toBe(50)
    const gate = doc.gates.find((item) => item.id === 'GATE_6')
    expect(gate?.type).toBe('scoreGate')
    if (gate?.type === 'scoreGate') expect(gate.passLine).toBe(50)
  })

  it('GATE_3 不再引用 y2', () => {
    const gate = rules.gates.find((item) => item.id === 'GATE_3')
    expect(gate?.type).toBe('expr')
    if (gate?.type === 'expr') {
      const exprs = gate.checks.map((check) => check.expr)
      expect(exprs.some((expr) => expr.includes('[y2]'))).toBe(false)
    }
  })
})

describe('客户版达标：分数 + 证据覆盖', () => {
  it('证据不足时不给达标', () => {
    expect(isPortalPassed(50, 50, 0.49)).toBe(false)
    expect(isPortalPassed(60, 50, 0)).toBe(false)
  })

  it('分数达线且覆盖过半才达标', () => {
    expect(isPortalPassed(50, 50, 0.5)).toBe(true)
    expect(isPortalPassed(57.76, 50, 0.7832)).toBe(true)
  })

  it('分数不够，覆盖再高也不算', () => {
    expect(isPortalPassed(49.99, 50, 1)).toBe(false)
  })
})
