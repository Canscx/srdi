# AGENTS.md

专精特新申报自评打分系统。上传企业材料 → 抽取证据 → 规则引擎打分 → 输出报告。
当前 `v0.2.0`:第二阶段进行中(规则配置 / 脚手架 / 打分引擎 / 存储与上传 / 解析链路 / AI 抽取 / 确认页 / 评分页 / 报告导出已完成,真实材料验收未开始)。

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
`config/rules/` 23 项指标参数 · `config/catalog/` 40 字段 · `config/benchmarks/` 行业基准
