import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export const SERVER_ROOT = path.resolve(here, '..')
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..')
export const WEB_DIST = path.resolve(PROJECT_ROOT, 'web', 'dist')
export const CONFIG_ROOT = path.resolve(PROJECT_ROOT, 'config')
export const RULES_DIR = path.join(CONFIG_ROOT, 'rules')
export const CATALOG_DIR = path.join(CONFIG_ROOT, 'catalog')
export const BENCHMARKS_DIR = path.join(CONFIG_ROOT, 'benchmarks')

const rawDataDir = process.env.DATA_DIR ?? 'data'

export const DATA_DIR = path.isAbsolute(rawDataDir)
  ? rawDataDir
  : path.resolve(PROJECT_ROOT, rawDataDir)
