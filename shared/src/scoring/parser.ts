import jsep from 'jsep'
import type { BinaryExpression, CallExpression, Expression, Identifier, MemberExpression } from 'jsep'
import { ExprSyntaxError, normalizeExpr } from './normalize'
import type { Rewrite } from './types'

export interface ParsedExpr {
  ast: Expression
  normalized: string
  rewrites: Rewrite[]
}

type Role = 'root' | 'object' | 'property' | 'arg' | 'left' | 'right' | 'test' | 'consequent' | 'alternate' | 'operand' | 'element'

interface NodeContext {
  parentType: string | null
  role: Role
  argIndex: number
}

let registered = false

const ensureOperators = () => {
  if (registered) return
  jsep.addBinaryOp('where', 0.5)
  jsep.addBinaryOp('@', 0.9)
  registered = true
}

const calleeName = (node: Expression): string | null => {
  if (node.type !== 'Identifier') return null
  return (node as Identifier).name
}

const walk = (node: Expression, ctx: NodeContext): void => {
  if (node.type === 'BinaryExpression') {
    const bin = node as BinaryExpression
    if (bin.operator === 'where') {
      const allowed = ctx.parentType === 'CallExpression' && ctx.role === 'arg' && ctx.argIndex === 0
      if (!allowed) {
        throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', 'where 只能作为 count() 的第一个参数', 0)
      }
    }
    if (bin.operator === '@') {
      const allowed = ctx.parentType === 'MemberExpression' && ctx.role === 'property'
      if (!allowed) {
        throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', '@ 只用于 [y0 @ y2] 形式的区间索引', 0)
      }
    }
    walk(bin.left, { parentType: 'BinaryExpression', role: 'left', argIndex: -1 })
    walk(bin.right, { parentType: 'BinaryExpression', role: 'right', argIndex: -1 })
    return
  }

  if (node.type === 'CallExpression') {
    const call = node as CallExpression
    if (calleeName(call.callee) === 'count' && call.arguments.length !== 1) {
      throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', `count() 只接受 1 个参数,实际 ${call.arguments.length} 个`, 0)
    }
    call.arguments.forEach((arg, index) => {
      walk(arg, { parentType: 'CallExpression', role: 'arg', argIndex: index })
    })
    walk(call.callee, { parentType: 'CallExpression', role: 'operand', argIndex: -1 })
    return
  }

  if (node.type === 'MemberExpression') {
    const member = node as MemberExpression
    walk(member.object, { parentType: 'MemberExpression', role: 'object', argIndex: -1 })
    walk(member.property, { parentType: 'MemberExpression', role: 'property', argIndex: -1 })
    return
  }

  if (node.type === 'UnaryExpression') {
    walk((node as unknown as { argument: Expression }).argument, { parentType: 'UnaryExpression', role: 'operand', argIndex: -1 })
    return
  }

  if (node.type === 'ConditionalExpression') {
    const cond = node as unknown as { test: Expression; consequent: Expression; alternate: Expression }
    walk(cond.test, { parentType: 'ConditionalExpression', role: 'test', argIndex: -1 })
    walk(cond.consequent, { parentType: 'ConditionalExpression', role: 'consequent', argIndex: -1 })
    walk(cond.alternate, { parentType: 'ConditionalExpression', role: 'alternate', argIndex: -1 })
    return
  }

  if (node.type === 'ArrayExpression') {
    const arr = node as unknown as { elements: Array<Expression | null> }
    arr.elements.forEach((el) => {
      if (el) walk(el, { parentType: 'ArrayExpression', role: 'element', argIndex: -1 })
    })
  }
}

export const parseExpr = (raw: string): ParsedExpr => {
  const normalized = normalizeExpr(raw)
  ensureOperators()

  let ast: Expression
  try {
    ast = jsep(normalized.text)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', `表达式无法解析: ${raw} (${message})`, 0)
  }

  walk(ast, { parentType: null, role: 'root', argIndex: -1 })
  return { ast, normalized: normalized.text, rewrites: normalized.rewrites }
}
