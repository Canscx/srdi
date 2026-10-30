import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PortalResultResponse } from '@srdi/shared'
import type { ModelClient, ModelRequest } from '../src/ai/client'
import { makeTextPdf, startServer, withTempDir } from './helpers'

const ACCOUNTS = {
  accounts: [
    { user: 'admin', password: 'admin-pass', role: 'admin' as const },
    { user: 'customer', password: 'vip666666', role: 'customer' as const }
  ]
}

const COMPANY = {
  name: '上海搜信网络科技有限公司',
  creditCode: '91310105MA1FW5R45P',
  phone: '13800001111',
  inventionCount: 1,
  softCopyrightCount: 9
}

const FIN_FIELDS: { key: string; period: number; value: number }[] = []
for (const period of [2025, 2024, 2023]) {
  FIN_FIELDS.push({
    key: 'fin.revenue',
    period,
    value: period === 2025 ? 14733263.93 : period === 2024 ? 339100.94 : 0
  })
  FIN_FIELDS.push({
    key: 'fin.netProfit',
    period,
    value: period === 2025 ? 812000 : period === 2024 ? 120000 : 0
  })
  FIN_FIELDS.push({
    key: 'fin.netAssets',
    period,
    value: period === 2025 ? 900000 : period === 2024 ? 600000 : 500000
  })
}

const mockAi = (): ModelClient => ({
  complete: async (request: ModelRequest) => ({
    text: JSON.stringify({
      pageRange: [1, 1],
      fields: FIN_FIELDS.map((item) => ({
        key: item.key,
        found: true,
        period: item.period,
        value: item.value,
        unit: 'CNY',
        raw: `${item.value}`,
        page: 1,
        quote: `${item.value}`,
        confidence: 0.95
      })),
      documentMeta: { docType: 'audit', companyName: COMPANY.name, reportYear: 2025 },
      unreadable: []
    }),
    usage: { promptTokens: 120, completionTokens: 60 },
    model: request.model
  })
})

interface Session {
  request: (path: string, init?: RequestInit) => Promise<Response>
  cookieHeader: () => string
  override: (name: string, value: string) => void
}

const session = (base: string): Session => {
  const jar: Record<string, string> = {}
  const absorb = (response: Response) => {
    for (const raw of response.headers.getSetCookie()) {
      const pair = raw.split(';')[0]
      const eq = pair.indexOf('=')
      if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
    }
  }
  const cookieHeader = () =>
    Object.entries(jar)
      .map(([key, value]) => `${key}=${value}`)
      .join('; ')
  return {
    request: async (path, init = {}) => {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieHeader() }
      })
      absorb(response)
      return response
    },
    cookieHeader,
    override: (name, value) => {
      jar[name] = value
    }
  }
}

const signIn = async (client: Session, username: string, password: string) => {
  const response = await client.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  })
  expect(response.status).toBe(200)
}

const upload = async (client: Session, projectId: string, name: string, slot: string) => {
  const form = new FormData()
  form.append('file', new Blob([await makeTextPdf()], { type: 'application/pdf' }), name)
  const response = await client.request(`/api/portal/projects/${projectId}/files?slot=${slot}`, {
    method: 'POST',
    body: form
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { fileId: string }
}

const waitJob = async (client: Session, jobId: string) => {
  for (let index = 0; index < 150; index += 1) {
    const response = await client.request(`/api/portal/jobs/${jobId}`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { job: { stage: string; pct: number } }
    if (body.job.stage === 'done' || body.job.stage === 'failed') return body.job
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('任务超时')
}

const createProject = async (client: Session) => {
  const response = await client.request('/api/portal/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ company: COMPANY })
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { projectId: string }
}

describe('客户轻流程', () => {
  it(
    '创建 → 上传 → 一键评估 → 结果,三年财务合并生效',
    async () => {
      await withTempDir(async (dir) => {
        const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
        try {
          const client = session(server.base)
          await signIn(client, 'customer', 'vip666666')

          const configResponse = await client.request('/api/portal/config')
          expect(configResponse.status).toBe(200)
          const configBody = (await configResponse.json()) as {
            config: { passLine: number; slots: { id: string }[] }
          }
          expect(configBody.config.passLine).toBe(60)
          expect(configBody.config.slots.map((slot) => slot.id)).toEqual([
            'finance',
            'tax',
            'ledger',
            'extra'
          ])

          const created = await createProject(client)
          await upload(client, created.projectId, '2025年度财务报表.pdf', 'finance')

          const assessResponse = await client.request(
            `/api/portal/projects/${created.projectId}/assess`,
            { method: 'POST' }
          )
          expect(assessResponse.status).toBe(202)
          const { jobId } = (await assessResponse.json()) as { jobId: string }

          const job = await waitJob(client, jobId)
          expect(job.stage).toBe('done')

          const resultResponse = await client.request(
            `/api/portal/projects/${created.projectId}/result`
          )
          expect(resultResponse.status).toBe(200)
          const result = (await resultResponse.json()) as PortalResultResponse

          expect(result.status).toBe('ready')
          expect(result.score).not.toBeNull()
          expect(result.score?.passLine).toBe(60)
          expect(result.dimensions).toHaveLength(5)
          expect(result.checks.length).toBeGreaterThan(10)
          expect(result.company.creditCode).toBe(COMPANY.creditCode)

          const growth = result.checks.find((item) => item.code === 21)
          expect(growth?.raw).toBeCloseTo((14733263.93 - 339100.94) / 339100.94, 4)
          expect(growth?.mark).not.toBe('missing')

          const invention = result.checks.find((item) => item.code === 17)
          expect(invention).toBeDefined()
          expect(invention?.mark).not.toBe('missing')
          expect(result.missingSlots.map((slot) => slot.id)).toContain('tax')
          expect(result.missingSlots.map((slot) => slot.id)).not.toContain('finance')

          const report = await client.request(
            `/api/portal/projects/${created.projectId}/report`
          )
          expect(report.status).toBe(200)
          expect(report.headers.get('content-type')).toContain('application/pdf')
          const pdf = Buffer.from(await report.arrayBuffer())
          expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

          const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
          const parsed = await getDocument({ data: new Uint8Array(pdf) }).promise
          expect(parsed.numPages).toBeGreaterThanOrEqual(3)
          expect(parsed.numPages).toBeLessThanOrEqual(5)

          const firstPage = await parsed.getPage(1)
          const text = (await firstPage.getTextContent()).items
            .map((item) => ('str' in item ? item.str : ''))
            .join('')
          expect(text).toContain(COMPANY.name)

          const secondPage = await parsed.getPage(2)
          const checklist = (await secondPage.getTextContent()).items
            .map((item) => ('str' in item ? item.str : ''))
            .join('')
          expect(checklist).toContain('√')
          expect(checklist).toContain('○')
        } finally {
          await server.close()
        }
      })
    },
    120000
  )

  it(
    '别的浏览器看不到该项目,后台能按企业名检索到',
    async () => {
      await withTempDir(async (dir) => {
        const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
        try {
          const client = session(server.base)
          await signIn(client, 'customer', 'vip666666')
          const created = await createProject(client)

          client.override('srdi_client', 'anotherbrowser0001')
          const peek = await client.request(`/api/portal/projects/${created.projectId}/result`)
          expect(peek.status).toBe(404)

          client.override('srdi_client', 'anotherbrowser0002')
          const mine = await client.request('/api/portal/projects')
          const list = (await mine.json()) as { projects: { projectId: string }[] }
          expect(list.projects.map((item) => item.projectId)).not.toContain(created.projectId)

          const admin = session(server.base)
          await signIn(admin, 'admin', 'admin-pass')
          const submissions = await admin.request(
            `/api/admin/submissions?q=${encodeURIComponent('搜信')}`
          )
          expect(submissions.status).toBe(200)
          const body = (await submissions.json()) as {
            items: { projectId: string; companyName: string; hasScore: boolean }[]
          }
          expect(body.items.map((item) => item.projectId)).toContain(created.projectId)
          expect(body.items[0].companyName).toBe(COMPANY.name)
          expect(body.items[0].hasScore).toBe(false)
        } finally {
          await server.close()
        }
      })
    },
    60000
  )

  it('没有文件时评估被拒,未打分时结果返回 409', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client, 'customer', 'vip666666')
        const created = await createProject(client)

        const assess = await client.request(`/api/portal/projects/${created.projectId}/assess`, {
          method: 'POST'
        })
        expect(assess.status).toBe(400)

        const result = await client.request(`/api/portal/projects/${created.projectId}/result`)
        expect(result.status).toBe(409)
      } finally {
        await server.close()
      }
    })
  })

  it('企业信息不合规时返回 400,信用代码可以留空', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client, 'customer', 'vip666666')
        const bad = await client.request('/api/portal/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ company: { name: '测试', creditCode: '123' } })
        })
        expect(bad.status).toBe(400)
        const body = (await bad.json()) as { error: string }
        expect(body.error).toBe('invalid_company')

        const noCode = await client.request('/api/portal/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ company: { name: '只填名称也能建', phone: '13800001111' } })
        })
        expect(noCode.status).toBe(201)
        const created = (await noCode.json()) as { projectId: string }
        expect(created.projectId).toMatch(/^p_/)

        const noPhone = await client.request('/api/portal/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ company: { name: '不填手机号' } })
        })
        expect(noPhone.status).toBe(400)
      } finally {
        await server.close()
      }
    })
  })
})

describe('历史报告找回', () => {
  const lookup = (client: Session, companyName: string, phoneTail: string) =>
    client.request('/api/portal/lookup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyName, phoneTail })
    })

  it(
    '换浏览器用企业全称加后四位找回，并自动绑定该浏览器',
    async () => {
      await withTempDir(async (dir) => {
        const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
        try {
          const owner = session(server.base)
          await signIn(owner, 'customer', 'vip666666')
          const created = await createProject(owner)
          await upload(owner, created.projectId, '2025年度财务报表.pdf', 'finance')
          const started = await owner.request(
            `/api/portal/projects/${created.projectId}/assess`,
            { method: 'POST' }
          )
          const { jobId } = (await started.json()) as { jobId: string }
          await waitJob(owner, jobId)

          const other = session(server.base)
          await signIn(other, 'customer', 'vip666666')

          const denied = await other.request(`/api/portal/projects/${created.projectId}/result`)
          expect(denied.status).toBe(404)

          const found = await lookup(other, COMPANY.name, '1111')
          expect(found.status).toBe(200)
          const body = (await found.json()) as {
            projects: { projectId: string; hasScore: boolean }[]
          }
          expect(body.projects.map((item) => item.projectId)).toContain(created.projectId)
          expect(body.projects[0].hasScore).toBe(true)

          const granted = await other.request(`/api/portal/projects/${created.projectId}/result`)
          expect(granted.status).toBe(200)

          const list = await other.request('/api/portal/projects')
          const listed = (await list.json()) as { projects: { projectId: string }[] }
          expect(listed.projects.map((item) => item.projectId)).toContain(created.projectId)
        } finally {
          await server.close()
        }
      })
    },
    120000
  )

  it('后四位错与名称不存在返回同一个错误,不泄露哪一项错了', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client, 'customer', 'vip666666')
        await createProject(client)

        const wrongTail = await lookup(client, COMPANY.name, '9999')
        expect(wrongTail.status).toBe(404)
        const tailBody = (await wrongTail.json()) as { error: string; message: string }
        expect(tailBody.error).toBe('lookup_failed')

        const wrongName = await lookup(client, '并不存在的科技有限公司', '1111')
        expect(wrongName.status).toBe(404)
        const nameBody = (await wrongName.json()) as { error: string; message: string }
        expect(nameBody.error).toBe('lookup_failed')
        expect(nameBody.message).toBe(tailBody.message)
      } finally {
        await server.close()
      }
    })
  })

  it('连续失败超过上限后返回 429 与 Retry-After', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client, 'customer', 'vip666666')
        await createProject(client)

        for (let index = 0; index < 10; index += 1) {
          const attempt = await lookup(client, COMPANY.name, '0000')
          expect(attempt.status).toBe(404)
        }

        const blocked = await lookup(client, COMPANY.name, '0000')
        expect(blocked.status).toBe(429)
        expect(blocked.headers.get('retry-after')).toBeTruthy()
        const body = (await blocked.json()) as { error: string }
        expect(body.error).toBe('too_many_attempts')
      } finally {
        await server.close()
      }
    })
  })

  it('只有 clientId 没有 claims 的旧项目仍然可访问', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client, 'customer', 'vip666666')
        const created = await createProject(client)

        const metaPath = path.join(dir, 'projects', created.projectId, 'project.json')
        const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as Record<string, unknown>
        expect(Array.isArray(meta.claims)).toBe(true)
        delete meta.claims
        writeFileSync(metaPath, JSON.stringify(meta))

        const list = await client.request('/api/portal/projects')
        const listed = (await list.json()) as { projects: { projectId: string }[] }
        expect(listed.projects.map((item) => item.projectId)).toContain(created.projectId)

        const result = await client.request(`/api/portal/projects/${created.projectId}/result`)
        expect(result.status).toBe(409)
      } finally {
        await server.close()
      }
    })
  })
})

describe('管理员评分页数据', () => {
  it(
    '返回与客户页同构的结果,并附带专业视图数据',
    async () => {
      await withTempDir(async (dir) => {
        const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
        try {
          const owner = session(server.base)
          await signIn(owner, 'customer', 'vip666666')
          const created = await createProject(owner)
          await upload(owner, created.projectId, '2025年度财务报表.pdf', 'finance')
          const started = await owner.request(
            `/api/portal/projects/${created.projectId}/assess`,
            { method: 'POST' }
          )
          const { jobId } = (await started.json()) as { jobId: string }
          await waitJob(owner, jobId)

          const admin = session(server.base)
          await signIn(admin, 'admin', 'admin-pass')
          const response = await admin.request(`/api/admin/projects/${created.projectId}/result`)
          expect(response.status).toBe(200)
          const body = (await response.json()) as {
            projectName: string
            dimensions: unknown[]
            checks: unknown[]
            advices: unknown[]
            professional: {
              record: { result: { gates: unknown[]; totals: { conservative: number } } }
              rules: { assumptions: unknown[]; dimensions: unknown[] }
            }
          }
          expect(body.projectName).toBe(COMPANY.name)
          expect(body.dimensions).toHaveLength(5)
          expect(body.checks.length).toBeGreaterThan(10)
          expect(body.advices.length).toBeGreaterThan(0)
          expect(body.professional.record.result.gates).toHaveLength(6)
          expect(typeof body.professional.record.result.totals.conservative).toBe('number')
          expect(body.professional.rules.dimensions).toHaveLength(5)
          expect(body.professional.rules.assumptions.length).toBeGreaterThan(0)
        } finally {
          await server.close()
        }
      })
    },
    120000
  )

  it(
    '管理员导出的是客户版 PDF',
    async () => {
      await withTempDir(async (dir) => {
        const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
        try {
          const owner = session(server.base)
          await signIn(owner, 'customer', 'vip666666')
          const created = await createProject(owner)
          await upload(owner, created.projectId, '2025年度财务报表.pdf', 'finance')
          const started = await owner.request(
            `/api/portal/projects/${created.projectId}/assess`,
            { method: 'POST' }
          )
          const { jobId } = (await started.json()) as { jobId: string }
          await waitJob(owner, jobId)

          const admin = session(server.base)
          await signIn(admin, 'admin', 'admin-pass')
          const report = await admin.request(`/api/admin/projects/${created.projectId}/report`)
          expect(report.status).toBe(200)
          expect(report.headers.get('content-type')).toContain('application/pdf')
          expect(report.headers.get('content-disposition')).toContain("filename*=UTF-8''")
          const pdf = Buffer.from(await report.arrayBuffer())
          expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

          const customer = session(server.base)
          await signIn(customer, 'customer', 'vip666666')
          const denied = await customer.request(`/api/admin/projects/${created.projectId}/result`)
          expect(denied.status).toBe(403)
        } finally {
          await server.close()
        }
      })
    },
    120000
  )

  it('未评分时返回 409', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const owner = session(server.base)
        await signIn(owner, 'customer', 'vip666666')
        const created = await createProject(owner)

        const admin = session(server.base)
        await signIn(admin, 'admin', 'admin-pass')
        const response = await admin.request(`/api/admin/projects/${created.projectId}/result`)
        expect(response.status).toBe(409)
        const body = (await response.json()) as { error: string }
        expect(body.error).toBe('score_required')
      } finally {
        await server.close()
      }
    })
  })
})
