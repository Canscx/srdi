import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { openSync } from 'fontkit'
import type { Font, FontCollection } from 'fontkit'
import { AppError } from '../errors'
import { PROJECT_ROOT } from '../paths'

export interface ReportFont {
  path: string
  postscriptName?: string
  family: string
  source: string
}

export interface FontProbe {
  path: string
  source: string
  ok: boolean
  detail: string
}

const FONT_EXTENSIONS = new Set(['.ttf', '.ttc', '.otf'])
const CJK_PROBES = [0x4e2d, 0x6587, 0x9879, 0x8bc1]
const SIMPLIFIED_HINT = /SC|sc-|sc_|Simplified|GB/

const WIN_FONTS = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/Deng.ttf',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simsun.ttc'
]

const MAC_FONTS = [
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/System/Library/Fonts/STHeiti Light.ttc',
  '/Library/Fonts/Arial Unicode.ttf'
]

const LINUX_FONTS = [
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf',
  '/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
  '/usr/share/fonts/wqy-zenhei/wqy-zenhei.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
  '/usr/share/fonts/truetype/arphic/uming.ttc',
  '/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf'
]

const nameOf = (face: Font): string => `${face.familyName ?? ''} ${face.postscriptName ?? ''}`

const hasCjk = (face: Font): boolean => {
  try {
    return CJK_PROBES.every((code) => face.hasGlyphForCodePoint(code))
  } catch {
    return false
  }
}

const pickFace = (faces: Font[]): Font | null => {
  const usable = faces.filter(hasCjk)
  if (usable.length === 0) return null
  return usable.find((face) => SIMPLIFIED_HINT.test(nameOf(face))) ?? usable[0]
}

const inspect = (file: string, source: string): { font: ReportFont | null; detail: string } => {
  if (!existsSync(file)) return { font: null, detail: '文件不存在' }
  try {
    if (!statSync(file).isFile()) return { font: null, detail: '不是普通文件' }
    const parsed = openSync(file)
    if (!parsed) return { font: null, detail: '字体引擎无法识别该文件' }

    if ('fonts' in parsed) {
      const collection = parsed as FontCollection
      const face = pickFace(collection.fonts)
      if (!face) return { font: null, detail: `${collection.fonts.length} 个字面均缺中文字形` }
      const postscriptName = face.postscriptName
      if (typeof postscriptName !== 'string' || postscriptName.length === 0) {
        return { font: null, detail: '字面缺少 PostScript 名' }
      }
      return {
        font: {
          path: file,
          postscriptName,
          family: face.familyName || postscriptName,
          source
        },
        detail: `字面 ${postscriptName}`
      }
    }

    const single = parsed as Font
    if (!hasCjk(single)) return { font: null, detail: '缺中文字形' }
    return {
      font: { path: file, family: single.familyName || path.basename(file), source },
      detail: single.familyName || path.basename(file)
    }
  } catch (err) {
    return { font: null, detail: `无法解析：${(err as Error).message}` }
  }
}

export const inspectFont = (
  file: string,
  source = '手动指定'
): { font: ReportFont | null; detail: string } => inspect(file, source)

const envFonts = (): string[] =>
  (process.env.REPORT_FONT_PATH ?? '')
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter((item) => item.length > 0)

const projectFonts = (): string[] => {
  const dir = path.join(PROJECT_ROOT, 'fonts')
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((name) => FONT_EXTENSIONS.has(path.extname(name).toLowerCase()))
      .sort()
      .map((name) => path.join(dir, name))
  } catch {
    return []
  }
}

const systemFonts = (): string[] => {
  if (process.platform === 'win32') return WIN_FONTS
  if (process.platform === 'darwin') return MAC_FONTS
  return LINUX_FONTS
}

const fontconfigFonts = (): string[] => {
  if (process.platform === 'win32') return []
  try {
    const output = execFileSync('fc-match', ['-f', '%{file}\n', 'sans-serif:lang=zh-cn'], {
      encoding: 'utf8',
      timeout: 3000
    })
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

const collect = (): { file: string; source: string }[] => [
  ...envFonts().map((file) => ({ file, source: 'REPORT_FONT_PATH' })),
  ...projectFonts().map((file) => ({ file, source: '项目 fonts 目录' })),
  ...systemFonts().map((file) => ({ file, source: '系统字体' })),
  ...fontconfigFonts().map((file) => ({ file, source: 'fontconfig' }))
]

const scan = (): { font: ReportFont | null; probes: FontProbe[] } => {
  const probes: FontProbe[] = []
  const seen = new Set<string>()
  for (const entry of collect()) {
    const key = path.resolve(entry.file)
    if (seen.has(key)) continue
    seen.add(key)
    const result = inspect(entry.file, entry.source)
    probes.push({
      path: entry.file,
      source: entry.source,
      ok: result.font !== null,
      detail: result.detail
    })
    if (result.font) return { font: result.font, probes }
  }
  return { font: null, probes }
}

let cached: ReportFont | null = null
let lastProbes: FontProbe[] = []

export const probeReportFonts = (): { font: ReportFont | null; probes: FontProbe[] } => {
  if (cached) return { font: cached, probes: lastProbes }
  const outcome = scan()
  lastProbes = outcome.probes
  cached = outcome.font
  return outcome
}

export const describeReportFont = (): ReportFont | null => probeReportFonts().font

export const resolveReportFont = (): ReportFont => {
  const { font, probes } = probeReportFonts()
  if (font) return font
  const tried = probes.map((item) => `  ${item.path}（${item.source} · ${item.detail}）`).join('\n')
  throw new AppError(
    500,
    'report_font_missing',
    '未找到可用的中文字体,无法生成 PDF',
    `把中文 ttf/ttc/otf 放进 ${path.join(PROJECT_ROOT, 'fonts')} 目录,或用 REPORT_FONT_PATH 指向字体文件后重启进程。\n已尝试 ${probes.length} 个位置:\n${tried}`
  )
}
