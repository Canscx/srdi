import { modelPricing } from '../config/pricing'
import { AppError } from '../errors'

export interface ModelTextPart {
  type: 'text'
  text: string
}

export interface ModelImagePart {
  type: 'image'
  mime: string
  data: string
}

export type ModelPart = ModelTextPart | ModelImagePart

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ModelPart[]
}

export interface ModelRequest {
  model: string
  messages: ModelMessage[]
  temperature?: number
  json?: boolean
  maxTokens?: number
  timeoutMs?: number
}

export interface ModelUsage {
  promptTokens: number
  completionTokens: number
}

export interface ModelResponse {
  text: string
  usage: ModelUsage
  model: string
}

export interface ModelClient {
  complete: (request: ModelRequest) => Promise<ModelResponse>
}

const TEXT_TIMEOUT_MS = 120_000
const VISION_TIMEOUT_MS = 180_000
const RETRY_DELAYS = [1000, 4000, 10000]
const MAX_ATTEMPTS = 3

export class ModelError extends Error {
  readonly status: number
  readonly retryable: boolean

  constructor(status: number, message: string, retryable: boolean) {
    super(message)
    this.name = 'ModelError'
    this.status = status
    this.retryable = retryable
  }
}

interface ChatContent {
  text?: string
  [key: string]: unknown
}

interface ChatChoice {
  message?: { content?: string | ChatContent[] | null }
}

interface ChatResponse {
  model?: string
  choices?: ChatChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  error?: { message?: string }
}

const toApiContent = (content: string | ModelPart[]) => {
  if (typeof content === 'string') return content
  return content.map((part) =>
    part.type === 'text'
      ? { type: 'text', text: part.text }
      : { type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.data}` } }
  )
}

const readText = (content: string | ChatContent[] | null | undefined) => {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((part) => (typeof part.text === 'string' ? part.text : '')).join('')
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface ModelEndpoint {
  apiKey: string
  baseUrl: string
  model: string
}

export interface ModelClientOptions {
  apiKey?: string
  baseUrl?: string
  model?: string
  resolve?: () => ModelEndpoint
  fetchImpl?: typeof fetch
  wait?: (ms: number) => Promise<void>
}

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

export const createModelClient = (options: ModelClientOptions = {}): ModelClient => {
  const fetchImpl = options.fetchImpl ?? fetch
  const wait = options.wait ?? sleep

  const endpointFor = (requestedModel: string): ModelEndpoint => {
    if (options.resolve) return options.resolve()
    return {
      apiKey: options.apiKey ?? process.env.AI_API_KEY ?? '',
      baseUrl: (options.baseUrl ?? process.env.AI_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ''),
      model: options.model ?? process.env.AI_MODEL ?? requestedModel
    }
  }

  const complete = async (request: ModelRequest): Promise<ModelResponse> => {
    const endpoint = endpointFor(request.model)
    const apiKey = endpoint.apiKey
    const baseUrl = endpoint.baseUrl.replace(/\/+$/, '')
    const model = endpoint.model || request.model
    if (!apiKey) {
      throw new AppError(
        503,
        'ai_not_configured',
        '尚未配置模型 API Key',
        '在页面右上角「模型设置」里填写 API 地址与 Key，保存后即可抽取；也可设置环境变量 AI_API_KEY'
      )
    }
    const vision = modelPricing(model)?.supportsVision !== false
    const timeoutMs = request.timeoutMs ?? TEXT_TIMEOUT_MS
    const body: Record<string, unknown> = {
      model,
      temperature: request.temperature ?? 0,
      messages: request.messages.map((message) => ({
        role: message.role,
        content: toApiContent(message.content)
      }))
    }
    if (request.json) body.response_format = { type: 'json_object' }
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens
    if (vision === false) {
      const hasImage = request.messages.some(
        (message) => Array.isArray(message.content) && message.content.some((part) => part.type === 'image')
      )
      if (hasImage) {
        throw new AppError(
          400,
          'model_without_vision',
          `模型 ${model} 不支持图像输入`,
          '改用支持视觉的模型，或在设置中开启「仅文本模式」'
        )
      }
    }

    let lastError: ModelError | null = null
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs > 0 ? timeoutMs : VISION_TIMEOUT_MS)
      try {
        const response = await fetchImpl(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })
        const payload = (await response.json().catch(() => null)) as ChatResponse | null
        if (!response.ok) {
          const retryable = response.status === 429 || response.status >= 500
          const message = payload?.error?.message ?? `模型接口返回 ${response.status}`
          lastError = new ModelError(response.status, message, retryable)
          if (!retryable) throw lastError
        } else {
          const text = readText(payload?.choices?.[0]?.message?.content)
          if (!text.trim()) {
            lastError = new ModelError(502, '模型返回空内容', true)
          } else {
            return {
              text,
              model: payload?.model ?? request.model,
              usage: {
                promptTokens: Math.max(0, payload?.usage?.prompt_tokens ?? 0),
                completionTokens: Math.max(0, payload?.usage?.completion_tokens ?? 0)
              }
            }
          }
        }
      } catch (err) {
        if (err instanceof AppError) throw err
        if (err instanceof ModelError) {
          if (!err.retryable) throw err
          lastError = err
        } else {
          const aborted = (err as Error).name === 'AbortError'
          lastError = new ModelError(
            aborted ? 504 : 502,
            aborted ? `模型请求超时(${timeoutMs}ms)` : (err as Error).message,
            true
          )
        }
      } finally {
        clearTimeout(timer)
      }

      if (attempt < MAX_ATTEMPTS - 1) await wait(RETRY_DELAYS[attempt])
    }

    throw lastError ?? new ModelError(502, '模型调用失败', false)
  }

  return { complete }
}
