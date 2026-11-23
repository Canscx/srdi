# 贡献指南

## 环境

Node ≥ 20.11、pnpm ≥ 9。首次拉取后：

```bash
pnpm install
pnpm dev        # 服务 8787 + 前端 5180
```

## 提交前必跑

```bash
pnpm validate   # 配置校验 + 三包类型检查 + 全部测试
```

任何一项红都不得提交。CI 会在 Pull Request 上跑同一条命令。

## 编码约定

完整清单见 [AGENTS.md](AGENTS.md)，几条最容易被卡住的：

- **代码零注释**：靠命名与结构表达意图，不写解释性注释
- **仅适配桌面端**：不做移动端断点
- **统一 `fetch`**：不引入 axios
- **不引入 Pinia**：现有 composable 足够
- **CSS 用 `scoped`**
- 环境变量禁用 `VITE_` 前缀，否则会被打进前端 bundle 等同公开密钥

## 三条不可推翻的架构决策

1. **后端 Node，不是 Python** —— 评分引擎需前后端共享，以便前端调参实时重算
2. **前端 Vue3，不是 React** —— 6 个页面、90% 是表格与表单，Element Plus 主场
3. **三级指标维度内等权** —— 官方未公布三级权重，参考得分仅供自查，不得对外称官方口径

改这三条之前先读 `PROGRESS.md` 的「决策记录」，那里有已被否掉的方案与改判条件。

## 五层解耦硬约束

| 约束 | 说明 |
| --- | --- |
| L1 不知道字段名 | 只描述「这一页有什么文字 / 图 / 表格」 |
| L2 不写 `value` | 只能 append 到 `candidates[]` |
| L3 是唯一写入口 | 所有打分输入必经 `evidenceStore.confirm()` |
| L4 无 I/O | 引擎是零 I/O 纯函数，禁 `fs` / `fetch` / `Date.now()` |
| L5 不产分数 | 报告数字必须能回查 `score-result.json` |

## 改配置即改行为

规则、字段、行业基准都在 `config/` 下，由 JSON Schema 与测试守着。改完跑 `pnpm validate`，不要在两处各写一份说明。

## 提交信息

沿用 `type(scope): 摘要`，type 取 `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`。摘要写「做了什么」，不写「更新文件」。

## 记录

完成任务后在 `PROGRESS.md` 追加一节，写清结论、取舍与踩过的坑。它是后续对话的接续点，比 commit message 详细。
