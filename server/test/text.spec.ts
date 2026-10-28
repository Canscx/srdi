import { describe, expect, it } from 'vitest'
import {
  analyzePage,
  garbledRatio,
  groupLines,
  printableLength,
  type TextItemPos
} from '../src/pipeline/text'

const itemOf = (
  str: string,
  x: number,
  y: number,
  width = str.length * 7,
  fontSize = 10
): TextItemPos => ({ str, x, y, width, height: fontSize, fontSize })

const rawOf = (str: string, x: number, y: number, width = str.length * 7) => ({
  str,
  transform: [10, 0, 0, 10, x, y],
  width,
  height: 10
})

describe('文本还原', () => {
  it('同一水平线的碎片合并成一行并按 x 排序', () => {
    const lines = groupLines([itemOf('World', 100, 700), itemOf('Hello', 50, 700)])
    expect(lines).toHaveLength(1)
    expect(lines[0].text).toBe('Hello World')
  })

  it('不同高度分成多行,从上到下', () => {
    const lines = groupLines([
      itemOf('second', 50, 680),
      itemOf('first', 50, 720)
    ])
    expect(lines.map((line) => line.text)).toEqual(['first', 'second'])
  })

  it('中文之间不会被插入空格', () => {
    const lines = groupLines([itemOf('营业', 50, 700, 20), itemOf('收入', 72, 700, 20)])
    expect(lines[0].text).toBe('营业收入')
  })

  it('三列三行会被识别为表格并转伪表格', () => {
    const raw = [
      rawOf('项目', 50, 700),
      rawOf('2025', 150, 700),
      rawOf('2024', 250, 700),
      rawOf('营业收入', 50, 680),
      rawOf('132000000', 150, 680),
      rawOf('120000000', 250, 680),
      rawOf('净利润', 50, 660),
      rawOf('18600000', 150, 660),
      rawOf('15000000', 250, 660)
    ]

    const analysis = analyzePage(raw)
    expect(analysis.tables).toHaveLength(1)
    expect(analysis.tables[0].rows).toBe(3)
    expect(analysis.tables[0].cols).toBe(3)
    expect(analysis.tables[0].text).toContain('营业收入 | 132000000 | 120000000')
  })

  it('两列不会被误判为表格', () => {
    const raw = [
      rawOf('项目', 50, 700),
      rawOf('金额', 150, 700),
      rawOf('营业收入', 50, 680),
      rawOf('132000000', 150, 680),
      rawOf('净利润', 50, 660),
      rawOf('18600000', 150, 660)
    ]
    expect(analyzePage(raw).tables).toHaveLength(0)
  })
})

describe('文本质量指标', () => {
  it('可打印字符数忽略空白', () => {
    expect(printableLength(' 营业 收入 \n 2025 ')).toBe(8)
  })

  it('乱码率按替换字符占比计算', () => {
    expect(garbledRatio('abc\uFFFD\uFFFD')).toBeCloseTo(0.4, 5)
    expect(garbledRatio('   ')).toBe(0)
  })

  it('有字形的判断看宽度与内容', () => {
    const analysis = analyzePage([rawOf('文本', 50, 700)])
    expect(analysis.hasGlyphs).toBe(true)
    expect(analysis.printableChars).toBe(2)
  })
})
