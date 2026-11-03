import type { EvidenceDoc, ProjectCompany, ProjectMeta } from '@srdi/shared'
import { isValidCreditCode, normalizeCreditCode } from '@srdi/shared'
import type { AppStore } from '../store'
import { cleanBusinessScope } from './scope'

export type CreditCodeSource = 'material' | 'input'

export interface PortalIdentity {
  name: string
  creditCode: string
  creditCodeSource: CreditCodeSource | null
  businessScope: string
  registeredCapital: number | null
  establishedDate: string
  industryCode: string
  industryName: string
  warnings: string[]
}

const confirmedValue = (evidence: EvidenceDoc, key: string): unknown => {
  const entry = evidence.fields?.[key]
  if (!entry || entry.status !== 'confirmed') return undefined
  return entry.value
}

const confirmedText = (evidence: EvidenceDoc, key: string): string => {
  const value = confirmedValue(evidence, key)
  return typeof value === 'string' ? value.trim() : ''
}

const confirmedNumber = (evidence: EvidenceDoc, key: string): number | null => {
  const value = confirmedValue(evidence, key)
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const industryOf = (project: ProjectMeta, evidence: EvidenceDoc): string => {
  const declared = project.company?.industryCode?.trim()
  if (declared) return declared.toUpperCase()
  const fromCompany = evidence.company?.industryCode?.trim()
  if (fromCompany) return fromCompany.toUpperCase()
  return confirmedText(evidence, 'company.industryCode').toUpperCase()
}

const industryNameOf = (project: ProjectMeta, evidence: EvidenceDoc): string => {
  const declared = project.company?.industryName?.trim()
  if (declared) return declared
  const fromCompany = evidence.company?.industryName?.trim()
  if (fromCompany) return fromCompany
  return ''
}

export const resolveIdentity = (input: {
  project: ProjectMeta
  evidence: EvidenceDoc
}): PortalIdentity => {
  const company = input.project.company
  const name = (company?.name ?? input.project.name).trim()

  const material = normalizeCreditCode(confirmedText(input.evidence, 'company.creditCode'))
  const inputCode = normalizeCreditCode(company?.creditCode ?? '')

  const candidates: { value: string; source: CreditCodeSource }[] = []
  if (material.length === 18) candidates.push({ value: material, source: 'material' })
  if (inputCode.length === 18) candidates.push({ value: inputCode, source: 'input' })

  const valid = candidates.filter((item) => isValidCreditCode(item.value))
  const picked = valid[0] ?? null

  const warnings: string[] = []
  if (valid.length > 1 && valid[0].value !== valid[1].value) {
    warnings.push('统一社会信用代码在材料与登记信息中不一致，报告采用材料中的号码')
  }
  if (!picked && material.length > 0) {
    warnings.push('材料中的统一社会信用代码未通过校验，报告不展示该号码')
  }

  const scope = cleanBusinessScope(
    confirmedText(input.evidence, 'identity.businessScope') || (company?.businessScope ?? '')
  )
  const capital = confirmedNumber(input.evidence, 'identity.registeredCapital')
  const establishedDate = confirmedText(input.evidence, 'identity.establishedDate')

  return {
    name,
    creditCode: picked?.value ?? '',
    creditCodeSource: picked?.source ?? null,
    businessScope: scope,
    registeredCapital: capital ?? (typeof company?.registeredCapital === 'number' ? company.registeredCapital : null),
    establishedDate: establishedDate || (company?.establishedDate ?? '').trim(),
    industryCode: industryOf(input.project, input.evidence),
    industryName: industryNameOf(input.project, input.evidence),
    warnings
  }
}

export const identityPatchOf = (identity: PortalIdentity): Partial<ProjectCompany> => {
  const patch: Partial<ProjectCompany> = {}
  if (identity.creditCode) {
    patch.creditCode = identity.creditCode
    patch.creditCodeSource = identity.creditCodeSource ?? 'material'
  }
  if (identity.businessScope) patch.businessScope = identity.businessScope
  if (identity.registeredCapital !== null) patch.registeredCapital = identity.registeredCapital
  if (identity.establishedDate) patch.establishedDate = identity.establishedDate
  return patch
}

export const syncIdentity = async (store: AppStore, projectId: string): Promise<string[]> => {
  const project = await store.projects.get(projectId)
  const evidence = await store.evidence.get(project)
  const identity = resolveIdentity({ project, evidence })
  const patch = identityPatchOf(identity)

  return store.projects.update(projectId, (meta) => {
    const company: ProjectCompany = meta.company ?? { name: identity.name || meta.name, phone: '' }
    const changed: string[] = []
    for (const [key, value] of Object.entries(patch)) {
      if (company[key as keyof ProjectCompany] !== value) changed.push(key)
      ;(company as unknown as Record<string, unknown>)[key] = value
    }
    meta.company = company
    return changed
  })
}
