import { Router } from 'express'
import type { ApiError, JobProgressEvent } from '@srdi/shared'
import type { JobQueue } from '../jobs/queue'
import { subscribe, subscriberCount } from '../jobs/hub'

const HEARTBEAT_MS = 15000

export const jobsRouter = (queue: JobQueue) => {
  const router = Router()

  router.get('/jobs/:jobId', (req, res) => {
    const job = queue.get(req.params.jobId)
    if (!job) {
      const payload: ApiError = {
        error: 'job_not_found',
        message: '任务不存在或已过期',
        path: req.originalUrl
      }
      res.status(404).json(payload)
      return
    }
    res.json({ job })
  })

  router.get('/jobs/:jobId/stream', (req, res) => {
    const jobId = req.params.jobId

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders()

    const unsubscribe = subscribe(jobId, (event) => {
      res.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`)
    })

    const snapshot: JobProgressEvent = queue.snapshot(jobId) ?? {
      jobId,
      stage: 'queued',
      pct: 0,
      total: 0,
      message: '任务不存在或已过期'
    }

    res.write('retry: 3000\n\n')
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)

    const timer = setInterval(() => {
      res.write(`: ping ${Date.now()} subscribers=${subscriberCount(jobId)}\n\n`)
    }, HEARTBEAT_MS)

    req.on('close', () => {
      clearInterval(timer)
      unsubscribe()
      res.end()
    })
  })

  return router
}
