import type {
  BinaryExpression,
  CallExpression,
  ConditionalExpression,
  Expression,
  Identifier,
  Literal,
  MemberExpression,
  UnaryExpression
} from 'jsep'
import type { EvalContext } from './context'
import { FLAG } from './flags'
import { ExprSyntaxError } from './normalize'
import { scalarSeries } from './series'
import { andTri, notTri, orTri, triFromVal } from './tri'
import type { Flag, IndexKey, Row, Slot, Tri, Val } from './types'

export interface EvalEnv {
  ctx: EvalContext
  row?: Row
}

const num = (v: number, flags: Flag[] = []): Val => ({ kind: 'num', v, flags })
const bool = (v: boolean, flags: Flag[] = []): Val => ({ kind: 'bool', v, flags })
const strVal = (v: string, flags: Flag[] = []): Val => ({ kind: 'str', v, flags })
const none = (reason: 'missing' | 'pending' | 'error', refs: string[], flags: Flag[] = []): Val => ({
  kind: 'none',
  reason,
  refs,
  flags
})

const PERIOD_TOKENS = new Set(['y0', 'y1', 'y2'])

export const parseIndex = (node: Expression): IndexKey => {
  if (node.type === 'Identifier') {
    const name = (node as Identifier).name
    if (PERIOD_TOKENS.has(name)) return { kind: 'period', key: name as 'y0' | 'y1' | 'y2' }
    if (name === 'others') return { kind: 'others' }
    throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', `无法识别的索引 ${name}`, 0)
  }

  if (node.type === 'Literal') {
    const value = (node as Literal).value
    if (typeof value === 'number') return { kind: 'year', year: value }
  }

  if (node.type === 'BinaryExpression' && (node as BinaryExpression).operator === '@') {
    const bin = node as BinaryExpression
    return { kind: 'range', from: parseIndex(bin.left), to: parseIndex(bin.right) }
  }

  throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', '索引只支持 y0/y1/y2/others/年份/区间', 0)
}

const flattenMember = (node: Expression): { path: string; index: IndexKey | null } => {
  if (node.type === 'Identifier') return { path: (node as Identifier).name, index: null }

  if (node.type === 'MemberExpression') {
    const member = node as MemberExpression
    const base = flattenMember(member.object)
    if (member.computed) {
      if (base.index) throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', '不支持多级索引', 0)
      return { path: base.path, index: parseIndex(member.property) }
    }
    const prop = member.property.type === 'Identifier'
      ? (member.property as Identifier).name
      : String((member.property as Literal).value)
    return { path: `${base.path}.${prop}`, index: base.index }
  }

  throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', '字段引用形式不受支持', 0)
}

const rowValue = (row: Row, name: string): Val | null => {
  const cell = row[name]
  if (!cell) return null
  if (typeof cell.num === 'number') return num(cell.num)
  if (typeof cell.str === 'string') return strVal(cell.str)
  if (typeof cell.bool === 'boolean') return bool(cell.bool)
  return null
}

const calc = (x: number, y: number, op: string): { v: number | null; flags: Flag[] } => {
  switch (op) {
    case '+':
      return { v: x + y, flags: [] }
    case '-':
      return { v: x - y, flags: [] }
    case '*':
      return { v: x * y, flags: [] }
    case '/':
      return y === 0 ? { v: null, flags: [FLAG.DENOMINATOR_ZERO] } : { v: x / y, flags: [] }
    case '%':
      return y === 0 ? { v: null, flags: [FLAG.DENOMINATOR_ZERO] } : { v: x % y, flags: [] }
    default:
      return { v: null, flags: ['unknown_operator'] }
  }
}

const arith = (a: Val, b: Val, op: string): Val => {
  if (a.kind === 'none') return a
  if (b.kind === 'none') return b

  if (a.kind === 'num' && b.kind === 'num') {
    const result = calc(a.v, b.v, op)
    const flags = [...a.flags, ...b.flags, ...result.flags]
    if (result.v === null || !Number.isFinite(result.v)) {
      return none('error', [], [...flags, FLAG.NOT_FINITE])
    }
    return num(result.v, flags)
  }

  const left = a.kind === 'series' ? a.s : a.kind === 'num' ? scalarSeries(a.v) : null
  const right = b.kind === 'series' ? b.s : b.kind === 'num' ? scalarSeries(b.v) : null
  if (!left || !right) return none('error', [])

  const slots: Slot[] = []
  for (let i = 0; i < left.slots.length; i += 1) {
    const x = left.slots[i]
    const y = right.slots[i]
    if (x.state !== 'ok' || y.state !== 'ok') {
      const state = x.state === 'pending' || y.state === 'pending'
        ? 'pending'
        : x.state === 'excluded' || y.state === 'excluded'
          ? 'excluded'
          : 'missing'
      slots.push({ state, num: 0, flags: [] })
      continue
    }
    const result = calc(x.num, y.num, op)
    if (result.v === null || !Number.isFinite(result.v)) {
      slots.push({ state: 'missing', num: 0, flags: [...result.flags, FLAG.NOT_FINITE] })
      continue
    }
    slots.push({ state: 'ok', num: result.v, flags: result.flags })
  }

  return { kind: 'series', s: { slots }, flags: [...a.flags, ...b.flags] }
}

const toScalar = (val: Val): Val => {
  if (val.kind !== 'series') return val
  const values = val.s.slots.filter((slot) => slot.state === 'ok').map((slot) => slot.num)
  if (values.length === 0) return none('missing', [], val.flags)
  return num(values.reduce((sum, item) => sum + item, 0) / values.length, val.flags)
}

const compare = (a: Val, b: Val, op: string): Val => {
  if (a.kind === 'none') return a
  if (b.kind === 'none') return b

  const left = toScalar(a)
  const right = toScalar(b)

  if (left.kind === 'none') return left
  if (right.kind === 'none') return right

  a = left
  b = right

  if (a.kind === 'num' && b.kind === 'num') {
    switch (op) {
      case '==':
        return bool(a.v === b.v, [...a.flags, ...b.flags])
      case '!=':
        return bool(a.v !== b.v, [...a.flags, ...b.flags])
      case '<':
        return bool(a.v < b.v, [...a.flags, ...b.flags])
      case '<=':
        return bool(a.v <= b.v, [...a.flags, ...b.flags])
      case '>':
        return bool(a.v > b.v, [...a.flags, ...b.flags])
      case '>=':
        return bool(a.v >= b.v, [...a.flags, ...b.flags])
      default:
        return none('error', [])
    }
  }

  if (a.kind === 'str' && b.kind === 'str') {
    if (op === '==') return bool(a.v === b.v, [...a.flags, ...b.flags])
    if (op === '!=') return bool(a.v !== b.v, [...a.flags, ...b.flags])
    return none('error', [])
  }

  if (a.kind === 'bool' && b.kind === 'bool') {
    if (op === '==') return bool(a.v === b.v, [...a.flags, ...b.flags])
    if (op === '!=') return bool(a.v !== b.v, [...a.flags, ...b.flags])
    return none('error', [])
  }

  if (a.kind === 'str' || b.kind === 'str') {
    if (op === '==') return bool(false, [...a.flags, ...b.flags])
    if (op === '!=') return bool(true, [...a.flags, ...b.flags])
  }

  return none('error', [])
}

const rowNumericColumn = (rows: Row[]): number[] | null => {
  if (rows.length === 0) return []
  if (rows.every((row) => typeof row.count?.num === 'number')) {
    return rows.map((row) => row.count?.num as number)
  }
  const keys = new Set<string>()
  for (const row of rows) {
    for (const [key, cell] of Object.entries(row)) {
      if (key !== 'year' && cell && typeof cell.num === 'number') keys.add(key)
    }
  }
  if (keys.size === 1) {
    const [key] = Array.from(keys)
    if (rows.every((row) => typeof row[key]?.num === 'number')) {
      return rows.map((row) => row[key]?.num as number)
    }
  }
  return null
}

const meanOf = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, item) => sum + item, 0) / values.length

const applyBuiltin = (name: string, args: Val[]): Val => {
  const first = args[0]
  if (!first) return none('error', [])

  if (name === 'abs') {
    if (first.kind === 'num') return num(Math.abs(first.v), first.flags)
    return none('error', [])
  }

  if (name === 'min' || name === 'max') {
    const values = args.filter((item): item is Extract<Val, { kind: 'num' }> => item.kind === 'num').map((item) => item.v)
    if (values.length !== args.length || values.length === 0) return none('error', [])
    return num(name === 'min' ? Math.min(...values) : Math.max(...values))
  }

  if (name === 'count') {
    if (first.kind === 'rows') return num(first.r.length, first.flags)
    if (first.kind === 'series') return num(first.s.slots.filter((slot) => slot.state === 'ok').length, first.flags)
    if (first.kind === 'num') return num(1, first.flags)
    return first
  }

  if (name === 'mean') {
    if (first.kind === 'num') return first
    if (first.kind === 'series') {
      const values = first.s.slots.filter((slot) => slot.state === 'ok').map((slot) => slot.num)
      const mean = meanOf(values)
      return mean === null ? none('missing', [], first.flags) : num(mean, first.flags)
    }
    return none('error', [])
  }

  if (name === 'sum') {
    if (first.kind === 'num') return first
    if (first.kind === 'series') {
      const values = first.s.slots.filter((slot) => slot.state === 'ok').map((slot) => slot.num)
      return values.length === 0 ? none('missing', [], first.flags) : num(values.reduce((a, b) => a + b, 0), first.flags)
    }
    if (first.kind === 'rows') {
      const values = rowNumericColumn(first.r)
      if (values === null) return none('error', [])
      return values.length === 0 ? num(0, first.flags) : num(values.reduce((a, b) => a + b, 0), first.flags)
    }
    return none('error', [])
  }

  return none('error', [])
}

export const evalNode = (node: Expression, env: EvalEnv): Val => {
  switch (node.type) {
    case 'Literal': {
      const value = (node as Literal).value
      if (typeof value === 'number') return num(value)
      if (typeof value === 'string') return strVal(value)
      if (typeof value === 'boolean') return bool(value)
      return none('error', [])
    }

    case 'Identifier': {
      const name = (node as Identifier).name
      if (env.row) {
        const hit = rowValue(env.row, name)
        if (hit) return hit
      }
      return none('missing', [name])
    }

    case 'MemberExpression': {
      const { path, index } = flattenMember(node)
      return index ? env.ctx.readIndexed(path, index) : env.ctx.readField(path)
    }

    case 'CallExpression': {
      const call = node as CallExpression
      if (call.callee.type !== 'Identifier') return none('error', [])
      const name = (call.callee as Identifier).name
      const arg = call.arguments[0]
      if (!arg) return none('error', [])

      if (name === 'count' && arg.type === 'BinaryExpression' && (arg as BinaryExpression).operator === 'where') {
        const bin = arg as BinaryExpression
        const base = evalNode(bin.left, env)
        if (base.kind !== 'rows') return base.kind === 'none' ? base : none('error', [])
        const kept = base.r.filter((row) => evalTri(bin.right, { ctx: env.ctx, row }).v === true)
        return num(kept.length, base.flags)
      }

      return applyBuiltin(name, call.arguments.map((item) => evalNode(item, env)))
    }

    case 'BinaryExpression': {
      const bin = node as BinaryExpression
      const op = bin.operator

      if (op === '&&' || op === '||') {
        const tri = evalTri(node, env)
        if (tri.v === null) {
          return none(tri.pending.length > 0 ? 'pending' : 'missing', [...tri.missing, ...tri.pending], tri.flags)
        }
        return bool(tri.v, tri.flags)
      }

      if (op === 'where' || op === '@') {
        throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', `${op} 不能直接参与求值`, 0)
      }

      const left = evalNode(bin.left, env)
      const right = evalNode(bin.right, env)

      if (['==', '!=', '<', '<=', '>', '>='].includes(op)) return compare(left, right, op)
      return arith(left, right, op)
    }

    case 'UnaryExpression': {
      const unary = node as UnaryExpression
      const value = evalNode(unary.argument, env)
      if (unary.operator === '-') return value.kind === 'num' ? num(-value.v, value.flags) : none('error', [])
      if (unary.operator === '+') return value
      if (unary.operator === '!') {
        const tri = evalTri(unary.argument, env)
        return tri.v === null ? none('missing', [...tri.missing, ...tri.pending], tri.flags) : bool(!tri.v, tri.flags)
      }
      return none('error', [])
    }

    case 'ConditionalExpression': {
      const cond = node as ConditionalExpression
      const test = evalTri(cond.test, env)
      if (test.v === true) return evalNode(cond.consequent, env)
      if (test.v === false) return evalNode(cond.alternate, env)
      return none(test.pending.length > 0 ? 'pending' : 'missing', [...test.missing, ...test.pending], test.flags)
    }

    default:
      return none('error', [])
  }
}

export const evalTri = (node: Expression, env: EvalEnv): Tri => {
  if (node.type === 'BinaryExpression') {
    const bin = node as BinaryExpression
    if (bin.operator === '&&') return andTri(evalTri(bin.left, env), evalTri(bin.right, env))
    if (bin.operator === '||') return orTri(evalTri(bin.left, env), evalTri(bin.right, env))
  }

  if (node.type === 'UnaryExpression' && (node as UnaryExpression).operator === '!') {
    return notTri(evalTri((node as UnaryExpression).argument, env))
  }

  return triFromVal(evalNode(node, env))
}

export const reduceSeries = (val: Val, method: 'mean' | 'last' | 'sum'): number | null => {
  if (val.kind === 'num') return val.v
  if (val.kind !== 'series') return null
  const values = val.s.slots.map((slot, index) => ({ slot, index })).filter((item) => item.slot.state === 'ok')
  if (values.length === 0) return null
  if (method === 'sum') return values.reduce((sum, item) => sum + item.slot.num, 0)
  if (method === 'last') return values[values.length - 1].slot.num
  return values.reduce((sum, item) => sum + item.slot.num, 0) / values.length
}

export const toNumber = (val: Val, method: 'mean' | 'last' | 'sum' = 'mean'): { value: number | null; flags: Flag[] } => {
  if (val.kind === 'num') return { value: val.v, flags: val.flags }
  if (val.kind === 'series') {
    const value = reduceSeries(val, method)
    return { value, flags: val.flags }
  }
  if (val.kind === 'none') return { value: null, flags: val.flags }
  return { value: null, flags: val.flags }
}
