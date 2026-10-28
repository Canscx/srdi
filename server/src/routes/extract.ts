import { Router } from 'express'
import type { ExtractRequestResponse } from '@srdi/shared'
import type { JobQueue } from '../jobs/queue'
import type { AppStore } from '../store'

export const extractRouter = (store: AppStore, queue: JobQueue) => {
  const router = Router()

  router.post('/projects/:projectId/extract', async (req, res) => {
    await store.projects.get(req.params.projectId)
    const { job, reused } = await queue.enqueue(req.params.projectId, 'extract')
    const payload: ExtractRequestResponse = { jobId: job.jobId, reused }
    res.status(202).json(payload)
  })

  return router
}
