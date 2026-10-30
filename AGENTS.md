# AGENTS.md

专精特新申报自评打分系统。上传企业材料 → 抽取证据 → 规则引擎打分 → 输出报告。
当前 `v0.3.0`:双角色(admin 后台 / customer 轻流程)已完成,客户一键评估 + 补足报告已上线,待真实客户材料验收。

## 技术栈(已定,勿改)

Vue3 + TypeScript + Vite + Element Plus + ECharts / Express 5 / 纯文件系统存储。
pnpm workspaces:`shared` / `server` / `web`。

## 硬性规则

- 代码零注释
- 仅适配桌面端
- 禁用 axios,统一 fetch
- 不引入 Pinia(两个 composable 足够)
- CSS 用 scoped

## 三条不可推翻的决策

1. **后端 Node,不是 Python** —— 评分引擎需前后端共享,以便前端调参实时重算。
   止损点:3 份真实材料实测 pdfjs 表格准确率 < 70%,才换 Python。
2. **前端 Vue3,不是 React** —— 6 个页面、90% 是表格与表单、Element Plus 主场。
3. **三级指标维度内等权** —— 官方未公布三级权重,参考得分仅供自查,不得对外称官方口径。

## 纪律

- 动手前读 `PROGRESS.md` 的「决策记录」,那里有已被否掉的方案
- 完成任务后追加 `PROGRESS.md`
- 提交前跑 `npm run validate`

## 索引

`docs/architecture.md` 架构与接口 · `docs/scoring.md` 打分数学 · `docs/pipeline.md` 解析与 AI 契约
`docs/PLAN-customer-portal.md` 客户轻流程方案 · `docs/HANDOVER-font-bug.md` PDF 字体故障复盘
`config/rules/` 23 项指标参数 · `config/catalog/` 40 字段 · `config/benchmarks/` 行业基准
`config/portal.json` 客户流程参数(及格线/槽位/软著折算/查询限流) · `config/industry-map.json` 行业推断 · `config/advice.json` 兜底话术
`web/src/components/portal/ScoreReport.vue` 评分页与结果页共用主体 · `server/src/portal/detail.ts` 两页共用数据装配
`assets/consult-qr.png` 报告二维码(英文路径,勿改中文名)
`samples/` 两套虚构企业材料 · `server/scripts/generate-samples.ts` 样本生成器(`pnpm samples`)
`server/scripts/check-font.ts` 中文字体自检(`pnpm check:font`)· `docs/HANDOVER-font-bug.md` PDF 字体故障复盘
`deploy/` 宝塔部署手册 + nginx/PM2 配置 · `scripts/build-portable.mjs` 便携包构建(`pnpm pack:portable`)
