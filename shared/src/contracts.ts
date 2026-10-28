import type { FieldEntry, ScoreResult } from './scoring/types'

export interface RulesSummary {
  id: string
  version: string
  level: string
  effectiveFrom: string
  gates: number
  dimensions: number
  indicators: number
}

export interface HealthResponse {
  ok: boolean
  service: string
  version: string
  stage: string
  rules: RulesSummary | null
  runtime: {
    node: string
    uptimeSec: number
    pid: number
    port: number
  }
  storage: {
    dataDir: string
  }
  time: string
}

export type JobStage = 'queued' | 'parsing' | 'extracting' | 'scoring' | 'done' | 'failed'
export type JobKind = 'parse' | 'extract'

export interface JobProgressEvent {
  jobId: string
  kind?: JobKind
  stage: JobStage
  fileId?: string
  page?: number
  total?: number
  pct: number
  message?: string
}

export interface ApiError {
  error: string
  message?: string
  hint?: string
  path?: string
}

export type ProjectLevel = 'SRDI' | 'LITTLE_GIANT'
export type FileKind = 'pdf' | 'docx' | 'xlsx' | 'image'
export type FileRoute = 'text' | 'vision' | 'hybrid'
export type FileStatus = 'pending' | 'parsed' | 'failed'
export type DocType =
  | 'audit'
  | 'application'
  | 'tax'
  | 'patent'
  | 'cert'
  | 'standard'
  | 'finance'
  | 'other'

export interface PeriodWindow {
  y0: number
  y1: number
  y2: number
}

export interface UnreadablePage {
  page: number
  reason: string
}

export interface ProjectFile {
  fileId: string
  name: string
  sha256: string
  size: number
  kind: FileKind
  ext: string
  mime: string
  docType?: DocType
  pages?: number
  route?: FileRoute
  status: FileStatus
  uploadedAt: string
  truncated?: boolean
  visionSkipped?: boolean
  unreadable?: UnreadablePage[]
}

export interface ProjectMeta {
  schemaVersion: string
  projectId: string
  name: string
  level: ProjectLevel
  rulesId: string
  benchmarksVersion?: string
  period: PeriodWindow
  createdAt: string
  updatedAt: string
  files: ProjectFile[]
}

export interface CreateProjectRequest {
  name?: string
  level?: ProjectLevel
  period?: Partial<PeriodWindow>
}

export interface ProjectSummary {
  projectId: string
  name: string
  level: ProjectLevel
  period: PeriodWindow
  files: number
  createdAt: string
  updatedAt: string
}

export interface CreateProjectResponse {
  projectId: string
  project: ProjectMeta
}

export interface ProjectListResponse {
  projects: ProjectSummary[]
}

export interface UploadFileResponse {
  fileId: string
  name: string
  sha256: string
  size: number
  kind: FileKind
  ext: string
  mime: string
  dup: boolean
}

export interface EvidencePatchRequest {
  candidateId?: string
  manualValue?: number | string | boolean | null
  unit?: string
  note?: string
  status?: 'confirmed' | 'rejected' | 'missing'
}

export interface EvidencePatchResponse {
  key: string
  entry: FieldEntry
}

export interface ExtractRequestResponse {
  jobId: string
  reused: boolean
}

export type FieldType =
  | 'money'
  | 'percent'
  | 'int'
  | 'ratio'
  | 'enum'
  | 'bool'
  | 'list'
  | 'text'
  | 'date'

export interface CatalogFieldMeta {
  key: string
  label: string
  type: FieldType
  unit?: string
  periodic?: boolean
  dataClass?: string
  enumValues?: string[]
  aliases?: string[]
  description?: string
  docTypes?: string[]
}

export interface AutoConfirmPolicy {
  enabled: boolean
  minConfidence: number
  rejectUnverifiedQuote: boolean
}

export interface CatalogResponse {
  version: string
  fields: CatalogFieldMeta[]
  autoConfirm: AutoConfirmPolicy
}

export interface AutoConfirmResponse {
  confirmed: string[]
  skipped: { key: string; reason: string }[]
  policy: AutoConfirmPolicy
}

export interface ScoreEvidenceStats {
  total: number
  confirmed: number
  candidate: number
  missing: number
  rejected: number
}

export interface ScoreRecord {
  schemaVersion: string
  savedAt: string
  rulesId: string
  rulesVersion: string
  benchmarksVersion?: string
  evidence: ScoreEvidenceStats
  result: ScoreResult
}

export interface ScoreResponse {
  record: ScoreRecord | null
}

export interface RulesMetaIndicator {
  id: string
  code: number
  name: string
  unit?: string
  dataClass: 'A' | 'B' | 'C'
  share: number
  scoringType: string
  evidenceRefs: string[]
  formula?: string
  fallback?: { type: 'neutral' | 'exclude'; reason?: string }
}

export interface RulesMetaDimension {
  id: string
  name: string
  weight: number
  indicators: RulesMetaIndicator[]
}

export interface RulesMetaResponse {
  rulesId: string
  version: string
  level: string
  levelName?: string
  passLine?: number
  dimensions: RulesMetaDimension[]
  assumptions: { id: string; text: string; impact: string }[]
}

export type AiConfigSource = 'file' | 'env' | 'default'

export interface AiSettingsSource {
  baseUrl: AiConfigSource
  apiKey: AiConfigSource
  model: AiConfigSource
}

export interface AiSettingsResponse {
  baseUrl: string
  model: string
  hasKey: boolean
  keyMasked: string
  updatedAt?: string
  source: AiSettingsSource
  defaults: { baseUrl: string; model: string }
}

export interface AiSettingsPatchRequest {
  baseUrl?: string
  apiKey?: string
  model?: string
  clearKey?: boolean
}

export interface AiTestResponse {
  ok: boolean
  model: string
  latencyMs: number
  message: string
}
