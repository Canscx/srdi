import path from 'node:path'
import { createEvidenceStore } from './evidence'
import { createLockTable } from './lock'
import { createProjectStore } from './project'
import { createScoreStore } from './score'

export const createStore = (dataDir: string) => {
  const lock = createLockTable()
  return {
    dataDir,
    tmpDir: path.join(dataDir, 'tmp'),
    projects: createProjectStore(dataDir, lock),
    evidence: createEvidenceStore(dataDir, lock),
    scores: createScoreStore(dataDir, lock)
  }
}

export type AppStore = ReturnType<typeof createStore>
