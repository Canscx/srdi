import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { AutoConfirmPolicy } from '@srdi/shared'
import { CONFIG_ROOT } from '../paths'

export interface PortalConfirmPolicy {
  enabled: boolean
  minConfidence: number
  mergePeriods: boolean
}

export interface ReviewPolicy {
  version: string
  autoConfirm: AutoConfirmPolicy
  portal: PortalConfirmPolicy
  review: {
    defaultFilter: 'pending' | 'confirmed' | 'missing' | 'all'
    autoJumpToNext: boolean
  }
}

const REVIEW_FILE = 'review.json'

const FALLBACK: ReviewPolicy = {
  version: '0.0.0',
  autoConfirm: { enabled: false, minConfidence: 1, rejectUnverifiedQuote: true },
  portal: { enabled: true, minConfidence: 0.5, mergePeriods: true },
  review: { defaultFilter: 'pending', autoJumpToNext: true }
}

let cached: ReviewPolicy | null = null

export const loadReviewPolicy = (): ReviewPolicy => {
  if (cached) return cached
  try {
    const raw = JSON.parse(
      readFileSync(path.join(CONFIG_ROOT, REVIEW_FILE), 'utf8')
    ) as Partial<ReviewPolicy>
    const autoConfirm = raw.autoConfirm
    cached = {
      version: raw.version ?? FALLBACK.version,
      autoConfirm: {
        enabled: autoConfirm?.enabled === true,
        minConfidence:
          typeof autoConfirm?.minConfidence === 'number'
            ? Math.min(1, Math.max(0, autoConfirm.minConfidence))
            : FALLBACK.autoConfirm.minConfidence,
        rejectUnverifiedQuote: autoConfirm?.rejectUnverifiedQuote !== false
      },
      portal: {
        enabled: raw.portal?.enabled !== false,
        minConfidence:
          typeof raw.portal?.minConfidence === 'number'
            ? Math.min(1, Math.max(0, raw.portal.minConfidence))
            : FALLBACK.portal.minConfidence,
        mergePeriods: raw.portal?.mergePeriods !== false
      },
      review: {
        defaultFilter: raw.review?.defaultFilter ?? FALLBACK.review.defaultFilter,
        autoJumpToNext: raw.review?.autoJumpToNext !== false
      }
    }
  } catch {
    cached = FALLBACK
  }
  return cached
}

export const autoConfirmPolicy = () => loadReviewPolicy().autoConfirm

export const portalConfirmPolicy = () => loadReviewPolicy().portal
