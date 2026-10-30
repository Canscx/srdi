export interface RateLimiterOptions {
  windowMs: number
  max: number
}

export interface RateLimitDecision {
  ok: boolean
  retryAfter: number
  remaining: number
}

export interface RateLimiter {
  take: (key: string) => RateLimitDecision
  reset: (key?: string) => void
}

export const createRateLimiter = (options: RateLimiterOptions): RateLimiter => {
  const hits = new Map<string, { count: number; resetAt: number }>()
  let lastSweep = 0

  const sweep = (now: number) => {
    if (now - lastSweep < options.windowMs) return
    lastSweep = now
    for (const [key, value] of hits) {
      if (value.resetAt <= now) hits.delete(key)
    }
  }

  return {
    take: (key) => {
      const now = Date.now()
      sweep(now)
      const current = hits.get(key)
      if (!current || current.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + options.windowMs })
        return { ok: true, retryAfter: 0, remaining: Math.max(0, options.max - 1) }
      }
      if (current.count >= options.max) {
        return {
          ok: false,
          retryAfter: Math.ceil((current.resetAt - now) / 1000),
          remaining: 0
        }
      }
      current.count += 1
      return { ok: true, retryAfter: 0, remaining: Math.max(0, options.max - current.count) }
    },
    reset: (key) => {
      if (key) hits.delete(key)
      else hits.clear()
    }
  }
}
