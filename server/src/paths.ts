import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export const SERVER_ROOT = path.resolve(here, '..')
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..')
export const WEB_DIST = path.resolve(PROJECT_ROOT, 'web', 'dist')
export const RULES_DIR = path.resolve(PROJECT_ROOT, 'config', 'rules')
