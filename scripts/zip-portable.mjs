import { execSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const PKG_NAME = `专精特新自评打分系统-v${pkg.version}`
const SRC = path.join(ROOT, 'release', PKG_NAME)
const DEST = path.join(ROOT, 'release', `${PKG_NAME}.zip`)

if (!existsSync(SRC)) {
  throw new Error('release 目录里没有可打包的成品，先运行 pnpm pack:portable')
}
if (existsSync(DEST)) rmSync(DEST, { force: true })

const script = [
  'Add-Type -AssemblyName System.IO.Compression.FileSystem',
  `$l=[IO.Compression.CompressionLevel]::Optimal`,
  `[IO.Compression.ZipFile]::CreateFromDirectory('${SRC}','${DEST}',$l,$true)`
].join(';')

const encoded = Buffer.from(script, 'utf16le').toString('base64')
console.log('')
console.log('  正在压缩，文件较多，请稍候…')
execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { stdio: 'inherit' })

const size = statSync(DEST).size
console.log('')
console.log(`  压缩包    ${DEST}`)
console.log(`  大小      ${(size / 1024 / 1024).toFixed(1)} MB`)
console.log('')
