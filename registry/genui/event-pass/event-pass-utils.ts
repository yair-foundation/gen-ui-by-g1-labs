import qrcode from "qrcode-generator"
import { DEFAULT_LOCALE } from "@/components/genui/locale"

/**
 * Event pass: pure helpers. Times in the event's IANA timezone (Intl only),
 * ticket navigation and state text, the seat summary, and the QR matrix via
 * `qrcode-generator` with UTF-8 bytes. No React, no DOM; safe on the server.
 */

export type TicketState = "valid" | "used" | "transferred" | "refunded"
export type EventPassAction = "add-to-wallet" | "transfer" | "download"

const MINUTE = 60_000

/* ------------------------------------------------------------------------ */
/* Timezones                                                                */
/* ------------------------------------------------------------------------ */

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

/** Wall-clock fields of an instant in a timezone. */
export function zonedParts(t: number, timeZone: string) {
  const out = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const p of partsFormatter(safeTimeZone(timeZone)).formatToParts(t)) {
    if (p.type in out) out[p.type as keyof typeof out] = Number(p.value)
  }
  if (out.hour === 24) out.hour = 0
  return out
}

function offsetMinutes(t: number, timeZone: string): number {
  const p = zonedParts(t, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(t / 1000) * 1000) / MINUTE)
}

function wallTimeToInstant(
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
 * An ISO date-time as an instant. With an offset it is exact; without one
 * ('2026-10-08T20:00') it is wall-clock time at the venue. Null when unreadable.
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

/** The calendar date of an instant in a timezone, as 'YYYY-MM-DD'. */
export function dayKey(t: number, timeZone: string): string {
  const p = zonedParts(t, timeZone)
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`
}

/* ------------------------------------------------------------------------ */
/* Formatting                                                               */
/* ------------------------------------------------------------------------ */

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function fmt(locale: string, options: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(options)}`
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options)
    fmtCache.set(key, f)
  }
  return f
}

const plain = (s: string) => s.replace(/[   ]/g, " ").trim()

/** A time split into the clock ('8:00') and the day period ('PM', or '' in 24-hour locales). */
function clockParts(t: number, timeZone: string, locale: string) {
  const parts = fmt(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: safeTimeZone(timeZone),
  }).formatToParts(t)
  return {
    clock: plain(
      parts
        .filter((p) => p.type !== "dayPeriod")
        .map((p) => p.value)
        .join(""),
    ),
    period: plain(parts.find((p) => p.type === "dayPeriod")?.value ?? ""),
  }
}

/** '8:00 PM' at the venue. */
export function timeText(
  t: number,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  const { clock, period } = clockParts(t, timeZone, locale)
  return period ? `${clock} ${period}` : clock
}

/** '8:00–11:00 PM', or '11:00 AM – 2:00 PM' when the day period changes. */
export function timeRangeText(
  a: number,
  b: number,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  const pa = clockParts(a, timeZone, locale)
  const pb = clockParts(b, timeZone, locale)
  if (pa.period === pb.period) {
    return `${pa.clock}–${pb.clock}${pb.period ? ` ${pb.period}` : ""}`
  }
  return `${timeText(a, timeZone, locale)} – ${timeText(b, timeZone, locale)}`
}

/** 'Thu, Oct 8' at the venue. */
export function dateText(
  t: number,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string {
  return fmt(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: safeTimeZone(timeZone),
  }).format(t)
}

/**
 * The pass's time line in the venue's timezone: 'Thu, Oct 8 · 8:00–11:00 PM',
 * 'Thu, Oct 8 · 8:00 PM' without an end, or 'Sat, Oct 10 · 9:00 PM – Sun,
 * Oct 11, 2:00 AM' past midnight. Null when the start can't be read.
 */
export function eventTimeText(
  start: string | undefined,
  end: string | undefined,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string | null {
  const tz = safeTimeZone(timeZone)
  const s = toInstant(start, tz)
  if (s === null) return null
  const day = dateText(s, tz, locale)
  const e = toInstant(end, tz)
  if (e === null || e <= s) return `${day} · ${timeText(s, tz, locale)}`
  if (dayKey(s, tz) === dayKey(e, tz)) {
    return `${day} · ${timeRangeText(s, e, tz, locale)}`
  }
  return `${day} · ${timeText(s, tz, locale)} – ${dateText(e, tz, locale)}, ${timeText(e, tz, locale)}`
}

/** 'Doors 7:00 PM', or null. */
export function doorsText(
  doorsOpen: string | undefined,
  timeZone: string,
  locale = DEFAULT_LOCALE,
): string | null {
  const t = toInstant(doorsOpen, safeTimeZone(timeZone))
  return t === null ? null : `Doors ${timeText(t, timeZone, locale)}`
}

/* ------------------------------------------------------------------------ */
/* Tickets                                                                  */
/* ------------------------------------------------------------------------ */

export type TicketLike = {
  id: string
  type: string
  section?: string
  row?: string
  seat?: string
  gate?: string
  entrance?: string
  code?:
    | { format: "qr"; value: string }
    | { format: "barcode-placeholder"; label: string }
  ticketState?: TicketState
  usedAt?: string
  transferredTo?: string
}

/** A ticket still admits its holder: valid, or no state given. */
export const isUsable = (t: Pick<TicketLike, "ticketState">) =>
  t.ticketState === undefined || t.ticketState === "valid"

/** Start on the first usable ticket (the one to scan), else the first. */
export function initialTicketIndex(tickets: Pick<TicketLike, "ticketState">[]) {
  const i = tickets.findIndex(isUsable)
  return i === -1 ? 0 : i
}

/** Move by `delta`, clamped to the list (no wrapping). */
export function stepTicket(index: number, delta: number, count: number) {
  if (count <= 0) return 0
  return Math.min(count - 1, Math.max(0, index + delta))
}

/** The ticket to show when the list changes under the current index. */
export const clampTicket = (index: number, count: number) =>
  stepTicket(index, 0, count)

/** '1 of 3'. */
export const positionText = (index: number, count: number) =>
  `${index + 1} of ${count}`

export const STATE_LABEL: Record<Exclude<TicketState, "valid">, string> = {
  used: "Used",
  transferred: "Transferred",
  refunded: "Refunded",
}

/**
 * Why there's no code: 'This ticket was used at 7:42 PM' (with the date when
 * it's not the event's day), 'Transferred to Noa Levi', 'This ticket was
 * refunded'. Null for a usable ticket.
 */
export function ticketStateText(
  ticket: Pick<TicketLike, "ticketState" | "usedAt" | "transferredTo">,
  timeZone: string,
  eventStart?: string,
  locale = DEFAULT_LOCALE,
): string | null {
  const tz = safeTimeZone(timeZone)
  switch (ticket.ticketState) {
    case "used": {
      const at = toInstant(ticket.usedAt, tz)
      if (at === null) return "This ticket was used"
      const start = toInstant(eventStart, tz)
      const sameDay = start !== null && dayKey(start, tz) === dayKey(at, tz)
      return sameDay
        ? `This ticket was used at ${timeText(at, tz, locale)}`
        : `This ticket was used on ${dateText(at, tz, locale)} at ${timeText(at, tz, locale)}`
    }
    case "transferred":
      return ticket.transferredTo
        ? `Transferred to ${ticket.transferredTo}`
        : "This ticket was transferred"
    case "refunded":
      return "This ticket was refunded"
    default:
      return null
  }
}

/** The entry code is shown only on a usable ticket that has one. */
export const canShowCode = (ticket: Pick<TicketLike, "ticketState" | "code">) =>
  isUsable(ticket) && ticket.code !== undefined

/** The handoffs a ticket offers: none once it's used, moved or refunded. */
export function ticketActions(
  ticket: Pick<TicketLike, "ticketState">,
  options: { walletAvailable?: boolean; transferable?: boolean },
): EventPassAction[] {
  if (!isUsable(ticket)) return []
  const out: EventPassAction[] = []
  if (options.walletAvailable) out.push("add-to-wallet")
  if (options.transferable) out.push("transfer")
  out.push("download")
  return out
}

/** 'Section 112, Row F, Seat 7', or the type for unseated tickets. */
export function seatLabel(
  ticket: Pick<TicketLike, "type" | "section" | "row" | "seat">,
): string {
  const parts = [
    ticket.section && `Section ${ticket.section}`,
    ticket.row && `Row ${ticket.row}`,
    ticket.seat && `Seat ${ticket.seat}`,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(", ") : ticket.type
}

/** '7–9' for consecutive numbers, '7, 9, 12' otherwise. */
function seatList(seats: string[]): string {
  const nums = seats.map((s) => (/^\d+$/.test(s) ? Number(s) : Number.NaN))
  if (nums.every((n) => !Number.isNaN(n))) {
    const sorted = [...nums].sort((a, b) => a - b)
    const consecutive = sorted.every(
      (n, i) => i === 0 || n === sorted[i - 1] + 1,
    )
    if (consecutive && sorted.length > 1) {
      return `${sorted[0]}–${sorted[sorted.length - 1]}`
    }
    return sorted.join(", ")
  }
  return seats.join(", ")
}

/**
 * Every ticket at a glance:
 * - 'Section 112 · Row F · Seats 7–9'
 * - 'Section 112 · Row F · Seat 7'
 * - '3 × General admission', 'General admission', '2 tickets'
 */
export function seatSummary(
  tickets: Pick<TicketLike, "type" | "section" | "row" | "seat">[],
): string {
  const n = tickets.length
  if (n === 0) return ""
  const same = (key: "section" | "row") => {
    const first = tickets[0][key]
    return first !== undefined && tickets.every((t) => t[key] === first)
      ? first
      : null
  }
  const seated = tickets.some((t) => t.section || t.row || t.seat)
  if (!seated) {
    const type = tickets[0].type
    if (tickets.every((t) => t.type === type)) {
      return n === 1 ? type : `${n} × ${type}`
    }
    return `${n} tickets`
  }
  const section = same("section")
  const row = same("row")
  const seats = tickets.map((t) => t.seat).filter((s): s is string => !!s)
  const mixed =
    (section === null && tickets.some((t) => t.section)) ||
    (row === null && tickets.some((t) => t.row))
  if (mixed) return `${n} tickets`
  const parts = [section && `Section ${section}`, row && `Row ${row}`]
  if (seats.length === n) {
    parts.push(n === 1 ? `Seat ${seats[0]}` : `Seats ${seatList(seats)}`)
  }
  return parts.filter(Boolean).join(" · ") || `${n} tickets`
}

/* ------------------------------------------------------------------------ */
/* QR code                                                                  */
/* ------------------------------------------------------------------------ */

/** Byte-mode capacity of the largest QR code (version 40), per level. */
export const BYTE_CAPACITY = { L: 2953, M: 2331, Q: 1663, H: 1273 } as const
export type QrLevel = keyof typeof BYTE_CAPACITY

export function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

export type QrMatrix = boolean[][]

export type QrEncoding =
  | { ok: true; modules: QrMatrix; version: number; bytes: number[] }
  | { ok: false; error: "too-long" | "empty"; bytes: number[] }

/**
 * Encodes the provider's payload as UTF-8 in byte mode at the smallest
 * version that fits. The library reads bytes through its global
 * `stringToBytes` (Latin-1 by default), so it's swapped for our UTF-8 bytes
 * during `addData` only and restored right after.
 */
export function encodeQr(text: string, level: QrLevel = "M"): QrEncoding {
  const bytes = utf8Bytes(text)
  if (bytes.length === 0) return { ok: false, error: "empty", bytes }
  const tooLong = { ok: false, error: "too-long", bytes } as const
  if (bytes.length > BYTE_CAPACITY[level]) return tooLong

  const qr = qrcode(0, level)
  const previous = qrcode.stringToBytes
  qrcode.stringToBytes = () => bytes
  try {
    qr.addData(text, "Byte")
  } finally {
    qrcode.stringToBytes = previous
  }
  try {
    qr.make()
  } catch {
    return tooLong
  }

  const count = qr.getModuleCount()
  const modules: QrMatrix = []
  for (let r = 0; r < count; r++) {
    const row: boolean[] = []
    for (let c = 0; c < count; c++) row.push(qr.isDark(r, c))
    modules.push(row)
  }
  return { ok: true, modules, version: (count - 17) / 4, bytes }
}

/** Quiet zone around the code, in modules (the standard minimum). */
export const QUIET_ZONE = 4

/**
 * One SVG path for all dark modules, one rectangle per horizontal run, offset
 * by the quiet zone. Use with `viewBox="0 0 n+2m n+2m"`.
 */
export function matrixToPath(modules: QrMatrix, margin = QUIET_ZONE): string {
  const out: string[] = []
  modules.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (!row[c]) {
        c++
        continue
      }
      const start = c
      while (c < row.length && row[c]) c++
      const n = c - start
      out.push(`M${start + margin} ${r + margin}h${n}v1h-${n}z`)
    }
  })
  return out.join("")
}

/** The side of the code including the quiet zone, in modules. */
export const qrDimension = (modules: QrMatrix, margin = QUIET_ZONE) =>
  modules.length + margin * 2
