import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FIELD_CATALOG_FILE } from '@srdi/shared'
import { CATALOG_DIR } from '../paths'

export type CatalogFieldType =
  | 'money'
  | 'percent'
  | 'int'
  | 'ratio'
  | 'enum'
  | 'bool'
  | 'list'
  | 'text'
  | 'date'

export interface CatalogField {
  key: string
  label: string
  type: CatalogFieldType
  unit?: string
  periodic?: boolean
  dataClass?: string
  docTypes?: string[]
  aliases?: string[]
  enumValues?: string[]
  description?: string
}

interface CatalogDoc {
  version: string
  fields: CatalogField[]
}

interface CatalogIndex {
  version: string
  fields: CatalogField[]
  byKey: Map<string, CatalogField>
}

let cached: CatalogIndex | null = null

export const loadCatalog = (): CatalogIndex => {
  if (cached) return cached
  const file = path.join(CATALOG_DIR, FIELD_CATALOG_FILE)
  const raw = JSON.parse(readFileSync(file, 'utf8')) as CatalogDoc
  cached = {
    version: raw.version,
    fields: raw.fields,
    byKey: new Map(raw.fields.map((field) => [field.key, field]))
  }
  return cached
}

export const catalogFields = () => loadCatalog().fields

export const findCatalogField = (key: string) => loadCatalog().byKey.get(key)

export const catalogVersion = () => loadCatalog().version
