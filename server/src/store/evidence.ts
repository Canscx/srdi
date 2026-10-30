import path from 'node:path'
import type {
  EvidenceDoc,
  EvidenceFileRef,
  EvidencePatchRequest,
  FieldCandidate,
  FieldEntry,
  ProjectMeta
} from '@srdi/shared'
import { EVIDENCE_SCHEMA_VERSION, FLAG } from '@srdi/shared'
import { catalogFields, findCatalogField, type CatalogField } from '../config/catalog'
import { AppError, badRequest, notFound } from '../errors'
import { readJson, writeJson } from './atomic'
import type { LockTable } from './lock'

const NUMERIC_TYPES = new Set(['money', 'percent', 'int', 'ratio'])

const baseEntry = (field: CatalogField): FieldEntry => ({
  key: field.key,
  label: field.label,
  type: field.type,
  unit: field.unit,
  periodic: field.periodic,
  status: 'missing'
})

const coerceValue = (
  field: CatalogField,
  input: number | string | boolean | null
): FieldEntry['value'] => {
  if (input === null) return null
  if (field.type === 'bool') {
    if (typeof input === 'boolean') return input
    const text = String(input).trim().toLowerCase()
    if (['是', 'true', '1', '有', 'yes'].includes(text)) return true
    if (['否', 'false', '0', '无', 'no'].includes(text)) return false
    throw badRequest('invalid_value', `${field.label} 只能填是或否`)
  }
  if (NUMERIC_TYPES.has(field.type)) {
    const raw =
      typeof input === 'number' ? input : Number(String(input).replace(/[,，\s¥￥]/g, ''))
    if (!Number.isFinite(raw)) {
      throw badRequest('invalid_value', `${field.label} 需要数值`)
    }
    if (field.type === 'int' && !Number.isInteger(raw)) {
      throw badRequest('invalid_value', `${field.label} 需要整数`)
    }
    return raw
  }
  if (field.type === 'list') {
    if (Array.isArray(input)) return input as unknown[]
    const items = String(input)
      .split(/[,，、;；\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
    return items
  }
  if (typeof input === 'boolean') return input
  return String(input).trim()
}

const normalizeDeclared = (
  field: CatalogField,
  input: FieldEntry['value']
): FieldEntry['value'] => {
  if (field.type === 'list') {
    if (!Array.isArray(input)) throw badRequest('invalid_value', `${field.label} 需要数组`)
    return input as unknown[]
  }
  if (NUMERIC_TYPES.has(field.type)) {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
      throw badRequest('invalid_value', `${field.label} 需要数值`)
    }
    if (field.type === 'int' && !Number.isInteger(input)) {
      throw badRequest('invalid_value', `${field.label} 需要整数`)
    }
    return input
  }
  return input ?? null
}

export interface SeriesPick {
  period: number
  candidateId: string
}

export interface SeriesMeta {
  strategy?: 'auto_series' | 'manual'
  resolvedBy?: 'auto' | 'user'
}

export interface DeclareInput {
  value: FieldEntry['value']
  note: string
}

export interface EvidenceStore {
  path: (projectId: string) => string
  get: (project: ProjectMeta) => Promise<EvidenceDoc>
  save: (doc: EvidenceDoc) => Promise<void>
  patch: (project: ProjectMeta, key: string, input: EvidencePatchRequest) => Promise<FieldEntry>
  confirmSeries: (
    project: ProjectMeta,
    key: string,
    picks: SeriesPick[],
    meta?: SeriesMeta
  ) => Promise<FieldEntry>
  declareValue: (project: ProjectMeta, key: string, input: DeclareInput) => Promise<FieldEntry>
  appendCandidates: (
    project: ProjectMeta,
    key: string,
    candidates: FieldCandidate[]
  ) => Promise<FieldEntry>
  syncFile: (project: ProjectMeta, file: EvidenceFileRef) => Promise<void>
}

export const createEvidenceStore = (dataDir: string, lock: LockTable): EvidenceStore => {
  const pathOf = (projectId: string) => path.join(dataDir, 'projects', projectId, 'evidence.json')

  const initDoc = (project: ProjectMeta): EvidenceDoc => {
    const fields: Record<string, FieldEntry> = {}
    for (const field of catalogFields()) fields[field.key] = baseEntry(field)
    return {
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      projectId: project.projectId,
      level: project.level,
      rulesId: project.rulesId,
      benchmarksVersion: project.benchmarksVersion,
      createdAt: new Date().toISOString(),
      period: { ...project.period },
      files: [],
      fields
    }
  }

  const normalize = (doc: EvidenceDoc, project: ProjectMeta): EvidenceDoc => {
    if (!doc.fields || typeof doc.fields !== 'object') {
      throw new AppError(500, 'evidence_corrupt', '证据表结构损坏,缺少 fields')
    }
    for (const field of catalogFields()) {
      const entry = doc.fields[field.key]
      if (!entry) {
        doc.fields[field.key] = baseEntry(field)
        continue
      }
      entry.label ??= field.label
      entry.type ??= field.type
      entry.unit ??= field.unit
      if (entry.periodic === undefined) entry.periodic = field.periodic
    }
    doc.projectId = project.projectId
    doc.level = project.level
    doc.rulesId = project.rulesId
    doc.period = { ...project.period }
    if (project.benchmarksVersion) doc.benchmarksVersion = project.benchmarksVersion
    return doc
  }

  const save = async (doc: EvidenceDoc) => {
    await writeJson(pathOf(doc.projectId), doc)
  }

  const get = async (project: ProjectMeta): Promise<EvidenceDoc> => {
    const raw = await readJson<EvidenceDoc>(pathOf(project.projectId))
    if (!raw) {
      const doc = initDoc(project)
      await save(doc)
      return doc
    }
    return normalize(raw, project)
  }

  const patch = async (
    project: ProjectMeta,
    key: string,
    input: EvidencePatchRequest
  ): Promise<FieldEntry> =>
    lock(`evidence:${project.projectId}`, async () => {
      const field = findCatalogField(key)
      if (!field) throw notFound('field_not_found', `字段 ${key} 不在字段目录中`)
      const doc = await get(project)
      const entry = doc.fields[key]
      if (!entry) throw notFound('field_not_found', `字段 ${key} 不在字段目录中`)

      const resolvedAt = new Date().toISOString()

      if (input.status === 'missing') {
        delete entry.value
        delete entry.resolution
        entry.status = 'missing'
        if (input.note !== undefined) entry.manualNote = input.note
        await save(doc)
        return entry
      }

      if (input.status === 'rejected') {
        delete entry.value
        entry.status = 'rejected'
        entry.resolution = {
          strategy: 'manual',
          pickedCandidateId: input.candidateId ?? null,
          resolvedBy: 'user',
          resolvedAt
        }
        if (input.note !== undefined) entry.manualNote = input.note
        await save(doc)
        return entry
      }

      const candidate = input.candidateId
        ? (entry.candidates ?? []).find((item) => item.candidateId === input.candidateId)
        : undefined

      if (input.candidateId && !candidate) {
        throw badRequest('candidate_not_found', `候选 ${input.candidateId} 不存在`)
      }

      const hasManual = input.manualValue !== undefined
      if (!candidate && !hasManual) {
        throw badRequest('value_required', '需要 candidateId 或 manualValue 之一')
      }
      if (!hasManual && candidate && (candidate.value === undefined || candidate.value === null)) {
        throw badRequest('candidate_empty', '该候选没有可用数值,请手工填写')
      }

      const value = hasManual
        ? coerceValue(field, input.manualValue as number | string | boolean | null)
        : (candidate?.value ?? null)

      entry.value = value
      const unit = input.unit ?? candidate?.unit ?? field.unit
      if (unit) entry.unit = unit
      entry.status = 'confirmed'
      entry.resolution = {
        strategy: hasManual ? 'manual' : (entry.candidates?.length ?? 0) > 1 ? 'manual' : 'auto_single',
        pickedCandidateId: candidate?.candidateId ?? null,
        resolvedBy: 'user',
        resolvedAt
      }
      if (input.note !== undefined) entry.manualNote = input.note
      await save(doc)
      return entry
    })

  const confirmSeries = async (
    project: ProjectMeta,
    key: string,
    picks: SeriesPick[],
    meta?: SeriesMeta
  ): Promise<FieldEntry> =>
    lock(`evidence:${project.projectId}`, async () => {
      const field = findCatalogField(key)
      if (!field) throw notFound('field_not_found', `字段 ${key} 不在字段目录中`)
      if (!Array.isArray(picks) || picks.length === 0) {
        throw badRequest('series_picks_required', '至少需要一个年份的候选')
      }

      const doc = await get(project)
      const entry = doc.fields[key]
      if (!entry) throw notFound('field_not_found', `字段 ${key} 不在字段目录中`)

      const window = new Set(Object.values(doc.period))
      const picked: Record<string, number> = {}
      const pickedIds: string[] = []
      const flags = new Set(entry.flags ?? [])

      for (const pick of picks) {
        if (!Number.isInteger(pick.period)) {
          throw badRequest('invalid_period', '年份必须是整数')
        }
        const candidate = (entry.candidates ?? []).find(
          (item) => item.candidateId === pick.candidateId
        )
        if (!candidate) {
          throw badRequest('candidate_not_found', `候选 ${pick.candidateId} 不存在`)
        }
        if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) {
          throw badRequest('candidate_not_numeric', `候选 ${pick.candidateId} 没有可用的数值`)
        }
        if (!window.has(pick.period)) {
          flags.add(FLAG.OUT_OF_WINDOW_DROPPED)
          continue
        }
        if (picked[String(pick.period)] !== undefined) {
          flags.add(FLAG.SERIES_PERIOD_CONFLICT)
          continue
        }
        picked[String(pick.period)] = candidate.value
        pickedIds.push(candidate.candidateId)
      }

      if (pickedIds.length === 0) {
        throw badRequest('series_empty', '所有候选年份都在统计窗口之外')
      }

      entry.value = picked
      entry.status = 'confirmed'
      entry.resolution = {
        strategy: meta?.strategy ?? 'auto_series',
        pickedCandidateId: null,
        pickedCandidateIds: pickedIds,
        resolvedBy: meta?.resolvedBy ?? 'auto',
        resolvedAt: new Date().toISOString()
      }
      if (flags.size > 0) entry.flags = [...flags]
      await save(doc)
      return entry
    })

  const declareValue = async (
    project: ProjectMeta,
    key: string,
    input: DeclareInput
  ): Promise<FieldEntry> =>
    lock(`evidence:${project.projectId}`, async () => {
      const field = findCatalogField(key)
      if (!field) throw notFound('field_not_found', `字段 ${key} 不在字段目录中`)
      const doc = await get(project)
      const entry = doc.fields[key]
      if (!entry) throw notFound('field_not_found', `字段 ${key} 不在字段目录中`)

      const value = normalizeDeclared(field, input.value)
      const at = new Date().toISOString()
      entry.value = value
      entry.status = 'confirmed'
      entry.declared = { by: 'client', at, note: input.note }
      entry.resolution = {
        strategy: 'declared',
        pickedCandidateId: null,
        resolvedBy: 'client',
        resolvedAt: at
      }
      entry.flags = [...new Set([...(entry.flags ?? []), FLAG.DECLARED_VALUE])]
      await save(doc)
      return entry
    })

  const appendCandidates = async (
    project: ProjectMeta,
    key: string,
    candidates: FieldCandidate[]
  ): Promise<FieldEntry> =>
    lock(`evidence:${project.projectId}`, async () => {
      const field = findCatalogField(key)
      if (!field) throw notFound('field_not_found', `字段 ${key} 不在字段目录中`)
      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw badRequest('candidate_required', '至少需要一个候选')
      }
      for (const candidate of candidates) {
        if (!candidate.candidateId) throw badRequest('candidate_invalid', '候选缺少 candidateId')
        if (!candidate.source?.fileId || !candidate.source?.page) {
          throw badRequest('candidate_invalid', '候选缺少出处 fileId 或 page')
        }
      }
      const doc = await get(project)
      const entry = doc.fields[key]
      const existing = entry.candidates ?? []
      const known = new Set(existing.map((item) => item.candidateId))
      for (const candidate of candidates) {
        if (known.has(candidate.candidateId)) continue
        existing.push(candidate)
        known.add(candidate.candidateId)
      }
      entry.candidates = existing
      if (entry.status === 'missing') entry.status = 'candidate'
      await save(doc)
      return entry
    })

  const syncFile = async (project: ProjectMeta, file: EvidenceFileRef) =>
    lock(`evidence:${project.projectId}`, async () => {
      const doc = await get(project)
      const files = (doc.files ?? []) as EvidenceFileRef[]
      const index = files.findIndex((item) => item.fileId === file.fileId)
      if (index >= 0) files[index] = file
      else files.push(file)
      doc.files = files
      await save(doc)
    })

  return { path: pathOf, get, save, patch, confirmSeries, declareValue, appendCandidates, syncFile }
}
