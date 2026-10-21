/**
 * Car rental: pure helpers. Intl only, no date library, no React, no DOM:
 * safe to reuse on the server and to unit-test in Node.
 *
 * Times are instants shown in the rental desk's own IANA time zone, so a
 * 10:00 pick-up in Lisbon stays 10:00 for a viewer in Tokyo. Money math runs
 * in integer minor units (cents).
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

const MINUTE = 60_000
const DAY_MS = 86_400_000

/** A return up to this many minutes past a full 24-hour block isn't charged as another day. */
export const GRACE_MINUTES = 59

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------------------
// Time zones

const partsCache = new Map<string, Intl.DateTimeFormat>()

/** The time zone if the runtime knows it, otherwise 'UTC'. */
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

/** Wall-clock fields of an instant in a time zone. */
export function zonedParts(t: number, timeZone: string) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const p of partsFormatter(safeTimeZone(timeZone)).formatToParts(t)) {
    if (p.type in out) out[p.type as keyof typeof out] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

/** Offset from UTC in minutes at an instant, e.g. 60 for Lisbon in summer. */
export function offsetMinutes(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / MINUTE)
}

/** The instant a wall-clock time happens in a time zone. */
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
 * An ISO time as an instant. With an offset ('2026-10-19T10:00:00+01:00') it
 * is exact; without one ('2026-10-19T10:00') it is wall-clock time at the
 * desk. Null when unparseable.
 */
export function toInstant(
  value: string | undefined,
  timeZone: string | undefined,
): number | null {
  if (!value) return null
  const v = value.trim()
  if (!hasOffset.test(v)) {
    const f = floating.exec(v)
    if (f) {
      const seconds = f[6] ? +f[6] * 1000 : 0
      return (
        wallTimeToInstant(
          +f[1],
          +f[2],
          +f[3],
          +f[4],
          +f[5],
          safeTimeZone(timeZone),
        ) + seconds
      )
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

const pad = (n: number) => String(n).padStart(2, "0")

/** 24-hour clock time at the desk: '10:00'. */
export function formatClock(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${pad(p.hour)}:${pad(p.minute)}`
}

/** Local date and time at the desk: 'Mon, Oct 19, 10:00'. */
export function formatLocalDateTime(
  t: number,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: safeTimeZone(timeZone),
  }).format(t)
  return `${date}, ${formatClock(t, timeZone)}`
}

/** The value for an `<input type="datetime-local">` in the desk's zone: '2026-10-19T10:00'. */
export function toLocalInputValue(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** ISO 8601 with the desk's offset at that instant: '2026-10-19T10:00:00+01:00'. */
export function toOffsetISO(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  const m = offsetMinutes(t, timeZone)
  const sign = m < 0 ? "-" : "+"
  const abs = Math.abs(m)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

// ---------------------------------------------------------------------------
// Rental length

export type TripPoint = { at: string; timeZone: string }

/**
 * Length of the rental in ms. In one time zone it's measured on the wall
 * clock, so 10:00 to 10:00 is whole days even across a DST change. Between
 * zones (one-way across a border) it's the real elapsed time. Null when a
 * time is unparseable.
 */
export function rentalSpanMs(
  pickup: TripPoint,
  dropoff: TripPoint,
): number | null {
  const a = toInstant(pickup.at, pickup.timeZone)
  const b = toInstant(dropoff.at, dropoff.timeZone)
  if (a === null || b === null) return null
  const zoneA = safeTimeZone(pickup.timeZone)
  const zoneB = safeTimeZone(dropoff.timeZone)
  if (zoneA !== zoneB) return b - a
  const wall = (t: number) => t + offsetMinutes(t, zoneA) * MINUTE
  return wall(b) - wall(a)
}

/**
 * Rental days, counted in 24-hour blocks: a block that runs past the grace
 * period (59 minutes by default) counts as another day. At least 1. Null when
 * a time is unparseable or drop-off isn't after pick-up.
 */
export function rentalDays(
  pickup: TripPoint,
  dropoff: TripPoint,
  graceMinutes = GRACE_MINUTES,
): number | null {
  const span = rentalSpanMs(pickup, dropoff)
  if (span === null || span <= 0) return null
  const full = Math.floor(span / DAY_MS)
  const rest = span - full * DAY_MS
  return Math.max(1, full + (rest > graceMinutes * MINUTE ? 1 : 0))
}

export function daysLabel(days: number): string {
  return plural(days, "day", "days")
}

/** Whether pick-up and drop-off are different places (case and spacing ignored). */
export function isOneWay(
  pickupLocation: string | undefined,
  dropoffLocation: string | undefined,
): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()
  if (!pickupLocation || !dropoffLocation) return false
  return norm(pickupLocation) !== norm(dropoffLocation)
}

// ---------------------------------------------------------------------------
// Money

/** Decimal places for a currency, e.g. EUR → 2, JPY → 0. */
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

export function formatMoney(
  amount: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    }).format(amount)
  } catch {
    const digits = currencyDigits(currency)
    const n = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount)
    return currency ? `${n} ${currency}` : n
  }
}

/** Like formatMoney, without a zero fraction: '€1,200', '€0', '€12.50'. */
export function formatMoneyCompact(
  amount: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isInteger(amount)) return formatMoney(amount, currency, locale)
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return formatMoney(amount, currency, locale)
  }
}

// ---------------------------------------------------------------------------
// Pricing

export type RentalPrice = {
  /** The base price for the quoted rental. */
  total: number
  perDay?: number
  payNow?: number
  payAtDesk?: number
}

export type InsuranceOption = {
  id: string
  label: string
  included: boolean
  excess: number
  pricePerDay?: number
  payAtDesk?: boolean
}

export type Extra = {
  id: string
  label: string
  pricePerDay?: number
  /** Price per unit for the whole rental. Wins over pricePerDay. */
  priceTotal?: number
  maxQuantity?: number
  payAtDesk?: boolean
}

export type YoungDriverFee = {
  underAge: number
  perDay: number
  payAtDesk?: boolean
}

export type ExtraPick = { id: string; quantity: number }

/**
 * The base price split into paid now and paid at the desk, in minor units.
 * `payNow` wins; otherwise `payAtDesk` is taken from the total; with neither,
 * everything is paid now. Both are clamped to the total.
 */
export function baseSplit(
  price: RentalPrice,
  digits = 2,
): { total: number; now: number; desk: number } {
  const total = Math.max(0, toMinor(price.total, digits))
  const clamp = (n: number) => Math.min(total, Math.max(0, n))
  const now =
    typeof price.payNow === "number"
      ? clamp(toMinor(price.payNow, digits))
      : typeof price.payAtDesk === "number"
        ? total - clamp(toMinor(price.payAtDesk, digits))
        : total
  return { total, now, desk: total - now }
}

/** Price per day: the source's, else total ÷ days rounded to the minor unit. */
export function perDayPrice(
  price: Pick<RentalPrice, "total" | "perDay">,
  days: number | null,
  digits = 2,
): number | null {
  if (typeof price.perDay === "number") return price.perDay
  if (!days || days < 1 || !Number.isFinite(price.total)) return null
  return fromMinor(Math.round(toMinor(price.total, digits) / days), digits)
}

/** Added cost of a cover for the rental: 0 when included, null when it has no price. */
export function insuranceCost(
  option: Pick<InsuranceOption, "included" | "pricePerDay">,
  days: number,
  digits = 2,
): number | null {
  if (option.included) return 0
  if (typeof option.pricePerDay !== "number") return null
  return fromMinor(toMinor(option.pricePerDay, digits) * days, digits)
}

/** Cost of `quantity` units of an extra for the rental, or null when it has no price. */
export function extraCost(
  extra: Pick<Extra, "pricePerDay" | "priceTotal">,
  quantity: number,
  days: number,
  digits = 2,
): number | null {
  const unit =
    typeof extra.priceTotal === "number"
      ? toMinor(extra.priceTotal, digits)
      : typeof extra.pricePerDay === "number"
        ? toMinor(extra.pricePerDay, digits) * days
        : null
  if (unit === null) return null
  return fromMinor(unit * Math.max(0, Math.floor(quantity)), digits)
}

/** Most units of an extra the user can add. Default 1. */
export function maxQuantity(extra: Pick<Extra, "maxQuantity">): number {
  return Math.max(1, Math.floor(extra.maxQuantity ?? 1))
}

/** Whether the young driver fee applies: the driver's age is known and under the limit. */
export function youngDriverApplies(
  fee: Pick<YoungDriverFee, "underAge"> | undefined,
  age: number | undefined,
): boolean {
  return !!fee && typeof age === "number" && age < fee.underAge
}

export function youngDriverCost(
  fee: Pick<YoungDriverFee, "perDay">,
  days: number,
  digits = 2,
): number {
  return fromMinor(toMinor(fee.perDay, digits) * days, digits)
}

export type PriceLine = {
  label: string
  amount: number
  atDesk: boolean
}

export type RentalTotals = {
  days: number
  base: { amount: number; perDay: number | null; now: number; desk: number }
  /** The chosen cover's added cost; null when it's included. */
  insurance: (PriceLine & { id: string; perDay: number }) | null
  extras: (PriceLine & { id: string; quantity: number })[]
  youngDriver: (PriceLine & { perDay: number; underAge: number }) | null
  payNow: number
  payAtDesk: number
  total: number
}

/**
 * The full price of an offer with the user's choices, never inventing a
 * figure: null when the base price or days are unknown, or a chosen cover or
 * extra has no price. Insurance, extras and the young driver fee are paid at
 * the desk when marked `payAtDesk`; otherwise with the booking, unless the
 * whole base price is paid at the desk, then at the desk too.
 */
export function rentalTotals(input: {
  price: RentalPrice
  days: number | null
  insurance?: InsuranceOption
  extras?: { extra: Extra; quantity: number }[]
  youngDriverFee?: YoungDriverFee
  driverAge?: number
  digits?: number
}): RentalTotals | null {
  const { price, days } = input
  const digits = input.digits ?? 2
  if (!days || days < 1 || !Number.isFinite(price.total)) return null
  const m = (n: number) => toMinor(n, digits)
  const f = (n: number) => fromMinor(n, digits)

  const base = baseSplit(price, digits)
  const deskByDefault = base.now === 0 && base.total > 0
  const atDesk = (flag: boolean | undefined) => flag ?? deskByDefault
  let now = base.now
  let desk = base.desk
  const add = (minor: number, onDesk: boolean) => {
    if (onDesk) desk += minor
    else now += minor
  }

  let insurance: RentalTotals["insurance"] = null
  if (input.insurance && !input.insurance.included) {
    const cost = insuranceCost(input.insurance, days, digits)
    if (cost === null) return null
    const onDesk = atDesk(input.insurance.payAtDesk)
    add(m(cost), onDesk)
    insurance = {
      id: input.insurance.id,
      label: input.insurance.label,
      amount: cost,
      perDay: input.insurance.pricePerDay ?? 0,
      atDesk: onDesk,
    }
  }

  const extras: RentalTotals["extras"] = []
  for (const { extra, quantity } of input.extras ?? []) {
    const q = Math.min(maxQuantity(extra), Math.max(0, Math.floor(quantity)))
    if (q === 0) continue
    const cost = extraCost(extra, q, days, digits)
    if (cost === null) return null
    const onDesk = atDesk(extra.payAtDesk)
    add(m(cost), onDesk)
    extras.push({
      id: extra.id,
      label: extra.label,
      quantity: q,
      amount: cost,
      atDesk: onDesk,
    })
  }

  let youngDriver: RentalTotals["youngDriver"] = null
  const fee = input.youngDriverFee
  if (fee && youngDriverApplies(fee, input.driverAge)) {
    const cost = youngDriverCost(fee, days, digits)
    const onDesk = atDesk(fee.payAtDesk)
    add(m(cost), onDesk)
    youngDriver = {
      label: "Young driver fee",
      amount: cost,
      perDay: fee.perDay,
      underAge: fee.underAge,
      atDesk: onDesk,
    }
  }

  return {
    days,
    base: {
      amount: f(base.total),
      perDay: perDayPrice(price, days, digits),
      now: f(base.now),
      desk: f(base.desk),
    },
    insurance,
    extras,
    youngDriver,
    payNow: f(now),
    payAtDesk: f(desk),
    total: f(now + desk),
  }
}

// ---------------------------------------------------------------------------
// Filtering and sorting

export type Transmission = "automatic" | "manual"

export type OfferFilters = {
  transmission: "any" | Transmission
  /** 0 for any. */
  minSeats: number
  /** Empty for all categories. */
  categories: string[]
  unlimitedMileage: boolean
  freeCancellation: boolean
}

export type OfferSort = "price" | "rating"

export const NO_FILTERS: OfferFilters = {
  transmission: "any",
  minSeats: 0,
  categories: [],
  unlimitedMileage: false,
  freeCancellation: false,
}

/** Offer fields the filters and sorting read. Partial, so it works while streaming. */
export type FilterableOffer = {
  category?: string
  seats?: number
  transmission?: Transmission
  mileage?: { unlimited?: boolean }
  freeCancelUntil?: string
  price?: { total?: number }
  rating?: { score?: number; outOf?: number }
}

/**
 * Whether the offer can still be cancelled for free at `now`. Before mount
 * (`now` null) any deadline counts.
 */
export function hasFreeCancellation(
  offer: Pick<FilterableOffer, "freeCancelUntil">,
  now: number | null,
): boolean {
  if (!offer.freeCancelUntil) return false
  const deadline = Date.parse(offer.freeCancelUntil)
  if (Number.isNaN(deadline)) return false
  return now === null || deadline > now
}

export function activeFilterCount(f: OfferFilters): number {
  return (
    (f.transmission !== "any" ? 1 : 0) +
    (f.minSeats > 0 ? 1 : 0) +
    (f.categories.length > 0 ? 1 : 0) +
    (f.unlimitedMileage ? 1 : 0) +
    (f.freeCancellation ? 1 : 0)
  )
}

/** Offers that pass every active filter. An unknown field fails an active filter. */
export function filterOffers<T extends FilterableOffer>(
  offers: readonly T[],
  f: OfferFilters,
  now: number | null,
): T[] {
  const cats = new Set(f.categories.map((c) => c.toLowerCase()))
  return offers.filter(
    (o) =>
      (f.transmission === "any" || o.transmission === f.transmission) &&
      (f.minSeats <= 0 ||
        (typeof o.seats === "number" && o.seats >= f.minSeats)) &&
      (cats.size === 0 || cats.has((o.category ?? "").toLowerCase())) &&
      (!f.unlimitedMileage || o.mileage?.unlimited === true) &&
      (!f.freeCancellation || hasFreeCancellation(o, now)),
  )
}

function ratingRatio(o: FilterableOffer): number | null {
  const s = o.rating?.score
  const of = o.rating?.outOf
  return typeof s === "number" && typeof of === "number" && of > 0
    ? s / of
    : null
}

/**
 * Sorted copy. 'price': lowest total first, unpriced last. 'rating': highest
 * score (relative to its scale) first, unrated last, ties by price. Stable.
 */
export function sortOffers<T extends FilterableOffer>(
  offers: readonly T[],
  sort: OfferSort,
): T[] {
  const price = (o: T) =>
    typeof o.price?.total === "number" ? o.price.total : Infinity
  return offers
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      if (sort === "rating") {
        const ra = ratingRatio(a.o) ?? -1
        const rb = ratingRatio(b.o) ?? -1
        if (ra !== rb) return rb - ra
      }
      const pa = price(a.o)
      const pb = price(b.o)
      if (pa !== pb) return pa < pb ? -1 : 1
      return a.i - b.i
    })
    .map(({ o }) => o)
}

/** Distinct categories in the order they first appear. */
export function categoriesOf(offers: readonly FilterableOffer[]): string[] {
  const seen = new Map<string, string>()
  for (const o of offers) {
    if (o.category && !seen.has(o.category.toLowerCase())) {
      seen.set(o.category.toLowerCase(), o.category)
    }
  }
  return [...seen.values()]
}

/** Distinct seat counts, ascending, for the "seats" filter. */
export function seatOptions(offers: readonly FilterableOffer[]): number[] {
  return [
    ...new Set(
      offers
        .map((o) => o.seats)
        .filter((n): n is number => typeof n === "number" && n > 0),
    ),
  ].sort((a, b) => a - b)
}

/** '3 of 8 cars', or '8 cars' when nothing is filtered out. */
export function countLabel(shown: number, total: number): string {
  return shown === total
    ? plural(total, "car", "cars")
    : `${shown} of ${plural(total, "car", "cars")}`
}

// ---------------------------------------------------------------------------
// Display text

/** 'Unlimited km', '1,500 km included, then €0.25/km', or '1,500 km included'. */
export function mileageText(
  mileage: { unlimited?: boolean; includedKm?: number; extraPerKm?: number },
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (mileage.unlimited === true) return "Unlimited km"
  if (typeof mileage.includedKm !== "number") {
    return mileage.unlimited === false ? "Limited km" : null
  }
  const km = `${new Intl.NumberFormat(locale).format(mileage.includedKm)} km included`
  return typeof mileage.extraPerKm === "number"
    ? `${km}, then ${formatMoney(mileage.extraPerKm, currency, locale)}/km`
    : km
}

export function fuelPolicyText(
  policy: "full-to-full" | "same-to-same" | "prepaid" | undefined,
): string | null {
  switch (policy) {
    case "full-to-full":
      return "Fuel: full to full"
    case "same-to-same":
      return "Fuel: same to same"
    case "prepaid":
      return "Fuel: prepaid tank"
    default:
      return null
  }
}

export function pickupTypeText(
  type: "in-terminal" | "shuttle" | "meet-and-greet" | undefined,
): string | null {
  switch (type) {
    case "in-terminal":
      return "Desk in terminal"
    case "shuttle":
      return "Shuttle to desk"
    case "meet-and-greet":
      return "Meet and greet"
    default:
      return null
  }
}

/** '2 large, 1 small bag', '3 large bags', 'No luggage space'. */
export function bagsText(bags: { large?: number; small?: number }): string {
  const large = Math.max(0, bags.large ?? 0)
  const small = Math.max(0, bags.small ?? 0)
  if (large + small === 0) return "No luggage space"
  if (small === 0) return `${large} large ${large === 1 ? "bag" : "bags"}`
  if (large === 0) return `${small} small ${small === 1 ? "bag" : "bags"}`
  return `${large} large, ${small} small ${small === 1 ? "bag" : "bags"}`
}

/** 'VW Golf or similar' when `orSimilar`, without doubling it. */
export function modelText(model: string, orSimilar?: boolean): string {
  if (orSimilar !== true || /\bor similar\s*$/i.test(model)) return model
  return `${model} or similar`
}

/**
 * "Free cancellation for 2 more days", "… for 5 more hours", or "Free
 * cancellation has ended". Null when the deadline or `now` is unknown (before
 * mount).
 */
export function freeCancellationRelative(
  until: string | undefined,
  now: number | null,
): string | null {
  if (now === null || !until) return null
  const deadline = Date.parse(until)
  if (Number.isNaN(deadline)) return null
  const diff = deadline - now
  if (diff <= 0) return "Free cancellation has ended"
  if (diff < 3_600_000) return "Free cancellation for less than an hour"
  if (diff < DAY_MS) {
    return `Free cancellation for ${plural(Math.floor(diff / 3_600_000), "more hour", "more hours")}`
  }
  return `Free cancellation for ${plural(Math.floor(diff / DAY_MS), "more day", "more days")}`
}

/** A deadline at the desk: 'Oct 17, 10:00'. Null when unparseable. */
export function formatDeadline(
  iso: string | undefined,
  timeZone: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const zone = safeTimeZone(timeZone)
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    timeZone: zone,
  }).format(t)
  return `${date}, ${formatClock(t, zone)}`
}

/**
 * 'Free cancellation until Oct 17, 10:00 local time', or 'Free cancellation
 * has ended' once `now` is past it. Null without a deadline.
 */
export function cancellationText(
  until: string | undefined,
  timeZone: string | undefined,
  now: number | null,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const deadline = formatDeadline(until, timeZone, locale)
  if (!until || !deadline) return null
  if (now !== null && Date.parse(until) <= now) {
    return "Free cancellation has ended"
  }
  return `Free cancellation until ${deadline} local time`
}

/** An OpenStreetMap search for the location, for a "Directions" link. */
export function directionsUrl(location: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(location)}`
}
