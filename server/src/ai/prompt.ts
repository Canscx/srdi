import { createHash } from 'node:crypto'
import type { DocType, PeriodWindow } from '@srdi/shared'
import { catalogFields, type CatalogField } from '../config/catalog'
import type { ModelMessage, ModelPart } from './client'

export const AI_PROMPT_VERSION = 'p1'

export const AI_MAX_PAGES_PER_CHUNK = 6
export const AI_MAX_CHARS_PER_CHUNK = 12000
export const AI_MAX_IMAGES_PER_CHUNK = 4

export const DOC_TYPE_VALUES: DocType[] = [
  'audit',
  'application',
  'tax',
  'patent',
  'cert',
  'standard',
  'finance',
  'other'
]

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  audit: '审计报告',
  application: '申报书',
  tax: '纳税证明',
  patent: '专利清单',
  cert: '证书资质',
  standard: '标准文本',
  finance: '财务报表',
  other: '其他'
}

interface SubsetRule {
  prefixes: string[]
  keys: string[]
}

const SUBSET_RULES: Record<DocType, SubsetRule> = {
  audit: { prefixes: ['fin.'], keys: [] },
  finance: { prefixes: ['fin.'], keys: [] },
  tax: {
    prefixes: [],
    keys: ['company.creditCode', 'fin.revenue', 'fin.netProfit', 'fin.rdExpense']
  },
  patent: { prefixes: ['ip.'], keys: [] },
  cert: {
    prefixes: ['qual.'],
    keys: ['company.name', 'company.creditCode', 'company.scitechSmeTitle']
  },
  standard: { prefixes: ['std.'], keys: [] },
  application: {
    prefixes: ['company.', 'hr.'],
    keys: [
      'fin.revenue',
      'fin.mainBusinessRevenue',
      'fin.netAssets',
      'fin.assetLiabilityRatio',
      'fin.rdExpense',
      'fin.equityInvested',
      'qual.digitalTransformation',
      'qual.marketRanking'
    ]
  },
  other: { prefixes: [], keys: ['company.name', 'company.creditCode', 'company.industryCode'] }
}

export const fieldSubset = (docType: DocType): CatalogField[] => {
  const rule = SUBSET_RULES[docType] ?? SUBSET_RULES.other
  const wanted = new Set(rule.keys)
  const fields = catalogFields().filter(
    (field) =>
      wanted.has(field.key) || rule.prefixes.some((prefix) => field.key.startsWith(prefix))
  )
  return fields.length > 0 ? fields : catalogFields().filter((f) => f.key.startsWith('company.'))
}

export const fieldSubsetHash = (fields: CatalogField[]) =>
  createHash('sha256')
    .update(fields.map((field) => field.key).join('|'))
    .digest('hex')
    .slice(0, 16)

const TYPE_HINTS: Record<string, string> = {
  money: '金额(元)',
  percent: '百分数',
  ratio: '比率(小数)',
  int: '整数',
  bool: '是/否',
  enum: '枚举值',
  list: '数组',
  text: '文本',
  date: '日期'
}

const IRON_RULES = `你是企业申报材料的抄录员。唯一任务是把页面上出现的数字与文字原样定位并抄录,不做任何判断。

铁律:
1. 只抄录页面上明确存在的内容。不推断、不计算、不换算汇率、不用常识补全、不用往年数据推算本年。
2. 页面上找不到就 found=false。找不到时不要编造 value/page/quote,也不要用相似字段顶替。
3. 每条命中结果必须带 page 与 quote。quote 必须是该页原文的连续片段(含数字与单位,逐字照抄),不得改写、概括、翻译或拼接。
4. value 一律按下方字段表的单位填写:金额填元,比率填小数(页面写 52.3% 就填 0.523),人数填人,年限填年。raw 保留页面原文写法(含万元、亿元、% 等)。
5. 同一数字存在多个口径时(合并/母公司、本期/上期、含税/不含税),只抄录与 period 对应的本期数;无法区分口径就放弃该字段。
6. 只输出一个 JSON 对象。不要 Markdown 代码块,不要解释文字,不要注释,不要多余前后缀。`

const buildFieldTable = (fields: CatalogField[]) => {
  const header = 'key\t名称\t类型\t单位\t按年\t可取值'
  const rows = fields.map((field) => {
    const unit = field.unit ?? '-'
    const periodic = field.periodic ? '是' : '否'
    const enumText = field.enumValues?.length ? field.enumValues.join('|') : '-'
    const type = TYPE_HINTS[field.type] ?? field.type
    return `${field.key}\t${field.label}\t${type}\t${unit}\t${periodic}\t${enumText}`
  })
  return [header, ...rows].join('\n')
}

const OUTPUT_SHAPE = `{"pageRange":[3,7],"fields":[{"key":"fin.revenue","found":true,"period":2025,"value":132000000,"unit":"CNY","raw":"营业收入 132,000,000.00","page":5,"quote":"营业收入 132,000,000.00","confidence":0.96}],"documentMeta":{"docType":"audit","companyName":"某某科技有限公司","reportYear":2025},"unreadable":[{"page":9,"reason":"扫描模糊"}]}`

const EXAMPLES = `正例:页面第 5 页写「营业收入 132,000,000.00」,应输出 key=fin.revenue、period=2025、value=132000000、unit=CNY、raw="营业收入 132,000,000.00"、page=5、quote="营业收入 132,000,000.00"、confidence 0.9 以上。
反例一:页面只写「净利润较上年增长 12%」,不得据此算出本年净利润,该字段应 found=false。
反例二:页面只有「营业收入」,不得把该数字填给「主营业务收入」。
反例三:quote 不得写成「利润表第一行」这类描述,必须是原文片段。
反例四:页面写「研发费用 356.8 万元」,不得把 356.8 直接当元,应为 value=3568000、raw 保留「356.8 万元」。`

export const buildSystemPrompt = (fields: CatalogField[]): string => {
  const table = buildFieldTable(fields)
  return [
    IRON_RULES,
    '',
    `本次只允许抽取下列 ${fields.length} 个字段,不在列表内的 key 一律视为无效:`,
    table,
    '',
    '输出 JSON 形状:',
    OUTPUT_SHAPE,
    '',
    `documentMeta.docType 只能取 ${DOC_TYPE_VALUES.join(' / ')} 之一,取你认为最贴近的类别;companyName 与 reportYear 取页面上能确认的值,确认不了就省略该键。`,
    '',
    EXAMPLES
  ].join('\n')
}

export const buildTextBlock = (page: number, text: string) => `### p${page}\n${text}`

export interface ChunkLike {
  route: 'text' | 'vision'
  pages: number[]
  text: string
}

export const buildTextContent = (
  chunk: ChunkLike,
  period: PeriodWindow
): string => {
  const from = chunk.pages[0]
  const to = chunk.pages[chunk.pages.length - 1]
  const span = from === to ? `第 ${from} 页` : `第 ${from}–${to} 页`
  return [
    chunk.text,
    '',
    `本块为${span}(共 ${chunk.pages.length} 页)。统计年度窗口为 ${period.y2}–${period.y0}。`,
    `只返回这些页面中命中的字段;pageRange 填 [${from},${to}];page 必须落在本块页号内。`
  ].join('\n')
}

export const buildVisionContent = (
  pages: number[],
  images: { page: number; mime: string; data: string }[],
  period: PeriodWindow
): ModelPart[] => {
  const from = pages[0]
  const to = pages[pages.length - 1]
  const span = from === to ? `第 ${from} 页` : `第 ${from}–${to} 页`
  const parts: ModelPart[] = []
  for (const image of images) {
    parts.push({ type: 'text', text: `第 ${image.page} 页:` })
    parts.push({ type: 'image', mime: image.mime, data: image.data })
  }
  parts.push({
    type: 'text',
    text: [
      `以上为${span}的页面图像(共 ${pages.length} 页)。`,
      `忽略透视畸变、印章与水印干扰,只读取清晰可辨的数字与文字;模糊不可辨的内容写进 unreadable,不要猜。`,
      `统计年度窗口为 ${period.y2}–${period.y0}。只返回这些页面中命中的字段;pageRange 填 [${from},${to}];page 必须落在本块页号内。`
    ].join('\n')
  })
  return parts
}

export const buildRepairInstruction = () =>
  '上面的输出不是合法 JSON。只输出修正后的 JSON 对象,不要任何解释,不要 Markdown 代码块。'

export const buildSchemaRetryInstruction = (errors: string[], badKeys: string[]) => {
  const scope = badKeys.length
    ? `只需重新输出这些字段:${badKeys.join(', ')};其余字段忽略。`
    : '请重新输出完整对象。'
  return [
    '上面的 JSON 结构不合法,校验错误如下:',
    ...errors.slice(0, 8).map((error) => `- ${error}`),
    scope,
    '仍使用同一个 JSON 形状,只输出 JSON。'
  ].join('\n')
}

export const buildMessages = (
  system: string,
  user: string | ModelPart[]
): ModelMessage[] => [
  { role: 'system', content: system },
  { role: 'user', content: user }
]
