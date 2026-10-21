/**
 * Email Thread: pure helpers for names, links, highlights, sizes and dates.
 * No React, no Zod, so they run anywhere (and in Node unit tests).
 *
 * Inputs are typed loosely because the thread may still be streaming.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type Contact = { name?: string; email?: string; self?: boolean }

/** A run of message text: plain, or a safe http(s) link. */
export type TextSegment =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Only http(s) URLs are allowed into an href. Returns the normalized URL. */
export function safeHttpUrl(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}

/** Up to two initials from a display name, falling back to the email. */
export function initials(name?: string, email?: string): string {
  const words = (name ?? "")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
  const first = (s: string) => Array.from(s)[0]?.toUpperCase() ?? ""
  if (words.length >= 2) return first(words[0]) + first(words[words.length - 1])
  if (words.length === 1) return first(words[0])
  return first(email ?? "") || "?"
}

/** "Dana Levi" → "Dana". Falls back to the part of the email before the @. */
export function firstName(contact: Contact): string {
  const name = contact.name?.trim()
  if (name) return name.split(/\s+/)[0]
  return contact.email?.split("@")[0] ?? ""
}

const normalize = (email?: string) => email?.trim().toLowerCase() ?? ""

/** The mailbox owner's addresses, from participants marked `self`. */
export function selfEmails(participants: Contact[] | undefined): Set<string> {
  return new Set(
    (participants ?? [])
      .filter((p) => p.self && p.email)
      .map((p) => normalize(p.email)),
  )
}

export function isSelf(contact: Contact, self: Set<string>): boolean {
  return Boolean(contact.self) || self.has(normalize(contact.email))
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}

/**
 * Header participant list: full names, the mailbox owner as "you" (last),
 * and "+ N others" past `max`. e.g. "Dana Levi, Sam Ortiz, you".
 */
export function formatParticipants(
  participants: Contact[] | undefined,
  max = 5,
): string {
  const people = (participants ?? []).filter((p) => p.name || p.email)
  const others = people
    .filter((p) => !p.self)
    .map((p) => p.name?.trim() || p.email || "")
  const hasSelf = people.some((p) => p.self)
  const names = hasSelf ? [...others, "you"] : others
  if (names.length <= max) return names.join(", ")
  const shown = others.slice(0, Math.max(1, hasSelf ? max - 1 : max))
  const rest = others.length - shown.length
  const listed = hasSelf ? [...shown, "you"] : shown
  return `${listed.join(", ")} and ${plural(rest, "other")}`
}

/**
 * Unique people in a thread, in order of first appearance, used when the
 * host doesn't pass `participants`.
 */
export function collectParticipants(
  messages: { from?: Contact; to?: Contact[]; cc?: Contact[] }[],
  self: Set<string>,
): Contact[] {
  const seen = new Map<string, Contact>()
  for (const m of messages) {
    for (const c of [m.from, ...(m.to ?? []), ...(m.cc ?? [])]) {
      if (!c || !(c.name || c.email)) continue
      const key = normalize(c.email) || c.name?.trim().toLowerCase() || ""
      if (!seen.has(key)) seen.set(key, { ...c, self: isSelf(c, self) })
    }
  }
  return [...seen.values()]
}

/** "to Sam, cc Priya", with the mailbox owner as "you". */
export function formatRecipients(
  to: Contact[] | undefined,
  cc: Contact[] | undefined,
  self: Set<string>,
  max = 3,
): string {
  const short = (list: Contact[]) => {
    const names = list
      .filter((c) => c.name || c.email)
      .map((c) => (isSelf(c, self) ? "you" : firstName(c)))
    if (names.length <= max) return names.join(", ")
    return `${names.slice(0, max).join(", ")} and ${plural(names.length - max, "other")}`
  }
  const parts: string[] = []
  const toText = short(to ?? [])
  const ccText = short(cc ?? [])
  if (toText) parts.push(`to ${toText}`)
  if (ccText) parts.push(`cc ${ccText}`)
  return parts.join(", ")
}

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi
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

/**
 * Splits plain text into text and link segments. Only http(s) URLs become
 * links; nothing is ever parsed as HTML.
 */
export function linkify(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let last = 0
  const push = (s: string) => {
    if (!s) return
    const prev = segments[segments.length - 1]
    if (prev?.type === "text") prev.text += s
    else segments.push({ type: "text", text: s })
  }
  for (const match of text.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0
    const url = trimUrl(match[0])
    const href = safeHttpUrl(url)
    push(text.slice(last, start))
    if (href) {
      segments.push({ type: "link", text: url, href })
      last = start + url.length
    } else {
      last = start
    }
  }
  push(text.slice(last))
  return segments
}

/** Cuts segments to the character range [start, end), keeping link targets. */
function sliceSegments(
  segments: TextSegment[],
  start: number,
  end: number,
): TextSegment[] {
  const out: TextSegment[] = []
  let offset = 0
  for (const s of segments) {
    const from = Math.max(start, offset)
    const to = Math.min(end, offset + s.text.length)
    if (from < to) {
      const text = s.text.slice(from - offset, to - offset)
      out.push(s.type === "link" ? { ...s, text } : { type: "text", text })
    }
    offset += s.text.length
  }
  return out
}

export type BodyParts = {
  before: TextSegment[]
  /** The highlighted sentence, or null when it doesn't occur verbatim. */
  match: TextSegment[] | null
  after: TextSegment[]
}

/**
 * Splits a message body around the highlighted sentence (first verbatim
 * occurrence only) and auto-links URLs in every part.
 */
export function splitBody(body: string, highlight?: string | null): BodyParts {
  const segments = linkify(body)
  const needle = highlight?.trim()
  const index = needle ? body.indexOf(needle) : -1
  if (!needle || index < 0) return { before: segments, match: null, after: [] }
  const end = index + needle.length
  return {
    before: sliceSegments(segments, 0, index),
    match: sliceSegments(segments, index, end),
    after: sliceSegments(segments, end, body.length),
  }
}

/** True when `text` occurs verbatim in `body`. */
export function occursVerbatim(body: string | undefined, text?: string) {
  const needle = text?.trim()
  return Boolean(body && needle && body.includes(needle))
}

/** "240 KB", "1.2 MB". */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1000) return `${bytes} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[unit]}`
}

function parse(iso: string | undefined): Date | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date
}

const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/**
 * Mail-client style time: "Just now", "12 min ago", "10:42 AM" today,
 * "Yesterday, 4:05 PM", "Mon 9:15 AM" this week, then "Oct 6" or
 * "Oct 6, 2025".
 */
export function formatRelativeTime(
  iso: string | undefined,
  now: Date,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = parse(iso)
  if (!date) return ""
  const diff = now.getTime() - date.getTime()
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
  if (diff >= 0 && diff < MINUTE) return "Just now"
  if (diff >= 0 && diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY)
  if (days === 0) return time
  if (days === 1) return `Yesterday, ${time}`
  if (days > 1 && days < 7) {
    const weekday = new Intl.DateTimeFormat(locale, {
      weekday: "short",
    }).format(date)
    return `${weekday} ${time}`
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
) {
  const date = parse(iso)
  if (!date) return ""
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "full",
    timeStyle: "short",
  }).format(date)
}

/** "Oct 6, 10:42 AM", for a message's accessible name. */
export function formatShortDate(
  iso: string | undefined,
  locale: string = DEFAULT_LOCALE,
) {
  const date = parse(iso)
  if (!date) return ""
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

export const plural = (n: number, word: string, many = `${word}s`) =>
  `${n} ${n === 1 ? word : many}`
