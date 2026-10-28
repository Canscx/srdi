import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DocType, EvidenceDoc, ExtractRequestResponse, FilePages, PageDoc } from '@srdi/shared'
import type { ModelClient, ModelRequest } from '../src/ai/client'
import { extractProject } from '../src/ai/extract'
import { createStore } from '../src/store'
import { writeJson } from '../src/store/atomic'
import { startServer, type TestServer } from './helpers'

interface MockCall {
  system: string
  user: string
}

const mockClient = (respond: (call: MockCall, index: number) => string, usage = { promptTokens: 100, completionTokens: 50 }) => {
  const calls: MockCall[] = []
  const client: ModelClient = {
    complete: async (request: ModelRequest) => {
      const system = String(request.messages[0].content)
      const content = request.messages[1].content
      const user =
        typeof content === 'string'
          ? content
          : content
              .map((part) => (part.type === 'text' ? part.text : '[image]'))
              .join('\n')
      calls.push({ system, user })
      return {
        text: respond({ system, user }, calls.length - 1),
        usage: { ...usage },
        model: request.model
      }
    }
  }
  return { calls, client }
}

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

type Store = ReturnType<typeof createStore>

const addFile = async (
  store: Store,
  projectId: string,
  input: { name: string; docType?: DocType; pages: PageDoc[] }
) => {
  const fileId = `f_${Math.random().toString(36).slice(2, 10)}`
  const filePages: FilePages = {
    fileId,
    name: input.name,
    kind: 'pdf',
    route: 'text',
    pages: input.pages,
    truncated: false,
    visionSkipped: false,
    unreadable: [],
    parsedAt: new Date().toISOString()
  }
  await writeJson(path.join(store.projects.dir(projectId), 'pages', `${fileId}.json`), filePages)
  await store.projects.update(projectId, (meta) => {
    meta.files.push({
      fileId,
      name: input.name,
      sha256: `sha_${fileId}`,
      size: 2048,
      kind: 'pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      docType: input.docType,
      status: 'parsed',
      pages: input.pages.length,
      route: 'text',
      uploadedAt: new Date().toISOString()
    })
  })
  return fileId
}

const payload = (docType: DocType, fields: unknown[], reportYear = 2025) =>
  JSON.stringify({
    pageRange: [1, 1],
    fields,
    documentMeta: { docType, companyName: '测试科技有限公司', reportYear },
    unreadable: []
  })

let dir = ''
let store: Store
let projectId = ''

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-ai-'))
  store = createStore(dir)
  const project = await store.projects.create({ name: 'AI 抽取链路' })
  projectId = project.projectId
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('四类 docType 抽取', () => {
  it('候选带 fileId / page / quote / confidence,且只写候选不写 value', async () => {
    await addFile(store, projectId, {
      name: '2025 审计报告.pdf',
      docType: 'audit',
      pages: [textPage(1, '利润表\n营业收入 132,000,000.00\n营业成本 88,000,000.00')]
    })
    await addFile(store, projectId, {
      name: '专利清单.pdf',
      docType: 'patent',
      pages: [textPage(1, 'PCT 申请 3 项\n授权发明专利 7 件')]
    })
    await addFile(store, projectId, {
      name: '科技奖励证书.pdf',
      docType: 'cert',
      pages: [textPage(1, '获得省科技进步奖 二等奖')]
    })
    await addFile(store, projectId, {
      name: '标准起草证明.pdf',
      docType: 'standard',
      pages: [textPage(1, '主持国家标准 GB/T 1234-2020')]
    })

    const { calls, client } = mockClient(({ system }) => {
      if (system.includes('fin.revenue\t')) {
        return payload('audit', [
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
        ])
      }
      if (system.includes('ip.pctCount\t')) {
        return payload('patent', [
          {
            key: 'ip.pctCount',
            found: true,
            value: 3,
            unit: 'count',
            raw: 'PCT 申请 3 项',
            page: 1,
            quote: 'PCT 申请 3 项',
            confidence: 0.9
          }
        ])
      }
      if (system.includes('qual.scienceAward\t')) {
        return payload('cert', [
          {
            key: 'qual.scienceAward',
            found: true,
            value: true,
            raw: '获得省科技进步奖',
            page: 1,
            quote: '获得省科技进步奖',
            confidence: 0.88
          }
        ])
      }
      expect(system).toContain('std.hostedNatInd\t')
      return payload('standard', [
        {
          key: 'std.hostedNatInd',
          found: true,
          value: ['GB/T 1234-2020'],
          raw: '主持国家标准 GB/T 1234-2020',
          page: 1,
          quote: '主持国家标准 GB/T 1234-2020',
          confidence: 0.92
        }
      ])
    })

    const outcome = await extractProject(store, projectId, () => {}, {
      client,
      model: 'mock-model'
    })

    expect(calls).toHaveLength(4)
    expect(outcome.files).toBe(4)
    expect(outcome.cached).toBe(0)
    expect(outcome.candidates).toBe(4)

    const project = await store.projects.get(projectId)
    const evidence = await store.evidence.get(project)

    for (const key of ['fin.revenue', 'ip.pctCount', 'qual.scienceAward', 'std.hostedNatInd']) {
      const entry = evidence.fields[key]
      expect(entry.status, key).toBe('candidate')
      expect(entry.value, key).toBeUndefined()
      expect(entry.candidates).toHaveLength(1)
      const source = entry.candidates![0].source
      expect(source.fileId).toMatch(/^f_/)
      expect(source.page).toBe(1)
      expect(source.quote).toBeTruthy()
      expect(source.confidence).toBeGreaterThan(0)
      expect(source.extractor).toBe('ai:mock-model:p1')
    }

    expect(evidence.fields['fin.revenue'].candidates![0].value).toBe(132000000)
    expect(evidence.fields['fin.revenue'].candidates![0].period).toBe(2025)
    expect(evidence.fields['qual.scienceAward'].candidates![0].value).toBe(true)
    expect(evidence.fields['std.hostedNatInd'].candidates![0].value).toEqual(['GB/T 1234-2020'])
    expect(evidence.files).toHaveLength(4)
  })

  it('AI 的 documentMeta.docType 覆盖文件名启发式', async () => {
    const fileId = await addFile(store, projectId, {
      name: '审计报告.pdf',
      docType: 'audit',
      pages: [textPage(1, 'PCT 申请 5 项')]
    })

    const { calls, client } = mockClient(({ system }, index) => {
      if (index === 0) {
        return payload('patent', [
          {
            key: 'fin.revenue',
            found: false,
            page: 1
          }
        ])
      }
      expect(system).toContain('ip.pctCount')
      return payload('patent', [
        {
          key: 'ip.pctCount',
          found: true,
          value: 5,
          unit: 'count',
          raw: 'PCT 申请 5 项',
          page: 1,
          quote: 'PCT 申请 5 项',
          confidence: 0.9
        }
      ])
    })

    const outcome = await extractProject(store, projectId, () => {}, {
      client,
      model: 'mock-model'
    })

    expect(calls).toHaveLength(2)
    expect(outcome.docTypes[fileId]).toBe('patent')

    const project = await store.projects.get(projectId)
    expect(project.files[0].docType).toBe('patent')
    const evidence = await store.evidence.get(project)
    expect((evidence.files?.[0] as { docType: string }).docType).toBe('patent')
    expect(evidence.fields['ip.pctCount'].candidates).toHaveLength(1)
  })
})

describe('缓存与预算', () => {
  it('二次抽取零请求', async () => {
    await addFile(store, projectId, {
      name: '审计报告.pdf',
      docType: 'audit',
      pages: [textPage(1, '营业收入 132,000,000.00')]
    })

    const { calls, client } = mockClient(() =>
      payload('audit', [
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
      ])
    )

    const first = await extractProject(store, projectId, () => {}, { client, model: 'mock-model' })
    expect(first.cached).toBe(0)
    const firstCalls = calls.length
    expect(firstCalls).toBeGreaterThan(0)

    const second = await extractProject(store, projectId, () => {}, { client, model: 'mock-model' })
    expect(calls.length).toBe(firstCalls)
    expect(second.cached).toBe(1)
    expect(second.files).toBe(1)

    const project = await store.projects.get(projectId)
    const evidence = await store.evidence.get(project)
    expect(evidence.fields['fin.revenue'].candidates).toHaveLength(1)
  })

  it('token 预算耗尽后停止调用并保留已完成部分', async () => {
    await addFile(store, projectId, {
      name: '长审计报告.pdf',
      docType: 'audit',
      pages: Array.from({ length: 8 }, (_, index) =>
        textPage(index + 1, `第 ${index + 1} 页 营业收入 132,000,000.00`)
      )
    })

    const { calls, client } = mockClient(
      () =>
        payload('audit', [
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
        ]),
      { promptTokens: 400000, completionTokens: 0 }
    )

    const outcome = await extractProject(store, projectId, () => {}, {
      client,
      model: 'mock-model'
    })

    expect(calls).toHaveLength(1)
    expect(outcome.budgetExhausted).toBe(true)
    expect(outcome.chunks.failed).toBeGreaterThan(0)

    const project = await store.projects.get(projectId)
    const evidence = await store.evidence.get(project)
    expect(evidence.fields['fin.revenue'].candidates?.length).toBeGreaterThan(0)
  })
})

describe('五级校验', () => {
  it('单块失败隔离,其他块照常落候选', async () => {
    await addFile(store, projectId, {
      name: '长报告.pdf',
      docType: 'audit',
      pages: Array.from({ length: 8 }, (_, index) =>
        textPage(index + 1, `第 ${index + 1} 页 营业收入 132,000,000.00`)
      )
    })

    const { client } = mockClient(({ user }) => {
      if (user.includes('### p7')) return '这不是 JSON'
      return payload('audit', [
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
      ])
    })

    const outcome = await extractProject(store, projectId, () => {}, {
      client,
      model: 'mock-model'
    })

    expect(outcome.chunks.total).toBe(2)
    expect(outcome.chunks.failed).toBe(1)
    expect(outcome.warnings.join('\n')).toContain('识别失败')

    const project = await store.projects.get(projectId)
    const evidence = await store.evidence.get(project)
    expect(evidence.fields['fin.revenue'].candidates?.length).toBeGreaterThan(0)
  })

  it('quote 未命中压分、万元换算、页越界丢弃', async () => {
    await addFile(store, projectId, {
      name: '审计报告.pdf',
      docType: 'audit',
      pages: [textPage(1, '营业收入 132,000,000.00\n净利润 356.8 万元')]
    })

    const { client } = mockClient(() =>
      payload('audit', [
        {
          key: 'fin.revenue',
          found: true,
          period: 2025,
          value: 132000000,
          unit: 'CNY',
          raw: '营业收入 132,000,000.00',
          page: 1,
          quote: '营业收入 999,999.00',
          confidence: 0.95
        },
        {
          key: 'fin.netProfit',
          found: true,
          period: 2025,
          value: 356.8,
          unit: '万元',
          raw: '356.8 万元',
          page: 1,
          quote: '净利润 356.8 万元',
          confidence: 0.9
        },
        {
          key: 'fin.rdExpense',
          found: true,
          period: 2025,
          value: 12000000,
          unit: 'CNY',
          page: 9,
          quote: '研发费用'
        }
      ])
    )

    await extractProject(store, projectId, () => {}, { client, model: 'mock-model' })

    const project = await store.projects.get(projectId)
    const evidence = await store.evidence.get(project)

    const revenue = evidence.fields['fin.revenue'].candidates?.[0]
    expect(revenue?.confidence).toBe(0.5)
    expect(revenue?.source.quoteMatched).toBe(false)

    const netProfit = evidence.fields['fin.netProfit'].candidates?.[0]
    expect(netProfit?.value).toBe(3568000)
    expect(netProfit?.source.quoteMatched).toBe(true)

    expect(evidence.fields['fin.rdExpense'].candidates ?? []).toHaveLength(0)
  })
})

describe('抽取接口', () => {
  let server: TestServer | null = null

  afterEach(async () => {
    if (server) await server.close()
    server = null
  })

  it('未解析时拒绝抽取,解析后返回 jobId 并落证据', async () => {
    const project = await store.projects.create({ name: '接口测试' })

    const { client } = mockClient(() =>
      payload('audit', [
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
      ])
    )

    await addFile(store, project.projectId, {
      name: '审计报告.pdf',
      docType: 'audit',
      pages: [textPage(1, '营业收入 132,000,000.00')]
    })
    await store.projects.update(project.projectId, (meta) => {
      meta.files.forEach((file) => {
        file.status = 'pending'
      })
    })

    server = await startServer(dir, undefined, client)

    const rejected = await fetch(`${server.base}/api/projects/${project.projectId}/extract`, {
      method: 'POST'
    })
    expect(rejected.status).toBe(400)
    expect(((await rejected.json()) as { error: string }).error).toBe('not_parsed')

    await store.projects.update(project.projectId, (meta) => {
      meta.files.forEach((file) => {
        file.status = 'parsed'
      })
    })

    const accepted = await fetch(`${server.base}/api/projects/${project.projectId}/extract`, {
      method: 'POST'
    })
    expect(accepted.status).toBe(202)
    const body = (await accepted.json()) as ExtractRequestResponse
    expect(body.jobId).toMatch(/^j_/)

    const deadline = Date.now() + 20000
    let stage = ''
    while (Date.now() < deadline) {
      const response = await fetch(`${server.base}/api/jobs/${body.jobId}`)
      const job = ((await response.json()) as { job: { stage: string } }).job
      stage = job.stage
      if (stage === 'done' || stage === 'failed') break
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    expect(stage).toBe('done')

    const evidenceResponse = await fetch(
      `${server.base}/api/projects/${project.projectId}/evidence`
    )
    const evidence = (await evidenceResponse.json()) as EvidenceDoc
    expect(evidence.fields['fin.revenue'].status).toBe('candidate')
    expect(evidence.fields['fin.revenue'].candidates?.[0].source.fileId).toMatch(/^f_/)
  })
})
