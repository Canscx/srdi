import { Router } from 'express'
import type { AiSettingsPatchRequest, AiTestResponse } from '@srdi/shared'
import type { ModelClient } from '../ai/client'
import { readAiSettings, resolveAiConfig, saveAiSettings, type AiSettingsPatch } from '../config/aiSettings'
import { AppError, badRequest } from '../errors'

const parsePatch = (body: unknown): AiSettingsPatch => {
  if (body === undefined || body === null) return {}
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('invalid_body', '请求体必须是 JSON 对象')
  }
  const raw = body as Record<string, unknown>
  const allowed = new Set(['baseUrl', 'apiKey', 'model', 'clearKey'])
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) throw badRequest('invalid_body', `不认识的字段 ${key}`)
  }

  const patch: AiSettingsPatch = {}
  for (const key of ['baseUrl', 'apiKey', 'model'] as const) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'string') throw badRequest('invalid_body', `${key} 必须是字符串`)
    patch[key] = value
  }
  if (raw.clearKey !== undefined) {
    if (typeof raw.clearKey !== 'boolean') throw badRequest('invalid_body', 'clearKey 必须是布尔值')
    patch.clearKey = raw.clearKey
  }
  return patch
}

export const settingsRouter = (dataDir: string, client: ModelClient) => {
  const router = Router()

  router.get('/settings/ai', (_req, res) => {
    res.json(readAiSettings(dataDir))
  })

  router.put('/settings/ai', async (req, res) => {
    const payload: AiSettingsPatchRequest = parsePatch(req.body)
    res.json(await saveAiSettings(dataDir, payload))
  })

  router.post('/settings/ai/test', async (_req, res) => {
    const config = resolveAiConfig(dataDir)
    if (!config.apiKey) {
      throw new AppError(
        400,
        'ai_not_configured',
        '尚未配置模型 API Key',
        '先填写 API 地址与 Key 并保存，再测试连接'
      )
    }
    const started = Date.now()
    try {
      const reply = await client.complete({
        model: config.model,
        messages: [{ role: 'user', content: '只回复 ok，不要解释' }],
        maxTokens: 256,
        timeoutMs: 30000
      })
      const payload: AiTestResponse = {
        ok: true,
        model: reply.model,
        latencyMs: Date.now() - started,
        message: reply.text.trim().slice(0, 80) || '连接成功'
      }
      res.json(payload)
    } catch (err) {
      const message = err instanceof Error ? err.message : '未知错误'
      const empty = message.includes('空内容')
      throw new AppError(
        502,
        'ai_test_failed',
        `连接失败: ${message}`,
        empty
          ? '接口已连通，但模型没有返回正文：推理型模型会先消耗思考 token，可直接保存后试抽取'
          : '核对 API 地址、Key 与模型名；网关需兼容 OpenAI 的 /chat/completions'
      )
    }
  })

  return router
}
