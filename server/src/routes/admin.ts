import { Router } from 'express'
import type { AdminPortalResult, ScoreResult } from '@srdi/shared'
import { lookupIndustryName } from '../config/industryMap'
import { rulesMeta } from '../config/rules'
import { badRequest, notFound } from '../errors'
import { loadPortalDetail } from '../portal/detail'
import { sendPortalPdf } from '../report/portal'
import type { AppStore } from '../store'
import { buildScoreRecord } from './score'

export interface SubmissionRow {
  projectId: string
  companyName: string
  creditCode: string
  phone: string
  industryCode: string
  industryName: string
  fileCount: number
  official: number | null
  optimistic: number | null
  passed: boolean | null
  weakestDimension: string
  weakestGap: number
  submittedAt: string
  hasScore: boolean
}

const weakestOf = (result: ScoreResult) => {
  const ceiling: Record<string, number> = {}
  for (const item of result.indicators) {
    ceiling[item.dimensionId] = (ceiling[item.dimensionId] ?? 0) + item.effectiveWeight
  }
  let name = ''
  let gap = -1
  for (const dimension of result.dimensions) {
    const diff = (ceiling[dimension.id] ?? dimension.weight) - dimension.score.official
    if (diff > gap) {
      gap = diff
      name = dimension.name
    }
  }
  return { name, gap: Number(Math.max(0, gap).toFixed(2)) }
}

export const adminRouter = (store: AppStore, passLine: number) => {
  const router = Router()

  router.get('/submissions', async (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : ''
    const rows: SubmissionRow[] = []

    for (const summary of await store.projects.list()) {
      const meta = await store.projects.get(summary.projectId)
      const record = await store.scores.get(meta.projectId)
      const companyName = meta.company?.name ?? meta.name
      const creditCode = meta.company?.creditCode ?? ''
      const haystack = `${companyName} ${creditCode}`.toLowerCase()
      if (query && !haystack.includes(query)) continue

      const weakest = record ? weakestOf(record.result) : { name: '', gap: 0 }

      rows.push({
        projectId: meta.projectId,
        companyName,
        creditCode,
        phone: meta.company?.phone ?? '',
        industryCode: meta.company?.industryCode ?? '',
        industryName: meta.company?.industryName ?? '',
        fileCount: meta.files.length,
        official: record ? Number(record.result.totals.official.toFixed(2)) : null,
        optimistic: record ? Number(record.result.totals.optimistic.toFixed(2)) : null,
        passed: record ? record.result.totals.official >= passLine : null,
        weakestDimension: weakest.name,
        weakestGap: weakest.gap,
        submittedAt: meta.createdAt,
        hasScore: Boolean(record)
      })
    }

    res.json({ passLine, items: rows.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1)) })
  })

  router.get('/projects/:projectId/result', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const detail = await loadPortalDetail(store, project, { adviseFallback: true })
    if (!detail) {
      res.status(409).json({ error: 'score_required', message: '该项目还没有评分记录' })
      return
    }
    const payload: AdminPortalResult = {
      ...detail.data,
      projectName: project.name,
      professional: { record: detail.record, rules: rulesMeta() }
    }
    res.json(payload)
  })

  router.get('/projects/:projectId/report', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const detail = await loadPortalDetail(store, project, { adviseFallback: true })
    if (!detail) {
      res.status(409).json({ error: 'score_required', message: '该项目还没有评分记录' })
      return
    }
    await sendPortalPdf(res, detail.data)
  })

  router.patch('/projects/:projectId/industry', async (req, res) => {
    const body = (req.body ?? {}) as { industryCode?: string }
    const code = (body.industryCode ?? '').trim().toUpperCase()
    if (!/^[A-Z]\d{2}$/.test(code)) {
      throw badRequest('invalid_industry', '行业代码应为字母加两位数字，例如 I65')
    }
    const project = await store.projects.get(req.params.projectId)
    if (!project.company) throw notFound('company_missing', '该项目没有企业信息')

    await store.projects.update(project.projectId, (meta) => {
      if (!meta.company) return
      meta.company.industryCode = code
      meta.company.industryName = lookupIndustryName(code) ?? undefined
    })

    const updated = await store.projects.get(project.projectId)
    const record = await buildScoreRecord(store, updated)
    await store.scores.save(record)

    res.json({
      projectId: updated.projectId,
      industryCode: code,
      industryName: lookupIndustryName(code),
      official: Number(record.result.totals.official.toFixed(2)),
      passed: record.result.totals.official >= passLine
    })
  })

  return router
}
