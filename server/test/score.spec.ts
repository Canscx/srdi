import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { EvidenceDoc, RulesMetaResponse, ScoreResponse } from '@srdi/shared'
import { createStore } from '../src/store'
import { writeJson } from '../src/store/atomic'
import { startServer, type TestServer } from './helpers'

const PERIOD = { y0: 2025, y1: 2024, y2: 2023 }

const readFixture = (name: string): EvidenceDoc =>
  JSON.parse(
    readFileSync(new URL(`../../shared/test/fixtures/${name}.json`, import.meta.url), 'utf8')
  ) as EvidenceDoc

let dir = ''
let server: TestServer
let passProject = ''
let criticalProject = ''
let failProject = ''
let emptyProject = ''
let defaultProject = ''
let freshProject = ''

const store = () => createStore(dir)

const seed = async (name: string, fixture?: string, mutate?: (doc: EvidenceDoc) => void) => {
  const app = store()
  const project = await app.projects.create({ name, period: PERIOD })
  if (fixture) {
    const doc = readFixture(fixture)
    doc.projectId = project.projectId
    mutate?.(doc)
    await writeJson(path.join(dir, 'projects', project.projectId, 'evidence.json'), doc)
  }
  return project.projectId
}

const score = async (projectId: string): Promise<ScoreResponse> => {
  const response = await fetch(`${server.base}/api/projects/${projectId}/score`, {
    method: 'POST'
  })
  expect(response.status).toBe(200)
  return (await response.json()) as ScoreResponse
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-score-'))
  passProject = await seed('打分全链路', 'firm-a')
  criticalProject = await seed('临界企业', 'firm-b')
  failProject = await seed('不通过企业', 'firm-c')
  emptyProject = await seed('证据全缺')
  defaultProject = await seed('行业未匹配', 'firm-a', (doc) => {
    doc.company = { ...doc.company, industryCode: 'Z99' }
    doc.fields['company.industryCode'] = {
      ...doc.fields['company.industryCode'],
      value: 'Z99'
    }
  })
  freshProject = await seed('尚未打分')
  server = await startServer(dir)
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('评分接口', () => {
  it('证据齐备时与 golden 快照的三口径一致', async () => {
    const { record } = await score(passProject)
    expect(record).not.toBeNull()

    expect(record?.result.totals).toEqual({
      official: 84.81,
      conservative: 84.81,
      optimistic: 84.81,
      confidence: 1
    })
    expect(record?.result.conclusion).toBe('pass')
    expect(record?.result.indicators).toHaveLength(23)
    expect(record?.result.dimensions).toHaveLength(5)
    expect(record?.result.gates).toHaveLength(6)
    expect(record?.result.excluded.map((item) => item.indicatorId)).toEqual(['IND_18'])
    expect(record?.result.industry).toEqual({
      code: 'C35',
      name: '专用设备制造业',
      benchmarkSource: 'industry'
    })
    expect(record?.result.meta.scale).toBe('renormalized')
    expect(record?.evidence.total).toBe(40)
    expect(record?.evidence.confirmed).toBe(35)

    const weightSum = record?.result.indicators.reduce(
      (sum, item) => sum + item.effectiveWeight,
      0
    )
    expect(weightSum).toBeCloseTo(100, 6)
  })

  it('结果落 score-result.json,再次读取与响应一致', async () => {
    const { record } = await score(passProject)
    const file = path.join(dir, 'projects', passProject, 'score-result.json')
    expect(existsSync(file)).toBe(true)

    const saved = JSON.parse(await readFile(file, 'utf8')) as ScoreResponse['record']
    expect(saved?.result.totals).toEqual(record?.result.totals)
    expect(saved?.savedAt).toBe(record?.savedAt)

    const response = await fetch(`${server.base}/api/projects/${passProject}/score`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as ScoreResponse
    expect(body.record?.result.totals).toEqual(record?.result.totals)
  })

  it('从未打分的项目返回空记录', async () => {
    const response = await fetch(`${server.base}/api/projects/${freshProject}/score`)
    expect(response.status).toBe(200)
    expect(((await response.json()) as ScoreResponse).record).toBeNull()
  })

  it('三家企业走 HTTP 全链路的得分与 golden 快照一致', async () => {
    const cases = [
      {
        id: passProject,
        totals: { official: 84.81, conservative: 84.81, optimistic: 84.81, confidence: 1 },
        conclusion: 'pass'
      },
      {
        id: criticalProject,
        totals: { official: 57.76, conservative: 46.92, optimistic: 68.6, confidence: 0.7832 },
        conclusion: 'pending'
      },
      {
        id: failProject,
        totals: { official: 28.29, conservative: 23.21, optimistic: 33.38, confidence: 0.8274 },
        conclusion: 'fail'
      }
    ]

    for (const item of cases) {
      const { record } = await score(item.id)
      expect(record?.result.totals, item.id).toEqual(item.totals)
      expect(record?.result.conclusion, item.id).toBe(item.conclusion)
    }
  })
})

describe('证据缺口', () => {
  it('字段全缺时逐项记 missing,不混为 0 分', async () => {
    const { record } = await score(emptyProject)
    const indicators = record?.result.indicators ?? []
    const absent = indicators.filter((item) => item.basis === 'absent')
    const substituted = indicators.filter((item) => item.basis === 'substituted')

    expect(absent).toHaveLength(21)
    expect(substituted.map((item) => item.id)).toEqual(['IND_02'])
    expect(indicators.filter((item) => item.basis === 'excluded')).toHaveLength(1)
    expect(indicators.filter((item) => item.status === 'notApplicable')).toHaveLength(0)
    expect(absent.every((item) => item.status === 'missing')).toBe(true)
    expect(absent.every((item) => item.score === null)).toBe(true)
    expect(record?.result.missing).toHaveLength(22)
    expect(record?.result.missing.every((item) => item.fieldKeys.length > 0)).toBe(true)

    expect(record?.result.totals.official).toBe(50)
    expect(record?.result.totals.conservative).toBe(0)
    expect(record?.result.totals.optimistic).toBe(100)
    expect(record?.result.conclusion).not.toBe('pass')
  })
})

describe('行业基准', () => {
  it('行业代码未命中时走中性基准并标注估算', async () => {
    const { record } = await score(defaultProject)
    expect(record?.result.industry).toEqual({
      code: 'Z99',
      name: null,
      benchmarkSource: 'default'
    })

    const benchmarked = record?.result.indicators.filter((item) => item.benchmark !== null) ?? []
    expect(benchmarked.length).toBeGreaterThan(0)
    expect(benchmarked.every((item) => item.benchmark?.source === 'default')).toBe(true)
    expect(record?.result.totals.official).not.toBe(84.81)
  })

  it('规则元数据覆盖 23 项指标', async () => {
    const response = await fetch(`${server.base}/api/meta/rules`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as RulesMetaResponse
    expect(body.dimensions).toHaveLength(5)

    const indicators = body.dimensions.flatMap((dimension) => dimension.indicators)
    expect(indicators).toHaveLength(23)
    expect(body.passLine).toBe(60)

    const excluded = indicators.find((item) => item.id === 'IND_18')
    expect(excluded?.fallback?.type).toBe('exclude')
    expect(indicators.every((item) => item.name.length > 0)).toBe(true)
    expect(indicators.every((item) => item.evidenceRefs.length > 0)).toBe(true)
  })
})
