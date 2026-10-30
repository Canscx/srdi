import type { EvidenceDoc, FieldCandidate, ProjectMeta } from '@srdi/shared'
import { catalogFields } from '../config/catalog'
import { portalConfirmPolicy } from '../config/review'
import type { AppStore } from '../store'

export interface PortalConfirmResult {
  confirmed: string[]
  series: string[]
  lowConfidence: string[]
  skipped: { key: string; reason: string }[]
}

const usable = (candidate: FieldCandidate) =>
  candidate.value !== undefined && candidate.value !== null

export const rankCandidate = (candidate: FieldCandidate): number => {
  const quote = candidate.source.quoteMatched
  const quoteScore = quote === true ? 30 : quote === false ? 0 : 10
  const confidence = (candidate.confidence ?? candidate.source.confidence ?? 0) * 20
  const numeric = typeof candidate.value === 'number' ? 6 : 0
  const zeroPenalty = candidate.value === 0 ? -8 : 0
  const routeBonus = candidate.source.route === 'text' ? 1 : 0
  return quoteScore + confidence + numeric + zeroPenalty + routeBonus
}

const bestOf = (list: FieldCandidate[]) =>
  [...list].sort((left, right) => rankCandidate(right) - rankCandidate(left))[0]

const groupByPeriod = (list: FieldCandidate[]) => {
  const groups = new Map<number, FieldCandidate[]>()
  for (const candidate of list) {
    if (typeof candidate.period === 'number' && Number.isInteger(candidate.period)) {
      const bucket = groups.get(candidate.period) ?? []
      bucket.push(candidate)
      groups.set(candidate.period, bucket)
    }
  }
  return groups
}

export const confirmBestCandidates = async (
  store: AppStore,
  project: ProjectMeta,
  evidence: EvidenceDoc
): Promise<PortalConfirmResult> => {
  const policy = portalConfirmPolicy()
  const result: PortalConfirmResult = { confirmed: [], series: [], lowConfidence: [], skipped: [] }
  if (!policy.enabled) return result

  for (const field of catalogFields()) {
    const entry = evidence.fields[field.key]
    if (!entry || entry.status !== 'candidate') continue

    const list = (entry.candidates ?? []).filter(usable)
    if (list.length === 0) {
      result.skipped.push({ key: field.key, reason: 'empty_value' })
      continue
    }

    const best = bestOf(list)
    const confidence = best.confidence ?? best.source.confidence ?? 0
    if (confidence < policy.minConfidence) result.lowConfidence.push(field.key)

    const groups = groupByPeriod(list)
    const periods = [...groups.keys()].sort((left, right) => left - right)

    try {
      if (field.periodic && policy.mergePeriods && periods.length > 0) {
        const picks = periods.map((period) => ({
          period,
          candidateId: bestOf(groups.get(period) ?? []).candidateId
        }))
        await store.evidence.confirmSeries(project, field.key, picks)
        result.series.push(field.key)
        continue
      }

      await store.evidence.patch(project, field.key, { candidateId: best.candidateId })
      result.confirmed.push(field.key)
    } catch (err) {
      result.skipped.push({ key: field.key, reason: (err as Error).message })
    }
  }

  return result
}
