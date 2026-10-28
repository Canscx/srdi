import { readFileSync } from 'node:fs'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import benchmarksJson from '../../config/benchmarks/industry-benchmarks.v1.2.0.json'
import rulesJson from '../../config/rules/rules.srdi.v1.0.0.json'
import { evaluate } from '../src/scoring/engine'
import type { BenchmarksDoc, EvidenceDoc, RulesDoc, ScoreResult } from '../src/scoring/types'

const readJson = (relative: string): unknown =>
  JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8')) as unknown

const schema = readJson('../schema/score-result.schema.json')
const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile(schema as object)

const rules = rulesJson as unknown as RulesDoc
const benchmarks = benchmarksJson as unknown as BenchmarksDoc
const fixtures = ['firm-a', 'firm-b', 'firm-c'] as const

const run = (name: string): ScoreResult => {
  const evidence = readJson(`./fixtures/${name}.json`) as EvidenceDoc
  return evaluate(
    { evidence, benchmarks, industryCode: evidence.company?.industryCode },
    rules
  )
}

const detail = () =>
  (validate.errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join(' | ')

describe('score-result.schema.json', () => {
  it.each(fixtures)('%s 的引擎输出通过校验', (name) => {
    const result = run(name)
    const ok = validate(result)
    if (!ok) throw new Error(`${name} 不符合得分 Schema: ${detail()}`)
    expect(ok).toBe(true)
  })

  it('总分越界被拒绝', () => {
    const bad = structuredClone(run('firm-a'))
    bad.totals.official = 101
    expect(validate(bad)).toBe(false)
  })

  it('缺少 totals 被拒绝', () => {
    const bad = structuredClone(run('firm-a')) as Partial<ScoreResult>
    delete bad.totals
    expect(validate(bad)).toBe(false)
  })
})
