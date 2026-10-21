/**
 * World Clock: pure time logic. Intl only, no date library.
 *
 * Every function takes an instant (milliseconds since the epoch) and an IANA
 * timezone, so offsets are always the ones in effect at that instant and DST
 * changes come out right.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type Interval = { start: number; end: number }

export const MINUTE = 60_000
export const HOUR = 3_600_000

/* ------------------------------------------------------------------------ */
/* Timezones                                                                */
/* ------------------------------------------------------------------------ */

/** Whether the runtime knows this IANA timezone. */
export function isValidTimeZone(timeZone: string | undefined): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string) {
  let f = partsCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    partsCache.set(timeZone, f)
  }
  return f
}

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
}

/** Wall-clock fields of an instant in a timezone. */
export function zonedParts(t: number, timeZone: string): ZonedParts {
  const out: ZonedParts = {
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
    weekday: 0,
  }
  for (const p of partsFormatter(timeZone).formatToParts(t)) {
    if (p.type === "weekday") out.weekday = WEEKDAYS[p.value] ?? 0
    else if (p.type in out) out[p.type as keyof ZonedParts] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

/** Offset from UTC in minutes at an instant, e.g. -240 for New York in summer. */
export function offsetMinutes(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / MINUTE)
}

/**
 * How far ahead `toZone` is of `fromZone` at an instant, in minutes.
 * Positive when `toZone` is ahead, e.g. +420 from New York to Tel Aviv.
 */
export function offsetBetween(
  t: number,
  fromZone: string,
  toZone: string,
): number {
  return offsetMinutes(t, toZone) - offsetMinutes(t, fromZone)
}

/** An offset for display: '+7 h', '−4 h', '+5 h 30 min', 'Same time'. */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return "Same time"
  const sign = minutes > 0 ? "+" : "−"
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${sign}${[h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ")}`
}

/**
 * A compact offset for the line under a clock face: '+16 h', '−3 h',
 * '+5:30 h', '−9:30 h', '+0 h'.
 */
export function formatShortOffset(minutes: number): string {
  const sign = minutes < 0 ? "−" : "+"
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `${sign}${m ? `${h}:${String(m).padStart(2, "0")}` : h} h`
}

/** The same offset, spelled out for screen readers. */
export function spokenOffset(minutes: number): string {
  if (minutes === 0) return "same time"
  const abs = Math.abs(minutes)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  const parts = [
    h ? `${h} ${h === 1 ? "hour" : "hours"}` : "",
    m ? `${m} minutes` : "",
  ].filter(Boolean)
  return `${parts.join(" ")} ${minutes > 0 ? "ahead" : "behind"}`
}

/** The instant a wall-clock time happens in a timezone. */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const first = offsetMinutes(guess, timeZone)
  let t = guess - first * MINUTE
  // Near a DST change the offset at the guess can differ from the real one.
  const second = offsetMinutes(t, timeZone)
  if (second !== first) t = guess - second * MINUTE
  return t
}

/* ------------------------------------------------------------------------ */
/* Clock faces                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Hand angles in degrees, clockwise from 12. `ms` adds the fraction of the
 * current second so the second hand can sweep smoothly.
 */
export function handAngles(
  parts: Pick<ZonedParts, "hour" | "minute" | "second">,
  ms = 0,
): { hour: number; minute: number; second: number } {
  const seconds = parts.second + ms / 1000
  const minutes = parts.minute + seconds / 60
  return {
    second: seconds * 6,
    minute: minutes * 6,
    hour: ((parts.hour % 12) + minutes / 60) * 30,
  }
}

/** Daytime (06:00–17:59 local), for the sun or moon hint. */
export function isDaytime(hour: number): boolean {
  return hour >= 6 && hour < 18
}

export type FaceTone = "day" | "night"

/** A light face for daytime in that zone, a dark one for night. */
export function faceTone(hour: number): FaceTone {
  return isDaytime(hour) ? "day" : "night"
}

/**
 * Fixed face colors, the same in light and dark themes (it's a clock face, not
 * a surface). Numerals clear 4.5:1 on their face: day #141414 on #fff is
 * 18.6:1, night #f4f4f4 on #1e1e1e is 15.6:1; minor ticks are ≥5.9:1.
 */
export const FACE_COLORS: Record<
  FaceTone,
  {
    fill: string
    stroke: string
    numeral: string
    minor: string
    hand: string
    second: string
  }
> = {
  day: {
    fill: "#ffffff",
    stroke: "#dbdbdb",
    numeral: "#141414",
    minor: "#626262",
    hand: "#141414",
    second: "#c2410c",
  },
  night: {
    fill: "#1e1e1e",
    stroke: "#4a4a4a",
    numeral: "#f4f4f4",
    minor: "#a4a4a4",
    hand: "#f4f4f4",
    second: "#fb923c",
  },
}

/** Analog faces for up to 4 clocks, a digital list for more. */
export function defaultClockStyle(count: number): "analog" | "digital" {
  return count <= 4 ? "analog" : "digital"
}

/**
 * Grid columns for analog faces. Container-query classes, so a wide card fits
 * up to 4 faces per row and a narrow one 2.
 */
export function analogGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1"
  if (count === 2) return "grid-cols-2"
  if (count === 3) return "grid-cols-2 @md:grid-cols-3"
  return "grid-cols-2 @lg:grid-cols-4"
}

/* ------------------------------------------------------------------------ */
/* Days                                                                     */
/* ------------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, "0")

/** The calendar date of an instant in a timezone, 'YYYY-MM-DD'. */
export function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

function keyToUtc(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!m) return Number.NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}

/** A valid 'YYYY-MM-DD' (or the date part of an ISO string), or null. */
export function normalizeDayKey(value: string | undefined): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) return null
  const t = keyToUtc(value.trim())
  const back = new Date(t).toISOString().slice(0, 10)
  return back === `${m[1]}-${m[2]}-${m[3]}` ? back : null
}

export function addDays(key: string, n: number): string {
  const d = new Date(keyToUtc(key))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Calendar days between the date in `timeZone` and the date in `refZone` at
 * the same instant: 1 = tomorrow there, -1 = yesterday there.
 */
export function dayDifference(
  t: number,
  timeZone: string,
  refZone: string,
): number {
  return Math.round(
    (keyToUtc(dayKey(t, timeZone)) - keyToUtc(dayKey(t, refZone))) / 86_400_000,
  )
}

/** 'Today', 'Tomorrow', 'Yesterday', or '+2 days'. */
export function dayRelationLabel(diff: number): string {
  if (diff === 0) return "Today"
  if (diff === 1) return "Tomorrow"
  if (diff === -1) return "Yesterday"
  return `${diff > 0 ? "+" : "−"}${Math.abs(diff)} days`
}

/* ------------------------------------------------------------------------ */
/* Working hours                                                            */
/* ------------------------------------------------------------------------ */

/** 'HH:mm' (00:00–24:00) to minutes since midnight, or null. */
export function parseClockTime(value: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value?.trim() ?? "")
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (min > 59 || h > 24 || (h === 24 && min > 0)) return null
  return h * 60 + min
}

/** Local midnight of a calendar date in a timezone, and the next one. */
export function dayWindow(date: string, timeZone: string): Interval {
  const [y, m, d] = date.split("-").map(Number)
  const next = addDays(date, 1).split("-").map(Number)
  return {
    start: wallTimeToInstant(y, m, d, 0, 0, timeZone),
    end: wallTimeToInstant(next[0], next[1], next[2], 0, 0, timeZone),
  }
}

/** Sorted, merged intervals. */
function merge(list: Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.end > i.start)
    .sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const i of sorted) {
    const last = out[out.length - 1]
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end)
    else out.push({ ...i })
  }
  return out
}

/**
 * A zone's working hours that fall inside a window, from every local day the
 * window touches. An end at or before the start is an overnight shift.
 */
export function workingIntervals(
  window: Interval,
  timeZone: string,
  startMin: number,
  endMin: number,
): Interval[] {
  const first = addDays(dayKey(window.start, timeZone), -1)
  const last = addDays(dayKey(window.end, timeZone), 1)
  const list: Interval[] = []
  for (let key = first; key <= last; key = addDays(key, 1)) {
    const [y, m, d] = key.split("-").map(Number)
    const start = wallTimeToInstant(
      y,
      m,
      d,
      Math.floor(startMin / 60),
      startMin % 60,
      timeZone,
    )
    const endKey = endMin <= startMin ? addDays(key, 1) : key
    const [ey, em, ed] = endKey.split("-").map(Number)
    const end = wallTimeToInstant(
      ey,
      em,
      ed,
      Math.floor(endMin / 60),
      endMin % 60,
      timeZone,
    )
    list.push({
      start: Math.max(start, window.start),
      end: Math.min(end, window.end),
    })
  }
  return merge(list)
}

/** Where two sets of intervals overlap. */
export function intersectIntervals(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = []
  for (const x of a) {
    for (const y of b) {
      const start = Math.max(x.start, y.start)
      const end = Math.min(x.end, y.end)
      if (end > start) out.push({ start, end })
    }
  }
  return merge(out)
}

export type DayPlan = {
  /** The planned day: local midnight to midnight in the first zone. */
  window: Interval
  /** Each zone's working hours inside the window, in input order. */
  perZone: Interval[][]
  /** When everyone is working. Empty when there's no overlap. */
  overlap: Interval[]
  /** Hour columns for the strip (23 or 25 on a DST day in the first zone). */
  hours: number
}

/**
 * Working-hours overlap for one day. The day is `date` in the first zone; the
 * others count working hours from whichever local days fall inside it.
 */
export function planDay(
  date: string,
  timeZones: string[],
  startMin: number,
  endMin: number,
): DayPlan | null {
  if (timeZones.length === 0 || !normalizeDayKey(date)) return null
  const window = dayWindow(date, timeZones[0])
  const perZone = timeZones.map((tz) =>
    workingIntervals(window, tz, startMin, endMin),
  )
  const overlap = perZone.reduce((acc, list) => intersectIntervals(acc, list))
  return {
    window,
    perZone,
    overlap,
    hours: Math.round((window.end - window.start) / HOUR),
  }
}

/** Whether any interval contains the instant. */
export function covers(list: Interval[], t: number): boolean {
  return list.some((i) => t >= i.start && t < i.end)
}

/** Pickable start times within overlaps: each start, then every hour after. */
export function hourStarts(list: Interval[]): number[] {
  const out: number[] = []
  for (const i of list) {
    for (let t = i.start; t < i.end; t += HOUR) out.push(t)
  }
  return out
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

const formatCache = new Map<string, Intl.DateTimeFormat>()

function cachedFormat(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = formatCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    formatCache.set(key, f)
  }
  return f
}

export type FormatOptions = { locale?: string; hour12?: boolean }

/**
 * Hour options. A forced 24-hour clock uses hourCycle 'h23' and two digits
 * ('08:00'), since `hour12: false` can print midnight as '24:00'.
 */
function hourOptions(hour12: boolean | undefined): Intl.DateTimeFormatOptions {
  if (hour12 === false) return { hour: "2-digit", hourCycle: "h23" }
  if (hour12 === true) return { hour: "numeric", hour12: true }
  return { hour: "numeric" }
}

/** '12:18 PM' or '12:18', in a timezone. */
export function formatTime(
  t: number,
  timeZone: string,
  { locale = DEFAULT_LOCALE, hour12 }: FormatOptions = {},
): string {
  return cachedFormat(locale, {
    timeZone,
    minute: "2-digit",
    ...hourOptions(hour12),
  }).format(t)
}

/** The time split into digits and day period, e.g. { time: '12:18', period: 'PM' }. */
export function timeParts(
  t: number,
  timeZone: string,
  options: FormatOptions = {},
): { time: string; period: string } {
  const parts = cachedFormat(options.locale ?? DEFAULT_LOCALE, {
    timeZone,
    minute: "2-digit",
    ...hourOptions(options.hour12),
  }).formatToParts(t)
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? ""
  const time = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
    .trim()
  return { time, period }
}

/** An hour tick for the planner strip, e.g. '8 AM' or '08'. */
export function formatHour(
  t: number,
  timeZone: string,
  { locale = DEFAULT_LOCALE, hour12 }: FormatOptions = {},
): string {
  return cachedFormat(locale, {
    timeZone,
    ...hourOptions(hour12),
  }).format(t)
}

/** 'Thursday' in a timezone. */
export function formatWeekday(
  t: number,
  timeZone: string,
  { locale = DEFAULT_LOCALE }: FormatOptions = {},
): string {
  return cachedFormat(locale, { timeZone, weekday: "long" }).format(t)
}

/** 'Thursday, October 8' in a timezone. */
export function formatLongDate(
  t: number,
  timeZone: string,
  { locale = DEFAULT_LOCALE }: FormatOptions = {},
): string {
  return cachedFormat(locale, {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(t)
}

/** 'Wed, Oct 14' for a calendar date, never shifted by the viewer's zone. */
export function formatDayKey(
  key: string,
  { locale = DEFAULT_LOCALE }: FormatOptions = {},
) {
  const t = keyToUtc(key)
  if (Number.isNaN(t)) return key
  return cachedFormat(locale, {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(t)
}
