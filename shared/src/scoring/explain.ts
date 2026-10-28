export const renderExplain = (template: string, vars: Record<string, string | number>): string => {
  const rendered = template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match))
  return rendered
    .replace(/(亿元|万元|元)\s*元\/人/g, '$1/人')
    .replace(/(亿元|万元|元)\s*元/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const trimZeros = (value: string): string => value.replace(/\.0+$/, '')

export const formatValue = (value: number | null, unit?: string): string => {
  if (value === null || !Number.isFinite(value)) return '—'

  if (unit === 'CNY' || unit === 'CNY/person') {
    if (Math.abs(value) >= 1e8) return `${trimZeros((value / 1e8).toFixed(2))} 亿元`
    if (Math.abs(value) >= 1e4) return `${trimZeros((value / 1e4).toFixed(2))} 万元`
    return `${Math.round(value)} 元`
  }

  if (unit === 'percent' || unit === 'ratio') {
    return `${trimZeros((value * 100).toFixed(2))}%`
  }

  if (unit === 'year' || unit === 'count' || unit === 'person' || unit === 'point') {
    return `${Math.round(value * 100) / 100}`
  }

  return `${Math.round(value * 100) / 100}`
}
