import type {
  AdminPortalResult,
  AiSettingsPatchRequest,
  AiSettingsResponse,
  AiTestResponse,
  AuthStatusResponse,
  AutoConfirmResponse,
  CatalogResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  EvidenceDoc,
  EvidencePatchRequest,
  EvidencePatchResponse,
  FilePages,
  JobProgressEvent,
  PortalConfig,
  PortalCreateRequest,
  PortalListResponse,
  PortalLookupRequest,
  PortalLookupResponse,
  PortalResultResponse,
  ProjectListResponse,
  ProjectMeta,
  RenameProjectRequest,
  RulesMetaResponse,
  ScoreResponse,
  UploadFileResponse
} from '@srdi/shared'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

const toError = async (response: Response) => {
  try {
    const body = (await response.json()) as { error?: string; message?: string; hint?: string }
    const text = [body.message, body.hint].filter(Boolean).join(' · ')
    return new ApiError(response.status, body.error ?? 'http_error', text || `HTTP ${response.status}`)
  } catch {
    return new ApiError(response.status, 'http_error', `HTTP ${response.status}`)
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init)
  if (response.status === 401 && !path.startsWith('/api/auth')) {
    if (window.location.hash !== '#/login') window.location.hash = '#/login'
  }
  if (!response.ok) throw await toError(response)
  return (await response.json()) as T
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
})

export interface JobStateResponse {
  job: JobProgressEvent & { error?: string }
}

export interface PortalConfigResponse {
  config: PortalConfig
  defaultPeriod: { y0: number; y1: number; y2: number }
}

export interface PortalJobResponse {
  job: JobProgressEvent & { error?: string; queueAhead: number }
}

export interface SubmissionRow {
  projectId: string
  companyName: string
  creditCode: string
  phone: string
  industryCode: string
  industryName: string
  fileCount: number
  official: number | null
  optimistic: number | null
  passed: boolean | null
  weakestDimension: string
  weakestGap: number
  submittedAt: string
  hasScore: boolean
}

export const api = {
  login: (username: string, password: string) =>
    request<{ ok: true }>('/api/auth/login', jsonInit('POST', { username, password })),
  logout: () => request<{ ok: true }>('/api/auth/logout', jsonInit('POST')),
  authStatus: () => request<AuthStatusResponse>('/api/auth/status'),
  projects: () => request<ProjectListResponse>('/api/projects'),
  project: (projectId: string) => request<CreateProjectResponse>(`/api/projects/${projectId}`),
  createProject: (input: CreateProjectRequest = {}) =>
    request<CreateProjectResponse>('/api/projects', jsonInit('POST', input)),
  renameProject: (projectId: string, input: RenameProjectRequest) =>
    request<CreateProjectResponse>(`/api/projects/${projectId}`, jsonInit('PATCH', input)),
  evidence: (projectId: string) =>
    request<EvidenceDoc>(`/api/projects/${projectId}/evidence`),
  catalog: () => request<CatalogResponse>('/api/meta/catalog'),
  rules: () => request<RulesMetaResponse>('/api/meta/rules'),
  score: (projectId: string) =>
    request<ScoreResponse>(`/api/projects/${projectId}/score`, jsonInit('POST')),
  pages: (projectId: string, fileId: string) =>
    request<FilePages>(`/api/projects/${projectId}/pages/${fileId}`),
  patch: (projectId: string, key: string, body: EvidencePatchRequest) =>
    request<EvidencePatchResponse>(
      `/api/projects/${projectId}/evidence/${encodeURIComponent(key)}`,
      jsonInit('PATCH', body)
    ),
  autoConfirm: (projectId: string) =>
    request<AutoConfirmResponse>(
      `/api/projects/${projectId}/evidence/auto-confirm`,
      jsonInit('POST')
    ),
  parse: (projectId: string) =>
    request<{ jobId: string; reused: boolean }>(
      `/api/projects/${projectId}/parse`,
      jsonInit('POST')
    ),
  extract: (projectId: string) =>
    request<{ jobId: string; reused: boolean }>(
      `/api/projects/${projectId}/extract`,
      jsonInit('POST')
    ),
  job: (jobId: string) => request<JobStateResponse>(`/api/jobs/${jobId}`),
  aiSettings: () => request<AiSettingsResponse>('/api/settings/ai'),
  saveAiSettings: (patch: AiSettingsPatchRequest) =>
    request<AiSettingsResponse>('/api/settings/ai', jsonInit('PUT', patch)),
  testAi: () => request<AiTestResponse>('/api/settings/ai/test', jsonInit('POST')),
  upload: async (projectId: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(`/api/projects/${projectId}/files`, {
      method: 'POST',
      body: form
    })
    if (!response.ok) throw await toError(response)
    return (await response.json()) as UploadFileResponse
  },
  pageImageUrl: (projectId: string, fileId: string, page: number) =>
    `/api/files/${fileId}/page/${page}?projectId=${projectId}`,
  streamUrl: (jobId: string) => `/api/jobs/${jobId}/stream`,
  adminResult: (projectId: string) =>
    request<AdminPortalResult>(`/api/admin/projects/${projectId}/result`),
  adminReportUrl: (projectId: string) => `/api/admin/projects/${projectId}/report`,
  portalConfig: () => request<PortalConfigResponse>('/api/portal/config'),
  createPortalProject: (body: PortalCreateRequest) =>
    request<{ projectId: string; name: string }>('/api/portal/projects', jsonInit('POST', body)),
  portalProjects: () => request<PortalListResponse>('/api/portal/projects'),
  portalLookup: (body: PortalLookupRequest) =>
    request<PortalLookupResponse>('/api/portal/lookup', jsonInit('POST', body)),
  portalUpload: async (projectId: string, slot: string, file: File) => {
    const form = new FormData()
    form.append('file', file)
    const response = await fetch(
      `/api/portal/projects/${projectId}/files?slot=${encodeURIComponent(slot)}`,
      { method: 'POST', body: form }
    )
    if (!response.ok) throw await toError(response)
    return (await response.json()) as UploadFileResponse
  },
  portalAssess: (projectId: string) =>
    request<{ jobId: string; reused: boolean; queueAhead: number }>(
      `/api/portal/projects/${projectId}/assess`,
      jsonInit('POST')
    ),
  portalJob: (jobId: string) => request<PortalJobResponse>(`/api/portal/jobs/${jobId}`),
  portalResult: (projectId: string) =>
    request<PortalResultResponse>(`/api/portal/projects/${projectId}/result`),
  portalReportUrl: (projectId: string) => `/api/portal/projects/${projectId}/report`,
  adminSubmissions: (query: string) =>
    request<{ passLine: number; items: SubmissionRow[] }>(
      `/api/admin/submissions?q=${encodeURIComponent(query)}`
    ),
  fixIndustry: (projectId: string, industryCode: string) =>
    request<{ official: number; industryName: string | null }>(
      `/api/admin/projects/${projectId}/industry`,
      jsonInit('PATCH', { industryCode })
    )
}

export const fileLabel = (project: ProjectMeta | null, fileId: string) =>
  project?.files.find((file) => file.fileId === fileId)?.name ?? fileId

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请重试'
