import type { ProjectMeta } from '@srdi/shared'

export const claimsOf = (project: ProjectMeta): string[] => {
  const claimed = Array.isArray(project.claims)
    ? project.claims.filter((item) => typeof item === 'string' && item.length > 0)
    : []
  if (claimed.length > 0) return claimed
  return project.clientId ? [project.clientId] : []
}

export const canAccess = (project: ProjectMeta, clientId?: string): boolean => {
  if (!clientId) return false
  return claimsOf(project).includes(clientId)
}

export const withClaim = (project: ProjectMeta, clientId?: string): string[] => {
  const next = new Set(claimsOf(project))
  if (clientId) next.add(clientId)
  return [...next]
}
