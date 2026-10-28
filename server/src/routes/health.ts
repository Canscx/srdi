import { Router } from 'express'
import { APP_VERSION, SERVICE_NAME, STAGE } from '@srdi/shared'
import type { HealthResponse } from '@srdi/shared'
import { loadRulesSummary } from '../config/rules'

export const healthRouter = (port: number) => {
  const router = Router()
  const rules = loadRulesSummary()

  router.get('/health', (_req, res) => {
    const payload: HealthResponse = {
      ok: true,
      service: SERVICE_NAME,
      version: APP_VERSION,
      stage: STAGE,
      rules,
      runtime: {
        node: process.version,
        uptimeSec: Math.round(process.uptime()),
        pid: process.pid,
        port
      },
      time: new Date().toISOString()
    }
    res.json(payload)
  })

  return router
}
