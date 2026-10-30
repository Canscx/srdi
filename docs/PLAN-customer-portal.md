# 客户轻流程改造方案

> 把现有这套「专家工具」拆成两个入口：admin 走完整后台，客户走 5 屏轻流程、几分钟出报告。
> 核心价值不是打分，是**说清楚差多少分、差在哪个维度、具体该补什么**。

## 一、一句话结论

算大改，但**不动地基**。现有 2100 行的确认页（`ReviewView.vue`）与评分页（`ScoringView.vue`）一行不改，整体锁进 `#/admin`；客户走一条**全新的、独立的**轻流程。

工作量：后端新增 11 文件 / 改 10 文件，前端新增 11 / 改 4，测试改 4 加 5，约 **7-9 个工作日**。

## 二、产品形态

### 客户侧 5 屏（账号 `customer` / `vip666666`）

```
① 登录     预填账号，点一下进
② 首页     公司名 + 信用代码 + 手机(选填) + 5 个材料卡 + 软著/发明专利数字
③ 评估中   阶段进度 + 排队位次
④ 结果     当前得分 / 补齐后可达 / 60 分线 / 五维横条 / 清单
⑤ 报告     下载 PDF（4 页）
```

客户侧**不出现**：API 配置、模型设置、23 项三级指标原始数字、保守分、六道政策门槛、证据确认页。

### 首页 5 个材料卡

依据 `资料参考/资料2026.7.23` 的 10 份实件倒推（它们只归三类：年度财报、所得税年报、账簿）。

| # | 标题 | 副标题（客户看到的） | 必传 | 命中的指标 |
|---|---|---|---|---|
| 1 | 财务报表（近三年年报） | 资产负债表、利润表、现金流量表；电子税务局导出的「财务会计报告报送」PDF 也行 | 建议必传 | 13 项：人均营收 / ROE / 成本利润率 / 费用率 / 毛利率 / 研发投入及占比 / 三项成长性 |
| 2 | 企业所得税年度申报表 | A 类年报，最好带「研发费用加计扣除优惠明细表(A107012)」 | 建议必传 | 研发费用最硬证据 + 3 条门槛 |
| 3 | 账簿与科目余额表 | 科目余额表、序时账、凭证，财务软件导出 Excel 即可 | 选填 | 研发费用归集核验、职工薪酬、费用结构 |
| 4 | 知识产权（**不用传文件**） | 直接填两个数字：近三年发明专利数、软件著作权数 | 选填 | 发明专利数量（IND_17） |
| 5 | 其他补充材料 | 申报书、专利清单、资质证书、标准文本，有什么传什么 | 选填 | AI 自行判型后抽取 |

规则：

- **任何缺失都不阻止提交**。只有「一份财务材料都没有」时弹一次二次确认，说明结果参考价值低。
- 槽位**只影响提示，不影响判型**。放错位置弹黄色提醒，仍按内容判 docType。

### admin 侧

保留现有 4 屏不动，新增 `#/admin` 客户提交总览：

企业名 / 信用代码 / 手机 / 提交时间 / 总分 / 是否达标 / 最大缺口维度 / 操作（进确认页、进评分页、改行业重算、下载报告）。
支持按企业名或信用代码搜索。

## 三、打分口径（已定）

| 项 | 决定 |
|---|---|
| 主分 | `totals.official`，客户看到的名字叫「当前参考得分」 |
| 副分 | `totals.optimistic`，叫「补齐缺口后可达」 |
| 隐藏 | `totals.conservative` 客户侧完全不出现（数据结构保留） |
| 及格线 | **60**，客户版与后台统一 |
| 达标判定 | 客户版：`official >= 60`，不复用 `result.conclusion`（六门槛口径不同，会把只传财务的企业判成「待定」） |
| 软著折算 | `min(3, floor(软著数 / 3))` 件，与近三年发明专利数合并写入 `ip.inventionGrantedByYear` 的 y0 行，引擎按 ×2 加权 |
| 发明专利 | 按**近三年**口径，×2 加权 |
| 行业 | 客户不填。从税表文本正则推断 + 关键词兜底，抓不到走默认基准；admin 可一键纠正重算 |

> 软著折算必须在报告里标注「参考折算，非官方口径」，并在 `rules.assumptions` 追加假设（已加 A7、A8）。

## 四、技术方案

### 4.1 角色与会话

`server/src/auth/session.ts` 从单账号升级为账号表：

```ts
export type Role = 'admin' | 'customer'

export interface AuthAccount { user: string; password: string; role?: Role }
export interface AuthConfig { user?: string; password?: string; accounts?: AuthAccount[] }
export interface SessionInfo { user: string; role: Role; expiresAt: number }

export interface AuthService {
  login: (u: string, p: string) => { token: string; user: string; role: Role } | null
  verify: (token: string) => SessionInfo | null
  revoke: (token: string) => void
}
```

- `{user, password}` 旧写法仍可用（归一化成 admin 账号），现有 server 测试零改动。
- 新增 `requireRole(allowed)`（403 `forbidden`）与 `ensureClientId()`（下发 `srdi_client` cookie，2 年）。
- 挂载顺序：`ensureClientId` → `authRouter` → `requireSession` → `portalRouter`（自带 customer 校验）→ `requireRole('admin')` → 原 14 个 router。
- `GET /auth/status` 返回 `{ authenticated, role, user, clientId }`。
- `index.ts` 默认双账号：`admin`（env 可覆盖）+ `customer/vip666666`（`AUTH_CUSTOMER_PASSWORD` 可覆盖）。

### 4.2 一键编排（`assess` 任务）

新增 `JobKind='assess'`，**单个 job 串起全流程**，一条 SSE 到底。不选链式 enqueue（会撞「异类 409」，失败状态分裂在两个 job 里）。

```
parse 2→25  → industry 25→28 → declared 28→30
→ extract 30→78 → confirm 78→86 → score 86→94 → advice 94→99
```

```ts
export interface AssessOutcome {
  status: 'ready' | 'partial' | 'failed'
  stages: { name: 'parse' | 'extract' | 'confirm' | 'score' | 'advice'; ok: boolean; message: string; ms: number }[]
  score?: ScoreRecord
  warnings: string[]
}
```

约束：

- 每个阶段独立 `try/catch`，**只要 evidence 可用就照常出分**，结果落 `assess.json`。
- queue 的 `report()` 需透传 `stage`（现在不透传），`pct` 由 runner 自己换算成全局 0-100（queue 是单调 `Math.max`）。
- 半途失败时结果页仍 200，返回 `status:'partial'` + 缺失清单。

### 4.3 按年合并候选（关键缺口）

`evidence.patch()` 只能挑一个候选，而 14 个 `fin.*` 是周期字段，一份财报同时给出 2023/2024/2025 三个数。不解决，三年只剩一年，**成长性 15 分归零**。

新增：

```ts
confirmSeries: (
  project: ProjectMeta,
  key: string,
  picks: { period: number; candidateId: string }[],
  meta?: { strategy?: 'auto_series' | 'manual'; resolvedBy?: 'auto' | 'user' }
) => Promise<FieldEntry>
```

- 写 `value = {"2023": x, "2024": y, "2025": z}`，`status='confirmed'`，`resolution.strategy='auto_series'` + `pickedCandidateIds`。
- 同一年多个候选：按 `rankCandidate` 取最优，`flags` 打 `SERIES_PERIOD_CONFLICT`。
- 窗口外年份丢弃并打 `OUT_OF_WINDOW_DROPPED`。
- **必须加单测**：合并后 `IND_21/22/23` 的 `raw` 与手算一致（`context.ts` 只认四位数字键的 object）。

### 4.4 客户自述数据（软著/发明专利）

**不在 catalog 加字段**（40 字段被测试硬断言），**不造无出处候选**（schema 要求 `source.fileId+page`）。

```ts
declareValue: (project, key, input: { value; note: string; declared?: FieldEntry['declared'] }) => Promise<FieldEntry>
// status='confirmed', resolution.strategy='declared', manualNote='客户自述：...'
```

`portal/declared.ts` 把两个数字折算成 `ip.inventionGrantedByYear` 的一行 `{year: period.y0, count: invention + converted}`。
`strategy='declared'` 的字段**不计入「证据齐备率」**，客户版不展示该指标。

### 4.5 客户版自动确认

现有策略（单候选 + 0.9 + quote 匹配）会把 80% 候选跳过。新写 `portal/confirm.ts`：

```ts
const rankCandidate = (c: FieldCandidate) =>
  (c.source.quoteMatched === true ? 30 : c.source.quoteMatched === false ? 0 : 10)
  + (c.confidence ?? 0) * 20
  + (typeof c.value === 'number' ? 6 : 0)
  + (c.value === 0 ? -8 : 0)          // 财报「上年金额 0.00」陷阱
  + (c.source.route === 'text' ? 1 : 0)
```

- 非周期字段：取最高者，走 `patch`。
- 周期字段多候选：按 `period` 分组，各组取最高，走 `confirmSeries`。
- 阈值降到 **0.5**，不因 `quoteMatched===false` 直接拒绝（只降权）。
- 全组 `rank <= 0` 时仍取第一个（新设企业营收真为 0）。
- `config/review.json` 升 1.1.0 加 `portal` 段；后台 `autoConfirmPolicy()` 不动。

### 4.6 AI 补足建议

`server/src/ai/advice.ts`：

```ts
export interface PortalAdvice {
  title: string
  body: string
  impact: 'high' | 'medium' | 'low'
  gain: number            // 补齐可加多少分，由引擎算，AI 不许写
  source: 'ai' | 'rule'
  refs: string[]
}
```

- **AI 自由撰写文字，数字全部由引擎注入**。prompt 给出 23 项事实（当前值、目标值、差距、可提升分），每条 ≤150 字。
- 输出后做**数字白名单校验**：文中数字必须能在事实表里找到，否则重试一次，再不符回落硬规则文案。
- 只写「该补什么、补到什么程度」，**不提「我们能帮你做」**。
- 按 `scoreHash` 缓存，重复评估不重复花钱。

### 4.7 客户版 PDF

新建 `server/src/report/portal.ts` + `server/src/report/radar.ts`，不复用 743 行的 8 章报告。

| 页 | 内容 |
|---|---|
| P1 | 企业名 + 期间 + 大字总分 + 「补齐后可达」+ 60 线 + 达标徽章 + 矢量雷达（当前 / 补足后两系列） |
| P2 | 五维横表 + 23 项清单按五维分组，每行 √ / ○ / × |
| P3 | 补足建议（每条 ≤150 字，标题 + 正文 + 可提升 X 分） |
| P4 | 材料清单 + 微信二维码 + 三条声明 |

技术要点（已实测）：

- **雷达图 pdfkit 矢量手绘**：5 轴、4 环网格、两系列（当前实线 / 补足后虚线），标签按 `cos` 左右对齐。不引依赖、不跑浏览器。
- **勾/圈/叉：PDF 用 `√ ○ ×` 字符，网页用 emoji**。实测 6 种字体：`msyh`/`simhei`/`Deng`/`simsun` 都**没有** ✓(U+2713)、✗(U+2717)，也没有 ✅❌⭕；但**都有** √(U+221A)、○(U+25CB)、×(U+00D7)。
  - PDF 绝不能用 emoji：彩色 emoji 是位图字形（CBDT/sbix），无矢量轮廓，pdfkit 嵌入后空白或抛错；唯一含 ✓✗ 的 `seguisym.ttf` 是 Windows 专有，Linux 上不存在。
  - 已用真实 PDF 验证：msyh + pdfkit 生成后 pdfjs 回读文本含这三个字符，渲染成图片肉眼确认清晰无豆腐块。
  - 排版时符号列单独放大到 11pt、按绿/橙/红着色，避免在 8pt 表格里显得瘦小。
- **判定**：√ = `status==='scored' && score>=0.8`；× = 已测到但 `score<0.8`；○ = `missing` / `estimated`。
- **二维码**：`assets/consult-qr.png`（英文路径），`doc.image(path, x, y, {fit:[80,80]})`。文件缺失时跳过并记 note。

### 4.8 Linux / 宝塔部署要点

PDF 在 Linux 上没问题（pdfkit 纯 JS，不需要 Chrome）。三个前提：

1. **中文字体**。探测顺序：`REPORT_FONT_PATH` → 项目根 `fonts/` → 系统字体 → `fc-match`。
   宝塔机器执行 `apt install -y fonts-noto-cjk`，或把字体丢进项目 `fonts/`。`deploy/README.md` 第 4 步已覆盖。
2. **符号字形**。字体探测已从「中/文/项/证」四个字扩到同时校验 √○×，缺符号的字体直接淘汰，避免「中文正常但符号是豆腐块」。
3. **二维码文件名必须英文**。原中文名 `联系顾问微信二维码.png` 经 Windows 打包、宝塔上传解压极易乱码，导致图片静默丢失。已复制为 `assets/consult-qr.png`。

### 4.9 前端

路由从 5 个扩到 9 个：

```
#/                      客户首页
#/assess/:jobId         评估中
#/r/:projectId          结果
#/admin                 客户提交总览
#/p/:id/review|score    原样（admin）
#/status                原样（admin）
```

`App.vue` 按角色切两个 shell：`PortalShell`（只有 logo + 退出）/ `AdminShell`（现有 masthead 整体搬过去，含模型设置）。
注意：`useAiSettings().ensure()` 必须搬进 `AdminShell`，否则客户账号调 `/api/settings/ai` 会 403。

文件暂存：客户选完文件**只存内存 `File[]`**，点「开始评估」才 `create → upload×N → assess`，避免垃圾项目。

`useAssessment.ts` 状态机：`idle → creating → uploading → assessing → done | error`，`retry()` 从当前阶段续跑（已上传文件靠 sha256 去重天然幂等）。

五维图**不复用** `ScoreRadar.vue`（强制三系列，删系列会波及评分页），新写 `DimensionBars.vue` 横条图。

### 4.10 并发

现状 queue 全局单线程串行，5 个客户同时提交最后一位等 12 分钟。
`createJobQueue(store, runners, {concurrency: 2})` 约 20 行改动；`enqueue` 返回 `queueAhead`，评估页显示「前面还有 N 份」。

## 五、必须先修的三个「假象」

| 问题 | 真相 | 处理 |
|---|---|---|
| `GATE_6.totalKey` 改了没用 | `gates.ts` 硬编码 `conservative >= line` | 已改为真正读取 `gate.totalKey`，并保留三态：主口径达标=pass，次口径达标=pending，否则 fail |
| 8 份样本 4 份没有文本层 | 三份年度财报 + 14 页税表都是扫描件 | 只能走 vision，assess 预计 1.5-3.5 分钟 |
| 同一套材料有两个版本 | 2025 财报有新/旧两版，税表也两版 | 客户版取置信度高者，冲突不报错；admin 可纠正 |

## 六、改动文件总表

**shared（6）**：`contracts.ts`、`portal.ts`（新增）、`scoring/types.ts`、`scoring/gates.ts`、`scoring/flags.ts`、`schema/evidence.schema.json`

**server 新增（11）**：`auth/types.ts`、`portal/{assess,confirm,declared,result}.ts`、`routes/{portal,admin}.ts`、`config/industryMap.ts`、`pipeline/industry.ts`、`ai/advice.ts`、`report/{portal,radar}.ts`

**server 修改（10）**：`auth/session.ts`、`auth/middleware.ts`、`routes/auth.ts`、`app.ts`、`index.ts`、`jobs/queue.ts`、`store/evidence.ts`、`routes/files.ts`、`routes/score.ts`、`config/review.ts`

**config（4）**：`rules/rules.srdi.v1.0.0.json`、`review.json`、`industry-map.json`（新增）、`portal.json`（新增）

**frontend 新增（11）**：`composables/{useSession,useAssessment}.ts`、`components/shell/{PortalShell,AdminShell}.vue`、`views/portal/{Home,Assessing,Result}.vue`、`views/admin/Submissions.vue`、`components/portal/{MaterialSlot,DimensionBars,ChecklistTable}.vue`

**frontend 修改（4）**：`router.ts`、`App.vue`、`api.ts`、`views/LoginView.vue`

**test**：改 `firm-b.golden.json`、`golden.spec.ts`、`engine.spec.ts`、`score.spec.ts`；加 `portal` / `series` / `industry` / `portal-report` / `auth` 用例

## 七、实施批次

| 批 | 内容 | 验证 |
|---|---|---|
| 1. 口径与角色 | rules.json 60/official → gates.ts → 测试更新 → 双账号 + requireRole + clientId | `pnpm -r test`；curl 验角色互踢 403 |
| 2. 数据层 | schema 扩值 → confirmSeries → declareValue → portal/confirm → 两个新 config | 单测：三年合并后成长性三项有值 |
| 3. 编排与后端 | JobKind=assess + queue 改造 → assess.ts → industry → declared → result → portal/admin 路由 | mock client 跑通全链路；断网出 partial |
| 4. 报告与建议 | advice.ts（白名单 + 兜底）→ radar.ts → portal.ts → 报告端点 | 三家 fixture 出 PDF，断言 2-5 页与关键文案 |
| 5. 前端与联调 | 路由/双 shell → useAssessment → 三屏 → Submissions → LoginView | 用 10 份真实材料端到端跑一遍，再 `pnpm validate` |

## 八、进度

### 已完成（批 1 部分）

| 文件 | 改动 |
|---|---|
| `config/rules/rules.srdi.v1.0.0.json` | `passLine` 50→60；`GATE_6.passLine` 60、`totalKey` 改 `official`；追加假设 A7（软著折算）、A8（60 分线口径） |
| `shared/src/scoring/gates.ts` | `evaluateScoreGate` 真正读取 `gate.totalKey`，保留 pass/pending/fail 三态 |
| `server/src/auth/session.ts` | 单账号 → 账号表 + 角色，旧 `{user,password}` 写法兼容 |
| `server/src/auth/middleware.ts` | `requireSession` 注入 `req.session`；新增 `requireRole`、`ensureClientId` |
| `server/src/auth/types.ts` | 新增，Express Request 类型扩展 |
| `server/src/routes/auth.ts` | `/auth/status` 返回 role/user/clientId；登录返回 role；Set-Cookie 改 append 避免互相覆盖 |
| `server/src/report/fonts.ts` | 字体探测增加 √○× 三个码点，缺符号的字体直接淘汰 |
| `server/test/score.spec.ts` | `passLine` 断言 50→60 |
| `assets/consult-qr.png` | 新增，二维码英文路径副本 |

验证结果：`shared` 114 测试全绿；`server` 仅 1 条 `passLine` 断言失败，已修正。

### 实施完成(2026-10-30)

批 1-5 全部落地。四处与原计划的偏差,都已写进 `PROGRESS.md` 的对应条目:

1. **手机号改必填**。原计划选填。但"换设备找回报告"以手机号后四位为钥匙,选填会让找回在系统层面不成立。
2. **查询码换成企业全称 + 手机后四位**。原方案的 8 位数字码被否掉:客户要抄、会丢、电话里会听岔;而企业名是公开信息,单名不能当钥匙,只能用来定位。
3. **管理员评分页与客户结果页合并成同一组件**。原计划保留两套界面。实际两页数据源不同(`ScoreRecord` vs `PortalResultResponse`),调样式对齐必然错位;改为共用 `portal/detail.ts` 的 `loadPortalDetail()` 与 `components/portal/ScoreReport.vue`,专业信息收进底部折叠区。
4. **门槛 6 的判据口径调整**。从"conservative ≥ 50"改为"official ≥ 60":政策原文的"评价得分"就是 official,conservative 是我们自造的下限,不该当判据。`totalKey` 字段此前写了但未生效。
