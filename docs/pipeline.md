# 解析与 AI 契约

> 从文件到证据表的完整链路。字段定义在 `config/catalog/field-catalog.v1.json`,本文写**怎么抽、抽完怎么验**。

## 一、链路总览

```
文件 → sha256 去重 → 魔数判型 → docType 分类 → 逐页路由 → PageDoc[]
                                                              ↓
                                              AI 抽取(文本/视觉双通道)
                                                              ↓
                                                    Candidate[](只追加,不覆盖)
```

## 二、判型:不信扩展名

| 头部字节 | 判定 |
| --- | --- |
| `%PDF` | PDF |
| `PK\x03\x04` + 读 `[Content_Types].xml` | docx 或 xlsx |
| `\xD0\xCF\x11\xE0` | 老版 doc/xls → **直接拒绝**,提示另存为新格式 |
| `FFD8FF` / `89504E47` / `RIFF....WEBP` | 图片 |

## 三、扫描件:页级判定,不是文件级

```js
printable = pageText.replace(/\s/g, '').length
hasGlyphs = textItems.some(it => it.width > 0 && it.str.trim())
route = (printable >= 30 && hasGlyphs) ? 'text' : 'vision'
```

文件级汇总:

| 图片页占比 | 文件 route | 行为 |
| --- | --- | --- |
| ≤ 0.2 | `text` | 全部走文本通道 |
| 0.2 – 0.5 | `hybrid` | **逐页**混合,`pages.json` 记录每页 route |
| > 0.5 | `vision` | 整份走视觉 |

补充规则:

- 页数 > 30 且首 3 页全为图 → 直接判扫描件,不再逐页试探(省时间)
- 有文本层但乱码率高(大量 `\uFFFD`)→ 判"伪文本层",降级视觉

## 四、渲染参数

| 参数 | 常规页 | 财务表格页 |
| --- | --- | --- |
| scale | 2.0(约 144 DPI) | 2.4 |
| maxLongEdge | 1600 | 2000 |
| format | jpeg | jpeg |
| quality | 0.82 | 0.88 |
| grayscale | false（红章需保留色彩） | false |
| 单页目标体积 | ≤ 350KB | ≤ 500KB |

表格页判定:检测到大面积水平线,或 `docType == audit` 且页内含"资产负债表/利润表/现金流量表"字样。

## 五、限额

| 限制 | 默认 | 超限行为 |
| --- | --- | --- |
| 单文件页数 | 80 | 仅解析前 80 页,报告标 `truncated` |
| 单项目页数 | 400 | 上传时拦截,提示拆分 |
| 单文件视觉页 | 40 | 超出只取文本层,标 `visionSkipped` |
| 单文件大小 | 50MB | 拒绝 |
| 单项目 token | 400k | 停止后续调用,已完成部分照常出分 |

## 六、三种格式的落地细节

**PDF** —— `pdfjs-dist/legacy/build/pdf.mjs` + `@napi-rs/canvas`。文本项按 `transform[5]` 分组还原行,再按 `x` 排序拼行。表格页用"3 个以上 item 的 x 坐标重复出现在同一列"启发式识别,转 `|` 分隔伪表格(比空格拼接更利于模型对齐列)。

**DOCX** —— `mammoth.convertToHtml({styleMap})` 保留 `<table>`,自写 `tableToPipeText()` 把每行转 `列1 | 列2 | 列3`。正文按 `<h1..h3>` 分节写进 `blocks[]`。**不用 `extractRawText`**,它会拍平表格导致数字错位。

**XLSX** —— SheetJS `read(buf, {cellDates:true, cellFormula:true})`,`sheet_to_json({header:1, raw:false})`。表头含"营业收入/研发费用/净利润"的列**直接结构化抽取,不经 AI**,`confidence:0.97`;AI 只负责识别表头别名。

**图片** —— 直传视觉,单图作为一页。prompt 要求忽略透视畸变,只读清晰字段;低质量图 `confidence ≤ 0.4`。

## 七、AI 调用:四层拼接

| 层 | 内容 | 变化频率 | 缓存 |
| --- | --- | --- | --- |
| L0 system | 角色 + 铁律:只抄录不推断、不评价、不补全,找不到就 `found:false`,金额必带原文单位 | 极低 | 前缀缓存 |
| L1 schema | 本次允许的**字段子集** + 输出 JSON 形状 + 2 个正反例 | 中 | 按 docType 缓存 |
| L2 document | 页文本(`### p3` 分隔)或页图 + 页码标注 | 每块不同 | 不缓存 |
| L3 instruction | "本块 p3–p7,只返回这些页命中的字段" | 每块不同 | 不缓存 |

**字段子集是省钱关键。** 按 docType 分派:`audit` → 全部 `fin.*`;`patent` → `ip.*`;`cert` → `qual.*`;`standard` → `std.*`。单次 prompt 的 schema 段从 40 字段降到 8–14,输入 token 降约 55%。

请求体:

```js
{
  model: 'deepseek-flash',
  temperature: 0,
  response_format: { type: 'json_object' },
  messages: [{ role: 'system', content: L0 + L1 }, { role: 'user', content: L2 + L3 }]
}
```

schema 必须**同时以文字形式写进 system**,不能只依赖 `response_format`。

## 八、输出契约

```json
{
  "pageRange": [3, 7],
  "fields": [
    {
      "key": "fin.revenue", "found": true, "period": 2025,
      "value": 132000000, "unit": "CNY", "raw": "132,000,000.00",
      "page": 5, "quote": "营业收入 132,000,000.00",
      "confidence": 0.96
    }
  ],
  "documentMeta": { "docType": "audit", "companyName": "...", "reportYear": 2025 },
  "unreadable": [{ "page": 9, "reason": "扫描模糊" }]
}
```

## 九、五级校验阶梯

```
1  JSON.parse 失败      → repair 一次(只输出修正后的 JSON)
2  ajv 校验失败          → 带 errors 重试一次,仅重试失败字段
3  语义校验(纯代码)     → unit 不在枚举 / page 超出页数 / period 非法 / value 非数值 → 丢弃并打标
4  quote 匹配(仅文本通道) → 未命中 → confidence = min(conf, 0.5), flags: quote_unverified
5  仍失败                → 该块标 failed,不影响其他块;UI 提示"第 5-7 页识别失败,可手动补录"
```

网络层:超时 120s(视觉 180s);429/5xx 退避 1s→4s→10s,3 次;其他 4xx 不重试。

缓存键:`sha256(fileBytes) + promptVersion + model + fieldSubsetHash`。重复上传同一份文件零成本。

## 十、报告层的数字白名单

这是防幻觉的最后一道闸。

- 输入**只给 `ScoreResult`**,禁传 evidence 原文(防止模型从原文"发现"新数字)
- 正文数字必须用 `[[i:IND_21]]` / `[[g:GATE_3]]` 引用标记
- 禁止四则运算出新数字(算涨价率、求总和都不行)
- 输出后置校验:正则提取正文所有数字,逐个在 `ScoreResult` 数值集合(含 `1.32亿 / 132,000,000 / 11.86%` 等格式化变体)中查找,命中率 < 100% 即**丢弃该段,回退模板文案**

**模板文案永远存在。** 报告 100% 可离线生成,AI 只做润色与建议段落。AI 挂了报告照样出 —— 这是单机工具的可靠性底线。

## 十一、失败与隐私

- 任何一页失败不阻塞整体:该页字段进"材料不足",用户可手动补录
- 上传页明示"页面图像将发送至 DeepSeek API"
- 提供「仅文本模式」:只抽文字层,不传图,数据不出本机;扫描件多的客户会丢字段,但可接受
