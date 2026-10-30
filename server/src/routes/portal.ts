import { Router } from 'express'
import type {
  PortalConfig,
  PortalCreateRequest,
  PortalHistoryItem,
  PortalListResponse,
  PortalLookupRequest,
  PortalLookupResponse,
  ProjectMeta
} from '@srdi/shared'
import { MAX_FILE_BYTES } from '@srdi/shared'
import type { ModelClient } from '../ai/client'
import { authed } from '../auth/types'
import { loadPortalConfig } from '../config/portal'
import { notFound, badRequest } from '../errors'
import type { JobQueue } from '../jobs/queue'
import { canAccess, withClaim } from '../portal/access'
import { createRateLimiter } from '../portal/ratelimit'
import { loadPortalDetail } from '../portal/detail'
import { sendPortalPdf } from '../report/portal'
import type { AppStore } from '../store'
import { removeFile } from '../store/atomic'
import { storeUploadedFile } from './files'

export interface PortalRouterOptions {
  maxFileBytes?: number
  queue: JobQueue
  aiClient: ModelClient
  aiModel: () => string
}

const owned = async (
  store: AppStore,
  projectId: string,
  clientId: string | undefined
): Promise<ProjectMeta> => {
  const project = await store.projects.get(projectId)
  if (!canAccess(project, clientId)) {
    throw notFound('project_not_found', '项目不存在或不属于当前浏览器')
  }
  return project
}

const parseBody = (body: unknown): PortalCreateRequest => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('invalid_body', '请求体必须是 JSON 对象')
  }
  const raw = body as Record<string, unknown>
  const company = raw.company
  if (!company || typeof company !== 'object' || Array.isArray(company)) {
    throw badRequest('invalid_body', '缺少企业信息')
  }
  const period = raw.period
  return {
    company: company as PortalCreateRequest['company'],
    period:
      period && typeof period === 'object' && !Array.isArray(period)
        ? (period as PortalCreateRequest['period'])
        : undefined
  }
}

const historyOf = async (
  store: AppStore,
  meta: ProjectMeta,
  passLine: number
): Promise<PortalHistoryItem> => {
  const record = await store.scores.get(meta.projectId)
  return {
    projectId: meta.projectId,
    companyName: meta.company?.name ?? meta.name,
    creditCode: meta.company?.creditCode ?? '',
    official: record ? Number(record.result.totals.official.toFixed(2)) : null,
    passed: record ? record.result.totals.official >= passLine : null,
    submittedAt: meta.createdAt,
    period: meta.period,
    hasScore: Boolean(record)
  }
}

export const portalRouter = (store: AppStore, options: PortalRouterOptions) => {
  const router = Router()
  const portalConfig = loadPortalConfig()
  const limiter = createRateLimiter({
    windowMs: portalConfig.lookup.windowMinutes * 60 * 1000,
    max: portalConfig.lookup.maxAttempts
  })

  router.get('/config', (_req, res) => {
    const config = loadPortalConfig()
    const now = new Date().getFullYear()
    const payload: { config: PortalConfig; defaultPeriod: { y0: number; y1: number; y2: number } } = {
      config,
      defaultPeriod: { y0: now - 1, y1: now - 2, y2: now - 3 }
    }
    res.json(payload)
  })

  router.post('/projects', async (req, res) => {
    const input = parseBody(req.body)
    const meta = await store.projects.create(
      {
        name: input.company.name,
        company: input.company,
        period: input.period,
        clientId: authed(req).clientId
      },
      undefined
    )
    res.status(201).json({ projectId: meta.projectId, name: meta.name })
  })

  router.get('/projects', async (req, res) => {
    const clientId = authed(req).clientId
    const items: PortalHistoryItem[] = []

    for (const summary of await store.projects.list()) {
      const meta = await store.projects.get(summary.projectId)
      if (!canAccess(meta, clientId)) continue
      items.push(await historyOf(store, meta, portalConfig.passLine))
    }

    const payload: PortalListResponse = { projects: items }
    res.json(payload)
  })

  router.post('/lookup', async (req, res) => {
    const clientId = authed(req).clientId
    const decision = limiter.take(req.ip ?? 'unknown')
    if (!decision.ok) {
      res.setHeader('retry-after', String(decision.retryAfter))
      res.status(429).json({
        error: 'too_many_attempts',
        message: `查询过于频繁，请 ${Math.max(1, Math.ceil(decision.retryAfter / 60))} 分钟后再试`
      })
      return
    }

    const body = (req.body ?? {}) as Partial<PortalLookupRequest>
    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : ''
    const phoneTail =
      typeof body.phoneTail === 'string' ? body.phoneTail.replace(/\D/g, '').slice(-4) : ''

    if (companyName.length === 0 || phoneTail.length !== 4) {
      throw badRequest('invalid_lookup', '请填写企业全称与手机号后四位')
    }

    const matched: ProjectMeta[] = []
    for (const summary of await store.projects.findByCompanyName(companyName)) {
      const meta = await store.projects.get(summary.projectId)
      if ((meta.company?.phone ?? '').slice(-4) !== phoneTail) continue
      if (clientId && !canAccess(meta, clientId)) {
        await store.projects.update(meta.projectId, (draft) => {
          draft.claims = withClaim(draft, clientId)
        })
      }
      matched.push(meta)
    }

    if (matched.length === 0) {
      res.status(404).json({
        error: 'lookup_failed',
        message: '没有找到匹配的记录，请核对企业全称与手机号后四位'
      })
      return
    }

    const projects: PortalHistoryItem[] = []
    for (const meta of matched) {
      projects.push(await historyOf(store, meta, portalConfig.passLine))
    }
    const payload: PortalLookupResponse = { projects }
    res.json(payload)
  })

  router.post('/projects/:projectId/files', async (req, res) => {
    const project = await owned(store, req.params.projectId, authed(req).clientId)
    const slot = typeof req.query.slot === 'string' ? req.query.slot : undefined
    const outcome = await storeUploadedFile(
      store,
      project.projectId,
      req,
      options.maxFileBytes ?? MAX_FILE_BYTES,
      slot
    )
    res.status(outcome.created ? 201 : 200).json(outcome.payload)
  })

  router.delete('/projects/:projectId/files/:fileId', async (req, res) => {
    const project = await owned(store, req.params.projectId, authed(req).clientId)
    const removed = await store.projects.removeFile(project.projectId, req.params.fileId)
    await removeFile(store.projects.filePath(project.projectId, removed))
    res.status(204).end()
  })

  router.post('/projects/:projectId/assess', async (req, res) => {
    const project = await owned(store, req.params.projectId, authed(req).clientId)
    if (project.files.length === 0) {
      throw badRequest('no_files', '请先上传材料再开始评估')
    }
    const { job, reused, queueAhead } = await options.queue.enqueue(project.projectId, 'assess')
    res.status(202).json({ jobId: job.jobId, reused, queueAhead })
  })

  router.get('/jobs/:jobId', async (req, res) => {
    const job = options.queue.get(req.params.jobId)
    if (!job) throw notFound('job_not_found', '任务不存在')
    await owned(store, job.projectId, authed(req).clientId)
    res.json({ job: { ...options.queue.snapshot(job.jobId), queueAhead: options.queue.queueAhead(job.jobId) } })
  })

  router.get('/projects/:projectId/report', async (req, res) => {
    const project = await owned(store, req.params.projectId, authed(req).clientId)
    const detail = await loadPortalDetail(store, project)
    if (!detail) {
      res.status(409).json({ error: 'score_required', message: '尚未完成评估' })
      return
    }
    await sendPortalPdf(res, detail.data)
  })

  router.get('/projects/:projectId/result', async (req, res) => {
    const project = await owned(store, req.params.projectId, authed(req).clientId)
    const detail = await loadPortalDetail(store, project)
    if (!detail) {
      res.status(409).json({ error: 'score_required', message: '尚未完成评估' })
      return
    }
    res.json(detail.data)
  })

  return router
}
