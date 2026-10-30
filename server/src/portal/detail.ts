import type { PortalResultResponse, ProjectMeta, ScoreRecord } from '@srdi/shared'
import { generateAdvice } from '../ai/advice'
import type { AppStore } from '../store'
import { readAssessRecord } from './assess'
import { buildPortalResult } from './result'

export interface PortalDetail {
  data: PortalResultResponse
  record: ScoreRecord
}

export interface PortalDetailOptions {
  adviseFallback?: boolean
}

export const loadPortalDetail = async (
  store: AppStore,
  project: ProjectMeta,
  options: PortalDetailOptions = {}
): Promise<PortalDetail | null> => {
  const record = await store.scores.get(project.projectId)
  if (!record) return null

  const assess = await readAssessRecord(store, project.projectId)
  const evidence = await store.evidence.get(project)

  let advices = assess?.advices ?? []
  if (advices.length === 0 && options.adviseFallback) {
    advices = await generateAdvice({ store, project, record })
  }

  const data = buildPortalResult({
    project,
    evidence,
    record,
    advices,
    status: assess?.status ?? 'ready',
    warnings: assess?.warnings ?? []
  })

  return { data, record }
}
