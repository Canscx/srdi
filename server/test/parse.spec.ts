import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  CreateProjectResponse,
  EvidenceDoc,
  FilePages,
  ParseRequestResponse,
  UploadFileResponse
} from '@srdi/shared'
import { makeScannedPdf, makeTextPdf, startServer, type TestServer } from './helpers'

let dir = ''
let server: TestServer
let projectId = ''

const upload = async (bytes: Buffer, name: string, type: string) => {
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(bytes)], { type }), name)
  const response = await fetch(`${server.base}/api/projects/${projectId}/files`, {
    method: 'POST',
    body: form
  })
  return { response, body: (await response.json()) as UploadFileResponse }
}

const projectOf = async () => {
  const response = await fetch(`${server.base}/api/projects/${projectId}`)
  return (await response.json()) as CreateProjectResponse
}

const waitForJob = async (jobId: string) => {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    const response = await fetch(`${server.base}/api/jobs/${jobId}`)
    if (response.ok) {
      const { job } = (await response.json()) as {
        job: { stage: string; error?: string; pct: number }
      }
      if (job.stage === 'done' || job.stage === 'failed') return job
    }
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('解析任务超时')
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-parse-'))
  server = await startServer(dir)
  const response = await fetch(`${server.base}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '解析链路测试' })
  })
  const body = (await response.json()) as CreateProjectResponse
  projectId = body.projectId
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('解析接口', () => {
  it('没有材料时拒绝解析', async () => {
    const response = await fetch(`${server.base}/api/projects/${projectId}/parse`, {
      method: 'POST'
    })
    const body = (await response.json()) as { error: string }
    expect(response.status).toBe(400)
    expect(body.error).toBe('no_files')
  })

  it('文字 PDF 与扫描 PDF 分别落到文本与视觉通道', async () => {
    const textFile = await upload(await makeTextPdf(), '审计报告.pdf', 'application/pdf')
    const scanFile = await upload(await makeScannedPdf(), '扫描件.pdf', 'application/pdf')
    expect(textFile.response.status).toBe(201)
    expect(scanFile.response.status).toBe(201)

    const parseResponse = await fetch(`${server.base}/api/projects/${projectId}/parse`, {
      method: 'POST'
    })
    const parseBody = (await parseResponse.json()) as ParseRequestResponse
    expect(parseResponse.status).toBe(202)
    expect(parseBody.jobId).toMatch(/^j_/)

    const job = await waitForJob(parseBody.jobId)
    expect(job.stage).toBe('done')

    const project = (await projectOf()).project
    const text = project.files.find((file) => file.fileId === textFile.body.fileId)
    const scan = project.files.find((file) => file.fileId === scanFile.body.fileId)

    expect(text?.status).toBe('parsed')
    expect(text?.route).toBe('text')
    expect(text?.pages).toBe(1)
    expect(text?.docType).toBe('audit')
    expect(scan?.status).toBe('parsed')
    expect(scan?.route).toBe('vision')
    expect(scan?.pages).toBe(1)

    const pagesFile = path.join(dir, 'projects', projectId, 'pages', `${textFile.body.fileId}.json`)
    const pages = JSON.parse(await readFile(pagesFile, 'utf8')) as FilePages
    expect(pages.route).toBe('text')
    expect(pages.pages[0].text).toContain('Revenue')
    expect(pages.pages[0].tables.length).toBeGreaterThanOrEqual(0)

    const imageFile = path.join(dir, 'projects', projectId, 'pages', textFile.body.fileId, 'p1.jpg')
    expect((await stat(imageFile)).size).toBeGreaterThan(1000)

    const evidenceResponse = await fetch(`${server.base}/api/projects/${projectId}/evidence`)
    const evidence = (await evidenceResponse.json()) as EvidenceDoc
    expect(evidence.files).toHaveLength(2)
    expect(evidence.files?.map((file) => (file as { route: string }).route).sort()).toEqual([
      'text',
      'vision'
    ])
  })

  it('SSE 能拿到任务快照', async () => {
    const parseResponse = await fetch(`${server.base}/api/projects/${projectId}/parse`, {
      method: 'POST'
    })
    const { jobId } = (await parseResponse.json()) as ParseRequestResponse

    const controller = new AbortController()
    try {
      const response = await fetch(`${server.base}/api/jobs/${jobId}/stream`, {
        signal: controller.signal
      })
      const reader = response.body?.getReader()
      expect(reader).toBeTruthy()
      const chunk = await reader!.read()
      const text = new TextDecoder().decode(chunk.value)
      expect(text).toContain('event: snapshot')
      expect(text).toContain(jobId)
      await reader!.cancel()
    } finally {
      controller.abort()
    }

    const job = await waitForJob(jobId)
    expect(job.stage).toBe('done')
  })
})
