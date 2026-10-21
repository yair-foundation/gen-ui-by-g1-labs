/**
 * Delivery tracker: pure helpers. Intl only, no date library, no React, no
 * DOM: safe to reuse on the server and to unit-test in Node.
 *
 * Times show in the zone of the ISO string they come from: '10:30+01:00'
 * shows as 10:30 wherever the viewer is, because that's the clock at the
 * delivery address. A time without an offset is read as wall-clock time.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type DeliveryKind = "food" | "grocery" | "parcel" | "ride"
export type StageState = "done" | "current" | "upcoming"
export type DeliveryAction =
  | "contact-courier"
  | "contact-merchant"
  | "change-instructions"
  | "get-help"

export type Stage = {
  id: string
  label: string
  state: StageState
  at?: string
}

/** The order actions show in, whatever order the agent passes them. */
export const ACTION_ORDER: readonly DeliveryAction[] = [
  "contact-courier",
  "contact-merchant",
  "change-instructions",
  "get-help",
]

/** Past the ETA by less than this, the badge still says "Now". */
export const LATE_GRACE_MINUTES = 5

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/* ------------------------------------------------------------------------ */
/* Parsing                                                                  */
/* ------------------------------------------------------------------------ */

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i

export type ParsedTime = {
  /** The instant (ms since the epoch). */
  t: number
  /**
   * The wall-clock time as if it were UTC, for formatting with
   * `timeZone: "UTC"`: the clock at the place the time was written for.
   */
  wall: number
  /** Offset from UTC in minutes, or null for a time without one. */
  offset: number | null
}

/** An ISO 8601 date-time with its own offset kept. Null when unparseable. */
export function parseTime(value: string | undefined): ParsedTime | null {
  if (typeof value !== "string") return null
  const m = ISO.exec(value.trim())
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((v) => Number(v ?? 0))
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const wall = Date.UTC(y, mo - 1, d, h, mi, s)
  const z = m[7]
  if (!z) {
    // Floating time: the viewer's own clock.
    const t = new Date(y, mo - 1, d, h, mi, s).getTime()
    return Number.isNaN(t) ? null : { t, wall, offset: null }
  }
  if (z.toUpperCase() === "Z") return { t: wall, wall, offset: 0 }
  const sign = z[0] === "-" ? -1 : 1
  const digits = z.slice(1).replace(":", "")
  const offset =
    sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2)))
  return { t: wall - offset * MINUTE, wall, offset }
}

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
export function resolveNow(
  now: Date | string | number | undefined,
): number | null {
  if (now === undefined) return null
  const t = typeof now === "string" ? Date.parse(now) : new Date(now).getTime()
  return Number.isFinite(t) ? t : null
}

/* ------------------------------------------------------------------------ */
/* Formatting times                                                         */
/* ------------------------------------------------------------------------ */

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(locale: string, opts: Intl.DateTimeFormatOptions) {
  const key = `${locale}|${JSON.stringify(opts)}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" })
    formatters.set(key, f)
  }
  return f
}

const CLOCK: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
}

/** Clock time in the ISO's own zone: '10:30 AM' (or '10:30' in 24-hour locales). */
export function formatClock(
  value: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  const p = parseTime(value)
  return p ? formatter(locale, CLOCK).format(p.wall) : ""
}

/** Days from the reference instant's local date to the time's local date. */
export function dayDiff(p: ParsedTime, reference: number): number {
  // The reference, read on the same clock as the time.
  const refWall =
    p.offset === null
      ? reference - new Date(reference).getTimezoneOffset() * MINUTE
      : reference + p.offset * MINUTE
  const day = (ms: number) => Math.floor(ms / DAY)
  return day(p.wall) - day(refWall)
}

/** '', 'tomorrow', 'yesterday' or 'Fri, Oct 9', relative to the reference. */
export function dayLabel(
  p: ParsedTime,
  reference: number | null,
  locale: string = DEFAULT_LOCALE,
): string {
  if (reference === null) return ""
  const diff = dayDiff(p, reference)
  if (diff === 0) return ""
  if (diff === 1) return "tomorrow"
  if (diff === -1) return "yesterday"
  return formatter(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(p.wall)
}

/**
 * The arrival time or window in the ETA's own zone: '10:30 AM',
 * '10:30–10:45 AM', '11:30 AM–12:15 PM', with 'tomorrow, ' or a date in front
 * when it isn't the reference day. Empty when the ETA can't be read.
 */
export function formatEtaWindow(
  at: string | undefined,
  windowEnd?: string,
  {
    reference = null,
    locale = DEFAULT_LOCALE,
  }: { reference?: number | null; locale?: string } = {},
): string {
  const start = parseTime(at)
  if (!start) return ""
  const f = formatter(locale, CLOCK)
  const end = parseTime(windowEnd)
  let time = f.format(start.wall)
  if (end && end.t > start.t) {
    const a = f.formatToParts(start.wall)
    const b = f.formatToParts(end.wall)
    const period = (parts: Intl.DateTimeFormatPart[]) =>
      parts.find((x) => x.type === "dayPeriod")?.value
    const sameDay = Math.floor(start.wall / DAY) === Math.floor(end.wall / DAY)
    // '10:30–10:45 AM': the shared AM/PM is said once.
    const first =
      sameDay && period(a) !== undefined && period(a) === period(b)
        ? a
            .filter((x) => x.type !== "dayPeriod")
            .map((x) => x.value)
            .join("")
            .trim()
        : time
    time = `${first}–${f.format(end.wall)}`
  }
  const day = dayLabel(start, reference, locale)
  return day ? `${day}, ${time}` : time
}

/** 'Arriving 10:30–10:45 AM' / 'Arriving tomorrow, 9:00 AM–1:00 PM'. */
export function arrivalText(
  eta: { at?: string; windowEnd?: string } | undefined,
  opts: { reference?: number | null; locale?: string } = {},
): string {
  const w = formatEtaWindow(eta?.at, eta?.windowEnd, opts)
  return w ? `Arriving ${w}` : ""
}

/**
 * A stage time, compact: the clock on the reference day, otherwise the date
 * ('Oct 6').
 */
export function formatStageTime(
  value: string | undefined,
  reference: number | null,
  locale: string = DEFAULT_LOCALE,
): string {
  const p = parseTime(value)
  if (!p) return ""
  if (reference === null || dayDiff(p, reference) === 0) {
    return formatter(locale, CLOCK).format(p.wall)
  }
  return formatter(locale, { month: "short", day: "numeric" }).format(p.wall)
}

/* ------------------------------------------------------------------------ */
/* Stages                                                                   */
/* ------------------------------------------------------------------------ */

/** Every stage is done. */
export function isComplete(stages: readonly Pick<Stage, "state">[]): boolean {
  return stages.length > 0 && stages.every((s) => s.state === "done")
}

/**
 * The stage the delivery is at: the first `current` one; with none, the last
 * done one; with neither, the first. -1 for no stages.
 */
export function currentStageIndex(
  stages: readonly Pick<Stage, "state">[],
): number {
  if (stages.length === 0) return -1
  const current = stages.findIndex((s) => s.state === "current")
  if (current !== -1) return current
  for (let i = stages.length - 1; i >= 0; i--) {
    if (stages[i].state === "done") return i
  }
  return 0
}

const trimLabel = (label: string) => label.trim().replace(/(…|\.{1,3})$/, "")

/**
 * The heading: 'On the way…' while a stage is in progress, 'Delivered at
 * 10:41 AM' once every stage is done (from the last stage's time).
 */
export function headingText(
  stages: readonly Stage[],
  locale: string = DEFAULT_LOCALE,
): string {
  const i = currentStageIndex(stages)
  if (i === -1) return ""
  const stage = stages[i]
  const label = trimLabel(stage.label)
  if (isComplete(stages)) {
    const at = formatClock(stage.at, locale)
    return at ? `${label} at ${at}` : label
  }
  return stage.state === "current" ? `${label}…` : label
}

/** 'Step 4 of 5, Out for delivery' or 'All 5 steps done, Delivered'. */
export function stepSpoken(stages: readonly Stage[]): string {
  const i = currentStageIndex(stages)
  if (i === -1) return ""
  const label = trimLabel(stages[i].label)
  if (isComplete(stages)) return `All ${stages.length} steps done, ${label}`
  return `Step ${i + 1} of ${stages.length}, ${label}`
}

export type StageIconKey =
  | "store"
  | "chef"
  | "flame"
  | "package"
  | "bike"
  | "truck"
  | "car"
  | "home"
  | "done"

const VEHICLE: Record<DeliveryKind, StageIconKey> = {
  food: "bike",
  grocery: "truck",
  parcel: "truck",
  ride: "car",
}

/** Which icon a stage gets, from its label and the kind of delivery. */
export function stageIconKey(
  label: string,
  kind: DeliveryKind | undefined,
  { complete = false }: { complete?: boolean } = {},
): StageIconKey {
  if (complete) return "done"
  const l = label.toLowerCase()
  if (/bak|oven/.test(l)) return "flame"
  if (/prepar|cook|kitchen|making/.test(l))
    return kind === "food" || kind === undefined ? "chef" : "package"
  if (/out for|on the way|en route|on its way|driver|courier|heading/.test(l))
    return VEHICLE[kind ?? "food"]
  if (/deliver|arriv|drop/.test(l)) return kind === "ride" ? "car" : "home"
  if (/received|placed|confirm|accepted|ordered|requested/.test(l))
    return kind === "parcel" ? "package" : kind === "ride" ? "car" : "store"
  if (/pack|pick|check|ready|depot|transit|sort|ship|label|hub/.test(l))
    return "package"
  return kind === "ride" ? "car" : "package"
}

/* ------------------------------------------------------------------------ */
/* Time remaining                                                           */
/* ------------------------------------------------------------------------ */

export type Remaining =
  | { kind: "minutes"; minutes: number }
  | { kind: "hours"; hours: number }
  | { kind: "now" }
  | { kind: "late"; minutes: number }
  /** A day or more away: no badge, the arrival line has the date. */
  | { kind: "later" }

/**
 * Time left until the ETA, rounded up to the minute ('2 min 1 s' is 3 min).
 * Under a minute, or up to 5 min past, is "now"; later than that it's late.
 * Null before mount or without a readable ETA.
 */
export function remaining(
  at: string | undefined,
  now: number | null,
): Remaining | null {
  const p = parseTime(at)
  if (!p || now === null) return null
  const ms = p.t - now
  if (ms >= DAY) return { kind: "later" }
  if (ms >= 90 * MINUTE) return { kind: "hours", hours: Math.round(ms / HOUR) }
  if (ms >= MINUTE) return { kind: "minutes", minutes: Math.ceil(ms / MINUTE) }
  if (ms > -LATE_GRACE_MINUTES * MINUTE) return { kind: "now" }
  return { kind: "late", minutes: Math.round(-ms / MINUTE) }
}

/** What the round badge shows: a number and unit, or a word; with a spoken form. */
export function remainingBadge(
  r: Remaining | null,
): { value?: number; unit?: string; word?: string; spoken: string } | null {
  if (!r || r.kind === "later") return null
  switch (r.kind) {
    case "minutes":
      return {
        value: r.minutes,
        unit: "min",
        spoken: `${r.minutes} ${r.minutes === 1 ? "minute" : "minutes"} away`,
      }
    case "hours":
      return {
        value: r.hours,
        unit: "h",
        spoken: `About ${r.hours} ${r.hours === 1 ? "hour" : "hours"} away`,
      }
    case "now":
      return { word: "Now", spoken: "Arriving now" }
    case "late":
      return {
        word: "Late",
        spoken: `${r.minutes} min past the expected time`,
      }
  }
}

/* ------------------------------------------------------------------------ */
/* Actions                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * The actions a delivery offers when the agent doesn't list them. Once it's
 * delivered, only "Get help" is left.
 */
export function defaultActions(
  kind: DeliveryKind | undefined,
  stages: readonly Pick<Stage, "state">[],
  courier?: { phoneAvailable?: boolean },
): DeliveryAction[] {
  if (isComplete(stages)) return ["get-help"]
  const call: DeliveryAction[] = courier?.phoneAvailable
    ? ["contact-courier"]
    : []
  switch (kind) {
    case "parcel":
      return [...call, "change-instructions", "get-help"]
    case "ride":
      return [...call, "get-help"]
    default:
      return [...call, "contact-merchant", "change-instructions", "get-help"]
  }
}

/**
 * The actions to show: the agent's list (or the defaults), deduplicated and in
 * a fixed order. Delivered: "Get help" only.
 */
export function resolveActions(
  actions: readonly DeliveryAction[] | undefined,
  kind: DeliveryKind | undefined,
  stages: readonly Pick<Stage, "state">[],
  courier?: { phoneAvailable?: boolean },
): DeliveryAction[] {
  const wanted = new Set(actions ?? defaultActions(kind, stages, courier))
  const done = isComplete(stages)
  return ACTION_ORDER.filter(
    (a) => wanted.has(a) && (!done || a === "get-help"),
  )
}

/** 'Contact restaurant', 'Contact store', 'Contact sender', 'Contact operator'. */
export function merchantContactLabel(kind: DeliveryKind | undefined): string {
  switch (kind) {
    case "grocery":
      return "Contact store"
    case "parcel":
      return "Contact sender"
    case "ride":
      return "Contact operator"
    default:
      return "Contact restaurant"
  }
}

/** 'Pickup notes' for rides, 'Delivery instructions' for everything else. */
export function instructionsLabel(kind: DeliveryKind | undefined): string {
  return kind === "ride" ? "Pickup notes" : "Delivery instructions"
}

/* ------------------------------------------------------------------------ */
/* Details                                                                  */
/* ------------------------------------------------------------------------ */

/** Up to two initials: 'Green Bowl Kitchen' → 'GB'. */
export function initialsOf(name: string | undefined): string {
  if (!name) return ""
  const words = name
    .trim()
    .split(/[\s\-–·&]+/)
    .filter((w) => /\p{L}|\p{N}/u.test(w))
  const letters = words.map((w) => (w.match(/\p{L}|\p{N}/u) ?? [""])[0])
  return letters.slice(0, 2).join("").toUpperCase()
}

/** The street line only: everything before the first comma or line break. */
export function streetOnly(address: string | undefined): string {
  if (!address) return ""
  return address.split(/[,\n]/)[0].trim()
}

/** Total quantity across item lines. */
export function itemCount(
  items: readonly { quantity?: number }[] | undefined,
): number {
  return (items ?? []).reduce(
    (n, i) =>
      n +
      (typeof i.quantity === "number" && i.quantity > 0
        ? Math.round(i.quantity)
        : 1),
    0,
  )
}

/** '3 items · Order #4821', '1 item', 'Order #4821'. */
export function itemsSummary(
  items: readonly { quantity?: number }[] | undefined,
  orderNumber?: string,
): string {
  const n = itemCount(items)
  const parts: string[] = []
  if (n > 0) parts.push(`${n} ${n === 1 ? "item" : "items"}`)
  if (orderNumber) parts.push(`Order #${orderNumber.replace(/^#/, "")}`)
  return parts.join(" · ")
}

/**
 * An image from agent data: http(s), a data:image URL, or a same-origin path
 * that starts with a single "/"; else null (protocol-relative URLs and other
 * schemes are rejected).
 */
export function safeImageSrc(src: string | undefined): string | null {
  if (!src) return null
  if (/^\/(?![/\\])/.test(src)) return src
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(src)) return src
  try {
    const u = new URL(src)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** '4.6', clamped to 0–5 with one decimal. Null when not a number. */
export function formatRating(rating: number | undefined): string | null {
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null
  return (Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10).toFixed(1)
}
