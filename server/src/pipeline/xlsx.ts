import { readFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import { MAX_FILE_PAGES } from '@srdi/shared'
import type { PageBlock, PageDoc, ParsedFile } from '@srdi/shared'
import { garbledRatio, printableLength } from './text'

export interface XlsxParseOptions {
  filePath: string
  fileId: string
}

const normalizeRows = (rows: unknown[][]) =>
  rows
    .map((row) => row.map((cell) => String(cell ?? '').trim()))
    .filter((row) => row.some((cell) => cell.length > 0))
    .map((row) => {
      const trimmed = [...row]
      while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop()
      return trimmed
    })

export const parseXlsx = async (options: XlsxParseOptions): Promise<ParsedFile> => {
  const workbook = XLSX.read(await readFile(options.filePath), {
    type: 'buffer',
    cellDates: true,
    cellFormula: true
  })

  const names = workbook.SheetNames.slice(0, MAX_FILE_PAGES)
  const pages: PageDoc[] = []
  const unreadable: ParsedFile['unreadable'] = []

  names.forEach((name, index) => {
    const sheet = workbook.Sheets[name]
    const rows = sheet
      ? normalizeRows(
          XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '' })
        )
      : []

    const tableText = rows.map((row) => row.join(' | ')).join('\n')
    const text = rows.length > 0 ? `## ${name}\n${tableText}` : `## ${name}`
    const printableChars = printableLength(text)
    const blocks: PageBlock[] = [{ type: 'heading', level: 2, text: name }]
    if (tableText) blocks.push({ type: 'table', text: tableText })
    if (rows.length === 0) unreadable.push({ page: index + 1, reason: `工作表 ${name} 为空` })

    pages.push({
      fileId: options.fileId,
      page: index + 1,
      route: 'text',
      width: 0,
      height: 0,
      text,
      blocks,
      tables: tableText
        ? [
            {
              index: 0,
              rows: rows.length,
              cols: rows.reduce((max, row) => Math.max(max, row.length), 0),
              text: tableText
            }
          ]
        : [],
      printableChars,
      hasGlyphs: printableChars > 0,
      garbledRatio: garbledRatio(text)
    })
  })

  return {
    pages,
    totalPages: workbook.SheetNames.length,
    truncated: workbook.SheetNames.length > MAX_FILE_PAGES,
    unreadable
  }
}
