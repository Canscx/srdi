import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { AiConfigSource, AiSettingsResponse } from '@srdi/shared'
import { badRequest } from '../errors'
import { writeJson } from '../store/atomic'
import { defaultModel } from './pricing'

export const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'
export const AI_SETTINGS_FILE = 'ai-settings.json'

export interface AiSettingsFile {
  baseUrl?: string
  apiKey?: string
  model?: string
  updatedAt?: string
}

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
  source: { baseUrl: AiConfigSource; apiKey: AiConfigSource; model: AiConfigSource }
}

export interface AiSettingsPatch {
  baseUrl?: string
  apiKey?: string
  model?: string
  clearKey?: boolean
}

const settingsPath = (dataDir: string) => path.join(dataDir, AI_SETTINGS_FILE)

const readText = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

export const readAiSettingsFile = (dataDir: string): AiSettingsFile => {
  try {
    const parsed = JSON.parse(readFileSync(settingsPath(dataDir), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const record = parsed as Record<string, unknown>
    return {
      baseUrl: readText(record.baseUrl),
      apiKey: readText(record.apiKey),
      model: readText(record.model),
      updatedAt: readText(record.updatedAt)
    }
  } catch {
    return {}
  }
}

export const normalizeBaseUrl = (raw: string) => {
  const value = raw.trim()
  if (!value) {
    throw badRequest('invalid_base_url', 'API 地址不能为空', '例如 https://api.deepseek.com/v1')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw badRequest('invalid_base_url', 'API 地址不是合法 URL', '需要以 http:// 或 https:// 开头')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('invalid_base_url', 'API 地址只支持 http 或 https')
  }
  const pathname = url.pathname.replace(/\/+$/, '') || '/v1'
  return `${url.origin}${pathname}`
}

export const resolveAiConfig = (dataDir: string): AiConfig => {
  const file = readAiSettingsFile(dataDir)
  const envBaseUrl = readText(process.env.AI_BASE_URL)
  const envApiKey = readText(process.env.AI_API_KEY)
  const envModel = readText(process.env.AI_MODEL)
  const fileBaseUrl = readText(file.baseUrl)
  const fileApiKey = readText(file.apiKey)
  const fileModel = readText(file.model)

  return {
    baseUrl: fileBaseUrl || envBaseUrl || DEFAULT_BASE_URL,
    apiKey: fileApiKey || envApiKey,
    model: fileModel || envModel || defaultModel(),
    source: {
      baseUrl: fileBaseUrl ? 'file' : envBaseUrl ? 'env' : 'default',
      apiKey: fileApiKey ? 'file' : envApiKey ? 'env' : 'default',
      model: fileModel ? 'file' : envModel ? 'env' : 'default'
    }
  }
}

export const maskApiKey = (apiKey: string) => {
  if (!apiKey) return ''
  if (apiKey.length <= 8) return '********'
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}

export const readAiSettings = (dataDir: string): AiSettingsResponse => {
  const config = resolveAiConfig(dataDir)
  const file = readAiSettingsFile(dataDir)
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasKey: Boolean(config.apiKey),
    keyMasked: maskApiKey(config.apiKey),
    updatedAt: readText(file.updatedAt) || undefined,
    source: config.source,
    defaults: { baseUrl: DEFAULT_BASE_URL, model: defaultModel() }
  }
}

export const saveAiSettings = async (
  dataDir: string,
  patch: AiSettingsPatch
): Promise<AiSettingsResponse> => {
  const current = readAiSettingsFile(dataDir)

  const baseUrl =
    patch.baseUrl !== undefined ? normalizeBaseUrl(patch.baseUrl) : readText(current.baseUrl)

  let apiKey = readText(current.apiKey)
  if (patch.apiKey !== undefined) {
    const candidate = patch.apiKey.trim().replace(/^Bearer\s+/i, '')
    if (candidate && candidate.length < 8) {
      throw badRequest(
        'invalid_api_key',
        'API Key 太短',
        '请粘贴完整 Key；如需清除已保存的 Key，点「清除 Key」'
      )
    }
    if (candidate.length > 512) {
      throw badRequest('invalid_api_key', 'API Key 过长', '正常 Key 不会超过 512 字符')
    }
    apiKey = candidate
  }
  if (patch.clearKey) apiKey = ''

  let model = readText(current.model)
  if (patch.model !== undefined) {
    const candidate = patch.model.trim()
    if (candidate.length > 80) {
      throw badRequest('invalid_model', '模型名过长', '模型名请控制在 80 字符以内')
    }
    model = candidate
  }

  const next: AiSettingsFile = { updatedAt: new Date().toISOString() }
  if (baseUrl) next.baseUrl = baseUrl
  if (apiKey) next.apiKey = apiKey
  if (model) next.model = model

  await writeJson(settingsPath(dataDir), next)
  return readAiSettings(dataDir)
}
