import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { Router } from 'express'
import type { Request } from 'express'
import busboy from 'busboy'
import type { ProjectFile, UploadFileResponse } from '@srdi/shared'
import { MAX_FILE_BYTES } from '@srdi/shared'
import { AppError, badRequest, tooLarge } from '../errors'
import { detectFile } from '../pipeline/detect'
import type { AppStore } from '../store'
import { ensureDir, moveFile, removeFile } from '../store/atomic'
import { newFileId } from '../store/project'

interface ReceivedFile {
  tempPath: string
  filename: string
  size: number
  sha256: string
}

const receiveFile = (req: Request, tmpDir: string, maxBytes: number): Promise<ReceivedFile> =>
  new Promise((resolve, reject) => {
    const temps: string[] = []
    let settled = false
    let sawFile = false

    const cleanup = () =>
      Promise.all(temps.map((item) => removeFile(item).catch(() => undefined)))

    const fail = (error: Error) => {
      if (settled) return
      settled = true
      void cleanup().finally(() => reject(error))
    }

    const succeed = (file: ReceivedFile) => {
      if (settled) return
      settled = true
      resolve(file)
    }

    const bb = busboy({
      headers: req.headers as Record<string, string | undefined>,
      defParamCharset: 'utf8',
      limits: { fileSize: maxBytes, files: 1, fields: 4 }
    })

    bb.on('file', (field, stream, info) => {
      if (field !== 'file') {
        stream.resume()
        return
      }
      sawFile = true
      const tempPath = path.join(tmpDir, `${randomUUID()}.part`)
      temps.push(tempPath)
      const out = createWriteStream(tempPath)
      const hash = createHash('sha256')
      let size = 0
      let limited = false

      stream.on('data', (chunk: Buffer) => {
        hash.update(chunk)
        size += chunk.length
      })
      stream.on('limit', () => {
        limited = true
      })
      stream.on('error', (err) => {
        fail(err)
      })
      stream.pipe(out)

      out.on('close', () => {
        if (limited) {
          fail(
            tooLarge(
              'file_too_large',
              `单个文件不能超过 ${Math.max(1, Math.round(maxBytes / 1024 / 1024))}MB`,
              '请拆分文件或先压缩后重试'
            )
          )
          return
        }
        succeed({
          tempPath,
          filename: info.filename?.trim() || '未命名文件',
          size,
          sha256: hash.digest('hex')
        })
      })
      out.on('error', (err) => {
        fail(err)
      })
    })

    bb.on('filesLimit', () => {
      fail(badRequest('too_many_files', '一次只能上传一个文件'))
    })
    bb.on('error', (err) => {
      fail(err instanceof Error ? err : new Error(String(err)))
    })
    bb.on('close', () => {
      if (!sawFile) fail(badRequest('file_missing', '请求里没有名为 file 的文件字段'))
    })
    req.on('aborted', () => {
      fail(badRequest('upload_aborted', '上传被中断'))
    })

    req.pipe(bb)
  })

export interface FilesRouterOptions {
  maxFileBytes?: number
}

export const filesRouter = (store: AppStore, options: FilesRouterOptions = {}) => {
  const router = Router()
  const maxBytes = options.maxFileBytes ?? MAX_FILE_BYTES

  router.post('/projects/:projectId/files', async (req, res) => {
    const projectId = req.params.projectId
    const contentType = (req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.includes('multipart/form-data')) {
      throw badRequest(
        'invalid_upload',
        '上传接口只接受 multipart/form-data',
        '请用名为 file 的字段提交文件'
      )
    }

    await store.projects.get(projectId)
    await ensureDir(store.tmpDir)

    let tempPath: string | null = null

    try {
      const received = await receiveFile(req, store.tmpDir, maxBytes)
      tempPath = received.tempPath

      const detected = await detectFile(tempPath)
      if (!detected.ok) {
        throw new AppError(415, detected.code, detected.message, detected.hint)
      }

      const file: ProjectFile = {
        fileId: newFileId(),
        name: received.filename,
        sha256: received.sha256,
        size: received.size,
        kind: detected.kind,
        ext: detected.ext,
        mime: detected.mime,
        status: 'pending',
        uploadedAt: new Date().toISOString(),
        ...(detected.kind === 'image' ? { pages: 1 } : {})
      }

      if (file.pages) await store.projects.assertPageBudget(projectId, file.pages)

      const target = store.projects.filePath(projectId, file)
      await moveFile(tempPath, target)
      tempPath = null

      let added
      try {
        added = await store.projects.addFile(projectId, file)
      } catch (err) {
        await removeFile(target)
        throw err
      }

      if (added.dup) await removeFile(target)

      const payload: UploadFileResponse = {
        fileId: added.file.fileId,
        name: added.file.name,
        sha256: added.file.sha256,
        size: added.file.size,
        kind: added.file.kind,
        ext: added.file.ext,
        mime: added.file.mime,
        dup: added.dup
      }
      res.status(added.dup ? 200 : 201).json(payload)
    } finally {
      if (tempPath) await rm(tempPath, { force: true }).catch(() => undefined)
    }
  })

  router.delete('/projects/:projectId/files/:fileId', async (req, res) => {
    const projectId = req.params.projectId
    const removed = await store.projects.removeFile(projectId, req.params.fileId)
    await removeFile(store.projects.filePath(projectId, removed))
    res.status(204).end()
  })

  return router
}
