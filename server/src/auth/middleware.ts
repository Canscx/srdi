import type { NextFunction, Request, Response } from 'express'
import type { AuthService } from './session'
import { parseCookies } from './session'
import { SESSION_COOKIE } from '../routes/auth'

const PUBLIC_PATHS = new Set(['/auth/login', '/auth/logout', '/auth/status'])

export const requireSession =
  (service: AuthService) => (req: Request, res: Response, next: NextFunction) => {
    if (PUBLIC_PATHS.has(req.path)) {
      next()
      return
    }
    const cookies = parseCookies(req.headers.cookie)
    const token = cookies[SESSION_COOKIE]
    if (token && service.verify(token)) {
      next()
      return
    }
    res.status(401).json({ error: 'unauthorized', message: '请先登录' })
  }
