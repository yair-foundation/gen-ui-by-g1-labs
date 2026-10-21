/**
 * Countdown: pure date logic. Intl only, no date library.
 *
 * Targets are resolved to an instant in a timezone. Days are calendar days in
 * that zone, so a DST change between now and the target never shows up as an
 * extra or missing hour; hours, minutes and seconds are real elapsed time.
 * Everything is derived from the wall clock, never by counting ticks.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export const SECOND = 1000
export const MINUTE = 60_000
export const HOUR = 3_600_000
export const DAY = 86_400_000

export type Precision = "days" | "hours" | "minutes" | "seconds"
export type Unit = "day" | "hour" | "minute" | "second"

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

/** The viewer's timezone, or UTC when the runtime can't tell. */
export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>()

function partsFormatter(timeZone: string) {
  let f = partsCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
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

export type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
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
  }
  for (const p of partsFormatter(timeZone).formatToParts(t)) {
    if (p.type in out) out[p.type as keyof ZonedParts] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

/** Offset from UTC in minutes at an instant, e.g. -300 for New York in winter. */
export function offsetMinutes(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / MINUTE)
}

/** The instant a wall-clock time happens in a timezone. */
export function wallTimeToInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second)
  const first = offsetMinutes(guess, timeZone)
  let t = guess - first * MINUTE
  // Near a DST change the offset at the guess can differ from the real one.
  const again = offsetMinutes(t, timeZone)
  if (again !== first) t = guess - again * MINUTE
  return t
}

/* ------------------------------------------------------------------------ */
/* Calendar dates ('YYYY-MM-DD')                                            */
/* ------------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, "0")

function keyToUtc(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!m) return Number.NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3])
}

/** The calendar date of an instant in a timezone. */
export function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** A real calendar date ('2028-02-29' yes, '2027-02-29' no), or null. */
export function normalizeDayKey(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value?.trim() ?? "")
  if (!m) return null
  const t = keyToUtc(m[0])
  if (Number.isNaN(t)) return null
  const back = new Date(t).toISOString().slice(0, 10)
  return back === m[0] ? back : null
}

export function addDays(key: string, n: number): string {
  const d = new Date(keyToUtc(key))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Calendar days from `a` to `b`: positive when `b` is later. */
export function daysBetween(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / DAY)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay()
}

/* ------------------------------------------------------------------------ */
/* Parsing targets                                                          */
/* ------------------------------------------------------------------------ */

export type ParsedAt =
  /** A whole day: counts to local midnight. */
  | { kind: "date"; date: string }
  /** A wall-clock time in the event's zone (no offset given). */
  | {
      kind: "local"
      date: string
      hour: number
      minute: number
      second: number
    }
  /** An exact moment (the string had Z or an offset). */
  | { kind: "instant"; instant: number }

const DATETIME_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}(?::?\d{2})?)?$/i

/** Parses 'YYYY-MM-DD' or an ISO 8601 date-time. Null when invalid. */
export function parseAt(value: string | undefined): ParsedAt | null {
  const raw = value?.trim()
  if (!raw) return null
  const date = normalizeDayKey(raw)
  if (date) return { kind: "date", date }
  const m = DATETIME_RE.exec(raw)
  if (!m) return null
  const day = normalizeDayKey(m[1])
  const hour = Number(m[2])
  const minute = Number(m[3])
  const second = Number(m[4] ?? 0)
  if (!day || hour > 23 || minute > 59 || second > 59) return null
  if (!m[6]) return { kind: "local", date: day, hour, minute, second }
  const ms = Number((m[5] ?? "0").slice(0, 3).padEnd(3, "0"))
  const [y, mo, d] = day.split("-").map(Number)
  let offset = 0
  if (m[6].toUpperCase() !== "Z") {
    const o = /^([+-])(\d{2}):?(\d{2})?$/.exec(m[6])
    if (!o) return null
    const oh = Number(o[2])
    const om = Number(o[3] ?? 0)
    if (oh > 23 || om > 59) return null
    offset = (o[1] === "-" ? -1 : 1) * (oh * 60 + om)
  }
  return {
    kind: "instant",
    instant: Date.UTC(y, mo - 1, d, hour, minute, second, ms) - offset * MINUTE,
  }
}

export type Target = {
  /** When the countdown reaches zero. */
  instant: number
  /** A date-only target: counts to local midnight; all-day in calendars. */
  allDay: boolean
  /** The target's calendar date in its zone. */
  date: string
  /** The zone the date and "today" are judged in. */
  timeZone: string
}

/**
 * Resolves `at` in `timeZone` (an invalid or missing zone falls back to
 * `fallbackZone`, normally the viewer's). Date-only values land on local
 * midnight; date-times without an offset are wall time in the zone.
 */
export function resolveTarget(
  at: string | undefined,
  timeZone: string | undefined,
  fallbackZone: string,
): Target | null {
  const parsed = parseAt(at)
  if (!parsed) return null
  const zone = isValidTimeZone(timeZone) ? (timeZone as string) : fallbackZone
  if (parsed.kind === "instant") {
    return {
      instant: parsed.instant,
      allDay: false,
      date: dayKey(parsed.instant, zone),
      timeZone: zone,
    }
  }
  const [y, m, d] = parsed.date.split("-").map(Number)
  const instant =
    parsed.kind === "date"
      ? wallTimeToInstant(y, m, d, 0, 0, 0, zone)
      : wallTimeToInstant(
          y,
          m,
          d,
          parsed.hour,
          parsed.minute,
          parsed.second,
          zone,
        )
  return {
    instant,
    allDay: parsed.kind === "date",
    date: parsed.date,
    timeZone: zone,
  }
}

/**
 * Whether a streamed `at` is final. While streaming, '2026-12-01' may still
 * grow into '2026-12-01T09:00-05:00', so a date (or a date-time without an
 * offset) only counts once something after it has arrived.
 */
export function isAtSettled(
  at: string | undefined,
  streaming: boolean,
  somethingAfter: boolean,
): boolean {
  const parsed = parseAt(at)
  if (!parsed) return false
  if (!streaming || somethingAfter) return true
  return parsed.kind === "instant" && /(Z|[+-]\d{2}:\d{2})$/i.test(at ?? "")
}

/* ------------------------------------------------------------------------ */
/* Time left                                                                */
/* ------------------------------------------------------------------------ */

export type TimeLeft = {
  days: number
  hours: number
  minutes: number
  seconds: number
  /** Real milliseconds until the target; 0 once it has passed. */
  totalMs: number
}

/**
 * Time from `now` to `target`. Days are whole calendar days in `timeZone`
 * (same wall-clock time, N days later), so they stay right across DST; the
 * rest is real time.
 */
export function timeLeft(
  now: number,
  target: number,
  timeZone: string,
): TimeLeft {
  if (target <= now) {
    return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: 0 }
  }
  const p = zonedParts(now, timeZone)
  const today = `${p.year}-${pad(p.month)}-${pad(p.day)}`
  const subSecond = ((now % 1000) + 1000) % 1000
  const anchorAt = (n: number) => {
    if (n === 0) return now
    const [y, m, d] = addDays(today, n).split("-").map(Number)
    return (
      wallTimeToInstant(y, m, d, p.hour, p.minute, p.second, timeZone) +
      subSecond
    )
  }
  let days = Math.max(0, daysBetween(today, dayKey(target, timeZone)))
  let anchor = anchorAt(days)
  while (days > 0 && anchor > target) {
    days--
    anchor = anchorAt(days)
  }
  let rest = target - anchor
  // Only on a 25-hour day can the remainder reach a full day.
  while (rest >= DAY) {
    days++
    rest -= DAY
  }
  return {
    days,
    hours: Math.floor(rest / HOUR),
    minutes: Math.floor((rest % HOUR) / MINUTE),
    seconds: Math.floor((rest % MINUTE) / SECOND),
    totalMs: target - now,
  }
}

/** Days while more than 2 days away, then hours, minutes, and seconds in the last hour. */
export function autoPrecision(totalMs: number): Precision {
  if (totalMs >= 2 * DAY) return "days"
  if (totalMs >= 6 * HOUR) return "hours"
  if (totalMs >= HOUR) return "minutes"
  return "seconds"
}

export type Phase = "upcoming" | "today" | "past"

export type CountdownState = {
  phase: Phase
  /** Calendar days from today to the target date, in the target's zone. Negative once past. */
  calendarDays: number
  left: TimeLeft
  /** The precision in effect (explicit, or automatic), for an upcoming target. */
  precision: Precision
}

/**
 * Where a target stands at `now`:
 * - upcoming: the target moment hasn't arrived (date-only: before its midnight);
 * - today: it has arrived and it's still that day in the target's zone;
 * - past: the day is over.
 */
export function countdownState(
  target: Target,
  now: number,
  precision?: Precision,
): CountdownState {
  const today = dayKey(now, target.timeZone)
  const calendarDays = daysBetween(today, target.date)
  const left = timeLeft(now, target.instant, target.timeZone)
  const phase: Phase =
    now < target.instant ? "upcoming" : calendarDays >= 0 ? "today" : "past"
  let p = precision ?? autoPrecision(left.totalMs)
  // "0 days" says nothing: fall back to hours on the day itself.
  if (p === "days" && calendarDays < 1) p = "hours"
  return { phase, calendarDays, left, precision: p }
}

export type ReadoutPart = { value: number; unit: Unit }
export type Readout = { lead: ReadoutPart; rest: ReadoutPart[] }

const UNITS: Unit[] = ["day", "hour", "minute", "second"]
const PRECISION_INDEX: Record<Precision, number> = {
  days: 0,
  hours: 1,
  minutes: 2,
  seconds: 3,
}

/**
 * The numbers to show for an upcoming target: the largest unit, then the
 * smaller ones down to the precision. At "days" precision the count is in
 * calendar days ("42 days" on Oct 9 for Nov 20), as people count them.
 */
export function readout(state: CountdownState): Readout {
  if (state.precision === "days") {
    return { lead: { value: state.calendarDays, unit: "day" }, rest: [] }
  }
  const { days, hours, minutes, seconds } = state.left
  const values = [days, hours, minutes, seconds]
  const limit = PRECISION_INDEX[state.precision]
  let lead = values.findIndex((v) => v > 0)
  if (lead === -1) lead = 3
  const rest: ReadoutPart[] = []
  for (let i = lead + 1; i <= limit; i++) {
    rest.push({ value: values[i], unit: UNITS[i] })
  }
  return { lead: { value: values[lead], unit: UNITS[lead] }, rest }
}

/** '1 day', '6 hours'. */
export function formatUnit({ value, unit }: ReadoutPart): string {
  return `${value} ${unit}${value === 1 ? "" : "s"}`
}

/** The unit word alone, for the label next to the big number. */
export function unitWord({ value, unit }: ReadoutPart): string {
  return `${unit}${value === 1 ? "" : "s"}`
}

/** '42 days and 6 hours', '1 day, 6 hours and 12 minutes'. Zero parts are skipped. */
export function spokenReadout({ lead, rest }: Readout): string {
  const parts = [lead, ...rest.filter((p) => p.value > 0)].map(formatUnit)
  if (parts.length === 1) return parts[0]
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/** 'in 35 days', 'tomorrow', 'today', 'yesterday', '3 days ago'. */
export function relativeDays(diff: number): string {
  if (diff === 0) return "today"
  if (diff === 1) return "tomorrow"
  if (diff === -1) return "yesterday"
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`
}

/* ------------------------------------------------------------------------ */
/* Working days, progress, milestones                                       */
/* ------------------------------------------------------------------------ */

/** Monday–Friday dates from `from` (included) to `to` (not included). No holidays. */
export function businessDaysBetween(from: string, to: string): number {
  const n = daysBetween(from, to)
  if (!(n > 0)) return 0
  let count = Math.floor(n / 7) * 5
  const start = weekdayOf(from)
  for (let i = 0; i < n % 7; i++) {
    const dow = (start + i) % 7
    if (dow !== 0 && dow !== 6) count++
  }
  return count
}

/** 0–1 of the wait between `since` and `target` that is over; null if `since` isn't before the target. */
export function waitProgress(
  since: number,
  now: number,
  target: number,
): number | null {
  if (!(target > since)) return null
  return Math.min(1, Math.max(0, (now - since) / (target - since)))
}

/** The calendar date `daysBefore` days ahead of `date`. */
export function milestoneDate(date: string, daysBefore: number): string {
  return addDays(date, -Math.max(0, Math.floor(daysBefore)))
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

const formatCache = new Map<string, Intl.DateTimeFormat>()

function cachedFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
) {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = formatCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    formatCache.set(key, f)
  }
  return f
}

/**
 * 'Friday, November 20, 2026', or 'Tuesday, December 1, 2026 at 9:00 AM EST'
 * for a timed target (the zone name with `showZone`).
 */
export function formatTargetDate(
  target: Target,
  {
    locale = DEFAULT_LOCALE,
    showZone = false,
  }: { locale?: string; showZone?: boolean } = {},
): string {
  const date: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }
  if (target.allDay) {
    // Formatted in UTC so the viewer's zone never shifts the date.
    return cachedFormat(locale, { ...date, timeZone: "UTC" }).format(
      keyToUtc(target.date),
    )
  }
  return cachedFormat(locale, {
    ...date,
    hour: "numeric",
    minute: "2-digit",
    timeZone: target.timeZone,
    ...(showZone ? { timeZoneName: "short" } : {}),
  }).format(target.instant)
}

/** 'Nov 13', or 'Apr 15, 2027' outside the current year. */
export function formatShortDate(
  key: string,
  todayKey: string,
  { locale = DEFAULT_LOCALE }: { locale?: string } = {},
): string {
  const t = keyToUtc(key)
  if (Number.isNaN(t)) return key
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4)
  return cachedFormat(locale, {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(t)
}

/** An http(s) URL, or null. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------ */
/* iCalendar                                                                */
/* ------------------------------------------------------------------------ */

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

function utf8Length(char: string): number {
  const c = char.codePointAt(0) ?? 0
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
}

/** Folds a content line at 75 octets, never inside a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  let current = ""
  let octets = 0
  for (const char of line) {
    const len = utf8Length(char)
    // Continuation lines start with a space, which counts toward the 75.
    if (octets + len > 75) {
      out.push(current)
      current = ` ${char}`
      octets = 1 + len
    } else {
      current += char
      octets += len
    }
  }
  out.push(current)
  return out.join("\r\n")
}

function icsUtc(t: number): string {
  return `${new Date(t).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`
}

export type IcsEvent = {
  uid: string
  title: string
  target: Target
  description?: string
  url?: string
  /** DTSTAMP: when the file was made. */
  stamp: number
}

/**
 * A one-event .ics file. Date-only targets are all-day events
 * (DTEND is the next day, exclusive); timed ones are a moment in UTC.
 */
export function buildIcs({
  uid,
  title,
  target,
  description,
  url,
  stamp,
}: IcsEvent): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GenUI//Countdown//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${icsUtc(stamp)}`,
  ]
  if (target.allDay) {
    lines.push(
      `DTSTART;VALUE=DATE:${target.date.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${addDays(target.date, 1).replace(/-/g, "")}`,
    )
  } else {
    lines.push(`DTSTART:${icsUtc(target.instant)}`)
  }
  lines.push(`SUMMARY:${escapeIcsText(title)}`)
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
  const link = safeUrl(url)
  if (link) lines.push(`URL:${link}`)
  lines.push("END:VEVENT", "END:VCALENDAR")
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`
}

/** 'lisbon-trip.ics'. */
export function icsFilename(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${slug || "event"}.ics`
}
