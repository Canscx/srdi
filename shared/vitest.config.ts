import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  cacheDir: fileURLToPath(new URL('./node_modules/.vite', import.meta.url)),
  test: {
    include: ['test/**/*.spec.ts'],
    environment: 'node',
    pool: 'forks',
    fileParallelism: false
  }
})
