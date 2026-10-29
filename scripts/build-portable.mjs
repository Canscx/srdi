import { execSync } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, lstat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
const serverPkg = JSON.parse(await readFile(path.join(ROOT, 'server', 'package.json'), 'utf8'))
const sharedPkg = JSON.parse(await readFile(path.join(ROOT, 'shared', 'package.json'), 'utf8'))
const VERSION = pkg.version
const PKG_NAME = `专精特新自评打分系统-v${VERSION}`
const RELEASE_DIR = path.join(ROOT, 'release')
const OUT_DIR = path.join(RELEASE_DIR, PKG_NAME)
const APP_DIR = path.join(OUT_DIR, 'app')
const TSX_VERSION = '^4.19.2'

const log = (msg) => console.log(`  ${msg}`)
const step = (msg) => console.log(`\n[${msg}]`)

const run = (cmd, cwd = ROOT) =>
  execSync(cmd, { cwd, stdio: 'inherit', shell: true, env: { ...process.env, CI: 'true' } })

const removeDir = (dir) => {
  if (!existsSync(dir)) return
  execSync(`cmd /c rd /s /q "${dir}"`, { stdio: 'ignore' })
  if (existsSync(dir)) throw new Error(`无法清理目录，请手动删除后重试：${dir}`)
}

const writeGbkFile = (dest, text) => {
  const tmpDir = os.tmpdir()
  const src = path.join(tmpDir, 'srdi-bat-src.txt')
  const out = path.join(tmpDir, 'srdi-bat-out.txt')
  writeFileSync(src, text.replace(/\r?\n/g, '\r\n'), 'utf8')
  const script = `$t=[IO.File]::ReadAllText('${src}',[Text.Encoding]::UTF8);[IO.File]::WriteAllText('${out}',$t,[Text.Encoding]::GetEncoding(936))`
  const encoded = Buffer.from(script, 'utf16le').toString('base64')
  execSync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, { stdio: 'ignore' })
  writeFileSync(dest, readFileSync(out))
  rmSync(src, { force: true })
  rmSync(out, { force: true })
}

const skip = new Set(['node_modules', 'test', 'dist', '.turbo'])

const copyTree = async (from, to) => {
  await mkdir(to, { recursive: true })
  const entries = await readdir(from, { withFileTypes: true })
  for (const entry of entries) {
    if (skip.has(entry.name)) continue
    const src = path.join(from, entry.name)
    const dest = path.join(to, entry.name)
    if (entry.isDirectory()) await copyTree(src, dest)
    else await cp(src, dest)
  }
}

const findLinks = async (dir, hits = []) => {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const info = await lstat(full)
    if (info.isSymbolicLink()) hits.push(full)
    else if (info.isDirectory()) await findLinks(full, hits)
  }
  return hits
}

const dirSize = async (dir) => {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const info = await lstat(full)
    if (info.isSymbolicLink()) continue
    if (info.isDirectory()) total += await dirSize(full)
    else total += info.size
  }
  return total
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

const LAUNCH_BAT = `@echo off
chcp 936 >nul 2>&1
title 专精特新申报自评打分系统 v${VERSION}
cd /d "%~dp0app"
set NODE_ENV=production
set PORT=8787

:portcheck
netstat -an | findstr /C:":%PORT% " >nul
if errorlevel 1 goto portok
powershell -NoProfile -Command "try{$r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/api/health' -TimeoutSec 1 -UseBasicParsing;if($r.Content -match 'srdi-scorer'){exit 0}}catch{};exit 1" >nul 2>&1
if not errorlevel 1 goto already
set /a PORT+=1
if %PORT% gtr 8800 goto portfail
goto portcheck

:portok
set "URL=http://localhost:%PORT%"
cls
echo.
echo    ==========================================================
echo      专精特新申报自评打分系统   v${VERSION}
echo    ==========================================================
echo.
echo      访问地址： %URL%
echo      数据目录： %~dp0app\\data
echo.
echo      浏览器会在几秒后自动打开。
echo      这个黑窗口请勿关闭（可以最小化），关闭即停止服务。
echo.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 4; Start-Process '%URL%'"
"%~dp0node\\node.exe" "node_modules\\tsx\\dist\\cli.mjs" "server\\src\\index.ts"

echo.
echo   服务已停止。按任意键关闭窗口。
pause >nul
exit /b 0

:already
echo.
echo   系统已经在运行了（端口 %PORT%），正在为你打开页面。
echo.
echo   注意：不要同时开两个窗口，否则会互相覆盖数据。
echo   如果页面没打开，手动在浏览器输入 http://localhost:%PORT%
echo.
start "" "http://localhost:%PORT%"
echo   按任意键关闭本窗口（不影响正在运行的系统）。
pause >nul
exit /b 0

:portfail
echo.
echo   端口 8787 到 8800 都被占用，系统无法启动。
echo   请重启电脑后再双击本文件。
echo.
pause
exit /b 1
`

const README = `专精特新申报自评打分系统  v${VERSION}
================================================================

【怎么用】三步

  1. 把整个文件夹解压到电脑上（建议 D 盘或「文档」目录，路径别太深）。
     · 要先把压缩包完整解压，不能在压缩包里直接双击。
     · 不要放在 U 盘、移动硬盘或网盘同步目录里运行，容易出权限错误。
     · 一台电脑只保留一份，别在好几个地方各解压一份。

  2. 双击文件夹里的「启动.bat」。
     会弹出一个黑窗口，别关它，可以最小化。
     几秒后浏览器会自动打开系统页面。
     如果浏览器没开，自己打开浏览器输入：http://localhost:8787

  3. 第一次使用，先配置 AI：
     点右上角「模型设置」，填三项后点「测试连接」，通了点保存。
       API 地址： https://api.deepseek.com/v1
       API Key：  向管理员索取（sk- 开头那串）
       模型名：   deepseek-flash
     保存后不用重启，直接就能用。

【怎么停】
  直接关掉那个黑窗口就行。数据不会丢。

【数据存在哪】
  文件夹里的 app\\data 目录。所有项目、上传的材料、打分结果都在这里。
  要备份，就把整个 data 文件夹复制走。
  要清空，就把 data 文件夹删掉（下次启动会自动重建）。

【常见问题】

  Q: 双击后黑窗口一闪就没了
  A: 一般是杀毒软件拦了。把整个文件夹加进杀毒软件白名单，
     或者右键「启动.bat」→ 以管理员身份运行试试。

  Q: 提示「Windows 已保护你的电脑」
  A: 点「更多信息」→「仍要运行」。这是系统对未签名程序的常规提示。

  Q: 防火墙弹窗问是否允许访问网络
  A: 点「允许访问」。只在本机内部通信，不对外联网。

  Q: 页面打不开 / 提示无法连接
  A: 看黑窗口里的「访问地址」是哪个端口，可能是 8788 或 8789
     （8787 被别的软件占了，系统会自动往后挪）。
     按窗口里显示的地址访问。

  Q: 上传材料后点「AI 抽取」报错「尚未配置模型 API Key」
  A: 就是第 3 步没做完，去右上角「模型设置」填好并保存。

  Q: 我不小心双击了两次，会有问题吗
  A: 第二次双击会检测到系统已在运行，只帮你把页面打开，不会再启动一个副本。
     如果看到两个黑窗口，关掉后面那个，只留第一次的。

  Q: 导出 PDF 报错找不到字体
  A: 极少见。重新装一下系统自带字体，或联系管理员。

【重要提醒】

  · 这是 v${VERSION} 内测版，真实材料验收还没完成。
    正式对外用之前，建议先用样本材料试跑一遍。
  · 所有数据只存在这台电脑本地，不上传任何服务器。
    但 AI 抽取时，材料里的文字片段会发给模型服务方，
    涉密材料请先确认能不能发。
  · 建议每周把 app\\data 复制一份到 U 盘或网盘。

【文件夹里都是什么】

  启动.bat        双击这个启动
  node\\           内置的运行环境，不用管，也别删
  app\\            程序本体，别动里面的文件
  app\\data\\      你的数据，备份就备这个
  样本材料\\       两套虚构企业的材料，可以拿来试跑
  使用说明.txt    就是本文件
`

step('1/7 构建前端')
run(`node "${path.join(ROOT, 'web', 'node_modules', 'vite', 'bin', 'vite.js')}" build`, path.join(ROOT, 'web'))
if (!existsSync(path.join(ROOT, 'web', 'dist', 'index.html'))) {
  throw new Error('web/dist/index.html 不存在，前端构建失败')
}
log('前端产物就绪')

step('2/7 组装应用骨架')
removeDir(OUT_DIR)
await mkdir(APP_DIR, { recursive: true })
await copyTree(path.join(ROOT, 'server', 'src'), path.join(APP_DIR, 'server', 'src'))
log('服务端源码已放置')

const deps = { ...serverPkg.dependencies }
delete deps['@srdi/shared']
const appPkg = {
  name: 'srdi-scorer-app',
  version: VERSION,
  private: true,
  type: 'module',
  dependencies: { ...deps, ...sharedPkg.dependencies, tsx: TSX_VERSION }
}
await writeFile(path.join(APP_DIR, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`, 'utf8')

step('3/7 安装生产依赖')
run('npm install --omit=dev --no-package-lock --no-audit --no-fund --loglevel=error', APP_DIR)
const installed = await readdir(path.join(APP_DIR, 'node_modules'))
log(`已安装 ${installed.filter((n) => !n.startsWith('.')).length} 个顶层包`)

await copyTree(path.join(ROOT, 'shared'), path.join(APP_DIR, 'node_modules', '@srdi', 'shared'))
log('@srdi/shared 已实体化注入')

step('4/7 补齐资源与运行时')
await cp(path.join(ROOT, 'web', 'dist'), path.join(APP_DIR, 'web', 'dist'), { recursive: true })
await cp(path.join(ROOT, 'config'), path.join(APP_DIR, 'config'), { recursive: true })
await mkdir(path.join(APP_DIR, 'data'), { recursive: true })
await writeFile(path.join(APP_DIR, 'data', '.keep'), '')
log('前端产物 / 规则配置 / 空数据目录已就位')

await mkdir(path.join(OUT_DIR, 'node'), { recursive: true })
await cp(process.execPath, path.join(OUT_DIR, 'node', 'node.exe'))
log(`内置 Node ${process.version}`)

if (existsSync(path.join(ROOT, 'samples'))) {
  await cp(path.join(ROOT, 'samples'), path.join(OUT_DIR, '样本材料'), { recursive: true })
  log('样本材料已附带')
}

step('5/7 生成启动脚本与说明')
writeGbkFile(path.join(OUT_DIR, '启动.bat'), LAUNCH_BAT)
await writeFile(path.join(OUT_DIR, '使用说明.txt'), `\uFEFF${README.replace(/\r?\n/g, '\r\n')}`, 'utf8')
log('启动.bat（GBK + CRLF）/ 使用说明.txt 已生成')

step('6/7 校验包完整性')
const links = await findLinks(OUT_DIR)
if (links.length > 0) {
  console.error('  发现残留符号链接：')
  for (const link of links.slice(0, 10)) console.error(`    ${link}`)
  throw new Error(`存在 ${links.length} 个符号链接，复制到其他电脑会失效`)
}
log('无符号链接，可安全迁移')

const required = [
  '启动.bat',
  '使用说明.txt',
  'node/node.exe',
  'app/package.json',
  'app/server/src/index.ts',
  'app/web/dist/index.html',
  'app/config/rules',
  'app/node_modules/express/package.json',
  'app/node_modules/tsx/dist/cli.mjs',
  'app/node_modules/pdfjs-dist/standard_fonts',
  'app/node_modules/@napi-rs/canvas-win32-x64-msvc',
  'app/node_modules/@srdi/shared/src/index.ts',
  'app/node_modules/jsep/package.json'
]
for (const rel of required) {
  if (!existsSync(path.join(OUT_DIR, rel))) throw new Error(`缺少必需项：${rel}`)
}
if (existsSync(path.join(APP_DIR, 'data', 'ai-settings.json'))) {
  throw new Error('包内混入了 ai-settings.json，会泄露 API Key')
}
log('必需项齐全，无密钥残留')

step('7/7 汇总')
const total = await dirSize(OUT_DIR)
console.log('')
console.log(`  产物目录  ${OUT_DIR}`)
console.log(`  解压后    ${mb(total)}`)
console.log('')
console.log('  下一步：pnpm pack:zip 生成分发压缩包')
console.log('')
