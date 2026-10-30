import { Router } from 'express'
import type { LoginRequest } from '@srdi/shared'
import type { AuthService } from '../auth/session'
import { parseCookies } from '../auth/session'
import { authed } from '../auth/types'
import { badRequest } from '../errors'

export const SESSION_COOKIE = 'srdi_session'
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const cookieOf = (token: string, maxAge: number) =>
  `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`

export const authRouter = (service: AuthService) => {
  const router = Router()

  router.post('/auth/login', async (req, res) => {
    const body = (req.body ?? {}) as Partial<LoginRequest>
    if (typeof body.username !== 'string' || typeof body.password !== 'string') {
      throw badRequest('invalid_body', '账号与密码必须为字符串')
    }
    const outcome = service.login(body.username, body.password)
    if (!outcome) {
      await wait(800)
      res.status(401).json({ error: 'invalid_credentials', message: '账号或密码不正确' })
      return
    }
    res.append('Set-Cookie', cookieOf(outcome.token, SESSION_MAX_AGE_SECONDS))
    res.json({ ok: true, role: outcome.role, user: outcome.user })
  })

  router.post('/auth/logout', (req, res) => {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[SESSION_COOKIE]
    if (token) service.revoke(token)
    res.append('Set-Cookie', cookieOf('', 0))
    res.json({ ok: true })
  })

  router.get('/auth/status', (req, res) => {
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[SESSION_COOKIE]
    const info = token ? service.verify(token) : null
    res.json({
      authenticated: Boolean(info),
      role: info?.role,
      user: info?.user,
      clientId: authed(req).clientId
    })
  })

  return router
}
