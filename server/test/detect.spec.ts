import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { detectFile } from '../src/pipeline/detect'
import { buildZip, pdfBytes } from './helpers'

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-detect-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

const save = async (name: string, bytes: Buffer) => {
  const file = path.join(dir, name)
  await writeFile(file, bytes)
  return file
}

describe('魔数判型', () => {
  it('扩展名是 txt 也认得出 PDF', async () => {
    const result = await detectFile(await save('伪装.txt', pdfBytes()))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('pdf')
    expect(result.mime).toBe('application/pdf')
  })

  it('扩展名是 pdf 也认得出 docx', async () => {
    const bytes = buildZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml', data: '<w:document/>' }
    ])
    const result = await detectFile(await save('伪装.pdf', bytes))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('docx')
    expect(result.ext).toBe('docx')
  })

  it('xlsx 按中央目录里的 workbook 判定', async () => {
    const bytes = buildZip([
      { name: '[Content_Types].xml' },
      { name: 'xl/workbook.xml', data: '<workbook/>' }
    ])
    const result = await detectFile(await save('财务.xlsx', bytes))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('xlsx')
  })

  it('pptx 明确拒绝并给出替代路径', async () => {
    const bytes = buildZip([{ name: 'ppt/presentation.xml', data: '<p/>' }])
    const result = await detectFile(await save('路演.pptx', bytes))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unsupported_office')
    expect(result.hint).toContain('PDF')
  })

  it('普通压缩包拒绝', async () => {
    const bytes = buildZip([{ name: 'readme.txt', data: 'hello' }])
    const result = await detectFile(await save('材料.zip', bytes))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unsupported_container')
  })

  it('老版 doc/xls 直接拒绝且提示另存', async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00])
    const result = await detectFile(await save('旧报表.xls', ole))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('legacy_office')
    expect(result.hint).toContain('另存为')
  })

  it('三种图片各自识别', async () => {
    const jpeg = await detectFile(
      await save('章.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]))
    )
    const png = await detectFile(
      await save('页.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    )
    const webpHeader = Buffer.concat([
      Buffer.from('RIFF', 'latin1'),
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
      Buffer.from('WEBP', 'latin1')
    ])
    const webp = await detectFile(await save('截图.webp', webpHeader))

    for (const result of [jpeg, png, webp]) {
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.kind).toBe('image')
    }
    if (jpeg.ok) expect(jpeg.ext).toBe('jpg')
    if (png.ok) expect(png.ext).toBe('png')
    if (webp.ok) expect(webp.ext).toBe('webp')
  })

  it('乱码文件不猜', async () => {
    const result = await detectFile(await save('未知.bin', Buffer.from('not a document at all')))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unknown_format')
  })

  it('空文件不猜', async () => {
    const result = await detectFile(await save('空.pdf', Buffer.alloc(0)))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.code).toBe('unknown_format')
  })
})
