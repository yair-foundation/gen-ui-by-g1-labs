/**
 * Service Visit: pure helpers. Dates are calendar dates ("2026-10-13") and
 * window times are wall-clock "HH:mm" in the provider's time zone, so they are
 * formatted in UTC and never shift with the viewer's zone. The ETA is a full
 * ISO instant, shown in the provider's zone. No React, no DOM: safe to reuse on
 * the server and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type VisitWindow = {
  id: string
  start: string
  end: string
  fee?: number
  urgent?: boolean
}

export type VisitDay = { date: string; slots: VisitWindow[] }

export type StripDay = {
  date: string
  /** Valid windows in start-time order. */
  slots: VisitWindow[]
  /** No windows open on this day. */
  full: boolean
}

export type TriageQuestion = {
  id: string
  label: string
  type: "select" | "text" | "boolean"
  options?: string[]
  required?: boolean
}

export type TriageAnswer = string | boolean
export type TriageAnswers = Record<string, TriageAnswer>

export type VisitPricing = {
  callOutFee?: number
  hourlyRate?: number
  estimate?: { low: number; high: number }
  currency: string
  note?: string
}

export type VisitAddress = {
  line1: string
  city: string
  postcode?: string
  accessNotes?: string
}

export type BookingState =
  | "confirmed"
  | "pending"
  | "technician-assigned"
  | "cancelled"

export type ConfirmationAction =
  | "reschedule"
  | "cancel-visit"
  | "add-to-calendar"
  | "contact-provider"

const DAY_MS = 86_400_000
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/

// ---------------------------------------------------------------------------
// Times and dates

/** "08:00" as minutes after midnight, or null if it isn't a valid time. */
export function parseTime(time: string | undefined): number | null {
  const m = TIME.exec(time?.trim() ?? "")
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/** A calendar date ("2026-10-13") as UTC midnight in ms, or null. */
export function parseDate(date: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "")
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : t
}

const CLOCK: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
}

/** A wall-clock time for display in the viewer's locale ("8:00 AM", "08:00"). */
export function formatTime(
  time: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const minutes = parseTime(time)
  if (minutes === null) return time
  return new Intl.DateTimeFormat(locale, CLOCK).format(
    Date.UTC(2000, 0, 1, 0, minutes),
  )
}

/**
 * A window as one range: "8:00 AM–12:00 PM", "8:00–11:00 AM" (a shared
 * AM/PM is said once), "08:00–12:00" in 24-hour locales.
 */
export function formatRange(
  start: string,
  end: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const a = parseTime(start)
  const b = parseTime(end)
  if (a === null || b === null) return `${start}–${end}`
  const f = new Intl.DateTimeFormat(locale, CLOCK)
  const pa = f.formatToParts(Date.UTC(2000, 0, 1, 0, a))
  const pb = f.formatToParts(Date.UTC(2000, 0, 1, 0, b))
  const period = (parts: Intl.DateTimeFormatPart[]) =>
    parts.find((x) => x.type === "dayPeriod")?.value
  const join = (parts: Intl.DateTimeFormatPart[]) =>
    parts
      .map((x) => x.value)
      .join("")
      .trim()
  const first =
    period(pa) !== undefined && period(pa) === period(pb)
      ? join(pa.filter((x) => x.type !== "dayPeriod"))
      : join(pa)
  return `${first}–${join(pb)}`
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
  // "Tue Oct 13": weekday and date without the locale's comma.
  if (style === "short") {
    return `${f({ weekday: "short" })} ${f({ month: "short", day: "numeric" })}`
  }
  return f({ weekday: "long", month: "long", day: "numeric" })
}

/**
 * The time zone as shown to the user: the IANA name with spaces, plus its
 * offset on the given date (e.g. 'GMT+2') when the runtime knows it.
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

// ---------------------------------------------------------------------------
// Money and pricing

/** Fraction digits of a currency (2 for EUR, 0 for JPY). */
function currencyDigits(currency: string | undefined): number {
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

/** "€49", "€12.50", or "49 XYZ" when the code isn't a known currency. */
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
      // "€49", not "€49.00", for whole amounts.
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

/** "Usually €80–€140", or "Usually €80" when both ends match. */
export function estimateText(
  estimate: { low: number; high: number },
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const low = Math.min(estimate.low, estimate.high)
  const high = Math.max(estimate.low, estimate.high)
  const m = (n: number) => formatMoney(n, currency, locale)
  return low === high ? `Usually ${m(low)}` : `Usually ${m(low)}–${m(high)}`
}

/**
 * The price block as plain lines, in a fixed order: call-out fee, hourly
 * rate, the selected window's fee, the estimate, the provider's note.
 */
export function pricingLines(
  pricing: Partial<VisitPricing> | undefined,
  options: {
    window?: Pick<VisitWindow, "fee" | "urgent">
    locale?: string
  } = {},
): string[] {
  if (!pricing) return []
  const { currency } = pricing
  const { locale = DEFAULT_LOCALE } = options
  const m = (n: number) => formatMoney(n, currency, locale)
  const fee = options.window?.fee
  const lines: (string | null)[] = [
    typeof pricing.callOutFee === "number"
      ? pricing.callOutFee === 0
        ? "No call-out fee"
        : `Call-out fee ${m(pricing.callOutFee)}`
      : null,
    typeof pricing.hourlyRate === "number"
      ? `${m(pricing.hourlyRate)} per hour of work`
      : null,
    typeof fee === "number" && fee > 0
      ? `${options.window?.urgent ? "Urgent window" : "This window"}: +${m(fee)}`
      : null,
    pricing.estimate &&
    typeof pricing.estimate.low === "number" &&
    typeof pricing.estimate.high === "number"
      ? estimateText(pricing.estimate, currency, locale)
      : null,
    pricing.note?.trim() || null,
  ]
  return lines.filter((l): l is string => Boolean(l))
}

// ---------------------------------------------------------------------------
// Windows and the day strip

/** "+€15 urgent", "+€15", "Urgent", or null when there's nothing to add. */
export function windowFeeText(
  slot: Pick<VisitWindow, "fee" | "urgent">,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const fee =
    typeof slot.fee === "number" && slot.fee > 0
      ? `+${formatMoney(slot.fee, currency, locale)}`
      : null
  if (fee) return slot.urgent ? `${fee} urgent` : fee
  return slot.urgent ? "Urgent" : null
}

/** "8:00 AM–12:00 PM · +€15 urgent". */
export function windowText(
  slot: VisitWindow,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return [
    formatRange(slot.start, slot.end, locale),
    windowFeeText(slot, currency, locale),
  ]
    .filter(Boolean)
    .join(" · ")
}

/** True when the window has a readable start and end, end after start. */
export function isValidWindow(slot: Partial<VisitWindow>): slot is VisitWindow {
  if (typeof slot.id !== "string" || !slot.id) return false
  const a = parseTime(slot.start)
  const b = parseTime(slot.end)
  return a !== null && b !== null && b > a
}

/**
 * Days for the strip: in date order, with only valid windows, each day's
 * windows by start time, duplicate dates merged, at most 7 days.
 */
export function buildDayStrip(
  days: { date?: string; slots?: Partial<VisitWindow>[] }[],
): StripDay[] {
  const byDate = new Map<string, VisitWindow[]>()
  for (const d of days) {
    if (typeof d.date !== "string" || parseDate(d.date) === null) continue
    const list = byDate.get(d.date) ?? []
    for (const s of d.slots ?? []) {
      if (isValidWindow(s) && !list.some((x) => x.id === s.id)) list.push(s)
    }
    byDate.set(d.date, list)
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => (parseDate(a) ?? 0) - (parseDate(b) ?? 0))
    .slice(0, 7)
    .map(([date, slots]) => ({
      date,
      slots: [...slots].sort(
        (x, y) => (parseTime(x.start) ?? 0) - (parseTime(y.start) ?? 0),
      ),
      full: slots.length === 0,
    }))
}

/** The window with this id and its date, or null. */
export function findWindow(
  days: StripDay[],
  windowId: string | undefined,
): { date: string; slot: VisitWindow } | null {
  if (!windowId) return null
  for (const d of days) {
    const slot = d.slots.find((s) => s.id === windowId)
    if (slot) return { date: d.date, slot }
  }
  return null
}

/** "Tue Oct 13 · 8:00 AM–12:00 PM". */
export function summaryLine(
  date: string,
  slot: Pick<VisitWindow, "start" | "end">,
  locale: string = DEFAULT_LOCALE,
): string {
  return `${formatDate(date, "short", locale)} · ${formatRange(slot.start, slot.end, locale)}`
}

// ---------------------------------------------------------------------------
// Triage

/** Whether an answer counts as given for this question. */
function answered(q: TriageQuestion, value: TriageAnswer | undefined): boolean {
  if (q.type === "boolean") return typeof value === "boolean"
  if (typeof value !== "string" || !value.trim()) return false
  return q.type === "select" ? (q.options ?? []).includes(value) : true
}

/**
 * Problems with the answers, by question id: required questions left blank
 * and select answers that aren't one of the options. Empty when all is well.
 */
export function validateTriage(
  questions: TriageQuestion[],
  answers: TriageAnswers,
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const q of questions) {
    const value = answers[q.id]
    if (answered(q, value)) continue
    if (
      q.type === "select" &&
      typeof value === "string" &&
      value.trim() &&
      !(q.options ?? []).includes(value)
    ) {
      errors[q.id] = "Pick one of the options."
    } else if (q.required) {
      errors[q.id] = q.type === "text" ? "Add an answer." : "Choose an answer."
    }
  }
  return errors
}

/** Only the answered questions, text trimmed, in question order. */
export function cleanAnswers(
  questions: TriageQuestion[],
  answers: TriageAnswers,
): TriageAnswers {
  const out: TriageAnswers = {}
  for (const q of questions) {
    const value = answers[q.id]
    if (!answered(q, value)) continue
    out[q.id] = typeof value === "string" ? value.trim() : (value as boolean)
  }
  return out
}

/** An answer for display: "Yes" / "No" for booleans, the text otherwise. */
export function answerText(value: TriageAnswer | undefined): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return value?.trim() || null
}

// ---------------------------------------------------------------------------
// Address

/** The street only ("Keizersgracht 221"): no city or postcode in the card. */
export function addressSummary(
  address: Partial<VisitAddress> | undefined,
): string | null {
  return address?.line1?.trim() || null
}

/** "Apt 3B · Floor 2", or null when neither is given. */
export function unitText(unit?: string, floor?: string): string | null {
  const parts = [
    unit?.trim() ? `Apt ${unit.trim()}` : null,
    floor?.trim() ? `Floor ${floor.trim()}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : null
}

// ---------------------------------------------------------------------------
// Confirmation

/** Whether the runtime knows this IANA zone. */
export function isTimeZone(timeZone: string): boolean {
  try {
    return Boolean(
      new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone,
    )
  } catch {
    return false
  }
}

/**
 * "Arriving around 10:20 AM", read in the provider's time zone, with the
 * weekday in front when it isn't the window's day. Null when unreadable.
 */
export function etaText(
  eta: string | undefined,
  timeZone: string | undefined,
  options: { date?: string; locale?: string } = {},
): string | null {
  const p = etaParts(eta, timeZone, options)
  if (!p) return null
  return p.weekday
    ? `Arriving ${p.weekday} around ${p.clock}`
    : `Arriving around ${p.clock}`
}

/**
 * The ETA's pieces: the clock ("10:20 AM") in the provider's time zone, and
 * the weekday ("Thu") only when it isn't the window's day. Null when
 * unreadable.
 */
export function etaParts(
  eta: string | undefined,
  timeZone: string | undefined,
  options: { date?: string; locale?: string } = {},
): { clock: string; weekday: string | null } | null {
  if (!eta) return null
  // A full instant with an offset; a bare date or floating time is ambiguous.
  if (!/T\d{2}:\d{2}/.test(eta) || !/(Z|[+-]\d{2}:?\d{2})$/i.test(eta.trim()))
    return null
  const t = Date.parse(eta)
  if (!Number.isFinite(t)) return null
  const zone = timeZone && isTimeZone(timeZone) ? timeZone : "UTC"
  const fmt = (
    o: Intl.DateTimeFormatOptions,
    locale = options.locale ?? DEFAULT_LOCALE,
  ) =>
    new Intl.DateTimeFormat(locale, { ...o, timeZone: zone })
  const clock = fmt({ hour: "numeric", minute: "2-digit" }).format(t)
  const parts = fmt(
    { year: "numeric", month: "2-digit", day: "2-digit" },
    "en-US",
  ).formatToParts(t)
  const get = (k: string) => parts.find((p) => p.type === k)?.value ?? ""
  const localDate = `${get("year")}-${get("month")}-${get("day")}`
  const sameDay = !options.date || options.date === localDate
  return {
    clock,
    weekday: sameDay ? null : fmt({ weekday: "short" }).format(t),
  }
}

/** The actions offered for an existing visit, in button order. */
export function defaultActions(
  bookingState: BookingState | undefined,
): ConfirmationAction[] {
  switch (bookingState) {
    case "cancelled":
      return ["contact-provider"]
    case "pending":
      return ["reschedule", "contact-provider", "cancel-visit"]
    default:
      return [
        "reschedule",
        "add-to-calendar",
        "contact-provider",
        "cancel-visit",
      ]
  }
}

/** "MR" from "Marco R.", for when the source sends no initials. */
export function initialsOf(name: string | undefined): string {
  return (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("")
}

/** "4.8", or null for a missing or invalid rating. */
export function formatRating(
  score: number | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0)
    return null
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
    score,
  )
}
