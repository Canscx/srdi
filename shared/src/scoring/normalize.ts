import type { NormalizedExpr, Rewrite } from './types'

export type ExprErrorCode = 'E_UNSUPPORTED_SYNTAX' | 'E_UNBALANCED_BRACKET' | 'E_UNCLOSED_STRING'

export class ExprSyntaxError extends Error {
  code: ExprErrorCode
  index: number

  constructor(code: ExprErrorCode, message: string, index: number) {
    super(message)
    this.name = 'ExprSyntaxError'
    this.code = code
    this.index = index
  }
}

const RANGE_LEFT = /(y0|y1|y2|others)\s*$/
const RANGE_RIGHT = /^(y0|y1|y2|others)\b/
const COUNT_PATTERN = /([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+)(\[[^[\]]*\])?\s*#count\b/g

export const normalizeExpr = (raw: string): NormalizedExpr => {
  const rewrites: Rewrite[] = []
  let out = ''
  let depth = 0
  let paren = 0
  let quote: string | null = null
  let i = 0

  while (i < raw.length) {
    const ch = raw[i]

    if (quote) {
      out += ch
      if (ch === '\\' && i + 1 < raw.length) {
        out += raw[i + 1]
        i += 2
        continue
      }
      if (ch === quote) quote = null
      i += 1
      continue
    }

    if (ch === "'" || ch === '"') {
      quote = ch
      out += ch
      i += 1
      continue
    }

    if (ch === '(') {
      paren += 1
      out += ch
      i += 1
      continue
    }

    if (ch === ')') {
      paren -= 1
      if (paren < 0) {
        throw new ExprSyntaxError('E_UNBALANCED_BRACKET', `表达式圆括号不配对: ${raw}`, i)
      }
      out += ch
      i += 1
      continue
    }

    if (ch === '[') {
      depth += 1
      out += ch
      i += 1
      continue
    }

    if (ch === ']') {
      depth -= 1
      if (depth < 0) {
        throw new ExprSyntaxError('E_UNBALANCED_BRACKET', `表达式方括号不配对: ${raw}`, i)
      }
      out += ch
      i += 1
      continue
    }

    if (depth > 0 && raw.startsWith('..', i)) {
      const left = RANGE_LEFT.exec(out)
      const rest = raw.slice(i + 2)
      const right = RANGE_RIGHT.exec(rest.trimStart())
      if (left && right) {
        const gap = rest.length - rest.trimStart().length
        const from = `${left[1]}..${right[1]}`
        const to = `${left[1]} @ ${right[1]}`
        out = `${out.slice(0, out.length - left[0].length)}${left[1]} @ `
        rewrites.push({ kind: 'range', from, to, index: i })
        i += 2 + gap
        continue
      }
    }

    out += ch
    i += 1
  }

  if (quote) {
    throw new ExprSyntaxError('E_UNCLOSED_STRING', `表达式存在未闭合的字符串: ${raw}`, raw.length)
  }

  if (depth !== 0 || paren !== 0) {
    throw new ExprSyntaxError('E_UNBALANCED_BRACKET', `表达式括号不配对: ${raw}`, raw.length)
  }

  const counted = out.replace(COUNT_PATTERN, (match, ref: string, indexPart: string | undefined, offset: number) => {
    const arg = `${ref}${indexPart ?? ''}`
    const to = `count(${arg})`
    rewrites.push({ kind: 'count', from: match, to, index: offset })
    return to
  })

  if (counted.includes('#')) {
    throw new ExprSyntaxError('E_UNSUPPORTED_SYNTAX', `无法识别的 # 语法: ${raw}`, counted.indexOf('#'))
  }

  return { text: counted, rewrites }
}
