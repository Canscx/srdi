import { DATA_DIR } from '../src/paths'
import { syncIdentity } from '../src/portal/identity'
import { createStore } from '../src/store'

const run = async () => {
  const store = createStore(DATA_DIR)
  const projects = await store.projects.list()
  let touched = 0

  for (const item of projects) {
    try {
      const changed = await syncIdentity(store, item.projectId)
      if (changed.length > 0) {
        touched += 1
        console.log(`${item.projectId} ${item.name}: ${changed.join(', ')}`)
      }
    } catch (err) {
      console.error(`${item.projectId} 失败: ${(err as Error).message}`)
    }
  }

  console.log(`共 ${projects.length} 个项目，更新 ${touched} 个`)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
