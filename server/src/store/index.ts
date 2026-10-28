import path from 'node:path'
import { createEvidenceStore } from './evidence'
import { createLockTable } from './lock'
import { createProjectStore } from './project'

export const createStore = (dataDir: string) => {
  const lock = createLockTable()
  return {
    dataDir,
    tmpDir: path.join(dataDir, 'tmp'),
    projects: createProjectStore(dataDir, lock),
    evidence: createEvidenceStore(dataDir, lock)
  }
}

export type AppStore = ReturnType<typeof createStore>
