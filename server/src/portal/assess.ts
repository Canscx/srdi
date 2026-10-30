import type { PortalAdvice, ProjectMeta, ScoreRecord } from '@srdi/shared'
import { extractProject } from '../ai/extract'
import type { ModelClient } from '../ai/client'
import type { JobReport } from '../jobs/queue'
import { inferIndustry, type IndustryGuess } from '../pipeline/industry'
import { parseProject } from '../pipeline/parse'
import { buildScoreRecord } from '../routes/score'
import type { AppStore } from '../store'
import { readJson, writeJson } from '../store/atomic'
import { confirmBestCandidates } from './confirm'
import { applyDeclaredIntellectual, type DeclaredOutcome } from './declared'

export type AssessStageName = 'parse' | 'industry' | 'extract' | 'confirm' | 'declared' | 'score' | 'advice'

export interface AssessStage {
  name: AssessStageName
  ok: boolean
  message: string
  ms: number
}

export interface AssessOutcome {
  status: 'ready' | 'partial' | 'failed'
  stages: AssessStage[]
  warnings: string[]
  industry: IndustryGuess | null
  declared: DeclaredOutcome | null
  advices: PortalAdvice[]
  official: number | null
  optimistic: number | null
  savedAt: string
}

export interface AssessRecord extends AssessOutcome {
  projectId: string
}

export interface AssessDeps {
  client: ModelClient
  model: string
  advise?: (input: {
    project: ProjectMeta
    record: ScoreRecord
  }) => Promise<PortalAdvice[]>
}

const STAGE_LABEL: Record<AssessStageName, string> = {
  parse: '材料解析',
  industry: '行业识别',
  extract: '字段抽取',
  confirm: '自动确认',
  declared: '自述数据',
  score: '规则打分',
  advice: '建议生成'
}

const RANGE: Record<AssessStageName, [number, number]> = {
  parse: [3, 25],
  industry: [25, 28],
  extract: [28, 76],
  confirm: [76, 86],
  declared: [86, 88],
  score: [88, 95],
  advice: [95, 99]
}

const scaled = (stage: AssessStageName, inner: number) => {
  const [start, end] = RANGE[stage]
  return start + Math.max(0, Math.min(100, inner)) * ((end - start) / 100)
}

const STAGE_SIGNAL: Record<AssessStageName, 'parsing' | 'extracting' | 'confirming' | 'scoring' | 'assessing'> = {
  parse: 'parsing',
  industry: 'assessing',
  extract: 'extracting',
  confirm: 'confirming',
  declared: 'assessing',
  score: 'scoring',
  advice: 'assessing'
}

export const assessRecordPath = (store: AppStore, projectId: string) =>
  `${store.projects.dir(projectId)}/assess.json`

export const readAssessRecord = async (store: AppStore, projectId: string) =>
  readJson<AssessRecord>(assessRecordPath(store, projectId))

export const assessProject = async (
  store: AppStore,
  projectId: string,
  report: JobReport,
  deps: AssessDeps
): Promise<AssessOutcome> => {
  const stages: AssessStage[] = []
  const warnings: string[] = []

  const step = async (name: AssessStageName, task: () => Promise<string>) => {
    const started = Date.now()
    report({ stage: STAGE_SIGNAL[name], pct: scaled(name, 2), message: STAGE_LABEL[name] })
    try {
      const message = await task()
      stages.push({ name, ok: true, message, ms: Date.now() - started })
      return true
    } catch (err) {
      const message = (err as Error).message
      stages.push({ name, ok: false, message, ms: Date.now() - started })
      warnings.push(`${STAGE_LABEL[name]}未完成：${message}`)
      return false
    }
  }

  let project = await store.projects.get(projectId)

  const parseOk = await step('parse', async () => {
    const outcome = await parseProject(store, projectId, (update) => {
      report({ stage: 'parsing', pct: scaled('parse', update.pct), message: update.message })
    })
    project = await store.projects.get(projectId)
    return `解析 ${outcome.pages} 页，${outcome.failures.length} 个文件失败`
  })

  let industry: IndustryGuess | null = null
  await step('industry', async () => {
    const guess = await inferIndustry(store, project)
    industry = guess
    if (!guess.code) return '未能从材料识别行业，按中性基准计算'
    if (!project.company?.industryCode) {
      await store.projects.update(projectId, (meta) => {
        if (!meta.company) return
        meta.company.industryCode = guess.code ?? undefined
        meta.company.industryName = guess.name ?? undefined
      })
      project = await store.projects.get(projectId)
    }
    return `识别为 ${guess.code} ${guess.name}`
  })

  const extractOk = await step('extract', async () => {
    const outcome = await extractProject(
      store,
      projectId,
      (update) => {
        report({ stage: 'extracting', pct: scaled('extract', update.pct), message: update.message })
      },
      { client: deps.client, model: deps.model }
    )
    warnings.push(...outcome.warnings)
    if (outcome.budgetExhausted) warnings.push('模型调用预算已用尽，部分页未抽取')
    return `抽取 ${outcome.files} 个文件，${outcome.candidates} 条候选`
  })

  await step('confirm', async () => {
    const evidence = await store.evidence.get(project)
    const outcome = await confirmBestCandidates(store, project, evidence)
    return `确认 ${outcome.confirmed.length} 项，按年合并 ${outcome.series.length} 项`
  })

  let declared: DeclaredOutcome | null = null
  await step('declared', async () => {
    declared = await applyDeclaredIntellectual(store, project, {
      inventionCount: project.company?.inventionCount,
      softCopyrightCount: project.company?.softCopyrightCount
    })
    if (!declared.applied) return `未使用自述数据（${declared.reason ?? 'skip'}）`
    return `发明专利 ${declared.total} 件（含软著折算 ${declared.converted} 件）`
  })

  const holder: { record: ScoreRecord | null } = { record: null }
  const scoreOk = await step('score', async () => {
    const record = await buildScoreRecord(store, project)
    await store.scores.save(record)
    holder.record = record
    return `当前得分 ${record.result.totals.official}`
  })

  let advices: PortalAdvice[] = []
  const scored = holder.record
  if (scored && deps.advise) {
    const advise = deps.advise
    await step('advice', async () => {
      advices = await advise({ project, record: scored })
      return `${advices.length} 条建议`
    })
  }

  const status: AssessOutcome['status'] =
    !parseOk || !scoreOk ? 'failed' : extractOk ? 'ready' : 'partial'

  const outcome: AssessOutcome = {
    status,
    stages,
    warnings: [...new Set(warnings)],
    industry,
    declared,
    advices,
    official: holder.record ? Number(holder.record.result.totals.official.toFixed(2)) : null,
    optimistic: holder.record ? Number(holder.record.result.totals.optimistic.toFixed(2)) : null,
    savedAt: new Date().toISOString()
  }

  await writeJson(assessRecordPath(store, projectId), { projectId, ...outcome })
  report({ pct: 100, message: status === 'failed' ? '评估未完成' : '评估完成' })
  return outcome
}
