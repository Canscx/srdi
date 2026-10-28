import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  AutoConfirmResponse,
  CatalogResponse,
  FilePages,
  PageDoc
} from '@srdi/shared'
import { createStore } from '../src/store'
import { writeJson } from '../src/store/atomic'
import { startServer, type TestServer } from './helpers'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])

const page = (pageNo: number, text: string): PageDoc => ({
  fileId: '',
  page: pageNo,
  route: 'text',
  width: 1000,
  height: 1400,
  text,
  blocks: [],
  tables: [],
  printableChars: text.length,
  hasGlyphs: true,
  garbledRatio: 0
})

let dir = ''
let server: TestServer
let projectId = ''
let fileWithImage = ''
let fileWithoutImage = ''

const store = () => createStore(dir)

const addFile = async (input: {
  name: string
  pages: PageDoc[]
  shot?: boolean
}): Promise<string> => {
  const app = store()
  const fileId = `f_${Math.random().toString(36).slice(2, 10)}`
  const pagesDir = path.join(dir, 'projects', projectId, 'pages')
  const pages = input.pages.map((item) => ({ ...item, fileId }))

  if (input.shot !== false) {
    const shotDir = path.join(pagesDir, fileId)
    await mkdir(shotDir, { recursive: true })
    await writeFile(path.join(shotDir, 'p1.jpg'), JPEG)
    pages[0] = { ...pages[0], image: `pages/${fileId}/p1.jpg` }
  }

  const payload: FilePages = {
    fileId,
    name: input.name,
    kind: 'pdf',
    route: 'text',
    pages,
    truncated: false,
    visionSkipped: false,
    unreadable: [],
    parsedAt: new Date().toISOString()
  }
  await writeJson(path.join(pagesDir, `${fileId}.json`), payload)

  await app.projects.update(projectId, (meta) => {
    meta.files.push({
      fileId,
      name: input.name,
      sha256: `sha_${fileId}`,
      size: 2048,
      kind: 'pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      docType: 'audit',
      status: 'parsed',
      pages: pages.length,
      route: 'text',
      uploadedAt: new Date().toISOString()
    })
  })
  return fileId
}

const seedCandidates = async () => {
  const app = store()
  const project = await app.projects.get(projectId)
  const candidate = (
    id: string,
    value: number,
    confidence: number,
    quoteMatched: boolean | null,
    quote: string,
    pageNo = 1
  ) => ({
    candidateId: id,
    value,
    unit: 'CNY',
    period: project.period.y0,
    raw: quote,
    confidence,
    source: {
      fileId: fileWithImage,
      fileName: '审计报告.pdf',
      page: pageNo,
      route: 'text' as const,
      quote,
      quoteMatched,
      confidence
    }
  })

  await app.evidence.appendCandidates(project, 'fin.revenue', [
    candidate('c_ok', 132000000, 0.95, true, '营业收入 132,000,000.00')
  ])
  await app.evidence.appendCandidates(project, 'fin.netProfit', [
    candidate('c_low', 12000000, 0.6, true, '净利润 12,000,000.00')
  ])
  await app.evidence.appendCandidates(project, 'fin.rdExpense', [
    candidate('c_unverified', 8000000, 0.95, false, '研发费用 8,000,000.00')
  ])
  await app.evidence.appendCandidates(project, 'fin.totalAssets', [
    candidate('c_a', 200000000, 0.95, true, '资产总计 200,000,000.00'),
    candidate('c_b', 198000000, 0.9, true, '资产总计 198,000,000.00')
  ])
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-review-'))
  const project = await store().projects.create({ name: '确认页测试' })
  projectId = project.projectId

  fileWithImage = await addFile({
    name: '审计报告.pdf',
    pages: [
      page(1, '利润表\n营业收入 132,000,000.00\n净利润 12,000,000.00'),
      page(2, '研发费用 8,000,000.00')
    ]
  })
  fileWithoutImage = await addFile({
    name: '申报书.docx',
    pages: [page(1, '企业名称 某某科技有限公司')],
    shot: false
  })

  await seedCandidates()
  server = await startServer(dir)
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('确认页元数据', () => {
  it('字段目录带枚举值与自动确认策略', async () => {
    const response = await fetch(`${server.base}/api/meta/catalog`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as CatalogResponse
    expect(body.fields).toHaveLength(40)
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/)

    const quality = body.fields.find((field) => field.key === 'qual.qualityAward')
    expect(quality?.enumValues?.length).toBeGreaterThan(3)
    expect(quality?.label).toBe('质量管理体系认证')

    expect(body.autoConfirm.enabled).toBe(true)
    expect(body.autoConfirm.minConfidence).toBeGreaterThan(0)
  })

  it('页数据可读,未知文件返回 404', async () => {
    const response = await fetch(
      `${server.base}/api/projects/${projectId}/pages/${fileWithImage}`
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as FilePages
    expect(body.pages).toHaveLength(2)
    expect(body.pages[0].text).toContain('营业收入')

    const missing = await fetch(`${server.base}/api/projects/${projectId}/pages/f_missing`)
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toBe('pages_not_found')
  })
})

describe('页图接口', () => {
  it('返回 jpeg,越界与无图分别报错', async () => {
    const ok = await fetch(
      `${server.base}/api/files/${fileWithImage}/page/1?projectId=${projectId}`
    )
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toContain('image/jpeg')
    expect((await ok.arrayBuffer()).byteLength).toBe(JPEG.byteLength)

    const beyond = await fetch(
      `${server.base}/api/files/${fileWithImage}/page/9?projectId=${projectId}`
    )
    expect(beyond.status).toBe(404)
    expect(((await beyond.json()) as { error: string }).error).toBe('page_not_found')

    const noImage = await fetch(
      `${server.base}/api/files/${fileWithoutImage}/page/1?projectId=${projectId}`
    )
    expect(noImage.status).toBe(404)
    expect(((await noImage.json()) as { error: string }).error).toBe('page_image_missing')

    const unknown = await fetch(`${server.base}/api/files/f_nope/page/1`)
    expect(unknown.status).toBe(404)
    expect(((await unknown.json()) as { error: string }).error).toBe('file_not_found')
  })

  it('不带 projectId 时也能定位文件', async () => {
    const response = await fetch(`${server.base}/api/files/${fileWithImage}/page/1`)
    expect(response.status).toBe(200)
  })
})

describe('自动确认', () => {
  it('只确认单候选高置信度且原文匹配的字段', async () => {
    const response = await fetch(
      `${server.base}/api/projects/${projectId}/evidence/auto-confirm`,
      { method: 'POST' }
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as AutoConfirmResponse
    expect(body.confirmed).toContain('fin.revenue')
    expect(body.confirmed).not.toContain('fin.netProfit')
    expect(body.confirmed).not.toContain('fin.rdExpense')
    expect(body.confirmed).not.toContain('fin.totalAssets')

    const reason = (key: string) => body.skipped.find((item) => item.key === key)?.reason
    expect(reason('fin.netProfit')).toBe('low_confidence')
    expect(reason('fin.rdExpense')).toBe('quote_unverified')
    expect(reason('fin.totalAssets')).toBe('multiple_candidates')

    const app = store()
    const project = await app.projects.get(projectId)
    const evidence = await app.evidence.get(project)
    expect(evidence.fields['fin.revenue'].status).toBe('confirmed')
    expect(evidence.fields['fin.revenue'].value).toBe(132000000)
    expect(evidence.fields['fin.revenue'].resolution?.strategy).toBe('auto_single')
    expect(evidence.fields['fin.totalAssets'].status).toBe('candidate')
    expect(evidence.fields['fin.totalAssets'].value).toBeUndefined()
  })

  it('人工采纳冲突候选后写入 value', async () => {
    const app = store()
    const project = await app.projects.get(projectId)
    const evidence = await app.evidence.get(project)
    const candidate = evidence.fields['fin.totalAssets'].candidates?.find(
      (item) => item.candidateId === 'c_b'
    )
    expect(candidate).toBeTruthy()

    const response = await fetch(
      `${server.base}/api/projects/${projectId}/evidence/fin.totalAssets`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ candidateId: 'c_b' })
      }
    )
    expect(response.status).toBe(200)

    const after = await app.evidence.get(project)
    expect(after.fields['fin.totalAssets'].status).toBe('confirmed')
    expect(after.fields['fin.totalAssets'].value).toBe(198000000)
    expect(after.fields['fin.totalAssets'].resolution?.pickedCandidateId).toBe('c_b')
  })
})
