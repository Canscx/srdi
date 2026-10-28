import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

const srcRoot = fileURLToPath(new URL('./src', import.meta.url))
const sharedRoot = fileURLToPath(new URL('../shared/src', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      { find: /^@srdi\/shared$/, replacement: fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) },
      { find: /^@srdi\/shared\/(.*)$/, replacement: `${sharedRoot}/$1` },
      { find: /^@\//, replacement: `${srcRoot}/` }
    ]
  },
  server: {
    port: 5180,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome110',
    chunkSizeWarningLimit: 1200
  }
})
