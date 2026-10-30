import express from 'express'
import type { NextFunction, Request, Response } from 'express'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { API_PREFIX } from '@srdi/shared'
import type { ApiError } from '@srdi/shared'
import { createModelClient, type ModelClient } from './ai/client'
import { generateAdvice } from './ai/advice'
import { extractProject } from './ai/extract'
import { resolveAiConfig } from './config/aiSettings'
import { defaultModel } from './config/pricing'
import { AppError } from './errors'
import { healthRouter } from './routes/health'
import { jobsRouter } from './routes/jobs'
import { projectsRouter } from './routes/projects'
import { filesRouter } from './routes/files'
import { evidenceRouter } from './routes/evidence'
import { extractRouter } from './routes/extract'
import { metaRouter } from './routes/meta'
import { pagesRouter } from './routes/pages'
import { parseRouter } from './routes/parse'
import { reportRouter } from './routes/report'
import { scoreRouter } from './routes/score'
import { settingsRouter } from './routes/settings'
import { createJobQueue } from './jobs/queue'
import { requestLogger } from './logger'
import { parseProject } from './pipeline/parse'
import { requireRole, requireSession, ensureClientId } from './auth/middleware'
import { createAuthService, type AuthConfig } from './auth/session'
import { authRouter } from './routes/auth'
import { portalRouter } from './routes/portal'
import { adminRouter } from './routes/admin'
import { assessProject } from './portal/assess'
import { loadPortalConfig } from './config/portal'
import { createStore } from './store'

export interface AppOptions {
  webDist: string
  port: number
  dataDir: string
  maxFileBytes?: number
  aiClient?: ModelClient
  aiModel?: string
  auth?: AuthConfig | null
}

const missingDistHtml = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>web/dist 尚未构建</title></head>
<body style="font-family:system-ui;padding:48px;line-height:1.8;color:#1f2937">
<h1>web/dist 尚未构建</h1>
<p>接口可用,静态资源缺失。执行 <code>pnpm build</code> 后再访问,或开发期直接使用 Vite 端口 <code>http://localhost:5180</code>。</p>
<p>健康检查:<a href="/api/health">/api/health</a></p>
</body>
</html>`

export const createApp = ({ webDist, port, dataDir, maxFileBytes, aiClient, aiModel, auth }: AppOptions) => {
  const app = express()
  app.set('trust proxy', 1)
  const store = createStore(dataDir)
  const modelClient = aiClient ?? createModelClient({ resolve: () => resolveAiConfig(dataDir) })
  const currentModel = () => (aiClient ? aiModel ?? defaultModel() : resolveAiConfig(dataDir).model)
  const queue = createJobQueue(store, {
    parse: async (projectId, report) => {
      const outcome = await parseProject(store, projectId, report)
      const failed = outcome.failures.length
      return {
        message:
          failed === 0 ? `解析完成,共 ${outcome.pages} 页` : `解析完成,${failed} 个文件失败`,
        error: failed === 0 ? undefined : outcome.failures.join('\n')
      }
    },
    extract: async (projectId, report) => {
      const outcome = await extractProject(store, projectId, report, {
        client: modelClient,
        model: currentModel()
      })
      const parts = [`抽取完成,${outcome.files} 个文件`]
      if (outcome.cached > 0) parts.push(`${outcome.cached} 个命中缓存`)
      parts.push(`${outcome.candidates} 条候选`)
      if (outcome.chunks.failed > 0) parts.push(`${outcome.chunks.failed} 个分块失败`)
      if (outcome.budgetExhausted) parts.push('token 预算已用尽')
      return {
        message: parts.join(','),
        error: outcome.warnings.length > 0 ? outcome.warnings.join('\n') : undefined
      }
    },
    assess: async (projectId, report) => {
      const outcome = await assessProject(store, projectId, report, {
        client: modelClient,
        model: currentModel(),
        advise: ({ project, record }) =>
          generateAdvice({
            store,
            project,
            record,
            client: modelClient,
            model: currentModel()
          })
      })
      const failed = outcome.stages.filter((stage) => !stage.ok).map((stage) => stage.name)
      return {
        message:
          outcome.official === null
            ? '评估未完成'
            : `评估完成,当前得分 ${outcome.official},补齐后可达 ${outcome.optimistic}`,
        error: failed.length > 0 ? `未完成环节:${failed.join('、')}` : undefined
      }
    }
  })

  app.disable('x-powered-by')
  app.use(express.json({ limit: '2mb' }))
  app.use(requestLogger)

  if (auth) {
    const service = createAuthService(auth)
    app.use(API_PREFIX, authRouter(service))
    app.use(API_PREFIX, requireSession(service))
    app.use(
      `${API_PREFIX}/portal`,
      requireRole('customer'),
      ensureClientId(),
      portalRouter(store, {
        maxFileBytes,
        queue,
        aiClient: modelClient,
        aiModel: currentModel
      })
    )
    app.use(API_PREFIX, requireRole('admin'))
    app.use(`${API_PREFIX}/admin`, adminRouter(store, loadPortalConfig().passLine))
  }

  app.use(API_PREFIX, healthRouter(port, dataDir))
  app.use(API_PREFIX, jobsRouter(queue))
  app.use(API_PREFIX, projectsRouter(store))
  app.use(API_PREFIX, filesRouter(store, { maxFileBytes }))
  app.use(API_PREFIX, evidenceRouter(store))
  app.use(API_PREFIX, pagesRouter(store))
  app.use(API_PREFIX, metaRouter())
  app.use(API_PREFIX, settingsRouter(dataDir, modelClient))
  app.use(API_PREFIX, parseRouter(store, queue))
  app.use(API_PREFIX, extractRouter(store, queue))
  app.use(API_PREFIX, scoreRouter(store))
  app.use(API_PREFIX, reportRouter(store))

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

  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      const payload: ApiError = {
        error: err.code,
        message: err.message,
        hint: err.hint,
        path: req.originalUrl
      }
      res.status(err.status).json(payload)
      return
    }

    const status = (err as { status?: number; statusCode?: number }).status
      ?? (err as { statusCode?: number }).statusCode

    if (status && status >= 400 && status < 500) {
      const payload: ApiError = {
        error: 'invalid_request',
        message: err.message,
        path: req.originalUrl
      }
      res.status(status).json(payload)
      return
    }

    console.error(err)
    const payload: ApiError = { error: 'internal_error', message: err.message }
    res.status(500).json(payload)
  })

  return app
}
