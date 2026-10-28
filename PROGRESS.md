# 开发进度

> 只写未完成项。完成项折叠成一行。不写每日日志。

## 接续点(新对话从这里开始)

**已完成** 规则配置 → 三包脚手架 → 最小可运行服务 → 打分引擎 → 三家企业 golden 快照 → 存储层 + 文件上传 + 魔数判型 → 解析链路(PDF 双通道 / DOCX / XLSX / 图片)+ 任务队列 → 四类 docType 抽取 + 五级校验 → 确认页 → 评分页。  
**未开工** 报告导出 / 真实材料验收。

**下一步**:第二阶段第 10 步「报告导出 Markdown」。

- 报告只消费 `score-result.json` 与 `evidence.json`,不得二次计算分数;页面与文档里的数字全部来自 `ScoreResult`,格式化不改写数值
- 双轨输出:主视图条件匹配度与材料完整度,次视图参考得分与三口径区间;顶部与结尾都要写「参考得分非官方口径」
- 数字白名单 + 模板兜底:AI 只写建议段落,不碰任何数字;模板缺失时降级为纯规则文案
- 不碰规则编辑器;`score-result.schema.json` 仍未定,等报告字段稳定后再写

**评分页已收口**:`POST /api/projects/:id/score` + `GET` 读回,四态(excluded / missing / estimated / notApplicable)分列;雷达轴上限用重归一后的维度满分,不是名义维度权重。

**三条命令**

- `pnpm validate`:配置校验 + 三包类型 + 全部测试,提交前必跑
- `pnpm start`:构建前端并起服务,8787
- `pnpm dev`:server + vite 并行,前端 5180

**三条最容易重踩的坑**

1. jsep 对 `count(x where ...)` **不报错**,会把 where 当第二个实参;`parser.ts` 已注册运算符并做 AST 校验,不要绕过它直接调 jsep。
2. vitest 的模块缓存在多 worker 下并发写同一临时文件,Windows 上偶发 `EPERM`,表现为部分 spec 根本不加载;已在 `shared/vitest.config.ts` 设 `fileParallelism: false`。
3. 本机 5173 被其他项目占用,dev 端口固定 **5180**,生产 **8787**。

**不可动摇的契约**:证据只认 `confirmed`;L3 确认层是唯一写 `value` 的地方;打分只读 confirmed 与 `ScoreResult`;引擎是零 I/O 纯函数。

## 当前状态

`v0.2.0` 开发中 · 第二阶段 MVP · 最后更新 2026-10-28

## 已完成

- [x] 第一阶段全部:规则包 / 40 字段目录 / 14 行业基准 / 4 份 Schema / 三篇文档(已 tag `v0.1.0`)
- [x] pnpm workspaces:shared / server / web 三包 + 统一 TS 路径
- [x] server 最小可运行:静态托管 web/dist + SPA 回退 + `/api/health` + SSE 通道
- [x] web 自检页:health 明细 + SSE 事件流 + 阶段路线
- [x] 校验基建:`pnpm validate`(配置 + 类型 + 测试三闸)+ `scripts/smoke-web.mjs`(CDP 冒烟)
- [x] `shared/scoring` 打分引擎:表达式求值 / 七打分器 / 六门槛 / 三口径 / 边界保护
- [x] 三家企业 fixtures + golden 快照:明显通过(84.81)/ 临界(46.92–57.76)/ 不通过(23.21),107 条测试
- [x] 存储层:原子写 + 项目级串行锁 + 项目/文件/证据三份 JSON,40 字段证据表按目录自动铺满
- [x] 文件上传:busboy 流式落盘 + sha256 去重 + 50MB 限额 + 失败清理临时文件
- [x] 魔数判型:PDF / ZIP 中央目录分 docx-xlsx / OLE 拒绝并提示另存 / 图片三格式;扩展名一律不信
- [x] 解析链路:PDF 文本 + 页图双通道 / DOCX 保留表格 / XLSX 一表一页 / 图片单页;页级路由 + 40 页视觉上限
- [x] 任务队列:`POST /parse` 返回 jobId、`jobs.json` 落盘、SSE 推进度、同项目重复触发复用任务
- [x] 解析结果回填 `project.json` 与 `evidence.files`,页图落 `pages/<fileId>/pN.jpg`
- [x] server 测试 63 条(判型 / 存储 / 上传 / 路由阈值 / 文本还原 / 四格式解析 / HTTP 解析全链路),已并入 `pnpm validate`
- [x] AI 抽取:`ai/{client,prompt,validate,dispatch,cache,budget,extract}`;四层 prompt(L0 铁律 / L1 字段子集 / L2 页文本或页图 / L3 本块指令)、docType 前缀派子集、按页 route 与字符预算分块、五级校验、项目级 token 账本、文件级缓存
- [x] `POST /api/projects/:id/extract` 返回 jobId;`jobs/queue.ts` 泛化为 parse / extract 两类任务共用串行 drain 与 SSE
- [x] server 测试 70 条(新增 7 条 AI 抽取:四类 docType 出处完整 / docType 覆盖 / 二次抽取零请求 / 单块失败隔离 / quote 未命中压分 / 万元换算 / 页越界 / 预算耗尽 / HTTP 全链路)
- [x] 确认页所需接口:`GET /api/files/:fileId/page/:n` 出页图(越界/无图分别 404)、`GET /api/projects/:id/pages/:fileId` 出 `FilePages`、`GET /api/meta/catalog` 出 40 字段元数据与枚举值
- [x] 自动确认:`config/review.json` 存阈值(0.9 / 拒绝原文未匹配),`POST /api/projects/:id/evidence/auto-confirm` 仅对单候选生效,仍走 `evidenceStore.patch`
- [x] 前端多视图:hash 路由(工作台 / 确认 / 自检)+ 统一 fetch 客户端 + 工作台项目列表与新建;自检页搬到 `#/status` 并更新路线到 6/8
- [x] 确认页三栏:40 字段清单(分组/筛选/搜索)、页图与原文摘录高亮对照、候选卡片与采纳/手填/否决/缺失;冲突强制人工二选一;顶部材料条带内置上传/解析/抽取与 SSE 进度
- [x] server 测试 76 条(新增 6 条确认页:目录元数据 / 页数据越界 / 页图 200-404 / 无 projectId 定位 / 自动确认阈值与 quoteMatched 拦截 / 冲突候选人工采纳)
- [x] 规则与基准加载器:`loadRules()` / `loadBenchmarks()` 单例缓存,读取失败抛 500 `rules_unavailable` / `benchmarks_unavailable`;`GET /api/meta/rules` 出 23 项元数据(unit / dataClass / scoringType / formula / evidenceRefs / fallback)与规则假设
- [x] `POST /api/projects/:id/score`:证据 → `evaluate()` → `score-result.json`(`{ savedAt, rulesVersion, benchmarksVersion, evidence 统计, result }`);`GET` 读回,未打分返回 `record: null`
- [x] 行业代码优先取 `evidence.company.industryCode`,缺失时回落到 `company.industryCode` 字段的 confirmed 值;未命中行业表时 `benchmarkSource: 'default'` 并在页面标「中性基准估算」
- [x] 评分页四块:五维雷达(保守/参考/乐观三线,轴上限为重归一后的维度满分)、三口径卡与门槛结论、六门槛判词表(可展开检查项与放行条目)、23 项明细(状态 / raw / 得分率 / 权重 / 有效权重 / 标记,可按四态与维度筛选,行内展开公式、基准、缺失字段与三口径贡献)
- [x] 评分页双处声明「参考得分 · 非官方口径」;确认页顶部加「评分 →」入口,路由 `#/p/:id/score`
- [x] 修确认页按年字段预览显示 `[object Object]`(`formatFieldValue` 增加年份字典分支)
- [x] server 测试 83 条(新增 7 条评分:三家企业 HTTP 全链路与 golden 一致 / 结果落盘与读回 / 未打分返回空 / 缺证据走 missing / 行业未命中走 default / 规则元数据);shared 测试 109 条(新增 2 条守卫边界)

## 待办(按优先级)

**第二阶段 MVP**

- [x] 存储层 + 文件上传 + 魔数判型
- [x] PDF 双通道 / DOCX / XLSX 解析 + 任务队列
- [x] 四类 docType 抽取 + 五级校验
- [x] 确认页(字段行 + 页图 bbox 对照 + 冲突二选一)
- [x] 评分页(雷达 + 23 项表 + 门槛表 + 三口径)
- [ ] 报告导出 Markdown

**收尾**

- [ ] 真实材料验收(50 页 ≤8 分钟 / 确认 ≤15 分钟 / ≥18 项带出处)
- [ ] `score-result.schema.json`(引擎出 TS 类型后再定)

## 已知坑

- `pdfjs` 在 Node 下渲染必须有 canvas 实现,用 `@napi-rs/canvas`,不是 `canvas`(后者需编译 GTK/Cairo,Windows 极难配)
- 环境变量禁用 `VITE_` 前缀,否则会被打进前端 bundle 等同公开密钥
- 模型名用 `deepseek-flash`;旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 已下线并路由
- 混合型 PDF(文字页与扫描页混排)必须页级判定,不能文件级一刀切
- pnpm 11 不再读 `package.json` 的 `pnpm` 字段,构建脚本白名单写进根 `pnpm-workspace.yaml` 的 `allowBuilds`
- 本机 5173 被其他项目占用,dev 端口固定 5180,生产 8787
- `jsep` 对 `count(x where ...)` **不报错但错解**(把 where 当第二个实参),必须注册 `where` 运算符并做 AST 校验
- `busboy` 的 `close` 早于写盘流的 `close`,拿它判断"没收到文件"会让每个上传都 400。完成信号必须取文件流 `close`,`bb.close` 只做「从未见过 file」的兜底
- `pdfjs` 6.x 的 `standardFontDataUrl` / `cMapUrl` 在 Windows 上必须是正斜杠且以 `/` 结尾;用 `path.sep` 会直接抛 `Invalid factory url`
- `pdfjs` 6.x 的 `render()` 需要同时传 `canvasContext` 与 `canvas`;`@napi-rs/canvas` 的 `toBuffer('image/jpeg', quality)` 质量范围是 0–100
- 队列写 `jobs.json` 可能因项目目录被删而失败,不能冒泡成未处理的 Promise;`persist` 已包 try/catch,`drain` 也已挂 catch
- `jobs.json` 的 `persist` 必须串行(`persistChain`):`enqueue` 与 `drain` 会并发读改写同一文件,Windows 上 rename 偶发 `EPERM`,表现为日志刷「任务状态写入失败」但任务照跑
- `ajv` 已从 server 的 devDependencies 移到 dependencies —— `ai/validate.ts` 运行时直接引用,只装生产依赖会 `MODULE_NOT_FOUND`
- `ratio` 类字段一律用小数(`0.52` 表示 52%)。模型回 `unit: "%"` 或 `value: "52.3%"` 时必须按 0.01 折算并打 `unit_scaled`;折算后 `|v| > 5` 直接丢弃,防止 52.3 被当比率写进证据
- prompt 的正反例里也写着字段名,测试桩若按 `system.includes('fin.revenue')` 分流,每条 prompt 都会命中(正反例在同一个 system 里)。判别要带制表符匹配表格行,如 `'fin.revenue\t'`
- `@/` 别名必须同时写两处:`vite.config.ts` 的 `resolve.alias` 与 `web/tsconfig.json` 的 `paths`。只配 vite 时 `vue-tsc` 会一片 `Cannot find module '@/...'`
- 页图接口 `GET /api/files/:fileId/page/:n` 的路径里没有 projectId,必须「先查 query、再扫项目目录」定位;`res.sendFile` 只接受绝对路径,`res.type(扩展名)` 才会带对 `image/jpeg`
- **bbox 恒为空**,这不是 bug:模型只回 quote 不回坐标。文本通道靠字符串匹配高亮,视觉通道给整页图;前端不得伪造框选坐标
- 确认页里比率字段的手工输入按百分比收(52.3 表示 52.3%),提交前除以 100。直接把 52.3 当比率写入会让 ROE / 资产负债率整条链出错
- 雷达轴上限必须取维度内 `effectiveWeight` 之和,不能取 `dimension.weight`。排除项重归一后维度分会超过名义权重(专业化 15.93 > 15、成长性 15.93 > 15),按名义值设上限会把顶点裁到网格外
- 守卫条件取值为 `null` 表示字段缺失,必须走 `missing`;只有 `false` 才是真正的「不适用」。改前空证据项目会出 11 项 `notApplicable`,把「没填」伪装成「不适用」
- `evidence.company` 目前没有任何写入点(只有 fixture 带),行业代码实际来自 `company.industryCode` 的 confirmed 字段;评分接口两处都读,别只读其一会踩空

## 决策记录

- **2026-10-28 形态定为本地单机版**  
  不做 SaaS。理由:单用户,数据本就在客户机器上,免去账号与存储成本。
- **2026-10-28 前端定为 Vue3,不是 React**  
  全站 6 个页面、90% 是表格+表单+上传+图表,Element Plus 主场。React 的优势区(团队协作、SSR/SEO、Server Components)本项目用不上。  
  改判条件:长成 SaaS 且团队原有 React 基因。
- **2026-10-28 后端定为 Node + Express,不是 Python FastAPI**  
  理由:打分引擎需前后端共享,前端调参可实时重算;单用户场景 Python 并发优势归零;单人维护两套语言是纯损耗。  
  **止损点:3 份真实材料实测,pdfjs 表格抽取准确率 < 70% 即换 Python。** 引擎是零依赖纯函数,迁移只换外壳。
- **2026-10-28 AI 不碰分数**  
  AI 只做证据抽取与建议撰写。分数由纯函数规则引擎算。理由:可复现、可追溯、可校准,模型直接给分三条都做不到。
- **2026-10-28 三级指标采用维度内等权**  
  官方只公布五个一级维度权重,三级权重未公开。`rules.json` 允许覆盖 `share`。  
  后果:参考得分与官方评分**不可直接比对**,只能作自查参考。
- **2026-10-28 行业均值走「中性假设 + 行业基准表」**  
  官方行业均值由培育平台后台自动匹配,第三方拿不到。8 项 B 类指标约 32 分依赖它。  
  无匹配行业时取 `_default` 中性值并标注"估算";三口径区间兜底。
- **2026-10-28 报告采用双轨输出**  
  主视图给条件匹配度与材料完整度(可验证),次视图给参考得分与区间(满足心理需求),并标注非官方口径。  
  理由:既不能伪造官方分数,也不能完全不给数字。
- **2026-10-28 不采纳 24 小时自动删除**  
  本地单机版无必要。改为本地持久化 + 一键清除 + 上传页写明存储路径。上云时再启用该策略。
- **2026-10-28 不引入 Pinia**  
  6 个页面、单用户、流程线性。两个 composable 足够。全局状态会让数据来源变模糊,而本项目最不能容忍这一点。
- **2026-10-28 Git 采用主干开发 + tag 标里程碑**  
  单人项目不开常规分支。仅在破坏性重构、需冻结演示版、试不确定方案时开分支。
- **2026-10-28 shared 以 TS 源码直供,不预编译**  
  `main`/`exports` 指向 `src/index.ts`,server 用 tsx、web 用 vite alias 直接消费。  
  理由:单人项目免去 watch 编译链;代价是后续若发 npm 包需补 build 步骤。
- **2026-10-28 dev 端口改用 5180**  
  本机 5173 被其他项目占用,`strictPort` 会让 `pnpm dev` 直接失败。生产端口仍为 8787。
- **2026-10-28 排除项权重按比例重归一到 100**  
  指标 18(专利点度中心度)按 `fallback:exclude` 不计分。若简单记 0,全企业理论满分变成 94.17,报告分会系统性偏低且与官方不可比。  
  改为从分母移除、其余 22 项等比放大,`Σ effectiveWeight ≡ 100`,`meta.scale = 'renormalized'`,报告尾注说明。
- **2026-10-28 guard 失败记 0,不进三口径区间**  
  净资产 ≤ 0 属于企业特征而非数据缺失。`notApplicable` 在 official / conservative / optimistic 三处都记 0,不像"估算"那样给 1 分上限。  
  理由:`scoring.md` 的三口径只对"估算/缺失"展开,已确定的事实不该被区间对冲。
- **2026-10-28 部分窗口只降 confidence,不改分数**  
  三年缺一年时仍按可得年份的均值计分,打 `partial_window`、quality 降为 estimated。避免大量企业 conservative 直接归零,使三口径失去意义。
- **2026-10-28 数组形态的周期字段降级为 estimated**  
  `value: [a,b,c]` 不带年份,只能约定按 `[y0,y1,y2]` 解读。一旦上游写成升序,增长率会整体反号且不报错,故打 `period_order_assumed` 并降级,让错误在报告里可见。
- **2026-10-28 `where` 必须注册运算符并做 AST 校验**  
  jsep 在不注册时**不报错**,会把 `where` 当成第二个实参,语义全错且无提示。现已注册 `where`(优先级 0.5)与 `@`(区间,0.9),并在 parser 层强制:count 只接受 1 个参数、where 只能作 count 的第一个实参。
- **2026-10-28 测试串行执行**  
  vitest 的模块缓存(`cacheFs`)在多 worker 下并发写同一临时文件,Windows 上偶发 `EPERM` 导致部分测试文件不被加载。改 `fileParallelism: false`,5 个文件约 3 秒,代价可忽略。
- **2026-10-28 golden 快照只锁四层,不锁全量输出**  
  锁三口径总分、门槛判词、排除/缺失/标记清单、8 个易错指标的 s 值;不对整份 `ScoreResult` 做快照。  
  理由:全量快照会让任何文案微调都产生几十行 diff,真正该被看见的数字跳动反而被噪音淹没。  
  敏感性已验证:改 B 类曲线 `kUp`、改 `IND_01` 的 `share`、改 `IND_03` 顶点,三处各改一点,总分分别变为 84.4 / 84.67 / 84.79,golden 必然失败。
- **2026-10-28 文档手算样例改为三年均值口径**  
  `docs/scoring.md` 第九节原先用「单年营收 ÷ 人数」算人均、用「单年净利 ÷ 净资产」算 ROE,与规则包里的 `mean(...)` 公式不一致(人均差约 5 万,ROE 差 0.13 个百分点)。已按三年均值重算,并补了数据明细。
- **2026-10-28 数据落在 `data/projects/<id>/`,项目内去重**  
  每项目一个目录:`project.json`(元数据 + 文件清单)、`evidence.json`(L3 契约)、`files/<fileId>.<ext>`。临时上传先进 `data/tmp`。  
  去重只比项目内 `sha256`:跨项目共享会泄露"A 企业也传过这份文件",本地单机也没必要。  
  重复上传返回已有 `fileId` 且 `dup: true`,不重复占盘。
- **2026-10-28 判型只读字节,不读扩展名**  
  PDF 认首 1KB 内的 `%PDF`;OOXML 认 `PK\x03\x04` 后解 ZIP 中央目录,按 `word/document.xml` / `xl/workbook.xml` 分流;OLE 头直接拒绝并提示另存;图片只认 jpg/png/webp。  
  **代价**:每次上传多一次随机读(尾 64KB 找 EOCD),换来"改扩展名骗不过去"。
- **2026-10-28 页数预算分两段拦**  
  图片在上传时就能确定 1 页,立即校验 400 页上限;PDF/docx/xlsx 上传时拿不到页数,等到解析前用 `assertPageBudget` 拦。  
  不在上传时猜页数:`/Count` 在压缩对象流里不可靠,猜错会误拒真材料。
- **2026-10-28 证据表的 `files` 只收已解析文件**  
  `evidence.schema.json` 要求每个文件带 `route` 与 `status`,而 `route` 只有解析后才知道。  
  故 `evidence.files` 初始为空,上传只写 `project.json`;解析完成再同步进去,避免为了过 schema 编造 `route`。
- **2026-10-28 证据写入必须是唯一入口**  
  `evidenceStore.patch` 是唯一写 `value` 的函数,并强制记 `resolution`(`manual` / `auto_single`、`resolvedBy`、`resolvedAt`)。  
  `appendCandidates` 只追加候选、最多把 `missing` 抬到 `candidate`,不碰 `value`;测试里对此有断言。
- **2026-10-28 解析产物按文件落 `pages/`**  
  每份文件一份 `pages/<fileId>.json`(`FilePages`:route + 每页 `PageDoc`),页图在 `pages/<fileId>/pN.jpg`。图片文件不复制,`PageDoc.image` 直接指向原图。  
  好处:第 7 步按文件并行抽取,不必把整个项目读进内存。
- **2026-10-28 DOCX 整份算 1 页,XLSX 一表一页**  
  DOCX 没有可靠分页信息,mammoth 也不保留分页符;强行按字符切页会让页码失去意义。  
  XLSX 以工作表为页,页号用于定位"哪个 sheet"。代价:400 页预算对这两种格式偏保守。
- **2026-10-28 docType 先用文件名启发式**  
  `inferDocType()` 按"审计/申报/纳税/专利/证书/标准/财务"匹配文件名,仅作解析期提示。  
  第 7 步必须用 AI 返回的 `documentMeta.docType` 覆盖它,不得把文件名猜测当最终分类。
- **2026-10-28 视觉页上限只降级不丢页**  
  超过 40 个视觉页的部分把 route 改为 `text`,并给文件打 `visionSkipped`;页面本身仍保留在 `FilePages` 里。  
  理由:丢掉整页会让"材料完整度"少算,降级只会让抽取质量下降,原因可解释。
- **2026-10-28 解析队列单进程串行 + 同项目任务复用**  
  一次只跑一个解析任务;同一项目已有 queued/parsing 任务时 `POST /parse` 返回原 jobId 且 `reused: true`。  
  `jobs.json` 只落开始/结束状态,页面级进度走 SSE 内存广播;刷新页面能拿到内存快照,服务重启后旧任务不续跑。
- **2026-10-28 字段子集按 docType 前缀分派,不按目录 `docTypes` 全量匹配**  
  `audit`/`finance` → 全部 `fin.*`;`patent` → `ip.*`;`cert` → `qual.*` + 三个 `company.*`;`standard` → `std.*`。  
  `tax` 收敛到 4 个字段(完税凭证只认营收、净利、研发费用、信用代码),`application` 取 `company.*` + `hr.*` + 申报书常见的 8 个财务字段,`other` 只留三个主体字段。  
  理由:目录里的 `docTypes` 是"哪些材料可能证明这个字段",直接当 prompt 白名单会让审计报告里塞进 16 个非财务字段,白烧 token 还诱发误抽。单次 prompt 稳定落在 4–16 个字段。
- **2026-10-28 docType 由首块 AI 判定覆盖,子集变了最多补跑一次首块**  
  启发式只用来决定"第一炮打哪个子集"。首块返回 `documentMeta.docType` 与启发式不一致且字段集不同时,换子集对同一块重跑一次,后续块统一用新子集。  
  只补一次:再错就是分类本身不稳,继续补会把成本翻倍;这种情况打 `doc_type_correction_partial` 标,让错误在报告里可见。
- **2026-10-28 缓存只在「干净跑」时写入**  
  条件:未耗尽预算且零分块失败。带失败块的半成品若进缓存,下次命中就把残缺结果当完整结果用,比不缓存更坏。  
  桶放项目内 `data/projects/<id>/cache/ai/`,不放全局 —— 与"去重只比项目内 sha256"保持一致,避免跨项目留下"A 企业也传过这份文件"的痕迹。
- **2026-10-28 候选 ID 用内容哈希,天然幂等**  
  `sha1(key + fileId + page + raw + value)` 取 16 位。重复抽取、重启后重跑都产出同一 ID,`appendCandidates` 按 ID 去重,不会堆出一串重复候选。
- **2026-10-28 队列泛化为 parse / extract 两类,同项目互斥**  
  共用一套串行 drain、`jobs.json` 与 SSE,`JobRecord` 加 `kind`。同一项目已有任务在跑时:同类返回原 jobId(`reused`),不同类直接 409,不排队 —— 解析未完成就抽取会读到半份页数据。
- **2026-10-28 `documentMeta.companyName` 不落候选**  
  它没有 page 与 quote,写成候选就违反"每条候选必须可回指原文"的验收条件,确认页也无法高亮。企业主体归并留给营业执照/申报书里的 `company.name` 字段,按正常字段抽取。
- **2026-10-28 token 账本按项目落盘,预算耗尽只停新调用**  
  `ai-usage.json` 记 `{limit, used}`,每个文件跑完落一次。耗尽后不再发请求,已完成文件照常写候选,任务标 `done` 并在 `error` 里列出未抽文件 —— 半份证据比零份有用,且用户能看见为什么少。
- **2026-10-28 自动确认的阈值进 `config/review.json`,且条件收得很紧**  
  只有「单候选 + 置信度 ≥ 0.9 + 原文匹配(或视觉通道无文本层)」才自动确认;多候选一律转人工。  
  阈值写进页面会让"什么算可信"变成前端常量,以后调口径要改代码;放配置里,业务方自己改。
- **2026-10-28 页图按 fileId 定位项目,路径必须防越界**  
  `GET /api/files/:fileId/page/:n` 路径里没有 projectId,先读 `?projectId=`,没有就扫项目目录。  
  `page.image` 是项目内相对路径,解析后必须校验仍在项目目录内,否则一个被篡改的 `FilePages` 就能读到任意文件。
- **2026-10-28 确认页不伪造 bbox**  
  模型只回 quote 不回坐标。文本通道把 quote 去空白后在页文本里做字符串定位并高亮;视觉通道给整页图并写明"图像通道,无文本层可比对"。  
  伪造坐标比没有坐标更坏:用户会以为框出来的就是证据。
- **2026-10-28 前端不引入 vue-router**  
  三个视图、两层路径,手写 20 行 hash 路由足够。加依赖要改 lockfile、配 base、处理 SPA 回退,收益为零。  
  同理不引入 Pinia:确认页的状态只在这一个视图里活,`ref` + 局部 computed 已经够。
- **2026-10-28 确认页内置材料条带**  
  上传 / 解析 / 抽取三个按钮放进确认页顶部,不另建上传页。理由:当前没有别的入口能到达确认页,先让主链路自足;等页面多了再抽独立上传视图。三个按钮全部复用已有接口,后端不新增逻辑。
- **2026-10-28 比率手工输入按百分比收口**  
  输入框后缀 `%`,提交前 `/100`。用户不会按小数填 0.523,而错误量纲在报告里几乎看不出来 —— 必须在入口收口,不能指望确认的人记得。
- **2026-10-28 评分页不让前端二次加权**  
  `IndicatorResult.contribution` 已是三口径加权分,页面只展示与汇总校验,不再乘权重。  
  为了让页面格式化 raw,新增 `GET /api/meta/rules` 只读元数据(unit / dataClass / scoringType / formula / refs);不改引擎输出结构,`score-result.json` 里嵌的仍是纯 `ScoreResult`。
- **2026-10-28 雷达轴上限用重归一后的维度满分**  
  排除 IND_18 后其余指标等比放大,维度分可超过名义权重(专业化 15.93、成长性 15.93)。按名义权重设轴上限会把顶点裁到网格外,视觉上系统性低估高分维度。  
  改法:轴上限 = 该维度 `effectiveWeight` 之和;页面同时标「名义权重 / 重归一满分」。
- **2026-10-28 守卫失败分两种,只有 false 才是不适用**  
  字段缺失时守卫结果为 `null`,原实现直接判 `notApplicable`,空证据项目会出现 11 项「不适用」,与「缺证据」混为一谈。  
  现改为:`null → missing`(带缺失字段),`false → notApplicable` 记 0。黄金快照不变;空证据项目为 21 项 absent + 1 项中性估算 + 1 项排除。
- **2026-10-28 评分页四态分列,不用「没分」概括**  
  `excluded` / `missing` / `estimated` / `notApplicable` 各有独立徽标与筛选;缺失项在标记列显示「缺 N 字段」,不适用显示边界保护标记。  
  理由:用户看到 0 分与看到「材料没交」应采取的动作完全不同。
