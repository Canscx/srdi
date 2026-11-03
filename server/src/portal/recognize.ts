import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import type { LicenseProfile } from '@srdi/shared'
import { isValidCreditCode, normalizeCreditCode } from '@srdi/shared'
import type { ModelClient } from '../ai/client'
import { loadPortalConfig } from '../config/portal'
import { badRequest } from '../errors'
import { detectFile } from '../pipeline/detect'
import { parseImage } from '../pipeline/image'
import { parsePdf } from '../pipeline/pdf'
import { cleanBusinessScope } from './scope'
import type { AppStore } from '../store'
import { ensureDir, readJson, writeJson } from '../store/atomic'

export interface RecognizeInput {
  store: AppStore
  client: ModelClient
  model: string
  filePath: string
  sha256: string
}

interface RawLicense {
  creditCode?: string
  businessScope?: string
  registeredCapital?: number | string
  establishedDate?: string
}

const CACHE_TTL_FALLBACK = 720

const LICENSE_PROMPT = `你是营业执照抄录员。只输出一个 JSON 对象,不要 Markdown 代码块,不要解释。

字段:
- creditCode: 统一社会信用代码,18 位。逐位核对,数字 1 与字母 I、数字 0 与字母 O、数字 5 与字母 S、数字 8 与字母 B 必须分清
- businessScope: 经营范围,整段原文抄录,不得概括,不得省略「一般项目」「许可项目」分段
- registeredCapital: 注册资本,一律折成元,只填数字,不填单位
- establishedDate: 成立日期,格式 YYYY-MM-DD

抄不到的字段填空字符串,不要编造,不要用其它企业的信息补全。`

const DETAIL_PROMPT = `下面是同一张营业执照「统一社会信用代码」区域的局部放大图,分别按 90° 与 270° 旋转,只有一张是正立的。
只输出一个 JSON 对象:{"creditCode":"18 位统一社会信用代码"}
逐位核对,数字 1 与字母 I、数字 0 与字母 O、数字 5 与字母 S、数字 8 与字母 B 必须分清。看不清就填空字符串。`

const cacheFile = (store: AppStore, sha256: string) =>
  path.join(store.dataDir, 'cache', 'recognize', `${sha256}.json`)

const readCache = async (
  store: AppStore,
  sha256: string,
  ttlHours: number
): Promise<LicenseProfile | null> => {
  const cached = await readJson<{ profile: LicenseProfile; cachedAt: string }>(
    cacheFile(store, sha256)
  )
  if (!cached?.profile) return null
  const age = Date.now() - new Date(cached.cachedAt).getTime()
  if (!Number.isFinite(age) || age < 0 || age > ttlHours * 3_600_000) return null
  return { ...cached.profile, cached: true }
}

const parseJson = (text: string): RawLicense | null => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as RawLicense
  } catch {
    return null
  }
}

const toYuan = (value: number | string | undefined): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value !== 'string') return null
  const text = value.replace(/[,，\s]/g, '')
  const match = text.match(/(\d+(?:\.\d+)?)/)
  if (!match) return null
  const base = Number(match[1])
  if (!Number.isFinite(base)) return null
  if (/亿/.test(text)) return Math.round(base * 100_000_000)
  if (/万/.test(text)) return Math.round(base * 10_000)
  return Math.round(base)
}

const toDate = (value: string | undefined): string => {
  const text = (value ?? '').trim()
  const match = text.match(/(\d{4})\D{0,3}(\d{1,2})?\D{0,3}(\d{1,2})?/)
  if (!match) return ''
  const year = match[1]
  const month = (match[2] ?? '1').padStart(2, '0')
  const day = (match[3] ?? '1').padStart(2, '0')
  return `${year}-${month}-${day}`
}

const rotatedCanvas = async (source: string, degrees: number) => {
  const image = await loadImage(source)
  const swap = Math.abs(degrees % 180) === 90
  const width = swap ? image.height : image.width
  const height = swap ? image.width : image.height
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.translate(width / 2, height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(image, -image.width / 2, -image.height / 2)
  return canvas
}

const DETAIL_ROTATIONS = [90, 270]
const DETAIL_REGION = { x: 0.17, y: 0.25, w: 0.2, h: 0.12 }
const DETAIL_LONG_EDGE = 1000

const writeRegionCrop = async (
  source: string,
  target: string,
  degrees: number,
  rect: { x: number; y: number; w: number; h: number }
): Promise<boolean> => {
  try {
    const base = await rotatedCanvas(source, degrees)
    const rx = Math.round(rect.x * base.width)
    const ry = Math.round(rect.y * base.height)
    const rw = Math.round(rect.w * base.width)
    const rh = Math.round(rect.h * base.height)
    const scale = Math.max(1, DETAIL_LONG_EDGE / Math.max(rw, rh))
    const canvas = createCanvas(Math.round(rw * scale), Math.round(rh * scale))
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(base, rx, ry, rw, rh, 0, 0, canvas.width, canvas.height)
    await writeFile(target, canvas.toBuffer('image/jpeg', 95))
    return true
  } catch {
    return false
  }
}

const askJson = async (
  client: ModelClient,
  model: string,
  system: string,
  images: string[],
  text: string,
  maxTokens: number
): Promise<RawLicense | null> => {
  try {
    const content = []
    for (const imagePath of images) {
      const bytes = await readFile(imagePath)
      content.push({ type: 'image' as const, mime: 'image/jpeg', data: bytes.toString('base64') })
    }
    content.push({ type: 'text' as const, text })
    const response = await client.complete({
      model,
      temperature: 0,
      maxTokens,
      timeoutMs: 90_000,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content }
      ]
    })
    return parseJson(response.text)
  } catch {
    return null
  }
}

const askLicense = (client: ModelClient, model: string, imagePath: string) =>
  askJson(client, model, LICENSE_PROMPT, [imagePath], '请抄录这张营业执照。', 2400)

const askDetail = async (
  client: ModelClient,
  model: string,
  imagePath: string,
  workDir: string
): Promise<RawLicense | null> => {
  const crops: string[] = []
  for (const degrees of DETAIL_ROTATIONS) {
    const target = path.join(workDir, `detail-${degrees}.jpg`)
    if (await writeRegionCrop(imagePath, target, degrees, DETAIL_REGION)) {
      crops.push(target)
    }
  }
  if (crops.length === 0) return null
  return askJson(client, model, DETAIL_PROMPT, crops, '请读出统一社会信用代码。', 200)
}

const firstPageImage = async (options: {
  kind: 'pdf' | 'image'
  filePath: string
  fileId: string
  workDir: string
  maxPages: number
}): Promise<string> => {
  if (options.kind === 'pdf') {
    const parsed = await parsePdf({
      filePath: options.filePath,
      fileId: options.fileId,
      imagesDir: path.join(options.workDir, 'pages', options.fileId),
      imagePrefix: `pages/${options.fileId}`,
      onOpen: (totalPages) => {
        if (totalPages > options.maxPages) {
          throw badRequest(
            'too_many_pages',
            `这份文件有 ${totalPages} 页，不像营业执照`,
            '营业执照通常只有 1 页，请确认后再传'
          )
        }
      }
    })
    const page = parsed.pages[0]
    if (!page?.image) throw badRequest('unreadable_license', '这份 PDF 没有可读的页面')
    return path.join(options.workDir, page.image)
  }

  const parsed = await parseImage({
    fileId: options.fileId,
    filePath: options.filePath,
    projectDir: options.workDir
  })
  const page = parsed.pages[0]
  if (!page?.image) throw badRequest('unreadable_license', '这张图片打不开')
  return path.join(options.workDir, page.image)
}

export const recognizeLicense = async (input: RecognizeInput): Promise<LicenseProfile> => {
  const config = loadPortalConfig().recognize
  const ttlHours = config.ttlHours || CACHE_TTL_FALLBACK
  const cached = await readCache(input.store, input.sha256, ttlHours)
  if (cached) return cached

  const detected = await detectFile(input.filePath)
  if (!detected.ok) throw badRequest('unrecognized_file', detected.message, detected.hint)
  if (detected.kind !== 'pdf' && detected.kind !== 'image') {
    throw badRequest('unrecognized_file', '营业执照只支持图片或 PDF', '请上传 JPG、PNG 或 PDF')
  }

  const fileId = `r_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const workDir = path.join(input.store.dataDir, 'tmp', 'recognize', fileId)
  const localPath = path.join(workDir, 'files', `${fileId}.${detected.ext}`)

  try {
    await ensureDir(path.dirname(localPath))
    await copyFile(input.filePath, localPath)

    const imagePath = await firstPageImage({
      kind: detected.kind === 'pdf' ? 'pdf' : 'image',
      filePath: localPath,
      fileId,
      workDir,
      maxPages: config.maxPages
    })

    const raw = await askLicense(input.client, input.model, imagePath)
    const warnings: string[] = []

    const rawCode = normalizeCreditCode(raw?.creditCode ?? '')
    let creditCode = rawCode.length === 18 && isValidCreditCode(rawCode) ? rawCode : ''

    if (!creditCode) {
      const detail = await askDetail(input.client, input.model, imagePath, workDir)
      const detailCode = normalizeCreditCode(detail?.creditCode ?? '')
      if (detailCode.length === 18 && isValidCreditCode(detailCode)) creditCode = detailCode
    }

    if (!creditCode) warnings.push('统一社会信用代码没认准，已留空；可以重传一张更清晰的照片')
    const businessScope = cleanBusinessScope(raw?.businessScope ?? '')
    const registeredCapital = toYuan(raw?.registeredCapital)
    const establishedDate = toDate(raw?.establishedDate)

    const profile: LicenseProfile = {
      creditCode,
      businessScope,
      registeredCapital,
      establishedDate,
      confidence: creditCode ? 0.92 : businessScope ? 0.7 : 0.4,
      warnings,
      cached: false
    }

    if (profile.creditCode || profile.businessScope) {
      await ensureDir(path.dirname(cacheFile(input.store, input.sha256)))
      await writeJson(cacheFile(input.store, input.sha256), {
        profile,
        cachedAt: new Date().toISOString()
      })
    }

    return profile
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
