import { readFileSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import { describe, expect, it } from 'vitest'
import type { ProjectFile } from '@srdi/shared'
import { createStore } from '../src/store'
import { withTempDir } from './helpers'

const schemaFile = fileURLToPath(new URL('../../shared/schema/evidence.schema.json', import.meta.url))
const validateEvidence = new Ajv({ allErrors: true, strict: false }).compile(
  JSON.parse(readFileSync(schemaFile, 'utf8'))
)

const fileOf = (fileId: string, sha256: string, pages?: number): ProjectFile => ({
  fileId,
  name: `${fileId}.pdf`,
  sha256,
  size: 1024,
  kind: 'pdf',
  ext: 'pdf',
  mime: 'application/pdf',
  status: 'pending',
  uploadedAt: new Date().toISOString(),
  pages
})

describe('项目仓库', () => {
  it('创建项目时按字段目录铺满 40 个 missing', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '南京样例' })
      const doc = await store.evidence.get(project)

      expect(Object.keys(doc.fields)).toHaveLength(40)
      expect(doc.fields['fin.revenue']?.status).toBe('missing')
      expect(doc.fields['fin.revenue']?.label).toBe('营业收入')
      expect(doc.period.y0).toBe(new Date().getFullYear() - 1)
      expect(validateEvidence(doc), JSON.stringify(validateEvidence.errors)).toBe(true)
    })
  })

  it('原子写不留下临时文件', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '原子写' })
      await store.projects.save(project)
      const names = await readdir(path.join(dir, 'projects', project.projectId))
      expect(names.some((name) => name.endsWith('.tmp'))).toBe(false)
      expect(names).toContain('project.json')
    })
  })

  it('同哈希文件只登记一次', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '去重' })
      const first = await store.projects.addFile(project.projectId, fileOf('f_a', 'sha-a'))
      const second = await store.projects.addFile(project.projectId, fileOf('f_b', 'sha-a'))

      expect(first.dup).toBe(false)
      expect(second.dup).toBe(true)
      expect(second.file.fileId).toBe('f_a')
      expect((await store.projects.get(project.projectId)).files).toHaveLength(1)
    })
  })

  it('页数预算超限时拒绝', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '页数预算' })
      await store.projects.addFile(project.projectId, fileOf('f_big', 'sha-big', 380))

      await expect(store.projects.assertPageBudget(project.projectId, 21)).rejects.toMatchObject({
        code: 'page_budget_exceeded'
      })
      await expect(store.projects.assertPageBudget(project.projectId, 20)).resolves.toBeUndefined()
    })
  })

  it('项目编号带路径片段时直接拒绝', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      await expect(store.projects.get('../../etc')).rejects.toMatchObject({
        code: 'invalid_project_id'
      })
    })
  })

  it('小巨人等级暂不支持', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      await expect(store.projects.create({ level: 'LITTLE_GIANT' })).rejects.toMatchObject({
        code: 'level_not_supported'
      })
    })
  })
})

describe('证据仓库', () => {
  it('人工填值会清洗千分位并标记 user', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '确认层' })
      const entry = await store.evidence.patch(project, 'fin.revenue', {
        manualValue: '1,320,000',
        note: '取自审计报告利润表'
      })

      expect(entry.value).toBe(1320000)
      expect(entry.status).toBe('confirmed')
      expect(entry.resolution?.strategy).toBe('manual')
      expect(entry.resolution?.resolvedBy).toBe('user')
      expect(entry.manualNote).toBe('取自审计报告利润表')

      const doc = await store.evidence.get(project)
      expect(validateEvidence(doc), JSON.stringify(validateEvidence.errors)).toBe(true)
    })
  })

  it('追加候选不写 value', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '候选' })
      await store.evidence.appendCandidates(project, 'fin.netProfit', [
        {
          candidateId: 'c_1',
          value: 18600000,
          unit: 'CNY',
          period: 2025,
          raw: '18,600,000.00',
          confidence: 0.96,
          source: { fileId: 'f_1', page: 5, route: 'text' }
        }
      ])

      const doc = await store.evidence.get(project)
      const entry = doc.fields['fin.netProfit']
      expect(entry.status).toBe('candidate')
      expect(entry.value).toBeUndefined()
      expect(entry.candidates).toHaveLength(1)
    })
  })

  it('选候选确认后值与单位一起落到证据表', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '选候选' })
      await store.evidence.appendCandidates(project, 'fin.revenue', [
        {
          candidateId: 'c_1',
          value: 132000000,
          unit: 'CNY',
          period: 2025,
          confidence: 0.96,
          source: { fileId: 'f_1', page: 5, route: 'text' }
        }
      ])

      const entry = await store.evidence.patch(project, 'fin.revenue', { candidateId: 'c_1' })
      expect(entry.value).toBe(132000000)
      expect(entry.unit).toBe('CNY')
      expect(entry.resolution?.pickedCandidateId).toBe('c_1')
      expect(entry.resolution?.strategy).toBe('auto_single')
    })
  })

  it('否决会清空值但保留候选', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '否决' })
      await store.evidence.appendCandidates(project, 'fin.totalProfit', [
        {
          candidateId: 'c_9',
          value: 100,
          source: { fileId: 'f_1', page: 2, route: 'vision' }
        }
      ])
      await store.evidence.patch(project, 'fin.totalProfit', { candidateId: 'c_9' })
      const rejected = await store.evidence.patch(project, 'fin.totalProfit', {
        status: 'rejected'
      })

      expect(rejected.status).toBe('rejected')
      expect(rejected.value).toBeUndefined()
      expect(rejected.candidates).toHaveLength(1)
    })
  })

  it('目录外的字段键拒绝写入', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '未知字段' })
      await expect(
        store.evidence.patch(project, 'fin.notExist', { manualValue: 1 })
      ).rejects.toMatchObject({ code: 'field_not_found' })
    })
  })

  it('非数值填给金额字段会被拦下', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const project = await store.projects.create({ name: '脏值' })
      await expect(
        store.evidence.patch(project, 'fin.netAssets', { manualValue: '约一千万' })
      ).rejects.toMatchObject({ code: 'invalid_value' })
    })
  })
})
