import '../src/env'
import { existsSync } from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PROJECT_ROOT } from '../src/paths'
import { probeReportFonts } from '../src/report/fonts'
import type { ReportFont } from '../src/report/fonts'

const SAMPLE = '专精特新申报自评 · 字体自检 100 分'

const renderSample = async (font: ReportFont): Promise<Buffer> => {
  const doc = new PDFDocument({ size: 'A4', margin: 46 })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })
  doc.registerFont('report', font.path, font.postscriptName)
  doc.font('report').fontSize(14).text(SAMPLE, 46, 60)
  doc.end()
  return done
}

const extract = async (buffer: Buffer): Promise<string> => {
  const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true })
  const doc = await task.promise
  const page = await doc.getPage(1)
  const content = await page.getTextContent()
  const text = content.items.map((item) => ('str' in item ? item.str : '')).join('')
  await task.destroy()
  return text
}

const main = async () => {
  const { font, probes } = probeReportFonts()
  const dir = path.join(PROJECT_ROOT, 'fonts')

  console.log('')
  console.log('  中文字体自检 · 专精特新申报自评打分系统')
  console.log(`  运行环境     ${process.platform} / ${process.version}`)
  console.log(`  项目根目录   ${PROJECT_ROOT}`)
  console.log(`  字体目录     ${dir}${existsSync(dir) ? '' : '（不存在）'}`)
  console.log(`  REPORT_FONT_PATH   ${process.env.REPORT_FONT_PATH ?? '（未设置）'}`)
  console.log('')
  console.log(`  候选位置 ${probes.length} 个（按优先级）`)

  for (const probe of probes) {
    console.log(`  ${probe.ok ? '✔' : '✘'} ${probe.source} · ${probe.path} · ${probe.detail}`)
  }

  if (!font) {
    console.log('')
    console.log('  结论 未找到可用的中文字体,PDF 导出会返回 500 report_font_missing')
    console.log(`  处理 把中文 ttf/ttc/otf 放进 ${dir},或用 REPORT_FONT_PATH 指向字体文件后重启进程`)
    process.exitCode = 1
    return
  }

  console.log('')
  console.log(`  已选用   ${font.family}${font.postscriptName ? ` · ${font.postscriptName}` : ''}`)
  console.log(`  来源     ${font.source} · ${font.path}`)

  try {
    const buffer = await renderSample(font)
    const magic = buffer.subarray(0, 5).toString()
    const text = await extract(buffer)
    const ok = magic === '%PDF-' && text.includes('字体自检')
    console.log(`  冒烟     ${buffer.byteLength} 字节 · ${magic} · 文本提取「${text}」`)
    console.log('')
    console.log(ok ? '  结论 PDF 导出可用' : '  结论 PDF 生成了,但中文未能正确写回,请换一个字体再试')
    process.exitCode = ok ? 0 : 1
  } catch (err) {
    console.log('')
    console.log(`  结论 字体无法嵌入:${(err as Error).message}`)
    console.log('  处理 换一个 TrueType(ttf/ttc)或思源黑体(otf)文件,再跑一次本命令')
    process.exitCode = 1
  }
}

await main()
