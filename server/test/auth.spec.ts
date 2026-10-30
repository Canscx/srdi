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

const ACCOUNTS = {
  accounts: [
    { user: 'admin', password: 'admin-pass', role: 'admin' as const },
    { user: 'customer', password: 'vip666666', role: 'customer' as const }
  ]
}

const signIn = async (base: string, user: string, password: string) => {
  const response = await login(base, user, password)
  expect(response.status).toBe(200)
  return cookieOf(response)
}

describe('角色隔离', () => {
  it('客户账号登录成功但被后台接口拒绝', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, ACCOUNTS)
      try {
        const cookie = await signIn(server.base, 'customer', 'vip666666')

        const projects = await fetch(`${server.base}/api/projects`, { headers: { cookie } })
        expect(projects.status).toBe(403)
        expect(((await projects.json()) as { error: string }).error).toBe('forbidden')

        const settings = await fetch(`${server.base}/api/settings/ai`, { headers: { cookie } })
        expect(settings.status).toBe(403)
      } finally {
        await server.close()
      }
    })
  })

  it('管理员账号可访问后台接口', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, ACCOUNTS)
      try {
        const cookie = await signIn(server.base, 'admin', 'admin-pass')
        const projects = await fetch(`${server.base}/api/projects`, { headers: { cookie } })
        expect(projects.status).toBe(200)
      } finally {
        await server.close()
      }
    })
  })

  it('状态接口回显角色,健康检查不需要登录', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, ACCOUNTS)
      try {
        const cookie = await signIn(server.base, 'customer', 'vip666666')
        const status = await fetch(`${server.base}/api/auth/status`, { headers: { cookie } })
        const body = (await status.json()) as { authenticated: boolean; role?: string; user?: string }
        expect(body.authenticated).toBe(true)
        expect(body.role).toBe('customer')
        expect(body.user).toBe('customer')

        const health = await fetch(`${server.base}/api/health`)
        expect(health.status).toBe(200)
      } finally {
        await server.close()
      }
    })
  })

  it('未登录时角色闸门返回 401 而不是 403', async () => {
    await withTempDir(async (dir) => {
      const server = await startServer(dir, undefined, undefined, ACCOUNTS)
      try {
        const response = await fetch(`${server.base}/api/projects`)
        expect(response.status).toBe(401)
      } finally {
        await server.close()
      }
    })
  })
})
