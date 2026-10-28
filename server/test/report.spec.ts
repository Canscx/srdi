import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { EvidenceDoc } from '@srdi/shared'
import { createStore } from '../src/store'
import { writeJson } from '../src/store/atomic'
import { startServer, type TestServer } from './helpers'

const PERIOD = { y0: 2025, y1: 2024, y2: 2023 }

const readFixture = (name: string): EvidenceDoc =>
  JSON.parse(
    readFileSync(new URL(`../../shared/test/fixtures/${name}.json`, import.meta.url), 'utf8')
  ) as EvidenceDoc

let dir = ''
let server: TestServer
let projectId = ''
let staleProjectId = ''
let emptyProjectId = ''

const store = () => createStore(dir)

const seed = async (name: string, fixture?: string) => {
  const app = store()
  const project = await app.projects.create({ name, period: PERIOD })
  if (fixture) {
    const doc = readFixture(fixture)
    doc.projectId = project.projectId
    await writeJson(path.join(dir, 'projects', project.projectId, 'evidence.json'), doc)
  }
  return project.projectId
}

const scoreOf = async (id: string) => {
  const response = await fetch(`${server.base}/api/projects/${id}/score`, { method: 'POST' })
  expect(response.status).toBe(200)
}

const reportUrl = (id: string, format: string) =>
  `${server.base}/api/projects/${id}/report?format=${format}`

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-report-'))
  projectId = await seed('南京鼎新精密机械有限公司（虚构）', 'firm-a')
  staleProjectId = await seed('苏州恒锐机电科技有限公司（虚构）', 'firm-b')
  emptyProjectId = await seed('未打分项目')
  server = await startServer(dir)
  await scoreOf(projectId)
  await scoreOf(staleProjectId)

  const patch = await fetch(
    `${server.base}/api/projects/${staleProjectId}/evidence/fin.revenue`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'missing' })
    }
  )
  expect(patch.status).toBe(200)
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('Markdown 报告', () => {
  it('双处非官方声明、六门槛与 23 项明细齐全', async () => {
    const response = await fetch(reportUrl(projectId, 'md'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/markdown')

    const disposition = response.headers.get('content-disposition') ?? ''
    expect(disposition).toContain('attachment')
    expect(disposition).toContain("filename*=UTF-8''")
    expect(disposition).toContain('.md')

    const text = await response.text()
    expect(text).toContain('# 南京鼎新精密机械有限公司（虚构） · 专精特新中小企业自评报告')
    expect(text).toContain('84.81')
    expect(text).toContain('参考得分 · 非官方口径')
    expect(text.match(/非官方口径/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(text).toContain('## 一、结论摘要')
    expect(text).toContain('## 四、门槛判定')
    expect(text).toContain('GATE_6')
    expect(text).toContain('IND_18')
    expect(text).not.toContain('[object Object]')
    expect(text).not.toContain('undefined')

    const indicatorRows = text
      .split('\n')
      .filter((line) => /^\| \d+ \|/.test(line.trim()))
    expect(indicatorRows).toHaveLength(23)
  })

  it('json 格式返回报告模型与 40 字段', async () => {
    const response = await fetch(reportUrl(projectId, 'json'))
    expect(response.status).toBe(200)
    const model = (await response.json()) as {
      stale: boolean
      fields: unknown[]
      indicators: unknown[]
      record: { result: { totals: { official: number } } }
    }
    expect(model.fields).toHaveLength(40)
    expect(model.indicators).toHaveLength(23)
    expect(model.record.result.totals.official).toBe(84.81)
    expect(model.stale).toBe(false)
  })

  it('证据在打分后变动时报告标注过期', async () => {
    const response = await fetch(reportUrl(staleProjectId, 'md'))
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('证据在打分之后有变动')
    expect(text).toContain('建议回评分页重新计算')
  })

  it('未打分与非法格式分别报错', async () => {
    const missing = await fetch(reportUrl(emptyProjectId, 'md'))
    expect(missing.status).toBe(409)
    expect(((await missing.json()) as { error: string }).error).toBe('score_required')

    const invalid = await fetch(reportUrl(projectId, 'docx'))
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: string }).error).toBe('invalid_format')
  })
})

describe('PDF 报告', () => {
  it('返回合法 PDF,中文可提取且分页正常', async () => {
    const response = await fetch(reportUrl(projectId, 'pdf'))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('content-disposition') ?? '').toContain('.pdf')

    const buffer = Buffer.from(await response.arrayBuffer())
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.byteLength).toBeGreaterThan(20000)

    const task = getDocument({ data: new Uint8Array(buffer), disableFontFace: true })
    const doc = await task.promise
    expect(doc.numPages).toBeGreaterThanOrEqual(2)

    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join('')
      )
    }
    await task.destroy()

    const all = pages.join('\n')
    expect(all).toContain('南京鼎新精密机械有限公司')
    expect(all).toContain('参考得分')
    expect(all).toContain('非官方口径')
    expect(all).toContain('门槛判定')
    expect(all).toContain('材料清单')
    expect(all).not.toContain('\uFFFD')
  }, 20000)
})
