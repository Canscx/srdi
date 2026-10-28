import { createRequire } from 'node:module'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { MAX_FILE_PAGES } from '@srdi/shared'
import type { PageDoc, ParsedFile } from '@srdi/shared'
import { ensureDir } from '../store/atomic'
import { analyzePage, isFinancialTableText, type PageAnalysis } from './text'
import { decidePageRoute, shouldForceVision } from './route'

interface PdfViewport {
  width: number
  height: number
}

interface PdfPageProxy {
  getViewport(params: { scale: number }): PdfViewport
  getTextContent(): Promise<{ items: unknown[] }>
  render(params: { canvasContext: unknown; canvas: unknown; viewport: PdfViewport }): {
    promise: Promise<void>
  }
  cleanup(): void
}

interface PdfDocumentProxy {
  numPages: number
  getPage(pageNumber: number): Promise<PdfPageProxy>
  cleanup(): void
}

interface PdfLoadingTask {
  promise: Promise<PdfDocumentProxy>
  destroy(): Promise<void>
}

const require = createRequire(import.meta.url)
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'))
const toUrl = (segment: string) => `${path.join(pdfjsRoot, segment).replace(/\\/g, '/')}/`

export interface RenderParams {
  scale: number
  maxLongEdge: number
  quality: number
}

export const renderParams = (tablePage: boolean): RenderParams =>
  tablePage
    ? { scale: 2.4, maxLongEdge: 2000, quality: 88 }
    : { scale: 2.0, maxLongEdge: 1600, quality: 82 }

export interface PdfParseOptions {
  filePath: string
  fileId: string
  imagesDir: string
  imagePrefix: string
  onOpen?: (totalPages: number) => Promise<void> | void
  onPage?: (page: number, total: number) => void
}

const openPdf = async (task: PdfLoadingTask): Promise<PdfDocumentProxy> => {
  try {
    return await task.promise
  } catch (err) {
    await task.destroy().catch(() => undefined)
    const message = (err as Error).message ?? ''
    const name = (err as { name?: string }).name ?? ''
    if (name === 'PasswordException' || /password/i.test(message)) {
      throw new Error('PDF 已加密,需要去掉密码后再上传')
    }
    throw new Error(`PDF 无法打开:${message}`)
  }
}

const renderPage = async (page: PdfPageProxy, target: RenderParams, outFile: string) => {
  const base = page.getViewport({ scale: 1 })
  const longest = Math.max(base.width, base.height)
  const scale = Math.min(target.scale, target.maxLongEdge / longest)
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: context, canvas, viewport }).promise
  await ensureDir(path.dirname(outFile))
  await writeFile(outFile, canvas.toBuffer('image/jpeg', target.quality))
  return { width: Math.round(base.width), height: Math.round(base.height) }
}

const emptyAnalysis = (): PageAnalysis => ({
  text: '',
  blocks: [],
  tables: [],
  printableChars: 0,
  hasGlyphs: false,
  garbledRatio: 0
})

export const parsePdf = async (options: PdfParseOptions): Promise<ParsedFile> => {
  const task = getDocument({
    data: new Uint8Array(await readFile(options.filePath)),
    useSystemFonts: true,
    standardFontDataUrl: toUrl('standard_fonts'),
    cMapUrl: toUrl('cmaps'),
    cMapPacked: true
  }) as unknown as PdfLoadingTask

  const doc = await openPdf(task)
  const totalPages = doc.numPages
  const limit = Math.min(totalPages, MAX_FILE_PAGES)
  const pages: PageDoc[] = []
  const unreadable: ParsedFile['unreadable'] = []
  let forceVision = false

  try {
    await options.onOpen?.(totalPages)
    for (let pageNumber = 1; pageNumber <= limit; pageNumber += 1) {
      options.onPage?.(pageNumber, limit)
      const pdfPage = await doc.getPage(pageNumber)

      let analysis = emptyAnalysis()
      if (!forceVision) {
        try {
          const content = await pdfPage.getTextContent()
          analysis = analyzePage(content.items)
        } catch (err) {
          unreadable.push({
            page: pageNumber,
            reason: `文本层读取失败:${(err as Error).message}`
          })
        }
      }

      const route = forceVision ? 'vision' : decidePageRoute(analysis)
      const tablePage = analysis.tables.length > 0 || isFinancialTableText(analysis.text)
      const imageName = `p${pageNumber}.jpg`
      const outFile = path.join(options.imagesDir, imageName)
      let size = { width: 0, height: 0 }

      try {
        size = await renderPage(pdfPage, renderParams(tablePage), outFile)
      } catch (err) {
        unreadable.push({ page: pageNumber, reason: `渲染失败:${(err as Error).message}` })
      }

      pages.push({
        fileId: options.fileId,
        page: pageNumber,
        route,
        width: size.width,
        height: size.height,
        text: analysis.text,
        blocks: analysis.blocks,
        tables: analysis.tables,
        printableChars: analysis.printableChars,
        hasGlyphs: analysis.hasGlyphs,
        garbledRatio: analysis.garbledRatio,
        image: `${options.imagePrefix}/${imageName}`
      })

      pdfPage.cleanup()

      if (!forceVision && pageNumber === 3 && shouldForceVision(totalPages, pages)) {
        forceVision = true
      }
    }
  } finally {
    doc.cleanup()
    await task.destroy()
  }

  return {
    pages,
    totalPages,
    truncated: totalPages > limit,
    unreadable
  }
}
