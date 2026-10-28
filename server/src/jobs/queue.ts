import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { JobKind, JobProgressEvent, JobStage } from '@srdi/shared'
import { badRequest, conflict } from '../errors'
import type { AppStore } from '../store'
import { readJson, writeJson } from '../store/atomic'
import { publish } from './hub'

export interface JobRecord {
  jobId: string
  projectId: string
  kind: JobKind
  stage: JobStage
  pct: number
  fileId?: string
  page?: number
  total?: number
  message?: string
  createdAt: string
  updatedAt: string
  error?: string
}

export interface JobProgressUpdate {
  stage?: JobStage
  fileId?: string
  page?: number
  total?: number
  pct: number
  message?: string
}

export type JobReport = (update: JobProgressUpdate) => void

export interface JobRunnerResult {
  message: string
  error?: string
}

export type JobRunner = (projectId: string, report: JobReport) => Promise<JobRunnerResult>

export interface JobQueue {
  enqueue: (projectId: string, kind: JobKind) => Promise<{ job: JobRecord; reused: boolean }>
  snapshot: (jobId: string) => JobProgressEvent | null
  get: (jobId: string) => JobRecord | null
  list: (projectId: string) => JobRecord[]
}

const STAGE_BY_KIND: Record<JobKind, JobStage> = {
  parse: 'parsing',
  extract: 'extracting'
}

const VERB_BY_KIND: Record<JobKind, string> = {
  parse: '解析',
  extract: '抽取'
}

const toEvent = (job: JobRecord): JobProgressEvent => ({
  jobId: job.jobId,
  kind: job.kind,
  stage: job.stage,
  fileId: job.fileId,
  page: job.page,
  total: job.total,
  pct: job.pct,
  message: job.message
})

const isLive = (job: JobRecord) => job.stage !== 'done' && job.stage !== 'failed'

export const createJobQueue = (
  store: AppStore,
  runners: Record<JobKind, JobRunner>
): JobQueue => {
  const jobs = new Map<string, JobRecord>()
  const active = new Map<string, string>()
  const pending: string[] = []
  let running = false
  let persistChain: Promise<void> = Promise.resolve()

  const jobsFile = (projectId: string) => path.join(store.projects.dir(projectId), 'jobs.json')

  const persist = (job: JobRecord) => {
    const write = async () => {
      const file = jobsFile(job.projectId)
      const existing = (await readJson<JobRecord[]>(file)) ?? []
      const index = existing.findIndex((item) => item.jobId === job.jobId)
      if (index >= 0) existing[index] = job
      else existing.push(job)
      await writeJson(file, existing.slice(-20))
    }
    persistChain = persistChain.then(write, write)
    return persistChain
  }

  const touch = (job: JobRecord, patch: Partial<JobRecord>) => {
    Object.assign(job, patch)
    job.updatedAt = new Date().toISOString()
    publish(job.jobId, toEvent(job))
  }

  const drain = async () => {
    if (running) return
    running = true
    try {
      while (pending.length > 0) {
        const jobId = pending.shift()
        if (!jobId) continue
        const job = jobs.get(jobId)
        if (!job) continue
        const runner = runners[job.kind]

        touch(job, {
          stage: STAGE_BY_KIND[job.kind],
          pct: 1,
          message: `开始${VERB_BY_KIND[job.kind]}`
        })
        try {
          await persist(job)
        } catch (err) {
          console.error('任务状态写入失败', err)
        }

        try {
          const result = await runner(job.projectId, (update) => {
            touch(job, {
              fileId: update.fileId ?? job.fileId,
              page: update.page ?? job.page,
              total: update.total ?? job.total,
              pct: Math.max(job.pct, Math.min(99, Math.round(update.pct))),
              message: update.message ?? job.message
            })
          })
          touch(job, {
            stage: 'done',
            pct: 100,
            message: result.message,
            error: result.error
          })
        } catch (err) {
          touch(job, {
            stage: 'failed',
            message: `${VERB_BY_KIND[job.kind]}失败`,
            error: (err as Error).message
          })
        } finally {
          job.updatedAt = new Date().toISOString()
          try {
            await persist(job)
          } catch (err) {
            console.error('任务状态写入失败', err)
          }
          publish(job.jobId, toEvent(job))
          active.delete(job.projectId)
        }
      }
    } finally {
      running = false
    }
  }

  const enqueue = async (projectId: string, kind: JobKind) => {
    const project = await store.projects.get(projectId)
    if (kind === 'parse' && project.files.length === 0) {
      throw badRequest('no_files', '请先上传材料再解析')
    }
    if (kind === 'extract' && project.files.every((file) => file.status !== 'parsed')) {
      throw badRequest('not_parsed', '没有已解析的文件,请先解析材料')
    }

    const current = active.get(projectId)
    if (current) {
      const job = jobs.get(current)
      if (job && isLive(job)) {
        if (job.kind === kind && (job.stage === 'queued' || job.stage === STAGE_BY_KIND[kind])) {
          return { job, reused: true }
        }
        throw conflict(
          'job_in_progress',
          `该项目正在${VERB_BY_KIND[job.kind]},请等待当前任务结束`,
          '同一项目一次只跑一个任务'
        )
      }
    }

    const now = new Date().toISOString()
    const job: JobRecord = {
      jobId: `j_${Date.now().toString(36)}${randomUUID().slice(0, 6)}`,
      projectId,
      kind,
      stage: 'queued',
      pct: 0,
      createdAt: now,
      updatedAt: now,
      message: `排队中,${project.files.length} 个文件`
    }

    jobs.set(job.jobId, job)
    active.set(projectId, job.jobId)
    pending.push(job.jobId)
    void drain().catch((err) => console.error('任务队列异常', err))
    try {
      await persist(job)
    } catch (err) {
      console.error('任务状态写入失败', err)
    }
    return { job, reused: false }
  }

  const snapshot = (jobId: string) => {
    const job = jobs.get(jobId)
    return job ? toEvent(job) : null
  }

  const get = (jobId: string) => jobs.get(jobId) ?? null

  const list = (projectId: string) => [...jobs.values()].filter((job) => job.projectId === projectId)

  return { enqueue, snapshot, get, list }
}
