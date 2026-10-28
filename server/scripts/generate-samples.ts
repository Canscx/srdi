import { readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import PDFDocument from 'pdfkit'
import * as XLSX from 'xlsx'
import type { EvidenceDoc } from '@srdi/shared'
import { resolveReportFont } from '../src/report/fonts'

const SAMPLES_ROOT = path.resolve(process.cwd(), '..', 'samples')
const CONTENT_WIDTH = 495

type Firm = {
  dir: string
  evidence: EvidenceDoc
  name: string
  industryName: string
  period: { y0: number; y1: number; y2: number }
}

const readFixture = (name: string): EvidenceDoc =>
  JSON.parse(
    readFileSync(path.resolve(process.cwd(), '..', 'shared', 'test', 'fixtures', `${name}.json`), 'utf8')
  ) as EvidenceDoc

const money = (value: number): string => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 })

const yearsOf = (firm: Firm): number[] => [firm.period.y0, firm.period.y1, firm.period.y2]

const valueOf = (firm: Firm, key: string): unknown => firm.evidence.fields[key]?.value

const seriesOf = (firm: Firm, key: string): Record<string, number> | null => {
  const value = valueOf(firm, key)
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, number>)
    : null
}

const listOf = (firm: Firm, key: string): unknown[] => {
  const value = valueOf(firm, key)
  return Array.isArray(value) ? value : []
}

const QUALITY_LABEL: Record<string, string> = {
  national_award: '国家级质量奖或质量管理能力卓越级',
  province_award: '省级质量奖或质量管理能力预防级',
  assurance: '质量管理能力保证级',
  iso9001: 'ISO9001 等体系认证或检验级',
  none: '无'
}

const DIGITAL_LABEL: Record<string, string> = {
  ministry_title: '部级智能工厂 / 5G 工厂 / 智能制造优秀场景',
  lianghua_90: '两化融合水平 ≥90 或通过贯标',
  province_digital: '省级数字化转型认定',
  city_digital: '市级数字化转型认定',
  scored: '仅完成数字化水平评测自测',
  none: '无'
}

const RD_LABEL: Record<string, string> = {
  national: '国家级实验室或研发中心',
  province: '省部级实验室或研发中心',
  self_built: '自建研发机构',
  none: '无'
}

const RANK_LABEL: Record<string, string> = {
  national_top3: '全国前三',
  province_top3: '省内前三',
  province_top5: '省内前五',
  province_top10: '省内前十',
  none: '未进入前列',
  unknown: '未能确认'
}

const enumText = (labels: Record<string, string>, key: string): string =>
  `${labels[key] ?? key}（${key}）`

const PDF_FOOTER = '演示样本 · 虚构数据 · 仅用于系统测试'

const createPdf = async (filePath: string, draw: (doc: PDFKit.PDFDocument) => void) => {
  const font = resolveReportFont()
  const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true })
  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const completed = new Promise<void>((resolve, reject) => {
    doc.on('end', () => resolve())
    doc.on('error', reject)
  })

  doc.registerFont('sample', font.path, font.family)
  doc.font('sample')
  draw(doc)

  const range = doc.bufferedPageRange()
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index)
    const bottomMargin = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const y = doc.page.height - 34
    doc
      .fontSize(7.5)
      .fillColor('#9aa5b5')
      .text(PDF_FOOTER, 50, y, { width: CONTENT_WIDTH - 60, lineBreak: false })
    doc.text(`第 ${index + 1} / ${range.count} 页`, 50 + CONTENT_WIDTH - 60, y, {
      width: 60,
      align: 'right',
      lineBreak: false
    })
    doc.page.margins.bottom = bottomMargin
  }

  doc.end()
  await completed
  await writeFile(filePath, Buffer.concat(chunks))
}

const pdfHeading = (doc: PDFKit.PDFDocument, text: string) => {
  if (doc.y + 40 > doc.page.height - 70) doc.addPage()
  doc.y += 8
  doc.fontSize(11).fillColor('#1d4ed8').text(text, 50, doc.y, { width: CONTENT_WIDTH })
  doc.y += 3
}

const pdfPara = (doc: PDFKit.PDFDocument, text: string) => {
  doc.fontSize(9).fillColor('#374151').text(text, 50, doc.y, { width: CONTENT_WIDTH, lineGap: 3 })
  doc.y += 4
}

const pdfTable = (
  doc: PDFKit.PDFDocument,
  headers: string[],
  rows: string[][],
  widths: number[],
  aligns?: ('left' | 'right')[]
) => {
  const alignOf = (index: number) => aligns?.[index] ?? (index === 0 ? 'left' : 'right')
  const total = widths.reduce((sum, item) => sum + item, 0)
  const scaled = widths.map((width) => (width * CONTENT_WIDTH) / total)
  const padX = 4
  const padY = 3.5
  const headerHeight = 20

  const drawHeader = () => {
    const y = doc.y
    doc.rect(50, y, CONTENT_WIDTH, headerHeight).fill('#f4f7fb')
    let x = 50
    doc.fontSize(8.4).fillColor('#6b7280')
    headers.forEach((header, index) => {
      doc.text(header, x + padX, y + 5.5, {
        width: scaled[index] - padX * 2,
        align: alignOf(index),
        lineBreak: false
      })
      x += scaled[index]
    })
    doc.y = y + headerHeight
  }

  if (doc.y + headerHeight + 30 > doc.page.height - 70) doc.addPage()
  drawHeader()

  rows.forEach((row, rowIndex) => {
    doc.fontSize(8.4)
    const heights = row.map((cell, index) =>
      doc.heightOfString(cell, { width: scaled[index] - padX * 2, lineGap: 1 })
    )
    const rowHeight = Math.max(...heights, 11) + padY * 2
    if (doc.y + rowHeight > doc.page.height - 70) {
      doc.addPage()
      drawHeader()
    }
    const y = doc.y
    if (rowIndex % 2 === 1) doc.rect(50, y, CONTENT_WIDTH, rowHeight).fill('#fbfcfe')
    let x = 50
    doc.fontSize(8.4).fillColor('#374151')
    row.forEach((cell, index) => {
      doc.text(cell, x + padX, y + padY, {
        width: scaled[index] - padX * 2,
        align: alignOf(index),
        lineGap: 1
      })
      x += scaled[index]
    })
    doc
      .moveTo(50, y + rowHeight)
      .lineTo(50 + CONTENT_WIDTH, y + rowHeight)
      .lineWidth(0.5)
      .strokeColor('#e6ebf2')
      .stroke()
    doc.y = y + rowHeight
  })

  doc.y += 8
}

const pdfHeader = (doc: PDFKit.PDFDocument, firm: Firm, title: string, subtitle: string) => {
  doc.fontSize(8).fillColor('#9aa5b5').text('演示样本 · 虚构企业', 50, 50, {
    width: CONTENT_WIDTH,
    lineBreak: false
  })
  doc.y = 66
  doc.fontSize(18).fillColor('#111827').text(firm.name, 50, doc.y, { width: CONTENT_WIDTH })
  doc.fontSize(12).fillColor('#2563eb').text(title, 50, doc.y, { width: CONTENT_WIDTH })
  doc.fontSize(9).fillColor('#6b7280').text(subtitle, 50, doc.y, { width: CONTENT_WIDTH })
  doc.y += 6
}

const docxEscape = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const docxParagraph = (text: string, bold = false): string =>
  `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${docxEscape(
    text
  )}</w:t></w:r></w:p>`

const docxCell = (text: string, width: number, bold = false): string =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>${docxParagraph(text, bold)}</w:tc>`

const docxTable = (rows: string[][], widths: number[]): string =>
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>` +
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="D9D9D9"/>`)
    .join('') +
  `</w:tblBorders></w:tblPr>` +
  rows
    .map(
      (row, rowIndex) =>
        `<w:tr>${row
          .map((cell, index) => docxCell(cell, widths[index] ?? 2400, rowIndex === 0))
          .join('')}</w:tr>`
    )
    .join('') +
  `</w:tbl>`

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const zipStore = (entries: { name: string; data: Buffer }[]): Buffer => {
  const chunks: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = entry.data
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    chunks.push(local, name, data)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(data.length, 20)
    header.writeUInt32LE(data.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    central.push(header, name)

    offset += 30 + name.length + data.length
  }

  const centralBuffer = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...chunks, centralBuffer, end])
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const docxBuffer = (body: string): Buffer => {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body>
</w:document>`
  return zipStore([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(document, 'utf8') }
  ])
}

const writeXlsx = (filePath: string, sheets: { name: string; rows: (string | number)[][] }[]) => {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name)
  }
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return writeFile(filePath, buffer)
}

const buildAuditPdf = async (firm: Firm, filePath: string) => {
  await createPdf(filePath, (doc) => {
    pdfHeader(doc, firm, '2025 年度财务报表审计报告', `审计期间：${firm.period.y2}—${firm.period.y0} · 单位：元`)

    pdfHeading(doc, '一、审计意见')
    pdfPara(
      doc,
      `我们审计了${firm.name}（以下简称“公司”）${firm.period.y2} 至 ${firm.period.y0} 年度的财务报表，包括资产负债表、利润表及相关附注。我们认为，上述财务报表在所有重大方面按照企业会计准则的规定编制，公允反映了公司的财务状况与经营成果。本文件为系统演示样本，数据为虚构。`
    )

    pdfHeading(doc, '二、利润表（单位：元）')
    const years = yearsOf(firm)
    const rows: [string, string][] = [
      ['营业收入', 'fin.revenue'],
      ['主营业务收入', 'fin.mainBusinessRevenue'],
      ['营业成本', 'fin.operatingCost'],
      ['产品销售成本', 'fin.productSalesCost'],
      ['销售费用', 'fin.salesExpense'],
      ['管理费用', 'fin.adminExpense'],
      ['利润总额', 'fin.totalProfit'],
      ['净利润', 'fin.netProfit'],
      ['研发费用', 'fin.rdExpense']
    ]
    const tableRows = rows
      .filter(([, key]) => seriesOf(firm, key))
      .map(([label, key]) => {
        const series = seriesOf(firm, key) as Record<string, number>
        return [label, ...years.map((year) => money(series[String(year)] ?? 0))]
      })
    pdfTable(doc, ['项目', ...years.map((year) => `${year} 年度`)], tableRows, [160, 112, 112, 112])

    pdfHeading(doc, '三、资产负债表摘要')
    const netAssets = seriesOf(firm, 'fin.netAssets')
    const ratio = valueOf(firm, 'fin.assetLiabilityRatio')
    const equity = valueOf(firm, 'fin.equityInvested')
    const summary: string[][] = []
    if (netAssets) {
      summary.push(['净资产', ...years.map((year) => money(netAssets[String(year)] ?? 0))])
    }
    if (typeof ratio === 'number') {
      summary.push([
        `资产负债率（${firm.period.y0} 年末）`,
        `${(ratio * 100).toFixed(2)}%`,
        '',
        ''
      ])
    }
    if (typeof equity === 'number') {
      summary.push([`实收资本（${firm.period.y0} 年末）`, money(equity), '', ''])
    }
    pdfTable(doc, ['项目', ...years.map((year) => `${year} 年末`)], summary, [160, 112, 112, 112])

    pdfHeading(doc, '四、附注')
    const employees = valueOf(firm, 'company.employeeYearAvg')
    if (typeof employees === 'number') {
      pdfPara(doc, `职工总数：${employees} 人。`)
    }
    pdfPara(doc, '本审计报告由系统生成，仅用于验证材料解析与字段抽取流程，不构成任何真实审计意见。')
  })
}

const buildApplicationDocx = async (firm: Firm, filePath: string) => {
  const rows: string[][] = [['项目', '内容']]
  const push = (label: string, key: string) => {
    const value = valueOf(firm, key)
    if (value === undefined || value === null || value === '') return
    rows.push([label, typeof value === 'boolean' ? (value ? '是' : '否') : String(value)])
  }

  push('企业名称', 'company.name')
  rows.push(['所属行业', `${firm.evidence.company?.industryCode ?? ''} ${firm.industryName}`.trim()])
  push('科技型中小企业', 'company.scitechSmeTitle')
  push('从事细分市场年限（年）', 'company.subMarketYears')
  push('职工总数（人）', 'company.employeeYearAvg')
  push('研发人员数（人）', 'hr.rdHeadcount')

  const columns = [firm.period.y0, firm.period.y1, firm.period.y2]
  const financial: [string, string][] = [
    ['营业收入（元）', 'fin.revenue'],
    ['主营业务收入（元）', 'fin.mainBusinessRevenue'],
    ['净利润（元）', 'fin.netProfit'],
    ['利润总额（元）', 'fin.totalProfit'],
    ['净资产（元）', 'fin.netAssets'],
    ['研发费用（元）', 'fin.rdExpense']
  ]
  const financeRows: string[][] = [['财务指标', ...columns.map((year) => `${year} 年度`)]]
  for (const [label, key] of financial) {
    const series = seriesOf(firm, key)
    if (!series) continue
    financeRows.push([label, ...columns.map((year) => money(series[String(year)] ?? 0))])
  }

  const body =
    docxParagraph(`${firm.name}`, true) +
    docxParagraph('专精特新中小企业认定申请书（演示样本）', true) +
    docxParagraph('本申请书为系统演示样本，企业名称与全部数据均为虚构，仅用于验证材料解析与字段抽取流程。') +
    docxParagraph('一、企业基本情况', true) +
    docxTable(rows, [3000, 5400]) +
    docxParagraph('二、近三年主要财务数据', true) +
    docxTable(financeRows, [2600, 1933, 1933, 1933]) +
    docxParagraph('三、企业简介', true) +
    docxParagraph(
      `${firm.name}专注于${firm.industryName}领域，围绕细分市场持续投入研发，已建立相对完整的研发、生产与质量管理体系。本段为占位文案，不包含可抽取的数据。`
    )

  await writeFile(filePath, docxBuffer(body))
}

const buildPatentXlsx = async (firm: Firm, filePath: string) => {
  const granted = (valueOf(firm, 'ip.inventionGrantedByYear') as
    | { year: number; count: number }[]
    | undefined) ?? []
  const ipc = (valueOf(firm, 'ip.ipcDistribution') as
    | { ipc: string; count: number }[]
    | undefined) ?? []
  const firstApplicant = valueOf(firm, 'ip.inventionFirstApplicant')
  const pct = valueOf(firm, 'ip.pctCount')

  const summary: (string | number)[][] = [['指标', '数值']]
  if (typeof firstApplicant === 'number') {
    summary.push(['第一专利权人授权发明专利总数', firstApplicant])
  }
  if (typeof pct === 'number') {
    summary.push(['PCT 专利数量', pct])
  }

  await writeXlsx(filePath, [
    {
      name: '授权发明专利',
      rows: [['年度', '授权数量'], ...granted.map((item) => [item.year, item.count])]
    },
    {
      name: 'IPC分布',
      rows: [['IPC 大类', '专利数量'], ...ipc.map((item) => [item.ipc, item.count])]
    },
    { name: '汇总', rows: summary }
  ])
}

const buildCertPdf = async (firm: Firm, filePath: string) => {
  await createPdf(filePath, (doc) => {
    pdfHeader(doc, firm, '资质与荣誉证书清单', '用于专精特新中小企业认定申报')

    pdfHeading(doc, '一、企业主体')
    const identity: string[][] = []
    identity.push(['企业名称', firm.name])
    const industryCode = firm.evidence.company?.industryCode
    if (industryCode) identity.push(['所属行业代码', industryCode])
    const creditCode = valueOf(firm, 'company.creditCode')
    if (typeof creditCode === 'string') identity.push(['统一社会信用代码', creditCode])
    pdfTable(doc, ['项目', '内容'], identity, [150, 345], ['left', 'left'])

    pdfHeading(doc, '二、资质与荣誉')
    const rows: string[][] = []
    const quality = valueOf(firm, 'qual.qualityAward')
    if (typeof quality === 'string') {
      rows.push(['质量管理体系认证', enumText(QUALITY_LABEL, quality)])
    }
    const productCert = valueOf(firm, 'qual.productCert')
    if (typeof productCert === 'boolean') {
      rows.push(['产品权威机构认证', productCert ? '是' : '否'])
    }
    const digital = valueOf(firm, 'qual.digitalTransformation')
    if (typeof digital === 'string') {
      rows.push(['数字化转型水平', enumText(DIGITAL_LABEL, digital)])
    }
    const green = listOf(firm, 'qual.greenTitles')
    if (green.length > 0) {
      rows.push(['绿色化标杆称号', green.map(String).join('、')])
    }
    const institution = valueOf(firm, 'qual.rdInstitution')
    if (typeof institution === 'string') {
      rows.push(['研发机构建设', enumText(RD_LABEL, institution)])
    }
    const ranking = valueOf(firm, 'qual.marketRanking')
    if (typeof ranking === 'string') {
      rows.push(['细分行业营业收入排名', enumText(RANK_LABEL, ranking)])
    }
    const award = valueOf(firm, 'qual.scienceAward')
    if (typeof award === 'boolean') {
      rows.push(['科技奖励', award ? '是' : '否'])
    }
    pdfTable(doc, ['项目', '认定情况'], rows, [150, 345], ['left', 'left'])

    pdfHeading(doc, '三、说明')
    pdfPara(
      doc,
      '以上证书与称号均为演示样本中的虚构信息，仅用于验证抽取与打分流程。实际申报时需附证书扫描件与有效页。'
    )
  })
}

const buildStandardXlsx = async (firm: Firm, filePath: string) => {
  const hostedIntl = listOf(firm, 'std.hostedIntl').map(String)
  const hostedNat = listOf(firm, 'std.hostedNatInd').map(String)
  const joinedIntl = listOf(firm, 'std.joinedIntl').map(String)
  const joinedNat = listOf(firm, 'std.joinedNatInd').map(String)

  const detail: (string | number)[][] = [['标准名称', '参与方式']]
  for (const name of hostedIntl) detail.push([name, '主持（国际）'])
  for (const name of hostedNat) detail.push([name, '主持（国家/行业）'])
  for (const name of joinedIntl) detail.push([name, '参与（国际）'])
  for (const name of joinedNat) detail.push([name, '参与（国家/行业）'])

  await writeXlsx(filePath, [
    { name: '标准清单', rows: detail },
    {
      name: '汇总',
      rows: [
        ['标准类型', '数量'],
        ['主持国际标准', hostedIntl.length],
        ['主持国家或行业标准', hostedNat.length],
        ['参与国际标准', joinedIntl.length],
        ['参与国家或行业标准', joinedNat.length]
      ]
    }
  ])
}

const buildFirm = async (fixture: string, dirName: string) => {
  const evidence = readFixture(fixture)
  const name = evidence.fields['company.name']?.value
  const firm: Firm = {
    dir: path.join(SAMPLES_ROOT, dirName),
    evidence,
    name: typeof name === 'string' ? name : '演示企业',
    industryName: evidence.company?.industryName ?? '专用设备制造业',
    period: evidence.period
  }

  await mkdir(firm.dir, { recursive: true })
  await buildAuditPdf(firm, path.join(firm.dir, '01-审计报告.pdf'))
  await buildApplicationDocx(firm, path.join(firm.dir, '02-专精特新申报书.docx'))
  await buildPatentXlsx(firm, path.join(firm.dir, '03-授权专利清单.xlsx'))
  await buildCertPdf(firm, path.join(firm.dir, '04-资质与荣誉证书.pdf'))
  await buildStandardXlsx(firm, path.join(firm.dir, '05-参与标准清单.xlsx'))
  return firm
}

const main = async () => {
  await mkdir(SAMPLES_ROOT, { recursive: true })
  const firms = [
    await buildFirm('firm-a', 'firm-a-nanjing'),
    await buildFirm('firm-b', 'firm-b-suzhou')
  ]
  for (const firm of firms) {
    console.log(`${firm.name} -> ${firm.dir}`)
  }
}

await main()
