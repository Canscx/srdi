import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const root = process.cwd()

const readJson = async (rel) =>
  JSON.parse(await readFile(path.join(root, rel), 'utf8'))

const listJson = async (dir) => {
  try {
    const entries = await readdir(path.join(root, dir), { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.json'))
      .map((e) => `${dir}/${e.name}`)
      .sort()
  } catch {
    return []
  }
}

const mappings = [
  { schema: 'shared/schema/rules.schema.json', dir: 'config/rules' },
  { schema: 'shared/schema/field-catalog.schema.json', dir: 'config/catalog' },
  { schema: 'shared/schema/benchmarks.schema.json', dir: 'config/benchmarks' }
]

const ajv = new Ajv({ allErrors: true, strict: false })
addFormats(ajv)

let checked = 0
let failed = 0

for (const mapping of mappings) {
  let schema
  try {
    schema = await readJson(mapping.schema)
  } catch {
    console.log(`SKIP  ${mapping.schema} 尚未创建`)
    continue
  }
  const validate = ajv.compile(schema)

  for (const file of await listJson(mapping.dir)) {
    const data = await readJson(file)
    checked += 1
    if (validate(data)) {
      console.log(`PASS  ${file}`)
    } else {
      failed += 1
      console.log(`FAIL  ${file}`)
      for (const err of validate.errors ?? []) {
        console.log(`      ${err.instancePath || '/'}  ${err.message}`)
      }
    }
  }
}

console.log(`\n${checked} 个文件,${failed} 个失败`)
process.exit(failed > 0 ? 1 : 0)
