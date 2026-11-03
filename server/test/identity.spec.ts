import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { EvidenceDoc, FieldEntry, ProjectMeta } from '@srdi/shared'
import { resolveIdentity, syncIdentity } from '../src/portal/identity'
import { createStore } from '../src/store'
import { writeJson } from '../src/store/atomic'
import { withTempDir } from './helpers'

const PERIOD = { y0: 2025, y1: 2024, y2: 2023 }

const projectOf = (company?: ProjectMeta['company']): ProjectMeta => ({
  schemaVersion: '1.0.0',
  projectId: 'p_testidentity001',
  name: '测试项目',
  level: 'SRDI',
  rulesId: 'rules.srdi.v1.0.0',
  period: PERIOD,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  files: [],
  ...(company ? { company } : {})
})

const entry = (key: string, type: FieldEntry['type'], value: FieldEntry['value'], status: FieldEntry['status'] = 'confirmed'): FieldEntry => ({
  key,
  type,
  status,
  value
})

const evidenceOf = (fields: Record<string, FieldEntry>): EvidenceDoc => ({
  schemaVersion: '1.0.0',
  projectId: 'p_testidentity001',
  level: 'SRDI',
  rulesId: 'rules.srdi.v1.0.0',
  period: PERIOD,
  fields
})

describe('主体信息解析', () => {
  it('材料合法而手填非法时采用材料值', () => {
    const identity = resolveIdentity({
      project: projectOf({
        name: '上海搜信网络科技有限公司',
        creditCode: '91310105MAIFWSR4SP',
        phone: '13800001111'
      }),
      evidence: evidenceOf({
        'company.creditCode': entry('company.creditCode', 'text', '91310105MA1FW5R45P')
      })
    })
    expect(identity.creditCode).toBe('91310105MA1FW5R45P')
    expect(identity.creditCodeSource).toBe('material')
    expect(identity.warnings).toHaveLength(0)
  })

  it('两者都合法但不同时采用材料值并给出提示', () => {
    const identity = resolveIdentity({
      project: projectOf({
        name: '甲公司',
        creditCode: '91310105MA2FW5R45X',
        phone: '13800001111'
      }),
      evidence: evidenceOf({
        'company.creditCode': entry('company.creditCode', 'text', '91310105MA1FW5R45P')
      })
    })
    expect(identity.creditCode).toBe('91310105MA1FW5R45P')
    expect(identity.creditCodeSource).toBe('material')
    expect(identity.warnings.join()).toContain('不一致')
  })

  it('材料缺失时回落到手填值', () => {
    const identity = resolveIdentity({
      project: projectOf({ name: '甲公司', creditCode: '91310105MA1FW5R45P', phone: '138' }),
      evidence: evidenceOf({})
    })
    expect(identity.creditCode).toBe('91310105MA1FW5R45P')
    expect(identity.creditCodeSource).toBe('input')
  })

  it('两者都不合法时留空并提示', () => {
    const identity = resolveIdentity({
      project: projectOf({ name: '甲公司', creditCode: '91310105MAIFWSR4SP', phone: '138' }),
      evidence: evidenceOf({
        'company.creditCode': entry('company.creditCode', 'text', '91310105MAIFWSR4SP')
      })
    })
    expect(identity.creditCode).toBe('')
    expect(identity.creditCodeSource).toBeNull()
    expect(identity.warnings.join()).toContain('未通过校验')
  })

  it('经营范围只采纳 confirmed 状态并剥离前缀', () => {
    const candidate = resolveIdentity({
      project: projectOf({ name: '甲公司', phone: '138' }),
      evidence: evidenceOf({
        'identity.businessScope': entry(
          'identity.businessScope',
          'text',
          '经营范围：一般项目：技术服务。',
          'candidate'
        )
      })
    })
    expect(candidate.businessScope).toBe('')

    const confirmed = resolveIdentity({
      project: projectOf({ name: '甲公司', phone: '138' }),
      evidence: evidenceOf({
        'identity.businessScope': entry(
          'identity.businessScope',
          'text',
          '经营范围：一般项目：技术服务。',
          'confirmed'
        )
      })
    })
    expect(confirmed.businessScope).toBe('一般项目：技术服务。')
  })

  it('注册资本与成立日期从证据透传', () => {
    const identity = resolveIdentity({
      project: projectOf({ name: '甲公司', phone: '138' }),
      evidence: evidenceOf({
        'identity.registeredCapital': entry('identity.registeredCapital', 'money', 1000000),
        'identity.establishedDate': entry('identity.establishedDate', 'date', '2017-01-20')
      })
    })
    expect(identity.registeredCapital).toBe(1000000)
    expect(identity.establishedDate).toBe('2017-01-20')
  })

  it('历史项目没有 company 时用项目名兜底', () => {
    const identity = resolveIdentity({ project: projectOf(), evidence: evidenceOf({}) })
    expect(identity.name).toBe('测试项目')
    expect(identity.creditCode).toBe('')
  })

  it('回写幂等，第二次不再产生变更', async () => {
    await withTempDir(async (dir) => {
      const store = createStore(dir)
      const created = await store.projects.create(
        {
          name: '上海搜信网络科技有限公司',
          company: {
            name: '上海搜信网络科技有限公司',
            creditCode: '91310105MA1FW5R45P',
            phone: '13800001111'
          },
          period: PERIOD
        },
        undefined
      )

      await writeJson(
        path.join(store.projects.dir(created.projectId), 'evidence.json'),
        evidenceOf({
          'company.creditCode': entry('company.creditCode', 'text', '91310105MA1FW5R45P'),
          'identity.businessScope': entry('identity.businessScope', 'text', '一般项目：技术服务。')
        })
      )

      const first = await syncIdentity(store, created.projectId)
      expect(first).toContain('businessScope')

      const second = await syncIdentity(store, created.projectId)
      expect(second).toHaveLength(0)

      const saved = await store.projects.get(created.projectId)
      expect(saved.company?.creditCode).toBe('91310105MA1FW5R45P')
      expect(saved.company?.creditCodeSource).toBe('material')
    })
  })
})
