import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { API_PREFIX } from '@srdi/shared'
import type { ApiError } from '@srdi/shared'
import { healthRouter } from './routes/health'
import { jobsRouter } from './routes/jobs'
import { requestLogger } from './logger'

export interface AppOptions {
  webDist: string
  port: number
}

const missingDistHtml = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>web/dist 尚未构建</title></head>
<body style="font-family:system-ui;padding:48px;line-height:1.8;color:#1f2937">
<h1>web/dist 尚未构建</h1>
<p>接口可用,静态资源缺失。执行 <code>pnpm build</code> 后再访问,或开发期直接使用 Vite 端口 <code>http://localhost:5173</code>。</p>
<p>健康检查:<a href="/api/health">/api/health</a></p>
</body>
</html>`

export const createApp = ({ webDist, port }: AppOptions) => {
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '2mb' }))
  app.use(requestLogger)

  app.use(API_PREFIX, healthRouter(port))
  app.use(API_PREFIX, jobsRouter())

  app.use(API_PREFIX, (req, res) => {
    const payload: ApiError = {
      error: 'not_found',
      message: '接口不存在',
      path: req.originalUrl
    }
    res.status(404).json(payload)
  })

  app.use(express.static(webDist, { index: false, maxAge: '1h' }))

  app.get(/.*/, (_req, res) => {
    const indexFile = path.join(webDist, 'index.html')
    if (existsSync(indexFile)) {
      res.sendFile(indexFile)
      return
    }
    res.status(503).type('html').send(missingDistHtml)
  })

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(err)
    const payload: ApiError = { error: 'internal_error', message: err.message }
    res.status(500).json(payload)
  })

  return app
}
