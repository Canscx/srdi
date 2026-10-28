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
  time: string
}

export type JobStage = 'queued' | 'parsing' | 'extracting' | 'scoring' | 'done' | 'failed'

export interface JobProgressEvent {
  jobId: string
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
  path?: string
}
