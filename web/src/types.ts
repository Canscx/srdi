import type { FieldEntry, FieldStatus, FieldType } from '@srdi/shared'

export type FilterKey = 'pending' | 'confirmed' | 'missing' | 'all'

export interface FieldRow {
  key: string
  label: string
  type: FieldType
  unit?: string
  status: FieldStatus
  count: number
  conflict: boolean
  preview: string
  entry: FieldEntry
}
