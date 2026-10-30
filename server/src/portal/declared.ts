import type { ProjectMeta } from '@srdi/shared'
import { loadPortalConfig } from '../config/portal'
import type { AppStore } from '../store'

export interface DeclaredInput {
  inventionCount?: number
  softCopyrightCount?: number
}

export interface DeclaredOutcome {
  applied: boolean
  reason?: string
  invention: number
  softCopyright: number
  converted: number
  total: number
}

const positiveInt = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

export const applyDeclaredIntellectual = async (
  store: AppStore,
  project: ProjectMeta,
  input: DeclaredInput
): Promise<DeclaredOutcome> => {
  const config = loadPortalConfig()
  const invention = positiveInt(input.inventionCount)
  const softCopyright = positiveInt(input.softCopyrightCount)
  const converted = Math.min(
    config.softCopyright.cap,
    Math.floor(softCopyright / config.softCopyright.ratio)
  )
  const total = invention + converted

  const base: DeclaredOutcome = {
    applied: false,
    invention,
    softCopyright,
    converted,
    total
  }

  if (total === 0) return { ...base, reason: 'nothing_declared' }

  const doc = await store.evidence.get(project)
  const entry = doc.fields['ip.inventionGrantedByYear']
  if (entry?.status === 'confirmed') return { ...base, reason: 'documented' }

  await store.evidence.declareValue(project, 'ip.inventionGrantedByYear', {
    value: [{ year: project.period.y0, count: total }],
    note:
      converted > 0
        ? `客户自述：近三年发明专利 ${invention} 件，软件著作权 ${softCopyright} 件按 ${config.softCopyright.ratio}:1 折算 ${converted} 件`
        : `客户自述：近三年发明专利 ${invention} 件`
  })

  return { ...base, applied: true }
}
