import { describe, expect, it } from 'vitest'
import type { PageDoc } from '@srdi/shared'
import {
  applyVisionCap,
  decideFileRoute,
  decidePageRoute,
  shouldForceVision
} from '../src/pipeline/route'

const pageOf = (route: 'text' | 'vision', page = 1): PageDoc => ({
  fileId: 'f_test',
  page,
  route,
  width: 595,
  height: 842,
  text: '',
  blocks: [],
  tables: [],
  printableChars: 0,
  hasGlyphs: false,
  garbledRatio: 0
})

describe('页级路由', () => {
  it('少于 30 个可见字符走视觉', () => {
    expect(
      decidePageRoute({ printableChars: 29, hasGlyphs: true, garbledRatio: 0 })
    ).toBe('vision')
  })

  it('字符够且有字形走文本', () => {
    expect(
      decidePageRoute({ printableChars: 30, hasGlyphs: true, garbledRatio: 0 })
    ).toBe('text')
  })

  it('有文本层但没有字形仍走视觉', () => {
    expect(
      decidePageRoute({ printableChars: 200, hasGlyphs: false, garbledRatio: 0 })
    ).toBe('vision')
  })

  it('乱码率超过 15% 降级视觉', () => {
    expect(
      decidePageRoute({ printableChars: 200, hasGlyphs: true, garbledRatio: 0.16 })
    ).toBe('vision')
    expect(
      decidePageRoute({ printableChars: 200, hasGlyphs: true, garbledRatio: 0.15 })
    ).toBe('text')
  })
})

describe('文件级路由', () => {
  it('图片页占比两成及以下算纯文本', () => {
    expect(decideFileRoute(['vision', 'text', 'text', 'text', 'text'])).toBe('text')
  })

  it('两成到五成算混合', () => {
    expect(decideFileRoute(['vision', 'vision', 'text', 'text', 'text'])).toBe('hybrid')
  })

  it('超过五成算整份视觉', () => {
    expect(decideFileRoute(['vision', 'vision', 'vision', 'text', 'text'])).toBe('vision')
  })

  it('没有页面时按文本处理', () => {
    expect(decideFileRoute([])).toBe('text')
  })
})

describe('扫描件快判', () => {
  it('超过 30 页且前三页全图直接判扫描件', () => {
    expect(shouldForceVision(31, [pageOf('vision'), pageOf('vision'), pageOf('vision')])).toBe(true)
  })

  it('只有 30 页不触发快判', () => {
    expect(shouldForceVision(30, [pageOf('vision'), pageOf('vision'), pageOf('vision')])).toBe(
      false
    )
  })

  it('前三页有一页有文字就不快判', () => {
    expect(
      shouldForceVision(50, [pageOf('vision'), pageOf('text'), pageOf('vision')])
    ).toBe(false)
  })
})

describe('视觉页上限', () => {
  it('第 41 页起只保留文本层并打标', () => {
    const pages = Array.from({ length: 42 }, (_, index) => pageOf('vision', index + 1))
    const skipped = applyVisionCap(pages, 40)

    expect(skipped).toBe(true)
    expect(pages.slice(0, 40).every((page) => page.route === 'vision')).toBe(true)
    expect(pages[40].route).toBe('text')
    expect(pages[41].route).toBe('text')
  })

  it('未超限时不动路由', () => {
    const pages = [pageOf('vision'), pageOf('text')]
    expect(applyVisionCap(pages, 40)).toBe(false)
    expect(pages[0].route).toBe('vision')
  })
})
