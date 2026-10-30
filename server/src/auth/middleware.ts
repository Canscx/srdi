import { randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import type { AuthService, Role } from './session'
import { parseCookies } from './session'
import { authed } from './types'
import { SESSION_COOKIE } from '../routes/auth'

const PUBLIC_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/status', '/health'])

export const CLIENT_COOKIE = 'srdi_client'
const CLIENT_MAX_AGE_SECONDS = 2 * 365 * 24 * 60 * 60

const clientCookieOf = (value: string, maxAge: number) =>
  `${CLIENT_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`

export const requireSession =
  (service: AuthService) => (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_PATHS.has(req.path)) {
      next()
      return
    }
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[SESSION_COOKIE]
    const info = token ? service.verify(token) : null
    if (info) {
      authed(req).session = info
      next()
      return
    }
    res.status(401).json({ error: 'unauthorized', message: '请先登录' })
  }

export const requireRole =
  (allowed: Role | Role[]) => (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_PATHS.has(req.path)) {
      next()
      return
    }
    const role = authed(req).session?.role
    if (!role) {
      res.status(401).json({ error: 'unauthorized', message: '请先登录' })
      return
    }
    const list = Array.isArray(allowed) ? allowed : [allowed]
    if (!list.includes(role)) {
      res.status(403).json({ error: 'forbidden', message: '当前账号无权访问该功能' })
      return
    }
    next()
  }

export const ensureClientId = () => (req: Request, res: Response, next: NextFunction) => {
  const cookies = parseCookies(req.headers.cookie)
  const existing = cookies[CLIENT_COOKIE]
  if (existing && existing.length >= 8 && existing.length <= 64) {
    authed(req).clientId = existing
    next()
    return
  }
  const id = randomBytes(16).toString('base64url')
  authed(req).clientId = id
  res.append('Set-Cookie', clientCookieOf(id, CLIENT_MAX_AGE_SECONDS))
  next()
}
