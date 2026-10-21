/* Pure helpers for the composition chart, shared by the component and its tests. */

import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type { CompositionValue } from "./composition-chart.schema"

/** Numbers, or numeric strings, become numbers; anything else is missing. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** An amount in the value's format. */
export function formatAmount(
  value: number,
  measure: Partial<Pick<CompositionValue, "format" | "currency" | "unit">> | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(value)) return "No data"
  if (measure?.format === "currency" && measure.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: measure.currency,
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
      }).format(value)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  if (measure?.format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value / 100)
  }
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)
  return measure?.unit ? `${text} ${measure.unit}` : text
}

/** A share as a whole-number percent, or one decimal under 1%. */
export function formatShare(part: number, whole: number, locale: string = DEFAULT_LOCALE): string {
  const share = whole > 0 ? part / whole : 0
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: share > 0 && share < 0.01 ? 1 : 0,
  }).format(share)
}

export const OTHER = "Other"

export type Part = { label: string; total: number; other?: boolean; remainder?: boolean }

/**
 * Parts ordered largest first, by their total across all groups. With `keep`,
 * parts past that many fold into one "Other" (only when that saves at least
 * two parts' worth of room: folding a single part just renames it).
 * Negative and missing amounts count as zero.
 */
export function rankParts(
  totals: ReadonlyMap<string, number>,
  keep?: number,
): { parts: Part[]; partOf: (label: string) => number } {
  const sorted = [...totals.entries()]
    .map(([label, total]) => ({ label, total: Math.max(0, total) }))
    .sort((a, b) => b.total - a.total)
  if (keep === undefined || sorted.length <= keep + 1) {
    const index = new Map(sorted.map((p, i) => [p.label, i]))
    return { parts: sorted, partOf: (l) => index.get(l) ?? -1 }
  }
  const kept = sorted.slice(0, keep)
  const rest = sorted.slice(keep).reduce((sum, p) => sum + p.total, 0)
  const index = new Map(kept.map((p, i) => [p.label, i]))
  return {
    parts: [...kept, { label: OTHER, total: rest, other: true }],
    partOf: (l) => index.get(l) ?? keep,
  }
}

/**
 * Whole squares per part out of `cells` (100 for a waffle), by largest
 * remainder, so they always add up to exactly `cells`.
 */
export function waffleCounts(values: readonly number[], cells = 100): number[] {
  const sum = values.reduce((a, b) => a + Math.max(0, b), 0)
  if (sum <= 0) return values.map(() => 0)
  const exact = values.map((v) => (Math.max(0, v) / sum) * cells)
  const counts = exact.map(Math.floor)
  let left = cells - counts.reduce((a, b) => a + b, 0)
  const order = exact
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .sort((a, b) => b.r - a.r)
  for (const { i } of order) {
    if (left <= 0) break
    counts[i]++
    left--
  }
  return counts
}

export type Rect = { x: number; y: number; w: number; h: number; index: number }

/**
 * Squarified treemap (Bruls, Huizing and van Wijk): lays values, largest
 * first, into rows along the shorter side so tiles stay close to square.
 * Returns one rect per positive value, tagged with its index.
 */
export function squarify(values: readonly number[], width: number, height: number): Rect[] {
  const items = values
    .map((v, index) => ({ v: Math.max(0, v), index }))
    .filter((d) => d.v > 0)
    .sort((a, b) => b.v - a.v)
  const total = items.reduce((a, d) => a + d.v, 0)
  if (!total || width <= 0 || height <= 0) return []
  const scale = (width * height) / total
  const areas = items.map((d) => ({ a: d.v * scale, index: d.index }))
  const out: Rect[] = []
  let x = 0
  let y = 0
  let w = width
  let h = height
  const worst = (row: number[], side: number) => {
    const s = row.reduce((a, b) => a + b, 0)
    const max = Math.max(...row)
    const min = Math.min(...row)
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min))
  }
  let i = 0
  while (i < areas.length) {
    const side = Math.min(w, h)
    const row = [areas[i]]
    let j = i + 1
    while (
      j < areas.length &&
      worst([...row.map((r) => r.a), areas[j].a], side) <= worst(row.map((r) => r.a), side)
    ) {
      row.push(areas[j])
      j++
    }
    const s = row.reduce((a, r) => a + r.a, 0)
    if (w >= h) {
      // A column on the left, as wide as the row needs.
      const cw = s / h
      let cy = y
      for (const r of row) {
        const rh = r.a / cw
        out.push({ x, y: cy, w: cw, h: rh, index: r.index })
        cy += rh
      }
      x += cw
      w -= cw
    } else {
      // A row along the top.
      const rh = s / w
      let cx = x
      for (const r of row) {
        const rw = r.a / rh
        out.push({ x: cx, y, w: rw, h: rh, index: r.index })
        cx += rw
      }
      y += rh
      h -= rh
    }
    i = j
  }
  return out
}

/** Start and end angles (radians, clockwise from 12 o'clock) for each share. */
export function arcAngles(values: readonly number[]): { start: number; end: number }[] {
  const sum = values.reduce((a, b) => a + Math.max(0, b), 0)
  let angle = 0
  return values.map((v) => {
    const sweep = sum > 0 ? (Math.max(0, v) / sum) * Math.PI * 2 : 0
    const arc = { start: angle, end: angle + sweep }
    angle += sweep
    return arc
  })
}

/**
 * A donut slice path between radii `r0` and `r1`, with a gap of `gap` px
 * kept between neighbouring slices (trimmed off both ends of the slice).
 */
export function donutSlice(
  cx: number,
  cy: number,
  r0: number,
  r1: number,
  start: number,
  end: number,
  gap = 2,
): string {
  const full = end - start >= Math.PI * 2 - 1e-6
  const trim1 = full ? 0 : gap / 2 / r1
  const trim0 = full ? 0 : gap / 2 / r0
  const a0 = start + trim1
  const a1 = end - trim1
  const b0 = start + trim0
  const b1 = end - trim0
  if (a1 <= a0 || b1 <= b0) return ""
  const pt = (r: number, a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`
  if (full) {
    // Two half arcs per ring: one arc can't draw a full circle.
    return `M${pt(r1, 0)}A${r1} ${r1} 0 1 1 ${pt(r1, Math.PI)}A${r1} ${r1} 0 1 1 ${pt(r1, 0)}ZM${pt(r0, 0)}A${r0} ${r0} 0 1 0 ${pt(r0, Math.PI)}A${r0} ${r0} 0 1 0 ${pt(r0, 0)}Z`
  }
  const large1 = a1 - a0 > Math.PI ? 1 : 0
  const large0 = b1 - b0 > Math.PI ? 1 : 0
  return `M${pt(r1, a0)}A${r1} ${r1} 0 ${large1} 1 ${pt(r1, a1)}L${pt(r0, b1)}A${r0} ${r0} 0 ${large0} 0 ${pt(r0, b0)}Z`
}
