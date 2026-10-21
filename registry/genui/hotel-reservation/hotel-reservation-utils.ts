/**
 * Hotel reservation: pure helpers. Intl only, no date library, no React, no
 * DOM: safe to reuse on the server and to unit-test in Node.
 *
 * Stay dates are calendar dates ("2026-10-15") and run in UTC so a stay never
 * gains or loses a night across DST. "Today" and check-in/out moments are
 * read in the hotel's own IANA timezone, so "Tonight" is true where the hotel
 * is, not where the viewer is. Money runs in integer minor units.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type StayDates = { checkIn: string; checkOut: string };

export type StayPhase =
  | "upcoming"
  | "arrival"
  | "in-stay"
  | "departure"
  | "ended";

export type StayState = {
  phase: StayPhase;
  /** "In 3 days", "Tomorrow", "Tonight", "Night 2 of 3", "Checking out today", "Stay ended". */
  text: string;
  nights: number;
  /** Calendar days until check-in (upcoming only). */
  daysUntil?: number;
  /** Which night of the stay tonight is (in-stay only), 1-based. */
  night?: number;
};

const DAY_MS = 86_400_000;
const MINUTE = 60_000;

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Calendar dates

/** A calendar date ("2026-10-19") as UTC midnight in ms, or null if invalid. */
export function parseISODate(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).getUTCDate() === Number(m[3]) ? t : null;
}

/** Nights between check-in and check-out. 0 when either is invalid or out of order. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = parseISODate(checkIn);
  const b = parseISODate(checkOut);
  if (a === null || b === null || b <= a) return 0;
  return Math.round((b - a) / DAY_MS);
}

export function nightsLabel(nights: number): string {
  return plural(nights, "night", "nights");
}

/** A calendar date for display: "Thu, Oct 15". Never shifts by time zone. */
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

/** "Thu, Oct 15 – Sun, Oct 18 · 3 nights", or null when the dates are invalid. */
export function datesLine(
  stay: StayDates,
  locale: string = DEFAULT_LOCALE,
): string | null {
  const a = formatStayDate(stay.checkIn, locale);
  const b = formatStayDate(stay.checkOut, locale);
  const n = nightsBetween(stay.checkIn, stay.checkOut);
  if (!a || !b || n < 1) return null;
  return `${a} – ${b} · ${nightsLabel(n)}`;
}

// ---------------------------------------------------------------------------
// Time zones

/** The timezone if the runtime knows it, otherwise 'UTC'. */
export function safeTimeZone(timeZone: string | undefined): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string) {
  let f = partsCache.get(timeZone);
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
    });
    partsCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of an instant in a timezone. */
export function zonedParts(t: number, timeZone: string) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const p of partsFormatter(safeTimeZone(timeZone)).formatToParts(t)) {
    if (p.type in out) out[p.type as keyof typeof out] = Number(p.value);
  }
  if (out.hour === 24) out.hour = 0;
  return out;
}

/** Offset from UTC in minutes at an instant, e.g. 60 for Lisbon in summer. */
export function offsetMinutes(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / MINUTE);
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
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = offsetMinutes(guess, timeZone);
  let t = guess - first * MINUTE;
  // Near a DST change the offset at the guess can differ from the real one.
  const second = offsetMinutes(t, timeZone);
  if (second !== first) t = guess - second * MINUTE;
  return t;
}

/** The calendar date of an instant in a timezone, as 'YYYY-MM-DD'. */
export function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "15:00" or "9:30" as hours and minutes, or null. */
export function parseClock(
  value: string | undefined,
): { hour: number; minute: number } | null {
  if (!value) return null;
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

/** "9:30" → "09:30"; null when it isn't a 24-hour time. */
export function formatClockValue(value: string | undefined): string | null {
  const c = parseClock(value);
  if (!c) return null;
  return `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
}

/** The instant of a wall-clock time on a calendar date at the hotel. */
export function hotelInstant(
  date: string,
  clock: string | undefined,
  timeZone: string,
): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const c = parseClock(clock);
  if (!d || !c || parseISODate(date) === null) return null;
  return wallTimeToInstant(
    +d[1],
    +d[2],
    +d[3],
    c.hour,
    c.minute,
    safeTimeZone(timeZone),
  );
}

/**
 * When the stay ends: the check-out date at `checkOutUntil`, hotel time. Use
 * it as the call's `expiresAt`.
 */
export function checkOutInstant(
  stay: StayDates,
  hotel: { timeZone: string; checkOutUntil?: string },
): number | null {
  return hotelInstant(stay.checkOut, hotel.checkOutUntil, hotel.timeZone);
}

// ---------------------------------------------------------------------------
// Stay state

/**
 * Where the stay stands today, by the calendar in the hotel's timezone:
 * "In 3 days", "Tomorrow", "Tonight" (check-in day), "Night 2 of 3",
 * "Checking out today" (until check-out time), then "Stay ended". Null before
 * mount (`now` unknown) or when the dates are invalid.
 */
export function stayState(
  stay: StayDates,
  hotel: { timeZone: string; checkOutUntil?: string },
  now: number | null,
): StayState | null {
  if (now === null) return null;
  const nights = nightsBetween(stay.checkIn, stay.checkOut);
  const checkIn = parseISODate(stay.checkIn);
  const checkOut = parseISODate(stay.checkOut);
  const today = parseISODate(dayKey(now, hotel.timeZone));
  if (checkIn === null || checkOut === null || today === null || nights < 1) {
    return null;
  }
  const untilIn = Math.round((checkIn - today) / DAY_MS);
  if (untilIn > 1) {
    return {
      phase: "upcoming",
      text: `In ${untilIn} days`,
      nights,
      daysUntil: untilIn,
    };
  }
  if (untilIn === 1) {
    return { phase: "upcoming", text: "Tomorrow", nights, daysUntil: 1 };
  }
  if (untilIn === 0) return { phase: "arrival", text: "Tonight", nights };
  const untilOut = Math.round((checkOut - today) / DAY_MS);
  if (untilOut > 0) {
    const night = nights - untilOut + 1;
    return {
      phase: "in-stay",
      text: `Night ${night} of ${nights}`,
      nights,
      night,
    };
  }
  if (untilOut === 0) {
    const out = checkOutInstant(stay, hotel);
    if (out === null || now < out) {
      return { phase: "departure", text: "Checking out today", nights };
    }
  }
  return { phase: "ended", text: "Stay ended", nights };
}

/** "Check-in from 15:00", or null without a valid time. */
export function checkInLine(checkInFrom: string | undefined): string | null {
  const t = formatClockValue(checkInFrom);
  return t ? `Check-in from ${t}` : null;
}

/** "Check-out until 11:00", or null without a valid time. */
export function checkOutLine(checkOutUntil: string | undefined): string | null {
  const t = formatClockValue(checkOutUntil);
  return t ? `Check-out until ${t}` : null;
}

/**
 * The header's state line: the state, plus the time that matters today.
 * "Tonight · Check-in from 15:00", "Checking out today · Check-out until
 * 11:00", "In 3 days", "Night 2 of 3".
 */
export function stayStateLine(
  state: StayState | null,
  hotel: { checkInFrom?: string; checkOutUntil?: string },
): string | null {
  if (!state) return null;
  const detail =
    state.phase === "arrival"
      ? checkInLine(hotel.checkInFrom)
      : state.phase === "departure"
        ? checkOutLine(hotel.checkOutUntil)
        : null;
  return detail ? `${state.text} · ${detail}` : state.text;
}

// ---------------------------------------------------------------------------
// Cancellation

/**
 * "Free cancellation until Oct 14, 23:59 hotel time", or "Free cancellation
 * has ended" once the deadline passed (needs `now`). Null when unparseable.
 */
export function cancellationLine(
  freeUntil: string | undefined,
  timeZone: string,
  now: number | null,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!freeUntil) return null;
  const t = Date.parse(freeUntil);
  if (Number.isNaN(t)) return null;
  if (now !== null && now >= t) return "Free cancellation has ended";
  const text = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: safeTimeZone(timeZone),
  }).format(t);
  return `Free cancellation until ${text} hotel time`;
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

// ---------------------------------------------------------------------------
// Links

/** A link from agent data, only when it's http(s). */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

/** An OpenStreetMap search for the address, for a "Directions" link. */
export function directionsUrl(address: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(address.trim())}`;
}

/** `tel:` with only a leading + and digits: "+351 21 000 0000" → "tel:+351210000000". */
export function telHref(phone: string | undefined): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 3) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

// ---------------------------------------------------------------------------
// Calendar file

/** iCalendar TEXT values escape `\ ; ,` and line breaks. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utf8Length(char: string): number {
  const c = char.codePointAt(0) ?? 0;
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
}

/** Folds a content line at 75 octets, never inside a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const len = utf8Length(char);
    // Continuation lines start with a space, which counts toward the 75.
    if (octets + len > 75) {
      out.push(current);
      current = ` ${char}`;
      octets = 1 + len;
    } else {
      current += char;
      octets += len;
    }
  }
  out.push(current);
  return out.join("\r\n");
}

function icsUtc(t: number): string {
  return `${new Date(t).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

export type StayIcsInput = {
  hotelName: string;
  address?: string;
  timeZone: string;
  checkInFrom?: string;
  checkOutUntil?: string;
  stay: StayDates;
  confirmation?: string;
  url?: string;
  /** DTSTAMP: when the file was made. */
  stamp: number;
};

/**
 * A one-event .ics file for the stay: from check-in time on the check-in date
 * to check-out time on the check-out date, hotel time, written in UTC. Without
 * valid times it's an all-day event across the stay (DTEND exclusive). Null
 * when the dates are invalid.
 */
export function buildStayIcs(input: StayIcsInput): string | null {
  const { stay, timeZone } = input;
  if (nightsBetween(stay.checkIn, stay.checkOut) < 1) return null;
  const start = hotelInstant(stay.checkIn, input.checkInFrom, timeZone);
  const end = hotelInstant(stay.checkOut, input.checkOutUntil, timeZone);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GenUI//Hotel Reservation//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(`${input.confirmation ?? stay.checkIn}-${stay.checkIn}@genui-hotel-reservation`)}`,
    `DTSTAMP:${icsUtc(input.stamp)}`,
  ];
  if (start !== null && end !== null && end > start) {
    lines.push(`DTSTART:${icsUtc(start)}`, `DTEND:${icsUtc(end)}`);
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${stay.checkIn.replace(/-/g, "")}`,
      `DTEND;VALUE=DATE:${stay.checkOut.replace(/-/g, "")}`,
    );
  }
  lines.push(`SUMMARY:${escapeIcsText(`Stay at ${input.hotelName}`)}`);
  if (input.address) lines.push(`LOCATION:${escapeIcsText(input.address)}`);
  const notes = [
    input.confirmation && `Confirmation ${input.confirmation}`,
    datesLine(stay),
    checkInLine(input.checkInFrom),
    checkOutLine(input.checkOutUntil),
  ].filter(Boolean);
  if (notes.length > 0) {
    lines.push(`DESCRIPTION:${escapeIcsText(notes.join("\n"))}`);
  }
  const link = safeUrl(input.url);
  if (link) lines.push(`URL:${link}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/** 'stay-casa-azulejo.ics'. */
export function icsFilename(hotelName: string): string {
  const slug = hotelName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `stay-${slug || "hotel"}.ics`;
}

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
export function resolveNow(
  now: Date | string | number | undefined,
): number | null {
  if (now === undefined) return null;
  const t = typeof now === "string" ? Date.parse(now) : new Date(now).getTime();
  return Number.isFinite(t) ? t : null;
}
