import type { PeriodWindow, ProjectCompany } from './contracts'

export interface PortalSlot {
  id: string
  title: string
  hint: string
  required: boolean
  accept: string[]
}

export interface PortalConfig {
  version: string
  passLine: number
  softCopyright: { ratio: number; cap: number }
  lookup: { windowMinutes: number; maxAttempts: number }
  slots: PortalSlot[]
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
  optimistic: number
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
  optimistic: number
  passLine: number
  passed: boolean
  gap: number
  potential: number
  confidence: number
  materialRate: number
  industry: { code: string; name: string | null; source: 'industry' | 'default' }
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
  missingSlots: { id: string; title: string; required: boolean }[]
  warnings: string[]
  generatedAt: string
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
