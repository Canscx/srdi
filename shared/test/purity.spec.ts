import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../src/scoring', import.meta.url))

const forbidden: { pattern: RegExp; why: string }[] = [
  { pattern: /from\s+['"]node:(fs|path|http|https|os|child_process)['"]/, why: '不得引入 Node 内置模块' },
  { pattern: /require\s*\(\s*['"]node:/, why: '不得使用 require' },
  { pattern: /\bfetch\s*\(/, why: '不得发起网络请求' },
  { pattern: /Date\.now\s*\(/, why: '不得读取系统时间' },
  { pattern: /new\s+Date\s*\(/, why: '不得构造时间对象' },
  { pattern: /Math\.random\s*\(/, why: '不得使用随机数' },
  { pattern: /(^|[^.\w])eval\s*\(/, why: '禁止 eval' },
  { pattern: /new\s+Function\s*\(/, why: '禁止动态函数构造' },
  { pattern: /process\.env/, why: '不得读取环境变量' }
]

const collect = (dir: string): string[] => {
  const entries = readdirSync(dir, { withFileTypes: true })
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return collect(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

describe('L4 纯净性', () => {
  const files = collect(root)

  it('打分引擎目录非空', () => {
    expect(files.length).toBeGreaterThan(15)
  })

  it.each(files.map((file) => [path.relative(root, file), file]))('%s 不含禁止项', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    for (const rule of forbidden) {
      expect(rule.pattern.test(source), `${path.basename(file)} ${rule.why}`).toBe(false)
    }
  })
})
