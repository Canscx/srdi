import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  CreateProjectRequest,
  PeriodWindow,
  ProjectFile,
  ProjectMeta,
  ProjectSummary
} from '@srdi/shared'
import { MAX_PROJECT_PAGES, PROJECT_SCHEMA_VERSION, RULES_ID } from '@srdi/shared'
import { badRequest, conflict, notFound } from '../errors'
import { ensureDir, listDir, readJson, writeJson } from './atomic'
import type { LockTable } from './lock'

const PROJECT_ID_PATTERN = /^p_[a-z0-9]{6,40}$/

const shortId = () => `${Date.now().toString(36)}${randomUUID().replace(/-/g, '').slice(0, 8)}`

export const newFileId = () => `f_${shortId()}`

export const assertProjectId = (projectId: string) => {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw badRequest('invalid_project_id', '项目编号格式不正确')
  }
}

const defaultPeriod = (): PeriodWindow => {
  const y0 = new Date().getFullYear() - 1
  return { y0, y1: y0 - 1, y2: y0 - 2 }
}

const normalizePeriod = (input?: Partial<PeriodWindow>): PeriodWindow => {
  const base = defaultPeriod()
  const period: PeriodWindow = {
    y0: input?.y0 ?? base.y0,
    y1: input?.y1 ?? base.y1,
    y2: input?.y2 ?? base.y2
  }
  for (const key of ['y0', 'y1', 'y2'] as const) {
    const year = period[key]
    if (!Number.isInteger(year) || year < 1990 || year > 2100) {
      throw badRequest('invalid_period', '统计年度必须是 1990 至 2100 之间的整数')
    }
  }
  if (!(period.y0 > period.y1 && period.y1 > period.y2)) {
    throw badRequest('invalid_period', '统计年度须按 y0 大于 y1 大于 y2 递减')
  }
  return period
}

const normalizeName = (input?: string) => {
  const name = (input ?? '').trim() || `未命名项目 ${new Date().toISOString().slice(0, 10)}`
  if (name.length > 80) throw badRequest('invalid_name', '项目名称不超过 80 个字符')
  return name
}

export interface AddFileResult {
  file: ProjectFile
  dup: boolean
}

export interface ProjectStore {
  root: string
  dir: (projectId: string) => string
  filesDir: (projectId: string) => string
  filePath: (projectId: string, file: ProjectFile) => string
  create: (input: CreateProjectRequest, benchmarksVersion?: string) => Promise<ProjectMeta>
  get: (projectId: string) => Promise<ProjectMeta>
  list: () => Promise<ProjectSummary[]>
  save: (meta: ProjectMeta) => Promise<void>
  update: <T>(projectId: string, mutate: (meta: ProjectMeta) => T | Promise<T>) => Promise<T>
  addFile: (projectId: string, file: ProjectFile) => Promise<AddFileResult>
  removeFile: (projectId: string, fileId: string) => Promise<ProjectFile>
  assertPageBudget: (projectId: string, incoming: number, excludeFileId?: string) => Promise<void>
}

export const createProjectStore = (dataDir: string, lock: LockTable): ProjectStore => {
  const root = path.join(dataDir, 'projects')

  const dir = (projectId: string) => {
    assertProjectId(projectId)
    return path.join(root, projectId)
  }

  const filesDir = (projectId: string) => path.join(dir(projectId), 'files')

  const filePath = (projectId: string, file: ProjectFile) =>
    path.join(filesDir(projectId), `${file.fileId}.${file.ext}`)

  const save = async (meta: ProjectMeta) => {
    await writeJson(path.join(dir(meta.projectId), 'project.json'), meta)
  }

  const get = async (projectId: string): Promise<ProjectMeta> => {
    const meta = await readJson<ProjectMeta>(path.join(dir(projectId), 'project.json'))
    if (!meta) throw notFound('project_not_found', '项目不存在或已被删除')
    return meta
  }

  const create = async (
    input: CreateProjectRequest,
    benchmarksVersion?: string
  ): Promise<ProjectMeta> => {
    const level = input.level ?? 'SRDI'
    if (level !== 'SRDI') {
      throw badRequest(
        'level_not_supported',
        '当前仅支持专精特新中小企业规则包',
        '小巨人规则包计划在第三阶段提供'
      )
    }
    const now = new Date().toISOString()
    const meta: ProjectMeta = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: `p_${shortId()}`,
      name: normalizeName(input.name),
      level,
      rulesId: RULES_ID,
      benchmarksVersion,
      period: normalizePeriod(input.period),
      createdAt: now,
      updatedAt: now,
      files: []
    }
    await ensureDir(filesDir(meta.projectId))
    await save(meta)
    return meta
  }

  const list = async (): Promise<ProjectSummary[]> => {
    const names = await listDir(root)
    const items: ProjectSummary[] = []
    for (const name of names) {
      if (!PROJECT_ID_PATTERN.test(name)) continue
      const meta = await readJson<ProjectMeta>(path.join(root, name, 'project.json'))
      if (!meta) continue
      items.push({
        projectId: meta.projectId,
        name: meta.name,
        level: meta.level,
        period: meta.period,
        files: meta.files.length,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt
      })
    }
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  const update = async <T>(
    projectId: string,
    mutate: (meta: ProjectMeta) => T | Promise<T>
  ): Promise<T> =>
    lock(`project:${projectId}`, async () => {
      const meta = await get(projectId)
      const result = await mutate(meta)
      meta.updatedAt = new Date().toISOString()
      await save(meta)
      return result
    })

  const addFile = async (projectId: string, file: ProjectFile): Promise<AddFileResult> =>
    update(projectId, (meta) => {
      const existing = meta.files.find((item) => item.sha256 === file.sha256)
      if (existing) return { file: existing, dup: true }
      meta.files.push(file)
      return { file, dup: false }
    })

  const removeFile = async (projectId: string, fileId: string): Promise<ProjectFile> =>
    update(projectId, (meta) => {
      const index = meta.files.findIndex((item) => item.fileId === fileId)
      if (index < 0) throw notFound('file_not_found', '文件不存在')
      const [removed] = meta.files.splice(index, 1)
      return removed
    })

  const assertPageBudget = async (
    projectId: string,
    incoming: number,
    excludeFileId?: string
  ) => {
    const meta = await get(projectId)
    const used = meta.files.reduce(
      (sum, file) => (file.fileId === excludeFileId ? sum : sum + (file.pages ?? 0)),
      0
    )
    if (used + incoming > MAX_PROJECT_PAGES) {
      throw conflict(
        'page_budget_exceeded',
        `项目页数上限 ${MAX_PROJECT_PAGES} 页,其余文件已用 ${used} 页,本次新增 ${incoming} 页`,
        '请拆分项目或删除部分文件后重试'
      )
    }
  }

  return {
    root,
    dir,
    filesDir,
    filePath,
    create,
    get,
    list,
    save,
    update,
    addFile,
    removeFile,
    assertPageBudget
  }
}
