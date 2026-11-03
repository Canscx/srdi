import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createModelClient } from '../src/ai/client'
import { resolveAiConfig } from '../src/config/aiSettings'
import { DATA_DIR, PROJECT_ROOT } from '../src/paths'
import { recognizeLicense } from '../src/portal/recognize'
import { createStore } from '../src/store'

const target = process.argv[2] ?? path.join(PROJECT_ROOT, '资料参考', '营业执照.jpg')

const run = async () => {
  const file = path.resolve(target)
  const bytes = await readFile(file)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const config = resolveAiConfig(DATA_DIR)
  if (!config.apiKey) {
    console.error('未配置 AI Key，请先在页面右上角或 data/ai-settings.json 里配置')
    process.exit(1)
  }

  const store = createStore(DATA_DIR)
  const client = createModelClient({
    resolve: () => ({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model })
  })

  const started = Date.now()
  const profile = await recognizeLicense({
    store,
    client,
    model: config.model,
    filePath: file,
    sha256

  })

  console.log(`文件 ${file}`)
  console.log(`耗时 ${Date.now() - started} ms`)
  console.log(JSON.stringify(profile, null, 2))
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
