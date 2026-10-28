import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDocx } from '../src/pipeline/docx'
import { makeDocx } from './helpers'

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-docx-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('DOCX 解析', () => {
  it('保留标题、正文与表格结构', async () => {
    const filePath = path.join(dir, '审计报告.docx')
    await writeFile(filePath, makeDocx())

    const result = await parseDocx({ filePath, fileId: 'f_docx' })
    const page = result.pages[0]

    expect(result.totalPages).toBe(1)
    expect(result.truncated).toBe(false)
    expect(page.route).toBe('text')
    expect(page.text).toContain('2025 年度审计报告')
    expect(page.text).toContain('营业收入 132,000,000.00 元')
    expect(page.blocks.some((block) => block.type === 'heading')).toBe(true)
    expect(page.tables).toHaveLength(1)
    expect(page.tables[0].text).toContain('营业收入 | 132000000')
    expect(page.tables[0].rows).toBe(3)
  })
})
