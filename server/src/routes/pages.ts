import { Router } from 'express'
import path from 'node:path'
import type { FilePages, ProjectMeta } from '@srdi/shared'
import { notFound } from '../errors'
import type { AppStore } from '../store'
import { exists, readJson } from '../store/atomic'

const projectDirOf = (store: AppStore, project: ProjectMeta) =>
  path.resolve(store.projects.dir(project.projectId))

const locateProject = async (
  store: AppStore,
  fileId: string,
  projectId?: string
): Promise<ProjectMeta> => {
  if (projectId) {
    const meta = await store.projects.get(projectId)
    if (meta.files.some((file) => file.fileId === fileId)) return meta
    throw notFound('file_not_found', '文件不在该项目中')
  }
  for (const summary of await store.projects.list()) {
    const meta = await store.projects.get(summary.projectId)
    if (meta.files.some((file) => file.fileId === fileId)) return meta
  }
  throw notFound('file_not_found', '文件不存在')
}

const readPages = async (store: AppStore, project: ProjectMeta, fileId: string) => {
  const file = path.join(projectDirOf(store, project), 'pages', `${fileId}.json`)
  const pages = await readJson<FilePages>(file)
  if (!pages) throw notFound('pages_not_found', '该文件尚未解析', '先执行解析再查看页数据')
  return pages
}

const parsePageNo = (raw: string) => {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw notFound('page_not_found', '页号必须是正整数')
  }
  return value
}

export const pagesRouter = (store: AppStore) => {
  const router = Router()

  router.get('/projects/:projectId/pages/:fileId', async (req, res) => {
    const project = await store.projects.get(req.params.projectId)
    const pages = await readPages(store, project, req.params.fileId)
    res.json(pages)
  })

  router.get('/files/:fileId/page/:pageNo', async (req, res, next) => {
    const pageNo = parsePageNo(req.params.pageNo)
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined
    const project = await locateProject(store, req.params.fileId, projectId)
    const pages = await readPages(store, project, req.params.fileId)
    const page = pages.pages.find((item) => item.page === pageNo)
    if (!page) {
      throw notFound('page_not_found', `该文件只有 ${pages.pages.length} 页`)
    }
    if (!page.image) {
      throw notFound(
        'page_image_missing',
        '该页没有页图',
        'DOCX 与 XLSX 不生成页图,可查看文本层'
      )
    }
    const root = projectDirOf(store, project)
    const target = path.resolve(root, page.image)
    if (!target.startsWith(`${root}${path.sep}`)) {
      throw notFound('page_image_missing', '页图路径越界')
    }
    if (!(await exists(target))) {
      throw notFound('page_image_missing', '页图文件缺失,建议重新解析')
    }
    res.setHeader('cache-control', 'private, max-age=600')
    res.type(path.extname(target))
    res.sendFile(target, (err) => {
      if (err && !res.headersSent) next(err)
    })
  })

  return router
}
