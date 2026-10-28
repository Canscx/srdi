import { createHash } from 'node:crypto'
import path from 'node:path'
import type {
  DocType,
  EvidenceFileRef,
  FieldCandidate,
  FilePages,
  JobStage,
  ProjectFile
} from '@srdi/shared'
import { badRequest } from '../errors'
import type { AppStore } from '../store'
import { readJson } from '../store/atomic'
import { createBudget } from './budget'
import { createExtractionCache, extractionCacheKey, type CachedExtraction } from './cache'
import type { ModelClient } from './client'
import { dispatchFile } from './dispatch'
import { AI_PROMPT_VERSION, fieldSubset, fieldSubsetHash } from './prompt'
import type { ValidatedField } from './validate'

export interface ExtractProgress {
  stage?: JobStage
  fileId?: string
  page?: number
  total?: number
  pct: number
  message?: string
}

export type ExtractReporter = (update: ExtractProgress) => void

export interface ExtractOptions {
  client: ModelClient
  model: string
}

export interface ExtractOutcome {
  files: number
  cached: number
  candidates: number
  chunks: { total: number; failed: number }
  tokens: { prompt: number; completion: number; total: number }
  docTypes: Record<string, DocType>
  warnings: string[]
  budgetExhausted: boolean
}

const candidateId = (parts: (string | number)[]) =>
  `c_${createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)}`

const toCandidate = (field: ValidatedField, file: ProjectFile, model: string): FieldCandidate => ({
  candidateId: candidateId([
    field.key,
    file.fileId,
    field.page,
    field.raw,
    typeof field.value === 'object' ? JSON.stringify(field.value) : String(field.value)
  ]),
  value: field.value,
  unit: field.unit,
  period: field.period,
  raw: field.raw,
  confidence: field.confidence,
  source: {
    fileId: file.fileId,
    fileName: file.name,
    page: field.page,
    route: field.route,
    quote: field.quote,
    quoteMatched: field.quoteMatched,
    extractor: `ai:${model}:${AI_PROMPT_VERSION}`,
    confidence: field.confidence
  }
})

const fileRef = (file: ProjectFile): EvidenceFileRef => ({
  fileId: file.fileId,
  name: file.name,
  sha256: file.sha256,
  pages: file.pages,
  docType: file.docType,
  route: file.route ?? 'text',
  status: file.status,
  truncated: file.truncated,
  visionSkipped: file.visionSkipped,
  unreadable: file.unreadable
})

export const extractProject = async (
  store: AppStore,
  projectId: string,
  report: ExtractReporter,
  options: ExtractOptions
): Promise<ExtractOutcome> => {
  const project = await store.projects.get(projectId)
  const projectDir = store.projects.dir(projectId)
  const files = project.files.filter((file) => file.status === 'parsed')
  if (files.length === 0) {
    throw badRequest('not_parsed', '没有已解析的文件,请先解析材料', '解析完成后再抽取字段')
  }

  const budget = await createBudget(projectDir)
  const cache = createExtractionCache(projectDir)
  const outcome: ExtractOutcome = {
    files: 0,
    cached: 0,
    candidates: 0,
    chunks: { total: 0, failed: 0 },
    tokens: { prompt: 0, completion: 0, total: 0 },
    docTypes: {},
    warnings: [],
    budgetExhausted: false
  }
  const collected = new Map<string, FieldCandidate[]>()

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    const basePct = (index / files.length) * 100
    report({
      stage: 'extracting',
      fileId: file.fileId,
      pct: Math.round(basePct),
      message: `抽取 ${file.name}`
    })

    const filePages = await readJson<FilePages>(
      path.join(projectDir, 'pages', `${file.fileId}.json`)
    )
    if (!filePages || filePages.pages.length === 0) {
      outcome.warnings.push(`${file.name}:缺少页数据,已跳过`)
      continue
    }

    const heuristic = file.docType ?? 'other'
    const subsetHash = fieldSubsetHash(fieldSubset(heuristic))
    const key = extractionCacheKey({
      sha256: file.sha256,
      promptVersion: AI_PROMPT_VERSION,
      model: options.model,
      subsetHash
    })

    let fields: ValidatedField[] = []
    let unreadable: { page: number; reason: string }[] = []
    let docType: DocType = heuristic
    const cached = await cache.read(key)

    if (cached) {
      fields = cached.fields
      unreadable = cached.unreadable
      docType = cached.docType
      outcome.cached += 1
      report({
        stage: 'extracting',
        fileId: file.fileId,
        pct: Math.round(((index + 1) / files.length) * 100),
        message: `${file.name} 命中缓存`
      })
    } else {
      if (budget.exhausted()) {
        outcome.budgetExhausted = true
        outcome.warnings.push(`${file.name}:token 预算已用尽,未抽取`)
        continue
      }
      const dispatched = await dispatchFile({
        client: options.client,
        model: options.model,
        budget,
        projectDir,
        period: project.period,
        docType: heuristic,
        filePages,
        onProgress: (progress) => {
          report({
            stage: 'extracting',
            fileId: file.fileId,
            page: progress.page,
            total: progress.total,
            pct: Math.round(basePct + (progress.pct / 100) * (100 / files.length)),
            message: `${file.name} ${progress.message ?? ''}`.trim()
          })
        }
      })
      fields = dispatched.fields
      unreadable = dispatched.unreadable
      docType = dispatched.docType
      outcome.chunks.total += dispatched.chunks.total
      outcome.chunks.failed += dispatched.chunks.failed
      outcome.tokens.prompt += dispatched.usage.promptTokens
      outcome.tokens.completion += dispatched.usage.completionTokens
      if (dispatched.budgetExhausted) outcome.budgetExhausted = true
      for (const failure of dispatched.failures) {
        const from = failure.pages[0]
        const to = failure.pages[failure.pages.length - 1]
        outcome.warnings.push(
          `${file.name}:第 ${from}${to === from ? '' : `–${to}`} 页识别失败(${failure.reason}),可手动补录`
        )
      }
      const clean = !dispatched.budgetExhausted && dispatched.chunks.failed === 0
      if (clean) {
        const entry: CachedExtraction = {
          key,
          promptVersion: AI_PROMPT_VERSION,
          model: options.model,
          subsetHash,
          sha256: file.sha256,
          docType,
          fields,
          unreadable,
          usage: {
            promptTokens: dispatched.usage.promptTokens,
            completionTokens: dispatched.usage.completionTokens
          },
          chunks: dispatched.chunks,
          flags: dispatched.flags,
          createdAt: new Date().toISOString()
        }
        await cache.write(entry)
      }
    }

    outcome.files += 1
    outcome.docTypes[file.fileId] = docType
    for (const item of unreadable) {
      outcome.warnings.push(`${file.name}:第 ${item.page} 页不可读(${item.reason})`)
    }

    if (docType !== file.docType) {
      await store.projects.update(projectId, (meta) => {
        const target = meta.files.find((item) => item.fileId === file.fileId)
        if (target) target.docType = docType
      })
    }

    const meta = await store.projects.get(projectId)
    const target = meta.files.find((item) => item.fileId === file.fileId)
    if (target) await store.evidence.syncFile(meta, fileRef(target))

    for (const field of fields) {
      const list = collected.get(field.key) ?? []
      list.push(toCandidate(field, file, options.model))
      collected.set(field.key, list)
    }

    await budget.save()
  }

  const meta = await store.projects.get(projectId)
  for (const [key, candidates] of collected) {
    try {
      await store.evidence.appendCandidates(meta, key, candidates)
      outcome.candidates += candidates.length
    } catch (err) {
      outcome.warnings.push(`字段 ${key} 写入失败:${(err as Error).message}`)
    }
  }

  outcome.tokens.total = outcome.tokens.prompt + outcome.tokens.completion
  await budget.save()

  return outcome
}
