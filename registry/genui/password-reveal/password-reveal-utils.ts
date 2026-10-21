/**
 * Pure helpers for the password reveal: uniform secure generation (rejection
 * sampling over crypto.getRandomValues), entropy and strength, countdown and
 * expiry text, and the recovery-code grid. No DOM; safe on the server.
 */

/** Fills the array with random 32-bit values. Defaults to Web Crypto. */
export type RandomSource = (buffer: Uint32Array<ArrayBuffer>) => void

const defaultRandom: RandomSource = (buffer) => {
  globalThis.crypto.getRandomValues(buffer)
}

/** Fixed mask, the same for every secret, so it never hints at the length. */
export const MASK = "••••••••••"

// ---- Character sets ------------------------------------------------------------

export const LOWERCASE = "abcdefghijklmnopqrstuvwxyz"
export const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
export const DIGITS = "0123456789"
/** No quotes, backslash, backtick or space: they break shells, CSV and forms. */
export const SYMBOLS = "!#$%&*+-./:;=?@^_~"

export const MIN_LENGTH = 12
export const MAX_LENGTH = 64

export type GenerateOptions = {
  length: number
  symbols: boolean
  numbers: boolean
  uppercase: boolean
  /** Characters never to use, e.g. look-alikes "0O1lI". */
  exclude?: string
}

export const clampLength = (n: number) =>
  Math.min(
    MAX_LENGTH,
    Math.max(MIN_LENGTH, Math.round(Number.isFinite(n) ? n : 20)),
  )

/** The enabled character classes, each without the excluded characters. */
export function characterClasses(options: GenerateOptions): string[] {
  const excluded = new Set(options.exclude ?? "")
  const strip = (set: string) =>
    [...set].filter((c) => !excluded.has(c)).join("")
  return [
    LOWERCASE,
    options.uppercase ? UPPERCASE : "",
    options.numbers ? DIGITS : "",
    options.symbols ? SYMBOLS : "",
  ]
    .map(strip)
    .filter((set) => set.length > 0)
}

/** Every character the generator may use, deduplicated. */
export function charset(options: GenerateOptions): string {
  return [...new Set(characterClasses(options).join(""))].join("")
}

// ---- Uniform random ------------------------------------------------------------

/**
 * A uniform integer in [0, n). Rejection sampling: 32-bit draws at or above
 * the largest multiple of n are discarded, so `x % n` has no modulo bias.
 */
export function randomIndex(n: number, random: RandomSource = defaultRandom) {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) {
    throw new RangeError(`randomIndex: n must be an integer in 1..2^32`)
  }
  const limit = Math.floor(2 ** 32 / n) * n
  const buffer = new Uint32Array(1)
  // The chance of a rejection is below 50% for any n, so this ends quickly.
  for (let i = 0; i < 1000; i++) {
    random(buffer)
    if (buffer[0] < limit) return buffer[0] % n
  }
  throw new Error("randomIndex: the random source looks broken")
}

/**
 * A password drawn uniformly from the charset. When more than one class is
 * on, a draw missing a class is thrown away and redrawn, which keeps the
 * result uniform over the passwords that contain every class.
 */
export function generatePassword(
  options: GenerateOptions,
  random: RandomSource = defaultRandom,
): string {
  const length = clampLength(options.length)
  const classes = characterClasses(options)
  const chars = [...charset(options)]
  if (chars.length < 2) throw new Error("generatePassword: charset too small")
  for (let attempt = 0; attempt < 100; attempt++) {
    let out = ""
    for (let i = 0; i < length; i++)
      out += chars[randomIndex(chars.length, random)]
    if (classes.every((set) => [...out].some((c) => set.includes(c)))) {
      return out
    }
  }
  throw new Error("generatePassword: couldn't satisfy the character classes")
}

// ---- Strength ------------------------------------------------------------------

/** Bits of entropy for a uniform pick: length × log2(charset size). */
export function entropyBits(length: number, charsetSize: number) {
  if (length <= 0 || charsetSize <= 1) return 0
  return length * Math.log2(charsetSize)
}

export type Strength = "Weak" | "Fair" | "Good" | "Strong"

/** Below 50 bits weak, 70 fair, 90 good; strong from 90. */
export function strengthOf(bits: number): Strength {
  if (bits < 50) return "Weak"
  if (bits < 70) return "Fair"
  if (bits < 90) return "Good"
  return "Strong"
}

/** 0–4 filled meter segments. */
export function strengthLevel(bits: number) {
  return (
    (["Weak", "Fair", "Good", "Strong"] as const).indexOf(strengthOf(bits)) + 1
  )
}

/** "Strong · ~105 bits". Rounds down, so it never overstates. */
export function strengthLabel(bits: number) {
  return `${strengthOf(bits)} · ~${Math.floor(bits)} bits`
}

// ---- Time ----------------------------------------------------------------------

/** "Hides in 28 s", "Hides in 1:05". */
export function countdownText(secondsLeft: number) {
  const s = Math.max(0, Math.ceil(secondsLeft))
  if (s < 60) return `Hides in ${s} s`
  return `Hides in ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "Expires in 23 h", relative to `now`. Rounds down. Null without a valid date. */
export function expiryText(expiresAt: string | undefined, now: number) {
  if (!expiresAt) return null
  const end = Date.parse(expiresAt)
  if (!Number.isFinite(end)) return null
  const left = end - now
  if (left <= 0) return "Expired"
  if (left < MINUTE) return "Expires in under a minute"
  if (left < HOUR) return `Expires in ${Math.floor(left / MINUTE)} min`
  if (left < DAY) return `Expires in ${Math.floor(left / HOUR)} h`
  const d = Math.floor(left / DAY)
  return `Expires in ${d} ${d === 1 ? "day" : "days"}`
}

// ---- Codes ---------------------------------------------------------------------

/** A list of codes from an array, or from one string split on lines/commas. */
export function toCodes(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  const list = Array.isArray(value) ? value : value.split(/[\n,]+/)
  return list.map((c) => c.trim()).filter(Boolean)
}

/**
 * Codes as grid rows, in reading order (1 2 / 3 4 …), numbered from 1, so
 * the visual order and the screen reader's order match.
 */
export function codeGrid(codes: string[], columns = 2) {
  const cols = Math.max(1, Math.floor(columns))
  const rows: { n: number; code: string }[][] = []
  codes.forEach((code, i) => {
    const r = Math.floor(i / cols)
    if (!rows[r]) rows[r] = []
    rows[r].push({ n: i + 1, code })
  })
  return rows
}

/** The text that goes on the clipboard. Codes go one per line. */
export function clipboardText(value: string | string[]) {
  return Array.isArray(value) ? value.join("\n") : value
}
