import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)

const CHROME = CANDIDATES.find((p) => existsSync(p))
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:8787'
const DEBUG_PORT = Number(process.env.SMOKE_PORT ?? 9333)
const SHOT = process.env.SMOKE_SHOT ?? path.resolve('.tmp/scaffold.png')

if (!CHROME) {
  console.error('未找到 Chrome / Edge,设置 CHROME_PATH 后重试')
  process.exit(1)
}

const profile = await mkdtemp(path.join(tmpdir(), 'srdi-smoke-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--hide-scrollbars',
    '--window-size=1440,1200',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
)

const fatal = []

const waitForCdp = async () => {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (res.ok) return res.json()
    } catch {
      fatal.push('cdp-pending')
    }
    await sleep(250)
  }
  throw new Error('CDP 未就绪')
}

let ws
let sessionId

try {
  const version = await waitForCdp()
  ws = new WebSocket(version.webSocketDebuggerUrl)

  const pending = new Map()
  const problems = []
  let seq = 0

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      const settle = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) settle.reject(new Error(msg.error.message))
      else settle.resolve(msg.result)
      return
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const detail = msg.params.exceptionDetails
      problems.push(`exception: ${detail.text} ${detail.exception?.description ?? ''}`.trim())
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')
      problems.push(`console.error: ${text}`)
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      problems.push(`log: ${msg.params.entry.text}`)
    }
  })

  const send = (method, params = {}, sid) =>
    new Promise((resolve, reject) => {
      const id = (seq += 1)
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, sessionId: sid }))
    })

  const created = await send('Target.createTarget', { url: 'about:blank' })
  const attached = await send('Target.attachToTarget', { targetId: created.targetId, flatten: true })
  sessionId = attached.sessionId

  await send('Page.enable', {}, sessionId)
  await send('Runtime.enable', {}, sessionId)
  await send('Log.enable', {}, sessionId)
  await send('Page.navigate', { url: `${BASE}/#/status` }, sessionId)
  await sleep(3200)

  const probe = await send(
    'Runtime.evaluate',
    {
      expression: `(() => {
        const text = (sel) => document.querySelector(sel)?.innerText?.trim() ?? ''
        const cardValues = Array.from(document.querySelectorAll('.stat-value')).map((el) => el.innerText.trim())
        const logRows = Array.from(document.querySelectorAll('.log-line')).map((el) => el.innerText.replace(/\\s+/g, ' ').trim())
        const dot = document.querySelector('.dot')
        const body = document.body
        return {
          title: document.title,
          heading: text('h1'),
          cardValues,
          logRows,
          streamState: dot ? dot.className : '',
          stateText: text('.stream-state'),
          panelCount: document.querySelectorAll('.card').length,
          stepCount: document.querySelectorAll('.steps li').length,
          doneSteps: document.querySelectorAll('.steps li.done').length,
          viewport: [window.innerWidth, window.innerHeight],
          docWidth: body.scrollWidth,
          hasHorizontalOverflow: body.scrollWidth > window.innerWidth + 1,
          bodyBg: getComputedStyle(body).backgroundColor,
          activeElement: document.activeElement?.tagName ?? ''
        }
      })()`,
      returnByValue: true
    },
    sessionId
  )

  const report = probe.result.value

  await mkdir(path.dirname(SHOT), { recursive: true })
  const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId)
  await writeFile(SHOT, Buffer.from(shot.data, 'base64'))

  const failures = []
  if (report.title !== '专精特新申报自评打分系统') failures.push(`title 不符: ${report.title}`)
  if (!report.heading.includes('专精特新')) failures.push('主标题缺失')
  if (report.panelCount < 5) failures.push(`卡片数量偏少: ${report.panelCount}`)
  if (report.stepCount !== 8) failures.push(`路线步骤数量异常: ${report.stepCount}`)
  if (report.doneSteps !== 8) failures.push(`已完成步骤应为 8,实际 ${report.doneSteps}`)
  if (!report.logRows.some((r) => r.includes('snapshot'))) failures.push('SSE 未收到 snapshot 事件')
  if (!report.streamState.includes('open')) failures.push(`SSE 状态非 open: ${report.streamState}`)
  if (report.hasHorizontalOverflow) failures.push(`出现横向溢出: ${report.docWidth} > ${report.viewport[0]}`)
  if (problems.length) failures.push(...problems)

  console.log(
    JSON.stringify(
      {
        url: BASE,
        chrome: path.basename(CHROME),
        screenshot: SHOT,
        report,
        problems,
        failures,
        verdict: failures.length === 0 ? 'PASS' : 'FAIL'
      },
      null,
      2
    )
  )

  await send('Target.closeTarget', { targetId: created.targetId })
  ws.close()
  process.exitCode = failures.length === 0 ? 0 : 1
} catch (err) {
  console.error(JSON.stringify({ verdict: 'ERROR', message: err.message }, null, 2))
  process.exitCode = 1
} finally {
  if (ws && ws.readyState === 1) ws.close()
  chrome.kill()
  await sleep(300)
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}
