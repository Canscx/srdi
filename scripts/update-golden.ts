import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BenchmarksDoc, EvidenceDoc, RulesDoc } from '../shared/src/scoring/types'
import { evaluate } from '../shared/src/scoring/engine'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (relative: string) =>
  JSON.parse(readFileSync(path.join(root, relative), 'utf8')) as Record<string, unknown>

const rules = readJson('config/rules/rules.srdi.v1.0.0.json') as unknown as RulesDoc
const benchmarks = readJson(
  'config/benchmarks/industry-benchmarks.v1.2.0.json'
) as unknown as BenchmarksDoc

const fixtures = ['firm-a', 'firm-b', 'firm-c']

for (const name of fixtures) {
  const goldenPath = `shared/test/expected/${name}.golden.json`
  const previous = readJson(goldenPath) as {
    engine: string
    anchors: Record<string, unknown>
  }
  const anchorIds = Object.keys(previous.anchors)
  const evidence = readJson(`shared/test/fixtures/${name}.json`) as unknown as EvidenceDoc
  const result = evaluate(
    { evidence, benchmarks, industryCode: evidence.company?.industryCode },
    rules
  )

  const golden = {
    fixture: name,
    engine: previous.engine,
    totals: result.totals,
    conclusion: result.conclusion,
    gates: result.gates.map((gate) => ({
      id: gate.id,
      verdict: gate.verdict,
      effective: gate.effective,
      passedVia: gate.passedVia ?? null
    })),
    dimensions: Object.fromEntries(result.dimensions.map((dim) => [dim.id, dim.score.official])),
    excluded: result.indicators.filter((item) => item.basis === 'excluded').map((item) => item.id),
    absent: result.indicators.filter((item) => item.basis === 'absent').map((item) => item.id),
    flags: [...result.flags].sort(),
    anchors: Object.fromEntries(
      anchorIds.map((id) => {
        const item = result.indicators.find((entry) => entry.id === id)
        const score =
          item?.score === null || item?.score === undefined
            ? null
            : Number(item.score.toFixed(6))
        return [id, { score, basis: item?.basis ?? null }]
      })
    )
  }

  writeFileSync(path.join(root, goldenPath), `${JSON.stringify(golden, null, 2)}\n`)
  const anchored = golden.anchors as Record<string, { score: number | null }>
  console.log(
    `${name}  official ${golden.totals.official}  ${golden.conclusion}  IND_17 ${anchored.IND_17?.score}`
  )
}
