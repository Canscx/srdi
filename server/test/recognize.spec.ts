import { describe, expect, it } from 'vitest'
import type { LicenseProfile } from '@srdi/shared'
import type { ModelClient, ModelRequest } from '../src/ai/client'
import { buildZip, makePng, startServer, withTempDir } from './helpers'

const ACCOUNTS = {
  accounts: [
    { user: 'admin', password: 'admin-pass', role: 'admin' as const },
    { user: 'customer', password: 'vip666666', role: 'customer' as const }
  ]
}

const mockAi = (payload?: Record<string, unknown>): ModelClient => ({
  complete: async (request: ModelRequest) => ({
    text: JSON.stringify(
      payload ?? {
        businessScope: '一般项目：技术服务、技术开发、技术咨询；许可项目：第二类增值电信业务。',
        registeredCapital: 1000000,
        establishedDate: '2017-01-20'
      }
    ),
    usage: { promptTokens: 120, completionTokens: 60 },
    model: request.model
  })
})

interface Session {
  request: (path: string, init?: RequestInit) => Promise<Response>
}

const cookieOf = (jar: Record<string, string>) =>
  Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`)
    .join('; ')

const session = (base: string): Session => {
  const jar: Record<string, string> = {}
  return {
    request: async (path, init = {}) => {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), cookie: cookieOf(jar) }
      })
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(';')[0]
        const eq = pair.indexOf('=')
        if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim()
      }
      return response
    }
  }
}

const signIn = async (client: Session) => {
  const response = await client.request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'customer', password: 'vip666666' })
  })
  expect(response.status).toBe(200)
}

const upload = (client: Session, data: Buffer, name: string, type: string) => {
  const form = new FormData()
  form.append('file', new Blob([data], { type }), name)
  return client.request('/api/portal/recognize', { method: 'POST', body: form })
}

describe('营业执照预识别', () => {
  it('返回三项信息，不含信用代码；同文件再传命中缓存', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client)

        const first = await upload(client, makePng(), '营业执照.png', 'image/png')
        expect(first.status).toBe(200)
        const profile = (await first.json()) as LicenseProfile
        expect(profile.businessScope).toContain('一般项目')
        expect(profile.businessScope).not.toContain('经营范围')
        expect(profile.registeredCapital).toBe(1000000)
        expect(profile.establishedDate).toBe('2017-01-20')
        expect(profile.cached).toBe(false)
        expect('creditCode' in profile).toBe(false)

        const second = await upload(client, makePng(), '营业执照.png', 'image/png')
        const cached = (await second.json()) as LicenseProfile
        expect(cached.cached).toBe(true)
        expect(cached.establishedDate).toBe('2017-01-20')
      } finally {
        await server.close()
      }
    })
  })

  it('模型什么都没读出时返回空三项并提示重传', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi({}), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client)

        const response = await upload(client, makePng(), '执照.png', 'image/png')
        const profile = (await response.json()) as LicenseProfile
        expect(profile.businessScope).toBe('')
        expect(profile.registeredCapital).toBeNull()
        expect(profile.establishedDate).toBe('')
        expect(profile.warnings.join()).toContain('没读到经营范围')
      } finally {
        await server.close()
      }
    })
  })

  it('非图片非 PDF 被拒绝', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        await signIn(client)

        const zip = buildZip([{ name: 'word/document.xml', data: '<x/>' }])
        const response = await upload(
          client,
          zip,
          '材料.zip',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
        expect(response.status).toBeGreaterThanOrEqual(400)
      } finally {
        await server.close()
      }
    })
  })

  it('未登录不能调用', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, mockAi(), ACCOUNTS)
      try {
        const client = session(server.base)
        const response = await upload(client, makePng(), '执照.png', 'image/png')
        expect(response.status).toBe(401)
      } finally {
        await server.close()
      }
    })
  })
})
