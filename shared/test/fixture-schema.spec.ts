import { readFileSync } from 'node:fs'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as unknown

const schema = readJson('../schema/evidence.schema.json')
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema as object)

const fixtures = ['firm-a', 'firm-b', 'firm-c'] as const

describe('fixtures 契约合法性', () => {
  it.each(fixtures)('%s 通过 evidence.schema.json 校验', (name) => {
    const data = readJson(`./fixtures/${name}.json`)
    const ok = validate(data)
    if (!ok) {
      const detail = (validate.errors ?? []).map((err) => `${err.instancePath || '/'} ${err.message}`).join(' | ')
      throw new Error(`${name} 不符合证据 Schema: ${detail}`)
    }
    expect(ok).toBe(true)
  })

  it('三份 fixture 的规则包版本一致', () => {
    const ids = fixtures.map((name) => (readJson(`./fixtures/${name}.json`) as { rulesId: string }).rulesId)
    expect(new Set(ids).size).toBe(1)
  })

  it('三份 fixture 的期间一致', () => {
    const periods = fixtures.map((name) => (readJson(`./fixtures/${name}.json`) as { period: unknown }).period)
    for (const period of periods) expect(period).toEqual({ y0: 2025, y1: 2024, y2: 2023 })
  })
})
