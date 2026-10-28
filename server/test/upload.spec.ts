import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  CreateProjectResponse,
  EvidenceDoc,
  EvidencePatchResponse,
  ProjectListResponse,
  UploadFileResponse
} from '@srdi/shared'
import { buildZip, pdfBytes, startServer, type TestServer } from './helpers'

let dir = ''
let server: TestServer
let projectId = ''

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-upload-'))
  server = await startServer(dir, 2048)
  const response = await fetch(`${server.base}/api/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: '南京样例企业' })
  })
  const body = (await response.json()) as CreateProjectResponse
  projectId = body.projectId
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

const upload = (bytes: Buffer, name: string, type = 'application/octet-stream') => {
  const form = new FormData()
  form.append('file', new Blob([Uint8Array.from(bytes)], { type }), name)
  return fetch(`${server.base}/api/projects/${projectId}/files`, {
    method: 'POST',
    body: form
  })
}

describe('文件上传', () => {
  it('创建项目后能列出来', async () => {
    const response = await fetch(`${server.base}/api/projects`)
    const body = (await response.json()) as ProjectListResponse
    expect(response.status).toBe(200)
    expect(body.projects.map((item) => item.projectId)).toContain(projectId)
  })

  it('PDF 落盘并返回真实哈希', async () => {
    const bytes = pdfBytes()
    const response = await upload(bytes, '审计报告 2025.pdf', 'application/pdf')
    const body = (await response.json()) as UploadFileResponse

    expect(response.status).toBe(201)
    expect(body.kind).toBe('pdf')
    expect(body.dup).toBe(false)
    expect(body.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(body.name).toBe('审计报告 2025.pdf')
  })

  it('重复上传返回已有文件而不是再存一份', async () => {
    const response = await upload(pdfBytes(), '同一份.pdf', 'application/pdf')
    const body = (await response.json()) as UploadFileResponse

    expect(response.status).toBe(200)
    expect(body.dup).toBe(true)

    const projectResponse = await fetch(`${server.base}/api/projects/${projectId}`)
    const project = (await projectResponse.json()) as CreateProjectResponse
    const pdfFiles = project.project.files.filter((file) => file.kind === 'pdf')
    expect(pdfFiles).toHaveLength(1)
  })

  it('扩展名骗不过魔数', async () => {
    const docx = buildZip([
      { name: '[Content_Types].xml' },
      { name: 'word/document.xml', data: '<w:document/>' }
    ])
    const response = await upload(docx, '其实是word.pdf', 'application/pdf')
    const body = (await response.json()) as UploadFileResponse
    expect(response.status).toBe(201)
    expect(body.kind).toBe('docx')
    expect(body.ext).toBe('docx')
  })

  it('老版 xls 返回 415 并说明怎么改', async () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])
    const response = await upload(ole, '旧财务表.xls')
    const body = (await response.json()) as { error: string; hint?: string }

    expect(response.status).toBe(415)
    expect(body.error).toBe('legacy_office')
    expect(body.hint).toContain('另存为')
  })

  it('PPT 返回 415', async () => {
    const pptx = buildZip([{ name: 'ppt/presentation.xml', data: '<p/>' }])
    const response = await upload(pptx, '路演.pptx')
    const body = (await response.json()) as { error: string }
    expect(response.status).toBe(415)
    expect(body.error).toBe('unsupported_office')
  })

  it('超过单文件上限返回 413 且不留下半截文件', async () => {
    const oversize = Buffer.concat([pdfBytes(), Buffer.alloc(4096, 0x41)])
    const response = await upload(oversize, '超限.pdf', 'application/pdf')
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(413)
    expect(body.error).toBe('file_too_large')

    const leftovers = await readdir(path.join(dir, 'tmp'))
    expect(leftovers.filter((name) => name.endsWith('.part'))).toHaveLength(0)
  })

  it('删除文件会同时清掉磁盘副本', async () => {
    const response = await upload(
      buildZip([{ name: 'xl/workbook.xml', data: '<workbook/>' }]),
      '财务数据.xlsx'
    )
    const body = (await response.json()) as UploadFileResponse
    expect(response.status).toBe(201)

    const removed = await fetch(
      `${server.base}/api/projects/${projectId}/files/${body.fileId}`,
      { method: 'DELETE' }
    )
    expect(removed.status).toBe(204)

    const projectResponse = await fetch(`${server.base}/api/projects/${projectId}`)
    const project = (await projectResponse.json()) as CreateProjectResponse
    expect(project.project.files.map((file) => file.fileId)).not.toContain(body.fileId)
  })
})

describe('证据接口', () => {
  it('新建项目即有 40 个 missing 字段', async () => {
    const response = await fetch(`${server.base}/api/projects/${projectId}/evidence`)
    const doc = (await response.json()) as EvidenceDoc
    expect(response.status).toBe(200)
    expect(Object.keys(doc.fields)).toHaveLength(40)
    expect(doc.fields['company.name']?.status).toBe('missing')
  })

  it('确认写值后再次读取仍然在', async () => {
    const response = await fetch(
      `${server.base}/api/projects/${projectId}/evidence/fin.revenue`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manualValue: '1,320,000', unit: 'CNY' })
      }
    )
    const body = (await response.json()) as EvidencePatchResponse
    expect(response.status).toBe(200)
    expect(body.entry.status).toBe('confirmed')
    expect(body.entry.value).toBe(1320000)

    const again = await fetch(`${server.base}/api/projects/${projectId}/evidence`)
    const doc = (await again.json()) as EvidenceDoc
    expect(doc.fields['fin.revenue']?.value).toBe(1320000)
  })

  it('目录外字段返回 404', async () => {
    const response = await fetch(
      `${server.base}/api/projects/${projectId}/evidence/fin.notExist`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manualValue: 1 })
      }
    )
    const body = (await response.json()) as { error: string }
    expect(response.status).toBe(404)
    expect(body.error).toBe('field_not_found')
  })

  it('请求体字段类型不对返回 400', async () => {
    const response = await fetch(
      `${server.base}/api/projects/${projectId}/evidence/fin.revenue`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manualValue: { nested: true } })
      }
    )
    expect(response.status).toBe(400)
  })
})
