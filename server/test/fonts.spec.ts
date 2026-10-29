import { existsSync } from 'node:fs'
import PDFDocument from 'pdfkit'
import { describe, expect, it } from 'vitest'
import { inspectFont, resolveReportFont } from '../src/report/fonts'
import type { ReportFont } from '../src/report/fonts'

const SAMPLE = '专精特新申报自评 · 中文嵌入'

const TTC_CANDIDATES = [
  process.env.REPORT_FONT_PATH ?? '',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simsun.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
]

const render = (font: ReportFont): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    doc.registerFont('report', font.path, font.postscriptName)
    doc.font('report').fontSize(12).text(SAMPLE, 40, 50)
    doc.end()
  })

describe('报告字体', () => {
  it('能解析出存在的中文字体', () => {
    const font = resolveReportFont()
    expect(existsSync(font.path)).toBe(true)
    expect(font.family.length).toBeGreaterThan(0)
    expect(font.source.length).toBeGreaterThan(0)
  })

  it('解析结果能真正写出含中文的 PDF', async () => {
    const buffer = await render(resolveReportFont())
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.byteLength).toBeGreaterThan(1000)
  })

  const ttc = TTC_CANDIDATES.find(
    (item) => item.toLowerCase().endsWith('.ttc') && existsSync(item)
  )

  it.skipIf(!ttc)('字体集合取 PostScript 名而不是显示名', async () => {
    const inspected = inspectFont(ttc as string, 'test')
    expect(inspected.font).not.toBeNull()
    expect(inspected.font?.postscriptName).toBeTruthy()
    const buffer = await render(inspected.font as ReportFont)
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
  })

  it('坏路径返回可读原因而不抛异常', () => {
    const inspected = inspectFont('C:/no-such-font-file.ttf', 'test')
    expect(inspected.font).toBeNull()
    expect(inspected.detail).toContain('不存在')
  })
})
