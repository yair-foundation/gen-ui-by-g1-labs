/**
 * Showtimes: pure helpers. Intl only, no date library.
 *
 * Dates are 'YYYY-MM-DD' and times 'HH:mm', both wall-clock at the venue.
 * They are formatted as calendar values (in UTC), so the viewer's own
 * timezone never shifts them.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

/** 'YYYY-MM-DD' (or the date part of an ISO string) if it's a real date. */
export function normalizeDate(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "")
  if (!m) return null
  const back = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toISOString()
    .slice(0, 10)
  return back === `${m[1]}-${m[2]}-${m[3]}` ? back : null
}

function dateToUtc(key: string): number {
  return Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10), 12)
}

const cache = new Map<string, Intl.DateTimeFormat>()
function fmt(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = cache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" })
    cache.set(key, f)
  }
  return f
}

/**
 * A date for display: 'weekday' → 'Sat', 'day' → '10', 'short' →
 * 'Sat, Oct 10', 'long' → 'Saturday, October 10'.
 */
export function formatDate(
  key: string,
  style: "weekday" | "day" | "short" | "long",
  locale: string = DEFAULT_LOCALE,
): string {
  const options: Intl.DateTimeFormatOptions =
    style === "weekday"
      ? { weekday: "short" }
      : style === "day"
        ? { day: "numeric" }
        : style === "short"
          ? { weekday: "short", month: "short", day: "numeric" }
          : { weekday: "long", month: "long", day: "numeric" }
  return fmt(locale, options).format(dateToUtc(key))
}

/**
 * The header for a run of dates: 'October 2026', 'October – November 2026',
 * or 'December 2026 – January 2027'.
 */
export function monthLabel(
  keys: string[],
  locale: string = DEFAULT_LOCALE,
): string {
  if (keys.length === 0) return ""
  const first = keys[0]
  const last = keys[keys.length - 1]
  const full = fmt(locale, { month: "long", year: "numeric" })
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return full.format(dateToUtc(first))
  }
  if (first.slice(0, 4) === last.slice(0, 4)) {
    const month = fmt(locale, { month: "long" })
    return `${month.format(dateToUtc(first))} – ${full.format(dateToUtc(last))}`
  }
  return `${full.format(dateToUtc(first))} – ${full.format(dateToUtc(last))}`
}

const hhmm = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** 'HH:mm' for display in the locale, e.g. '9:00 PM' or '21:00'. */
export function formatTime(
  time: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const m = hhmm.exec(time.trim())
  if (!m) return time
  return fmt(locale, { hour: "numeric", minute: "2-digit" }).format(
    Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])),
  )
}

/** 'America/Los_Angeles' → 'Los Angeles'. */
export function zoneCity(timeZone: string): string {
  return (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ")
}

/** Up to two initials for a placeholder tile: 'The Long Harbor' → 'TL'. */
export function monogram(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("")
}

/**
 * The src if it is safe to load in an <img>: http(s), or a same-origin path
 * that starts with a single "/". Everything else (javascript:, data:, blob:,
 * protocol-relative URLs) is null.
 */
export function safeImageSrc(src: string | undefined): string | null {
  const value = src?.trim()
  if (!value) return null
  if (/^\/(?![/\\])/.test(value)) return value
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null
  } catch {
    return null
  }
}

/** A price in the currency, or a plain number when the code is missing or invalid. */
export function formatMoney(
  amount: number,
  currency: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      }).format(amount)
    } catch {
      // Invalid currency code: fall through.
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    amount,
  )
}

/** Consecutive pages of `size` items. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/**
 * The next index for a radio group key press (arrows wrap; Home and End),
 * or null for other keys.
 */
export function nextIndex(
  key: string,
  current: number,
  length: number,
): number | null {
  if (length === 0) return null
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (current + 1) % length
    case "ArrowLeft":
    case "ArrowUp":
      return (current - 1 + length) % length
    case "Home":
      return 0
    case "End":
      return length - 1
    default:
      return null
  }
}

/** Clamps the quantity settings into a sane range. */
export function quantityRange(q: {
  min?: number
  max?: number
  default?: number
}): { min: number; max: number; initial: number } {
  const min = Math.max(1, Math.floor(q.min ?? 1))
  const max = Math.max(min, Math.floor(q.max ?? min))
  const initial = Math.min(max, Math.max(min, Math.floor(q.default ?? min)))
  return { min, max, initial }
}
