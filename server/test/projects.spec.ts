import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CreateProjectResponse, ProjectListResponse } from '@srdi/shared'
import { createStore } from '../src/store'
import { startServer, type TestServer } from './helpers'

let server: TestServer
let dir = ''

const patchName = (projectId: string, body: unknown) =>
  fetch(`${server.base}/api/projects/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

const createProject = async (name?: string) => {
  const response = await fetch(`${server.base}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(name === undefined ? {} : { name })
  })
  return (await response.json()) as CreateProjectResponse
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'srdi-projects-'))
  server = await startServer(dir)
})

afterAll(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('项目重命名', () => {
  it('去掉首尾空格并刷新 updatedAt', async () => {
    const created = await createProject('改名前')
    const before = created.project.updatedAt

    const response = await patchName(created.projectId, { name: '  南京鼎新精密机械有限公司  ' })
    expect(response.status).toBe(200)
    const body = (await response.json()) as CreateProjectResponse

    expect(body.projectId).toBe(created.projectId)
    expect(body.project.name).toBe('南京鼎新精密机械有限公司')
    expect(body.project.createdAt).toBe(created.project.createdAt)
    expect(body.project.updatedAt >= before).toBe(true)
  })

  it('列表读到新名称', async () => {
    const created = await createProject('列表旧名')
    await patchName(created.projectId, { name: '列表新名' })

    const response = await fetch(`${server.base}/api/projects`)
    const body = (await response.json()) as ProjectListResponse
    const item = body.projects.find((project) => project.projectId === created.projectId)

    expect(item?.name).toBe('列表新名')
  })

  it('空名称返回 400 且不落盘', async () => {
    const created = await createProject('保持原名')
    const response = await patchName(created.projectId, { name: '   ' })

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe('invalid_name')

    const detail = await fetch(`${server.base}/api/projects/${created.projectId}`)
    const body = (await detail.json()) as CreateProjectResponse
    expect(body.project.name).toBe('保持原名')
  })

  it('80 字可用,81 字拒绝', async () => {
    const created = await createProject('长度')
    const okResponse = await patchName(created.projectId, { name: 'a'.repeat(80) })
    expect(okResponse.status).toBe(200)

    const badResponse = await patchName(created.projectId, { name: 'a'.repeat(81) })
    expect(badResponse.status).toBe(400)
    expect(((await badResponse.json()) as { error: string }).error).toBe('invalid_name')
  })

  it('非字符串与缺字段都按 invalid_name 处理', async () => {
    const created = await createProject('类型')
    const numeric = await patchName(created.projectId, { name: 123 })
    expect(numeric.status).toBe(400)
    expect(((await numeric.json()) as { error: string }).error).toBe('invalid_name')

    const missing = await patchName(created.projectId, {})
    expect(missing.status).toBe(400)
    expect(((await missing.json()) as { error: string }).error).toBe('invalid_name')
  })

  it('未知字段拒绝', async () => {
    const created = await createProject('白名单')
    const response = await patchName(created.projectId, { name: 'x', foo: 1 })

    expect(response.status).toBe(400)
    expect(((await response.json()) as { error: string }).error).toBe('invalid_body')
  })

  it('项目不存在返回 404,编号非法返回 400', async () => {
    const missing = await patchName('p_notexist', { name: 'x' })
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toBe('project_not_found')

    const invalid = await patchName('not-a-project-id', { name: 'x' })
    expect(invalid.status).toBe(400)
    expect(((await invalid.json()) as { error: string }).error).toBe('invalid_project_id')
  })

  it('改名不碰文件与创建时间', async () => {
    const created = await createProject('带文件')
    const store = createStore(dir)
    await store.projects.addFile(created.projectId, {
      fileId: 'f_keep',
      name: '审计报告.pdf',
      sha256: 'sha-keep',
      size: 1024,
      kind: 'pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      status: 'pending',
      uploadedAt: new Date().toISOString()
    })

    const response = await patchName(created.projectId, { name: '带文件改名' })
    const body = (await response.json()) as CreateProjectResponse

    expect(body.project.files).toHaveLength(1)
    expect(body.project.files[0]?.fileId).toBe('f_keep')
    expect(body.project.createdAt).toBe(created.project.createdAt)
  })
})
