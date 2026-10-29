# 交接文档 · PDF 导出 500 故障(2026-10-29)

> 写给接手修复本故障的下一位工程师(人或模型)。此前多轮修复已回退,代码状态 = `700f8cc`。
> 备份分支 `backup-fbb024d-fontfix` 保留了全部失败尝试,可直接对照或 cherry-pick。

## 现象

- **服务器**(宝塔/OpenCloudOS/Node v22.22.3/pnpm 11.22):登录、上传、解析、打分、导出 MD 全部正常;**仅导出 PDF 返回 500**,响应体:
  `{"error":"internal_error","message":"Not a supported font format or standard PDF font."}`
- **本地**(Windows/Node 22.22.2):登录接口 500 —— **与字体无关**,见文末"本地 500 的真相"
- 便携包(Windows/npm 扁平布局/Node 22.22.2):**PDF 导出成功**(78KB,%PDF- 魔数,中文可提取)

## 已确证的事实(全部有实验证据)

1. **字体文件没问题**:服务器 `/www/wwwroot/srdi/fonts/simhei.ttf`,魔数 `00010000`(TrueType),9.3MB,fontkit 可解析出 `SimHei`
2. **`.env` 的 `REPORT_FONT_PATH` 指向正确**(该文件存在且可读)
3. **根因 A(上游包缺陷,主因)**:`unicode-properties@1.4.0` 的 package.json exports 拼写错误:
   ```json
   "require": "./dist.main.cjs"   ← 少一个斜杠,正确应为 "./dist/main.cjs"
   ```
   任何严格 Node 解析环境里,`pdfkit`(CJS) → `require('fontkit')` → fontkit(ESM) → `unicode-properties` 的 require 条件 → **文件不存在 → 炸**。错误会被 pdfkit 包装成误导性的 "Not a supported font format"。
4. **根因 B(历史代码缺陷,700f8cc 状态下存在)**:`server/src/report/fonts.ts` 的候选列表在**模块加载时**读取 `process.env.REPORT_FONT_PATH`,而 ESM 的 import 提升使 `.env` 的 loadEnvFile 晚于它执行 → **`REPORT_FONT_PATH` 永远读不到** → 字体选择落到 Noto CJK。
5. **根因 C(环境差异,掩盖前两者)**:本地 Windows 的 `C:/Windows/Fonts/simhei.ttf` 恰好是 TrueType 且在内置候选里,本地从不触发根因 B;本地 vitest 用宽容解析器,也不触发根因 A。**这就是"本地测不出来"的原因**。
6. **pdfkit 无法嵌入 CFF 轮廓字体**:Noto CJK 全系(含 OpenCloudOS 的 `google-noto-cjk` 包)都是 CFF,装了也用不了;**文泉驿(wqy-zenhei)与 simhei.ttf 是 TrueType,可用**。
7. **便携包为什么没事**:便携包用 `npm install`(npm 扁平布局),npm 自由解析装了 `unicode-properties@1.4.1`(1.4.1 修复了 exports 拼写)→ 成功。pnpm 严格按 lockfile 装 1.4.0 → 踩雷。
8. 服务器日志堆栈(宝塔项目日志可复现):`Error: Not a supported font format or standard PDF font.` at TTFFont...(fontkit) → pdfkit 包装

## 已失败的尝试(不要重走)

- `pnpm update unicode-properties`:传递依赖,显示 Already up to date 不动
- `pnpm.overrides` 写在 **package.json**:pnpm 11.22 显示 resolution skipped 未生效;**且用户终端 pnpm 是 12.16.1,pnpm 12 不再读 package.json 的 pnpm 字段**(WARN 实锤:ignored "pnpm.overrides")
- `pnpm install --force`:不修复断链/坏包
- 直接改 `.pnpm` 里的文件:下次 install 被重置

## 修复方向(按把握排序)

1. **把 overrides 迁移到 pnpm-workspace.yaml**(pnpm 10+ 的新家,pnpm 11/12 都读):
   ```yaml
   overrides:
     unicode-properties: 1.4.1
   ```
   然后 `rm -rf node_modules && pnpm install` → 装 1.4.1(exports 正确)。**注意**:1.4.1 的 exports 已用 `npm view unicode-properties@1.4.1 exports` 验证为正确路径。
2. **或 pnpm patch**:`pnpm patch unicode-properties@1.4.0` 修 exports 拼写。patchedDependencies 配置同样要放 pnpm-workspace.yaml(pnpm 12 才认)。备份分支 `backup-fbb024d-fontfix` 的 `patches/unicode-properties@1.4.0.patch` 已写好可用。
3. **同时必须修根因 B**(独立缺陷,都必要):fonts.ts 候选列表改惰性求值,并把 `.env` 加载挪到所有 import 之前(备份分支的 `server/src/env.ts` + `index.ts` 首行 `import './env'` 就是成品,可 cherry-pick)。否则 `.env` 的 `REPORT_FONT_PATH` 依然无效,字体选择会落到 CFF。
4. 便携包(npm 布局)不受影响,无需动。

## 本地 500 的真相(与字体无关)

排错期间多次编辑文件,本地 dev 的 `tsx watch` 撞上文件中间态崩溃退出;vite(5180) 还活着,登录请求转发到死掉的 8787 → vite 返回 500。**用户重启 `pnpm dev` 即恢复登录/MD 功能**(但 PDF 仍会失败,直到根因 A 修复)。

## 验收标准

1. 服务器 `node deploy/check-font.mjs`(备份分支有)六层全绿
2. 导出 PDF:HTTP 200 + `%PDF-` 魔数 + 中文可提取
3. 本地 `pnpm dev` 后同样导出成功

## 其他已知事项

- 服务器 `.env`:`REPORT_FONT_PATH=/www/wwwroot/srdi/fonts/simhei.ttf`(字体已上传)
- 服务器 `data/` 与项目权限:曾 root 重装依赖,部署后建议 `chown -R www:www /www/wwwroot/srdi`
- 浏览器请求经用户本地代理(Clash 7897),排查时用 `curl --noproxy "*"` 避免干扰
