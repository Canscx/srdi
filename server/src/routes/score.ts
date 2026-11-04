import { Router } from 'express'
import { evaluate, yearsSinceDate } from '@srdi/shared'
import type {
  EvidenceDoc,
  FieldEntry,
  ProjectMeta,
  ScoreEvidenceStats,
  ScoreRecord,
  ScoreResponse
} from '@srdi/shared'
import { catalogFields } from '../config/catalog'
import { loadBenchmarks } from '../config/benchmarks'
import { loadRules } from '../config/rules'
import type { AppStore } from '../store'

const SCORE_RECORD_VERSION = '1.0.0'

const statsOf = (evidence: EvidenceDoc): ScoreEvidenceStats => {
  const stats: ScoreEvidenceStats = {
    total: 0,
    confirmed: 0,
    candidate: 0,
    missing: 0,
    rejected: 0
  }
  for (const field of catalogFields()) {
    stats.total += 1
    const status = evidence.fields[field.key]?.status
    if (status === 'confirmed') stats.confirmed += 1
    else if (status === 'candidate') stats.candidate += 1
    else if (status === 'rejected') stats.rejected += 1
    else stats.missing += 1
  }
  return stats
}

const resolveIndustryCode = (evidence: EvidenceDoc, project: ProjectMeta): string | undefined => {
  const declared = project.company?.industryCode?.trim()
  if (declared) return declared

  const fromCompany = evidence.company?.industryCode?.trim()
  if (fromCompany) return fromCompany

  const entry = evidence.fields['company.industryCode']
  if (entry?.status === 'confirmed' && typeof entry.value === 'string') {
    const value = entry.value.trim()
    if (value) return value
  }
  return undefined
}

const establishedDateOf = (evidence: EvidenceDoc, project: ProjectMeta): string => {
  const fromEvidence = evidence.fields['identity.establishedDate']?.value
  if (typeof fromEvidence === 'string' && fromEvidence.trim()) return fromEvidence.trim()
  return (project.company?.establishedDate ?? '').trim()
}

const withDerivedEvidence = (evidence: EvidenceDoc, project: ProjectMeta): EvidenceDoc => {
  const entry = evidence.fields['company.subMarketYears']
  if (entry?.status === 'confirmed' || entry?.status === 'rejected') return evidence

  const date = establishedDateOf(evidence, project)
  if (!date) return evidence

  const years = yearsSinceDate(date, new Date(`${evidence.period.y0}-12-31`))
  if (years === null) return evidence

  const derived: FieldEntry = {
    ...(entry ?? {}),
    key: 'company.subMarketYears',
    status: 'confirmed',
    value: years
  }

  return {
    ...evidence,
    fields: { ...evidence.fields, 'company.subMarketYears': derived }
  }
}

export const buildScoreRecord = async (
  store: AppStore,
  project: ProjectMeta
): Promise<ScoreRecord> => {
  const evidence = await store.evidence.get(project)
  const rules = loadRules()
  const benchmarks = loadBenchmarks()

  const result = evaluate(
    {
      evidence: withDerivedEvidence(evidence, project),
      benchmarks,
      industryCode: resolveIndustryCode(evidence, project)
    },
    rules
  )

  return {
    schemaVersion: SCORE_RECORD_VERSION,
    savedAt: new Date().toISOString(),
    rulesId: rules.rulesId,
    rulesVersion: rules.schemaVersion,
    benchmarksVersion: benchmarks.version,
    evidence: statsOf(evidence),
    result
  }
}

export const scoreRouter = (store: AppStore) => {
  const router = Router()

  router.post('/projects/:projectId/score', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const record = await buildScoreRecord(store, project)
    await store.scores.save(record)
    const payload: ScoreResponse = { record }
    res.json(payload)
  })

  router.get('/projects/:projectId/score', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const record = await store.scores.get(project.projectId)
    const payload: ScoreResponse = { record }
    res.json(payload)
  })

  return router
}
