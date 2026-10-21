/* Pure helpers for the scatter plot, shared by the component and its tests. */

import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type { ScatterMeasure } from "./scatter-plot.schema"

/** Numbers, or numeric strings, become numbers; anything else is missing. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** A value in a measure's format: compact on the axes, in full elsewhere. */
export function formatMeasure(
  value: number | null | undefined,
  measure: Partial<Pick<ScatterMeasure, "format" | "currency" | "unit">> | undefined,
  style: "axis" | "full",
  locale: string = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined) return "No data"
  const compact: Intl.NumberFormatOptions =
    style === "axis" ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 } : {}
  if (measure?.format === "currency" && measure.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: measure.currency,
        ...(Number.isInteger(value) ? { maximumFractionDigits: 0 } : {}),
        ...compact,
      }).format(value)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  if (measure?.format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: style === "axis" ? 0 : 1,
    }).format(value / 100)
  }
  const text = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    ...compact,
  }).format(value)
  return measure?.unit && style === "full" ? `${text} ${measure.unit}` : text
}

/**
 * Groups with their own colour. Any two groups in a scatter can touch, and
 * only the first three categorical colours stay distinct for every pair
 * (see series-colors), so a fourth group and beyond share a neutral "Other".
 */
export const MAX_GROUPS = 3
export const OTHER = "Other"

/**
 * Groups in first-seen order. Up to three keep their own slot; with more, the
 * first three keep theirs and the rest fold into "Other" (a fourth slot), so
 * a slot (its colour and shape) never changes as more rows stream in.
 */
export function groupSlots(values: readonly string[]): {
  groups: string[]
  slotOf: (value: string) => number
} {
  const seen = [...new Set(values)]
  if (seen.length <= MAX_GROUPS) {
    return { groups: seen, slotOf: (v) => Math.max(0, seen.indexOf(v)) }
  }
  const kept = seen.slice(0, MAX_GROUPS)
  return {
    groups: [...kept, OTHER],
    slotOf: (v) => {
      const i = kept.indexOf(v)
      return i === -1 ? MAX_GROUPS : i
    },
  }
}

export type Fit = { slope: number; intercept: number; r: number }

/**
 * Least-squares line and Pearson's r. Null with fewer than 3 points or when
 * either measure doesn't vary (no line to draw).
 */
export function linearFit(points: readonly { x: number; y: number }[]): Fit | null {
  const n = points.length
  if (n < 3) return null
  let sx = 0
  let sy = 0
  for (const p of points) {
    sx += p.x
    sy += p.y
  }
  const mx = sx / n
  const my = sy / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of points) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
  }
  if (sxx === 0 || syy === 0) return null
  const slope = sxy / sxx
  return { slope, intercept: my - slope * mx, r: sxy / Math.sqrt(sxx * syy) }
}

/** How strongly two measures move together, in words, from Pearson's r. */
export function describeCorrelation(r: number): string {
  const a = Math.abs(r)
  const strength =
    a >= 0.7 ? "Strong" : a >= 0.4 ? "Moderate" : a >= 0.2 ? "Weak" : "No clear"
  if (strength === "No clear") return "No clear relationship"
  return `${strength} ${r > 0 ? "positive" : "negative"}`
}
