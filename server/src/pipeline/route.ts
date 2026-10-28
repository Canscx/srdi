import type { FileRoute, PageDoc, PageRoute } from '@srdi/shared'
import { GARBLED_RATIO_LIMIT, TEXT_MIN_PRINTABLE } from './text'

export const VISION_SHARE_TEXT_MAX = 0.2
export const VISION_SHARE_HYBRID_MAX = 0.5
export const MAX_VISION_PAGES = 40
export const FORCE_VISION_MIN_PAGES = 30

export interface PageRouteInput {
  printableChars: number
  hasGlyphs: boolean
  garbledRatio: number
}

export const decidePageRoute = (input: PageRouteInput): PageRoute => {
  if (!input.hasGlyphs) return 'vision'
  if (input.printableChars < TEXT_MIN_PRINTABLE) return 'vision'
  if (input.garbledRatio > GARBLED_RATIO_LIMIT) return 'vision'
  return 'text'
}

export const decideFileRoute = (routes: PageRoute[]): FileRoute => {
  if (routes.length === 0) return 'text'
  const vision = routes.filter((route) => route === 'vision').length
  const share = vision / routes.length
  if (share <= VISION_SHARE_TEXT_MAX) return 'text'
  if (share <= VISION_SHARE_HYBRID_MAX) return 'hybrid'
  return 'vision'
}

export const shouldForceVision = (totalPages: number, firstPages: PageDoc[]) => {
  if (totalPages <= FORCE_VISION_MIN_PAGES) return false
  if (firstPages.length < 3) return false
  return firstPages.slice(0, 3).every((page) => page.route === 'vision')
}

export const applyVisionCap = (pages: PageDoc[], limit = MAX_VISION_PAGES) => {
  let vision = 0
  let skipped = false
  for (const page of pages) {
    if (page.route !== 'vision') continue
    vision += 1
    if (vision > limit) {
      page.route = 'text'
      skipped = true
    }
  }
  return skipped
}
