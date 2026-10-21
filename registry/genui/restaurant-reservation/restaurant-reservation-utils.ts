/**
 * Restaurant Reservation: pure helpers. Dates are calendar dates
 * ("2026-10-16") and times are wall-clock "HH:mm" in the restaurant's time
 * zone, so they are formatted in UTC and never shift with the viewer's zone.
 * No React, no DOM: safe to reuse on the server and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type SeatingArea = "indoor" | "outdoor" | "bar" | "counter" | "private"

export type Slot = { time: string; areas?: SeatingArea[]; note?: string }

export type Deposit = {
  amount: number
  perPerson?: boolean
  refundableUntil?: string
}

export const AREA_ORDER: SeatingArea[] = [
  "indoor",
  "outdoor",
  "bar",
  "counter",
  "private",
]

const AREA_LABEL: Record<SeatingArea, string> = {
  indoor: "Indoor",
  outdoor: "Outdoor",
  bar: "Bar",
  counter: "Counter",
  private: "Private room",
}

const DAY_MS = 86_400_000
/** Slots before this time (minutes after midnight) are lunch. */
const DINNER_FROM = 16 * 60

// ---------------------------------------------------------------------------
// Times and dates

/** "19:30" as minutes after midnight, or null if it isn't a valid time. */
export function parseTime(time: string | undefined): number | null {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time?.trim() ?? "")
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** A calendar date ("2026-10-16") as UTC midnight in ms, or null. */
export function parseDate(date: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "")
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : t
}

/** A wall-clock time for display in the viewer's locale ("8:00 PM", "20:00"). */
export function formatTime(
  time: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const minutes = parseTime(time)
  if (minutes === null) return time
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(Date.UTC(2000, 0, 1, 0, minutes))
}

/** A calendar date for display, never shifted by the viewer's time zone. */
export function formatDate(
  date: string,
  style: "weekday" | "day" | "short" | "long",
  locale: string = DEFAULT_LOCALE,
): string {
  const t = parseDate(date)
  if (t === null) return date
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, { ...o, timeZone: "UTC" }).format(t)
  if (style === "weekday") return f({ weekday: "short" })
  if (style === "day") return f({ month: "short", day: "numeric" })
  // "Fri Oct 16": weekday and date without the locale's comma.
  if (style === "short") {
    return `${f({ weekday: "short" })} ${f({ month: "short", day: "numeric" })}`
  }
  return f({ weekday: "long", month: "long", day: "numeric" })
}

/**
 * The time zone as shown to the user: the IANA name with spaces, plus its
 * offset on the given date (e.g. 'GMT+3') when the runtime knows it.
 */
export function formatTimeZone(timeZone: string, date?: string): string {
  const name = timeZone.replace(/_/g, " ")
  try {
    const at = (parseDate(date) ?? Date.now()) + DAY_MS / 2
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value
    // Node's ICU says "GMT" where browsers say "GMT+0"; pick one.
    return offset ? `${name} (${offset === "GMT" ? "GMT+0" : offset})` : name
  } catch {
    return name
  }
}

/** Today's calendar date in a time zone ("2026-10-08"), or UTC if unknown. */
export function todayIn(timeZone: string | undefined, now: number): string {
  const parts = (zone: string | undefined) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now)
  let p: Intl.DateTimeFormatPart[]
  try {
    p = parts(timeZone ?? "UTC")
  } catch {
    p = parts("UTC")
  }
  const get = (type: string) => p.find((x) => x.type === type)?.value ?? ""
  return `${get("year")}-${get("month")}-${get("day")}`
}

/** Minutes after midnight right now in a time zone. */
function minutesIn(timeZone: string | undefined, now: number): number {
  const parts = (zone: string | undefined) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
  let p: Intl.DateTimeFormatPart[]
  try {
    p = parts(timeZone ?? "UTC")
  } catch {
    p = parts("UTC")
  }
  const get = (type: string) =>
    Number(p.find((x) => x.type === type)?.value ?? 0)
  return get("hour") * 60 + get("minute")
}

/**
 * How far away a reservation is, from the restaurant's own calendar:
 * "Today", "Tomorrow", "In 2 days", "Earlier today", "Yesterday", "3 days ago".
 * Null until the current time is known (after mount, or from `now`).
 */
export function relativeDay(
  date: string | undefined,
  time: string | undefined,
  timeZone: string | undefined,
  now: number | null,
): string | null {
  if (now === null) return null
  const target = parseDate(date)
  const today = parseDate(todayIn(timeZone, now))
  if (target === null || today === null) return null
  const days = Math.round((target - today) / DAY_MS)
  if (days === 0) {
    const at = parseTime(time)
    return at !== null && at < minutesIn(timeZone, now)
      ? "Earlier today"
      : "Today"
  }
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  return days > 1 ? `In ${days} days` : `${-days} days ago`
}

// ---------------------------------------------------------------------------
// Slots

/** Lunch is anything before 16:00; dinner from 16:00 on. */
export function mealPeriod(time: string): "lunch" | "dinner" {
  const minutes = parseTime(time)
  return minutes !== null && minutes < DINNER_FROM ? "lunch" : "dinner"
}

/** Slots split into lunch and dinner, each in time order. Invalid times are dropped. */
export function groupByMeal<T extends Slot>(
  slots: T[],
): { lunch: T[]; dinner: T[] } {
  const sorted = slots
    .filter((s) => parseTime(s.time) !== null)
    .sort((a, b) => (parseTime(a.time) ?? 0) - (parseTime(b.time) ?? 0))
  return {
    lunch: sorted.filter((s) => mealPeriod(s.time) === "lunch"),
    dinner: sorted.filter((s) => mealPeriod(s.time) === "dinner"),
  }
}

/** Every seating area the slots mention, in a stable order. */
export function areasIn(slots: Slot[]): SeatingArea[] {
  const seen = new Set(slots.flatMap((s) => s.areas ?? []))
  return AREA_ORDER.filter((a) => seen.has(a))
}

/**
 * Slots that offer the area. With no area, every slot. Slots that don't list
 * areas are dropped by a filter: the source didn't say they have it.
 */
export function filterByArea<T extends Slot>(
  slots: T[],
  area: SeatingArea | null,
): T[] {
  if (!area) return slots
  return slots.filter((s) => s.areas?.includes(area))
}

export function areaLabel(area: SeatingArea): string {
  return AREA_LABEL[area] ?? area
}

// ---------------------------------------------------------------------------
// Party, money and policies

export function guestsLabel(size: number): string {
  return `${size} ${size === 1 ? "guest" : "guests"}`
}

/** Fraction digits of a currency (2 for EUR, 0 for JPY). */
export function currencyDigits(currency: string | undefined): number {
  if (!currency) return 2
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

export function formatMoney(
  amount: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const whole = Number.isInteger(amount)
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      // "€20", not "€20.00", for whole amounts.
      ...(whole ? { minimumFractionDigits: 0 } : {}),
    }).format(amount)
  } catch {
    const digits = whole ? 0 : currencyDigits(currency)
    const n = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
    return currency ? `${n} ${currency}` : n
  }
}

/** The deposit for the whole party, rounded in minor units (no float drift). */
export function depositTotal(
  deposit: Pick<Deposit, "amount" | "perPerson">,
  size: number,
  currency?: string,
): number {
  const factor = 10 ** currencyDigits(currency)
  const each = Math.round(deposit.amount * factor)
  return (deposit.perPerson ? each * Math.max(0, size) : each) / factor
}

/**
 * The deposit in one sentence: "€20 per person deposit (€80 for 4 guests),
 * refundable until 24 h before."
 */
export function depositText(
  deposit: Deposit,
  size: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const money = (n: number) => formatMoney(n, currency, locale)
  const head = deposit.perPerson
    ? `${money(deposit.amount)} per person deposit${
        size > 1
          ? ` (${money(depositTotal(deposit, size, currency))} for ${guestsLabel(size)})`
          : ""
      }`
    : `${money(deposit.amount)} deposit`
  return deposit.refundableUntil
    ? `${head}, refundable until ${deposit.refundableUntil}.`
    : `${head}.`
}

/** "2 hours", "90 minutes", "2 h 30 min". */
export function durationText(minutes: number): string {
  if (minutes % 60 === 0) {
    const h = minutes / 60
    return `${h} ${h === 1 ? "hour" : "hours"}`
  }
  if (minutes < 120) return `${minutes} minutes`
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

const PRICE_LABEL = ["inexpensive", "moderate", "expensive", "very expensive"]

/** The currency's symbol ("€"), or "$" when there's no currency. */
export function currencySymbol(currency: string | undefined): string {
  if (!currency) return "$"
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
        currencyDisplay: "narrowSymbol",
      })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? "$"
    )
  } catch {
    return "$"
  }
}

/** Price level 1–4 as symbols ("€€€") and words for screen readers ("expensive"). */
export function priceLevelText(
  level: number,
  currency?: string,
): { symbols: string; label: string } | null {
  const n = Math.round(level)
  if (!Number.isFinite(n) || n < 1 || n > 4) return null
  return {
    symbols: currencySymbol(currency).repeat(n),
    label: PRICE_LABEL[n - 1],
  }
}

/** "Fri Oct 16 · 8:00 PM · 4 guests · Outdoor". */
export function summaryLine(
  choice: { date: string; time: string; size: number; area?: SeatingArea },
  locale: string = DEFAULT_LOCALE,
): string {
  return [
    formatDate(choice.date, "short", locale),
    formatTime(choice.time, locale),
    guestsLabel(choice.size),
    choice.area ? areaLabel(choice.area) : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** A waitlist position mentioned in the notes ("Position 3", "#3"), or null. */
export function waitlistPosition(notes: string | undefined): number | null {
  const m = /(?:position|#)\s*(?:no\.?\s*)?(\d+)/i.exec(notes ?? "")
  return m ? Number(m[1]) : null
}

export function directionsUrl(address: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address)}`
}
