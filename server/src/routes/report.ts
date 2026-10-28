import { Router } from 'express'
import { loadRules } from '../config/rules'
import { badRequest, conflict } from '../errors'
import { buildReport } from '../report/build'
import { renderMarkdown } from '../report/markdown'
import { renderPdf } from '../report/pdf'
import type { AppStore } from '../store'

const FORMATS = new Set(['md', 'pdf', 'json'])

const safeName = (value: string): string => {
  const cleaned = value
    .replace(/[\\/:*?"<>|\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
  return cleaned || '项目'
}

const stamp = (): string => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}`
}

const disposition = (filename: string, inline: boolean): string => {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    filename
  )}`
}

export const reportRouter = (store: AppStore) => {
  const router = Router()

  router.get('/projects/:projectId/report', async (req, res) => {
    const raw = Array.isArray(req.query.format) ? req.query.format[0] : req.query.format
    const format = typeof raw === 'string' && raw.length > 0 ? raw : 'md'
    if (!FORMATS.has(format)) {
      throw badRequest('invalid_format', 'format 只能是 md / pdf / json')
    }

    const project = await store.projects.get(req.params.projectId)
    const record = await store.scores.get(project.projectId)
    if (!record) {
      throw conflict(
        'score_required',
        '还没有评分结果,无法生成报告',
        '先在评分页生成参考得分再导出'
      )
    }

    const evidence = await store.evidence.get(project)
    const model = buildReport(project, evidence, record, loadRules())
    const filename = `${safeName(project.name)}-自评报告-${stamp()}`
    const inline = req.query.inline === '1'

    if (format === 'json') {
      res.json(model)
      return
    }

    if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
      res.setHeader('Content-Disposition', disposition(`${filename}.md`, inline))
      res.send(renderMarkdown(model))
      return
    }

    const pdf = await renderPdf(model)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', disposition(`${filename}.pdf`, inline))
    res.send(pdf)
  })

  return router
}
