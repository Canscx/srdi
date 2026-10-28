import type { BinaryExpression, CallExpression, Expression, Identifier } from 'jsep'
import { FLAG } from './flags'

export interface GrowthShape {
  current: Expression
  base: Expression
}

const sameNode = (a: Expression, b: Expression): boolean => JSON.stringify(a) === JSON.stringify(b)

export const detectGrowthShape = (node: Expression): GrowthShape | null => {
  if (node.type !== 'BinaryExpression') return null
  const div = node as BinaryExpression
  if (div.operator !== '/') return null
  if (div.left.type !== 'BinaryExpression') return null

  const minus = div.left as BinaryExpression
  if (minus.operator !== '-') return null
  if (div.right.type !== 'CallExpression') return null

  const call = div.right as CallExpression
  if (call.callee.type !== 'Identifier') return null
  if ((call.callee as Identifier).name !== 'abs') return null

  const arg = call.arguments[0]
  if (!arg || !sameNode(arg, minus.right)) return null

  return { current: minus.left, base: minus.right }
}

export interface GrowthRuleResult {
  value: number
  flags: string[]
}

export const applyGrowthSignRule = (base: number, current: number): GrowthRuleResult => {
  if (base < 0) {
    if (current > 0) return { value: 1, flags: [FLAG.BASE_NEGATIVE] }
    return { value: 0, flags: [FLAG.BASE_NEGATIVE] }
  }
  if (base === 0) return { value: Number.NaN, flags: [FLAG.DENOMINATOR_ZERO] }
  return { value: (current - base) / Math.abs(base), flags: [] }
}
