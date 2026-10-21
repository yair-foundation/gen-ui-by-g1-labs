/**
 * Hotel Booking: pure helpers. Dates are calendar dates ("2026-10-19") and run
 * in UTC so a stay never gains or loses a night across DST. Money math runs in
 * integer minor units (cents). No React, no DOM: safe to reuse on the server
 * and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type StayDates = { checkIn: string; checkOut: string };
export type Party = { adults: number; children?: number; rooms?: number };
export type Stay = StayDates & Party;

export type NightlyPrice = { date: string; amount: number };
export type Charge = { label: string; amount: number; perNight?: boolean };
export type Fee = Charge & { payAtHotel?: boolean };

export type PricedRate = {
  nightly?: NightlyPrice[];
  taxes?: Charge[];
  fees?: Fee[];
  payment: "now" | "at-hotel";
};

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Dates

/** A calendar date ("2026-10-19") as UTC midnight in ms, or null if invalid. */
export function parseISODate(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).getUTCDate() === Number(m[3]) ? t : null;
}

export function toISODate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string | null {
  const t = parseISODate(iso);
  return t === null ? null : toISODate(t + days * DAY_MS);
}

/** Nights between check-in and check-out. 0 when either is invalid or out of order. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseISODate(checkIn);
  const b = parseISODate(checkOut);
  if (a === null || b === null || b <= a) return 0;
  return Math.round((b - a) / DAY_MS);
}

/** The date of each night of the stay: check-in up to the day before check-out. */
export function stayNights(checkIn: string, checkOut: string): string[] {
  const a = parseISODate(checkIn);
  const n = nightsBetween(checkIn, checkOut);
  if (a === null) return [];
  return Array.from({ length: n }, (_, i) => toISODate(a + i * DAY_MS));
}

export function sameDates(a: StayDates, b: StayDates): boolean {
  return a.checkIn === b.checkIn && a.checkOut === b.checkOut;
}

export function sameParty(a: Party, b: Party): boolean {
  return (
    a.adults === b.adults &&
    (a.children ?? 0) === (b.children ?? 0) &&
    (a.rooms ?? 1) === (b.rooms ?? 1)
  );
}

/**
 * Whether the nightly prices cover every night of the stay. `missing` lists
 * the nights without a price, in order.
 */
export function stayCoverage(
  nightly: readonly NightlyPrice[] | undefined,
  stay: StayDates,
): { covered: boolean; missing: string[] } {
  const nights = stayNights(stay.checkIn, stay.checkOut);
  const priced = new Set(
    (nightly ?? []).filter((n) => Number.isFinite(n.amount)).map((n) => n.date),
  );
  const missing = nights.filter((d) => !priced.has(d));
  return { covered: nights.length > 0 && missing.length === 0, missing };
}

export type DateIssue =
  | { kind: "order" }
  | { kind: "range"; minDate: string; maxDate: string }
  | { kind: "unavailable"; dates: string[] };

/**
 * Checks dates against the bookable window: check-in and check-out within
 * [minDate, maxDate], check-out after check-in, and no unavailable night.
 */
export function checkDates(
  stay: StayDates,
  availability?: { minDate?: string; maxDate?: string; unavailable?: string[] },
): DateIssue | null {
  if (nightsBetween(stay.checkIn, stay.checkOut) < 1) return { kind: "order" };
  const min = parseISODate(availability?.minDate);
  const max = parseISODate(availability?.maxDate);
  const a = parseISODate(stay.checkIn) ?? 0;
  const b = parseISODate(stay.checkOut) ?? 0;
  if ((min !== null && a < min) || (max !== null && b > max)) {
    return {
      kind: "range",
      minDate: availability?.minDate ?? "",
      maxDate: availability?.maxDate ?? "",
    };
  }
  const blocked = new Set(availability?.unavailable ?? []);
  const dates = stayNights(stay.checkIn, stay.checkOut).filter((d) =>
    blocked.has(d),
  );
  return dates.length > 0 ? { kind: "unavailable", dates } : null;
}

// ---------------------------------------------------------------------------
// Money

/** Decimal places for a currency, e.g. EUR → 2, JPY → 0. */
export function currencyDigits(currency: string | undefined): number {
  if (!currency) return 2;
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** Amount in integer minor units. */
export function toMinor(amount: number, digits = 2): number {
  // toFixed first: 1.005 * 100 is 100.49999999999999 in floating point.
  return Math.round(Number((amount * 10 ** digits).toFixed(6)));
}

export function fromMinor(minor: number, digits = 2): number {
  return minor / 10 ** digits;
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
    }).format(amount);
  } catch {
    const digits = currencyDigits(currency);
    const n = new Intl.NumberFormat(locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
    return currency ? `${n} ${currency}` : n;
  }
}

export type ChargeLine = { label: string; amount: number; atHotel: boolean };

export type RateTotals = {
  /** The price of each night of the stay, in order. */
  nights: NightlyPrice[];
  /** Sum of the nightly prices. */
  room: number;
  /** room ÷ nights, rounded to the currency's minor unit. */
  average: number;
  taxes: ChargeLine[];
  fees: ChargeLine[];
  /** Charged when booking. 0 for pay-at-hotel rates. */
  payNow: number;
  /** Paid at the hotel: pay-at-hotel rates, plus fees marked payAtHotel. */
  payAtHotel: number;
  total: number;
};

/**
 * Prices a rate for a stay. Taxes and fees are amounts for the whole stay
 * unless `perNight`, then they're charged for each night. Null when a night
 * has no price.
 */
export function rateTotals(
  rate: PricedRate,
  stay: StayDates,
  digits = 2,
): RateTotals | null {
  const dates = stayNights(stay.checkIn, stay.checkOut);
  if (dates.length === 0) return null;
  const byDate = new Map(
    (rate.nightly ?? [])
      .filter((n) => Number.isFinite(n.amount))
      .map((n) => [n.date, n.amount]),
  );
  if (dates.some((d) => !byDate.has(d))) return null;

  const m = (n: number) => toMinor(n, digits);
  const f = (n: number) => fromMinor(n, digits);
  const nights = dates.map((date) => ({ date, amount: byDate.get(date) ?? 0 }));
  const roomMinor = nights.reduce((s, n) => s + m(n.amount), 0);
  const atHotelRate = rate.payment === "at-hotel";

  const line = (c: Charge, atHotel: boolean) => ({
    label: c.label,
    minor: c.perNight ? m(c.amount) * dates.length : m(c.amount),
    atHotel,
  });
  const taxes = (rate.taxes ?? [])
    .filter((c) => Number.isFinite(c.amount))
    .map((c) => line(c, atHotelRate));
  const fees = (rate.fees ?? [])
    .filter((c) => Number.isFinite(c.amount))
    .map((c) => line(c, atHotelRate || Boolean(c.payAtHotel)));

  let nowMinor = atHotelRate ? 0 : roomMinor;
  let hotelMinor = atHotelRate ? roomMinor : 0;
  for (const c of [...taxes, ...fees]) {
    if (c.atHotel) hotelMinor += c.minor;
    else nowMinor += c.minor;
  }
  const out = (c: { label: string; minor: number; atHotel: boolean }) => ({
    label: c.label,
    amount: f(c.minor),
    atHotel: c.atHotel,
  });

  return {
    nights,
    room: f(roomMinor),
    average: f(Math.round(roomMinor / dates.length)),
    taxes: taxes.map(out),
    fees: fees.map(out),
    payNow: f(nowMinor),
    payAtHotel: f(hotelMinor),
    total: f(nowMinor + hotelMinor),
  };
}

export type StayPricing =
  | { kind: "priced"; totals: RateTotals }
  /**
   * The source must quote again: `dates` when a night has no price (or the
   * stay is invalid), `guests` when the party changed, `charges` when a
   * stay-wide tax or fee can't be carried over to different dates.
   */
  | { kind: "recheck"; reason: "dates" | "guests" | "charges" };

/**
 * Prices a rate for the stay the user picked, never inventing a figure. Prices
 * were quoted for `quoted`; a different party always needs a new quote, and
 * different dates only price when every night is covered and every tax and
 * fee is per night.
 */
export function stayPricing(
  rate: PricedRate,
  stay: Stay,
  quoted: Stay,
  digits = 2,
): StayPricing {
  if (!sameParty(stay, quoted)) return { kind: "recheck", reason: "guests" };
  if (!stayCoverage(rate.nightly, stay).covered) {
    return { kind: "recheck", reason: "dates" };
  }
  if (!sameDates(stay, quoted)) {
    const charges = [...(rate.taxes ?? []), ...(rate.fees ?? [])];
    if (charges.some((c) => !c.perNight)) {
      return { kind: "recheck", reason: "charges" };
    }
  }
  const totals = rateTotals(rate, stay, digits);
  return totals
    ? { kind: "priced", totals }
    : { kind: "recheck", reason: "dates" };
}

// ---------------------------------------------------------------------------
// Party

export function partySize(party: Party): number {
  return Math.max(0, party.adults) + Math.max(0, party.children ?? 0);
}

/** Whether the party fits: guests ≤ maxGuests × rooms. */
export function partyFits(room: { maxGuests: number }, party: Party): boolean {
  return partySize(party) <= room.maxGuests * Math.max(1, party.rooms ?? 1);
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** "2 adults, 1 child" or "3 adults · 2 rooms". */
export function guestSummary(party: Party): string {
  const parts = [plural(party.adults, "adult", "adults")];
  if ((party.children ?? 0) > 0) {
    parts.push(plural(party.children ?? 0, "child", "children"));
  }
  const rooms = party.rooms ?? 1;
  return `${parts.join(", ")}${rooms > 1 ? ` · ${rooms} rooms` : ""}`;
}

export function nightsLabel(nights: number): string {
  return plural(nights, "night", "nights");
}

// ---------------------------------------------------------------------------
// Cancellation

/**
 * "Free cancellation for 6 more days", "… for 5 more hours", or "Free
 * cancellation has ended". Null when the deadline or `now` is unknown (before
 * mount).
 */
export function freeCancellationRelative(
  until: string | undefined,
  now: number | null,
): string | null {
  if (now === null || !until) return null;
  const deadline = Date.parse(until);
  if (Number.isNaN(deadline)) return null;
  const diff = deadline - now;
  if (diff <= 0) return "Free cancellation has ended";
  if (diff < 3_600_000) return "Free cancellation for less than an hour";
  if (diff < DAY_MS) {
    return `Free cancellation for ${plural(Math.floor(diff / 3_600_000), "more hour", "more hours")}`;
  }
  return `Free cancellation for ${plural(Math.floor(diff / DAY_MS), "more day", "more days")}`;
}

/** Whether free cancellation still applies at `now`. */
export function isFreeToCancel(
  rate: { refundable: boolean; freeCancelUntil?: string },
  now: number | null,
): boolean {
  if (!rate.refundable) return false;
  if (!rate.freeCancelUntil) return true;
  const deadline = Date.parse(rate.freeCancelUntil);
  if (Number.isNaN(deadline)) return false;
  return now === null || deadline > now;
}

/**
 * A deadline in the hotel's time zone: "Oct 17, 23:59". Falls back to the
 * viewer's zone when the zone is invalid (`hotelTime` false).
 */
export function formatDeadline(
  iso: string,
  timeZone: string | undefined,
  locale: string = DEFAULT_LOCALE,
): { text: string; hotelTime: boolean } | null {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  };
  if (timeZone) {
    try {
      return {
        text: new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(t),
        hotelTime: true,
      };
    } catch {
      // Invalid time zone: fall through.
    }
  }
  return {
    text: new Intl.DateTimeFormat(locale, opts).format(t),
    hotelTime: false,
  };
}

/** "Free cancellation until Oct 17, 23:59 hotel time", or "Non-refundable". */
export function cancellationTerms(
  rate: { refundable: boolean; freeCancelUntil?: string },
  timeZone: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!rate.refundable) return "Non-refundable";
  const deadline = rate.freeCancelUntil
    ? formatDeadline(rate.freeCancelUntil, timeZone, locale)
    : null;
  if (!deadline) return "Free cancellation";
  return `Free cancellation until ${deadline.text}${deadline.hotelTime ? " hotel time" : ""}`;
}

// ---------------------------------------------------------------------------
// Display

/** A calendar date for display: "Mon, Oct 19". Never shifts by time zone. */
export function formatStayDate(
  iso: string | undefined,
  locale: string = DEFAULT_LOCALE,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
  },
): string | null {
  const t = parseISODate(iso);
  if (t === null) return null;
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(t);
}

/** "Mon, Oct 19 – Fri, Oct 23 · 4 nights · 2 adults, 1 child". */
export function staySummary(
  stay: Stay,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const a = formatStayDate(stay.checkIn, locale);
  const b = formatStayDate(stay.checkOut, locale);
  const n = nightsBetween(stay.checkIn, stay.checkOut);
  if (!a || !b || n < 1) return null;
  return `${a} – ${b} · ${nightsLabel(n)} · ${guestSummary(stay)}`;
}

/** An OpenStreetMap search for the address, for a "Directions" link. */
export function directionsUrl(address: string, city?: string): string {
  const q = [address, city].filter(Boolean).join(", ");
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(q)}`;
}
