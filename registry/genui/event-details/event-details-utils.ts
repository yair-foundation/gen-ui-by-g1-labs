/**
 * Event details: pure helpers. Intl only, no date library, no React, no DOM:
 * safe on the server and unit-testable in Node.
 *
 * Every time shows in the event's own IANA timezone, so a 6:30 PM meetup in
 * New York reads 6:30 PM for a viewer anywhere.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type RsvpChoice = "going" | "maybe" | "not-going"

const MINUTE = 60_000
const HOUR = 60 * MINUTE

/* ------------------------------------------------------------------------ */
/* Timezones                                                                */
/* ------------------------------------------------------------------------ */

/** The timezone if the runtime knows it, otherwise 'UTC'. */
export function safeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC"
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return timeZone
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

/** Wall-clock fields of an instant in a timezone. */
export function zonedParts(t: number, timeZone: string) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const p of partsFormatter(safeTimeZone(timeZone)).formatToParts(t)) {
    if (p.type in out) out[p.type as keyof typeof out] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

/** Offset from UTC in minutes at an instant, e.g. -240 for New York in October. */
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

const floating =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * An ISO date-time as an instant. With an offset it is exact; without one
 * ('2026-10-15T18:30') it is wall-clock time in the event's timezone.
 */
export function toInstant(
  value: string | undefined,
  timeZone: string,
): number | null {
  if (!value) return null
  const v = value.trim()
  if (!hasOffset.test(v)) {
    const f = floating.exec(v)
    if (f) {
      return wallTimeToInstant(+f[1], +f[2], +f[3], +f[4], +f[5], timeZone)
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
export function resolveNow(
  now: Date | string | number | undefined,
): number | null {
  if (now === undefined) return null
  const t = typeof now === "string" ? Date.parse(now) : new Date(now).getTime()
  return Number.isFinite(t) ? t : null
}

/* ------------------------------------------------------------------------ */
/* Dates                                                                    */
/* ------------------------------------------------------------------------ */

export const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s.trim())

/** 'YYYY-MM-DD' (or the date part of an ISO string) if it's a real date. */
export function normalizeDate(value: string | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value?.trim() ?? "")
  if (!m) return null
  const back = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
    .toISOString()
    .slice(0, 10)
  return back === `${m[1]}-${m[2]}-${m[3]}` ? back : null
}

/** '2026-10-15' plus whole days. */
export function addDays(key: string, days: number): string {
  const d = new Date(`${key}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** The calendar date of an instant in a timezone, as 'YYYY-MM-DD'. */
export function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/** Whole calendar days from one 'YYYY-MM-DD' to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) /
      86_400_000,
  )
}

/** When the event happens, resolved from the agent's strings. */
export type EventWhen =
  | {
      allDay: true
      /** First day, 'YYYY-MM-DD'. */
      startDate: string
      /** Last day, inclusive. */
      endDate: string
    }
  | { allDay: false; start: number; end: number | null }

/**
 * A date-only start (or `allDay`) is an all-day event, and `end` is its last
 * day. Otherwise start and end are instants; an end at or before the start is
 * dropped. Null when the start can't be read.
 */
export function resolveWhen(input: {
  start?: string
  end?: string
  timeZone?: string
  allDay?: boolean
}): EventWhen | null {
  const { start, end, allDay } = input
  if (!start) return null
  const tz = safeTimeZone(input.timeZone)
  if (allDay || isDateOnly(start)) {
    const s = normalizeDate(start)
    if (!s) return null
    const e = normalizeDate(end)
    return { allDay: true, startDate: s, endDate: e && e >= s ? e : s }
  }
  const s = toInstant(start, tz)
  if (s === null) return null
  const e = toInstant(end, tz)
  return { allDay: false, start: s, end: e !== null && e > s ? e : null }
}

/** The span as instants: all-day events run from midnight to midnight. */
export function whenBounds(
  when: EventWhen,
  timeZone: string,
): { start: number; end: number | null } {
  if (!when.allDay) return { start: when.start, end: when.end }
  const tz = safeTimeZone(timeZone)
  const at = (key: string) =>
    wallTimeToInstant(
      +key.slice(0, 4),
      +key.slice(5, 7),
      +key.slice(8, 10),
      0,
      0,
      tz,
    )
  return { start: at(when.startDate), end: at(addDays(when.endDate, 1)) }
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    fmtCache.set(key, f)
  }
  return f
}

/** Intl uses narrow no-break spaces in times ('6:30 PM'); plain spaces read the same. */
const plain = (s: string) => s.replace(/[   ]/g, " ")

/** A time split into the clock ('6:30') and the day period ('PM', or '' in 24-hour locales). */
export function clockParts(
  t: number,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): { clock: string; period: string } {
  const parts = fmt(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTimeZone(timeZone),
  }).formatToParts(t)
  const period = parts.find((p) => p.type === "dayPeriod")?.value ?? ""
  const clock = parts
    .filter((p) => p.type !== "dayPeriod")
    .map((p) => p.value)
    .join("")
  return { clock: plain(clock).trim(), period: plain(period).trim() }
}

/** '6:30 PM' at the event. */
export function timeText(
  t: number,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  const { clock, period } = clockParts(t, timeZone, locale)
  return period ? `${clock} ${period}` : clock
}

/** '6:30–9:00 PM', or '11:00 AM – 2:00 PM' when the day period changes. */
export function timeRangeText(
  a: number,
  b: number,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  const pa = clockParts(a, timeZone, locale)
  const pb = clockParts(b, timeZone, locale)
  if (!pa.period && !pb.period) return `${pa.clock}–${pb.clock}`
  if (pa.period === pb.period) return `${pa.clock}–${pb.clock} ${pb.period}`
  return `${timeText(a, timeZone, locale)} – ${timeText(b, timeZone, locale)}`
}

/** 'Thu, Oct 15' (with the year when asked) for an instant at the event. */
export function dateText(
  t: number,
  timeZone: string,
  locale = DEFAULT_LOCALE,
  withYear = false,
): string {
  return fmt(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: safeTimeZone(timeZone),
  }).format(t)
}

/** 'Thu, Oct 15' for a calendar date. */
export function dateKeyText(
  key: string,
  locale = DEFAULT_LOCALE,
  withYear = false,
): string {
  return fmt(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(Date.parse(`${key}T12:00:00Z`))
}

/**
 * The date line, in the event's timezone:
 * - 'Thu, Oct 15 · 6:30–9:00 PM'
 * - 'Thu, Oct 15 · 6:30 PM' (no end)
 * - 'Sat, Oct 24 · 4:00 PM – Sun 1:00 AM' (past midnight, under a day)
 * - 'Thu, Oct 15, 9:00 AM – Sat, Oct 17, 5:00 PM' (several days)
 * - 'Sat, Oct 24 · All day' and 'Thu, Oct 15 – Sat, Oct 17' (all day)
 * The year is added when it differs from `now`'s year.
 */
export function dateRangeText(
  when: EventWhen,
  timeZone: string,
  locale = DEFAULT_LOCALE,
  now: number | null = null,
): string {
  const tz = safeTimeZone(timeZone)
  const thisYear = now === null ? null : zonedParts(now, tz).year
  if (when.allDay) {
    const withYear =
      thisYear !== null && Number(when.startDate.slice(0, 4)) !== thisYear
    const first = dateKeyText(when.startDate, locale, withYear)
    if (when.endDate === when.startDate) return `${first} · All day`
    return `${first} – ${dateKeyText(when.endDate, locale, withYear)}`
  }
  const { start, end } = when
  const withYear = thisYear !== null && zonedParts(start, tz).year !== thisYear
  const day = dateText(start, tz, locale, withYear)
  if (end === null) return `${day} · ${timeText(start, tz, locale)}`
  const days = daysBetween(dayKey(start, tz), dayKey(end, tz))
  if (days === 0) return `${day} · ${timeRangeText(start, end, tz, locale)}`
  if (days === 1 && end - start < 24 * HOUR) {
    const weekday = fmt(locale, { weekday: "short", timeZone: tz }).format(end)
    return `${day} · ${timeText(start, tz, locale)} – ${weekday} ${timeText(end, tz, locale)}`
  }
  return `${day}, ${timeText(start, tz, locale)} – ${dateText(end, tz, locale, withYear)}, ${timeText(end, tz, locale)}`
}

/** 'America/New_York' → 'New York'. */
export function zoneCity(timeZone: string): string {
  if (timeZone === "UTC" || timeZone === "Etc/UTC") return "UTC"
  const last = timeZone.split("/").pop() ?? timeZone
  return last.replace(/_/g, " ")
}

/**
 * How far away the event is, measured in calendar days at the event:
 * 'in 40 min', 'in 3 h', 'today', 'tomorrow', 'in 7 days', 'in 3 months',
 * 'happening now', 'started', 'ended'. Null before mount (no clock).
 */
export function relativeText(
  when: EventWhen,
  timeZone: string,
  now: number | null,
): string | null {
  if (now === null) return null
  const tz = safeTimeZone(timeZone)
  const { start, end } = whenBounds(when, tz)
  if (end !== null && now >= end) return "ended"
  if (now >= start) return end === null ? "started" : "happening now"
  const startDay = when.allDay ? when.startDate : dayKey(start, tz)
  const days = daysBetween(dayKey(now, tz), startDay)
  if (days <= 0) {
    if (when.allDay) return "today"
    const minutes = Math.max(1, Math.round((start - now) / MINUTE))
    return minutes < 60
      ? `in ${minutes} min`
      : `in ${Math.round(minutes / 60)} h`
  }
  if (days === 1) return "tomorrow"
  if (days < 60) return `in ${days} days`
  return `in ${Math.round(days / 30)} months`
}

/**
 * The start in the viewer's own timezone when it differs from the event's:
 * '9:30 AM your time', or 'Fri 12:30 AM your time' on another date.
 */
export function viewerTimeText(
  start: number,
  eventZone: string,
  viewerZone: string | undefined,
  locale = DEFAULT_LOCALE,
): string | null {
  if (!viewerZone) return null
  const ez = safeTimeZone(eventZone)
  const vz = safeTimeZone(viewerZone)
  if (offsetMinutes(start, ez) === offsetMinutes(start, vz)) return null
  const time = timeText(start, vz, locale)
  if (dayKey(start, ez) === dayKey(start, vz)) return `${time} your time`
  const weekday = fmt(locale, { weekday: "short", timeZone: vz }).format(start)
  return `${weekday} ${time} your time`
}

/**
 * An agenda time: 'HH:mm' wall-clock at the event ('18:30' → '6:30 PM'), an
 * ISO date-time shown in the event's timezone, or any other text as given.
 */
export function agendaTimeText(
  time: string,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  const v = time.trim()
  const hm = /^(\d{1,2}):(\d{2})$/.exec(v)
  if (hm && +hm[1] < 24 && +hm[2] < 60) {
    return timeText(Date.UTC(2000, 0, 1, +hm[1], +hm[2]), "UTC", locale)
  }
  const t = toInstant(v, safeTimeZone(timeZone))
  return t === null ? v : timeText(t, timeZone, locale)
}

/* ------------------------------------------------------------------------ */
/* Facts                                                                    */
/* ------------------------------------------------------------------------ */

/** 'Free', '$25.00', '€12', or '25 XYZ' for an unknown currency. */
export function priceText(
  price: "free" | { amount: number; currency: string },
  locale = DEFAULT_LOCALE,
): string {
  if (price === "free" || price.amount === 0) return "Free"
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: price.currency,
      minimumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
    }).format(price.amount)
  } catch {
    return `${price.amount} ${price.currency}`
  }
}

/** '84 going · 120 spots', '84 going', or 'Full · 120 spots'. */
export function capacityText(
  capacity: { going: number; max?: number },
  locale = DEFAULT_LOCALE,
): string {
  const n = (v: number) => new Intl.NumberFormat(locale).format(v)
  const going = Math.max(0, Math.round(capacity.going))
  if (typeof capacity.max !== "number" || capacity.max <= 0) {
    return `${n(going)} going`
  }
  const max = Math.round(capacity.max)
  const spots = `${n(max)} ${max === 1 ? "spot" : "spots"}`
  return going >= max ? `Full · ${spots}` : `${n(going)} going · ${spots}`
}

/**
 * An OpenStreetMap search for the venue: the address when there is one (it
 * geocodes better than a venue name), else the name. Null without either.
 */
export function directionsUrl(venue: {
  name?: string
  address?: string
}): string | null {
  const q = venue.address?.trim() || venue.name?.trim()
  if (!q) return null
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`
}

/**
 * When RSVPs close: a date-only deadline runs to the end of that day at the
 * event. `label` is 'Mon, Oct 12' or 'Mon, Oct 12, 5:00 PM'.
 */
export function deadlineInfo(
  deadline: string | undefined,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): { at: number; label: string } | null {
  if (!deadline) return null
  const tz = safeTimeZone(timeZone)
  if (isDateOnly(deadline)) {
    const d = normalizeDate(deadline)
    if (!d) return null
    const { end } = whenBounds({ allDay: true, startDate: d, endDate: d }, tz)
    return end === null ? null : { at: end, label: dateKeyText(d, locale) }
  }
  const t = toInstant(deadline, tz)
  if (t === null) return null
  return {
    at: t,
    label: `${dateText(t, tz, locale)}, ${timeText(t, tz, locale)}`,
  }
}

/** A link from agent data, only when it's http(s). */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** An image source from agent data: http(s), a same-origin "/path" or a data:image URI. */
export function safeImageSrc(src: string | undefined): string | null {
  if (!src) return null
  const v = src.trim()
  if (/^\/(?![/\\])/.test(v)) return v
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/i.test(v)) return v
  return safeUrl(v)
}

/** '**Bring ID** at the door' → [{ text: 'Bring ID', bold: true }, …]. */
export function parseBold(text: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = []
  const re = /\*\*(.+?)\*\*/gs
  let last = 0
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0
    if (i > last) out.push({ text: text.slice(last, i), bold: false })
    out.push({ text: m[1], bold: true })
    last = i + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false })
  return out
}

/** The description without the bold markers, for the calendar file and sharing. */
export const stripBold = (text: string) =>
  parseBold(text)
    .map((s) => s.text)
    .join("")

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

/** '20261015T223000Z'. */
export function icsUtc(t: number): string {
  return `${new Date(t).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`
}

/** A short, stable hash for the event's UID. */
function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

export type IcsInput = {
  title: string
  when: EventWhen
  location?: string
  description?: string
  url?: string
  /** DTSTAMP: when the file was made. */
  stamp: number
}

/**
 * A one-event .ics file with CRLF line endings. All-day events use DATE
 * values (DTEND is the day after the last day, exclusive); timed ones are in
 * UTC. Text is escaped and long lines folded.
 */
export function buildIcs({
  title,
  when,
  location,
  description,
  url,
  stamp,
}: IcsInput): string {
  const startKey = when.allDay ? when.startDate : String(when.start)
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GenUI//Event details//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${hash(`${title}|${startKey}`)}@genui`,
    `DTSTAMP:${icsUtc(stamp)}`,
  ]
  if (when.allDay) {
    lines.push(
      `DTSTART;VALUE=DATE:${when.startDate.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${addDays(when.endDate, 1).replace(/-/g, "")}`,
    )
  } else {
    lines.push(`DTSTART:${icsUtc(when.start)}`)
    if (when.end !== null) lines.push(`DTEND:${icsUtc(when.end)}`)
  }
  lines.push(`SUMMARY:${escapeIcsText(title)}`)
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`)
  if (description) {
    lines.push(`DESCRIPTION:${escapeIcsText(stripBold(description))}`)
  }
  const link = safeUrl(url)
  if (link) lines.push(`URL:${link}`)
  lines.push("END:VEVENT", "END:VCALENDAR")
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`
}

/** 'design-systems-night.ics'. */
export function icsFilename(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "")
  return `${slug || "event"}.ics`
}

/* ------------------------------------------------------------------------ */
/* RSVP                                                                     */
/* ------------------------------------------------------------------------ */

export const RSVP_LABEL: Record<RsvpChoice, string> = {
  going: "Going",
  maybe: "Maybe",
  "not-going": "Can't go",
}

/** The footer line once the user has answered. */
export const RSVP_DONE: Record<RsvpChoice, string> = {
  going: "You're going",
  maybe: "You said maybe",
  "not-going": "You can't go",
}
