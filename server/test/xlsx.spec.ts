import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseXlsx } from '../src/pipeline/xlsx'
import { makeXlsx } from './helpers'

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-xlsx-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('XLSX 解析', () => {
  it('一个工作表算一页,数字保持可读', async () => {
    const filePath = path.join(dir, '财务数据.xlsx')
    await writeFile(filePath, await makeXlsx())

    const result = await parseXlsx({ filePath, fileId: 'f_xlsx' })
    const page = result.pages[0]

    expect(result.totalPages).toBe(1)
    expect(page.page).toBe(1)
    expect(page.route).toBe('text')
    expect(page.text).toContain('## 利润表')
    expect(page.text).toContain('营业收入 | 132000000 | 120000000')
    expect(page.tables[0].rows).toBe(3)
    expect(page.tables[0].cols).toBe(3)
    expect(page.printableChars).toBeGreaterThan(30)
  })
})
