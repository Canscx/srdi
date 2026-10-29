import { describe, expect, it } from 'vitest'
import { startServer, withTempDir, type TestServer } from './helpers'

const CREDENTIALS = { user: 'admin', password: 'abc123456/' }

const login = async (base: string, username: string, password: string) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password })
  })

const cookieOf = (response: Response) => {
  const raw = response.headers.get('set-cookie') ?? ''
  const pair = raw.split(';')[0]
  return pair ? pair : ''
}

describe('登录鉴权', () => {
  it('未登录访问业务接口返回 401', async () => {
    await withTempDir(async (dir) => {
      const server: TestServer = await startServer(dir, undefined, undefined, CREDENTIALS)
      try {
        const response = await fetch(`${server.base}/api/projects`)
        expect(response.status).toBe(401)
        const body = (await response.json()) as { error: string }
        expect(body.error).toBe('unauthorized')
      } finally {
        await server.close()
      }
    })
  })

  it('登录前的状态检查为未认证,登录错误密码被拒', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, CREDENTIALS)
      try {
        const before = await fetch(`${server.base}/api/auth/status`)
        expect(((await before.json()) as { authenticated: boolean }).authenticated).toBe(false)

        const wrong = await login(server.base, 'admin', 'wrong-password')
        expect(wrong.status).toBe(401)

        const unknown = await login(server.base, 'nobody', CREDENTIALS.password)
        expect(unknown.status).toBe(401)
      } finally {
        await server.close()
      }
    })
  })

  it('正确登录后携带会话可访问业务接口', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, CREDENTIALS)
      try {
        const response = await login(server.base, CREDENTIALS.user, CREDENTIALS.password)
        expect(response.status).toBe(200)
        const cookie = cookieOf(response)
        expect(cookie.startsWith('srdi_session=')).toBe(true)

        const projects = await fetch(`${server.base}/api/projects`, {
          headers: { cookie }
        })
        expect(projects.status).toBe(200)

        const status = await fetch(`${server.base}/api/auth/status`, {
          headers: { cookie }
        })
        expect(((await status.json()) as { authenticated: boolean }).authenticated).toBe(true)
      } finally {
        await server.close()
      }
    })
  })

  it('退出后旧会话立即失效', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, CREDENTIALS)
      try {
        const loginResponse = await login(server.base, CREDENTIALS.user, CREDENTIALS.password)
        const cookie = cookieOf(loginResponse)

        const logout = await fetch(`${server.base}/api/auth/logout`, {
          method: 'POST',
          headers: { cookie }
        })
        expect(logout.status).toBe(200)

        const after = await fetch(`${server.base}/api/projects`, {
          headers: { cookie }
        })
        expect(after.status).toBe(401)
      } finally {
        await server.close()
      }
    })
  })

  it('登录接口缺少字段返回 400', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, CREDENTIALS)
      try {
        const response = await fetch(`${server.base}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'admin' })
        })
        expect(response.status).toBe(400)
      } finally {
        await server.close()
      }
    })
  })
})
