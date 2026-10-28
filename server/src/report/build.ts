import type {
  EvidenceDoc,
  FieldStatus,
  IndicatorDef,
  IndicatorResult,
  ProjectMeta,
  RulesDoc,
  ScoreRecord
} from '@srdi/shared'
import { FIELD_GROUP_TITLES } from '@srdi/shared'
import { formatEvidenceValue, GROUP_ORDER } from './format'

export interface ReportField {
  key: string
  label: string
  group: string
  groupTitle: string
  status: FieldStatus
  display: string
}

export interface ReportIndicator {
  result: IndicatorResult
  dimensionName: string
  unit?: string
  formula?: string
  evidenceRefs: string[]
  missingFields: string[]
}

export interface ReportModel {
  generatedAt: string
  stale: boolean
  project: ProjectMeta
  evidence: EvidenceDoc
  record: ScoreRecord
  fields: ReportField[]
  indicators: ReportIndicator[]
  dimensionMax: Record<string, number>
  assumptions: { id: string; text: string; impact: string }[]
  versions: {
    rulesId: string
    rulesVersion: string
    engineVersion: string
    benchmarksVersion?: string
  }
}

const buildFields = (evidence: EvidenceDoc): ReportField[] =>
  Object.values(evidence.fields)
    .map((entry) => {
      const group = entry.key.includes('.') ? entry.key.split('.')[0] : 'other'
      const safeGroup = GROUP_ORDER.includes(group) ? group : 'other'
      return {
        key: entry.key,
        label: entry.label ?? entry.key,
        group: safeGroup,
        groupTitle: FIELD_GROUP_TITLES[safeGroup] ?? '其他',
        status: entry.status,
        display: formatEvidenceValue(entry)
      }
    })
    .sort(
      (left, right) =>
        GROUP_ORDER.indexOf(left.group) - GROUP_ORDER.indexOf(right.group) ||
        left.key.localeCompare(right.key)
    )

const isStale = (fields: ReportField[], record: ScoreRecord): boolean => {
  const count = (status: FieldStatus) => fields.filter((field) => field.status === status).length
  return (
    fields.length !== record.evidence.total ||
    count('confirmed') !== record.evidence.confirmed ||
    count('candidate') !== record.evidence.candidate ||
    count('missing') !== record.evidence.missing ||
    count('rejected') !== record.evidence.rejected
  )
}

export const buildReport = (
  project: ProjectMeta,
  evidence: EvidenceDoc,
  record: ScoreRecord,
  rules: RulesDoc
): ReportModel => {
  const result = record.result

  const definitions = new Map<string, IndicatorDef>()
  for (const dimension of rules.dimensions) {
    for (const indicator of dimension.indicators) definitions.set(indicator.id, indicator)
  }

  const dimensionNames = new Map(
    result.dimensions.map((dimension) => [dimension.id, dimension.name])
  )

  const fields = buildFields(evidence)

  const dimensionMax: Record<string, number> = {}
  for (const item of result.indicators) {
    dimensionMax[item.dimensionId] =
      (dimensionMax[item.dimensionId] ?? 0) + item.effectiveWeight
  }

  const indicators: ReportIndicator[] = result.indicators.map((item) => {
    const definition = definitions.get(item.id)
    return {
      result: item,
      dimensionName: dimensionNames.get(item.dimensionId) ?? item.dimensionId,
      unit: definition?.unit,
      formula: definition?.formula?.expr,
      evidenceRefs: definition?.evidenceRefs ?? [],
      missingFields:
        result.missing.find((entry) => entry.indicatorId === item.id)?.fieldKeys ?? []
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    stale: isStale(fields, record),
    project,
    evidence,
    record,
    fields,
    indicators,
    dimensionMax,
    assumptions: rules.assumptions ?? [],
    versions: {
      rulesId: rules.rulesId,
      rulesVersion: rules.schemaVersion,
      engineVersion: result.meta.engineVersion,
      benchmarksVersion: record.benchmarksVersion
    }
  }
}
