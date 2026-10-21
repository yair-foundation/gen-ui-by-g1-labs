/**
 * Flight ticket: pure helpers. Intl only, no date library, no React, no DOM:
 * safe to reuse on the server and to unit-test in Node.
 *
 * Every time is an instant (ms since the epoch) shown in the airport's own
 * IANA timezone, so "07:40" in Lisbon stays 07:40 for a viewer in Tokyo.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";

export type FlightTicketAction =
  | "check-in"
  | "add-to-wallet"
  | "choose-seat"
  | "manage"
  | "share";

export type PassType = "booking" | "boarding-pass";

/** A connection shorter than this is flagged "Short connection". */
export const SHORT_CONNECTION_MINUTES = 60;

const MINUTE = 60_000;

/* ------------------------------------------------------------------------ */
/* Timezones                                                                */
/* ------------------------------------------------------------------------ */

const partsCache = new Map<string, Intl.DateTimeFormat>();

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

const floating =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const hasOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/**
 * An ISO time as an instant. With an offset ('2026-10-09T07:40:00+01:00') it
 * is exact; without one ('2026-10-09T07:40') it is wall-clock time at the
 * airport. Null when unparseable.
 */
export function toInstant(
  value: string | undefined,
  timeZone: string,
): number | null {
  if (!value) return null;
  const v = value.trim();
  if (!hasOffset.test(v)) {
    const f = floating.exec(v);
    if (f) {
      return wallTimeToInstant(+f[1], +f[2], +f[3], +f[4], +f[5], timeZone);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
export function resolveNow(
  now: Date | string | number | undefined,
): number | null {
  if (now === undefined) return null;
  const t = typeof now === "string" ? Date.parse(now) : new Date(now).getTime();
  return Number.isFinite(t) ? t : null;
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

/** 24-hour clock time at the airport, as printed on boarding passes: '07:40'. */
export function formatClock(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** The local date at the airport: 'Fri, Oct 9' (or 'Friday, October 9'). */
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
  }).format(t);
}

/** The airport's UTC offset at an instant: 'GMT+1', 'GMT-4', 'GMT+5:30'. */
export function formatOffset(t: number, timeZone: string): string {
  const m = offsetMinutes(t, timeZone);
  const sign = m < 0 ? "-" : "+";
  const abs = Math.abs(m);
  const h = Math.floor(abs / 60);
  const min = abs % 60;
  return `GMT${sign}${h}${min ? `:${String(min).padStart(2, "0")}` : ""}`;
}

/** Spoken context for a time: 'Lisbon time (GMT+1)'. */
export function zoneLabel(city: string, t: number, timeZone: string): string {
  return `${city} time (${formatOffset(t, timeZone)})`;
}

/** The calendar date of an instant at the airport, as 'YYYY-MM-DD'. */
export function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
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
  const a = Date.parse(`${dayKey(depart, departZone)}T12:00:00Z`);
  const b = Date.parse(`${dayKey(arrive, arriveZone)}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** '7 h 45 min', '55 min', '2 h'. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (h === 0) return `${rest} min`;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/** A span of time, coarser as it grows: '40 min', '3 h 10 min', '1 day 3 h', '13 days'. */
export function formatSpan(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / MINUTE);
  if (minutes < 1) return "less than a minute";
  if (minutes < 24 * 60) return formatDuration(minutes);
  const days = Math.floor(minutes / (24 * 60));
  if (days >= 2) return `${days} days`;
  const hours = Math.round((minutes - 24 * 60) / 60);
  return hours === 0 ? "1 day" : `1 day ${hours} h`;
}

/* ------------------------------------------------------------------------ */
/* Segments                                                                 */
/* ------------------------------------------------------------------------ */

export type AirportLike = { code: string; city: string; timeZone: string };

export type SegmentLike = {
  from: AirportLike;
  to: AirportLike;
  departAt: string;
  arriveAt: string;
  duration?: number;
};

/** Departure and arrival instants of a segment, or null when unparseable. */
export function segmentTimes(
  s: SegmentLike,
): { depart: number; arrive: number } | null {
  const depart = toInstant(s.departAt, s.from.timeZone);
  const arrive = toInstant(s.arriveAt, s.to.timeZone);
  if (depart === null || arrive === null) return null;
  return { depart, arrive };
}

/** Flight time in minutes: the given duration, else arrival minus departure. */
export function segmentMinutes(s: SegmentLike): number | null {
  if (typeof s.duration === "number" && s.duration > 0) return s.duration;
  const t = segmentTimes(s);
  if (!t || t.arrive < t.depart) return null;
  return Math.round((t.arrive - t.depart) / MINUTE);
}

export type Layover = {
  /** Where the connection happens (the arrival airport of the first leg). */
  at: AirportLike;
  minutes: number;
  /** Under an hour. */
  short: boolean;
  /** The next flight leaves from a different airport (e.g. LHR → LGW). */
  changeTo?: AirportLike;
};

/** The connections between consecutive segments, in order. */
export function layovers(segments: SegmentLike[]): (Layover | null)[] {
  const out: (Layover | null)[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const a = segmentTimes(segments[i]);
    const b = segmentTimes(segments[i + 1]);
    if (!a || !b) {
      out.push(null);
      continue;
    }
    const minutes = Math.round((b.depart - a.arrive) / MINUTE);
    const at = segments[i].to;
    const next = segments[i + 1].from;
    out.push({
      at,
      minutes,
      short: minutes < SHORT_CONNECTION_MINUTES,
      ...(next.code !== at.code ? { changeTo: next } : {}),
    });
  }
  return out;
}

/** Door-to-door minutes, first departure to last arrival. */
export function journeyMinutes(segments: SegmentLike[]): number | null {
  if (segments.length === 0) return null;
  const first = segmentTimes(segments[0]);
  const last = segmentTimes(segments[segments.length - 1]);
  if (!first || !last || last.arrive < first.depart) return null;
  return Math.round((last.arrive - first.depart) / MINUTE);
}

/* ------------------------------------------------------------------------ */
/* Check-in, boarding and actions                                           */
/* ------------------------------------------------------------------------ */

export type CheckInState =
  | "checked-in"
  | "open"
  | "not-open"
  | "closed"
  | "unknown";

/**
 * Where check-in stands. 'open' once `checkInOpensAt` has passed and until
 * departure; 'unknown' when there is no opening time or no clock yet.
 */
export function checkInState(input: {
  checkedIn?: boolean;
  passType?: PassType;
  checkInOpensAt?: number | null;
  departAt?: number | null;
  now: number | null;
}): CheckInState {
  if (input.checkedIn || input.passType === "boarding-pass") {
    return "checked-in";
  }
  if (input.now === null) return "unknown";
  if (typeof input.departAt === "number" && input.now >= input.departAt) {
    return "closed";
  }
  if (typeof input.checkInOpensAt !== "number") return "unknown";
  return input.now >= input.checkInOpensAt ? "open" : "not-open";
}

/** 'Check-in opens in 3 h', 'Check-in is open', 'Checked in', or null. */
export function checkInText(
  state: CheckInState,
  opensAt: number | null | undefined,
  now: number | null,
): string | null {
  switch (state) {
    case "checked-in":
      return "Checked in";
    case "open":
      return "Check-in is open";
    case "closed":
      return "Check-in closed";
    case "not-open":
      return typeof opensAt === "number" && now !== null
        ? `Check-in opens in ${formatSpan(opensAt - now)}`
        : null;
    default:
      return null;
  }
}

/** 'Boarding in 40 min', 'Boarding now', 'Departed', or null before mount. */
export function boardingText(
  boardingAt: number | null,
  departAt: number | null,
  now: number | null,
): string | null {
  if (now === null) return null;
  if (departAt !== null && now >= departAt) return "Departed";
  if (boardingAt === null) return null;
  if (now >= boardingAt) return "Boarding now";
  return `Boarding in ${formatSpan(boardingAt - now)}`;
}

/** 'Departs in 1 day 3 h', 'Departed', or null before mount. */
export function departsText(
  departAt: number | null,
  now: number | null,
): string | null {
  if (now === null || departAt === null) return null;
  if (now >= departAt) return "Departed";
  return `Departs in ${formatSpan(departAt - now)}`;
}

/**
 * Defaults when the agent passes no actions. The first is primary.
 * - boarding pass: add to wallet, share
 * - booking, check-in open: check in, choose seat, manage
 * - booking, checked in: add to wallet, manage
 * - booking otherwise: manage, choose seat
 */
export function defaultActions(
  passType: PassType,
  checkIn: CheckInState,
): FlightTicketAction[] {
  if (passType === "boarding-pass") return ["add-to-wallet", "share"];
  if (checkIn === "open") return ["check-in", "choose-seat", "manage"];
  if (checkIn === "checked-in") return ["add-to-wallet", "manage"];
  return ["manage", "choose-seat"];
}

/**
 * The buttons to show: the agent's list (or the defaults), de-duplicated,
 * with check-in dropped once the passenger is checked in or it's closed.
 */
export function resolveActions(
  actions: readonly FlightTicketAction[] | undefined,
  passType: PassType,
  checkIn: CheckInState,
): FlightTicketAction[] {
  const list =
    actions && actions.length > 0 ? actions : defaultActions(passType, checkIn);
  return [...new Set(list)].filter(
    (a) =>
      a !== "check-in" || (checkIn !== "checked-in" && checkIn !== "closed"),
  );
}

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
