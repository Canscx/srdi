import type {
  AiSettingsPatchRequest,
  AiSettingsResponse,
  AiTestResponse,
  AutoConfirmResponse,
  CatalogResponse,
  CreateProjectRequest,
  CreateProjectResponse,
  EvidenceDoc,
  EvidencePatchRequest,
  EvidencePatchResponse,
  FilePages,
  JobProgressEvent,
  ProjectListResponse,
  ProjectMeta,
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

export const api = {
  projects: () => request<ProjectListResponse>('/api/projects'),
  project: (projectId: string) => request<CreateProjectResponse>(`/api/projects/${projectId}`),
  createProject: (input: CreateProjectRequest = {}) =>
    request<CreateProjectResponse>('/api/projects', jsonInit('POST', input)),
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
  reportUrl: (projectId: string, format: 'md' | 'pdf') =>
    `/api/projects/${projectId}/report?format=${format}`,
  streamUrl: (jobId: string) => `/api/jobs/${jobId}/stream`
}

export const fileLabel = (project: ProjectMeta | null, fileId: string) =>
  project?.files.find((file) => file.fileId === fileId)?.name ?? fileId

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : '请求失败，请重试'
