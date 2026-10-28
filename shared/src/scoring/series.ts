import type { Flag, PeriodKey, Series, Slot } from './types'

export const PERIOD_KEYS: readonly PeriodKey[] = ['y0', 'y1', 'y2']

export const slot = (state: Slot['state'], num = 0, flags: Flag[] = []): Slot => ({ state, num, flags })

export const emptySeries = (): Series => ({
  slots: [slot('missing'), slot('missing'), slot('missing')]
})

export const scalarSeries = (n: number, flags: Flag[] = []): Series => ({
  slots: [slot('ok', n, flags), slot('ok', n, flags), slot('ok', n, flags)]
})

export const seriesValues = (s: Series): number[] =>
  s.slots.filter((x) => x.state === 'ok').map((x) => x.num)

export const coverage = (s: Series) => ({
  filled: s.slots.filter((x) => x.state === 'ok').length,
  total: s.slots.length
})

export const isComplete = (s: Series): boolean => coverage(s).filled === s.slots.length

export const slotIndex = (key: PeriodKey): number => PERIOD_KEYS.indexOf(key)

export const mapSlots = (s: Series, fn: (item: Slot, index: number) => Slot): Series => ({
  slots: s.slots.map(fn)
})

export const firstOkSlot = (s: Series): Slot | null => s.slots.find((x) => x.state === 'ok') ?? null

export const lastOkIndex = (s: Series): number => {
  for (let i = s.slots.length - 1; i >= 0; i -= 1) {
    if (s.slots[i].state === 'ok') return i
  }
  return -1
}
