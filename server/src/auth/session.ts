import { randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type Role = 'admin' | 'customer'

export interface AuthAccount {
  user: string
  password: string
  role?: Role
}

export interface AuthConfig {
  user?: string
  password?: string
  accounts?: AuthAccount[]
}

export interface SessionInfo {
  user: string
  role: Role
  expiresAt: number
}

export interface LoginOutcome {
  token: string
  user: string
  role: Role
}

export interface AuthService {
  login: (username: string, password: string) => LoginOutcome | null
  verify: (token: string) => SessionInfo | null
  revoke: (token: string) => void
}

const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

const normalizeAccounts = (config: AuthConfig): AuthAccount[] => {
  const accounts = (config.accounts ?? []).map((account) => ({
    user: account.user,
    password: account.password,
    role: account.role ?? 'admin'
  }))
  const legacy = config.user?.trim()
  if (legacy && !accounts.some((account) => account.user === legacy)) {
    accounts.push({ user: legacy, password: config.password ?? '', role: 'admin' })
  }
  return accounts
}

export const createAuthService = (config: AuthConfig): AuthService => {
  const sessions = new Map<string, SessionInfo>()
  const accounts = normalizeAccounts(config)

  return {
    login: (username, input) => {
      const account = accounts.find(
        (item) => safeEqual(username, item.user) && safeEqual(input, item.password)
      )
      if (!account) return null
      const role = account.role ?? 'admin'
      const token = randomBytes(32).toString('base64url')
      sessions.set(token, { user: account.user, role, expiresAt: Date.now() + SESSION_TTL_MS })
      return { token, user: account.user, role }
    },
    verify: (token) => {
      const info = sessions.get(token)
      if (!info) return null
      if (Date.now() > info.expiresAt) {
        sessions.delete(token)
        return null
      }
      return info
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
