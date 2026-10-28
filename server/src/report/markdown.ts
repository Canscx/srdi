import {
  CONCLUSION_TEXT,
  DOC_TYPE_TEXT,
  FIELD_GROUP_TITLES,
  GATE_VERDICT_TEXT,
  INDICATOR_STATUS_TEXT
} from '@srdi/shared'
import type { ReportIndicator, ReportModel } from './build'
import {
  GROUP_ORDER,
  flagText,
  formatDateTime,
  gateBasisText,
  gateEffectText,
  gateVerdictText,
  indicatorFlagsText,
  indicatorRawText,
  n2,
  pct1,
  rangeText,
  scoreRateText
} from './format'

const cell = (value: string): string =>
  value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim()

const table = (
  headers: string[],
  rows: string[][],
  aligns?: ('left' | 'right')[]
): string[] => [
  `| ${headers.map(cell).join(' | ')} |`,
  `| ${headers.map((_, index) => (aligns?.[index] === 'right' ? '---:' : '---')).join(' | ')} |`,
  ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`)
]

const statusOf = (item: ReportIndicator): string =>
  INDICATOR_STATUS_TEXT[item.result.status] ?? item.result.status

const fileStatusText: Record<string, string> = {
  parsed: '已解析',
  failed: '解析失败',
  pending: '待解析'
}

export const renderMarkdown = (model: ReportModel): string => {
  const { project, record, fields, indicators, dimensionMax, versions, assumptions } = model
  const result = record.result
  const stats = record.evidence
  const period = `${result.period.y2}–${result.period.y0}`
  const industry = result.industry
  const industryLabel = `${industry.code || '—'} ${industry.name ?? '未匹配行业'}${
    industry.benchmarkSource === 'default' ? '（中性基准估算）' : ''
  }`
  const countStatus = (status: string) => fields.filter((field) => field.status === status).length
  const gatePass = result.gates.filter((gate) => gate.effective === 'pass').length
  const gateFail = result.gates.filter((gate) => gate.effective === 'fail').length
  const gatePending = result.gates.filter((gate) => gate.effective === 'pending').length
  const pendingIndicators = indicators.filter(
    (item) => item.result.basis === 'absent' || item.result.basis === 'substituted'
  )
  const notApplicable = indicators.filter((item) => item.result.status === 'notApplicable')
  const lines: string[] = []

  lines.push(`# ${project.name} · 专精特新中小企业自评报告`, '')
  lines.push(
    '> **参考得分 · 非官方口径。** 五个一级维度权重取自政策文件；三级指标政策未公布权重，本工具按维度内等权处理。得分为纯函数规则引擎算出的自查参考值，与主管部门的评审结果不可直接比对。',
    ''
  )
  lines.push(
    `- **统计期间**：${period}`,
    `- **行业基准**：${industryLabel}`,
    `- **规则包**：${versions.rulesId} · 引擎 v${versions.engineVersion}${
      versions.benchmarksVersion ? ` · 行业基准 v${versions.benchmarksVersion}` : ''
    }`,
    `- **打分时间**：${formatDateTime(record.savedAt)}`,
    `- **报告生成**：${formatDateTime(model.generatedAt)}`
  )
  lines.push('')

  if (model.stale) {
    lines.push(
      `> **注意**：证据在打分之后有变动。本报告的数字来自 ${formatDateTime(record.savedAt)} 的评分结果（当时已确认 ${stats.confirmed} / ${stats.total} 个字段），建议回评分页重新计算后再导出。`,
      ''
    )
  }

  lines.push('## 一、结论摘要', '')
  lines.push(
    `- **门槛判定**：${gatePass} 项通过，${gateFail} 项阻断，${gatePending} 项待定`,
    `- **参考得分**：${n2(result.totals.official)} / 100（保守 ${n2(
      result.totals.conservative
    )} – 乐观 ${n2(result.totals.optimistic)}）`,
    `- **证据可信度**：${pct1(result.totals.confidence)}，${stats.total} 个字段已确认 ${stats.confirmed} 个`,
    `- **综合结论**：${CONCLUSION_TEXT[result.conclusion] ?? result.conclusion}`
  )
  lines.push('')
  lines.push(
    ...table(
      ['门槛', '判词', '依据', '结论'],
      result.gates.map((gate) => [
        `${gate.id} ${gate.name}`,
        gateVerdictText(gate),
        gateBasisText(gate),
        gateEffectText(gate)
      ])
    )
  )
  lines.push('')

  lines.push('## 二、材料完整度', '')
  lines.push(
    ...table(
      ['状态', '字段数'],
      [
        ['已确认', String(countStatus('confirmed'))],
        ['待确认', String(countStatus('candidate'))],
        ['缺失', String(countStatus('missing'))],
        ['已否决', String(countStatus('rejected'))],
        ['合计', String(fields.length)]
      ],
      ['left', 'right']
    )
  )
  lines.push('')
  lines.push(
    ...table(
      ['分组', '字段数', '已确认', '缺失', '待确认', '已否决'],
      GROUP_ORDER.map((group) => {
        const items = fields.filter((field) => field.group === group)
        if (items.length === 0) return null
        return [
          FIELD_GROUP_TITLES[group] ?? group,
          String(items.length),
          String(items.filter((field) => field.status === 'confirmed').length),
          String(items.filter((field) => field.status === 'missing').length),
          String(items.filter((field) => field.status === 'candidate').length),
          String(items.filter((field) => field.status === 'rejected').length)
        ]
      }).filter((row): row is string[] => row !== null),
      ['left', 'right', 'right', 'right', 'right', 'right']
    )
  )
  lines.push('')

  const shortFields = fields.filter(
    (field) => field.status === 'missing' || field.status === 'rejected'
  )
  lines.push(`**缺失或已否决的字段（${shortFields.length}）**`, '')
  if (shortFields.length === 0) {
    lines.push('- 无，40 个字段全部有已确认值。')
  } else {
    for (const group of GROUP_ORDER) {
      const items = shortFields.filter((field) => field.group === group)
      if (items.length === 0) continue
      const detail = items
        .map(
          (field) =>
            `${field.label}（${field.key}）${field.status === 'rejected' ? ' · 已否决' : ''}`
        )
        .join('、')
      lines.push(`- **${FIELD_GROUP_TITLES[group] ?? group}**：${detail}`)
    }
  }
  lines.push('')

  lines.push('## 三、参考得分', '')
  lines.push('### 三口径', '')
  lines.push(
    ...table(
      ['口径', '分数', '计算口径'],
      [
        ['保守', n2(result.totals.conservative), '估算项与缺失项记 0'],
        ['参考', n2(result.totals.official), '缺失项按半个权重、估算项按估算分计入'],
        ['乐观', n2(result.totals.optimistic), '估算项与缺失项记满权重']
      ],
      ['left', 'right', 'left']
    )
  )
  lines.push('')
  lines.push('### 五维分布', '')
  lines.push(
    ...table(
      ['维度', '名义权重', '重归一满分', '参考', '保守', '乐观', '可信度'],
      result.dimensions.map((dimension) => [
        dimension.name,
        n2(dimension.weight),
        n2(dimensionMax[dimension.id] ?? dimension.weight),
        n2(dimension.score.official),
        n2(dimension.score.conservative),
        n2(dimension.score.optimistic),
        pct1(dimension.score.confidence)
      ]),
      ['left', 'right', 'right', 'right', 'right', 'right', 'right']
    )
  )
  lines.push('')
  lines.push(
    result.totals.conservative === result.totals.optimistic
      ? `区间收敛于 ${n2(result.totals.official)}，当前没有估算项与缺失项。`
      : `区间 ${rangeText(result.totals)}，差距来自估算项与缺失项，差距越小说明证据越扎实。`
  )
  lines.push('')

  lines.push('## 四、门槛判定', '')
  for (const gate of result.gates) {
    lines.push(`### ${gate.id} ${gate.name}`, '')
    lines.push(
      `- 判词：${gateVerdictText(gate)}`,
      `- 结论：${gateEffectText(gate)}`,
      `- 依据：${gateBasisText(gate)}`,
      `- 说明：${gate.explain}${gate.passedVia ? `（经 ${gate.passedVia} 通过）` : ''}`
    )
    if (gate.checks.length > 0) {
      for (const check of gate.checks) {
        lines.push(
          `- 检查项：${check.id} ${check.label} — ${
            GATE_VERDICT_TEXT[check.verdict] ?? check.verdict
          }`
        )
      }
    } else {
      lines.push('- 检查项：按三口径分数判定，无独立检查项。')
    }
    lines.push('')
  }

  lines.push('## 五、指标明细', '')
  for (const dimension of result.dimensions) {
    const items = indicators.filter((item) => item.result.dimensionId === dimension.id)
    if (items.length === 0) continue
    lines.push(
      `### ${dimension.name}（名义权重 ${n2(dimension.weight)} · 重归一满分 ${n2(
        dimensionMax[dimension.id] ?? dimension.weight
      )} · 参考 ${n2(dimension.score.official)}）`,
      ''
    )
    lines.push(
      ...table(
        ['编号', '指标', '状态', '原始值', '得分率', '权重', '有效权重', '标记'],
        items.map((item) => [
          String(item.result.code),
          item.result.name,
          statusOf(item),
          indicatorRawText(item.result.raw, item.unit),
          scoreRateText(item.result.score),
          n2(item.result.weight),
          n2(item.result.effectiveWeight),
          indicatorFlagsText(item.result, item.missingFields)
        ]),
        ['right', 'left', 'left', 'right', 'right', 'right', 'right', 'left']
      )
    )
    lines.push('')
  }

  lines.push('## 六、待补材料', '')
  lines.push(`### 缺失与估算指标（${pendingIndicators.length}）`, '')
  if (pendingIndicators.length === 0) {
    lines.push('- 无，23 项指标全部有实测证据。')
  } else {
    lines.push(
      ...table(
        ['编号', '指标', '状态', '缺失字段'],
        pendingIndicators.map((item) => [
          item.result.id,
          item.result.name,
          statusOf(item),
          item.missingFields.length > 0 ? item.missingFields.join('、') : '—'
        ])
      )
    )
  }
  lines.push('')

  lines.push('### 排除项', '')
  if (result.excluded.length === 0) {
    lines.push('- 无。')
  } else {
    for (const item of result.excluded) {
      const indicator = indicators.find((entry) => entry.result.id === item.indicatorId)
      lines.push(
        `- ${item.indicatorId} ${indicator?.result.name ?? ''} · 原权重 ${n2(
          item.baseWeight
        )} · ${item.reason}`
      )
    }
    lines.push(
      `- 上述指标不计分，其余 ${result.indicators.length - result.excluded.length} 项权重等比放大，有效权重合计 100。`
    )
  }
  lines.push('')

  lines.push('### 不适用指标', '')
  if (notApplicable.length === 0) {
    lines.push('- 无。')
  } else {
    for (const item of notApplicable) {
      lines.push(
        `- ${item.result.id} ${item.result.name} · ${
          item.result.reason ? flagText(item.result.reason) : '边界保护'
        } · 记 0 分`
      )
    }
  }
  lines.push('')

  lines.push('## 七、口径与假设', '')
  for (const item of assumptions) {
    lines.push(`- **${item.id}** ${item.text}（影响：${item.impact}）`)
  }
  lines.push('')

  lines.push('## 八、材料清单', '')
  if (project.files.length === 0) {
    lines.push('- 未上传材料。')
  } else {
    lines.push(
      ...table(
        ['文件', '类型', '页数', '状态'],
        project.files.map((file) => [
          file.name,
          DOC_TYPE_TEXT[file.docType ?? 'other'] ?? file.docType ?? '其他',
          String(file.pages ?? 0),
          fileStatusText[file.status] ?? file.status
        ]),
        ['left', 'left', 'right', 'left']
      )
    )
  }
  lines.push('')

  lines.push('---', '')
  lines.push(
    '> **参考得分非官方口径。** 三级指标采用维度内等权，排除项按策略不计分并把其余指标权重等比放大到 100；缺失项以中性值参与三口径区间。分数只作申报前自查，不能作为对外承诺。报告由本地规则引擎生成，AI 未参与打分与文案。',
    ''
  )

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
