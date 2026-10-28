import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { DocType, FilePages, PageDoc, PeriodWindow } from '@srdi/shared'
import type { CatalogField } from '../config/catalog'
import { BudgetExhaustedError, type Budget } from './budget'
import type { ModelClient, ModelMessage, ModelPart, ModelUsage } from './client'
import {
  AI_MAX_CHARS_PER_CHUNK,
  AI_MAX_IMAGES_PER_CHUNK,
  AI_MAX_PAGES_PER_CHUNK,
  buildMessages,
  buildRepairInstruction,
  buildSchemaRetryInstruction,
  buildSystemPrompt,
  buildTextContent,
  buildTextBlock,
  buildVisionContent,
  fieldSubset,
  fieldSubsetHash
} from './prompt'
import {
  checkShape,
  parseExtractionText,
  readDocumentMeta,
  validateFields,
  type FieldDrop,
  type RawExtraction,
  type ValidatedField
} from './validate'

const TEXT_TIMEOUT_MS = 120_000
const VISION_TIMEOUT_MS = 180_000
const IMAGE_MIME = 'image/jpeg'

export interface Chunk {
  index: number
  route: 'text' | 'vision'
  pages: number[]
  text: string
  images: { page: number; file: string }[]
}

const pageText = (page: PageDoc) => {
  const extra = page.tables
    .filter((table) => table.text && !page.text.includes(table.text))
    .map((table) => `[表 ${table.index + 1}]\n${table.text}`)
  return [page.text, ...extra].join('\n\n').trim()
}

export const buildChunks = (filePages: FilePages, projectDir: string): Chunk[] => {
  const chunks: Chunk[] = []
  let bucket: PageDoc[] = []
  let chars = 0

  const flush = () => {
    if (bucket.length === 0) return
    const route = bucket[0].route
    chunks.push({
      index: chunks.length,
      route,
      pages: bucket.map((page) => page.page),
      text:
        route === 'text'
          ? bucket.map((page) => buildTextBlock(page.page, pageText(page))).join('\n\n')
          : '',
      images:
        route === 'vision'
          ? bucket
              .filter((page) => page.image)
              .map((page) => ({ page: page.page, file: path.join(projectDir, page.image as string) }))
          : []
    })
    bucket = []
    chars = 0
  }

  for (const page of filePages.pages) {
    if (page.route === 'vision' && !page.image) continue
    const content = page.route === 'text' ? pageText(page) : ''
    if (page.route === 'text' && content.length === 0) continue
    const cap = page.route === 'vision' ? AI_MAX_IMAGES_PER_CHUNK : AI_MAX_PAGES_PER_CHUNK
    const size = page.route === 'text' ? content.length : 1
    const overflow =
      bucket.length > 0 &&
      (bucket[0].route !== page.route ||
        bucket.length >= cap ||
        (page.route === 'text' && chars + size > AI_MAX_CHARS_PER_CHUNK))
    if (overflow) flush()
    bucket.push(page)
    chars += size
  }
  flush()

  return chunks.filter((chunk) => (chunk.route === 'text' ? chunk.text.length > 0 : chunk.images.length > 0))
}

export interface DispatchProgress {
  pct: number
  message: string
  page?: number
  total?: number
}

export interface DispatchOptions {
  client: ModelClient
  model: string
  budget: Budget
  projectDir: string
  period: PeriodWindow
  docType: DocType
  filePages: FilePages
  onProgress?: (progress: DispatchProgress) => void
}

export interface ChunkFailure {
  pages: number[]
  reason: string
}

export interface DispatchResult {
  docType: DocType
  fields: ValidatedField[]
  dropped: FieldDrop[]
  unreadable: { page: number; reason: string }[]
  usage: ModelUsage
  chunks: { total: number; failed: number }
  failures: ChunkFailure[]
  flags: Record<string, number>
  budgetExhausted: boolean
  docTypeCorrected: boolean
}

interface ChunkOutcome {
  ok: boolean
  reason?: string
  validated: ValidatedField[]
  dropped: FieldDrop[]
  notFound: number
  docType?: DocType
  reportYear?: number
  unreadable: { page: number; reason: string }[]
  usage: ModelUsage
}

const emptyUsage = (): ModelUsage => ({ promptTokens: 0, completionTokens: 0 })

const mergeExtraction = (first: RawExtraction, retry: RawExtraction, badKeys: string[]): RawExtraction => {
  if (badKeys.length === 0) return retry
  const retryKeys = new Set(retry.fields.map((field) => field.key))
  const kept = first.fields.filter((field) => !badKeys.includes(field.key) || !retryKeys.has(field.key))
  return {
    ...retry,
    pageRange: retry.pageRange ?? first.pageRange,
    documentMeta: retry.documentMeta ?? first.documentMeta,
    fields: [...kept, ...retry.fields.filter((field) => badKeys.includes(field.key))]
  }
}

export const dispatchFile = async (options: DispatchOptions): Promise<DispatchResult> => {
  const result: DispatchResult = {
    docType: options.docType,
    fields: [],
    dropped: [],
    unreadable: [],
    usage: emptyUsage(),
    chunks: { total: 0, failed: 0 },
    failures: [],
    flags: {},
    budgetExhausted: false,
    docTypeCorrected: false
  }

  const chunks = buildChunks(options.filePages, options.projectDir)
  result.chunks.total = chunks.length
  if (chunks.length === 0) return result

  const pageIndex = new Map(options.filePages.pages.map((page) => [page.page, page]))
  let fields = fieldSubset(result.docType)
  let subsetHash = fieldSubsetHash(fields)

  const absorb = (outcome: ChunkOutcome) => {
    result.usage.promptTokens += outcome.usage.promptTokens
    result.usage.completionTokens += outcome.usage.completionTokens
    if (!outcome.ok) {
      result.chunks.failed += 1
      return
    }
    for (const field of outcome.validated) {
      result.fields.push(field)
      for (const flag of field.flags) result.flags[flag] = (result.flags[flag] ?? 0) + 1
    }
    result.dropped.push(...outcome.dropped)
    for (const item of outcome.unreadable) result.unreadable.push(item)
  }

  const runChunk = async (chunk: Chunk, activeFields: CatalogField[]): Promise<ChunkOutcome> => {
    const outcome: ChunkOutcome = {
      ok: false,
      validated: [],
      dropped: [],
      notFound: 0,
      unreadable: [],
      usage: emptyUsage()
    }
    const timeoutMs = chunk.route === 'vision' ? VISION_TIMEOUT_MS : TEXT_TIMEOUT_MS

    const exec = async (messages: ModelMessage[]) => {
      if (options.budget.exhausted()) {
        throw new BudgetExhaustedError(options.budget.used(), options.budget.limit)
      }
      const response = await options.client.complete({
        model: options.model,
        messages,
        temperature: 0,
        json: true,
        timeoutMs
      })
      outcome.usage.promptTokens += response.usage.promptTokens
      outcome.usage.completionTokens += response.usage.completionTokens
      await options.budget.charge(response.usage.promptTokens, response.usage.completionTokens)
      return response.text
    }

    let userContent: string | ModelPart[]
    if (chunk.route === 'text') {
      userContent = buildTextContent(chunk, options.period)
    } else {
      const images: { page: number; mime: string; data: string }[] = []
      for (const image of chunk.images) {
        try {
          const bytes = await readFile(image.file)
          images.push({ page: image.page, mime: IMAGE_MIME, data: bytes.toString('base64') })
        } catch {
          outcome.unreadable.push({ page: image.page, reason: '页图缺失' })
        }
      }
      if (images.length === 0) {
        outcome.reason = '无可用页图'
        return outcome
      }
      userContent = buildVisionContent(chunk.pages, images, options.period)
    }

    const base = buildMessages(buildSystemPrompt(activeFields), userContent)
    let text = await exec(base)
    let parsed = parseExtractionText(text)

    if (!parsed) {
      text = await exec([
        ...base,
        { role: 'assistant', content: text.slice(0, 6000) },
        { role: 'user', content: buildRepairInstruction() }
      ])
      parsed = parseExtractionText(text)
    }
    if (!parsed) {
      outcome.reason = 'JSON 无法解析'
      return outcome
    }

    const shape = checkShape(parsed)
    if (!shape.ok) {
      const retryText = await exec([
        ...base,
        { role: 'assistant', content: text.slice(0, 6000) },
        { role: 'user', content: buildSchemaRetryInstruction(shape.errors, shape.badKeys) }
      ])
      const retry = parseExtractionText(retryText)
      if (retry) parsed = mergeExtraction(parsed, retry, shape.badKeys)
    }

    const meta = readDocumentMeta(parsed)
    outcome.docType = meta.docType
    outcome.reportYear = meta.reportYear

    const validated = validateFields(parsed.fields, {
      allowedKeys: new Set(activeFields.map((field) => field.key)),
      pages: new Map(chunk.pages.map((page) => [page, pageIndex.get(page)]).filter((entry) => entry[1]) as [number, PageDoc][]),
      period: options.period,
      reportYear: meta.reportYear
    })

    outcome.ok = true
    outcome.validated = validated.accepted
    outcome.dropped = validated.dropped
    outcome.notFound = validated.notFound
    for (const item of parsed.unreadable ?? []) {
      if (typeof item?.page === 'number' && chunk.pages.includes(item.page) && typeof item.reason === 'string') {
        outcome.unreadable.push({ page: item.page, reason: item.reason.slice(0, 120) })
      }
    }
    return outcome
  }

  const report = (chunk: Chunk, index: number) => {
    options.onProgress?.({
      pct: Math.round(((index + 1) / chunks.length) * 100),
      page: index + 1,
      total: chunks.length,
      message: `第 ${chunk.pages[0]}–${chunk.pages[chunk.pages.length - 1]} 页`
    })
  }

  try {
    const first = await runChunk(chunks[0], fields)
    report(chunks[0], 0)

    let chosen = first
    if (first.ok && first.docType && first.docType !== result.docType) {
      result.docType = first.docType
      result.docTypeCorrected = true
      const nextFields = fieldSubset(first.docType)
      const nextHash = fieldSubsetHash(nextFields)
      if (nextHash !== subsetHash) {
        fields = nextFields
        subsetHash = nextHash
        if (options.budget.exhausted()) {
          result.budgetExhausted = true
          result.flags.doc_type_correction_partial =
            (result.flags.doc_type_correction_partial ?? 0) + 1
        } else {
          try {
            const rerun = await runChunk(chunks[0], fields)
            if (rerun.ok) chosen = rerun
            else {
              result.flags.doc_type_correction_partial =
                (result.flags.doc_type_correction_partial ?? 0) + 1
            }
          } catch (err) {
            if (!(err instanceof BudgetExhaustedError)) throw err
            result.budgetExhausted = true
            result.flags.doc_type_correction_partial =
              (result.flags.doc_type_correction_partial ?? 0) + 1
          }
        }
      } else {
        fields = nextFields
        subsetHash = nextHash
      }
    }

    if (chosen !== first) {
      result.usage.promptTokens += first.usage.promptTokens
      result.usage.completionTokens += first.usage.completionTokens
    }
    absorb(chosen)

    for (let index = 1; index < chunks.length; index += 1) {
      if (options.budget.exhausted()) {
        result.budgetExhausted = true
        for (const chunk of chunks.slice(index)) {
          result.chunks.failed += 1
          result.failures.push({ pages: chunk.pages, reason: 'token 预算已用尽' })
        }
        break
      }
      const chunk = chunks[index]
      try {
        const outcome = await runChunk(chunk, fields)
        absorb(outcome)
        if (!outcome.ok) {
          result.failures.push({ pages: chunk.pages, reason: outcome.reason ?? '抽取失败' })
        }
        report(chunk, index)
      } catch (err) {
        if (err instanceof BudgetExhaustedError) {
          result.budgetExhausted = true
          for (const rest of chunks.slice(index)) {
            result.chunks.failed += 1
            result.failures.push({ pages: rest.pages, reason: 'token 预算已用尽' })
          }
          break
        }
        result.chunks.failed += 1
        result.failures.push({ pages: chunk.pages, reason: (err as Error).message })
      }
    }
  } catch (err) {
    if (err instanceof BudgetExhaustedError) {
      result.budgetExhausted = true
      result.chunks.failed += 1
      result.failures.push({ pages: chunks[0].pages, reason: 'token 预算已用尽' })
      return result
    }
    throw err
  }

  return result
}
