/**
 * Stock Quote: pure helpers. No React, no DOM, so they can be unit-tested and
 * reused on the server.
 *
 * - OHLC extents (period high/low and where they happen) and the y domain.
 * - Axis ticks and labels that depend on the range (hours, days, months, years).
 * - Signed percent and currency formatting.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export const RANGE_KEYS = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y"] as const
export type RangeKey = (typeof RANGE_KEYS)[number]

export const RANGE_LABELS: Record<RangeKey, string> = {
  "1D": "Past day",
  "5D": "Past 5 days",
  "1M": "Past month",
  "6M": "Past 6 months",
  YTD: "Year to date",
  "1Y": "Past year",
  "5Y": "Past 5 years",
}

/** One point. `o`, `h` and `l` are optional for sources with one price per point. */
export type CandleLike = {
  t: string
  o?: number
  h?: number
  l?: number
  c: number
  v?: number
}

export type FormatOptions = { locale?: string; timeZone?: string }

export type Direction = "up" | "down" | "flat"

const isNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n)

/** A usable point: an ISO time and a finite close. */
export function isPoint(c: Partial<CandleLike> | undefined): c is CandleLike {
  return !!c && typeof c.t === "string" && isNum(c.c)
}

/** A full candle: open, high, low and close all present and consistent. */
export function isOhlc(c: Partial<CandleLike> | undefined): boolean {
  return (
    isPoint(c) &&
    isNum(c.o) &&
    isNum(c.h) &&
    isNum(c.l) &&
    c.h >= c.l &&
    c.h >= Math.max(c.o, c.c) &&
    c.l <= Math.min(c.o, c.c)
  )
}

/** Candles when at least two full candles exist, otherwise a line. */
export function defaultView(candles: CandleLike[]): "candles" | "line" {
  return candles.filter(isOhlc).length >= 2 ? "candles" : "line"
}

export const highOf = (c: CandleLike) => (isNum(c.h) ? c.h : c.c)
export const lowOf = (c: CandleLike) => (isNum(c.l) ? c.l : c.c)

export type Extents = {
  min: number
  max: number
  /** Index of the first candle that reaches the period high. */
  highIndex: number
  /** Index of the first candle that reaches the period low. */
  lowIndex: number
}

/** Period high and low, using highs and lows when present, closes otherwise. */
export function ohlcExtents(candles: CandleLike[]): Extents | null {
  let out: Extents | null = null
  candles.forEach((c, i) => {
    if (!isPoint(c)) return
    const h = highOf(c)
    const l = lowOf(c)
    if (!out) {
      out = { min: l, max: h, highIndex: i, lowIndex: i }
      return
    }
    if (h > out.max) {
      out.max = h
      out.highIndex = i
    }
    if (l < out.min) {
      out.min = l
      out.lowIndex = i
    }
  })
  return out
}

/**
 * Y-axis domain: the extents plus the reference price, padded so the high/low
 * callouts fit above and below the candles.
 */
export function yDomain(
  candles: CandleLike[],
  reference?: number,
  pad = 0.14,
): [number, number] | null {
  const ext = ohlcExtents(candles)
  if (!ext) return null
  let min = ext.min
  let max = ext.max
  if (isNum(reference)) {
    min = Math.min(min, reference)
    max = Math.max(max, reference)
  }
  const span = max - min || Math.abs(max) * 0.02 || 1
  return [min - span * pad, max + span * pad]
}

/** Parses an ISO date or date-time. Date-only values are calendar dates (UTC). */
export function parseInstant(
  t: string | undefined,
): { date: Date; dateOnly: boolean } | null {
  if (typeof t !== "string") return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number)
    const date = new Date(Date.UTC(y, m - 1, d))
    return date.getUTCMonth() === m - 1 && date.getUTCDate() === d
      ? { date, dateOnly: true }
      : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return null
  const date = new Date(t)
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false }
}

function format(
  t: string,
  options: Intl.DateTimeFormatOptions,
  { locale = DEFAULT_LOCALE, timeZone }: FormatOptions,
): string {
  const parsed = parseInstant(t)
  if (!parsed) return t
  try {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: parsed.dateOnly ? "UTC" : timeZone,
    }).format(parsed.date)
  } catch {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: parsed.dateOnly ? "UTC" : undefined,
    }).format(parsed.date)
  }
}

/** Short x-axis label for the range: hours, weekdays, days, months or years. */
export function formatTick(
  t: string,
  range: RangeKey,
  opts: FormatOptions = {},
): string {
  switch (range) {
    case "1D":
      return format(t, { hour: "numeric" }, opts)
    case "5D":
      return format(t, { weekday: "short" }, opts)
    case "1M":
      return format(t, { month: "short", day: "numeric" }, opts)
    case "5Y":
      return format(t, { year: "numeric" }, opts)
    default:
      return format(t, { month: "short" }, opts)
  }
}

/** Full label for a point, used in the tooltip, live region and data table. */
export function formatPointLabel(
  t: string,
  range: RangeKey,
  opts: FormatOptions = {},
): string {
  const intraday = range === "1D" || range === "5D"
  const parsed = parseInstant(t)
  if (intraday && parsed && !parsed.dateOnly) {
    return format(
      t,
      range === "1D"
        ? { hour: "numeric", minute: "2-digit" }
        : { weekday: "short", hour: "numeric", minute: "2-digit" },
      opts,
    )
  }
  return format(t, { month: "short", day: "numeric", year: "numeric" }, opts)
}

/** "Oct 7, 4:00 PM EDT" for the footer; date-only values show the date. */
export function formatAsOf(t: string, opts: FormatOptions = {}): string {
  const parsed = parseInstant(t)
  if (!parsed) return t
  if (parsed.dateOnly) {
    return format(t, { month: "short", day: "numeric", year: "numeric" }, opts)
  }
  return format(
    t,
    {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    },
    opts,
  )
}

/** Calendar parts of an instant in a time zone (UTC for date-only values). */
function partsOf(t: string, timeZone?: string) {
  const parsed = parseInstant(t)
  if (!parsed) return null
  let fmt: Intl.DateTimeFormat
  try {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: parsed.dateOnly ? "UTC" : timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    })
  } catch {
    fmt = new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      hourCycle: "h23",
    })
  }
  const get = (type: string) =>
    Number(fmt.formatToParts(parsed.date).find((p) => p.type === type)?.value)
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") }
}

/** The period a point belongs to, for placing one tick per period. */
function periodKey(t: string, range: RangeKey, timeZone?: string) {
  const p = partsOf(t, timeZone)
  if (!p) return null
  switch (range) {
    case "1D":
      return `${p.y}-${p.m}-${p.d}-${p.h}`
    case "5D":
      return `${p.y}-${p.m}-${p.d}`
    case "1M": {
      // Weeks starting Monday: 1970-01-01 was a Thursday.
      const days = Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86_400_000)
      return `w${Math.floor((days + 3) / 7)}`
    }
    case "5Y":
      return `${p.y}`
    default:
      return `${p.y}-${p.m}`
  }
}

/**
 * Indices of the first point in each period (hour, day, week, month or year),
 * so ticks land on boundaries instead of repeating labels.
 */
export function tickIndices(
  candles: CandleLike[],
  range: RangeKey,
  timeZone?: string,
): number[] {
  const out: number[] = []
  let last: string | null = null
  candles.forEach((c, i) => {
    const key = periodKey(c.t, range, timeZone)
    if (key !== null && key !== last) out.push(i)
    last = key
  })
  return out
}

export function direction(n: number | undefined): Direction {
  if (!isNum(n) || n === 0) return "flat"
  return n > 0 ? "up" : "down"
}

/** 1.234 → "+1.23%". Takes percent points, like the schema. */
export function formatPercent(
  value: number,
  {
    locale = DEFAULT_LOCALE,
    signed = true,
  }: { locale?: string; signed?: boolean } = {},
): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: signed ? "exceptZero" : "auto",
  }).format(value / 100)
}

/** Currency with sensible precision; falls back to a plain number for bad codes. */
export function formatMoney(
  value: number,
  currency = "USD",
  {
    locale = DEFAULT_LOCALE,
    signed = false,
    compact = false,
  }: { locale?: string; signed?: boolean; compact?: boolean } = {},
): string {
  const abs = Math.abs(value)
  const digits = compact ? undefined : abs !== 0 && abs < 1 ? 4 : 2
  const options: Intl.NumberFormatOptions = compact
    ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
    : { minimumFractionDigits: digits, maximumFractionDigits: digits }
  const signDisplay = signed ? "exceptZero" : "auto"
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      signDisplay,
      ...options,
    }).format(value)
  } catch {
    return new Intl.NumberFormat(locale, { signDisplay, ...options }).format(
      value,
    )
  }
}

/** 1_234_000 → "1.2M". */
export function formatVolume(
  value: number,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

/** Change across the range: first open (or close) to last close. */
export function rangeChange(
  candles: CandleLike[],
): { change: number; percent: number } | null {
  const points = candles.filter(isPoint)
  if (points.length < 2) return null
  const first = points[0]
  const start = isNum(first.o) ? first.o : first.c
  const end = points[points.length - 1].c
  if (start === 0) return null
  const change = end - start
  return { change, percent: (change / Math.abs(start)) * 100 }
}

const GENERIC = new Set(["inc", "corp", "co", "ltd", "plc", "the", "etf", "&"])

/** Two-letter monogram from the name's first words, else the symbol. */
export function monogram(name: string | undefined, symbol?: string): string {
  const words = (name ?? "")
    .split(/[\s.,-]+/)
    .filter((w) => w && !GENERIC.has(w.toLowerCase()))
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  const base = words[0] ?? symbol ?? ""
  return base.slice(0, 2).toUpperCase()
}

/** Ranges in canonical order, de-duplicated by key. */
export function sortRanges<T extends { key?: RangeKey }>(
  ranges: T[],
): (T & { key: RangeKey })[] {
  const seen = new Set<RangeKey>()
  return ranges
    .filter((r): r is T & { key: RangeKey } => {
      if (!r.key || !RANGE_KEYS.includes(r.key) || seen.has(r.key)) return false
      seen.add(r.key)
      return true
    })
    .sort((a, b) => RANGE_KEYS.indexOf(a.key) - RANGE_KEYS.indexOf(b.key))
}

/** http(s) URLs only. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}
