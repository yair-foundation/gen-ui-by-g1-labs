/**
 * Flight status: pure helpers. Intl only, no date library, no React, no DOM:
 * safe to reuse on the server and to unit-test in Node.
 *
 * Every time is an instant (ms since the epoch) shown in the airport's own
 * IANA timezone.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type FlightState =
  | "scheduled"
  | "boarding"
  | "departed"
  | "en-route"
  | "landed"
  | "arrived"
  | "delayed"
  | "cancelled"
  | "diverted"

export type TimeTriple = {
  scheduled: string
  estimated?: string
  actual?: string
}

/** States before the aircraft leaves the gate. */
export const PRE_DEPARTURE: readonly FlightState[] = [
  "scheduled",
  "boarding",
  "delayed",
  "cancelled",
]

/** States while the aircraft is in the air. */
export const IN_AIR: readonly FlightState[] = ["departed", "en-route"]

/** Within this many minutes either way, a time counts as on time. */
export const ON_TIME_MINUTES = 5

const MINUTE = 60_000

/* ------------------------------------------------------------------------ */
/* Timezones                                                                */
/* ------------------------------------------------------------------------ */

const partsCache = new Map<string, Intl.DateTimeFormat>()

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

/** Offset from UTC in minutes at an instant. */
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
  const second = offsetMinutes(t, timeZone)
  if (second !== first) t = guess - second * MINUTE
  return t
}

const floating =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i

/**
 * An ISO time as an instant. With an offset it is exact; without one it is
 * wall-clock time at the airport. Null when unparseable.
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
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

/** 24-hour clock time at the airport: '07:40'. */
export function formatClock(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

/** The local date at the airport: 'Thu, Oct 8' (or 'Thursday, October 8'). */
export function formatDate(
  t: number,
  timeZone: string,
  style: "short" | "long" = "short",
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: style,
    month: style,
    day: "numeric",
    timeZone: safeTimeZone(timeZone),
  }).format(t)
}

/** The airport's UTC offset at an instant: 'GMT+1', 'GMT-4', 'GMT+5:30'. */
export function formatOffset(t: number, timeZone: string): string {
  const m = offsetMinutes(t, timeZone)
  const sign = m < 0 ? "-" : "+"
  const abs = Math.abs(m)
  const h = Math.floor(abs / 60)
  const min = abs % 60
  return `GMT${sign}${h}${min ? `:${String(min).padStart(2, "0")}` : ""}`
}

/** Spoken context for a time: 'Lisbon time (GMT+1)'. */
export function zoneLabel(city: string, t: number, timeZone: string): string {
  return `${city} time (${formatOffset(t, timeZone)})`
}

function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/** Calendar days from the local departure date to the local arrival date. */
export function dayOffset(
  depart: number,
  departZone: string,
  arrive: number,
  arriveZone: string,
): number {
  const a = Date.parse(`${dayKey(depart, departZone)}T12:00:00Z`)
  const b = Date.parse(`${dayKey(arrive, arriveZone)}T12:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** Hours and minutes of a span, for big displays: 174 → { h: 2, m: 54 }. */
export function splitMinutes(minutes: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(minutes))
  return { h: Math.floor(total / 60), m: total % 60 }
}

/** '7 h 45 min', '55 min', '2 h'. */
export function formatDuration(minutes: number): string {
  const { h, m } = splitMinutes(minutes)
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** A span, coarser as it grows: '40 min', '3 h 10 min', '1 day 3 h', '4 days'. */
export function formatSpan(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / MINUTE)
  if (minutes < 1) return "less than a minute"
  if (minutes < 24 * 60) return formatDuration(minutes)
  const days = Math.floor(minutes / (24 * 60))
  if (days >= 2) return `${days} days`
  const hours = Math.round((minutes - 24 * 60) / 60)
  return hours === 0 ? "1 day" : `1 day ${hours} h`
}

/* ------------------------------------------------------------------------ */
/* Times, delays and progress                                               */
/* ------------------------------------------------------------------------ */

export type EffectiveTime = {
  /** Actual when known, else estimated, else scheduled. */
  t: number
  kind: "actual" | "estimated" | "scheduled"
  scheduled: number
}

/** The best known time for one end of the flight. */
export function effectiveTime(
  times: Partial<TimeTriple> | undefined,
  timeZone: string,
): EffectiveTime | null {
  if (!times) return null
  const scheduled = toInstant(times.scheduled, timeZone)
  if (scheduled === null) return null
  const actual = toInstant(times.actual, timeZone)
  if (actual !== null) return { t: actual, kind: "actual", scheduled }
  const estimated = toInstant(times.estimated, timeZone)
  if (estimated !== null) return { t: estimated, kind: "estimated", scheduled }
  return { t: scheduled, kind: "scheduled", scheduled }
}

/** Minutes late (positive) or early (negative) against the schedule. */
export function delayMinutes(time: EffectiveTime | null): number | null {
  if (!time) return null
  return Math.round((time.t - time.scheduled) / MINUTE)
}

/** Whether the shown time differs from the schedule by at least a minute. */
export function timeChanged(time: EffectiveTime | null): boolean {
  const d = delayMinutes(time)
  return d !== null && d !== 0
}

/**
 * The delay worth reporting for a state: the departure delay before the
 * flight leaves, the arrival delay after. Null when unknown.
 */
export function stateDelay(
  state: FlightState | undefined,
  depart: EffectiveTime | null,
  arrive: EffectiveTime | null,
): number | null {
  if (state && PRE_DEPARTURE.includes(state)) {
    return delayMinutes(depart) ?? delayMinutes(arrive)
  }
  return delayMinutes(arrive) ?? delayMinutes(depart)
}

export type Punctuality = {
  kind: "on-time" | "early" | "late"
  minutes: number
  text: string
}

/** 'On time', '12 min early', 'Delayed 45 min'. Null when unknown. */
export function punctuality(delay: number | null): Punctuality | null {
  if (delay === null) return null
  if (Math.abs(delay) < ON_TIME_MINUTES) {
    return { kind: "on-time", minutes: delay, text: "On time" }
  }
  if (delay < 0) {
    return {
      kind: "early",
      minutes: -delay,
      text: `${formatDuration(-delay)} early`,
    }
  }
  return {
    kind: "late",
    minutes: delay,
    text: `Delayed ${formatDuration(delay)}`,
  }
}

/**
 * How far along the flight is, 0–1. Landed and arrived are 1; anything before
 * departure is 0. In the air: the given progress, else elapsed time over the
 * expected flight time. Null in the air when neither is known (before mount).
 */
export function deriveProgress(
  state: FlightState | undefined,
  depart: EffectiveTime | null,
  arrive: EffectiveTime | null,
  now: number | null,
  progress?: number,
): number | null {
  if (state === "landed" || state === "arrived") return 1
  if (!state || PRE_DEPARTURE.includes(state)) return 0
  if (typeof progress === "number" && Number.isFinite(progress)) {
    return Math.min(1, Math.max(0, progress))
  }
  if (now === null || !depart || !arrive || arrive.t <= depart.t) return null
  return Math.min(1, Math.max(0, (now - depart.t) / (arrive.t - depart.t)))
}

/** Whole minutes from now until the expected arrival, never negative. */
export function remainingMinutes(
  arrive: EffectiveTime | null,
  now: number | null,
): number | null {
  if (!arrive || now === null) return null
  return Math.max(0, Math.round((arrive.t - now) / MINUTE))
}

/**
 * The one-line relative status: 'Departs in 1 h 29 min', 'Arrives in
 * 2 h 54 min', 'Landed 12 min ago'. Null before mount or when it can't be
 * said (cancelled, diverted).
 */
export function relativeText(
  state: FlightState | undefined,
  depart: EffectiveTime | null,
  arrive: EffectiveTime | null,
  now: number | null,
): string | null {
  if (now === null || !state) return null
  if (state === "cancelled" || state === "diverted") return null
  if (state === "landed" || state === "arrived") {
    if (!arrive) return null
    const verb = state === "landed" ? "Landed" : "Arrived"
    const ago = now - arrive.t
    return ago < MINUTE ? `${verb} just now` : `${verb} ${formatSpan(ago)} ago`
  }
  if (IN_AIR.includes(state)) {
    const left = remainingMinutes(arrive, now)
    if (left === null) return null
    return left === 0 ? "Arriving now" : `Arrives in ${formatDuration(left)}`
  }
  if (!depart) return null
  if (now >= depart.t) return state === "boarding" ? "Boarding" : null
  return `Departs in ${formatSpan(depart.t - now)}`
}

/** Airport whose clock the update times and 'As of' use. */
export function referenceEnd(state: FlightState | undefined): "from" | "to" {
  return state && PRE_DEPARTURE.includes(state) ? "from" : "to"
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
