# 故障复盘 · PDF 导出 500「Not a supported font format」(已结案)

> 2026-10-29 结案。此前两次修复(bd27811 之后的多轮尝试)均已回退,回退分支 `backup-fbb024d-fontfix` 仍在,仅作历史参考,**不要再按那份结论修**。
> 本文结论全部由可复现实验得出,复现命令见「证据」一节。

## 一、真实根因

pdfkit 把 `registerFont(name, src, family)` 的第三个参数原样当作 **PostScript 名**交给 fontkit:

```
pdfkit/lib/font_factory.js  open(src, family) → fontkit.openSync(src, family)
fontkit/base.js             create(buffer, postscriptName) → collection.getFont(postscriptName)
fontkit/TrueTypeCollection  getFont(name): 逐字面比较 font.postscriptName === name,不匹配返回 null
pdfkit/font_factory.js:27   if (font == null) throw new Error('Not a supported font format or standard PDF font.')
```

也就是说:**字体集合(.ttc)必须传字体内部的 PostScript 名,不能传给人看的 family 名**。传错不报"找不到字面",而是被 pdfkit 统一包装成这条误导性错误。

老候选表里四个平台字体全部传的是显示名:

| 候选文件 | 代码里传的名字 | 文件内 PostScript 名 | 结果 |
| --- | --- | --- | --- |
| NotoSansCJK-Regular.ttc | `Noto Sans CJK SC` | `NotoSansCJKsc-Regular` | null → 报错 |
| wqy-zenhei.ttc | `WenQuanYi Zen Hei` | `WenQuanYiZenHei` | null → 报错 |
| PingFang.ttc | `PingFang SC` | `PingFangSC-Regular` | null → 报错 |
| msyh.ttc | `Microsoft YaHei` | `MicrosoftYaHei` | null → 报错 |
| simsun.ttc | `SimSun` | `SimSun` | **恰好相等,能用** |
| simhei.ttf | 不传 | 单体 TTF 不需要 | 能用 |

Windows 本地之所以正常:候选表第一项 `C:/Windows/Fonts/simhei.ttf` 是单体 TrueType,命中即用,永远走不到 TTC 分支。Linux 没有黑体,必然落到 Noto / 文泉驿的 TTC 上,于是 100% 失败。

## 二、第二个缺陷:`.env` 里的 `REPORT_FONT_PATH` 从来没生效

`fonts.ts` 在**模块顶层**求值 `CANDIDATES`,`process.env.REPORT_FONT_PATH` 在那一刻已经被读成空串;而 `.env` 要到 `index.ts` 的 `process.loadEnvFile()` 才加载,ESM 的 import 求值早于函数体,时机永远晚一步。

后果:服务器上明明传了 `/www/wwwroot/srdi/fonts/simhei.ttf`(文件存在、可读、magic `00010000`),程序却看不见,照样回落到 Noto TTC,再撞上根因一。两个缺陷叠加,才出现「本地好、服务器炸」。

## 三、第三个缺陷:错误被吞成 `internal_error`

`renderPdf` 只把 `registerFont` 包在 try 里,真正触发加载的是紧随其后的 `doc.font('report')`,在 try 之外。异常逃到全局兜底,前端只看到 `internal_error` + pdfkit 的原文,既没有字体路径也没有下一步提示。

## 四、证据(可复现)

```
# 1) 同一台 Windows 上,只换第三个参数
registerFont(name, 'C:/Windows/Fonts/msyh.ttc', 'Microsoft YaHei')  → Not a supported font format or standard PDF font.
registerFont(name, 'C:/Windows/Fonts/msyh.ttc', 'MicrosoftYaHei')   → 成功,9448 字节

# 2) 反例:simsun.ttc 的 PostScript 名恰好等于显示名
registerFont(name, 'C:/Windows/Fonts/simsun.ttc', 'SimSun')         → 成功

# 3) 装载字后不传名:交给 pdfkit 的是集合对象,不是字面
registerFont(name, 'C:/Windows/Fonts/msyh.ttc')                     → this.font.createSubset is not a function
```

## 五、修复内容

| 文件 | 改动 |
| --- | --- |
| `server/src/report/fonts.ts` | 候选改为惰性收集:`REPORT_FONT_PATH` → 项目根 `fonts/` → 系统字体 → `fc-match`;用 fontkit 打开自省,集合里挑有中文字形的字面(简体优先),取它的 PostScript 名;坏文件跳过并记录原因 |
| `server/src/report/pdf.ts` | `registerFont` + `font()` 一起进 try;失败返回 `report_font_invalid`,hint 带字体路径与复检命令 |
| `server/src/env.ts` + `index.ts` | `.env` 在全部 import 之前加载(`import './env'` 置于首行),路径类环境变量不再被模块顶层求值吞掉 |
| `server/src/index.ts` | 启动日志打印实际选中的字体、PostScript 名与来源 |
| `server/scripts/check-font.ts`(`pnpm check:font`) | 打印平台、候选清单、逐条失败原因、选中项,并真的渲染一张中文 PDF 再用 pdfjs 提取文本 |
| `server/test/fonts.spec.ts` | 4 条:能解析、能出 PDF、TTC 取 PostScript 名、坏路径返回可读原因 |
| `server/src/types/fontkit.d.ts` + `server/package.json` | 显式依赖 `fontkit@^2.0.4`(pnpm 严格布局下 pdfkit 的子依赖不可直接 import),补最小类型声明 |

## 六、验收

```bash
pnpm check:font     # 三种字体各跑一次:simhei.ttf / msyh.ttc / NotoSansCJKsc-Regular.otf 均「PDF 导出可用」
pnpm validate       # 17 个测试文件、104 条全绿
```

服务器侧:把 `REPORT_FONT_PATH=/www/wwwroot/srdi/fonts/simhei.ttf` 留在 `.env` 或不设都行(`fonts/` 目录本身就在候选里),重启后启动日志会打印
`报告字体 SimHei · /www/wwwroot/srdi/fonts/simhei.ttf`。

## 七、对上一轮结论的更正

| 上一轮结论 | 实际情况 |
| --- | --- |
| 根因 A:`unicode-properties@1.4.0` 的 exports 拼写错误是主因 | 该拼写错误真实存在(`"require": "./dist.main.cjs"`),但 pdfkit 0.20.2 的 Node 入口是 `js/pdfkit.node.mjs`,fontkit 已打包进去,不走这条 require 分支。本轮在未打补丁的 1.4.0 环境下 pdfkit 工作正常。不是本次报错来源 |
| 「pdfkit 无法嵌入 CFF 轮廓字体,Noto CJK 全系都是 CFF」 | **错误**。`NotoSansCJKsc-Regular.otf` 直接加载成功,产出 60KB PDF,含 `CIDFontType0`,pdfjs 提取回「专精特新申报自评 · 字体自检 100 分」。CFF 完全可嵌入 |
| 「换 TrueType 字体(wqy-zenhei)即可」 | wqy-zenhei.ttc 同样是集合字体,旧代码传 `WenQuanYi Zen Hei` 一样返回 null。换字体救不了,只有传对 PostScript 名才行 |
| 根因 B:候选表在模块加载时读 env,`.env` 读不到 | **成立**,已修 |
| 便携包正常是因为 npm 装了 `unicode-properties@1.4.1` | 便携包正常更可能只是因为 Windows 命中了 `simhei.ttf`(单体 TTF,不涉及名字匹配),与 `unicode-properties` 版本无关 |

## 八、历史失败尝试(仅供避坑)

- `pnpm update unicode-properties`:传递依赖,pnpm 显示 Already up to date
- `pnpm.overrides` 写在 `package.json`:pnpm 11/12 不再读该字段,需写进 `pnpm-workspace.yaml`
- `pnpm install --force`:不修复断链或坏包
- 直接改 `.pnpm` 里的文件:下次 install 被重置
- 软链真 TrueType 字体到 `/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc`:路径对了,名字还是错的

## 九、遗留事项

- 服务器 `.env` 曾由 root 重装依赖,部署后建议 `chown -R www:www /www/wwwroot/srdi`
- 浏览器请求经用户本地代理(Clash 7897),命令行排查时用 `curl --noproxy "*"`
- 换机器部署后先跑 `pnpm check:font`,再验收导出
