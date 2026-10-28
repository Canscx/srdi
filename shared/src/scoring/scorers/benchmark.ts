export interface CurveSpec {
  base: number
  kUp: number
  kDown: number
}

export interface BenchmarkResult {
  s: number
  delta: number
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export const mapBenchmarkCurve = (
  x: number,
  benchmark: number,
  curve: CurveSpec,
  direction: 'positive' | 'negative'
): BenchmarkResult => {
  if (!(benchmark > 0)) return { s: 0, delta: 0 }

  const delta = direction === 'positive'
    ? (x - benchmark) / benchmark
    : (benchmark - x) / benchmark

  if (delta > 0) {
    return { s: clamp01(curve.base + (1 - curve.base) * Math.min(delta / curve.kUp, 1)), delta }
  }

  return { s: clamp01(curve.base * (1 + delta / curve.kDown)), delta }
}
