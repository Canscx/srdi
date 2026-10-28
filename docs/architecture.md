# 架构

## 一、五层解耦

```
L1 解析  文件 → PageDoc[]        纯 Node,不认识任何业务字段名
L2 抽取  PageDoc[] → Candidate[] 只 append 候选,绝不写 value
L3 确认  Candidate[] → Confirmed 唯一写 value 的地方,唯一人工闸门
L4 打分  evidence + rules → ScoreResult   纯函数,零 I/O,零 AI,可单测
L5 报告  ScoreResult → 报告      模板渲染;AI 只润色,不产数字
```

跨层只认两份契约:

- `evidence.json`(L3 输出 / L4 输入)
- `score-result.json`(L4 输出 / L5 输入)

两份都有 JSON Schema。任何一层改结构,必须过 schema 校验与 golden test。

## 二、解耦硬约束(写进 code review 清单)

| 约束 | 说明 |
| --- | --- |
| L1 不知道字段名 | 只描述"这一页有什么文字/图/表格",不认识"营业收入" |
| L2 不写 `value` | 只能 append 到 `candidates[]`;值有歧义就保留多个候选 |
| L3 是唯一写入口 | 所有 L4 输入必经 `evidenceStore.confirm()` |
| L4 无 I/O | `evaluate(model, rules)` 只接受纯 JSON,禁 `fs` / `fetch` / `Date.now()` |
| L5 不产分数 | 拿到的是算好的 `ScoreResult`,正文数字须能回查 |

## 三、目录

```
config/
  rules/         规则包(六门槛 + 23 指标)
  benchmarks/    行业基准库
  catalog/       字段目录(40 字段)
  prompts/       分层 prompt 模板
  pricing.json   单价与预算
shared/
  scoring/       engine / gates / normalize / aggregate / indicators(23 个)
  schema/        5 个 JSON Schema
server/
  routes/        projects / files / evidence / score / report / jobs
  pipeline/      detect / pdf / docx / xlsx / image / render
  ai/            client / extract / reconcile / report / guard / cache / budget
  store/         project / evidence / atomic
  jobs/          queue / progress
web/
  views/         ProjectsView / ReviewView / StatusView(评分页与报告页待建)
  components/    SourceViewer / EvidenceFieldRow / CandidateCard
data/            项目数据(永不入库)
docs/            本目录
```

## 四、本地数据布局

```
data/
  projects/<projectId>/
    project.json       元数据 + 文件清单
    evidence.json      L3 输出 / L4 输入
    files/<fileId>.<ext>
    pages/<fileId>.json   每页 route/text/tables
    pages/<fileId>/pN.jpg 页图,供视觉通道与 bbox 对照
    jobs.json             解析任务状态(只留最近 20 条)
  tmp/                 上传中间文件,失败即清
```

写入与拦截:

| 环节 | 做法 |
| --- | --- |
| 落盘 | 先写 `data/tmp/*.part`,判型通过后 rename 进 `files/`,同卷重命名是原子的 |
| 判型 | 只读字节:头部魔数 + ZIP 中央目录;扩展名不参与判断 |
| 去重 | 流式计算 sha256,项目内查重;重复时删新副本,返回已有 `fileId` 且 `dup: true` |
| 单文件限额 | 50MB,busboy 在流层截断,超限返回 413 并清理临时文件 |
| 项目页数 | 400 页。图片上传时即知 1 页,立即校验;PDF/docx/xlsx 到解析前用 `assertPageBudget` 拦 |
| 并发 | 同一项目的 JSON 写入走内存串行锁,避免两个上传互相覆盖 `project.json` |

`project.json` 与 `evidence.json` 都用「临时文件 + fsync + rename」写入,断电时不会留下半截 JSON。

## 五、接口

```
POST   /api/projects                      → { projectId, project }
GET    /api/projects                      → { projects[] }
GET    /api/projects/:id                  → { projectId, project }
POST   /api/projects/:id/files            multipart → { fileId, sha256, dup }
DELETE /api/projects/:id/files/:fileId    → 204
POST   /api/projects/:id/parse            → { jobId, reused }
POST   /api/projects/:id/extract          → { jobId, reused }
GET    /api/jobs/:jobId                    → { job }
GET    /api/jobs/:jobId/stream            SSE: { stage, fileId, page, total, pct }
GET    /api/projects/:id/evidence         → evidence.json
PATCH  /api/projects/:id/evidence/:key    { candidateId?, manualValue?, unit?, note?, status? }
POST   /api/projects/:id/evidence/auto-confirm → { confirmed[], skipped[], policy }
GET    /api/projects/:id/pages/:fileId    → FilePages(确认页做原文定位)
POST   /api/projects/:id/score            → ScoreResult
GET    /api/projects/:id/report?format=md|pdf|json
GET    /api/files/:fileId/page/:n?projectId= → image/jpeg
GET    /api/meta/catalog                  → { version, fields[], autoConfirm }
POST   /api/settings/apikey               { key } → { masked }
GET    /api/meta/industries               → 基准库可选行业
```

契约由 `zod` 定义,`zod-to-openapi` 生成 `openapi.json`,前端用 `openapi-typescript` 生成类型。

## 六、进程与长任务

单进程 Express,同时托管 `web/dist`。开发期 Vite proxy `/api → :8787`。

解析是分钟级任务,HTTP 不能同步等待:

```
POST /parse → 立刻返回 jobId
             ↓
        进程内队列执行
             ↓
GET /jobs/:id/stream → SSE 推送 { stage, page, total, pct }
```

任务状态落盘到 `jobs.json`,刷新页面可恢复。视觉调用并发 2,文本并发 3。

## 七、证据状态机

```
missing ──AI 命中──> candidate ──确认──> confirmed
                        │                  │
                        └──否决──> rejected └──改值──> confirmed(manualValue)

confirmed ──重新解析──> candidate(旧值保留,不丢历史)
```

**打分只读 `confirmed`。** 其余进"缺失清单",参与三口径区间计算。

## 八、报告形态

```
主视图   条件匹配度:六项门槛逐条 满足/不满足/材料不足/需人工确认
         材料完整度:40 字段中已确认多少,缺哪些佐证
次视图   参考得分:63.4(区间 51.2 – 71.8),标注非官方口径
导出    Markdown / PDF,由同一 ReportModel 渲染,数字全部来自 score-result.json
```

四态必须区分"材料不足"与"需人工确认":前者是客户没给,后者是我们识别到但拿不准。

## 九、阶段路线

**第一阶段(已完成)**
- [x] 三份地基配置:规则包、字段目录、行业基准
- [x] 四份 Schema:rules / field-catalog / benchmarks / evidence
- [x] 三篇文档

**第二阶段 MVP**
1. pnpm workspaces + TS 脚手架 + SSE(已完成)
2. `shared/scoring` 23 项 + 6 门槛 + golden test(3 家虚构企业)(已完成)
3. 存储层 + 上传 + 魔数判型(已完成)
4. 解析:PDF 双通道 / DOCX / XLSX(已完成)
5. 抽取:四类 docType 分派
6. 确认页:字段行 + 页图 bbox 对照 + 冲突二选一
7. 评分页:雷达 + 23 项表 + 门槛表 + 三口径
8. 报告:Markdown + PDF 导出(同一报告模型,两套渲染)

**验收**:50 页真实材料,上传到出报告 ≤8 分钟;人工确认 ≤15 分钟;23 项中 ≥18 项自动带出处。

**第三阶段**
规则编辑器 UI(改 share 立即重算)、小巨人规则包、批量对比、成本面板、样本回归集扩到 10 份。

## 十、风险

| 风险 | 规避 |
| --- | --- |
| 政策再调整 | 规则包版本化 + `effectiveFrom` 锁定,项目创建时绑定,永不自动升级 |
| 分数与官方不可比 | 双轨输出 + 三口径区间 + 报告双处声明 |
| AI 幻觉数字 | 报告层只给 ScoreResult + 数字白名单校验 + 模板兜底 |
| 单位错位 | `raw` 与 `unit` 永久保留;跨源冲突强制人工;量级合理性检查 |
| 成本失控 | 页数 + token 双预算、内容哈希缓存 |
| 表格解析不足 | **止损点:3 份实测准确率 < 70% 即换 Python**,引擎是纯函数,迁移只换外壳 |
| 隐私 | 明示图像外发;提供「仅文本模式」 |
