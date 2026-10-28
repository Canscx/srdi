import { readFile } from 'node:fs/promises'
import mammoth from 'mammoth'
import type { PageBlock, PageTable, ParsedFile } from '@srdi/shared'
import { garbledRatio, printableLength } from './text'

const decodeEntities = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCharCode(Number(code)))

const stripTags = (html: string) =>
  decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()

export const tableToPipeText = (html: string): PageTable => {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((match) =>
      [...match[1].matchAll(/<(td|th)[^>]*>([\s\S]*?)<\/\1>/gi)].map((cell) =>
        stripTags(cell[2])
      )
    )
    .filter((row) => row.length > 0)

  const cols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  return {
    index: 0,
    rows: rows.length,
    cols,
    text: rows.map((row) => row.join(' | ')).join('\n')
  }
}

const htmlToBlocks = (html: string) => {
  const blocks: PageBlock[] = []
  const tables: PageTable[] = []
  const pattern = /<(h[1-6]|p|li|table)[^>]*>([\s\S]*?)<\/\1>/gi

  for (const match of html.matchAll(pattern)) {
    const tag = match[1].toLowerCase()
    const body = match[2]

    if (tag === 'table') {
      const table = tableToPipeText(body)
      table.index = tables.length
      tables.push(table)
      if (table.text) blocks.push({ type: 'table', text: table.text })
      continue
    }

    const text = stripTags(body)
    if (!text) continue

    if (tag.startsWith('h')) {
      blocks.push({ type: 'heading', level: Number(tag.slice(1)), text })
      continue
    }
    if (tag === 'li') {
      blocks.push({ type: 'list', text })
      continue
    }
    blocks.push({ type: 'paragraph', text })
  }

  return { blocks, tables }
}

export interface DocxParseOptions {
  filePath: string
  fileId: string
}

export const parseDocx = async (options: DocxParseOptions): Promise<ParsedFile> => {
  const buffer = await readFile(options.filePath)
  const result = await mammoth.convertToHtml({ buffer })
  const { blocks, tables } = htmlToBlocks(result.value)
  const text = blocks.map((block) => block.text).filter(Boolean).join('\n')
  const printableChars = printableLength(text)
  const unreadable = printableChars === 0 ? [{ page: 1, reason: '未提取到文字' }] : []

  return {
    pages: [
      {
        fileId: options.fileId,
        page: 1,
        route: 'text',
        width: 0,
        height: 0,
        text,
        blocks,
        tables,
        printableChars,
        hasGlyphs: printableChars > 0,
        garbledRatio: garbledRatio(text)
      }
    ],
    totalPages: 1,
    truncated: false,
    unreadable
  }
}
