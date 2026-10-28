import path from 'node:path'
import type { ScoreRecord } from '@srdi/shared'
import { readJson, writeJson } from './atomic'
import type { LockTable } from './lock'

export interface ScoreStore {
  path: (projectId: string) => string
  get: (projectId: string) => Promise<ScoreRecord | null>
  save: (record: ScoreRecord) => Promise<void>
}

export const createScoreStore = (dataDir: string, lock: LockTable): ScoreStore => {
  const pathOf = (projectId: string) =>
    path.join(dataDir, 'projects', projectId, 'score-result.json')

  return {
    path: pathOf,
    get: (projectId) => readJson<ScoreRecord>(pathOf(projectId)),
    save: (record) =>
      lock(`score:${record.result.projectId}`, () =>
        writeJson(pathOf(record.result.projectId), record)
      )
  }
}
