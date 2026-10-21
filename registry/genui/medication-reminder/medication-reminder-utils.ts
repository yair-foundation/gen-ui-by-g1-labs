/**
 * Medication Reminder: pure schedule logic, no React.
 *
 * Every date is a calendar day ("YYYY-MM-DD") in the schedule's time zone, and
 * every dose time is a wall-clock time in that zone, so "08:00" stays 08:00
 * across daylight-saving changes. Nothing here invents a schedule: it only
 * reads the one it is given.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type Frequency = "daily" | "weekly" | "every-n-days" | "as-needed"

export type Schedule = {
  frequency: Frequency
  timesPerDay?: number
  times?: string[]
  daysOfWeek?: number[]
  everyNDays?: number
  startDate?: string
  endDate?: string
}

export type DoseLogStatus = "taken" | "skipped"

export type LogEntry = {
  at: string
  status: DoseLogStatus
  /** The dose this entry is for. When missing, matched to the nearest dose that day. */
  scheduledFor?: string
}

/** One scheduled dose on a day. */
export type Slot = {
  /** Identifies the dose: an ISO instant for timed doses, the day for untimed ones. */
  scheduledFor: string
  /** "08:00", when the schedule has times. */
  time?: string
  /** Epoch ms of a timed dose. */
  instant?: number
  /** 0-based position in the day. */
  index: number
}

export type DoseState = "taken" | "skipped" | "missed" | "due" | "upcoming"

export type Dose = Slot & { state: DoseState; entry?: LogEntry }

export type DayState =
  | "not-scheduled"
  | "upcoming"
  | "taken"
  | "partial"
  | "skipped"
  | "missed"

export type WeekDay = {
  day: string
  /** 0 = Sunday. */
  weekday: number
  isToday: boolean
  isPast: boolean
  scheduled: boolean
  state: DayState
  doses: Dose[]
  /** As-needed: doses logged that day. */
  logged: LogEntry[]
}

const MINUTE = 60_000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

// ---------------------------------------------------------------------------
// Time zones

export function isValidTimeZone(timeZone: string | undefined): boolean {
  if (!timeZone) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

/** The given zone when valid, else the viewer's (UTC when unknown). */
export function safeTimeZone(timeZone: string | undefined): string {
  if (timeZone && isValidTimeZone(timeZone)) return timeZone
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

type ZonedParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

export function zonedParts(t: number, timeZone: string): ZonedParts {
  const out: Record<string, number> = {}
  for (const p of partsFormatter(timeZone).formatToParts(new Date(t))) {
    if (p.type !== "literal") out[p.type] = Number(p.value)
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  }
}

function offsetMinutes(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / MINUTE)
}

/** The calendar day an instant falls on in a zone. */
export function dayInZone(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** The instant a wall-clock "HH:MM" happens on a day in a zone (DST-safe). */
export function zonedTimeToInstant(
  day: string,
  time: string,
  timeZone: string,
): number {
  const d = parseDay(day)
  const m = TIME_RE.exec(time)
  if (!d || !m) return Number.NaN
  const guess = Date.UTC(d.year, d.month - 1, d.day, Number(m[1]), Number(m[2]))
  const first = offsetMinutes(guess, timeZone)
  let t = guess - first * MINUTE
  // Near a DST change the offset at the guess can differ from the real one.
  const again = offsetMinutes(t, timeZone)
  if (again !== first) t = guess - again * MINUTE
  return t
}

// ---------------------------------------------------------------------------
// Calendar days

const pad = (n: number) => String(n).padStart(2, "0")

export function parseDay(
  value: string | undefined,
): { year: number; month: number; day: number } | null {
  const m = value ? DAY_RE.exec(value) : null
  if (!m) return null
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return { year, month, day }
}

/** "2026-10-14" or the date part of an ISO string; null when malformed. */
export function normalizeDay(value: string | undefined): string | null {
  if (!value) return null
  const key = value.slice(0, 10)
  return parseDay(key) ? key : null
}

function dayToUtc(day: string): number {
  const d = parseDay(day)
  return d ? Date.UTC(d.year, d.month - 1, d.day) : Number.NaN
}

export function addDays(day: string, n: number): string {
  const t = dayToUtc(day) + n * 86_400_000
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

/** Whole days from `b` to `a` (a − b). */
export function diffDays(a: string, b: string): number {
  return Math.round((dayToUtc(a) - dayToUtc(b)) / 86_400_000)
}

/** 0 = Sunday. */
export function weekdayOf(day: string): number {
  return new Date(dayToUtc(day)).getUTCDay()
}

/** The 7 days of the week containing `today`, starting on `weekStart`. */
export function weekDays(today: string, weekStart: 0 | 1): string[] {
  const start = addDays(today, -((weekdayOf(today) - weekStart + 7) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

// ---------------------------------------------------------------------------
// Schedule

/** Doses per scheduled day: the listed times, else timesPerDay, else 1. */
export function dosesPerDay(schedule: Schedule): number {
  const times = validTimes(schedule.times)
  if (times.length > 0) return times.length
  const n = Math.floor(schedule.timesPerDay ?? 1)
  return Math.min(12, Math.max(1, Number.isFinite(n) ? n : 1))
}

function validTimes(times: string[] | undefined): string[] {
  return [...new Set((times ?? []).filter((t) => TIME_RE.test(t)))].sort()
}

function weeklyDays(schedule: Schedule): number[] {
  const days = [
    ...new Set(
      (schedule.daysOfWeek ?? []).filter(
        (d) => Number.isInteger(d) && d >= 0 && d <= 6,
      ),
    ),
  ]
  if (days.length > 0) return days.sort()
  const start = normalizeDay(schedule.startDate)
  return start ? [weekdayOf(start)] : []
}

/**
 * Whether doses are scheduled on a day. Every-n-days counts from startDate,
 * or from `anchor` (e.g. today) when the schedule has none.
 */
export function isScheduledOn(
  schedule: Schedule,
  day: string,
  anchor?: string,
): boolean {
  const start = normalizeDay(schedule.startDate)
  const end = normalizeDay(schedule.endDate)
  if (start && day < start) return false
  if (end && day > end) return false
  switch (schedule.frequency) {
    case "daily":
      return true
    case "weekly":
      return weeklyDays(schedule).includes(weekdayOf(day))
    case "every-n-days": {
      const n = Math.max(1, Math.floor(schedule.everyNDays ?? 1))
      const from = start ?? anchor
      if (!from) return false
      return ((diffDays(day, from) % n) + n) % n === 0
    }
    default:
      return false
  }
}

/** The scheduled doses on one day (empty when none are scheduled). */
export function slotsForDay(
  schedule: Schedule,
  day: string,
  timeZone: string,
  anchor?: string,
): Slot[] {
  if (!isScheduledOn(schedule, day, anchor)) return []
  const times = validTimes(schedule.times)
  if (times.length > 0) {
    return times.map((time, index) => {
      const instant = zonedTimeToInstant(day, time, timeZone)
      return {
        scheduledFor: new Date(instant).toISOString(),
        time,
        instant,
        index,
      }
    })
  }
  return Array.from({ length: dosesPerDay(schedule) }, (_, index) => ({
    scheduledFor: day,
    index,
  }))
}

/** Scheduled doses for each day of the week containing `today`. */
export function scheduleForWeek(
  schedule: Schedule,
  today: string,
  weekStart: 0 | 1,
  timeZone: string,
): { day: string; slots: Slot[] }[] {
  return weekDays(today, weekStart).map((day) => ({
    day,
    slots: slotsForDay(schedule, day, timeZone, today),
  }))
}

// ---------------------------------------------------------------------------
// Frequency text

export type FrequencyText = {
  /** The big number, or null ("As needed"). */
  count: number | null
  /** Small text before the number ("Every"). */
  prefix?: string
  /** Text beside the number ("times per week"). */
  label: string
  /** Extra line, e.g. "2 doses each day". */
  detail?: string
  /** The whole thing as one phrase, for screen readers. */
  text: string
}

export function frequencyText(schedule: Schedule): FrequencyText {
  const perDay = dosesPerDay(schedule)
  const detail = perDay > 1 ? `${perDay} doses each day` : undefined
  switch (schedule.frequency) {
    case "daily":
      return {
        count: perDay,
        label: perDay === 1 ? "time a day" : "times a day",
        text: perDay === 1 ? "Once a day" : `${perDay} times a day`,
      }
    case "weekly": {
      const days = weeklyDays(schedule).length
      const label = days === 1 ? "time per week" : "times per week"
      return {
        count: days,
        label,
        detail,
        text: `${days} ${label}${detail ? `, ${detail}` : ""}`,
      }
    }
    case "every-n-days": {
      const n = Math.max(1, Math.floor(schedule.everyNDays ?? 1))
      return {
        count: n,
        prefix: "Every",
        label: n === 1 ? "day" : "days",
        detail,
        text: `Every ${n === 1 ? "day" : `${n} days`}${detail ? `, ${detail}` : ""}`,
      }
    }
    default:
      return { count: null, label: "As needed", text: "As needed" }
  }
}

// ---------------------------------------------------------------------------
// Log → dose states

function entryDay(entry: LogEntry, timeZone: string): string | null {
  const target = entry.scheduledFor
  if (target) {
    if (DAY_RE.test(target)) return normalizeDay(target)
    const t = Date.parse(target)
    if (Number.isFinite(t)) return dayInZone(t, timeZone)
  }
  const at = Date.parse(entry.at)
  return Number.isFinite(at) ? dayInZone(at, timeZone) : null
}

/**
 * Pairs a day's log entries with its doses. Entries naming a dose go to that
 * dose (a later entry for the same dose replaces an earlier one); the rest
 * take the nearest open dose in time order, or the next open one when the
 * doses have no times.
 */
export function matchEntries(
  slots: Slot[],
  entries: LogEntry[],
): (LogEntry | undefined)[] {
  const out: (LogEntry | undefined)[] = slots.map(() => undefined)
  const loose: LogEntry[] = []
  for (const entry of entries) {
    const target = entry.scheduledFor
    let index = -1
    if (target && DAY_RE.test(target)) {
      // Untimed dose: the first one not yet named by an entry.
      index = slots.findIndex((s, i) => s.time === undefined && !out[i])
    } else if (target) {
      const t = Date.parse(target)
      index = slots.findIndex((s) => s.instant === t)
    }
    if (index >= 0) out[index] = entry
    else loose.push(entry)
  }
  const sorted = [...loose].sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  for (const entry of sorted) {
    const at = Date.parse(entry.at)
    let best = -1
    for (const [i, s] of slots.entries()) {
      if (out[i]) continue
      if (best === -1) best = i
      else if (
        s.instant !== undefined &&
        Math.abs(s.instant - at) < Math.abs((slots[best].instant ?? 0) - at)
      ) {
        best = i
      }
    }
    if (best >= 0) out[best] = entry
  }
  return out
}

function doseState(
  entry: LogEntry | undefined,
  slot: Slot,
  day: string,
  today: string,
  now: number,
): DoseState {
  if (entry) return entry.status
  if (day < today) return "missed"
  if (day > today) return "upcoming"
  return slot.instant !== undefined && slot.instant <= now ? "due" : "upcoming"
}

function summarize(doses: Dose[]): DayState {
  if (doses.length === 0) return "not-scheduled"
  if (doses.some((d) => d.state === "due" || d.state === "upcoming")) {
    return "upcoming"
  }
  const taken = doses.filter((d) => d.state === "taken").length
  if (taken === doses.length) return "taken"
  if (taken > 0) return "partial"
  if (doses.every((d) => d.state === "skipped")) return "skipped"
  return "missed"
}

/**
 * The week containing `now` for one medication: which days are scheduled and
 * how each went. Missed only applies to past days; today's doses are due
 * (time passed) or upcoming until logged.
 */
export function dayStates(
  schedule: Schedule,
  log: LogEntry[],
  opts: { now: number; timeZone: string; weekStart: 0 | 1 },
): WeekDay[] {
  const { now, timeZone, weekStart } = opts
  const today = dayInZone(now, timeZone)
  const byDay = new Map<string, LogEntry[]>()
  for (const entry of log) {
    const day = entryDay(entry, timeZone)
    if (!day) continue
    byDay.set(day, [...(byDay.get(day) ?? []), entry])
  }
  return scheduleForWeek(schedule, today, weekStart, timeZone).map(
    ({ day, slots }) => {
      const entries = byDay.get(day) ?? []
      const matched = matchEntries(slots, entries)
      const doses: Dose[] = slots.map((slot, i) => ({
        ...slot,
        entry: matched[i],
        state: doseState(matched[i], slot, day, today, now),
      }))
      const logged =
        schedule.frequency === "as-needed"
          ? entries
              .filter((e) => e.status === "taken")
              .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
          : []
      return {
        day,
        weekday: weekdayOf(day),
        isToday: day === today,
        isPast: day < today,
        scheduled: slots.length > 0,
        state:
          schedule.frequency === "as-needed"
            ? logged.length > 0
              ? "taken"
              : "not-scheduled"
            : summarize(doses),
        doses,
        logged,
      }
    },
  )
}

/** Today's scheduled doses with their states, in time order. */
export function dosesDueToday(
  schedule: Schedule,
  log: LogEntry[],
  opts: { now: number; timeZone: string },
): Dose[] {
  const today = dayInZone(opts.now, opts.timeZone)
  const week = dayStates(schedule, log, { ...opts, weekStart: 0 })
  return week.find((d) => d.day === today)?.doses ?? []
}

// ---------------------------------------------------------------------------
// Course and supply

/** Days from today to the course's last day (0 = ends today, < 0 = ended). */
export function courseDaysLeft(
  endDate: string | undefined,
  today: string,
): number | null {
  const end = normalizeDay(endDate)
  return end ? diffDays(end, today) : null
}

/** Average doses per day over the schedule; null for as-needed. */
export function averageDosesPerDay(schedule: Schedule): number | null {
  const perDay = dosesPerDay(schedule)
  switch (schedule.frequency) {
    case "daily":
      return perDay
    case "weekly":
      return (weeklyDays(schedule).length * perDay) / 7
    case "every-n-days":
      return perDay / Math.max(1, Math.floor(schedule.everyNDays ?? 1))
    default:
      return null
  }
}

/** Whole days the remaining supply lasts at this schedule; null when unknown. */
export function refillDaysOfSupply(
  schedule: Schedule,
  remaining: number,
): number | null {
  const perDay = averageDosesPerDay(schedule)
  if (!perDay || !Number.isFinite(remaining) || remaining < 0) return null
  return Math.floor(remaining / perDay)
}

/**
 * Supply runs out within `threshold` days, and before the course ends (a
 * course that finishes first needs no refill).
 */
export function isSupplyLow(
  daysOfSupply: number | null,
  daysLeftInCourse: number | null,
  threshold = 7,
): boolean {
  if (daysOfSupply === null || daysOfSupply > threshold) return false
  if (daysLeftInCourse !== null && daysOfSupply > daysLeftInCourse) return false
  return true
}

// ---------------------------------------------------------------------------
// Formatting

/** "8:05 AM" in the zone. */
export function formatTime(
  t: number,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(new Date(t))
}

/** "Oct 14" (or "Wednesday" with style "weekday"). */
export function formatDay(
  day: string,
  locale: string = DEFAULT_LOCALE,
  style: "short" | "weekday" | "narrow" = "short",
): string {
  const t = dayToUtc(day)
  if (!Number.isFinite(t)) return day
  const opts: Intl.DateTimeFormatOptions =
    style === "short"
      ? { month: "short", day: "numeric", timeZone: "UTC" }
      : {
          weekday: style === "weekday" ? "long" : "narrow",
          timeZone: "UTC",
        }
  return new Intl.DateTimeFormat(locale, opts).format(new Date(t))
}

/** "Monday, scheduled, taken at 8:05 AM": one phrase per day for screen readers. */
export function dayLabel(
  d: WeekDay,
  opts: { timeZone: string; locale?: string },
): string {
  const parts = [formatDay(d.day, opts.locale, "weekday")]
  if (d.isToday) parts.push("today")
  const at = (e: LogEntry | undefined) => {
    const t = e ? Date.parse(e.at) : Number.NaN
    return Number.isFinite(t) ? formatTime(t, opts.timeZone, opts.locale) : null
  }
  if (!d.scheduled) {
    if (d.logged.length === 1) {
      const time = at(d.logged[0])
      parts.push(time ? `taken at ${time}` : "taken")
    } else if (d.logged.length > 1) {
      parts.push(`taken ${d.logged.length} times`)
    } else {
      parts.push("not scheduled")
    }
    return parts.join(", ")
  }
  parts.push("scheduled")
  const total = d.doses.length
  const taken = d.doses.filter((x) => x.state === "taken").length
  const single = total === 1 ? d.doses[0] : undefined
  switch (d.state) {
    case "taken": {
      const time = single ? at(single.entry) : null
      parts.push(
        total === 1
          ? time
            ? `taken at ${time}`
            : "taken"
          : `all ${total} doses taken`,
      )
      break
    }
    case "partial":
      parts.push(`${taken} of ${total} doses taken`)
      break
    case "skipped":
      parts.push("skipped")
      break
    case "missed":
      parts.push(total === 1 ? "missed" : `${total} doses missed`)
      break
    default:
      if (taken > 0) parts.push(`${taken} of ${total} doses taken so far`)
      else if (d.isToday) parts.push("not taken yet")
      else parts.push("upcoming")
  }
  return parts.join(", ")
}
