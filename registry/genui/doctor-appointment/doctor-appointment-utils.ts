/**
 * Doctor Appointment: pure helpers. Slots are ISO instants with an offset
 * ("2026-10-13T09:40:00-04:00"); everything shown to the user is the wall
 * clock in the clinic's IANA time zone. Without a zone, the wall clock as the
 * source wrote it (its own offset) is used, so server and client agree.
 * No React, no DOM: safe to reuse on the server and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type Slot = { providerId: string; visitTypeId: string; start: string }

const DAY_MS = 86_400_000
const MIN_MS = 60_000

// ---------------------------------------------------------------------------
// Instants and wall clocks

/** An ISO instant as epoch ms, or null. Requires a date and a time. */
export function parseInstant(iso: string | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso)) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/** Wall-clock parts of an instant: calendar date and minutes after midnight. */
export type WallClock = { date: string; minutes: number }

/**
 * The wall clock of an ISO instant in a time zone. Without a zone (or with an
 * unknown one), the date and time exactly as written in the string.
 */
export function wallClock(
  iso: string | undefined,
  timeZone?: string,
): WallClock | null {
  const t = parseInstant(iso)
  if (t === null || !iso) return null
  if (timeZone) {
    try {
      const p = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(t)
      const get = (type: string) => p.find((x) => x.type === type)?.value ?? ""
      return {
        date: `${get("year")}-${get("month")}-${get("day")}`,
        minutes: Number(get("hour")) * 60 + Number(get("minute")),
      }
    } catch {
      // Unknown zone: fall through to the written wall clock.
    }
  }
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return null
  return { date: m[1], minutes: Number(m[2]) * 60 + Number(m[3]) }
}

/** A calendar date ("2026-10-13") as UTC midnight in ms, or null. */
export function parseDate(date: string | undefined): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? "")
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return Number.isNaN(t) ? null : t
}

/** Minutes after midnight for display in the viewer's locale ("9:40 AM"). */
export function formatMinutes(
  minutes: number,
  locale: string = DEFAULT_LOCALE,
): string {
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
  // "Tue Oct 13": weekday and date without the locale's comma.
  if (style === "short") {
    return `${f({ weekday: "short" })} ${f({ month: "short", day: "numeric" })}`
  }
  return f({ weekday: "long", month: "long", day: "numeric" })
}

/** "9:40 AM" for an instant, in the clinic's zone. */
export function formatSlotTime(
  iso: string,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const w = wallClock(iso, timeZone)
  return w ? formatMinutes(w.minutes, locale) : iso
}

/** "Tue Oct 13, 9:40 AM" for an instant, in the clinic's zone. */
export function formatSlot(
  iso: string,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const w = wallClock(iso, timeZone)
  if (!w) return iso
  return `${formatDate(w.date, "short", locale)}, ${formatMinutes(w.minutes, locale)}`
}

/** The UTC offset written in an ISO string ("GMT-4", "GMT+5:30", "GMT+0"). */
function writtenOffset(iso: string): string | null {
  if (/Z$/i.test(iso)) return "GMT+0"
  const m = /([+-])(\d{2}):?(\d{2})$/.exec(iso)
  if (!m) return null
  const h = Number(m[2])
  const min = Number(m[3])
  if (h === 0 && min === 0) return "GMT+0"
  return `GMT${m[1]}${h}${min ? `:${m[3]}` : ""}`
}

/**
 * The time zone as shown to the user: "America/New_York (GMT-4)", with the
 * offset in effect at `at` (an ISO instant or epoch ms), so a DST week shows
 * the right offset for each day. Without a zone, the offset the source wrote.
 */
export function timeZoneLabel(
  timeZone: string | undefined,
  at?: string | number,
): string | null {
  const ms =
    typeof at === "number" ? at : at !== undefined ? parseInstant(at) : null
  if (!timeZone) {
    const offset = typeof at === "string" ? writtenOffset(at) : null
    return offset ? `clinic time (${offset})` : null
  }
  try {
    const offset = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(ms ?? Date.now())
      .find((p) => p.type === "timeZoneName")?.value
    // Node's ICU says "GMT" where browsers say "GMT+0"; pick one.
    return offset
      ? `${timeZone} (${offset === "GMT" ? "GMT+0" : offset})`
      : timeZone
  } catch {
    return timeZone
  }
}

// ---------------------------------------------------------------------------
// Slots

export type SlotFilter = {
  /** null: any provider. */
  providerId: string | null
  visitTypeId: string | null
  /** Calendar date in the clinic's zone. Omit for every day. */
  date?: string
}

/** Slots matching the provider, visit type and day, in time order (then provider order). */
export function filterSlots<T extends Slot>(
  slots: T[],
  filter: SlotFilter,
  timeZone?: string,
  providerOrder: string[] = [],
): T[] {
  const rank = (id: string) => {
    const i = providerOrder.indexOf(id)
    return i === -1 ? providerOrder.length : i
  }
  return slots
    .filter(
      (s) =>
        parseInstant(s.start) !== null &&
        (filter.providerId === null || s.providerId === filter.providerId) &&
        (filter.visitTypeId === null || s.visitTypeId === filter.visitTypeId) &&
        (filter.date === undefined ||
          wallClock(s.start, timeZone)?.date === filter.date),
    )
    .sort(
      (a, b) =>
        (parseInstant(a.start) ?? 0) - (parseInstant(b.start) ?? 0) ||
        rank(a.providerId) - rank(b.providerId),
    )
}

/**
 * The earliest matching slot. With `now`, slots that already started are
 * skipped.
 */
export function earliestSlot<T extends Slot>(
  slots: T[],
  filter: Omit<SlotFilter, "date">,
  now: number | null = null,
  providerOrder: string[] = [],
): T | null {
  const list = filterSlots(slots, filter, undefined, providerOrder)
  return (
    list.find((s) => now === null || (parseInstant(s.start) ?? 0) > now) ?? null
  )
}

export type StripDay = { date: string; count: number }

/**
 * The days strip: every day any slot falls on (in the clinic's zone), so the
 * strip stays put when the user changes provider or visit type, with the count
 * of slots matching the filter on that day (0 shows the day as having none).
 */
export function dayStrip(
  slots: Slot[],
  filter: Omit<SlotFilter, "date">,
  timeZone?: string,
): StripDay[] {
  const counts = new Map<string, number>()
  for (const s of slots) {
    const w = wallClock(s.start, timeZone)
    if (!w) continue
    const match =
      (filter.providerId === null || s.providerId === filter.providerId) &&
      (filter.visitTypeId === null || s.visitTypeId === filter.visitTypeId)
    counts.set(w.date, (counts.get(w.date) ?? 0) + (match ? 1 : 0))
  }
  return [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
}

/** A stable key for one slot. */
export function slotKey(s: Slot): string {
  return `${s.providerId}|${s.visitTypeId}|${s.start}`
}

// ---------------------------------------------------------------------------
// People

/** "Dr. Maya Chen" → "Dr. Chen"; other names stay as they are. */
export function shortName(name: string): string {
  const m = /^(Dr\.?|Doctor)\s+(.+)$/i.exec(name.trim())
  if (!m) return name.trim()
  const parts = m[2].trim().split(/\s+/)
  return `Dr. ${parts[parts.length - 1]}`
}

/** "Dr. Maya Chen" → "MC". Titles and suffixes are skipped. */
export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter(
      (w) => !/^(dr|doctor|prof|mr|mrs|ms|mx|md|do|np|pa|jr|sr)\.?,?$/i.test(w),
    )
  if (words.length === 0) return "?"
  const first = words[0][0] ?? ""
  const last = words.length > 1 ? (words[words.length - 1][0] ?? "") : ""
  return `${first}${last}`.toUpperCase()
}

/** "Speaks English and Spanish", "Speaks English, Mandarin and Cantonese". */
export function languagesText(languages: string[] | undefined): string | null {
  const list = (languages ?? []).map((l) => l.trim()).filter(Boolean)
  if (list.length === 0) return null
  if (list.length === 1) return `Speaks ${list[0]}`
  return `Speaks ${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`
}

// ---------------------------------------------------------------------------
// Insurance

export type InsuranceState = {
  /** accepted: on the clinic's list; not-listed: the user's plan isn't; none: no plan chosen. */
  kind: "accepted" | "not-listed" | "none"
  text: string
}

const normalise = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

/** Whether the plan is on the clinic's list (case and spacing ignored). */
export function isPlanAccepted(
  accepted: string[] | undefined,
  plan: string | null | undefined,
): boolean {
  if (!plan) return false
  const p = normalise(plan)
  return (accepted ?? []).some((a) => normalise(a) === p)
}

/** One sentence about the chosen plan against the clinic's list. */
export function insuranceText(
  accepted: string[] | undefined,
  plan: string | null | undefined,
): InsuranceState {
  if (!plan) {
    return {
      kind: "none",
      text: "Not listed? You can still book; you may pay out of pocket.",
    }
  }
  if (isPlanAccepted(accepted, plan)) {
    return { kind: "accepted", text: `${plan} is accepted at this clinic.` }
  }
  return {
    kind: "not-listed",
    text: `${plan} isn't on this clinic's list. You can still book; you may pay out of pocket.`,
  }
}

// ---------------------------------------------------------------------------
// Time relative to now

/** Today's calendar date in a time zone, or UTC when it's missing or unknown. */
export function todayIn(timeZone: string | undefined, now: number): string {
  const parts = (zone: string) =>
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

/**
 * How far away the appointment is, by the clinic's calendar: "Today",
 * "Tomorrow", "In 3 days", "Earlier today", "Yesterday", "4 days ago".
 * Null until the current time is known (after mount).
 */
export function relativeDate(
  start: string | undefined,
  timeZone: string | undefined,
  now: number | null,
): string | null {
  if (now === null) return null
  const at = parseInstant(start)
  const w = wallClock(start, timeZone)
  if (at === null || !w) return null
  const target = parseDate(w.date)
  const today = parseDate(todayIn(timeZone, now))
  if (target === null || today === null) return null
  const days = Math.round((target - today) / DAY_MS)
  if (days === 0) return at < now ? "Earlier today" : "Today"
  if (days === 1) return "Tomorrow"
  if (days === -1) return "Yesterday"
  return days > 1 ? `In ${days} days` : `${-days} days ago`
}

export type JoinWindow =
  /** Too early: the link opens at `opensAt`. */
  | { state: "before"; opensAt: number }
  | { state: "open" }
  /** The visit is over. */
  | { state: "ended" }
  /** The current time isn't known yet (before mount). */
  | { state: "unknown" }

/**
 * When the video link can be used: from `opensMinutesBefore` before the start
 * until the end of the visit plus `graceMin`. Without `opensMinutesBefore`
 * the link is open until the visit ends.
 */
export function videoJoinWindow(
  start: string | undefined,
  {
    durationMin,
    opensMinutesBefore,
    graceMin = 30,
  }: { durationMin?: number; opensMinutesBefore?: number; graceMin?: number },
  now: number | null,
): JoinWindow {
  const at = parseInstant(start)
  if (at === null || now === null) return { state: "unknown" }
  const end = at + (durationMin ?? 30) * MIN_MS + graceMin * MIN_MS
  if (now > end) return { state: "ended" }
  if (opensMinutesBefore !== undefined) {
    const opensAt = at - Math.max(0, opensMinutesBefore) * MIN_MS
    if (now < opensAt) return { state: "before", opensAt }
  }
  return { state: "open" }
}

/** "Opens 15 min before", "Opens 1 hour before". */
export function opensBeforeText(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const h = minutes / 60
    return `Opens ${h} ${h === 1 ? "hour" : "hours"} before`
  }
  return `Opens ${minutes} min before`
}

// ---------------------------------------------------------------------------
// Links

/** An http(s) URL, normalised, or null. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** An http(s) URL or a data:image URL, or null. */
export function safeImageUrl(src: string | undefined): string | null {
  if (!src) return null
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(src)) return src
  return safeUrl(src)
}

export function directionsUrl(location: string): string {
  return `https://www.openstreetmap.org/search?query=${encodeURIComponent(location)}`
}

/** A phone number for a tel: link (digits and a leading +), or null. */
export function telHref(phone: string | undefined): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "")
  return /\d{3,}/.test(digits) ? `tel:${digits}` : null
}

// ---------------------------------------------------------------------------
// iCalendar

/** Escapes a TEXT value (RFC 5545 §3.3.11). */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

function utf8Length(char: string): number {
  const c = char.codePointAt(0) ?? 0
  return c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4
}

/** Folds a content line at 75 octets, never inside a UTF-8 character. */
export function foldIcsLine(line: string): string {
  const out: string[] = []
  let current = ""
  let octets = 0
  for (const char of line) {
    const len = utf8Length(char)
    // Continuation lines start with a space, which counts toward the 75.
    if (octets + len > 75) {
      out.push(current)
      current = ` ${char}`
      octets = 1 + len
    } else {
      current += char
      octets += len
    }
  }
  out.push(current)
  return out.join("\r\n")
}

function icsUtc(t: number): string {
  return `${new Date(t).toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`
}

export type IcsAppointment = {
  uid: string
  title: string
  /** ISO instant. */
  start: string
  /** Minutes. Default 30. */
  durationMin?: number
  location?: string
  description?: string
  url?: string
  /** DTSTAMP: when the file was made (epoch ms). */
  stamp: number
}

/**
 * A one-event .ics file, in UTC (so it lands at the right moment in any
 * calendar). Returns null when the start isn't a valid instant.
 */
export function buildIcs({
  uid,
  title,
  start,
  durationMin = 30,
  location,
  description,
  url,
  stamp,
}: IcsAppointment): string | null {
  const at = parseInstant(start)
  if (at === null) return null
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GenUI//Doctor Appointment//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${icsUtc(stamp)}`,
    `DTSTART:${icsUtc(at)}`,
    `DTEND:${icsUtc(at + Math.max(1, durationMin) * MIN_MS)}`,
    `SUMMARY:${escapeIcsText(title)}`,
  ]
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`)
  if (description) lines.push(`DESCRIPTION:${escapeIcsText(description)}`)
  const link = safeUrl(url)
  if (link) lines.push(`URL:${link}`)
  lines.push("END:VEVENT", "END:VCALENDAR")
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`
}

/** "appointment-2026-10-11.ics". */
export function icsFilename(start: string, timeZone?: string): string {
  const w = wallClock(start, timeZone)
  return `appointment${w ? `-${w.date}` : ""}.ics`
}
