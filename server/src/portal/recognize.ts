import { randomUUID } from 'node:crypto'
import { copyFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import type { LicenseProfile } from '@srdi/shared'
import type { ModelClient } from '../ai/client'
import { loadPortalConfig } from '../config/portal'
import { badRequest } from '../errors'
import { detectFile } from '../pipeline/detect'
import { parseImage } from '../pipeline/image'
import { parsePdf } from '../pipeline/pdf'
import type { AppStore } from '../store'
import { ensureDir, readJson, writeJson } from '../store/atomic'
import { cleanBusinessScope } from './scope'

export interface RecognizeInput {
  store: AppStore
  client: ModelClient
  model: string
  filePath: string
  sha256: string
}

interface RawLicense {
  businessScope?: string
  registeredCapital?: number | string
  establishedDate?: string
}

const CACHE_TTL_FALLBACK = 720

const LICENSE_PROMPT = `你是营业执照抄录员。只输出一个 JSON 对象,不要 Markdown 代码块,不要解释。

字段:
- businessScope: 经营范围,整段原文抄录,不得概括,不得省略「一般项目」「许可项目」分段
- registeredCapital: 注册资本,一律折成元,只填数字,不填单位
- establishedDate: 成立日期,格式 YYYY-MM-DD

抄不到的字段填空字符串,不要编造,不要用其它企业的信息补全。`

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

const askLicense = async (
  client: ModelClient,
  model: string,
  imagePath: string
): Promise<RawLicense | null> => {
  try {
    const bytes = await readFile(imagePath)
    const response = await client.complete({
      model,
      temperature: 0,
      maxTokens: 2400,
      timeoutMs: 90_000,
      messages: [
        { role: 'system', content: LICENSE_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'image', mime: 'image/jpeg', data: bytes.toString('base64') },
            { type: 'text', text: '请抄录这张营业执照。' }
          ]
        }
      ]
    })
    return parseJson(response.text)
  } catch {
    return null
  }
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

    const businessScope = cleanBusinessScope(raw?.businessScope ?? '')
    const registeredCapital = toYuan(raw?.registeredCapital)
    const establishedDate = toDate(raw?.establishedDate)
    if (!businessScope) warnings.push('没读到经营范围，可以重传一张更清晰的照片')

    const profile: LicenseProfile = {
      businessScope,
      registeredCapital,
      establishedDate,
      confidence: businessScope ? 0.9 : registeredCapital || establishedDate ? 0.7 : 0.4,
      warnings,
      cached: false
    }

    if (profile.businessScope || profile.registeredCapital || profile.establishedDate) {
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
