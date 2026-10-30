import path from 'node:path'
import type { FilePages, ProjectMeta } from '@srdi/shared'
import { loadIndustryMap } from '../config/industryMap'
import type { AppStore } from '../store'
import { readJson } from '../store/atomic'

export interface IndustryGuess {
  code: string | null
  name: string | null
  source: 'document' | 'keyword' | 'none'
  matched: string | null
}

const CJK_GAP = /([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g

const normalize = (text: string) => text.replace(CJK_GAP, '$1').replace(/[\s\u3000]+/g, '')

const PRIORITY: Record<string, number> = { tax: 0, application: 1, audit: 2, finance: 2 }

const orderedIds = (project: ProjectMeta) =>
  [...project.files]
    .sort((left, right) => {
      const a = PRIORITY[left.docType ?? ''] ?? 9
      const b = PRIORITY[right.docType ?? ''] ?? 9
      return a - b
    })
    .map((file) => file.fileId)

const readText = async (store: AppStore, project: ProjectMeta, fileId: string) => {
  const file = path.join(store.projects.dir(project.projectId), 'pages', `${fileId}.json`)
  const pages = await readJson<FilePages>(file)
  if (!pages) return ''
  return pages.pages.map((page) => page.text ?? '').join('\n')
}

export const inferIndustry = async (
  store: AppStore,
  project: ProjectMeta
): Promise<IndustryGuess> => {
  const map = loadIndustryMap()
  if (map.rules.length === 0) return { code: null, name: null, source: 'none', matched: null }

  let text = ''
  for (const fileId of orderedIds(project)) {
    text = normalize(await readText(store, project, fileId))
    if (text.length === 0) continue

    for (const rule of map.rules) {
      if (text.includes(normalize(rule.name))) {
        return { code: rule.code, name: rule.name, source: 'document', matched: rule.name }
      }
    }

    for (const rule of map.rules) {
      const hit = rule.keywords.find((keyword) => text.includes(normalize(keyword)))
      if (hit) return { code: rule.code, name: rule.name, source: 'keyword', matched: hit }
    }
  }

  return { code: null, name: null, source: 'none', matched: null }
}
