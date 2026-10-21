/**
 * Social Post: pure helpers for counting, threads, numbers, times, safe text
 * tokens and alt text. No React, no Zod, so they run anywhere (and in Node
 * unit tests).
 *
 * Inputs are typed loosely because the post may still be streaming.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type CountOptions = {
  /** When set, every http(s) URL counts as this many characters. */
  linkLength?: number
}

/** A run of post text. Only `link` ever becomes an anchor. */
export type PostToken =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "hashtag"; text: string; tag: string }
  | { type: "mention"; text: string; handle: string }

export type AltTextIssue = "missing" | "generic" | null

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// ---- URLs and images -----------------------------------------------------

/** The normalized URL if it is http(s); anything else is null. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}

const SAFE_DATA_IMAGE =
  /^data:image\/(?:png|jpeg|gif|webp|svg\+xml)(?:;[a-z0-9=.+-]+)*,/i

/**
 * The src if it is safe to load in an <img>: http(s), a same-origin path that
 * starts with a single "/", or a data: URI of type png, jpeg, gif, webp or
 * svg+xml. Everything else (javascript:, blob:, protocol-relative URLs, other
 * data: types) is null.
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null
  const value = src.trim()
  if (!value) return null
  if (/^data:/i.test(value)) return SAFE_DATA_IMAGE.test(value) ? value : null
  if (/^\/(?![/\\])/.test(value)) return value
  return safeHttpUrl(value)
}

// ---- Characters ----------------------------------------------------------

let graphemeSegmenter: Intl.Segmenter | null | undefined

function getSegmenter(): Intl.Segmenter | null {
  if (graphemeSegmenter === undefined) {
    // Grapheme breaks don't depend on the locale; a fixed one keeps counts stable.
    graphemeSegmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter("en", { granularity: "grapheme" })
        : null
  }
  return graphemeSegmenter
}

/** User-perceived characters: an emoji with modifiers counts once. */
export function graphemes(text: string): string[] {
  if (!text) return []
  const segmenter = getSegmenter()
  if (!segmenter) return Array.from(text)
  return Array.from(segmenter.segment(text), (s) => s.segment)
}

export function countGraphemes(text: string): number {
  if (!text) return 0
  const segmenter = getSegmenter()
  if (!segmenter) return Array.from(text).length
  let n = 0
  for (const _ of segmenter.segment(text)) n++
  return n
}

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi
const TRAILING = /[.,;:!?'"*]+$/

/** Drops sentence punctuation and unbalanced closing brackets from a URL. */
function trimUrl(raw: string): string {
  let url = raw.replace(TRAILING, "")
  for (const [open, close] of [
    ["(", ")"],
    ["[", "]"],
  ]) {
    while (
      url.endsWith(close) &&
      url.split(close).length > url.split(open).length
    ) {
      url = url.slice(0, -1).replace(TRAILING, "")
    }
  }
  return url
}

/** http(s) URLs in plain text, with their positions. */
export function findUrls(
  text: string,
): { start: number; end: number; url: string }[] {
  const out: { start: number; end: number; url: string }[] = []
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const url = trimUrl(match[0])
    if (safeHttpUrl(url)) out.push({ start, end: start + url.length, url })
  }
  return out
}

/**
 * Characters as a network counts them: graphemes, with each URL counted as
 * `linkLength` when the network shortens links.
 */
export function countChars(
  text: string | undefined,
  options: CountOptions = {},
): number {
  if (!text) return 0
  const { linkLength } = options
  if (!linkLength || linkLength < 1) return countGraphemes(text)
  let total = 0
  let last = 0
  for (const u of findUrls(text)) {
    total += countGraphemes(text.slice(last, u.start)) + linkLength
    last = u.end
  }
  return total + countGraphemes(text.slice(last))
}

/** How many characters past the limit; 0 when it fits or there's no limit. */
export function overBy(count: number, max: number | undefined): number {
  if (!max || max < 1) return 0
  return Math.max(0, count - max)
}

/** "212 / 280", or "212 characters" without a limit. */
export function counterText(
  count: number,
  max: number | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = new Intl.NumberFormat(locale)
  if (!max || max < 1)
    return `${n.format(count)} ${count === 1 ? "character" : "characters"}`
  return `${n.format(count)} / ${n.format(max)}`
}

// ---- Threads -------------------------------------------------------------

/** Sentences with their trailing whitespace, so joining them restores the text. */
export function splitSentences(text: string): string[] {
  if (!text) return []
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" })
    return Array.from(segmenter.segment(text), (s) => s.segment)
  }
  return text.match(/[^.!?…]+(?:[.!?…]+["')\]]*)?\s*|[.!?…]+\s*/g) ?? [text]
}

export type SplitOptions = CountOptions & {
  /** Limit for every post. */
  max: number
  /** Limit for the first post, when it carries extra text. Defaults to max. */
  firstMax?: number
}

/**
 * Splits long text into posts that each fit the limit, breaking between
 * sentences where possible, then between words, and only as a last resort
 * inside a word. Returns trimmed, non-empty posts; text that already fits
 * comes back as one post.
 */
export function splitIntoThread(text: string, options: SplitOptions): string[] {
  const max = Math.max(1, Math.floor(options.max))
  const firstMax = Math.max(1, Math.floor(options.firstMax ?? max))
  const measure = (s: string) => countChars(s.trim(), options)
  const chunks: string[] = []
  let current = ""
  const limit = () => (chunks.length === 0 ? firstMax : max)
  const flush = () => {
    const t = current.trim()
    if (t) chunks.push(t)
    current = ""
  }
  /** Adds `piece` to the current post, or starts a new one. False if it can't fit alone. */
  const place = (piece: string) => {
    if (measure(current + piece) <= limit()) {
      current += piece
      return true
    }
    flush()
    if (measure(piece) <= limit()) {
      current = piece
      return true
    }
    return false
  }

  for (const sentence of splitSentences(text)) {
    if (place(sentence)) continue
    for (const word of sentence.split(/(?<=\s)/)) {
      if (place(word)) continue
      for (const g of graphemes(word)) {
        if (current && measure(current + g) > limit()) flush()
        current += g
      }
    }
  }
  flush()
  return chunks
}

// ---- Numbers -------------------------------------------------------------

/** "1.2K", "38", "4.5M". */
export function formatCompact(
  value: number,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(value)) return ""
  return new Intl.NumberFormat(locale, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

/** "1,234". */
export function formatFull(
  value: number,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(value)) return ""
  return new Intl.NumberFormat(locale).format(value)
}

// ---- Times ---------------------------------------------------------------

function parse(iso: string | undefined | null): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const capitalize = (s: string, locale: string) =>
  s ? s.charAt(0).toLocaleUpperCase(locale) + s.slice(1) : s

/**
 * Feed-style time: "Just now", "12 min. ago", "3 hr. ago", "Yesterday",
 * "3 days ago", then "Oct 6" or "Oct 6, 2025". Future times get the date.
 */
export function formatRelativeTime(
  iso: string | undefined,
  now: Date,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = parse(iso)
  if (!date) return ""
  const diff = now.getTime() - date.getTime()
  if (diff >= 0 && diff < DAY * 7) {
    if (diff < MINUTE) return "Just now"
    const rtf = new Intl.RelativeTimeFormat(locale, {
      numeric: "auto",
      style: "short",
    })
    if (diff < HOUR)
      return capitalize(
        rtf.format(-Math.floor(diff / MINUTE), "minute"),
        locale,
      )
    if (diff < DAY)
      return capitalize(rtf.format(-Math.floor(diff / HOUR), "hour"), locale)
    return capitalize(rtf.format(-Math.floor(diff / DAY), "day"), locale)
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  }).format(date)
}

/** "Monday, October 6, 2026 at 10:42 AM", for tooltips. */
export function formatFullDate(
  iso: string | undefined,
  locale: string = DEFAULT_LOCALE,
  timeZone?: string,
): string {
  const date = parse(iso)
  if (!date) return ""
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: validTimeZone(timeZone),
  }).format(date)
}

/** The zone if the runtime knows it; otherwise undefined (the viewer's zone). */
export function validTimeZone(
  timeZone: string | undefined,
): string | undefined {
  if (!timeZone) return undefined
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return timeZone
  } catch {
    return undefined
  }
}

type WallTime = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function wallTime(date: Date, timeZone: string | undefined): WallTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: validTimeZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  }
}

/** Minutes the zone is ahead of UTC at that instant, e.g. -240 for EDT. */
export function zoneOffsetMinutes(
  date: Date,
  timeZone: string | undefined,
): number {
  const w = wallTime(date, timeZone)
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second)
  const instant = Math.floor(date.getTime() / 1000) * 1000
  return Math.round((asUtc - instant) / MINUTE)
}

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, "0")

/** "2026-10-13T09:00" in the zone, for a datetime-local input. */
export function toZonedInputValue(
  iso: string | undefined | null,
  timeZone?: string,
): string {
  const date = parse(iso)
  if (!date) return ""
  const w = wallTime(date, timeZone)
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}`
}

/**
 * A datetime-local value read as wall-clock time in the zone, returned as ISO
 * 8601 with that zone's offset, e.g. "2026-10-13T09:00:00-04:00". Null when
 * the value is empty or malformed.
 */
export function fromZonedInputValue(
  value: string,
  timeZone?: string,
): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  )
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1, 6).map(Number)
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null
  const asUtc = Date.UTC(y, mo - 1, d, h, mi)
  // Two passes settle the offset across DST changes.
  let offset = zoneOffsetMinutes(new Date(asUtc), timeZone)
  let instant = asUtc - offset * MINUTE
  const second = zoneOffsetMinutes(new Date(instant), timeZone)
  if (second !== offset) {
    offset = second
    instant = asUtc - offset * MINUTE
  }
  const w = wallTime(new Date(instant), timeZone)
  const sign = offset < 0 ? "-" : "+"
  return `${pad(w.year, 4)}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:00${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
}

/** "EDT", "GMT+2", for labelling times. */
export function zoneShortName(
  iso: string | undefined,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = parse(iso) ?? new Date()
  const part = new Intl.DateTimeFormat(locale, {
    timeZone: validTimeZone(timeZone),
    timeZoneName: "short",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")
  return part?.value ?? ""
}

/** "Tue, Oct 13, 09:00", in the zone. */
export function formatScheduleTime(
  iso: string | undefined,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = parse(iso)
  if (!date) return ""
  return new Intl.DateTimeFormat(locale, {
    timeZone: validTimeZone(timeZone),
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date)
}

/** "Tue 09:00", in the zone, for suggested-time chips. */
export function formatWeekdayTime(
  iso: string | undefined,
  timeZone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = parse(iso)
  if (!date) return ""
  const zone = validTimeZone(timeZone)
  const weekday = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: "short",
  }).format(date)
  const w = wallTime(date, zone)
  return `${weekday} ${pad(w.hour)}:${pad(w.minute)}`
}

/** True when the time is valid and not after `now`. */
export function isPast(iso: string | undefined | null, now: Date): boolean {
  const date = parse(iso)
  return date !== null && date.getTime() <= now.getTime()
}

/** Same instant, regardless of how the offset is written. */
export function sameInstant(a: string | undefined, b: string | undefined) {
  const da = parse(a)
  const db = parse(b)
  return da !== null && db !== null && da.getTime() === db.getTime()
}

// ---- Tokens --------------------------------------------------------------

const TOKEN_PATTERN =
  /(https?:\/\/[^\s<>"'`]+)|(?<![\p{L}\p{N}_&/#])#([\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*)|(?<![\p{L}\p{N}_.@/])@([A-Za-z0-9_](?:[A-Za-z0-9_.]*[A-Za-z0-9_])?)/gu

/**
 * Splits plain text into text, links, #hashtags and @mentions. Only http(s)
 * URLs become links; hashtags and mentions are labels, never links. Nothing
 * is parsed as HTML. An email address is not a mention.
 */
export function tokenize(text: string | undefined): PostToken[] {
  const tokens: PostToken[] = []
  if (!text) return tokens
  const pushText = (s: string) => {
    if (!s) return
    const prev = tokens[tokens.length - 1]
    if (prev?.type === "text") prev.text += s
    else tokens.push({ type: "text", text: s })
  }
  let last = 0
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? 0
    pushText(text.slice(last, start))
    const [raw, url, tag, handle] = match
    if (url) {
      const trimmed = trimUrl(url)
      const href = safeHttpUrl(trimmed)
      if (href) tokens.push({ type: "link", text: trimmed, href })
      else pushText(trimmed)
      pushText(url.slice(trimmed.length))
    } else if (tag) {
      tokens.push({ type: "hashtag", text: raw, tag })
    } else if (handle) {
      tokens.push({ type: "mention", text: raw, handle })
    } else {
      pushText(raw)
    }
    last = start + raw.length
  }
  pushText(text.slice(last))
  return tokens
}

/**
 * The post as it will be published: the text, then the link and hashtags
 * that aren't already in it, each on its own paragraph.
 */
export function composePost(
  text: string | undefined,
  hashtags?: readonly (string | undefined)[],
  link?: string,
): string {
  const body = (text ?? "").trimEnd()
  const lower = body.toLocaleLowerCase()
  const present = new Set(
    tokenize(body)
      .filter((t) => t.type === "hashtag")
      .map((t) => (t as { tag: string }).tag.toLocaleLowerCase()),
  )
  const tags: string[] = []
  for (const raw of hashtags ?? []) {
    const tag = (raw ?? "").trim().replace(/^#+/, "")
    const key = tag.toLocaleLowerCase()
    if (!/^[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*$/u.test(tag) || present.has(key))
      continue
    present.add(key)
    tags.push(`#${tag}`)
  }
  const parts = [body]
  const cleanLink = link?.trim()
  if (
    cleanLink &&
    safeHttpUrl(cleanLink) &&
    !lower.includes(cleanLink.toLocaleLowerCase())
  ) {
    parts.push(cleanLink)
  }
  if (tags.length) parts.push(tags.join(" "))
  return parts.filter(Boolean).join("\n\n")
}

// ---- Alt text ------------------------------------------------------------

const GENERIC_ALT =
  /^(?:an? )?(?:image|img|photo|picture|pic|graphic|screenshot|untitled|alt|alt text|placeholder)(?:[\s_-]*\d+)?$/i
const FILE_NAME = /^\S+\.(?:png|jpe?g|gif|webp|svg|heic|avif)$/i

/** "missing" when empty, "generic" for "image" or a file name, else null. */
export function altTextIssue(alt: string | undefined | null): AltTextIssue {
  const value = alt?.trim() ?? ""
  if (!value) return "missing"
  if (GENERIC_ALT.test(value) || FILE_NAME.test(value)) return "generic"
  return null
}

export function needsAltText(alt: string | undefined | null): boolean {
  return altTextIssue(alt) !== null
}

// ---- Words ---------------------------------------------------------------

/** Up to two initials from a display name. */
export function initials(name?: string): string {
  const words = (name ?? "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
  const first = (s: string) => Array.from(s)[0]?.toUpperCase() ?? ""
  if (words.length >= 2) return first(words[0]) + first(words[words.length - 1])
  if (words.length === 1) return first(words[0])
  return "?"
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`
