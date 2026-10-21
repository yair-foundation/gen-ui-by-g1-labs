/**
 * Price Details: pure helpers. Money math runs in integer minor units (cents),
 * so 0.1 + 0.2 is 0.30, not 0.30000000000000004. No React, no DOM: safe to
 * reuse on the server and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type BreakdownKind =
  | "base"
  | "discount"
  | "tax"
  | "shipping"
  | "fee"
  | "deposit"
  | "credit"

export type PriceAction = "watch-price" | "add-to-cart" | "open-offer"

// ---------------------------------------------------------------------------
// Money

/** Decimal places for a currency, e.g. USD → 2, JPY → 0. */
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

/** Amount in integer minor units. */
export function toMinor(amount: number, digits = 2): number {
  // toFixed first: 1.005 * 100 is 100.49999999999999 in floating point.
  return Math.round(Number((amount * 10 ** digits).toFixed(6)))
}

export function fromMinor(minor: number, digits = 2): number {
  return minor / 10 ** digits
}

const isNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n)

/**
 * Formats an amount in its currency.
 * - `trim`: whole amounts drop the zero fraction ("$949" rather than "$949.00").
 * - `precise`: keeps up to 4 decimals, for unit prices such as $0.4213 / 100 g.
 */
export function formatMoney(
  amount: number,
  currency?: string,
  {
    trim,
    precise,
    locale = DEFAULT_LOCALE,
  }: { trim?: boolean; precise?: boolean; locale?: string } = {},
): string {
  const digits = currencyDigits(currency)
  const whole = trim && Number.isInteger(amount)
  const fraction = whole
    ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
    : precise
      ? {
          minimumFractionDigits: digits,
          maximumFractionDigits: Math.max(digits, 4),
        }
      : {}
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      ...fraction,
    }).format(amount)
  } catch {
    const n = new Intl.NumberFormat(locale, {
      minimumFractionDigits: whole ? 0 : digits,
      maximumFractionDigits: whole
        ? 0
        : precise
          ? Math.max(digits, 4)
          : digits,
    }).format(amount)
    return currency ? `${n} ${currency}` : n
  }
}

// ---------------------------------------------------------------------------
// Savings and unit price

export type Savings = {
  /** was − current, in major units. */
  amount: number
  /** Rounded to a whole percent; at least 1 when there is any saving. */
  percent: number
}

/** What the user saves against the list price. Null when there's no saving. */
export function savings(
  current: number | undefined,
  was: number | undefined,
  digits = 2,
): Savings | null {
  if (!isNum(current) || !isNum(was) || was <= 0) return null
  const diff = toMinor(was, digits) - toMinor(current, digits)
  if (diff <= 0) return null
  const exact = (diff / toMinor(was, digits)) * 100
  return {
    amount: fromMinor(diff, digits),
    percent: Math.max(1, Math.round(exact)),
  }
}

/** "Save $150 (14%)". */
export function formatSavings(
  s: Savings,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return `Save ${formatMoney(s.amount, currency, { trim: true, locale })} (${s.percent}%)`
}

/** "$0.42 / 100 g". Null when the unit is incomplete. */
export function formatUnitPrice(
  unit: { amount?: number; per?: string } | undefined,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const per = unit?.per?.trim()
  if (!unit || !isNum(unit.amount) || !per) return null
  return `${formatMoney(unit.amount, currency, { precise: true, locale })} / ${per}`
}

// ---------------------------------------------------------------------------
// Breakdown reconciliation

/** Kinds that reduce what the user pays. */
export const DEDUCTION_KINDS: readonly BreakdownKind[] = ["discount", "credit"]

export function isDeduction(kind: BreakdownKind | undefined): boolean {
  return kind !== undefined && DEDUCTION_KINDS.includes(kind)
}

/**
 * A row's effect on the total, in major units. Discounts and credits always
 * subtract, whichever sign the source used.
 */
export function signedAmount(
  row: { amount: number; kind: BreakdownKind },
  digits = 2,
): number {
  const minor = Math.abs(toMinor(row.amount, digits))
  return fromMinor(
    isDeduction(row.kind) ? -minor : toMinor(row.amount, digits),
    digits,
  )
}

export type BreakdownCheck = {
  /** What the rows add up to (deductions subtracted). */
  sum: number
  /** The total to show: the stated one, or the sum when none was given. */
  total: number
  /** False when a stated total differs from the sum by more than 0.01. */
  ok: boolean
  /** stated − sum, in major units (0 when ok or no total was stated). */
  difference: number
}

/** Checks that the rows add up to the stated total, within 0.01. */
export function reconcileBreakdown(
  rows: { amount: number; kind: BreakdownKind }[],
  total: number | undefined,
  digits = 2,
): BreakdownCheck {
  const tolerance = Math.round(0.01 * 10 ** digits)
  let sum = 0
  for (const row of rows) {
    if (!isNum(row.amount)) continue
    const minor = toMinor(row.amount, digits)
    sum += isDeduction(row.kind) ? -Math.abs(minor) : minor
  }
  if (!isNum(total)) {
    return {
      sum: fromMinor(sum, digits),
      total: fromMinor(sum, digits),
      ok: true,
      difference: 0,
    }
  }
  const stated = toMinor(total, digits)
  const ok = Math.abs(stated - sum) <= tolerance
  return {
    sum: fromMinor(sum, digits),
    total,
    ok,
    difference: ok ? 0 : fromMinor(stated - sum, digits),
  }
}

/** The warning under the total, or null when it adds up. */
export function describeMismatch(
  check: BreakdownCheck,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (check.ok) return null
  const money = (n: number) => formatMoney(n, currency, { locale })
  return `Totals don't add up: the rows come to ${money(check.sum)}, but the total is ${money(check.total)}.`
}

// ---------------------------------------------------------------------------
// Dates

const DAY_MS = 86_400_000

/**
 * A date as epoch ms. Date-only values ("2026-08-12") are calendar dates at
 * UTC midnight, formatted in UTC so they never show as the day before.
 */
export function parseDay(
  t: string | undefined,
): { ms: number; dateOnly: boolean } | null {
  if (typeof t !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t)
  if (m) {
    const [y, mo, d] = m.slice(1).map(Number)
    const ms = Date.UTC(y, mo - 1, d)
    const date = new Date(ms)
    return date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
      ? { ms, dateOnly: true }
      : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return null
  const ms = Date.parse(t)
  return Number.isNaN(ms) ? null : { ms, dateOnly: false }
}

/** "Aug 12", or "Aug 12, 2025" with `year`. */
export function formatDay(
  t: string,
  { year, locale = DEFAULT_LOCALE }: { year?: boolean; locale?: string } = {},
): string {
  const parsed = parseDay(t)
  if (!parsed) return t
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    ...(parsed.dateOnly ? { timeZone: "UTC" } : {}),
  }).format(parsed.ms)
}

/**
 * "10:42 AM" when `asOf` is on the same day as `now`, else "Oct 7, 10:42 AM".
 * Date-only values show the date. Pass `now` after mount only.
 */
export function formatAsOf(
  asOf: string,
  now: number | null,
  locale: string = DEFAULT_LOCALE,
): string {
  const parsed = parseDay(asOf)
  if (!parsed) return asOf
  if (parsed.dateOnly) return formatDay(asOf, { year: true, locale })
  const sameDay =
    now !== null &&
    new Date(now).toDateString() === new Date(parsed.ms).toDateString()
  return new Intl.DateTimeFormat(locale, {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed.ms)
}

// ---------------------------------------------------------------------------
// History

export type HistoryPoint = { date: string; price: number }
export type DatedPoint = HistoryPoint & { ms: number }

/** Valid points, oldest first. */
export function cleanHistory(
  points: { date?: string; price?: number }[] | undefined,
): DatedPoint[] {
  const out: DatedPoint[] = []
  for (const p of points ?? []) {
    const parsed = parseDay(p.date)
    if (parsed && isNum(p.price) && p.date) {
      out.push({ date: p.date, price: p.price, ms: parsed.ms })
    }
  }
  return out.sort((a, b) => a.ms - b.ms)
}

/** Whole days from the first point to the last. */
export function historySpanDays(points: DatedPoint[]): number {
  if (points.length < 2) return 0
  return Math.round((points[points.length - 1].ms - points[0].ms) / DAY_MS)
}

export type HistoryRange = "30d" | "90d" | "1y"

export const RANGE_DAYS: Record<HistoryRange, number> = {
  "30d": 30,
  "90d": 90,
  "1y": 365,
}

/** Range tabs, only when the history spans more than 90 days. */
export function rangeOptions(points: DatedPoint[]): HistoryRange[] {
  return historySpanDays(points) > 90 ? ["30d", "90d", "1y"] : []
}

/** Points within `days` of the latest one. */
export function pointsInRange(
  points: DatedPoint[],
  days: number,
): DatedPoint[] {
  if (points.length === 0) return points
  const from = points[points.length - 1].ms - days * DAY_MS
  return points.filter((p) => p.ms >= from)
}

export type Extent = { price: number; date: string; index: number }

export type HistoryExtents = {
  min: Extent
  max: Extent
  /** The latest point. */
  last: Extent
}

/**
 * Lowest and highest points. Ties go to the most recent point, the one that
 * matters for "is this a good price now".
 */
export function historyExtents(points: DatedPoint[]): HistoryExtents | null {
  if (points.length === 0) return null
  let min = 0
  let max = 0
  points.forEach((p, i) => {
    if (p.price <= points[min].price) min = i
    if (p.price >= points[max].price) max = i
  })
  const at = (i: number): Extent => ({
    price: points[i].price,
    date: points[i].date,
    index: i,
  })
  return { min: at(min), max: at(max), last: at(points.length - 1) }
}

/** "90 days", "8 weeks"… for the window a history covers. */
export function windowLabel(days: number): string {
  if (days >= 360) return "a year"
  if (days >= 2 && days % 7 === 0 && days > 60) return `${days / 7} weeks`
  return `${days} days`
}

/**
 * Where the current price sits against the history, in words: "Matches the
 * low", "$50 above the low", "Matches the high".
 */
export function verdictSupport(
  ext: HistoryExtents,
  current: number,
  currency?: string,
  digits = 2,
  locale: string = DEFAULT_LOCALE,
): string {
  const now = toMinor(current, digits)
  const lo = toMinor(ext.min.price, digits)
  const hi = toMinor(ext.max.price, digits)
  const money = (minor: number) =>
    formatMoney(fromMinor(minor, digits), currency, { trim: true, locale })
  if (now < lo) return `${money(lo - now)} below the low`
  if (now === lo) return "Matches the low"
  if (now >= hi)
    return now === hi ? "Matches the high" : `${money(now - hi)} above the high`
  return `${money(now - lo)} above the low`
}

/**
 * "Lowest $899 on Aug 12 · Highest $1,099 on Jul 11 · Now $949 ($50 above the
 * low)", or "Unchanged at $129.99 over this period" when the price held.
 */
export function historySummary(
  ext: HistoryExtents,
  current: number | undefined,
  currency?: string,
  options: { digits?: number; year?: boolean; locale?: string } = {},
): string {
  const { digits = 2, year, locale = DEFAULT_LOCALE } = options
  const money = (n: number) => formatMoney(n, currency, { trim: true, locale })
  const day = (t: string) => formatDay(t, { year, locale })
  const flat = toMinor(ext.min.price, digits) === toMinor(ext.max.price, digits)
  const parts = flat
    ? [`Unchanged at ${money(ext.min.price)} over this period`]
    : [
        `Lowest ${money(ext.min.price)} on ${day(ext.min.date)}`,
        `Highest ${money(ext.max.price)} on ${day(ext.max.date)}`,
      ]
  if (flat && isNum(current)) {
    if (toMinor(current, digits) !== toMinor(ext.min.price, digits)) {
      parts.push(`Now ${money(current)}`)
    }
  } else if (isNum(current)) {
    parts.push(
      `Now ${money(current)} (${verdictSupport(ext, current, currency, digits, locale).replace(/^M/, "m")})`,
    )
  }
  return parts.join(" · ")
}

// ---------------------------------------------------------------------------
// Offers

export type OfferLike = { price: number; shipping?: number; total?: number }

/**
 * What an offer costs delivered: the stated total, else price + shipping.
 * Unknown shipping counts as zero (the row says it isn't listed).
 */
export function deliveredTotal(offer: OfferLike, digits = 2): number {
  if (isNum(offer.total)) return offer.total
  return fromMinor(
    toMinor(offer.price, digits) +
      (isNum(offer.shipping) ? toMinor(offer.shipping, digits) : 0),
    digits,
  )
}

export type RankedOffer<T> = {
  offer: T
  total: number
  /** Shares the lowest delivered total. */
  lowest: boolean
}

/** Offers sorted by delivered total, cheapest first (stable for ties). */
export function rankOffers<T extends OfferLike>(
  offers: T[],
  digits = 2,
): RankedOffer<T>[] {
  const ranked = offers
    .map((offer, i) => ({
      offer,
      i,
      minor: toMinor(deliveredTotal(offer, digits), digits),
    }))
    .sort((a, b) => a.minor - b.minor || a.i - b.i)
  const low = ranked[0]?.minor
  return ranked.map((r) => ({
    offer: r.offer,
    total: fromMinor(r.minor, digits),
    lowest: ranked.length > 1 && r.minor === low,
  }))
}

// ---------------------------------------------------------------------------
// Watch target

/**
 * Parses a typed amount: "900", "$899.99", "1,099", "1.099,50", "899,5".
 * A lone comma followed by 1–2 digits is a decimal separator; otherwise
 * commas and dots before the last separator group thousands.
 */
export function parseAmount(text: string): number | null {
  const s = text.replace(/[^\d.,-]/g, "")
  if (!/\d/.test(s) || s.lastIndexOf("-") > 0) return null
  const lastDot = s.lastIndexOf(".")
  const lastComma = s.lastIndexOf(",")
  let normalized: string
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma)
    normalized = `${s.slice(0, dec).replace(/[.,]/g, "")}.${s.slice(dec + 1)}`
  } else if (lastComma >= 0) {
    const tail = s.slice(lastComma + 1)
    normalized =
      s.indexOf(",") === lastComma && tail.length > 0 && tail.length <= 2
        ? s.replace(",", ".")
        : s.replace(/,/g, "")
  } else if (lastDot >= 0 && s.indexOf(".") !== lastDot) {
    // Several dots: thousands separators ("1.099.000").
    normalized = s.replace(/\./g, "")
  } else {
    normalized = s
  }
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

export type WatchValidation =
  | { ok: true; target: number }
  | { ok: false; error: string }

/** A watch target must be a positive amount below the current price. */
export function validateWatchTarget(
  text: string,
  current: number | undefined,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): WatchValidation {
  const digits = currencyDigits(currency)
  const parsed = parseAmount(text)
  if (parsed === null) return { ok: false, error: "Enter an amount, e.g. 900." }
  const minor = toMinor(parsed, digits)
  if (minor <= 0) return { ok: false, error: "Enter an amount above zero." }
  if (isNum(current) && minor >= toMinor(current, digits)) {
    return {
      ok: false,
      error: `Enter an amount below ${formatMoney(current, currency, { trim: true, locale })}, the current price.`,
    }
  }
  return { ok: true, target: fromMinor(minor, digits) }
}

// ---------------------------------------------------------------------------
// Links and images

/** http(s) URLs only; anything else is dropped. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** http(s), a same-origin path starting with a single "/", or an inline raster/SVG data URL. */
export function safeImageSrc(src: string | undefined): string | null {
  if (!src) return null
  if (/^\/(?![/\\])/.test(src)) return src
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);/i.test(src)) return src
  return safeUrl(src)
}

/** De-duplicated actions in the agent's order. */
export function resolveActions(
  actions: readonly (PriceAction | undefined)[] | undefined,
): PriceAction[] {
  return [
    ...new Set(
      (actions ?? []).filter((a): a is PriceAction => typeof a === "string"),
    ),
  ]
}
