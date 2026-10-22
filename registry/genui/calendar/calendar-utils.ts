/**
 * Calendar: pure date logic. Intl only, no date library.
 *
 * Two kinds of value are used throughout:
 * - an instant: milliseconds since the epoch (a point in time), and
 * - a day key: 'YYYY-MM-DD', a calendar date in the calendar's timezone.
 *
 * Day keys are added and compared as calendar dates (never as multiples of
 * 24 hours), so weeks that cross a DST change keep the right days.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type CalendarEventLike = {
  id: string
  title: string
  start: string
  end: string
  allDay?: boolean
  busy?: boolean
}

export type CalendarProposalLike = {
  id: string
  kind: "create" | "move" | "cancel"
  eventId?: string
  title: string
  start: string
  end: string
  reason?: string
}

/* ------------------------------------------------------------------------ */
/* Timezones                                                                */
/* ------------------------------------------------------------------------ */

const formatterCache = new Map<string, Intl.DateTimeFormat>()

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

function partsFormatter(timeZone: string) {
  let f = formatterCache.get(timeZone)
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
    formatterCache.set(timeZone, f)
  }
  return f
}

/** Wall-clock fields of an instant in a timezone. */
export function zonedParts(t: number, timeZone: string) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const p of partsFormatter(timeZone).formatToParts(t)) {
    if (p.type in out) out[p.type as keyof typeof out] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

/** Offset from UTC in minutes at an instant, e.g. -240 for New York in summer. */
export function offsetMinutes(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / 60000)
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
  let t = guess - first * 60000
  // Near a DST change the offset at the guess can differ from the real one.
  const second = offsetMinutes(t, timeZone)
  if (second !== first) t = guess - second * 60000
  return t
}

const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/
const floating =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i

/** True for 'YYYY-MM-DD' with no time. */
export function isDateOnly(value: string): boolean {
  return dateOnly.test(value.trim())
}

/**
 * Parses an event time to an instant. ISO strings with an offset are exact;
 * a date-time without an offset is wall-clock time in the timezone; a bare
 * date is midnight in the timezone. Returns null when unparseable.
 */
export function parseInstant(value: string, timeZone: string): number | null {
  const v = value.trim()
  const d = dateOnly.exec(v)
  if (d) {
    return wallTimeToInstant(+d[1], +d[2], +d[3], 0, 0, timeZone)
  }
  if (!hasOffset.test(v)) {
    const f = floating.exec(v)
    if (f) return wallTimeToInstant(+f[1], +f[2], +f[3], +f[4], +f[5], timeZone)
  }
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/* ------------------------------------------------------------------------ */
/* Day keys                                                                 */
/* ------------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, "0")

function keyToUtc(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key)
  if (!m) return Number.NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], 12)
}

/** A valid day key from 'YYYY-MM-DD' or the date part of an ISO string. */
export function normalizeDayKey(value: string | undefined): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!m) return null
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3])
  const back = new Date(t).toISOString().slice(0, 10)
  return back === `${m[1]}-${m[2]}-${m[3]}` ? back : null
}

/** The calendar date of an instant in a timezone. */
export function dayKeyOf(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Minutes since local midnight (wall clock) of an instant in a timezone. */
export function minutesOfDay(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone)
  return p.hour * 60 + p.minute
}

export function addDays(key: string, n: number): string {
  const d = new Date(keyToUtc(key))
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Whole days from a to b (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((keyToUtc(b) - keyToUtc(a)) / 86400000)
}

/** 0 = Sunday … 6 = Saturday. */
/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(key: string): number {
  return new Date(keyToUtc(key)).getUTCDay()
}

export function startOfWeek(key: string, firstDay: number): string {
  return addDays(key, -((weekdayOf(key) - firstDay + 7) % 7))
}

export function startOfMonth(key: string): string {
  return `${key.slice(0, 7)}-01`
}

export function daysInMonth(key: string): number {
  const y = Number(key.slice(0, 4))
  const m = Number(key.slice(5, 7))
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Consecutive day keys. */
export function dayRange(start: string, days: number): string[] {
  return Array.from({ length: Math.max(0, days) }, (_, i) => addDays(start, i))
}

/** Weeks (rows of 7 day keys) covering the month of `key`. */
export function monthGrid(key: string, firstDay: number): string[][] {
  const first = startOfMonth(key)
  const gridStart = startOfWeek(first, firstDay)
  const last = addDays(first, daysInMonth(key) - 1)
  const weeks: string[][] = []
  for (let w = gridStart; diffDays(w, last) >= 0; w = addDays(w, 7)) {
    weeks.push(dayRange(w, 7))
  }
  return weeks
}

/** First day of the week for a locale (0 = Sunday), Monday when unknown. */
export function firstDayOfWeek(locale: string = DEFAULT_LOCALE): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number }
      weekInfo?: { firstDay: number }
    }
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {
    // Fall through.
  }
  return 1
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

/** A day key for display, never shifted by the viewer's timezone. */
export function formatDay(
  key: string,
  style: "weekday" | "day" | "date" | "long" | "month",
  locale: string = DEFAULT_LOCALE,
): string {
  const t = keyToUtc(key)
  if (Number.isNaN(t)) return key
  const options: Intl.DateTimeFormatOptions =
    style === "weekday"
      ? { weekday: "short" }
      : style === "day"
        ? { day: "numeric" }
        : style === "date"
          ? { weekday: "short", month: "short", day: "numeric" }
          : style === "month"
            ? { month: "long", year: "numeric" }
            : { weekday: "long", month: "long", day: "numeric" }
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(t)
}

/**
 * The range in the header: 'Oct 12–18, 2026', 'Oct 26 – Nov 1, 2026',
 * 'Dec 28, 2026 – Jan 3, 2027', or one day: 'Tue, Oct 13, 2026'.
 */
export function formatRangeLabel(
  start: string,
  days: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const end = addDays(start, Math.max(1, days) - 1)
  const month = (k: string) =>
    new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
      keyToUtc(k),
    )
  const dayNum = (k: string) => String(Number(k.slice(8, 10)))
  const year = (k: string) => k.slice(0, 4)
  if (start === end) {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(keyToUtc(start))
  }
  if (year(start) !== year(end)) {
    return `${month(start)} ${dayNum(start)}, ${year(start)} – ${month(end)} ${dayNum(end)}, ${year(end)}`
  }
  if (start.slice(0, 7) !== end.slice(0, 7)) {
    return `${month(start)} ${dayNum(start)} – ${month(end)} ${dayNum(end)}, ${year(end)}`
  }
  return `${month(start)} ${dayNum(start)}–${dayNum(end)}, ${year(end)}`
}

/** Time of an instant in the calendar's timezone, in the viewer's locale. */
export function formatTime(
  t: number,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(t)
}

/**
 * A compact hour label for the time grid: '9A' and '12P' where the locale
 * says AM / PM, the bare hour ('09', '16') in 24-hour locales, the full
 * label where the day period isn't Latin.
 */
export function formatHour(hour: number, locale: string = DEFAULT_LOCALE) {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    timeZone: "UTC",
  }).formatToParts(Date.UTC(2000, 0, 1, hour))
  const period = parts.find((p) => p.type === "dayPeriod")?.value
  const h = parts.find((p) => p.type === "hour")?.value ?? String(hour)
  if (!period) return h
  // Only Latin AM / PM shortens to one letter; '午前' and '午後' would collide.
  if (!/^[ap]\.?\s?m\.?$/i.test(period.trim())) {
    return parts.map((p) => p.value).join("")
  }
  return `${h}${period.trim()[0].toUpperCase()}`
}

/**
 * A compact time for tight spaces (month pills): '10A' and '1:30P' where the
 * locale says AM / PM (the same rule as `formatHour`), '10:00' and '13:30'
 * in 24-hour locales.
 */
export function formatTimeShort(
  t: number,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
) {
  const parts = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).formatToParts(t)
  const period = parts.find((p) => p.type === "dayPeriod")?.value?.trim()
  if (!period || !/^[ap]\.?\s?m\.?$/i.test(period)) {
    return parts
      .filter((p) => p.type !== "dayPeriod")
      .map((p) => p.value)
      .join("")
      .trim()
  }
  const h = parts.find((p) => p.type === "hour")?.value ?? ""
  const m = parts.find((p) => p.type === "minute")?.value ?? "00"
  return `${h}${m === "00" ? "" : `:${m}`}${period[0].toUpperCase()}`
}

/**
 * A duration in the viewer's locale: '15 min', '1 hr', '1 hr 30 min'.
 * Null for zero or less.
 */
export function formatDuration(
  minutes: number,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const total = Math.round(minutes)
  if (!(total > 0)) return null
  const unit = (value: number, u: "hour" | "minute") =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: u,
      unitDisplay: "short",
    }).format(value)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return unit(m, "minute")
  if (m === 0) return unit(h, "hour")
  return `${unit(h, "hour")} ${unit(m, "minute")}`
}

/** Short weekday of an instant in the calendar's timezone, e.g. 'Thu'. */
export function formatWeekdayAt(
  t: number,
  timeZone: string,
  style: "short" | "long" = "short",
  locale: string = DEFAULT_LOCALE,
) {
  return new Intl.DateTimeFormat(locale, { weekday: style, timeZone }).format(t)
}

/* ------------------------------------------------------------------------ */
/* Events and proposals                                                     */
/* ------------------------------------------------------------------------ */

export type Interval = {
  start: number
  end: number
  allDay: boolean
  /** First day, as a day key. */
  startKey: string
  /** Day after the last day, as a day key (exclusive). */
  endKey: string
}

/**
 * When an event happens. All-day events use calendar dates with an
 * exclusive end ('2026-10-15' to '2026-10-17' is two days); an end on or
 * before the start is treated as one day.
 */
export function eventInterval(
  e: { start: string; end: string; allDay?: boolean },
  timeZone: string,
): Interval | null {
  const allDay = e.allDay === true || isDateOnly(e.start)
  if (allDay) {
    const startKey = isDateOnly(e.start)
      ? normalizeDayKey(e.start)
      : (() => {
          const t = parseInstant(e.start, timeZone)
          return t === null ? null : dayKeyOf(t, timeZone)
        })()
    if (!startKey) return null
    let endKey: string | null = null
    if (isDateOnly(e.end)) endKey = normalizeDayKey(e.end)
    else {
      const t = parseInstant(e.end, timeZone)
      if (t !== null) endKey = addDays(dayKeyOf(t - 1, timeZone), 1)
    }
    if (!endKey || diffDays(startKey, endKey) < 1) endKey = addDays(startKey, 1)
    return {
      allDay: true,
      startKey,
      endKey,
      start: parseInstant(startKey, timeZone) ?? 0,
      end: parseInstant(endKey, timeZone) ?? 0,
    }
  }
  const start = parseInstant(e.start, timeZone)
  let end = parseInstant(e.end, timeZone)
  if (start === null) return null
  if (end === null || end < start) end = start
  return {
    allDay: false,
    start,
    end,
    startKey: dayKeyOf(start, timeZone),
    endKey: addDays(dayKeyOf(Math.max(start, end - 1), timeZone), 1),
  }
}

/** Whether an event blocks time. Timed events do unless busy is false; all-day events only when busy is true. */
export function isBusy(e: { busy?: boolean; allDay?: boolean; start: string }) {
  if (e.busy !== undefined) return e.busy
  return !(e.allDay === true || isDateOnly(e.start))
}

export type AppliedEvent = CalendarEventLike & {
  /** Set on events a proposal created or moved. */
  change?: "added" | "moved"
  proposalId?: string
  /** Where a moved event was before. */
  previous?: { start: string; end: string }
}

/**
 * The schedule after applying proposals. `accepted` limits which apply
 * (all when omitted). Moves keep the event's id and details; creates use the
 * proposal id; cancels remove the event. Proposals pointing at a missing
 * event are ignored.
 */
export function applyProposals(
  events: CalendarEventLike[],
  proposals: CalendarProposalLike[],
  accepted?: Iterable<string>,
): AppliedEvent[] {
  const keep = accepted ? new Set(accepted) : null
  const active = proposals.filter((p) => !keep || keep.has(p.id))
  const moves = new Map<string, CalendarProposalLike>()
  const cancels = new Set<string>()
  for (const p of active) {
    if (p.kind === "move" && p.eventId) moves.set(p.eventId, p)
    if (p.kind === "cancel" && p.eventId) cancels.add(p.eventId)
  }
  const out: AppliedEvent[] = []
  for (const e of events) {
    if (cancels.has(e.id)) continue
    const move = moves.get(e.id)
    if (move) {
      out.push({
        ...e,
        start: move.start,
        end: move.end,
        allDay: false,
        change: "moved",
        proposalId: move.id,
        previous: { start: e.start, end: e.end },
      })
    } else out.push(e)
  }
  for (const p of active) {
    if (p.kind !== "create") continue
    out.push({
      id: p.id,
      title: p.title,
      start: p.start,
      end: p.end,
      change: "added",
      proposalId: p.id,
    })
  }
  return out
}

/**
 * For each accepted create or move, the busy events it overlaps in the
 * schedule that results from the other accepted proposals. The event being
 * moved never conflicts with itself, and cancelled events don't count.
 */
export function findConflicts(
  events: CalendarEventLike[],
  proposals: CalendarProposalLike[],
  timeZone: string,
  accepted?: Iterable<string>,
): Map<string, AppliedEvent[]> {
  const keep = accepted ? new Set(accepted) : null
  const active = proposals.filter((p) => !keep || keep.has(p.id))
  const result = new Map<string, AppliedEvent[]>()
  for (const p of active) {
    if (p.kind === "cancel") continue
    const span = eventInterval(p, timeZone)
    if (!span) continue
    const others = active.filter((q) => q.id !== p.id).map((q) => q.id)
    const schedule = applyProposals(events, proposals, others)
    const hits = schedule.filter((e) => {
      if (e.id === p.id || (p.eventId && e.id === p.eventId)) return false
      if (!isBusy(e)) return false
      const iv = eventInterval(e, timeZone)
      return !!iv && iv.start < span.end && span.start < iv.end
    })
    if (hits.length) result.set(p.id, hits)
  }
  return result
}

/* ------------------------------------------------------------------------ */
/* Layout                                                                   */
/* ------------------------------------------------------------------------ */

export type Segment = {
  key: string
  /** Minutes from local midnight. */
  startMin: number
  endMin: number
}

/** Shortest block the layout reserves, so tiny events still get a lane. */
const MIN_LAYOUT_MINUTES = 20

/**
 * Side-by-side columns for overlapping blocks within one day. Blocks that
 * overlap (directly or through a chain) form a cluster that shares the same
 * column count; each block takes the first free column.
 */
export function layoutColumns(
  segments: Segment[],
): Map<string, { col: number; cols: number }> {
  const sorted = [...segments].sort(
    (a, b) =>
      a.startMin - b.startMin ||
      b.endMin - b.startMin - (a.endMin - a.startMin) ||
      // Fixed locale: an internal tiebreak, never shown.
      a.key.localeCompare(b.key, "en"),
  )
  const result = new Map<string, { col: number; cols: number }>()
  let cluster: { key: string; col: number }[] = []
  let columnsEnd: number[] = []
  let clusterEnd = -1
  const flush = () => {
    const cols = columnsEnd.length
    for (const c of cluster) result.set(c.key, { col: c.col, cols })
    cluster = []
    columnsEnd = []
  }
  for (const s of sorted) {
    const end = Math.max(s.endMin, s.startMin + MIN_LAYOUT_MINUTES)
    if (cluster.length && s.startMin >= clusterEnd) flush()
    let col = columnsEnd.findIndex((e) => e <= s.startMin)
    if (col === -1) {
      col = columnsEnd.length
      columnsEnd.push(end)
    } else columnsEnd[col] = end
    cluster.push({ key: s.key, col })
    clusterEnd = cluster.length === 1 ? end : Math.max(clusterEnd, end)
  }
  flush()
  return result
}

/**
 * The part of a timed interval that falls on a day, in wall-clock minutes
 * (0–1440), or null when it doesn't touch that day.
 */
export function segmentOnDay(
  iv: { start: number; end: number },
  day: string,
  timeZone: string,
): { startMin: number; endMin: number } | null {
  const dayStart = parseInstant(day, timeZone)
  const nextStart = parseInstant(addDays(day, 1), timeZone)
  if (dayStart === null || nextStart === null) return null
  const end = Math.max(iv.end, iv.start)
  // Zero-length events still show on the day they happen.
  if (end === iv.start) {
    if (iv.start < dayStart || iv.start >= nextStart) return null
  } else if (!(iv.start < nextStart && end > dayStart)) return null
  const startMin = iv.start <= dayStart ? 0 : minutesOfDay(iv.start, timeZone)
  const endMin = end >= nextStart ? 1440 : minutesOfDay(end, timeZone)
  return { startMin, endMin: Math.max(endMin, startMin) }
}

/** Chronological order: start, then all-day first, then longer first. */
export function compareIntervals(a: Interval, b: Interval): number {
  if (a.startKey !== b.startKey) return a.startKey < b.startKey ? -1 : 1
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1
  return a.start - b.start || b.end - b.start - (a.end - a.start)
}

