import type { PeriodWindow, ProjectCompany } from './contracts'
import type { IndicatorResult } from './scoring/types'

export interface PortalSlot {
  id: string
  title: string
  hint: string
  required: boolean
  accept: string[]
  docTypes?: { value: string; label: string }[]
}

export interface PortalConfig {
  version: string
  passLine: number
  softCopyright: { ratio: number; cap: number }
  lookup: { windowMinutes: number; maxAttempts: number }
  slots: PortalSlot[]
}

export const MIN_PASS_CONFIDENCE = 0.5

export const isPortalPassed = (
  official: number,
  passLine: number,
  confidence: number
): boolean => official >= passLine && confidence >= MIN_PASS_CONFIDENCE

export const TARGET_RATE = 0.8

export const goalContributionOf = (item: IndicatorResult): number => {
  if (item.status === 'excluded') return 0
  if (item.basis === 'absent' || item.basis === 'substituted') return item.effectiveWeight
  if (item.status === 'notApplicable') return 0
  return Math.max(item.contribution.official, TARGET_RATE * item.effectiveWeight)
}

export const rollupGoal = (items: IndicatorResult[]): number => {
  const total = items.reduce((sum, item) => sum + goalContributionOf(item), 0)
  return Math.min(100, Math.max(0, total))
}

export interface PortalCreateRequest {
  company: ProjectCompany
  period?: Partial<PeriodWindow>
}

export type PortalMark = 'pass' | 'gap' | 'missing'

export interface PortalDimension {
  id: string
  name: string
  weight: number
  max: number
  score: number
  goal: number
}

export interface PortalCheck {
  id: string
  code: number
  name: string
  dimensionId: string
  dimensionName: string
  mark: PortalMark
  score: number | null
  weight: number
  raw: number | null
  target: number | null
  unit?: string
  benchmark: number | null
  text: string
  missingFields: string[]
}

export interface PortalAdvice {
  key: string
  title: string
  body: string
  impact: 'high' | 'medium' | 'low'
  gain: number
  source: 'ai' | 'rule'
}

export interface PortalScoreSummary {
  official: number
  goal: number
  passLine: number
  passed: boolean
  evidenceSufficient: boolean
  gap: number
  potential: number
  confidence: number
  materialRate: number
  industry: { code: string; name: string | null; source: 'industry' | 'default' }
}

export interface PortalMaterial {
  fileId: string
  name: string
  slot?: string
  slotTitle?: string
  status: string
  docType?: string
  docTypeSource?: string
  referenceOnly: boolean
  pages?: number
}

export interface PortalResultResponse {
  projectId: string
  company: ProjectCompany
  period: PeriodWindow
  status: 'ready' | 'partial' | 'failed'
  score: PortalScoreSummary | null
  dimensions: PortalDimension[]
  checks: PortalCheck[]
  advices: PortalAdvice[]
  materials: PortalMaterial[]
  missingSlots: { id: string; title: string; required: boolean }[]
  warnings: string[]
  generatedAt: string
  scoredAt: string
  updatedAt: string
}

export interface PortalListResponse {
  projects: PortalHistoryItem[]
}

export interface PortalHistoryItem {
  projectId: string
  companyName: string
  creditCode: string
  official: number | null
  passed: boolean | null
  submittedAt: string
  period: PeriodWindow
  hasScore: boolean
}

export interface PortalLookupRequest {
  companyName: string
  phoneTail: string
}

export interface PortalLookupResponse {
  projects: PortalHistoryItem[]
}
