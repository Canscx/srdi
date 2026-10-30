import './env'
import { createApp } from './app'
import { DATA_DIR, WEB_DIST } from './paths'
import { describeReportFont } from './report/fonts'

const port = Number(process.env.PORT ?? 8787)
const auth = {
  accounts: [
    {
      user: process.env.AUTH_USER ?? 'admin',
      password: process.env.AUTH_PASSWORD ?? 'abc123456/',
      role: 'admin' as const
    },
    {
      user: process.env.AUTH_CUSTOMER ?? 'customer',
      password: process.env.AUTH_CUSTOMER_PASSWORD ?? 'vip666666',
      role: 'customer' as const
    }
  ]
}
const app = createApp({ webDist: WEB_DIST, port, dataDir: DATA_DIR, auth })
const reportFont = describeReportFont()

const server = app.listen(port, () => {
  console.log('')
  console.log('  专精特新申报自评打分系统 · server')
  console.log(`  本地地址   http://localhost:${port}`)
  console.log(`  健康检查   http://localhost:${port}/api/health`)
  console.log(`  SSE 通道   http://localhost:${port}/api/jobs/demo/stream`)
  console.log(`  数据目录   ${DATA_DIR}`)
  console.log(`  静态目录   ${WEB_DIST}`)
  console.log(
    `  访问保护   已启用,账号 ${auth.accounts.map((item) => `${item.user}(${item.role})`).join(' / ')}`
  )
  console.log(
    `  报告字体   ${
      reportFont
        ? `${reportFont.family}${reportFont.postscriptName ? ` (${reportFont.postscriptName})` : ''} · ${reportFont.path}`
        : '未找到,PDF 导出会失败,执行 pnpm check:font 查看候选'
    }`
  )
  console.log(`  运行模式   ${process.env.NODE_ENV ?? 'development'}`)
  console.log('')
})

const shutdown = (signal: string) => {
  console.log(`收到 ${signal},正在关闭`)
  server.close(() => process.exit(0))
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
