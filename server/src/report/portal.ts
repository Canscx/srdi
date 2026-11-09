import PDFDocument from 'pdfkit'
import type { Response } from 'express'
import { TARGET_RATE, yearsSinceDate } from '@srdi/shared'
import type { PortalCheck, PortalResultResponse } from '@srdi/shared'
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

const moneyText = (value: number | undefined) => {
  if (typeof value !== 'number' || value <= 0) return ''
  if (value >= 100000000) return `${(value / 100000000).toFixed(2).replace(/\.?0+$/, '')} 亿元`
  if (value >= 10000) return `${(value / 10000).toFixed(2).replace(/\.?0+$/, '')} 万元`
  return `${value} 元`
}

const identityPanel = (doc: PDFKit.PDFDocument, y: number, data: PortalResultResponse) => {
  const industry = data.company.industryName || data.company.industryCode || ''
  const capital = moneyText(data.company.registeredCapital)
  const establishedRaw = (data.company.establishedDate ?? '').trim()
  const establishedSpan = establishedRaw ? yearsSinceDate(establishedRaw) : null
  const established = establishedRaw
    ? `${establishedRaw}${establishedSpan === null ? '' : `（${establishedSpan} 年）`}`
    : ''
  const scope = (data.company.businessScope ?? '').trim()
  const registry = [capital ? `注册资本 ${capital}` : '', established ? `成立 ${established}` : '']
    .filter(Boolean)
    .join(' · ')

  const rows: { label: string; value: string; clamp?: boolean }[] = []
  if (industry) rows.push({ label: '行业', value: industry })
  if (registry) rows.push({ label: '工商登记', value: registry })
  if (scope) rows.push({ label: '经营范围', value: scope, clamp: true })
  if (rows.length === 0) return y

  const labelW = 56
  const valueW = CW - labelW - 30
  const heights = rows.map((row) =>
    row.clamp ? 24 : doc.fontSize(8.6).heightOfString(row.value, { width: valueW, lineGap: 2 })
  )
  const height = 14 + heights.reduce((sum, item) => sum + item + 4, 0) + 4

  doc.rect(M, y, CW, height).fill('#f8fafc')
  doc.rect(M, y, CW, height).lineWidth(0.6).strokeColor(COLOR.line).stroke()

  let cursor = y + 9
  rows.forEach((row, index) => {
    doc.fontSize(8).fillColor(COLOR.muted).text(row.label, M + 14, cursor + 1, { width: labelW })
    doc.fontSize(8.6).fillColor(COLOR.body).text(
      row.value,
      M + 14 + labelW,
      cursor,
      row.clamp
        ? { width: valueW, height: 24, ellipsis: true, lineGap: 2 }
        : { width: valueW, lineGap: 2 }
    )
    cursor += heights[index] + 4
  })

  return y + height + 14
}

const renderCover = (doc: PDFKit.PDFDocument, data: PortalResultResponse) => {
  let y = header(doc, '专精特新中小企业 · 申报自评报告')
  const score = data.score

  doc.fontSize(19).fillColor(COLOR.ink).text(data.company.name, M, y, { width: CW })
  y += doc.heightOfString(data.company.name, { width: CW }) + 8
  const metaLine = [
    `统计期间 ${data.period.y2}–${data.period.y0}`,
    `生成于 ${data.generatedAt.slice(0, 10)}`
  ]
    .filter(Boolean)
    .join(' · ')
  doc.fontSize(8.5).fillColor(COLOR.muted).text(metaLine, M, y, { width: CW })
  y += doc.heightOfString(metaLine, { width: CW }) + 12

  y = identityPanel(doc, y, data)

  doc.rect(M, y, CW, 96).fill('#f8fafc')
  doc.rect(M, y, CW, 96).lineWidth(0.8).strokeColor(COLOR.line).stroke()

  doc.fontSize(9).fillColor(COLOR.muted).text('当前参考得分（口径从严，参考分偏低）', M + 16, y + 14, {
    width: 180
  })
  doc.fontSize(44).fillColor(COLOR.brand).text(score ? num(score.official) : '—', M + 14, y + 26, {
    width: 180
  })
  doc.fontSize(9).fillColor(COLOR.muted).text('/ 100', M + 14, y + 74, { width: 180 })

  doc.fontSize(9).fillColor(COLOR.muted).text('补齐并达标后可达', M + 214, y + 14, { width: 150 })
  doc.fontSize(24).fillColor(COLOR.accent).text(score ? num(score.goal) : '—', M + 214, y + 32, {
    width: 150
  })

  const line = score?.passLine ?? 0
  doc.fontSize(9).fillColor(COLOR.muted).text(`达标参考线 ${line} 分`, M + 380, y + 14, { width: 120 })
  const reached = Boolean(score && score.official >= line)
  const needsEvidence = Boolean(score && reached && !score.evidenceSufficient)
  const verdict = !score ? '待评估' : score.passed ? '已达标' : needsEvidence ? '待补证' : `还差 ${num(score.gap)} 分`
  doc
    .fontSize(15)
    .fillColor(score?.passed ? COLOR.pass : COLOR.gap)
    .text(verdict, M + 380, y + 34, { width: 120 })

  y += 112

  doc.fontSize(9).fillColor(COLOR.body)
  const targetPct = Math.round(TARGET_RATE * 100)
  const sentence = !score
    ? '本次评估未完成，请检查材料后重新提交。'
    : score.passed
      ? `当前得分已过 ${line} 分参考线。若补齐下方缺口并按每项 ${targetPct}% 得分率计分，目标分可提升约 ${num(score.potential)} 分，申报竞争力更稳。`
      : needsEvidence
        ? `当前得分已过 ${line} 分参考线，但材料覆盖率不足，请补齐下方缺口后再确认申报。`
        : score.goal < line
          ? `距离 ${line} 分参考线还差 ${num(score.gap)} 分。即使补齐材料并按每项 ${targetPct}% 得分率计分，目标分也只有 ${num(score.goal)} 分，需先补强低分维度。`
          : `距离 ${line} 分参考线还差 ${num(score.gap)} 分。缺口补齐并按每项 ${targetPct}% 得分率计分后，目标分预计可达 ${num(score.goal)} 分。`
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
          label: '补齐达标后',
          color: COLOR.accent,
          dashed: true,
          values: axes.map((item) => (item.max > 0 ? item.goal / item.max : 0))
        }
      ]
    })
    drawLegend(doc, M + CW / 2 - 70, y + 268, [
      { label: '当前得分', color: COLOR.brand },
      { label: '补齐达标后', color: COLOR.accent, dashed: true }
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
    { text: '补齐达标后', x: M + 300, width: 70, align: 'right' as const },
    { text: '满分', x: M + 380, width: 60, align: 'right' as const }
  ]
  y = tableHeader(doc, y, cols)

  doc.fontSize(9)
  for (const item of data.dimensions) {
    doc.fillColor(COLOR.body).text(item.name, M, y, { width: 150 })
    doc.fillColor(COLOR.muted).text(`${item.weight}%`, M + 160, y, { width: 50, align: 'right' })
    doc.fillColor(COLOR.ink).text(num(item.score), M + 220, y, { width: 70, align: 'right' })
    doc.fillColor(COLOR.accent).text(num(item.goal), M + 300, y, { width: 70, align: 'right' })
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
      const base = item.text.replace(/\s*·\s*/g, ' · ').trim()
      const text = item.neutral ? `${base}（缺材料，按中性 0.5 计入）` : base
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
          item.mark === 'missing'
            ? item.neutral
              ? '50%'
              : '—'
            : `${((item.score ?? 0) * 100).toFixed(0)}%`,
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
  const licenseCount = data.materials.filter((item) => item.slot === 'license').length
  const slots = [
    ...(licenseCount > 0
      ? [{ id: 'license', title: '营业执照（企业身份信息）', optional: true }]
      : []),
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

  y += 18
  y = sectionTitle(doc, y, '说明')

  const notes = [
    '本报告为申报前自评参考，不构成主管部门的认定结论，也不代表最终评审结果。',
    '当前参考得分按未补证材料从严计分，实际申报时政策口径通常放宽，参考分偏低属正常。',
    '「补齐并达标后」为材料补齐且每项至少达到 80% 得分率推算的目标分，不是承诺分。',
    '五个一级维度权重取自政策文件；三级指标权重官方未公布，本报告按维度内等权处理。',
    '知识产权按官方就高选一档计分：高价值Ⅰ类 10 分、自主研发Ⅰ类 8 分、Ⅰ类 6 分、Ⅱ类 2 分，不叠加；客户自述数据仅作参考。',
    '从事细分市场年限在材料未给出时，按营业执照成立日期推算，时点为统计截止年年末。',
    '行业基准数值来自公开统计与行业报告估算，未匹配到行业时按中性基准计算。',
    '换设备后，在首页输入企业全称与手机号后四位即可找回本报告。'
  ]
  const NOTE_INDENT = 11
  doc.fontSize(8.5).fillColor(COLOR.body)
  for (const note of notes) {
    const height = doc.heightOfString(note, { width: CW - NOTE_INDENT, lineGap: 3 })
    const next = gap(doc, y, height + 6)
    doc = next.doc
    y = next.y
    doc.fontSize(8.5).fillColor(COLOR.body).text('·', M, y, { width: NOTE_INDENT })
    doc.text(note, M + NOTE_INDENT, y, { width: CW - NOTE_INDENT, lineGap: 3 })
    y += height + 4
  }

  const scope = (data.company.businessScope ?? '').trim()
  if (scope) {
    y += 16
    const moved = gap(doc, y, 70)
    doc = moved.doc
    y = moved.y
    y = sectionTitle(doc, y, '附录 · 企业基本信息')

    const labelW = 78
    const rows = [
      { label: '企业名称', value: data.company.name },
      ...(data.company.industryName || data.company.industryCode
        ? [{ label: '行业', value: data.company.industryName || data.company.industryCode || '' }]
        : []),
      { label: '经营范围', value: scope }
    ]

    for (const row of rows) {
      const text = row.value.replace(/\s+/g, ' ')
      const height = doc.fontSize(8.6).heightOfString(text, { width: CW - labelW, lineGap: 3 })
      const next = gap(doc, y, height + 8)
      doc = next.doc
      y = next.y
      doc.fontSize(8.5).fillColor(COLOR.muted).text(row.label, M, y, { width: labelW })
      doc
        .fontSize(8.6)
        .fillColor(COLOR.body)
        .text(text, M + labelW, y, { width: CW - labelW, lineGap: 3 })
      y += height + 8
    }

    doc
      .fontSize(8)
      .fillColor(COLOR.muted)
      .text('经营范围与注册资本识别自营业执照，以营业执照原件为准。', M, y, { width: CW })
    y += 16
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
