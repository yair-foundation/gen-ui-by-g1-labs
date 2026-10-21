/* Pure helpers for the usage chart, shared by the component and its tests. */

import { DEFAULT_LOCALE, formatRangeWithDash } from "@/components/genui/locale"
import type { UsageStat, UsageValue } from "./usage-chart.schema"

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
 * The UTC midnight of a date written "YYYY-MM-DD" (a time after it is
 * ignored), so a day never slips to its neighbour in another time zone.
 */
export function parseDay(value: unknown): number | null {
  if (typeof value !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = Date.UTC(y, mo - 1, d)
  const back = new Date(t)
  // Reject 2026-02-31, which Date.UTC would roll into March.
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d
    ? t
    : null
}

export type UsagePoint = {
  /** UTC midnight of the day. */
  t: number
  value: number
  /** The overlay's value; null when the row has none. */
  overlay: number | null
  row: Record<string, string | number>
}

/**
 * One point per day in date order. Rows without a valid date or value are
 * dropped; a repeated day keeps the last row. The overlay is clamped to the
 * value, since it is a part of it.
 */
export function buildPoints(
  rows: readonly Record<string, string | number>[],
  dateKey: string | undefined,
  valueKey: string | undefined,
  overlayKey?: string,
): UsagePoint[] {
  if (!dateKey || !valueKey) return []
  const byDay = new Map<number, UsagePoint>()
  for (const row of rows) {
    const t = parseDay(row?.[dateKey])
    const value = toNumber(row?.[valueKey])
    if (t === null || value === null) continue
    const raw = overlayKey ? toNumber(row[overlayKey]) : null
    byDay.set(t, {
      t,
      value,
      overlay: raw === null ? null : Math.min(Math.max(raw, 0), Math.max(value, 0)),
      row,
    })
  }
  return [...byDay.values()].sort((a, b) => a.t - b.t)
}

/**
 * A stepped line across equal-width bands: each point holds its value across
 * its band, so a day reads as a flat run, not a point joined by slopes. With
 * `closeTo` the path closes down to that y for an area fill.
 */
export function stepPath(
  values: readonly number[],
  x0: number,
  band: number,
  y: (v: number) => number,
  closeTo?: number,
): string {
  if (!values.length) return ""
  let d = `M${x0} ${y(values[0])}`
  values.forEach((v, i) => {
    const x1 = x0 + (i + 1) * band
    d += `${i > 0 ? `V${y(v)}` : ""}H${x1}`
  })
  if (closeTo !== undefined) d += `V${closeTo}H${x0}Z`
  return d
}

/** The statistic over the first `upTo + 1` points; null when none has the field. */
export function rangeStat(
  points: readonly UsagePoint[],
  upTo: number,
  stat: Pick<UsageStat, "key" | "op">,
): number | null {
  const values: number[] = []
  for (const p of points.slice(0, upTo + 1)) {
    const v = toNumber(p.row[stat.key])
    if (v !== null) values.push(v)
  }
  if (!values.length) return null
  switch (stat.op) {
    case "sum":
      return values.reduce((a, b) => a + b, 0)
    case "average":
      return values.reduce((a, b) => a + b, 0) / values.length
    case "max":
      return Math.max(...values)
    case "min":
      return Math.min(...values)
    case "latest":
      return values[values.length - 1]
  }
}

/** The band a pointer at `x` is over, clamped to the plot. */
export function indexAt(x: number, x0: number, band: number, count: number): number {
  if (count <= 0 || !(band > 0)) return 0
  return Math.min(count - 1, Math.max(0, Math.floor((x - x0) / band)))
}

type Format = Partial<Pick<UsageValue, "format" | "currency" | "unit">>

/**
 * A figure in its format. Four digits and up are abbreviated (511.2K, 439.19M),
 * except money under 100,000, which stays exact; whole money drops its cents.
 * Compact currency sets its minimum decimals (Node and Chrome disagree
 * otherwise).
 */
export function formatUsage(
  value: number | null | undefined,
  fmt: Format | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—"
  const big = Math.abs(value) >= 10_000
  if (fmt?.format === "currency" && fmt.currency) {
    try {
      const compact = Math.abs(value) >= 100_000
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: fmt.currency,
        ...(compact
          ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 2 }
          : Number.isInteger(value)
            ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
            : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      }).format(value)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  const text = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
    ...(big ? { notation: "compact", minimumFractionDigits: 0 } : {}),
  }).format(value)
  return fmt?.unit ? `${text} ${fmt.unit}` : text
}

/** "Tue 22 Sep": a day in the host's locale, always read in UTC. */
export function formatDay(t: number, locale: string = DEFAULT_LOCALE): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(t)
  } catch {
    return new Date(t).toISOString().slice(0, 10)
  }
}

/**
 * "27 Jun – 22 Sep" for a period; one day alone when both ends match. The year
 * shows only when the period crosses one.
 */
export function formatPeriod(a: number, b: number, locale: string = DEFAULT_LOCALE): string {
  const crossesYear = new Date(a).getUTCFullYear() !== new Date(b).getUTCFullYear()
  try {
    const fmt = new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      ...(crossesYear ? { year: "numeric" } : {}),
      timeZone: "UTC",
    })
    return a === b ? fmt.format(a) : formatRangeWithDash(fmt, new Date(a), new Date(b))
  } catch {
    return `${new Date(a).toISOString().slice(0, 10)} – ${new Date(b).toISOString().slice(0, 10)}`
  }
}
