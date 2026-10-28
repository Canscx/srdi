import PDFDocument from 'pdfkit'
import {
  CONCLUSION_TEXT,
  DOC_TYPE_TEXT,
  FIELD_GROUP_TITLES,
  GATE_VERDICT_TEXT,
  INDICATOR_STATUS_TEXT
} from '@srdi/shared'
import { AppError } from '../errors'
import type { ReportIndicator, ReportModel } from './build'
import { resolveReportFont } from './fonts'
import {
  GROUP_ORDER,
  flagText,
  formatDateTime,
  gateBasisText,
  gateEffectText,
  gateVerdictText,
  indicatorFlagsText,
  indicatorRawText,
  n2,
  pct1,
  scoreRateText
} from './format'

const MARGIN = 46
const PAGE_WIDTH = 595.28
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const HEADER_ROW = 20

const COLORS = {
  ink: '#1f2937',
  body: '#374151',
  muted: '#6b7280',
  light: '#9aa5b5',
  accent: '#2563eb',
  accentSoft: '#eff5ff',
  line: '#e6ebf2',
  head: '#f4f7fb',
  zebra: '#fbfcfe',
  warnBg: '#fffbeb',
  warnBorder: '#fde68a',
  warnText: '#92400e',
  ok: '#047857',
  bad: '#b91c1c',
  warn: '#b45309'
}

interface Column {
  title: string
  width: number
  align?: 'left' | 'right' | 'center'
}

interface TextStyle {
  size?: number
  color?: string
  width?: number
  gap?: number
  indent?: number
}

const statusOf = (item: ReportIndicator): string =>
  INDICATOR_STATUS_TEXT[item.result.status] ?? item.result.status

const fileStatusText: Record<string, string> = {
  parsed: '已解析',
  failed: '解析失败',
  pending: '待解析'
}

const verdictColor = (verdict: string): string => {
  if (verdict === 'pass') return COLORS.ok
  if (verdict === 'fail') return COLORS.bad
  if (verdict === 'pending') return COLORS.warn
  return COLORS.light
}

export const renderPdf = async (model: ReportModel): Promise<Buffer> => {
  const font = resolveReportFont()
  const result = model.record.result
  const stats = model.record.evidence
  const period = `${result.period.y2}–${result.period.y0}`
  const industry = result.industry
  const industryLabel = `${industry.code || '—'} ${industry.name ?? '未匹配行业'}${
    industry.benchmarkSource === 'default' ? '（中性基准估算）' : ''
  }`
  const gatePass = result.gates.filter((gate) => gate.effective === 'pass').length
  const gateFail = result.gates.filter((gate) => gate.effective === 'fail').length
  const gatePending = result.gates.filter((gate) => gate.effective === 'pending').length
  const pendingIndicators = model.indicators.filter(
    (item) => item.result.basis === 'absent' || item.result.basis === 'substituted'
  )
  const notApplicable = model.indicators.filter(
    (item) => item.result.status === 'notApplicable'
  )
  const countStatus = (status: string) =>
    model.fields.filter((field) => field.status === status).length
  const shortFields = model.fields.filter(
    (field) => field.status === 'missing' || field.status === 'rejected'
  )

  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: `${model.project.name} · 专精特新中小企业自评报告`,
      Author: '专精特新申报自评打分系统',
      Subject: '参考得分非官方口径,仅供申报前自查',
      CreationDate: new Date()
    }
  })

  try {
    doc.registerFont('report', font.path, font.family)
  } catch (err) {
    throw new AppError(
      500,
      'report_font_invalid',
      '中文字体加载失败,无法生成 PDF',
      (err as Error).message
    )
  }
  doc.font('report')

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const bottom = () => doc.page.height - 62

  const ensure = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage()
  }

  const write = (value: string, style: TextStyle = {}) => {
    const size = style.size ?? 9.2
    const indent = style.indent ?? 0
    const width = style.width ?? CONTENT_WIDTH - indent
    doc
      .fontSize(size)
      .fillColor(style.color ?? COLORS.body)
      .text(value, MARGIN + indent, doc.y, {
        width,
        lineGap: style.gap ?? 2.4
      })
  }

  const section = (label: string, title: string) => {
    ensure(44)
    doc.y += 6
    const y = doc.y
    doc.rect(MARGIN, y + 2, 3, 12).fill(COLORS.accent)
    doc
      .fontSize(12.5)
      .fillColor(COLORS.ink)
      .text(`${label}、${title}`, MARGIN + 10, y, {
        width: CONTENT_WIDTH - 10,
        lineBreak: false
      })
    doc
      .moveTo(MARGIN, y + 21)
      .lineTo(MARGIN + CONTENT_WIDTH, y + 21)
      .lineWidth(0.5)
      .strokeColor(COLORS.line)
      .stroke()
    doc.y = y + 28
  }

  const subheading = (title: string) => {
    ensure(26)
    doc.y += 2
    doc
      .fontSize(10)
      .fillColor(COLORS.accent)
      .text(title, MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1 })
    doc.y += 4
  }

  const bullet = (value: string, color: string = COLORS.body) => {
    doc.fontSize(8.8)
    const height = doc.heightOfString(value, { width: CONTENT_WIDTH - 12, lineGap: 2 })
    ensure(height + 3)
    const y = doc.y
    doc.circle(MARGIN + 3, y + 4.4, 1.3).fill(COLORS.accent)
    doc
      .fontSize(8.8)
      .fillColor(color)
      .text(value, MARGIN + 11, y, { width: CONTENT_WIDTH - 11, lineGap: 2 })
    doc.y = Math.max(doc.y, y + height) + 2
  }

  const note = (value: string, tone: 'warn' | 'plain' = 'warn') => {
    const padding = 8
    doc.fontSize(8.4)
    const height =
      doc.heightOfString(value, { width: CONTENT_WIDTH - padding * 2, lineGap: 2 }) +
      padding * 2
    ensure(height + 8)
    const y = doc.y
    doc
      .roundedRect(MARGIN, y, CONTENT_WIDTH, height, 5)
      .fillAndStroke(
        tone === 'warn' ? COLORS.warnBg : COLORS.zebra,
        tone === 'warn' ? COLORS.warnBorder : COLORS.line
      )
    doc
      .fontSize(8.4)
      .fillColor(tone === 'warn' ? COLORS.warnText : COLORS.muted)
      .text(value, MARGIN + padding, y + padding, {
        width: CONTENT_WIDTH - padding * 2,
        lineGap: 2
      })
    doc.y = y + height + 8
  }

  const drawTable = (columns: Column[], rows: string[][], size = 8.4) => {
    const padX = 4
    const padY = 3.4
    const total = columns.reduce((sum, column) => sum + column.width, 0)
    const widths = columns.map((column) => (column.width * CONTENT_WIDTH) / total)

    const drawHeader = () => {
      ensure(HEADER_ROW + 30)
      const y = doc.y
      doc.rect(MARGIN, y, CONTENT_WIDTH, HEADER_ROW).fill(COLORS.head)
      let x = MARGIN
      doc.fontSize(size).fillColor(COLORS.muted)
      columns.forEach((column, index) => {
        doc.text(column.title, x + padX, y + 5.5, {
          width: widths[index] - padX * 2,
          align: column.align ?? 'left',
          lineBreak: false
        })
        x += widths[index]
      })
      doc.y = y + HEADER_ROW
    }

    drawHeader()

    rows.forEach((row, rowIndex) => {
      doc.fontSize(size)
      const heights = row.map((value, index) =>
        doc.heightOfString(value, { width: widths[index] - padX * 2, lineGap: 1 })
      )
      const rowHeight = Math.max(...heights, 11) + padY * 2
      if (doc.y + rowHeight > bottom()) {
        doc.addPage()
        drawHeader()
      }
      const y = doc.y
      if (rowIndex % 2 === 1) doc.rect(MARGIN, y, CONTENT_WIDTH, rowHeight).fill(COLORS.zebra)
      let x = MARGIN
      doc.fontSize(size).fillColor(COLORS.body)
      row.forEach((value, index) => {
        doc.text(value, x + padX, y + padY, {
          width: widths[index] - padX * 2,
          align: columns[index].align ?? 'left',
          lineGap: 1
        })
        x += widths[index]
      })
      doc
        .moveTo(MARGIN, y + rowHeight)
        .lineTo(MARGIN + CONTENT_WIDTH, y + rowHeight)
        .lineWidth(0.5)
        .strokeColor(COLORS.line)
        .stroke()
      doc.y = y + rowHeight
    })

    doc.y += 6
  }

  const kpi = () => {
    ensure(76)
    const y = doc.y
    const gap = 10
    const width = (CONTENT_WIDTH - gap * 2) / 3
    const items = [
      {
        label: '参考得分',
        value: n2(result.totals.official),
        sub: '满分 100',
        accent: true
      },
      {
        label: '三口径区间',
        value:
          result.totals.conservative === result.totals.optimistic
            ? n2(result.totals.official)
            : `${n2(result.totals.conservative)}–${n2(result.totals.optimistic)}`,
        sub: '保守 – 乐观',
        accent: false
      },
      {
        label: '证据可信度',
        value: pct1(result.totals.confidence),
        sub: `已确认 ${stats.confirmed} / ${stats.total}`,
        accent: false
      }
    ]
    items.forEach((item, index) => {
      const x = MARGIN + index * (width + gap)
      doc.roundedRect(x, y, width, 62, 6).fill(item.accent ? COLORS.accentSoft : '#f7f9fc')
      doc
        .fontSize(8.2)
        .fillColor(COLORS.muted)
        .text(item.label, x + 10, y + 9, { width: width - 20, lineBreak: false })
      doc
        .fontSize(item.accent ? 21 : 15)
        .fillColor(item.accent ? '#1d4ed8' : COLORS.ink)
        .text(item.value, x + 10, y + 21, { width: width - 20, lineBreak: false })
      doc
        .fontSize(7.8)
        .fillColor(COLORS.light)
        .text(item.sub, x + 10, y + 47, { width: width - 20, lineBreak: false })
    })
    doc.y = y + 70
  }

  const gateBlock = (gate: (typeof result.gates)[number]) => {
    doc.fontSize(9.6)
    const titleHeight = doc.heightOfString(`${gate.id} ${gate.name}`, {
      width: CONTENT_WIDTH - 150,
      lineGap: 1
    })
    ensure(titleHeight + 42)
    const y = doc.y
    doc
      .fontSize(9.6)
      .fillColor(COLORS.ink)
      .text(`${gate.id} ${gate.name}`, MARGIN, y, {
        width: CONTENT_WIDTH - 150,
        lineGap: 1
      })
    const titleBottom = doc.y
    doc
      .fontSize(8.8)
      .fillColor(verdictColor(gate.effective))
      .text(`${gateVerdictText(gate)} · ${gateEffectText(gate)}`, MARGIN + CONTENT_WIDTH - 150, y, {
        width: 150,
        align: 'right',
        lineBreak: false
      })
    doc.y = Math.max(titleBottom, y + 12) + 2

    doc
      .fontSize(8.2)
      .fillColor(COLORS.muted)
      .text(`依据：${gateBasisText(gate)}`, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        lineGap: 1.5
      })

    doc
      .fontSize(8.6)
      .fillColor(COLORS.body)
      .text(
        `说明：${gate.explain}${gate.passedVia ? `（经 ${gate.passedVia} 通过）` : ''}`,
        MARGIN,
        doc.y,
        { width: CONTENT_WIDTH, lineGap: 1.8 }
      )

    if (gate.checks.length > 0) {
      for (const check of gate.checks) {
        const label = `${check.id} ${check.label}：${GATE_VERDICT_TEXT[check.verdict] ?? check.verdict}`
        doc.fontSize(8.2)
        const height = doc.heightOfString(label, { width: CONTENT_WIDTH - 14, lineGap: 1.5 })
        ensure(height + 2)
        const lineY = doc.y
        doc.circle(MARGIN + 4, lineY + 4, 1.2).fill(verdictColor(check.verdict))
        doc
          .fontSize(8.2)
          .fillColor(COLORS.muted)
          .text(label, MARGIN + 12, lineY, {
            width: CONTENT_WIDTH - 12,
            lineGap: 1.5
          })
        doc.y = Math.max(doc.y, lineY + height) + 1
      }
    } else {
      doc
        .fontSize(8.2)
        .fillColor(COLORS.muted)
        .text('按三口径分数判定,无独立检查项', MARGIN + 12, doc.y, {
          width: CONTENT_WIDTH - 12,
          lineGap: 1.5
        })
    }
    doc.y += 8
  }

  const assumptionBlock = (item: { id: string; text: string; impact: string }) => {
    doc.fontSize(8.6)
    const height = doc.heightOfString(`${item.id} ${item.text}`, {
      width: CONTENT_WIDTH - 10,
      lineGap: 2
    })
    ensure(height + 22)
    doc
      .fontSize(8.6)
      .fillColor(COLORS.body)
      .text(`${item.id} ${item.text}`, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        lineGap: 2
      })
    doc
      .fontSize(7.8)
      .fillColor(COLORS.light)
      .text(`影响：${item.impact}`, MARGIN + 10, doc.y, {
        width: CONTENT_WIDTH - 10,
        lineGap: 1.5
      })
    doc.y += 8
  }

  doc
    .fontSize(8.4)
    .fillColor(COLORS.light)
    .text('专精特新申报自评 · 参考口径', MARGIN, MARGIN, {
      width: CONTENT_WIDTH,
      lineBreak: false
    })
  doc.y = MARGIN + 14

  doc
    .fontSize(19)
    .fillColor(COLORS.ink)
    .text(model.project.name, MARGIN, doc.y, { width: CONTENT_WIDTH, lineGap: 1 })
  doc
    .fontSize(11)
    .fillColor(COLORS.accent)
    .text('专精特新中小企业自评报告', MARGIN, doc.y, {
      width: CONTENT_WIDTH,
      lineGap: 1
    })
  doc.y += 2
  doc
    .fontSize(8.4)
    .fillColor(COLORS.muted)
    .text(
      `统计期间 ${period} · ${industryLabel} · 生成于 ${formatDateTime(model.generatedAt)}`,
      MARGIN,
      doc.y,
      { width: CONTENT_WIDTH, lineGap: 1.5 }
    )
  doc.y += 8

  note(
    '参考得分 · 非官方口径：五个一级维度权重取自政策文件；三级指标政策未公布权重,本工具按维度内等权处理。得分为规则引擎算出的自查参考值,与主管部门的评审结果不可直接比对。'
  )

  if (model.stale) {
    note(
      `证据在打分之后有变动。本报告的数字来自 ${formatDateTime(
        model.record.savedAt
      )} 的评分结果(当时已确认 ${stats.confirmed} / ${stats.total} 个字段),建议回评分页重新计算后再导出。`
    )
  }

  section('一', '结论摘要')
  kpi()
  bullet(`门槛判定：${gatePass} 项通过,${gateFail} 项阻断,${gatePending} 项待定`)
  bullet(
    `参考得分：${n2(result.totals.official)} / 100（保守 ${n2(
      result.totals.conservative
    )} – 乐观 ${n2(result.totals.optimistic)}）`
  )
  bullet(
    `证据可信度：${pct1(result.totals.confidence)},${stats.total} 个字段已确认 ${stats.confirmed} 个`
  )
  bullet(`综合结论：${CONCLUSION_TEXT[result.conclusion] ?? result.conclusion}`)
  doc.y += 3
  drawTable(
    [
      { title: '门槛', width: 233 },
      { title: '判词', width: 90 },
      { title: '依据', width: 90 },
      { title: '结论', width: 90 }
    ],
    result.gates.map((gate) => [
      `${gate.id} ${gate.name}`,
      gateVerdictText(gate),
      gateBasisText(gate),
      gateEffectText(gate)
    ])
  )

  section('二', '材料完整度')
  drawTable(
    [
      { title: '状态', width: 280 },
      { title: '字段数', width: 120, align: 'right' }
    ],
    [
      ['已确认', String(countStatus('confirmed'))],
      ['待确认', String(countStatus('candidate'))],
      ['缺失', String(countStatus('missing'))],
      ['已否决', String(countStatus('rejected'))],
      ['合计', String(model.fields.length)]
    ]
  )
  drawTable(
    [
      { title: '分组', width: 143 },
      { title: '字段数', width: 70, align: 'right' },
      { title: '已确认', width: 70, align: 'right' },
      { title: '缺失', width: 70, align: 'right' },
      { title: '待确认', width: 75, align: 'right' },
      { title: '已否决', width: 75, align: 'right' }
    ],
    GROUP_ORDER.map((group) => {
      const items = model.fields.filter((field) => field.group === group)
      if (items.length === 0) return null
      return [
        FIELD_GROUP_TITLES[group] ?? group,
        String(items.length),
        String(items.filter((field) => field.status === 'confirmed').length),
        String(items.filter((field) => field.status === 'missing').length),
        String(items.filter((field) => field.status === 'candidate').length),
        String(items.filter((field) => field.status === 'rejected').length)
      ]
    }).filter((row): row is string[] => row !== null)
  )

  write(`缺失或已否决的字段（${shortFields.length}）`, { size: 8.8, color: COLORS.ink })
  doc.y += 2
  if (shortFields.length === 0) {
    bullet('无,40 个字段全部有已确认值。')
  } else {
    for (const group of GROUP_ORDER) {
      const items = shortFields.filter((field) => field.group === group)
      if (items.length === 0) continue
      const detail = items
        .map(
          (field) =>
            `${field.label}（${field.key}）${field.status === 'rejected' ? ' · 已否决' : ''}`
        )
        .join('、')
      bullet(`${FIELD_GROUP_TITLES[group] ?? group}：${detail}`)
    }
  }
  doc.y += 4

  section('三', '参考得分')
  subheading('三口径')
  drawTable(
    [
      { title: '口径', width: 70 },
      { title: '分数', width: 80, align: 'right' },
      { title: '计算口径', width: 353 }
    ],
    [
      ['保守', n2(result.totals.conservative), '估算项与缺失项记 0'],
      ['参考', n2(result.totals.official), '缺失项按半个权重,估算项按估算分计入'],
      ['乐观', n2(result.totals.optimistic), '估算项与缺失项记满权重']
    ]
  )
  subheading('五维分布')
  drawTable(
    [
      { title: '维度', width: 100 },
      { title: '名义权重', width: 62, align: 'right' },
      { title: '重归一满分', width: 72, align: 'right' },
      { title: '参考', width: 62, align: 'right' },
      { title: '保守', width: 62, align: 'right' },
      { title: '乐观', width: 62, align: 'right' },
      { title: '可信度', width: 83, align: 'right' }
    ],
    result.dimensions.map((dimension) => [
      dimension.name,
      n2(dimension.weight),
      n2(model.dimensionMax[dimension.id] ?? dimension.weight),
      n2(dimension.score.official),
      n2(dimension.score.conservative),
      n2(dimension.score.optimistic),
      pct1(dimension.score.confidence)
    ])
  )
  write(
    result.totals.conservative === result.totals.optimistic
      ? `区间收敛于 ${n2(result.totals.official)},当前没有估算项与缺失项。`
      : `区间 ${n2(result.totals.conservative)} – ${n2(
          result.totals.optimistic
        )},差距来自估算项与缺失项,差距越小说明证据越扎实。`,
    { size: 8.2, color: COLORS.muted }
  )
  doc.y += 4

  section('四', '门槛判定')
  for (const gate of result.gates) gateBlock(gate)

  section('五', '指标明细')
  for (const dimension of result.dimensions) {
    const items = model.indicators.filter(
      (item) => item.result.dimensionId === dimension.id
    )
    if (items.length === 0) continue
    subheading(
      `${dimension.name}（名义权重 ${n2(dimension.weight)} · 重归一满分 ${n2(
        model.dimensionMax[dimension.id] ?? dimension.weight
      )} · 参考 ${n2(dimension.score.official)}）`
    )
    drawTable(
      [
        { title: '编号', width: 30, align: 'right' },
        { title: '指标', width: 140 },
        { title: '状态', width: 46 },
        { title: '原始值', width: 95, align: 'right' },
        { title: '得分率', width: 48, align: 'right' },
        { title: '权重', width: 38, align: 'right' },
        { title: '有效权重', width: 42, align: 'right' },
        { title: '标记', width: 64 }
      ],
      items.map((item) => [
        String(item.result.code),
        item.result.name,
        statusOf(item),
        indicatorRawText(item.result.raw, item.unit),
        scoreRateText(item.result.score),
        n2(item.result.weight),
        n2(item.result.effectiveWeight),
        indicatorFlagsText(item.result, item.missingFields)
      ])
    )
  }

  section('六', '待补材料')
  subheading(`缺失与估算指标（${pendingIndicators.length}）`)
  if (pendingIndicators.length === 0) {
    bullet('无,23 项指标全部有实测证据。')
  } else {
    drawTable(
      [
        { title: '编号', width: 56 },
        { title: '指标', width: 170 },
        { title: '状态', width: 50 },
        { title: '缺失字段', width: 227 }
      ],
      pendingIndicators.map((item) => [
        item.result.id,
        item.result.name,
        statusOf(item),
        item.missingFields.length > 0 ? item.missingFields.join('、') : '—'
      ])
    )
  }

  subheading('排除项')
  if (result.excluded.length === 0) {
    bullet('无。')
  } else {
    for (const item of result.excluded) {
      const indicator = model.indicators.find(
        (entry) => entry.result.id === item.indicatorId
      )
      bullet(
        `${item.indicatorId} ${indicator?.result.name ?? ''} · 原权重 ${n2(
          item.baseWeight
        )} · ${item.reason}`
      )
    }
    bullet(
      `上述指标不计分,其余 ${
        result.indicators.length - result.excluded.length
      } 项权重等比放大,有效权重合计 100。`
    )
  }

  subheading('不适用指标')
  if (notApplicable.length === 0) {
    bullet('无。')
  } else {
    for (const item of notApplicable) {
      bullet(
        `${item.result.id} ${item.result.name} · ${
          item.result.reason ? flagText(item.result.reason) : '边界保护'
        } · 记 0 分`
      )
    }
  }

  section('七', '口径与假设')
  for (const item of model.assumptions) assumptionBlock(item)

  section('八', '材料清单')
  if (model.project.files.length === 0) {
    write('未上传材料。', { size: 8.8, color: COLORS.muted })
  } else {
    drawTable(
      [
        { title: '文件', width: 250 },
        { title: '类型', width: 90 },
        { title: '页数', width: 50, align: 'right' },
        { title: '状态', width: 113 }
      ],
      model.project.files.map((file) => [
        file.name,
        DOC_TYPE_TEXT[file.docType ?? 'other'] ?? file.docType ?? '其他',
        String(file.pages ?? 0),
        fileStatusText[file.status] ?? file.status
      ])
    )
  }

  note(
    '参考得分非官方口径：三级指标采用维度内等权,排除项按策略不计分并把其余指标权重等比放大到 100；缺失项以中性值参与三口径区间。分数只作申报前自查,不能作为对外承诺。报告由本地规则引擎生成,AI 未参与打分与文案。'
  )

  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    const bottomMargin = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const y = doc.page.height - 34
    doc
      .fontSize(7.6)
      .fillColor(COLORS.light)
      .text('参考得分非官方口径 · 仅供申报前自查', MARGIN, y, {
        width: CONTENT_WIDTH - 70,
        lineBreak: false
      })
    doc
      .fontSize(7.6)
      .fillColor(COLORS.light)
      .text(`第 ${index + 1} / ${range.count} 页`, MARGIN + CONTENT_WIDTH - 70, y, {
        width: 70,
        align: 'right',
        lineBreak: false
      })
    doc.page.margins.bottom = bottomMargin
  }

  doc.end()
  return completed
}
