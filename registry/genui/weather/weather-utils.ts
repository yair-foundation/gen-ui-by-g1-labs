/**
 * Weather: pure helpers. No React, no DOM, so they can be unit-tested and
 * reused on the server.
 *
 * - Temperature conversion between the payload's units and °C/°F.
 * - Compass points from wind degrees.
 * - Range-bar positioning on the week's min/max scale.
 * - Condition labels and icon keys.
 * - Times and day names in the location's time zone.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export const CONDITIONS = [
  "clear",
  "partly-cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "thunderstorm",
  "snow",
  "sleet",
  "wind",
] as const
export type Condition = (typeof CONDITIONS)[number]

export type Units = "metric" | "imperial"
export type TempUnit = "C" | "F"

export const unitOf = (units: Units | undefined): TempUnit =>
  units === "imperial" ? "F" : "C"

/** Converts a temperature in the payload's units to °C or °F (unrounded). */
export function convertTemp(value: number, from: Units, to: TempUnit): number {
  const source = unitOf(from)
  if (source === to) return value
  return to === "F" ? (value * 9) / 5 + 32 : ((value - 32) * 5) / 9
}

/** Rounded display value; avoids "-0". */
export function displayTemp(value: number, from: Units, to: TempUnit): number {
  const n = Math.round(convertTemp(value, from, to))
  return n === 0 ? 0 : n
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const
const POINT_NAMES: Record<(typeof POINTS)[number], string> = {
  N: "north",
  NE: "northeast",
  E: "east",
  SE: "southeast",
  S: "south",
  SW: "southwest",
  W: "west",
  NW: "northwest",
}

/** 8-point compass for the direction the wind blows from. */
export function compass(deg: number): { short: string; long: string } {
  const norm = ((deg % 360) + 360) % 360
  const point = POINTS[Math.round(norm / 45) % 8]
  return { short: point, long: POINT_NAMES[point] }
}

/**
 * Left offset and width (percent) of a day's bar on the week's scale. Very
 * narrow ranges get a minimum width so they stay visible.
 */
export function rangeBar(
  min: number,
  max: number,
  scaleMin: number,
  scaleMax: number,
  minWidth = 4,
): { left: number; width: number } {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  const span = scaleMax - scaleMin
  if (!(span > 0)) return { left: 0, width: 100 }
  const clamp = (n: number) => Math.min(100, Math.max(0, n))
  let left = clamp(((lo - scaleMin) / span) * 100)
  let width = clamp(((hi - scaleMin) / span) * 100) - left
  if (width < minWidth) {
    width = minWidth
    left = Math.min(left, 100 - minWidth)
  }
  return { left, width }
}

const LABELS: Record<Condition, string> = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  "heavy-rain": "Heavy rain",
  thunderstorm: "Thunderstorms",
  snow: "Snow",
  sleet: "Sleet",
  wind: "Windy",
}

export function conditionLabel(condition: Condition | undefined): string {
  return (condition && LABELS[condition]) ?? "Unknown"
}

export type IconKey =
  | "sun"
  | "moon"
  | "cloud-sun"
  | "cloud-moon"
  | "cloud"
  | "cloud-fog"
  | "cloud-drizzle"
  | "cloud-rain"
  | "cloud-rain-wind"
  | "cloud-lightning"
  | "snowflake"
  | "cloud-hail"
  | "wind"

/** Icon key for a condition; clear and partly cloudy differ by day and night. */
export function conditionIcon(
  condition: Condition | undefined,
  isDay = true,
): IconKey {
  switch (condition) {
    case "clear":
      return isDay ? "sun" : "moon"
    case "partly-cloudy":
      return isDay ? "cloud-sun" : "cloud-moon"
    case "fog":
      return "cloud-fog"
    case "drizzle":
      return "cloud-drizzle"
    case "rain":
      return "cloud-rain"
    case "heavy-rain":
      return "cloud-rain-wind"
    case "thunderstorm":
      return "cloud-lightning"
    case "snow":
      return "snowflake"
    case "sleet":
      return "cloud-hail"
    case "wind":
      return "wind"
    default:
      return "cloud"
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

function toDate(value: string): Date | null {
  const m = DATE_ONLY.exec(value)
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number)
    return new Date(Date.UTC(y, mo - 1, d, 12))
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function fmt(
  value: string,
  options: Intl.DateTimeFormatOptions,
  timeZone: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const date = toDate(value)
  if (!date) return null
  // Calendar dates are noon UTC, so read them in UTC.
  const tz = DATE_ONLY.test(value) ? "UTC" : timeZone
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: tz }).format(
      date,
    )
  } catch {
    return new Intl.DateTimeFormat(locale, options).format(date)
  }
}

/** "2026-11-14" for an instant in a time zone; calendar dates pass through. */
export function localDate(value: string, timeZone?: string): string | null {
  if (DATE_ONLY.test(value)) return value
  const date = toDate(value)
  if (!date) return null
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date)
  } catch {
    parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date)
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** "2 PM" (or "14" style per locale) in the location's time zone. */
export function formatHour(
  value: string,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return fmt(value, { hour: "numeric" }, timeZone, locale) ?? value
}

/** "9:40 AM" in the location's time zone. */
export function formatClock(
  value: string,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return (
    fmt(value, { hour: "numeric", minute: "2-digit" }, timeZone, locale) ??
    value
  )
}

/** "9:40 AM WET" for the header. */
export function formatUpdated(
  value: string,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return (
    fmt(
      value,
      { hour: "numeric", minute: "2-digit", timeZoneName: "short" },
      timeZone,
      locale,
    ) ?? value
  )
}

/** "Sat 6 PM" for alert windows. */
export function formatDayTime(
  value: string,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return (
    fmt(
      value,
      { weekday: "short", hour: "numeric", minute: "2-digit" },
      timeZone,
      locale,
    ) ?? value
  )
}

/** "Today", "Tomorrow" or the weekday, relative to `asOf` in the time zone. */
export function dayName(
  date: string,
  asOf: string | undefined,
  timeZone?: string,
  {
    locale = DEFAULT_LOCALE,
    style = "short",
    tomorrow = true,
  }: { locale?: string; style?: "short" | "long"; tomorrow?: boolean } = {},
): string {
  const today = asOf ? localDate(asOf, timeZone) : null
  const day = localDate(date, timeZone)
  if (today && day) {
    const diff = Math.round(
      (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    )
    if (diff === 0) return "Today"
    if (diff === 1 && tomorrow) return "Tomorrow"
  }
  return fmt(date, { weekday: style }, timeZone, locale) ?? date
}

/** True when both instants fall in the same local hour. */
export function sameHour(a: string, b: string, timeZone?: string): boolean {
  const da = toDate(a)
  const db = toDate(b)
  if (!da || !db) return false
  const key = (d: Date) => {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        hourCycle: "h23",
      }).format(d)
    } catch {
      return d.toISOString().slice(0, 13)
    }
  }
  return key(da) === key(db)
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
