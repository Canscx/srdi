import path from 'node:path'
import { rm } from 'node:fs/promises'
import { MAX_FILE_PAGES } from '@srdi/shared'
import type {
  DocType,
  FilePages,
  JobStage,
  ParsedFile,
  ProjectFile,
  ProjectMeta
} from '@srdi/shared'
import type { AppStore } from '../store'
import { writeJson } from '../store/atomic'
import { parseDocx } from './docx'
import { parseImage } from './image'
import { parsePdf } from './pdf'
import { applyVisionCap, decideFileRoute } from './route'
import { parseXlsx } from './xlsx'

export interface ParseProgressUpdate {
  stage?: JobStage
  fileId?: string
  page?: number
  total?: number
  pct: number
  message?: string
}

export type ParseReporter = (update: ParseProgressUpdate) => void

export interface ParseOutcome {
  failures: string[]
  pages: number
}

const parseOne = async (
  store: AppStore,
  project: ProjectMeta,
  file: ProjectFile,
  docType: DocType | undefined,
  onPage: (page: number, total: number) => void
): Promise<FilePages> => {
  const projectDir = store.projects.dir(project.projectId)
  if (file.kind === 'pdf') {
    await rm(path.join(projectDir, 'pages', file.fileId), { recursive: true, force: true })
  }
  const parsed = await dispatchParse(store, project, file, onPage)
  await store.projects.assertPageBudget(project.projectId, parsed.pages.length, file.fileId)

  const visionSkipped = applyVisionCap(parsed.pages)
  const route = decideFileRoute(parsed.pages.map((page) => page.route))
  const result: FilePages = {
    fileId: file.fileId,
    name: file.name,
    kind: file.kind,
    route,
    pages: parsed.pages,
    truncated: parsed.truncated,
    visionSkipped,
    unreadable: parsed.unreadable,
    parsedAt: new Date().toISOString()
  }

  await writeJson(path.join(projectDir, 'pages', `${file.fileId}.json`), result)
  await store.projects.update(project.projectId, (meta) => {
    const target = meta.files.find((item) => item.fileId === file.fileId)
    if (!target) return
    target.pages = parsed.pages.length
    target.route = route
    target.status = 'parsed'
    target.truncated = parsed.truncated
    target.visionSkipped = visionSkipped
    target.unreadable = parsed.unreadable
    if (docType) target.docType = docType
  })
  await store.evidence.syncFile(project, {
    fileId: file.fileId,
    name: file.name,
    sha256: file.sha256,
    pages: parsed.pages.length,
    docType,
    route,
    status: 'parsed',
    truncated: parsed.truncated,
    visionSkipped,
    unreadable: parsed.unreadable
  })

  return result
}

const dispatchParse = async (
  store: AppStore,
  project: ProjectMeta,
  file: ProjectFile,
  onPage: (page: number, total: number) => void
): Promise<ParsedFile> => {
  const projectDir = store.projects.dir(project.projectId)
  const filePath = store.projects.filePath(project.projectId, file)

  if (file.kind === 'pdf') {
    return parsePdf({
      filePath,
      fileId: file.fileId,
      imagesDir: path.join(projectDir, 'pages', file.fileId),
      imagePrefix: `pages/${file.fileId}`,
      onPage,
      onOpen: async (totalPages) => {
        await store.projects.assertPageBudget(
          project.projectId,
          Math.min(totalPages, MAX_FILE_PAGES),
          file.fileId
        )
      }
    })
  }
  if (file.kind === 'docx') return parseDocx({ filePath, fileId: file.fileId })
  if (file.kind === 'xlsx') return parseXlsx({ filePath, fileId: file.fileId })
  return parseImage({ fileId: file.fileId, filePath, projectDir })
}

export const inferDocType = (fileName: string): DocType | undefined => {
  const name = fileName.toLowerCase()
  if (/审计|审字|财务报|报表/.test(name)) return 'audit'
  if (/专精特新|申请书|申报/.test(name)) return 'application'
  if (/纳税|完税|税/.test(name)) return 'tax'
  if (/专利|知识产权/.test(name)) return 'patent'
  if (/证书|认证|资质/.test(name)) return 'cert'
  if (/标准|国标|行标/.test(name)) return 'standard'
  if (/财务|利润|资产负债|现金流/.test(name)) return 'finance'
  return undefined
}

export const parseProject = async (
  store: AppStore,
  projectId: string,
  report: ParseReporter
): Promise<ParseOutcome> => {
  const project = await store.projects.get(projectId)
  const files = project.files
  if (files.length === 0) throw new Error('项目里没有可解析的文件')

  const failures: string[] = []
  let totalPages = 0

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]
    report({
      stage: 'parsing',
      fileId: file.fileId,
      page: 0,
      total: file.pages ?? 0,
      pct: Math.round((index / files.length) * 100),
      message: `解析 ${file.name}`
    })

    try {
      const result = await parseOne(store, project, file, inferDocType(file.name), (page, total) => {
        const inner = total > 0 ? Math.min(page, total) / total : 0
        report({
          stage: 'parsing',
          fileId: file.fileId,
          page,
          total,
          pct: Math.round(((index + inner) / files.length) * 100),
          message: `${file.name} 第 ${page}/${total} 页`
        })
      })
      totalPages += result.pages.length
      report({
        stage: 'parsing',
        fileId: file.fileId,
        page: result.pages.length,
        total: result.pages.length,
        pct: Math.round(((index + 1) / files.length) * 100),
        message: `${file.name} 已解析 ${result.pages.length} 页`
      })
    } catch (err) {
      failures.push(`${file.name}:${(err as Error).message}`)
      await store.projects.update(projectId, (meta) => {
        const target = meta.files.find((item) => item.fileId === file.fileId)
        if (target) target.status = 'failed'
      })
      report({
        stage: 'parsing',
        fileId: file.fileId,
        pct: Math.round(((index + 1) / files.length) * 100),
        message: `${file.name} 解析失败:${(err as Error).message}`
      })
    }
  }

  return { failures, pages: totalPages }
}
