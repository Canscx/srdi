import type { DocType, FileKind, FileRoute, FileStatus, UnreadablePage } from '../contracts'

export type PageRoute = 'text' | 'vision'

export interface PageBlock {
  type: 'heading' | 'paragraph' | 'table' | 'list' | 'sheet'
  level?: number
  text: string
}

export interface PageTable {
  index: number
  rows: number
  cols: number
  text: string
}

export interface PageDoc {
  fileId: string
  page: number
  route: PageRoute
  width: number
  height: number
  text: string
  blocks: PageBlock[]
  tables: PageTable[]
  printableChars: number
  hasGlyphs: boolean
  garbledRatio: number
  image?: string
  unreadable?: string
}

export interface FilePages {
  fileId: string
  name: string
  kind: FileKind
  route: FileRoute
  pages: PageDoc[]
  truncated: boolean
  visionSkipped: boolean
  unreadable: UnreadablePage[]
  parsedAt: string
}

export interface ParsedFile {
  pages: PageDoc[]
  totalPages: number
  truncated: boolean
  unreadable: UnreadablePage[]
}

export interface EvidenceFileRef {
  fileId: string
  name: string
  sha256?: string
  pages?: number
  docType?: DocType
  route: FileRoute
  status: FileStatus
  truncated?: boolean
  visionSkipped?: boolean
  unreadable?: UnreadablePage[]
}

export interface ParseRequestResponse {
  jobId: string
  reused: boolean
}
