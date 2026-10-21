/**
 * Flight offers: pure helpers. Intl only, no date library, no React, no DOM:
 * safe to reuse on the server and to unit-test in Node.
 *
 * Every time is an instant (ms since the epoch) shown in the airport's own
 * IANA timezone, so "12:55" in Tel Aviv stays 12:55 for a viewer in Tokyo.
 * The timezone helpers are copied from flight-ticket so each file installs
 * on its own.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type OfferSort = "price" | "duration" | "departure"

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

/** Offset from UTC in minutes at an instant, e.g. 120 for Athens in winter. */
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

/** 24-hour clock time at the airport, as on boarding passes: '07:40'. */
export function formatClock(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`
}

/** The local date at the airport: 'Thu, Nov 12' (or 'Thursday, November 12'). */
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

/** The calendar date of an instant at the airport, as 'YYYY-MM-DD'. */
export function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/**
 * Calendar days between the local departure date and the local arrival date:
 * 1 for an overnight flight that lands the next day ('+1'), 0 for same day,
 * -1 when crossing the date line westward.
 */
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

/* ------------------------------------------------------------------------ */
/* Durations                                                                */
/* ------------------------------------------------------------------------ */

/** Compact, as on fare sites: '2h 20m', '1h 05m', '45m', '3h'. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h === 0) return `${rest}m`
  return rest === 0 ? `${h}h` : `${h}h ${String(rest).padStart(2, "0")}m`
}

/** For screen readers: '2 hours 20 minutes', '1 hour', '45 minutes'. */
export function spokenDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rest = m % 60
  const hours = h === 1 ? "1 hour" : `${h} hours`
  const mins = rest === 1 ? "1 minute" : `${rest} minutes`
  if (h === 0) return mins
  return rest === 0 ? hours : `${hours} ${mins}`
}

/* ------------------------------------------------------------------------ */
/* Legs                                                                     */
/* ------------------------------------------------------------------------ */

export type AirportLike = { code: string; timeZone: string }

export type SegmentLike = {
  from: AirportLike
  to: AirportLike
  departAt: string
  arriveAt: string
}

export type LegLike = { segments: SegmentLike[] }

export type OfferLike = { id: string; price: number; legs: LegLike[] }

/** Departure and arrival instants of a segment, or null when unparseable. */
export function segmentTimes(
  s: SegmentLike,
): { depart: number; arrive: number } | null {
  const depart = toInstant(s.departAt, s.from.timeZone)
  const arrive = toInstant(s.arriveAt, s.to.timeZone)
  if (depart === null || arrive === null) return null
  return { depart, arrive }
}

/** First departure and last arrival of a leg, or null. */
export function legTimes(
  leg: LegLike,
): { depart: number; arrive: number } | null {
  const first = leg.segments[0]
  const last = leg.segments[leg.segments.length - 1]
  if (!first || !last) return null
  const a = segmentTimes(first)
  const b = segmentTimes(last)
  if (!a || !b) return null
  return { depart: a.depart, arrive: b.arrive }
}

/** Door-to-door minutes of a leg, layovers included, or null. */
export function legMinutes(leg: LegLike): number | null {
  const t = legTimes(leg)
  if (!t || t.arrive < t.depart) return null
  return Math.round((t.arrive - t.depart) / MINUTE)
}

/** '+1' days at arrival, in each airport's own calendar. */
export function legDayOffset(leg: LegLike): number {
  const t = legTimes(leg)
  const first = leg.segments[0]
  const last = leg.segments[leg.segments.length - 1]
  if (!t || !first || !last) return 0
  return dayOffset(t.depart, first.from.timeZone, t.arrive, last.to.timeZone)
}

export type Layover = { code: string; minutes: number }

/** The connections of a leg, in order. Unparseable ones are skipped. */
export function legLayovers(leg: LegLike): Layover[] {
  const out: Layover[] = []
  for (let i = 0; i < leg.segments.length - 1; i++) {
    const a = segmentTimes(leg.segments[i])
    const b = segmentTimes(leg.segments[i + 1])
    if (!a || !b) continue
    out.push({
      code: leg.segments[i].to.code,
      minutes: Math.round((b.depart - a.arrive) / MINUTE),
    })
  }
  return out
}

/** 'Nonstop', '1 stop', '2 stops'. */
export function stopsText(stops: number): string {
  if (stops <= 0) return "Nonstop"
  return stops === 1 ? "1 stop" : `${stops} stops`
}

/** Under the duration of a connecting leg: '1 stop · ATH 1h 05m'. Null when nonstop. */
export function layoverText(leg: LegLike): string | null {
  const stops = leg.segments.length - 1
  if (stops <= 0) return null
  const list = legLayovers(leg)
    .map((l) => `${l.code} ${formatDuration(l.minutes)}`)
    .join(", ")
  return list ? `${stopsText(stops)} · ${list}` : stopsText(stops)
}

/** For screen readers: '1 stop in ATH, 1 hour 5 minutes'. */
export function spokenLayovers(leg: LegLike): string {
  const stops = leg.segments.length - 1
  if (stops <= 0) return "nonstop"
  const list = legLayovers(leg)
    .map((l) => `${l.code}, ${spokenDuration(l.minutes)}`)
    .join("; ")
  return list ? `${stopsText(stops)} in ${list}` : stopsText(stops)
}

/**
 * The offer's stops in one phrase: 'Nonstop' or '1 stop' when every leg is
 * the same, 'Nonstop / 1 stop' when they differ (outbound / return).
 */
export function offerStopsText(offer: { legs: LegLike[] }): string {
  const parts = offer.legs.map((l) => stopsText(l.segments.length - 1))
  return new Set(parts).size <= 1 ? (parts[0] ?? "") : parts.join(" / ")
}

/** Total travel minutes across legs, or null when any leg is unknown. */
export function offerMinutes(offer: { legs: LegLike[] }): number | null {
  let sum = 0
  for (const leg of offer.legs) {
    const m = legMinutes(leg)
    if (m === null) return null
    sum += m
  }
  return offer.legs.length > 0 ? sum : null
}

/** The first departure instant, or null. */
export function offerDeparture(offer: { legs: LegLike[] }): number | null {
  const first = offer.legs[0]
  return first ? (legTimes(first)?.depart ?? null) : null
}

/* ------------------------------------------------------------------------ */
/* Ranking                                                                  */
/* ------------------------------------------------------------------------ */

/** Ids with the lowest value. None when fewer than two values or all equal. */
function lowestIds<T extends { id: string }>(
  items: T[],
  value: (item: T) => number | null,
): string[] {
  const known = items.flatMap((i) => {
    const v = value(i)
    return v === null || !Number.isFinite(v) ? [] : [{ id: i.id, v }]
  })
  if (known.length < 2) return []
  const min = Math.min(...known.map((k) => k.v))
  const max = Math.max(...known.map((k) => k.v))
  if (min === max) return []
  return known.filter((k) => k.v === min).map((k) => k.id)
}

/** The cheapest offer ids (ties mark all). */
export function cheapestIds(offers: OfferLike[]): string[] {
  return lowestIds(offers, (o) => o.price)
}

/** The fastest offer ids by total travel time (ties mark all). */
export function fastestIds(offers: OfferLike[]): string[] {
  return lowestIds(offers, offerMinutes)
}

/**
 * A sorted copy: price, total duration or first departure, ascending.
 * Stable, so ties keep the agent's order. Unknown values go last.
 */
export function sortOffers<T extends OfferLike>(
  offers: T[],
  by: OfferSort,
): T[] {
  const key = (o: T): number => {
    const v =
      by === "price"
        ? o.price
        : by === "duration"
          ? offerMinutes(o)
          : offerDeparture(o)
    return v === null || !Number.isFinite(v) ? Number.POSITIVE_INFINITY : v
  }
  return offers
    .map((o, i) => ({ o, i, k: key(o) }))
    .sort((a, b) => (a.k === b.k ? a.i - b.i : a.k < b.k ? -1 : 1))
    .map((x) => x.o)
}

/* ------------------------------------------------------------------------ */
/* Text                                                                     */
/* ------------------------------------------------------------------------ */

export type Passengers = { adults: number; children?: number; infants?: number }

function count(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** '3 adults, 1 child, 1 infant'. */
export function passengersText(p: Passengers): string {
  const parts = [count(Math.max(1, p.adults), "adult", "adults")]
  if (p.children) parts.push(count(p.children, "child", "children"))
  if (p.infants) parts.push(count(p.infants, "infant", "infants"))
  return parts.join(", ")
}

/** 'Prices for 3 adults, 1 child, 1 infant' or 'Prices for 1 adult'. */
export function pricesForText(p: Passengers): string {
  return `Prices for ${passengersText(p)}`
}

/** 'No carry-on', 'Carry-on', 'Carry-on + 1 checked bag', '1 checked bag'. */
export function bagsText(bags: { carryOn: boolean; checked: number }): string {
  const checked =
    bags.checked > 0 ? count(bags.checked, "checked bag", "checked bags") : ""
  if (bags.carryOn) return checked ? `Carry-on + ${checked}` : "Carry-on"
  return checked || "No carry-on"
}

/** 'One way' or 'Round trip'. */
export function tripTypeText(legs: number): string {
  return legs >= 2 ? "Round trip" : "One way"
}

export type OfferMetaKind = "fare" | "bags" | "trip" | "refundable" | "seats"

/** The offer's meta line as typed items (so each can carry an icon): fare, bags, trip type, refundable, seats left. */
export function offerMetaItems(offer: {
  fare?: string
  bags?: { carryOn: boolean; checked: number }
  legs: unknown[]
  refundable?: boolean
  seatsLeft?: number
}): { kind: OfferMetaKind; text: string }[] {
  const items: { kind: OfferMetaKind; text: string }[] = []
  if (offer.fare) items.push({ kind: "fare", text: offer.fare })
  if (offer.bags) items.push({ kind: "bags", text: bagsText(offer.bags) })
  items.push({ kind: "trip", text: tripTypeText(offer.legs.length) })
  if (offer.refundable) items.push({ kind: "refundable", text: "Refundable" })
  if (typeof offer.seatsLeft === "number" && offer.seatsLeft <= 5) {
    items.push({
      kind: "seats",
      text: count(offer.seatsLeft, "seat left", "seats left"),
    })
  }
  return items
}

/** The offer's one meta line: fare · bags · trip type · refundable · seats left. */
export function offerMetaParts(
  offer: Parameters<typeof offerMetaItems>[0],
): string[] {
  return offerMetaItems(offer).map((i) => i.text)
}

/** '$1,486' (whole amounts without cents), '€68.50'. */
export function formatPrice(
  amount: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const whole = Number.isInteger(amount)
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(whole ? 0 : 2)}`
  }
}

/** The airline's mark: its code ('BH'), else the name's initials. */
export function airlineMark(airline: { name?: string; code?: string }): string {
  const code = airline.code?.trim()
  if (code) return code.toUpperCase().slice(0, 3)
  return (airline.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

/** A 'YYYY-MM-DD' search date as 'Thu, Nov 12'. Null when invalid. */
export function formatSearchDate(
  date: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  const t = Date.parse(`${date}T12:00:00Z`)
  if (Number.isNaN(t)) return null
  return formatDate(t, "UTC", "short", locale)
}

/** 'Thu, Nov 12 – Thu, Nov 19', or one date for one way. */
export function dateRangeText(
  depart: string | undefined,
  ret: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const a = formatSearchDate(depart, locale)
  if (!a) return null
  const b = formatSearchDate(ret, locale)
  return b ? `${a} – ${b}` : a
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
