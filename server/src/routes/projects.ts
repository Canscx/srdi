import { Router } from 'express'
import type {
  CreateProjectRequest,
  CreateProjectResponse,
  ProjectListResponse
} from '@srdi/shared'
import { badRequest } from '../errors'
import { loadBenchmarksVersion } from '../config/benchmarks'
import type { AppStore } from '../store'

const parseCreate = (body: unknown): CreateProjectRequest => {
  if (body === undefined || body === null) return {}
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('invalid_body', '请求体必须是 JSON 对象')
  }
  const raw = body as Record<string, unknown>
  const allowed = new Set(['name', 'level', 'period'])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw badRequest('invalid_body', `不认识的字段 ${key}`)
  }

  const input: CreateProjectRequest = {}
  if (raw.name !== undefined) {
    if (typeof raw.name !== 'string') throw badRequest('invalid_name', '项目名称必须是字符串')
    input.name = raw.name
  }
  if (raw.level !== undefined) {
    if (raw.level !== 'SRDI' && raw.level !== 'LITTLE_GIANT') {
      throw badRequest('invalid_level', '等级只能是 SRDI 或 LITTLE_GIANT')
    }
    input.level = raw.level
  }
  if (raw.period !== undefined) {
    if (typeof raw.period !== 'object' || raw.period === null || Array.isArray(raw.period)) {
      throw badRequest('invalid_period', 'period 必须是对象')
    }
    const periodRaw = raw.period as Record<string, unknown>
    const period: Record<string, number> = {}
    for (const key of ['y0', 'y1', 'y2'] as const) {
      const value = periodRaw[key]
      if (value === undefined) continue
      if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw badRequest('invalid_period', '统计年度必须是整数')
      }
      period[key] = value
    }
    input.period = period
  }
  return input
}

const parseRename = (body: unknown): string => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw badRequest('invalid_body', '请求体必须是 JSON 对象')
  }
  const raw = body as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (key !== 'name') throw badRequest('invalid_body', `不认识的字段 ${key}`)
  }
  if (typeof raw.name !== 'string') throw badRequest('invalid_name', '项目名称必须是字符串')
  return raw.name
}

export const projectsRouter = (store: AppStore) => {
  const router = Router()
  const benchmarksVersion = loadBenchmarksVersion()

  router.post('/projects', async (req, res) => {
    const input = parseCreate(req.body)
    const project = await store.projects.create(input, benchmarksVersion)
    await store.evidence.get(project)
    const payload: CreateProjectResponse = { projectId: project.projectId, project }
    res.status(201).json(payload)
  })

  router.get('/projects', async (_req, res) => {
    const projects = await store.projects.list()
    const payload: ProjectListResponse = { projects }
    res.json(payload)
  })

  router.get('/projects/:projectId', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const payload: CreateProjectResponse = { projectId: project.projectId, project }
    res.json(payload)
  })

  router.patch('/projects/:projectId', async (req, res) => {
    const name = parseRename(req.body)
    const project = await store.projects.rename(req.params.projectId, name)
    const payload: CreateProjectResponse = { projectId: project.projectId, project }
    res.json(payload)
  })

  return router
}
