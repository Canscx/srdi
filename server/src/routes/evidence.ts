import { Router } from 'express'
import type { EvidencePatchRequest, EvidencePatchResponse } from '@srdi/shared'
import { badRequest } from '../errors'
import type { AppStore } from '../store'

const parsePatch = (body: unknown): EvidencePatchRequest => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('invalid_body', '请求体必须是 JSON 对象')
  }
  const raw = body as Record<string, unknown>
  const allowed = new Set(['candidateId', 'manualValue', 'unit', 'note', 'status'])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw badRequest('invalid_body', `不认识的字段 ${key}`)
  }

  const input: EvidencePatchRequest = {}
  if (raw.candidateId !== undefined) {
    if (typeof raw.candidateId !== 'string' || !raw.candidateId) {
      throw badRequest('invalid_candidate', 'candidateId 必须是非空字符串')
    }
    input.candidateId = raw.candidateId
  }
  if (raw.manualValue !== undefined) {
    const type = typeof raw.manualValue
    if (raw.manualValue !== null && type !== 'number' && type !== 'string' && type !== 'boolean') {
      throw badRequest('invalid_value', 'manualValue 只能是数值、字符串、布尔值或 null')
    }
    input.manualValue = raw.manualValue as number | string | boolean | null
  }
  if (raw.unit !== undefined) {
    if (typeof raw.unit !== 'string') throw badRequest('invalid_unit', 'unit 必须是字符串')
    input.unit = raw.unit
  }
  if (raw.note !== undefined) {
    if (typeof raw.note !== 'string') throw badRequest('invalid_note', 'note 必须是字符串')
    input.note = raw.note
  }
  if (raw.status !== undefined) {
    if (raw.status !== 'confirmed' && raw.status !== 'rejected' && raw.status !== 'missing') {
      throw badRequest('invalid_status', 'status 只能是 confirmed / rejected / missing')
    }
    input.status = raw.status
  }
  return input
}

export const evidenceRouter = (store: AppStore) => {
  const router = Router()

  router.get('/projects/:projectId/evidence', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const doc = await store.evidence.get(project)
    res.json(doc)
  })

  router.patch('/projects/:projectId/evidence/:key', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const input = parsePatch(req.body)
    const entry = await store.evidence.patch(project, req.params.key, input)
    const payload: EvidencePatchResponse = { key: entry.key, entry }
    res.json(payload)
  })

  return router
}
