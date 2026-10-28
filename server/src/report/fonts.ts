import { existsSync } from 'node:fs'
import { AppError } from '../errors'

export interface ReportFont {
  path: string
  family?: string
}

const CANDIDATES: ReportFont[] = [
  { path: process.env.REPORT_FONT_PATH ?? '' },
  { path: 'C:/Windows/Fonts/simhei.ttf' },
  { path: 'C:/Windows/Fonts/msyh.ttc', family: 'Microsoft YaHei' },
  { path: 'C:/Windows/Fonts/simsun.ttc', family: 'SimSun' },
  { path: '/System/Library/Fonts/PingFang.ttc', family: 'PingFang SC' },
  { path: '/System/Library/Fonts/Hiragino Sans GB.ttc', family: 'Hiragino Sans GB' },
  { path: '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
  { path: '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc', family: 'Noto Sans CJK SC' },
  { path: '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', family: 'WenQuanYi Zen Hei' }
].filter((candidate) => candidate.path.length > 0)

let cached: ReportFont | null = null

export const resolveReportFont = (): ReportFont => {
  if (cached) return cached
  for (const candidate of CANDIDATES) {
    if (existsSync(candidate.path)) {
      cached = candidate
      return candidate
    }
  }
  throw new AppError(
    500,
    'report_font_missing',
    '未找到可用的中文字体,无法生成 PDF',
    '设置环境变量 REPORT_FONT_PATH 指向中文字体文件(ttf / otf / ttc)后重试'
  )
}
