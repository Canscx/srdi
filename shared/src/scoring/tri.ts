import type { Flag, Tri, Val } from './types'

export const triTrue = (flags: Flag[] = []): Tri => ({ v: true, missing: [], pending: [], flags })

export const triFalse = (flags: Flag[] = []): Tri => ({ v: false, missing: [], pending: [], flags })

export const triNull = (missing: string[] = [], pending: string[] = [], flags: Flag[] = []): Tri => ({
  v: null,
  missing,
  pending,
  flags
})

export const triFromVal = (val: Val): Tri => {
  if (val.kind === 'bool') return { v: val.v, missing: [], pending: [], flags: val.flags }
  if (val.kind === 'num') return { v: val.v !== 0, missing: [], pending: [], flags: val.flags }
  if (val.kind === 'none') {
    if (val.reason === 'pending') return triNull([], val.refs, val.flags)
    return triNull(val.refs, [], val.flags)
  }
  return triNull([], [], [...val.flags, 'non_boolean_value'])
}

const uniq = (items: string[]): string[] => Array.from(new Set(items))

export const andTri = (a: Tri, b: Tri): Tri => {
  const missing = uniq([...a.missing, ...b.missing])
  const pending = uniq([...a.pending, ...b.pending])
  const flags = uniq([...a.flags, ...b.flags])
  if (a.v === false || b.v === false) return { v: false, missing, pending, flags }
  if (a.v === null || b.v === null) return { v: null, missing, pending, flags }
  return { v: true, missing, pending, flags }
}

export const orTri = (a: Tri, b: Tri): Tri => {
  const flags = uniq([...a.flags, ...b.flags])
  if (a.v === true || b.v === true) return { v: true, missing: [], pending: [], flags }
  if (a.v === null || b.v === null) {
    return { v: null, missing: uniq([...a.missing, ...b.missing]), pending: uniq([...a.pending, ...b.pending]), flags }
  }
  return { v: false, missing: [], pending: [], flags }
}

export const notTri = (a: Tri): Tri => ({
  v: a.v === null ? null : !a.v,
  missing: a.missing,
  pending: a.pending,
  flags: a.flags
})

export const triVerdict = (t: Tri): 'pass' | 'fail' | 'unknown' | 'pending' => {
  if (t.v === true) return 'pass'
  if (t.v === false) return 'fail'
  if (t.pending.length > 0) return 'pending'
  return 'unknown'
}

export const triSummary = (t: Tri): string => {
  if (t.v === true) return '成立'
  if (t.v === false) return '不成立'
  if (t.pending.length > 0) return `需人工确认:${t.pending.join('、')}`
  if (t.missing.length > 0) return `材料不足:${t.missing.join('、')}`
  return '无法判定'
}
