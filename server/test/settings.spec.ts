import { createServer, type Server } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AiSettingsResponse, AiTestResponse, DocType, EvidenceDoc, FilePages, PageDoc } from '@srdi/shared'
import { createStore } from '../src/store'
import { writeJson } from '../src/store/atomic'
import { startServer, type TestServer } from './helpers'

const ENV_KEYS = ['AI_API_KEY', 'AI_BASE_URL', 'AI_MODEL'] as const
const savedEnv: Record<string, string | undefined> = {}

let dir = ''
let server: TestServer | null = null
let mock: Server | null = null
let apiBase = ''
let lastAuth = ''
let lastModel = ''
let replyText = ''

const extractionPayload = JSON.stringify({
  pageRange: [1, 1],
  fields: [
    {
      key: 'fin.revenue',
      found: true,
      period: 2025,
      value: 132000000,
      unit: 'CNY',
      raw: '营业收入 132,000,000.00',
      page: 1,
      quote: '营业收入 132,000,000.00',
      confidence: 0.96
    }
  ],
  documentMeta: { docType: 'audit', companyName: '测试科技有限公司', reportYear: 2025 },
  unreadable: []
})

const textPage = (page: number, text: string): PageDoc => ({
  fileId: 'f_page',
  page,
  route: 'text',
  width: 1000,
  height: 1400,
  text,
  blocks: [],
  tables: [],
  printableChars: text.replace(/\s/g, '').length,
  hasGlyphs: true,
  garbledRatio: 0
})

const listen = async (target: Server): Promise<number> => {
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
  const address = target.address()
  if (!address || typeof address === 'string') throw new Error('无法获取端口')
  return address.port
}

const readJson = async <T>(response: Response) => (await response.json()) as T

const putSettings = async (body: unknown) =>
  fetch(`${server?.base}/api/settings/ai`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })

const waitJob = async (jobId: string) => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const job = (await readJson<{ job: { stage: string; error?: string } }>(
      await fetch(`${server?.base}/api/jobs/${jobId}`)
    )).job
    if (job.stage === 'done' || job.stage === 'failed') return job
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  throw new Error('任务超时')
}

const addParsedFile = async (projectId: string, fileId: string, docType: DocType, text: string) => {
  const store = createStore(dir)
  const filePages: FilePages = {
    fileId,
    name: '2025 审计报告.pdf',
    kind: 'pdf',
    route: 'text',
    pages: [textPage(1, text)],
    truncated: false,
    visionSkipped: false,
    unreadable: [],
    parsedAt: new Date().toISOString()
  }
  await writeJson(path.join(store.projects.dir(projectId), 'pages', `${fileId}.json`), filePages)
  await store.projects.update(projectId, (meta) => {
    meta.files.push({
      fileId,
      name: '2025 审计报告.pdf',
      sha256: `sha_${fileId}`,
      size: 2048,
      kind: 'pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      docType,
      status: 'parsed',
      pages: 1,
      route: 'text',
      uploadedAt: new Date().toISOString()
    })
  })
}

beforeEach(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key]
    delete process.env[key]
  }
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-settings-'))
  lastAuth = ''
  lastModel = ''
  replyText = extractionPayload
  mock = createServer((req, res) => {
    lastAuth = String(req.headers.authorization ?? '')
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      try {
        lastModel = String(JSON.parse(Buffer.concat(chunks).toString('utf8')).model ?? '')
      } catch {
        lastModel = ''
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          model: lastModel,
          choices: [{ message: { content: replyText } }],
          usage: { prompt_tokens: 120, completion_tokens: 60 }
        })
      )
    })
  })
  apiBase = `http://127.0.0.1:${await listen(mock)}/v1`
  server = await startServer(dir)
})

afterEach(async () => {
  await server?.close()
  server = null
  if (mock) await new Promise<void>((resolve) => mock?.close(() => resolve()))
  mock = null
  await rm(dir, { recursive: true, force: true })
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('模型设置接口', () => {
  it('默认态:未配置 Key,地址与模型走默认值', async () => {
    const settings = await readJson<AiSettingsResponse>(await fetch(`${server?.base}/api/settings/ai`))
    expect(settings.hasKey).toBe(false)
    expect(settings.keyMasked).toBe('')
    expect(settings.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(settings.model).toBe('deepseek-flash')
    expect(settings.source).toEqual({ baseUrl: 'default', apiKey: 'default', model: 'default' })
    expect(settings.defaults.model).toBe('deepseek-flash')
  })

  it('保存后回显掩码,只填域名自动补 /v1', async () => {
    const response = await putSettings({
      baseUrl: 'https://api.deepseek.com/',
      apiKey: 'sk-test-1234567890abcdef',
      model: 'deepseek-flash'
    })
    expect(response.status).toBe(200)
    const body = await readJson<AiSettingsResponse>(response)
    expect(body.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(body.hasKey).toBe(true)
    expect(body.keyMasked).toBe('sk-t****cdef')
    expect(JSON.stringify(body)).not.toContain('1234567890')

    const again = await readJson<AiSettingsResponse>(await fetch(`${server?.base}/api/settings/ai`))
    expect(again.keyMasked).toBe('sk-t****cdef')
    expect(again.source.apiKey).toBe('file')
  })

  it('非法地址与过短 Key 被拒,未知字段被拒', async () => {
    const badUrl = await putSettings({ baseUrl: 'api.deepseek.com' })
    expect(badUrl.status).toBe(400)
    expect((await readJson<{ error: string }>(badUrl)).error).toBe('invalid_base_url')

    const badScheme = await putSettings({ baseUrl: 'ftp://api.deepseek.com' })
    expect(badScheme.status).toBe(400)

    const badKey = await putSettings({ apiKey: 'sk-1' })
    expect(badKey.status).toBe(400)
    expect((await readJson<{ error: string }>(badKey)).error).toBe('invalid_api_key')

    const unknown = await putSettings({ apiKey: 'sk-test-1234567890', token: 'x' })
    expect(unknown.status).toBe(400)
    expect((await readJson<{ error: string }>(unknown)).error).toBe('invalid_body')
  })

  it('环境变量作为兜底,页面配置优先', async () => {
    process.env.AI_API_KEY = 'sk-env-1234567890'
    process.env.AI_BASE_URL = 'https://env.example.com/v1'
    const fromEnv = await readJson<AiSettingsResponse>(await fetch(`${server?.base}/api/settings/ai`))
    expect(fromEnv.hasKey).toBe(true)
    expect(fromEnv.source.apiKey).toBe('env')
    expect(fromEnv.source.baseUrl).toBe('env')
    expect(fromEnv.baseUrl).toBe('https://env.example.com/v1')

    await putSettings({ apiKey: 'sk-file-1234567890', baseUrl: apiBase })
    const fromFile = await readJson<AiSettingsResponse>(await fetch(`${server?.base}/api/settings/ai`))
    expect(fromFile.source.apiKey).toBe('file')
    expect(fromFile.baseUrl).toBe(apiBase)
  })

  it('清除 Key 后回到未配置', async () => {
    await putSettings({ baseUrl: apiBase, apiKey: 'sk-test-1234567890' })
    const cleared = await readJson<AiSettingsResponse>(await putSettings({ clearKey: true }))
    expect(cleared.hasKey).toBe(false)
    expect(cleared.keyMasked).toBe('')
    expect(cleared.baseUrl).toBe(apiBase)
  })
})

describe('保存后直接抽取', () => {
  it('页面保存地址与 Key 后,测试连接与抽取都走新配置', async () => {
    const created = (await readJson<{ projectId: string }>(
      await fetch(`${server?.base}/api/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: '设置后抽取' })
      })
    ))
    await addParsedFile(created.projectId, 'f_revenue', 'audit', '营业收入 132,000,000.00')

    const before = await fetch(`${server?.base}/api/projects/${created.projectId}/extract`, { method: 'POST' })
    expect(before.status).toBe(202)
    const failed = await waitJob(((await readJson<{ jobId: string }>(before)).jobId))
    expect(failed.stage).toBe('failed')
    expect(failed.error ?? '').toContain('尚未配置模型 API Key')

    const saved = await readJson<AiSettingsResponse>(
      await putSettings({
        baseUrl: `http://127.0.0.1:${new URL(apiBase).port}/v1`,
        apiKey: 'sk-test-abcdefgh',
        model: 'deepseek-flash'
      })
    )
    expect(saved.hasKey).toBe(true)

    const tested = await fetch(`${server?.base}/api/settings/ai/test`, { method: 'POST' })
    expect(tested.status).toBe(200)
    const testResult = await readJson<AiTestResponse>(tested)
    expect(testResult.ok).toBe(true)
    expect(testResult.model).toBe('deepseek-flash')
    expect(lastAuth).toBe('Bearer sk-test-abcdefgh')

    const started = await fetch(`${server?.base}/api/projects/${created.projectId}/extract`, {
      method: 'POST'
    })
    expect(started.status).toBe(202)
    const done = await waitJob(((await readJson<{ jobId: string }>(started)).jobId))
    expect(done.stage).toBe('done')

    const evidence = await readJson<EvidenceDoc>(
      await fetch(`${server?.base}/api/projects/${created.projectId}/evidence`)
    )
    expect(evidence.fields['fin.revenue'].status).toBe('candidate')
    expect(evidence.fields['fin.revenue'].candidates?.[0]?.value).toBe(132000000)
    expect(lastModel).toBe('deepseek-flash')
  })

  it('接口返回鉴权失败时,测试连接给出可读错误', async () => {
    mock?.removeAllListeners('request')
    mock?.on('request', (req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API key' } }))
    })
    await putSettings({ baseUrl: apiBase, apiKey: 'sk-test-abcdefgh' })
    const response = await fetch(`${server?.base}/api/settings/ai/test`, { method: 'POST' })
    expect(response.status).toBe(502)
    const body = await readJson<{ error: string; message: string }>(response)
    expect(body.error).toBe('ai_test_failed')
    expect(body.message).toContain('Invalid API key')
  })
})
