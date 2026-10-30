import { existsSync } from 'node:fs'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import type { Response } from 'express'
import type { PortalCheck, PortalResultResponse } from '@srdi/shared'
import { PROJECT_ROOT } from '../paths'
import { resolveReportFont } from './fonts'
import { drawLegend, drawRadar } from './radar'

const PAGE = { width: 595.28, height: 841.89 }
const M = 44
const CW = PAGE.width - M * 2

const COLOR = {
  ink: '#0f172a',
  body: '#334155',
  muted: '#64748b',
  line: '#e2e8f0',
  brand: '#2563eb',
  accent: '#0ea5e9',
  pass: '#15803d',
  gap: '#b45309',
  missing: '#b91c1c',
  soft: '#f1f5f9'
}

const MARK_OF = { pass: '√', gap: '×', missing: '○' } as const
const MARK_COLOR = { pass: COLOR.pass, gap: COLOR.gap, missing: COLOR.missing } as const

const QR_FILE = path.join(PROJECT_ROOT, 'assets', 'consult-qr.png')

const num = (value: number) => (Number.isInteger(value) ? `${value}` : value.toFixed(2))

const header = (doc: PDFKit.PDFDocument, subtitle: string) => {
  doc.rect(0, 0, PAGE.width, 5).fill(COLOR.brand)
  doc.fontSize(9).fillColor(COLOR.muted).text(subtitle, M, 22, { width: CW })
  doc.moveTo(M, 38).lineTo(PAGE.width - M, 38).lineWidth(0.8).strokeColor(COLOR.line).stroke()
  return M + 18
}

const footer = (doc: PDFKit.PDFDocument, page: number, total: number) => {
  const bottom = doc.page.margins.bottom
  doc.page.margins.bottom = 0
  doc
    .fontSize(8)
    .fillColor(COLOR.muted)
    .text('参考得分 · 非官方口径 · 仅供申报前自查', M, PAGE.height - 30, { width: CW - 60 })
  doc.text(`${page} / ${total}`, PAGE.width - M - 50, PAGE.height - 30, {
    width: 50,
    align: 'right'
  })
  doc.page.margins.bottom = bottom
}

const gap = (doc: PDFKit.PDFDocument, y: number, need: number) => {
  if (y + need <= PAGE.height - 60) return { doc, y }
  doc.addPage()
  return { doc, y: M }
}

const sectionTitle = (doc: PDFKit.PDFDocument, y: number, text: string) => {
  doc.rect(M, y, 3, 12).fill(COLOR.brand)
  doc.fontSize(11).fillColor(COLOR.ink).text(text, M + 9, y - 1, { width: CW - 9 })
  return y + 20
}

const tableHeader = (
  doc: PDFKit.PDFDocument,
  y: number,
  cells: { text: string; x: number; width: number; align?: 'left' | 'right' | 'center' }[]
) => {
  doc.rect(M, y - 3, CW, 18).fill(COLOR.soft)
  doc.fontSize(8.5).fillColor(COLOR.muted)
  for (const cell of cells) {
    doc.text(cell.text, cell.x, y + 1, { width: cell.width, align: cell.align ?? 'left' })
  }
  return y + 19
}

const dimGroups = (checks: PortalCheck[]) => {
  const order: string[] = []
  const map = new Map<string, PortalCheck[]>()
  for (const item of checks) {
    if (!map.has(item.dimensionId)) {
      map.set(item.dimensionId, [])
      order.push(item.dimensionId)
    }
    map.get(item.dimensionId)?.push(item)
  }
  return order.map((id) => ({ id, name: map.get(id)?.[0]?.dimensionName ?? id, items: map.get(id) ?? [] }))
}

const renderCover = (doc: PDFKit.PDFDocument, data: PortalResultResponse) => {
  let y = header(doc, '专精特新中小企业 · 申报自评报告')
  const score = data.score

  doc.fontSize(19).fillColor(COLOR.ink).text(data.company.name, M, y, { width: CW })
  y += 26
  const metaLine = [
    data.company.creditCode ? `统一社会信用代码 ${data.company.creditCode}` : '',
    `统计期间 ${data.period.y2}–${data.period.y0}`,
    `生成于 ${data.generatedAt.slice(0, 10)}`
  ]
    .filter(Boolean)
    .join(' · ')
  doc.fontSize(8.5).fillColor(COLOR.muted).text(metaLine, M, y, { width: CW })
  y += 26

  doc.rect(M, y, CW, 96).fill('#f8fafc')
  doc.rect(M, y, CW, 96).lineWidth(0.8).strokeColor(COLOR.line).stroke()

  doc.fontSize(9).fillColor(COLOR.muted).text('当前参考得分', M + 16, y + 14, { width: 160 })
  doc.fontSize(44).fillColor(COLOR.brand).text(score ? num(score.official) : '—', M + 14, y + 26, {
    width: 180
  })
  doc.fontSize(9).fillColor(COLOR.muted).text('/ 100', M + 14, y + 74, { width: 180 })

  doc.fontSize(9).fillColor(COLOR.muted).text('补齐缺口后可达', M + 214, y + 14, { width: 150 })
  doc.fontSize(24).fillColor(COLOR.accent).text(score ? num(score.optimistic) : '—', M + 214, y + 32, {
    width: 150
  })

  const line = score?.passLine ?? 60
  doc.fontSize(9).fillColor(COLOR.muted).text(`达标参考线 ${line} 分`, M + 380, y + 14, { width: 120 })
  const verdict = score ? (score.passed ? '已达标' : `还差 ${num(score.gap)} 分`) : '待评估'
  doc
    .fontSize(15)
    .fillColor(score?.passed ? COLOR.pass : COLOR.gap)
    .text(verdict, M + 380, y + 34, { width: 120 })

  y += 112

  doc.fontSize(9).fillColor(COLOR.body)
  const sentence = score
    ? score.passed
      ? `当前得分已过 ${line} 分参考线。若能补齐下方列出的缺口，得分可提升约 ${num(score.potential)} 分，申报竞争力更稳。`
      : `距离 ${line} 分参考线还差 ${num(score.gap)} 分。下方列出的缺口全部补齐后，得分预计可达 ${num(score.optimistic)} 分。`
    : '本次评估未完成，请检查材料后重新提交。'
  doc.text(sentence, M, y, { width: CW, lineGap: 4 })
  y += 34

  if (score) {
    const axes = data.dimensions
    drawRadar(doc, {
      x: M + CW / 2,
      y: y + 132,
      radius: 108,
      labels: axes.map((item) => item.name),
      series: [
        {
          label: '当前',
          color: COLOR.brand,
          fill: true,
          values: axes.map((item) => (item.max > 0 ? item.score / item.max : 0))
        },
        {
          label: '补齐后',
          color: COLOR.accent,
          dashed: true,
          values: axes.map((item) => (item.max > 0 ? item.optimistic / item.max : 0))
        }
      ]
    })
    drawLegend(doc, M + CW / 2 - 70, y + 268, [
      { label: '当前得分', color: COLOR.brand },
      { label: '补齐后可达', color: COLOR.accent, dashed: true }
    ])
    doc
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text(
        `行业基准：${score.industry.code} ${score.industry.name ?? '未匹配，按中性基准估算'} · 有效证据 ${(score.materialRate * 100).toFixed(0)}%`,
        M,
        y + 292,
        { width: CW, align: 'center' }
      )

    const top = data.advices.slice(0, 3)
    if (top.length > 0) {
      let listY = y + 318
      doc.fontSize(9.5).fillColor(COLOR.ink).text('差距最大的三项', M, listY, { width: CW })
      listY += 16
      for (const [index, advice] of top.entries()) {
        doc
          .fontSize(8.5)
          .fillColor(COLOR.muted)
          .text(`${index + 1}`, M, listY + 1, { width: 14 })
        doc.fontSize(9).fillColor(COLOR.body).text(advice.title, M + 16, listY, { width: CW - 120 })
        doc
          .fontSize(8.5)
          .fillColor(COLOR.accent)
          .text(`可提升 ${num(advice.gain)} 分`, PAGE.width - M - 90, listY, {
            width: 90,
            align: 'right'
          })
        listY += 20
      }
    }
  }
}

const renderDimensions = (doc: PDFKit.PDFDocument, data: PortalResultResponse) => {
  doc.addPage()
  let y = header(doc, '一、五个维度')
  y = sectionTitle(doc, y, '维度得分')

  const cols = [
    { text: '维度', x: M, width: 150 },
    { text: '权重', x: M + 160, width: 50, align: 'right' as const },
    { text: '当前', x: M + 220, width: 70, align: 'right' as const },
    { text: '补齐后', x: M + 300, width: 70, align: 'right' as const },
    { text: '满分', x: M + 380, width: 60, align: 'right' as const }
  ]
  y = tableHeader(doc, y, cols)

  doc.fontSize(9)
  for (const item of data.dimensions) {
    doc.fillColor(COLOR.body).text(item.name, M, y, { width: 150 })
    doc.fillColor(COLOR.muted).text(`${item.weight}%`, M + 160, y, { width: 50, align: 'right' })
    doc.fillColor(COLOR.ink).text(num(item.score), M + 220, y, { width: 70, align: 'right' })
    doc.fillColor(COLOR.accent).text(num(item.optimistic), M + 300, y, { width: 70, align: 'right' })
    doc.fillColor(COLOR.muted).text(num(item.max), M + 380, y, { width: 60, align: 'right' })
    y += 17
    doc.moveTo(M, y - 4).lineTo(PAGE.width - M, y - 4).lineWidth(0.4).strokeColor(COLOR.line).stroke()
  }

  y += 14
  y = sectionTitle(doc, y, '逐项自查')
  doc.fontSize(8).fillColor(COLOR.muted).text('√ 符合要求　　○ 材料缺失　　× 需要补足', M, y, { width: CW })
  y += 18

  for (const group of dimGroups(data.checks)) {
    const block = gap(doc, y, 46)
    doc = block.doc
    y = block.y
    doc.rect(M, y - 3, CW, 16).fill(COLOR.soft)
    doc.fontSize(9).fillColor(COLOR.ink).text(group.name, M + 6, y, { width: CW - 12 })
    y += 18

    doc.fontSize(8.6)
    for (const item of group.items) {
      const text = item.text.replace(/\s*·\s*/g, ' · ').trim()
      const height = doc.heightOfString(text, { width: CW - 96 })
      const next = gap(doc, y, Math.max(16, height + 4))
      doc = next.doc
      y = next.y

      doc.fontSize(11).fillColor(MARK_COLOR[item.mark]).text(MARK_OF[item.mark], M, y - 1, {
        width: 16
      })
      doc.fontSize(8.6).fillColor(COLOR.body).text(text, M + 20, y, { width: CW - 96, lineGap: 1 })
      doc
        .fontSize(8.6)
        .fillColor(COLOR.muted)
        .text(
          item.mark === 'missing' ? '—' : `${((item.score ?? 0) * 100).toFixed(0)}%`,
          PAGE.width - M - 62,
          y,
          { width: 62, align: 'right' }
        )
      y += Math.max(16, height + 4)
    }
    y += 6
  }
}

const renderAdvices = (doc: PDFKit.PDFDocument, data: PortalResultResponse) => {
  doc.addPage()
  let y = header(doc, '二、补足建议')
  y = sectionTitle(doc, y, '按可提升分数排序')

  if (data.advices.length === 0) {
    doc.fontSize(9).fillColor(COLOR.muted).text('本次未生成建议，请检查材料完整性后重新评估。', M, y, {
      width: CW
    })
    return
  }

  for (const [index, advice] of data.advices.entries()) {
    const height = doc.heightOfString(advice.body, { width: CW - 24, lineGap: 3 }) + 34
    const next = gap(doc, y, height)
    doc = next.doc
    y = next.y

    doc.fontSize(9.5).fillColor(COLOR.ink).text(`${index + 1}. ${advice.title}`, M, y, {
      width: CW - 90
    })
    doc
      .fontSize(8.5)
      .fillColor(COLOR.accent)
      .text(`可提升 ${num(advice.gain)} 分`, PAGE.width - M - 86, y, { width: 86, align: 'right' })
    y += 16

    doc.fontSize(9).fillColor(COLOR.body).text(advice.body, M + 12, y, {
      width: CW - 24,
      lineGap: 3
    })
    y += doc.heightOfString(advice.body, { width: CW - 24, lineGap: 3 }) + 16
    doc.moveTo(M, y - 6).lineTo(PAGE.width - M, y - 6).lineWidth(0.4).strokeColor(COLOR.line).stroke()
  }
}

const renderMaterials = (doc: PDFKit.PDFDocument, data: PortalResultResponse) => {
  doc.addPage()
  let y = header(doc, '三、材料清单与说明')
  y = sectionTitle(doc, y, '材料完整度')

  const missing = new Map(data.missingSlots.map((slot) => [slot.id, slot]))
  const slots = [
    { id: 'finance', title: '财务报表（近三年年报）', optional: false },
    { id: 'tax', title: '企业所得税年度申报表', optional: false },
    { id: 'ledger', title: '账簿与科目余额表', optional: true },
    { id: 'extra', title: '其他补充材料', optional: true }
  ]

  doc.fontSize(9)
  for (const slot of slots) {
    const isMissing = missing.has(slot.id)
    const mark = slot.optional && slot.id === 'ledger' ? '—' : isMissing ? '○' : '√'
    const color =
      slot.optional && slot.id === 'ledger'
        ? COLOR.muted
        : isMissing
          ? COLOR.missing
          : COLOR.pass
    doc.fontSize(11).fillColor(color).text(mark, M, y - 1, { width: 16 })
    doc.fontSize(9).fillColor(COLOR.body).text(slot.title, M + 20, y, { width: CW - 120 })
    doc
      .fontSize(8.5)
      .fillColor(COLOR.muted)
      .text(
        slot.optional && slot.id === 'ledger' ? '按需提供' : isMissing ? '未上传' : '已上传',
        PAGE.width - M - 70,
        y,
        { width: 70, align: 'right' }
      )
    y += 18
  }

  if (data.warnings.length > 0) {
    y += 10
    y = sectionTitle(doc, y, '需要留意')
    doc.fontSize(8.5).fillColor(COLOR.gap)
    for (const warning of data.warnings.slice(0, 6)) {
      doc.text(`· ${warning}`, M, y, { width: CW, lineGap: 2 })
      y += doc.heightOfString(warning, { width: CW }) + 4
    }
  }

  y += 18
  y = sectionTitle(doc, y, '说明')

  const notes = [
    '本报告为申报前自评参考，不构成主管部门的认定结论，也不代表最终评审结果。',
    '五个一级维度权重取自政策文件；三级指标权重官方未公布，本报告按维度内等权处理。',
    '软件著作权按 3 件折算 1 件发明专利计入知识产权项，折算上限 3 件，属参考折算。',
    '行业基准数值来自公开统计与行业报告估算，未匹配到行业时按中性基准计算。',
    '换设备后，在首页输入企业全称与手机号后四位即可找回本报告。'
  ]
  doc.fontSize(8.5).fillColor(COLOR.body)
  for (const note of notes) {
    doc.text(`· ${note}`, M, y, { width: CW, lineGap: 3 })
    y += doc.heightOfString(note, { width: CW, lineGap: 3 }) + 4
  }

  if (existsSync(QR_FILE)) {
    y += 16
    const cardHeight = 118
    doc.rect(M, y, CW, cardHeight).fill('#f8fafc')
    doc.rect(M, y, CW, cardHeight).lineWidth(0.8).strokeColor(COLOR.line).stroke()
    doc.image(QR_FILE, M + 16, y + 13, { fit: [92, 92] })
    doc
      .fontSize(10.5)
      .fillColor(COLOR.ink)
      .text('扫码添加顾问，一起看这份报告', M + 124, y + 26, { width: CW - 150 })
    doc
      .fontSize(8.5)
      .fillColor(COLOR.muted)
      .text('把缺的材料补齐之后可以重新评估一次，分数会同步更新。', M + 124, y + 48, {
        width: CW - 150,
        lineGap: 3
      })
  }
}

export const renderPortalPdf = async (data: PortalResultResponse): Promise<Buffer> => {
  const font = resolveReportFont()
  const doc = new PDFDocument({
    size: 'A4',
    margin: M,
    bufferPages: true,
    info: { Title: `${data.company.name} 专精特新自评报告`, Author: '专精特新申报自评打分系统' }
  })

  if (font.postscriptName) doc.registerFont('report', font.path, font.postscriptName)
  else doc.registerFont('report', font.path)
  doc.font('report')

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
  })

  renderCover(doc, data)
  renderDimensions(doc, data)
  renderAdvices(doc, data)
  renderMaterials(doc, data)

  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    footer(doc, index + 1, range.count)
  }

  doc.end()
  return done
}

export const sendPortalPdf = async (res: Response, data: PortalResultResponse): Promise<void> => {
  const buffer = await renderPortalPdf(data)
  const filename = `${data.company.name}-专精特新自评报告.pdf`
  res.setHeader('content-type', 'application/pdf')
  res.setHeader(
    'content-disposition',
    `attachment; filename="report.pdf"; filename*=UTF-8''${encodeURIComponent(filename)}`
  )
  res.setHeader('content-length', String(buffer.length))
  res.send(buffer)
}
