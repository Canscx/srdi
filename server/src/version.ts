import { execFileSync } from 'node:child_process'

export const readCommit = (cwd: string): string | null => {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore']
    })
      .toString()
      .trim()
    return sha || null
  } catch {
    return null
  }
}
