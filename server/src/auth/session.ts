import { randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface AuthCredentials {
  user: string
  password: string
}

export interface AuthService {
  login: (username: string, password: string) => string | null
  verify: (token: string) => boolean
  revoke: (token: string) => void
}

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export const createAuthService = ({ user, password }: AuthCredentials): AuthService => {
  const sessions = new Map<string, number>()

  return {
    login: (username, input) => {
      if (!safeEqual(username, user) || !safeEqual(input, password)) return null
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, Date.now() + SESSION_TTL_MS)
      return token
    },
    verify: (token) => {
      const expiresAt = sessions.get(token)
      if (expiresAt === undefined) return false
      if (Date.now() > expiresAt) {
        sessions.delete(token)
        return false
      }
      return true
    },
    revoke: (token) => {
      sessions.delete(token)
    }
  }
}

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const jar: Record<string, string> = {}
  if (!header) return jar
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const key = part.slice(0, eq).trim()
    if (!key) continue
    try {
      jar[key] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      jar[key] = part.slice(eq + 1).trim()
    }
  }
  return jar
}
