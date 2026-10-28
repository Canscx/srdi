import type { PageBlock, PageTable } from '@srdi/shared'

export const TEXT_MIN_PRINTABLE = 30
export const GARBLED_RATIO_LIMIT = 0.15
export const LINE_Y_TOLERANCE = 0.35
export const COLUMN_TOLERANCE = 6
export const MIN_TABLE_COLUMNS = 3
export const MIN_TABLE_ROWS = 3

const FINANCIAL_KEYWORDS = ['资产负债表', '利润表', '现金流量表', '损益表']
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/

export interface TextItemPos {
  str: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
}

export interface TextLine {
  y: number
  items: TextItemPos[]
  text: string
  fontSize: number
}

export interface PageAnalysis {
  text: string
  blocks: PageBlock[]
  tables: PageTable[]
  printableChars: number
  hasGlyphs: boolean
  garbledRatio: number
}

export const printableLength = (text: string) => text.replace(/\s/g, '').length

export const garbledRatio = (text: string) => {
  const printable = printableLength(text)
  if (printable === 0) return 0
  const garbled = (text.match(/\uFFFD/g) ?? []).length
  return garbled / printable
}

export const isFinancialTableText = (text: string) =>
  FINANCIAL_KEYWORDS.some((keyword) => text.includes(keyword))

export const toPositionedItems = (raw: unknown[]): TextItemPos[] => {
  const items: TextItemPos[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as {
      str?: unknown
      transform?: unknown
      width?: unknown
      height?: unknown
    }
    if (typeof item.str !== 'string' || item.str.length === 0) continue
    if (!Array.isArray(item.transform) || item.transform.length < 6) continue
    const transform = item.transform.map((value) => Number(value))
    const [a, b, c, d, x, y] = transform
    if (![a, b, c, d, x, y].every((value) => Number.isFinite(value))) continue
    const width = Number(item.width)
    const height = Number(item.height)
    const fontSize = Math.hypot(b, d) || height || 10
    items.push({
      str: item.str,
      x,
      y,
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      fontSize
    })
  }
  return items
}

const joinLine = (items: TextItemPos[]) => {
  let text = ''
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (index > 0) {
      const previous = items[index - 1]
      const gap = item.x - (previous.x + previous.width)
      const threshold = Math.max(1.5, item.fontSize * 0.22)
      const latinBoundary =
        !CJK.test(previous.str.slice(-1)) && !CJK.test(item.str.slice(0, 1))
      if (gap > threshold && latinBoundary && !text.endsWith(' ') && !item.str.startsWith(' ')) {
        text += ' '
      }
    }
    text += item.str
  }
  return text.replace(/[ \t]+/g, ' ').trim()
}

export const groupLines = (items: TextItemPos[]): TextLine[] => {
  const sorted = [...items].sort((left, right) => {
    if (Math.abs(left.y - right.y) > 1) return right.y - left.y
    return left.x - right.x
  })

  const buckets: { y: number; items: TextItemPos[] }[] = []
  for (const item of sorted) {
    const last = buckets[buckets.length - 1]
    const tolerance = Math.max(2, item.fontSize * LINE_Y_TOLERANCE)
    if (last && Math.abs(last.y - item.y) <= tolerance) {
      last.items.push(item)
      last.y = (last.y * (last.items.length - 1) + item.y) / last.items.length
    } else {
      buckets.push({ y: item.y, items: [item] })
    }
  }

  return buckets.map((bucket) => {
    const ordered = bucket.items.sort((left, right) => left.x - right.x)
    const fontSize = ordered.reduce((sum, item) => sum + item.fontSize, 0) / ordered.length
    return { y: bucket.y, items: ordered, text: joinLine(ordered), fontSize }
  })
}

const buildTable = (lines: TextLine[]): PageTable | null => {
  if (lines.length < MIN_TABLE_ROWS) return null

  const counts = new Map<number, number>()
  for (const line of lines) {
    const seen = new Set<number>()
    for (const item of line.items) {
      const key = Math.round(item.x / COLUMN_TOLERANCE)
      if (seen.has(key)) continue
      seen.add(key)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  const threshold = Math.max(MIN_TABLE_ROWS, Math.ceil(lines.length * 0.6))
  const columns = [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .map(([key]) => key * COLUMN_TOLERANCE)
    .sort((left, right) => left - right)

  if (columns.length < MIN_TABLE_COLUMNS) return null

  const rows: string[][] = []
  for (const line of lines) {
    const cells = columns.map(() => '')
    for (const item of line.items) {
      let column = 0
      let distance = Number.POSITIVE_INFINITY
      for (let index = 0; index < columns.length; index += 1) {
        const current = Math.abs(item.x - columns[index])
        if (current < distance) {
          distance = current
          column = index
        }
      }
      if (distance > COLUMN_TOLERANCE * 2) continue
      cells[column] = cells[column] ? `${cells[column]} ${item.str}` : item.str
    }
    const row = cells.map((cell) => cell.trim())
    while (row.length > 0 && row[row.length - 1] === '') row.pop()
    if (row.length >= 2) rows.push(row)
  }

  if (rows.length < MIN_TABLE_ROWS) return null

  return {
    index: 0,
    rows: rows.length,
    cols: columns.length,
    text: rows.map((row) => row.join(' | ')).join('\n')
  }
}

const buildBlocks = (lines: TextLine[]): PageBlock[] => {
  if (lines.length === 0) return []
  const sizes = lines.map((line) => line.fontSize).sort((left, right) => left - right)
  const median = sizes[Math.floor(sizes.length / 2)] || 10
  const blocks: PageBlock[] = []

  for (const line of lines) {
    if (!line.text) continue
    const heading = line.fontSize >= median * 1.25 && line.text.length <= 40
    blocks.push({ type: heading ? 'heading' : 'paragraph', text: line.text })
  }

  return blocks
}

export const analyzePage = (rawItems: unknown[]): PageAnalysis => {
  const items = toPositionedItems(rawItems)
  const lines = groupLines(items)
  const text = lines.map((line) => line.text).filter(Boolean).join('\n')
  const table = buildTable(lines)
  const tables = table ? [table] : []
  const hasGlyphs = items.some((item) => item.width > 0 && item.str.trim().length > 0)

  return {
    text,
    blocks: buildBlocks(lines),
    tables,
    printableChars: printableLength(text),
    hasGlyphs,
    garbledRatio: garbledRatio(text)
  }
}
