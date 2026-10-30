import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  CreateProjectRequest,
  PeriodWindow,
  ProjectCompany,
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

const NAME_LIMIT = 80

const assertName = (value: string) => {
  const name = value.trim()
  if (name.length === 0) throw badRequest('invalid_name', '项目名称不能为空')
  if (name.length > NAME_LIMIT) {
    throw badRequest('invalid_name', `项目名称不超过 ${NAME_LIMIT} 个字符`)
  }
  return name
}

const normalizeName = (input?: string) => {
  const name = (input ?? '').trim()
  if (name.length === 0) return `未命名项目 ${new Date().toISOString().slice(0, 10)}`
  return assertName(name)
}

const CREDIT_CODE_PATTERN = /^[0-9A-Z]{18}$/

export const normalizeCompanyName = (value: string): string =>
  value
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s\u3000]/g, '')
    .replace(/[（）()【】\[\]]/g, '')
    .replace(/[·・•]/g, '')
    .toUpperCase()

const countOf = (value: number | undefined, label: string) => {
  if (value === undefined || value === null) return undefined
  if (!Number.isInteger(value) || value < 0 || value > 9999) {
    throw badRequest('invalid_company', `${label}需要 0 至 9999 之间的整数`)
  }
  return value
}

const normalizeCompany = (input: ProjectCompany): ProjectCompany => {
  const name = input.name?.trim() ?? ''
  if (name.length === 0) throw badRequest('invalid_company', '企业名称不能为空')
  if (name.length > NAME_LIMIT) {
    throw badRequest('invalid_company', `企业名称不超过 ${NAME_LIMIT} 个字符`)
  }
  const creditCode = (input.creditCode ?? '').trim().toUpperCase()
  if (creditCode && !CREDIT_CODE_PATTERN.test(creditCode)) {
    throw badRequest('invalid_company', '统一社会信用代码应为 18 位数字或大写字母')
  }
  const phoneRaw = input.phone?.replace(/[\s-]/g, '') ?? ''
  if (!phoneRaw) {
    throw badRequest('invalid_company', '请填写联系手机，用于换设备后找回报告')
  }
  if (!/^\d{6,20}$/.test(phoneRaw)) {
    throw badRequest('invalid_company', '联系电话应为 6 至 20 位数字')
  }
  return {
    name,
    creditCode,
    phone: phoneRaw,
    industryCode: input.industryCode?.trim().toUpperCase() || undefined,
    industryName: input.industryName?.trim() || undefined,
    inventionCount: countOf(input.inventionCount, '发明专利数量'),
    softCopyrightCount: countOf(input.softCopyrightCount, '软件著作权数量')
  }
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
  rename: (projectId: string, name: string) => Promise<ProjectMeta>
  findByCompanyName: (name: string) => Promise<ProjectSummary[]>
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
    const company = input.company ? normalizeCompany(input.company) : undefined
    const meta: ProjectMeta = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: `p_${shortId()}`,
      name: normalizeName(input.name ?? company?.name),
      level,
      rulesId: RULES_ID,
      benchmarksVersion,
      period: normalizePeriod(input.period),
      company,
      clientId: input.clientId,
      claims: input.clientId ? [input.clientId] : undefined,
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
        company: meta.company,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt
      })
    }
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  const findByCompanyName = async (name: string): Promise<ProjectSummary[]> => {
    const target = normalizeCompanyName(name)
    if (target.length === 0) return []
    const items = await list()
    return items.filter(
      (item) => normalizeCompanyName(item.company?.name ?? item.name) === target
    )
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

  const rename = (projectId: string, name: string): Promise<ProjectMeta> =>
    update(projectId, (meta) => {
      meta.name = assertName(name)
      return meta
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
    rename,
    findByCompanyName,
    addFile,
    removeFile,
    assertPageBudget
  }
}
