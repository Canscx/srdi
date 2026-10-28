import { open, stat } from 'node:fs/promises'
import type { FileKind } from '@srdi/shared'

export type DetectFailureCode =
  | 'legacy_office'
  | 'unsupported_office'
  | 'unsupported_container'
  | 'unknown_format'

export interface DetectOk {
  ok: true
  kind: FileKind
  ext: string
  mime: string
}

export interface DetectFail {
  ok: false
  code: DetectFailureCode
  message: string
  hint: string
}

export type DetectResult = DetectOk | DetectFail

const HEAD_BYTES = 1024
const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50

const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
} as const

const readAt = async (file: string, start: number, length: number) => {
  const handle = await open(file, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, start)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

const readZipEntries = async (file: string): Promise<string[]> => {
  const size = (await stat(file)).size
  if (size < 22) return []
  const tailLength = Math.min(size, 66_000)
  const tail = await readAt(file, size - tailLength, tailLength)

  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tail.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) return []

  const total = tail.readUInt16LE(eocd + 10)
  const centralSize = tail.readUInt32LE(eocd + 12)
  const centralOffset = tail.readUInt32LE(eocd + 16)
  if (total === 0xffff || centralOffset === 0xffffffff || centralSize === 0) return []

  const central = await readAt(file, centralOffset, centralSize)
  const names: string[] = []
  let cursor = 0

  for (let index = 0; index < total; index += 1) {
    if (cursor + 46 > central.length) break
    if (central.readUInt32LE(cursor) !== CENTRAL_SIG) break
    const nameLength = central.readUInt16LE(cursor + 28)
    const extraLength = central.readUInt16LE(cursor + 30)
    const commentLength = central.readUInt16LE(cursor + 32)
    const start = cursor + 46
    names.push(central.subarray(start, start + nameLength).toString('utf8'))
    cursor = start + nameLength + extraLength + commentLength
  }

  return names
}

const fail = (
  code: DetectFailureCode,
  message: string,
  hint: string
): DetectFail => ({ ok: false, code, message, hint })

const detectZip = async (file: string): Promise<DetectResult> => {
  const entries = new Set(await readZipEntries(file))
  if (entries.has('word/document.xml')) {
    return { ok: true, kind: 'docx', ext: 'docx', mime: MIME.docx }
  }
  if (entries.has('xl/workbook.xml')) {
    return { ok: true, kind: 'xlsx', ext: 'xlsx', mime: MIME.xlsx }
  }
  if (entries.has('ppt/presentation.xml')) {
    return fail(
      'unsupported_office',
      '暂不支持 PPT 材料',
      '请把相关页导出为 PDF 或截图后上传'
    )
  }
  return fail(
    'unsupported_container',
    '压缩包里没有找到 Word 或 Excel 文档',
    '请直接上传 docx 或 xlsx,不要上传 zip 或 wps'
  )
}

const detectImage = (head: Buffer): DetectResult | null => {
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { ok: true, kind: 'image', ext: 'jpg', mime: MIME.jpg }
  }
  if (
    head.length >= 8 &&
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47 &&
    head[4] === 0x0d &&
    head[5] === 0x0a &&
    head[6] === 0x1a &&
    head[7] === 0x0a
  ) {
    return { ok: true, kind: 'image', ext: 'png', mime: MIME.png }
  }
  if (
    head.length >= 12 &&
    head.subarray(0, 4).toString('latin1') === 'RIFF' &&
    head.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return { ok: true, kind: 'image', ext: 'webp', mime: MIME.webp }
  }
  return null
}

export const detectFile = async (file: string): Promise<DetectResult> => {
  const size = (await stat(file)).size
  if (size === 0) {
    return fail('unknown_format', '文件是空的', '请重新上传一个有内容的文件')
  }

  const head = await readAt(file, 0, HEAD_BYTES)

  if (head.indexOf('%PDF') >= 0) {
    return { ok: true, kind: 'pdf', ext: 'pdf', mime: MIME.pdf }
  }

  if (head.length >= 4 && head.readUInt32BE(0) === 0x504b0304) {
    return detectZip(file)
  }

  if (
    head.length >= 8 &&
    head[0] === 0xd0 &&
    head[1] === 0xcf &&
    head[2] === 0x11 &&
    head[3] === 0xe0 &&
    head[4] === 0xa1 &&
    head[5] === 0xb1 &&
    head[6] === 0x1a &&
    head[7] === 0xe1
  ) {
    return fail(
      'legacy_office',
      '这是老版 Office 格式,无法可靠解析',
      '请在 Word 或 Excel 里另存为 docx / xlsx 后重新上传'
    )
  }

  const image = detectImage(head)
  if (image) return image

  return fail(
    'unknown_format',
    '无法识别的文件格式',
    '支持 PDF、docx、xlsx、jpg、png、webp 六种格式'
  )
}
