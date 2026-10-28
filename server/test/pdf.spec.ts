import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parsePdf, renderParams } from '../src/pipeline/pdf'
import { makeScannedPdf, makeTextPdf } from './helpers'

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-pdf-'))
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('PDF 解析', () => {
  it('文字页走文本通道并产出页图', async () => {
    const filePath = path.join(dir, '审计报告.pdf')
    await writeFile(filePath, await makeTextPdf())
    const imagesDir = path.join(dir, 'pages', 'f_text')

    const result = await parsePdf({
      filePath,
      fileId: 'f_text',
      imagesDir,
      imagePrefix: 'pages/f_text'
    })
    const page = result.pages[0]

    expect(result.totalPages).toBe(1)
    expect(page.route).toBe('text')
    expect(page.text).toContain('Audit report 2025')
    expect(page.text).toContain('Revenue: 132,000,000.00')
    expect(page.printableChars).toBeGreaterThan(30)
    expect(page.image).toBe('pages/f_text/p1.jpg')

    const jpeg = await readFile(path.join(imagesDir, 'p1.jpg'))
    expect(jpeg[0]).toBe(0xff)
    expect(jpeg[1]).toBe(0xd8)
    expect(jpeg.length).toBeGreaterThan(1000)
  })

  it('没有文字层的页面走视觉通道', async () => {
    const filePath = path.join(dir, '扫描件.pdf')
    await writeFile(filePath, await makeScannedPdf())
    const imagesDir = path.join(dir, 'pages', 'f_scan')

    const result = await parsePdf({
      filePath,
      fileId: 'f_scan',
      imagesDir,
      imagePrefix: 'pages/f_scan'
    })

    expect(result.pages[0].route).toBe('vision')
    expect(result.pages[0].text).toBe('')
    expect(result.pages[0].printableChars).toBe(0)
    expect(result.pages[0].image).toBe('pages/f_scan/p1.jpg')
  })

  it('表格页用更高分辨率与质量', () => {
    expect(renderParams(true)).toEqual({ scale: 2.4, maxLongEdge: 2000, quality: 88 })
    expect(renderParams(false)).toEqual({ scale: 2.0, maxLongEdge: 1600, quality: 82 })
  })
})
