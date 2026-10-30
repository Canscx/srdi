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

const structural = [
  {
    file: 'config/portal.json',
    check: (data) =>
      typeof data.passLine === 'number' &&
      typeof data.softCopyright?.ratio === 'number' &&
      typeof data.softCopyright?.cap === 'number' &&
      typeof data.lookup?.windowMinutes === 'number' &&
      typeof data.lookup?.maxAttempts === 'number' &&
      Array.isArray(data.slots) &&
      data.slots.length >= 3 &&
      data.slots.every((slot) => typeof slot.id === 'string' && typeof slot.title === 'string')
  },
  {
    file: 'config/industry-map.json',
    check: (data) =>
      Array.isArray(data.rules) &&
      data.rules.length >= 10 &&
      data.rules.every(
        (rule) =>
          /^[A-Z]\d{2}$/.test(rule.code) &&
          typeof rule.name === 'string' &&
          Array.isArray(rule.keywords) &&
          rule.keywords.length > 0
      )
  },
  {
    file: 'config/advice.json',
    check: (data) => {
      const keys = Object.keys(data.items ?? {})
      return (
        keys.length === 23 &&
        keys.every((key) => /^IND_\d{2}$/.test(key) && typeof data.items[key].body === 'string')
      )
    }
  },
  {
    file: 'config/review.json',
    check: (data) =>
      typeof data.autoConfirm?.minConfidence === 'number' &&
      typeof data.portal?.minConfidence === 'number'
  }
]

for (const item of structural) {
  try {
    const data = await readJson(item.file)
    checked += 1
    if (item.check(data)) {
      console.log(`PASS  ${item.file}`)
    } else {
      failed += 1
      console.log(`FAIL  ${item.file}`)
      console.log('      结构不符合预期')
    }
  } catch {
    failed += 1
    console.log(`FAIL  ${item.file}`)
    console.log('      文件缺失或不是合法 JSON')
  }
}

console.log(`\n${checked} 个文件,${failed} 个失败`)
process.exit(failed > 0 ? 1 : 0)
