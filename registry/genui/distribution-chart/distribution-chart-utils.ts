/* Pure helpers for the distribution chart, shared by the component and its tests. */

import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type { DistributionMeasure } from "./distribution-chart.schema"

/** Numbers, or numeric strings, become numbers; anything else is missing. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * The decimal places the data itself uses (at most 2), so computed figures
 * like a median of 27.3 and 27.4 read as 27.4, not 27.35.
 */
export function precisionOf(values: readonly number[]): number {
  let digits = 0
  for (const v of values) {
    const text = String(v)
    const dot = text.indexOf(".")
    if (dot >= 0 && !text.includes("e")) digits = Math.max(digits, text.length - dot - 1)
    if (digits >= 2) return 2
  }
  return digits
}

/** A value in the measure's format: compact on the axis, in full elsewhere. */
export function formatMeasure(
  value: number | null | undefined,
  measure: Partial<Pick<DistributionMeasure, "format" | "currency" | "unit">> | undefined,
  style: "axis" | "full",
  /** Decimal places for full values; defaults to up to 2. */
  digits?: number,
  locale: string = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "No data"
  const compact: Intl.NumberFormatOptions =
    style === "axis" ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 } : {}
  if (measure?.format === "currency" && measure.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: measure.currency,
        maximumFractionDigits: digits ?? (Number.isInteger(value) ? 0 : 2),
        ...compact,
      }).format(value)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  if (measure?.format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: style === "axis" ? 0 : (digits ?? 1),
    }).format(value / 100)
  }
  const text = new Intl.NumberFormat(locale, {
    maximumFractionDigits: digits ?? 2,
    ...compact,
  }).format(value)
  return measure?.unit && style === "full" ? `${text} ${measure.unit}` : text
}

/** The p-quantile of sorted values, interpolating between neighbours. */
export function quantile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export type Summary = {
  n: number
  min: number
  max: number
  q1: number
  median: number
  q3: number
  mean: number
  /** Whisker ends: the furthest values within 1.5 × IQR of the box. */
  low: number
  high: number
  /** Values beyond the whiskers. */
  outliers: number[]
}

/** Five-number summary with Tukey whiskers. Null for an empty set. */
export function summarize(values: readonly number[]): Summary | null {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const q1 = quantile(s, 0.25)
  const q3 = quantile(s, 0.75)
  const fence = 1.5 * (q3 - q1)
  const inside = s.filter((v) => v >= q1 - fence && v <= q3 + fence)
  return {
    n: s.length,
    min: s[0],
    max: s[s.length - 1],
    q1,
    median: quantile(s, 0.5),
    q3,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    low: inside[0] ?? s[0],
    high: inside[inside.length - 1] ?? s[s.length - 1],
    outliers: s.filter((v) => v < q1 - fence || v > q3 + fence),
  }
}

/** A "nice" step near `raw`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}

/** Round tick values covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const step = niceStep((max - min) / Math.max(1, count))
  const first = Math.floor(min / step + 1e-9)
  const last = Math.ceil(max / step - 1e-9)
  const ticks: number[] = []
  for (let k = first; k <= last; k++) ticks.push(Number((k * step).toPrecision(12)))
  return ticks
}

export type Bins = { start: number; width: number; counts: number[] }

/**
 * Histogram bins with a nice width. Without a requested count, Sturges'
 * rule picks one (about log2(n) + 1), kept between 5 and 30. Bins start on a
 * multiple of the width, so edges read as round numbers.
 */
export function makeBins(values: readonly number[], requested?: number): Bins {
  if (values.length === 0) return { start: 0, width: 1, counts: [] }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const target = requested ?? Math.min(30, Math.max(5, Math.ceil(Math.log2(values.length) + 1)))
  const width = max > min ? niceStep((max - min) / target) : 1
  const start = Math.floor(min / width) * width
  const n = Math.max(1, Math.floor((max - start) / width) + 1)
  const counts = new Array<number>(n).fill(0)
  for (const v of values) {
    counts[Math.min(n - 1, Math.floor((v - start) / width + 1e-9))]++
  }
  return { start: Number(start.toPrecision(12)), width, counts }
}

/** Groups in first-seen order, at most `max`; values of later groups are dropped. */
export function splitGroups<T>(
  items: readonly T[],
  groupOf: (item: T) => string | undefined,
  max = 6,
): { groups: { name: string; items: T[] }[]; hidden: number } {
  const order: string[] = []
  const byName = new Map<string, T[]>()
  for (const item of items) {
    const g = groupOf(item) ?? ""
    if (!byName.has(g)) {
      byName.set(g, [])
      order.push(g)
    }
    byName.get(g)?.push(item)
  }
  return {
    groups: order.slice(0, max).map((name) => ({ name, items: byName.get(name) ?? [] })),
    hidden: Math.max(0, order.length - max),
  }
}

/**
 * A dot plot's layout: values fall into columns `columnWidth` wide (in value
 * units) and stack from the centre line outwards, alternating above and
 * below. Returns each value's column centre and its stack offset (0, 1, -1,
 * 2, -2, …), and the tallest stack.
 */
export function stackDots(
  values: readonly number[],
  start: number,
  columnWidth: number,
): { positions: { x: number; offset: number }[]; tallest: number } {
  const counts = new Map<number, number>()
  let tallest = 0
  const positions = values.map((v) => {
    const col = Math.floor((v - start) / columnWidth + 1e-9)
    const k = counts.get(col) ?? 0
    counts.set(col, k + 1)
    tallest = Math.max(tallest, k + 1)
    const offset = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2
    return { x: start + (col + 0.5) * columnWidth, offset }
  })
  return { positions, tallest }
}
