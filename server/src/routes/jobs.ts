import { Router } from 'express'
import type { JobProgressEvent } from '@srdi/shared'
import { subscribe, subscriberCount } from '../jobs/hub'

const HEARTBEAT_MS = 15000

export const jobsRouter = () => {
  const router = Router()

  router.get('/jobs/:jobId/stream', (req, res) => {
    const jobId = req.params.jobId

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    })
    res.flushHeaders()

    const snapshot: JobProgressEvent = {
      jobId,
      stage: 'queued',
      pct: 0,
      total: 0,
      message: 'SSE 通道就绪,解析队列尚未接入'
    }

    res.write('retry: 3000\n\n')
    res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`)

    const unsubscribe = subscribe(jobId, (event) => {
      res.write(`event: progress\ndata: ${JSON.stringify(event)}\n\n`)
    })

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
