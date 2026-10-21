import qrcode from "qrcode-generator"

import type { QrContent, QrErrorCorrection } from "./qr-code.schema"

/**
 * Pure helpers for the QR code: payload strings per content type (with the
 * escaping each format needs), UTF-8 encoding with a capacity check, and the
 * module matrix as an SVG path. No DOM; safe on the server.
 */

type Of<T extends QrContent["type"]> = Extract<QrContent, { type: T }>

// ---- Payloads ---------------------------------------------------------------

/** Wi-Fi (MECARD-style) fields escape `\ ; , : "` with a backslash. */
export function escapeWifi(value: string) {
  return value.replace(/[\\;,:"]/g, (c) => `\\${c}`)
}

/** `WIFI:T:WPA;S:Acme Guest;P:secret;H:true;;` */
export function wifiPayload({
  ssid,
  password,
  security,
  hidden,
}: Omit<Of<"wifi">, "type">) {
  const fields = [`T:${security}`, `S:${escapeWifi(ssid)}`]
  if (security !== "nopass" && password) {
    fields.push(`P:${escapeWifi(password)}`)
  }
  if (hidden) fields.push("H:true")
  return `WIFI:${fields.join(";")};;`
}

/** vCard and iCalendar TEXT values: `\ ; ,` and line breaks. */
export function escapeText(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

/** Non-text values (phone, email, URL) only lose line breaks. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim()

/** "Dana Levi" → family "Levi", given "Dana". One word is the family name. */
export function splitName(name: string) {
  const full = oneLine(name)
  const i = full.lastIndexOf(" ")
  return i === -1
    ? { family: full, given: "" }
    : { family: full.slice(i + 1), given: full.slice(0, i) }
}

const CRLF = "\r\n"

/** vCard 3.0 with CRLF line endings. */
export function vCardPayload({
  name,
  phone,
  email,
  org,
  title,
  url,
}: Omit<Of<"contact">, "type">) {
  const { family, given } = splitName(name)
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${escapeText(family)};${escapeText(given)};;;`,
    `FN:${escapeText(oneLine(name))}`,
  ]
  if (org) lines.push(`ORG:${escapeText(org)}`)
  if (title) lines.push(`TITLE:${escapeText(title)}`)
  if (phone) lines.push(`TEL:${oneLine(phone)}`)
  if (email) lines.push(`EMAIL:${oneLine(email)}`)
  if (url) lines.push(`URL:${oneLine(url)}`)
  lines.push("END:VCARD")
  return lines.join(CRLF)
}

export const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

/** "2026-11-05T18:00:00+01:00" → "20261105T170000Z". */
export function toICalUtc(iso: string) {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "")
}

/** "2026-11-05" → "20261105", optionally shifted by whole days. */
export function toICalDate(date: string, addDays = 0) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + addDays)
  return d.toISOString().slice(0, 10).replace(/-/g, "")
}

/**
 * An iCalendar VEVENT with CRLF line endings. Date-times are converted to
 * UTC; plain dates make an all-day event (DTEND is exclusive, so the
 * inclusive last day is shifted by one).
 */
export function veventPayload({
  title,
  start,
  end,
  location,
}: Omit<Of<"event">, "type">) {
  const allDay = isDateOnly(start)
  const lines = ["BEGIN:VEVENT", `SUMMARY:${escapeText(title)}`]
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${toICalDate(start)}`)
    if (end && isDateOnly(end)) {
      lines.push(`DTEND;VALUE=DATE:${toICalDate(end, 1)}`)
    }
  } else {
    lines.push(`DTSTART:${toICalUtc(start)}`)
    if (end && !isDateOnly(end)) lines.push(`DTEND:${toICalUtc(end)}`)
  }
  if (location) lines.push(`LOCATION:${escapeText(location)}`)
  lines.push("END:VEVENT")
  return lines.join(CRLF)
}

/** `mailto:` with an encoded subject and body (line breaks as CRLF). */
export function mailtoPayload({
  to,
  subject,
  body,
}: Omit<Of<"email">, "type">) {
  const query: string[] = []
  if (subject) query.push(`subject=${encodeURIComponent(subject)}`)
  if (body) {
    query.push(
      `body=${encodeURIComponent(body.replace(/\r\n|\r|\n/g, "\r\n"))}`,
    )
  }
  return `mailto:${to.trim()}${query.length ? `?${query.join("&")}` : ""}`
}

/** `tel:` with only a leading + and digits: "+1 555 0100" → "tel:+15550100". */
export function telPayload(number: string) {
  const trimmed = number.trim()
  const digits = trimmed.replace(/\D/g, "")
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`
}

/** The exact string the QR code encodes. */
export function buildPayload(content: QrContent): string {
  switch (content.type) {
    case "url":
      return content.url.trim()
    case "text":
      return content.text
    case "wifi":
      return wifiPayload(content)
    case "contact":
      return vCardPayload(content)
    case "event":
      return veventPayload(content)
    case "email":
      return mailtoPayload(content)
    case "phone":
      return telPayload(content.number)
  }
}

// ---- Encoding ---------------------------------------------------------------

/** Byte-mode capacity of the largest QR code (version 40), per level. */
export const BYTE_CAPACITY: Record<QrErrorCorrection, number> = {
  L: 2953,
  M: 2331,
  Q: 1663,
  H: 1273,
}

export function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

export type QrMatrix = boolean[][]

export type QrEncoding =
  | {
      ok: true
      /** modules[row][col], true = dark. */
      modules: QrMatrix
      /** QR version, 1–40. */
      version: number
      /** The UTF-8 bytes that were encoded. */
      bytes: number[]
    }
  | { ok: false; error: "too-long"; bytes: number[]; capacity: number }

/**
 * Encodes text as UTF-8 in byte mode at the smallest version that fits. The
 * library reads bytes through its global `stringToBytes` (Latin-1 by
 * default), so it's swapped for our UTF-8 bytes during `addData` only and
 * restored right after, leaving other users of the library untouched.
 */
export function encodeQr(text: string, level: QrErrorCorrection): QrEncoding {
  const bytes = utf8Bytes(text)
  const capacity = BYTE_CAPACITY[level]
  const tooLong = { ok: false, error: "too-long", bytes, capacity } as const
  if (bytes.length > capacity) return tooLong

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

export function tooLongMessage(level: QrErrorCorrection) {
  return level === "L"
    ? "Too much data for a QR code, even at level L; shorten the text."
    : `Too much data for a QR code at level ${level}; shorten the text or use level L.`
}

// ---- Rendering --------------------------------------------------------------

/** Quiet zone around the code, in modules (the standard minimum). */
export const QUIET_ZONE = 4

/** Each row's dark runs, as [row, startCol, length]. */
export function darkRuns(modules: QrMatrix): [number, number, number][] {
  const runs: [number, number, number][] = []
  modules.forEach((row, r) => {
    let c = 0
    while (c < row.length) {
      if (!row[c]) {
        c++
        continue
      }
      const start = c
      while (c < row.length && row[c]) c++
      runs.push([r, start, c - start])
    }
  })
  return runs
}

/**
 * One SVG path for all dark modules, one rectangle per horizontal run, offset
 * by the quiet zone. Use with `viewBox="0 0 n+2m n+2m"`.
 */
export function matrixToPath(modules: QrMatrix, margin = QUIET_ZONE) {
  return darkRuns(modules)
    .map(([r, c, n]) => `M${c + margin} ${r + margin}h${n}v1h-${n}z`)
    .join("")
}

/** The side of the code including the quiet zone, in modules. */
export const qrDimension = (modules: QrMatrix, margin = QUIET_ZONE) =>
  modules.length + margin * 2

/** A standalone SVG file: black modules on white, quiet zone included. */
export function toSvgFile(modules: QrMatrix, px = 1024) {
  const dim = qrDimension(modules)
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${px}" height="${px}" shape-rendering="crispEdges">`,
    `<rect width="${dim}" height="${dim}" fill="#fff"/>`,
    `<path fill="#000" d="${matrixToPath(modules)}"/>`,
    "</svg>",
  ].join("")
}

/**
 * Whole-pixel modules for a raster of `px` square: the code is centred, and
 * any leftover pixels widen the quiet zone (never narrower than 4 modules).
 */
export function rasterLayout(modules: QrMatrix, px = 1024) {
  const cell = Math.max(1, Math.floor(px / qrDimension(modules)))
  const offset = Math.floor((px - cell * modules.length) / 2)
  return { cell, offset }
}

// ---- Labels -----------------------------------------------------------------

export const TYPE_LABEL: Record<QrContent["type"], string> = {
  url: "Link",
  text: "Text",
  wifi: "Wi-Fi",
  contact: "Contact",
  event: "Event",
  email: "Email",
  phone: "Phone",
}

/** "menu.tascavelha.example/today", without the scheme, capped in length. */
export function displayUrl(url: string, max = 48) {
  let text = url
  try {
    const u = new URL(url)
    text = `${u.host}${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`
  } catch {
    // Not a URL: show it as given.
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s

/** The default title: the site, network, person, event or number. */
export function defaultTitle(content: QrContent) {
  switch (content.type) {
    case "url":
      return displayUrl(content.url, 40)
    case "text":
      return "QR code"
    case "wifi":
      return content.ssid
    case "contact":
      return content.name
    case "event":
      return content.title
    case "email":
      return `Email ${content.to}`
    case "phone":
      return content.number
  }
}

/** What the code holds, for the image's label: "QR code for {this}". */
export function describeContent(content: QrContent) {
  switch (content.type) {
    case "url":
      return `link to ${displayUrl(content.url)}`
    case "text":
      return `text: ${clip(oneLine(content.text), 60)}`
    case "wifi":
      return `Wi-Fi network ${content.ssid}`
    case "contact":
      return `contact card: ${content.name}`
    case "event":
      return `event: ${content.title}`
    case "email":
      return `email to ${content.to}`
    case "phone":
      return `phone number ${content.number}`
  }
}

/** "Guest Wi-Fi" → "guest-wi-fi". */
export function slugify(text: string, fallback = "code") {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "")
  return slug || fallback
}

/** "qr-acme-guest.png" */
export function qrFilename(name: string, ext: "png" | "svg") {
  return `qr-${slugify(name)}.${ext}`
}
