import { Router } from 'express'
import type { ParseRequestResponse } from '@srdi/shared'
import type { JobQueue } from '../jobs/queue'
import type { AppStore } from '../store'

export const parseRouter = (store: AppStore, queue: JobQueue) => {
  const router = Router()

  router.post('/projects/:projectId/parse', async (req, res) => {
    await store.projects.get(req.params.projectId)
    const { job, reused } = await queue.enqueue(req.params.projectId, 'parse')
    const payload: ParseRequestResponse = { jobId: job.jobId, reused }
    res.status(202).json(payload)
  })

  return router
}
