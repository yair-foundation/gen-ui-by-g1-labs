/**
 * Account Balances: pure helpers. Money math runs in integer minor units
 * (cents), so sums don't drift. No React, no DOM: safe to reuse on the server
 * and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type AccountKind =
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "crypto"
  | "cash"
  | "loan"
  | "other"

/** Kinds that are money owed: listed under Liabilities and subtracted. */
export const LIABILITY_KINDS: readonly AccountKind[] = ["credit", "loan"]

export function isLiability(kind: AccountKind | undefined): boolean {
  return kind !== undefined && LIABILITY_KINDS.includes(kind)
}

// ---------------------------------------------------------------------------
// Masking

const MASK_RUN = /\s*(?:\.{3}|…|[•*●·]+)\s*/g
const SIGNIFICANT = /[A-Za-z0-9]/
const HEX_PREFIX = /^0x/i

/** The first `n` significant characters (letters, digits) of `s`, keeping separators between them. */
function head(s: string, n: number): string {
  // A "0x" prefix carries no information, so it doesn't count.
  const prefix = HEX_PREFIX.exec(s)?.[0] ?? ""
  let count = 0
  let out = prefix
  for (const ch of s.slice(prefix.length)) {
    if (SIGNIFICANT.test(ch)) {
      if (count === n) break
      count++
    } else if (count === n) break
    out += ch
  }
  return out.trim()
}

/** The last `n` significant characters of `s`, keeping separators between them. */
function tail(s: string, n: number): string {
  let count = 0
  let out = ""
  for (const ch of [...s].reverse()) {
    if (SIGNIFICANT.test(ch)) {
      if (count === n) break
      count++
    } else if (count === n) break
    out = ch + out
  }
  return out.trim()
}

function significantCount(s: string): number {
  return [...s.replace(HEX_PREFIX, "")].filter((c) => SIGNIFICANT.test(c))
    .length
}

/**
 * Masks an account identifier defensively: never more than the first 4 and
 * last 4 significant characters, with "…" in between. Already-masked input
 * ("0x3FD…9B12", "•••• 1234", "****1234") is re-clipped; raw input of 8
 * characters or fewer shows only its last 4.
 */
export function maskIdentifier(value: string | undefined): string | null {
  if (!value) return null
  const s = value.replace(/\s+/g, " ").trim()
  if (!s) return null

  const normalized = s.replace(MASK_RUN, "…")
  if (normalized.includes("…")) {
    const first = normalized.slice(0, normalized.indexOf("…"))
    const last = normalized.slice(normalized.lastIndexOf("…") + 1)
    const h = head(first, 4)
    const t = tail(last, 4)
    if (!h && !t) return null
    return `${h}…${t}`
  }

  const count = significantCount(s)
  if (count <= 4) return s
  if (count <= 8) return `…${tail(s, 4)}`
  return `${head(s, 4)}…${tail(s, 4)}`
}

// ---------------------------------------------------------------------------
// Money

/** Decimal places for a currency, e.g. USD → 2, JPY → 0. */
export function currencyDigits(currency: string | undefined): number {
  if (!currency) return 2
  try {
    return (
      new Intl.NumberFormat("en", {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** Amount in integer minor units. */
export function toMinor(amount: number, digits = 2): number {
  // toFixed first: 1.005 * 100 is 100.49999999999999 in floating point.
  return Math.round(Number((amount * 10 ** digits).toFixed(6)))
}

export function fromMinor(minor: number, digits = 2): number {
  return minor / 10 ** digits
}

function moneyFormatter(
  currency: string | undefined,
  locale: string = DEFAULT_LOCALE,
  options: Intl.NumberFormatOptions = {},
): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency ?? "USD",
      ...options,
    })
  } catch {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      ...options,
    })
  }
}

export function formatMoney(
  amount: number,
  currency?: string,
  options: { locale?: string; trimZeroCents?: boolean } = {},
): string {
  const digits = currencyDigits(currency)
  const whole = toMinor(amount, digits) % 10 ** digits === 0
  return moneyFormatter(
    currency,
    options.locale ?? DEFAULT_LOCALE,
    options.trimZeroCents && whole ? { minimumFractionDigits: 0 } : {},
  ).format(amount)
}

export type MoneyParts = {
  /** Sign, symbol and whole units, e.g. "$56,354" or "56.354". */
  lead: string
  /** Decimal separator and fraction, e.g. ".94" or ",94". Empty for JPY. */
  cents: string
  /** Anything after the fraction, e.g. " €" in de-DE. */
  trail: string
  /** The full formatted string. */
  text: string
}

/** Splits a formatted amount so the cents can be dimmed, for any currency and locale. */
export function splitMoney(
  amount: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): MoneyParts {
  const parts = moneyFormatter(currency, locale).formatToParts(amount)
  const start = parts.findIndex((p) => p.type === "decimal")
  if (start < 0) {
    const text = parts.map((p) => p.value).join("")
    return { lead: text, cents: "", trail: "", text }
  }
  let end = start + 1
  while (end < parts.length && parts[end].type === "fraction") end++
  const join = (from: number, to: number) =>
    parts
      .slice(from, to)
      .map((p) => p.value)
      .join("")
  return {
    lead: join(0, start),
    cents: join(start, end),
    trail: join(end, parts.length),
    text: join(0, parts.length),
  }
}

/** The currency's symbol and layout with the digits replaced, e.g. "$••••" or "•••• €". */
export function maskedMoney(
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const parts = moneyFormatter(currency, locale).formatToParts(1234.56)
  const numeric = new Set(["integer", "group", "decimal", "fraction"])
  let out = ""
  let masked = false
  for (const p of parts) {
    if (numeric.has(p.type)) {
      if (!masked) out += "••••"
      masked = true
    } else {
      out += p.value
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Totals

export type TotalsAccount = {
  id: string
  kind: AccountKind
  balance: number
  currency?: string
  balanceInDisplay?: number
}

export type AccountValue = {
  id: string
  liability: boolean
  /** Signed value in the display currency (liabilities negative), or null when not converted. */
  value: number | null
  /** The native currency differs from the display currency. */
  foreign: boolean
}

export type Totals = {
  /** Assets minus liabilities, in the display currency. */
  net: number
  /** Sum of asset accounts (an overdrawn account counts negative). */
  assets: number
  /** Total owed on liabilities, as a positive number. */
  owed: number
  /** Accounts in another currency without a converted value: not in the totals. */
  unconverted: string[]
  values: AccountValue[]
  digits: number
}

/** The account's native currency differs from the display currency. */
export function isForeign(
  account: { currency?: string },
  displayCurrency: string,
): boolean {
  return (
    !!account.currency &&
    account.currency.toUpperCase() !== displayCurrency.toUpperCase()
  )
}

/**
 * Net worth across accounts, in minor units. Liabilities are subtracted by
 * the amount owed (either sign from the source is read as owed). Accounts in
 * another currency count only with `balanceInDisplay`.
 */
export function computeTotals(
  accounts: TotalsAccount[],
  displayCurrency: string,
): Totals {
  const digits = currencyDigits(displayCurrency)
  const m = (n: number) => toMinor(n, digits)
  let assets = 0
  let owed = 0
  const unconverted: string[] = []
  const values: AccountValue[] = accounts.map((a) => {
    const liability = isLiability(a.kind)
    const foreign = isForeign(a, displayCurrency)
    const raw = foreign ? a.balanceInDisplay : a.balance
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      unconverted.push(a.id)
      return { id: a.id, liability, value: null, foreign }
    }
    if (liability) {
      owed += Math.abs(m(raw))
      return { id: a.id, liability, value: -Math.abs(raw), foreign }
    }
    assets += m(raw)
    return { id: a.id, liability, value: raw, foreign }
  })
  return {
    net: fromMinor(assets - owed, digits),
    assets: fromMinor(assets, digits),
    owed: fromMinor(owed, digits),
    unconverted,
    values,
    digits,
  }
}

/** True when a stated total is more than 0.01 away from the computed one. */
export function totalDiffers(
  stated: number | undefined,
  computed: number,
  digits = 2,
): boolean {
  if (typeof stated !== "number" || !Number.isFinite(stated)) return false
  const tolerance = Math.round(0.01 * 10 ** digits)
  return (
    Math.abs(toMinor(stated, digits) - toMinor(computed, digits)) > tolerance
  )
}

// ---------------------------------------------------------------------------
// Allocation

/**
 * Whole-percent shares of the positive values, summing to exactly 100
 * (largest-remainder rounding). Zero, negative and invalid values get 0.
 */
export function allocationShares(values: number[]): number[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
  const total = clean.reduce((s, v) => s + v, 0)
  if (total <= 0) return clean.map(() => 0)
  const exact = clean.map((v) => (v / total) * 100)
  const floors = exact.map(Math.floor)
  let left = 100 - floors.reduce((s, v) => s + v, 0)
  const order = exact
    .map((v, i) => ({ i, r: v - Math.floor(v) }))
    .filter(({ i }) => clean[i] > 0)
    .sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    floors[i]++
    left--
  }
  return floors
}

// ---------------------------------------------------------------------------
// Change

export type ChangeDirection = "up" | "down" | "flat"

export function changeDirection(
  percent: number | undefined,
  amount: number | undefined,
): ChangeDirection {
  const v =
    typeof percent === "number" && Number.isFinite(percent) ? percent : amount
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return "flat"
  return v > 0 ? "up" : "down"
}

/** "+3.12%", "-0.5%", "0%". Percent units: 3.12 means 3.12%. */
export function formatPercentChange(
  percent: number,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
    signDisplay: "exceptZero",
  }).format(percent / 100)
}

/** "+$1,702.10", "-€40.00". */
export function formatAmountChange(
  amount: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return moneyFormatter(currency, locale, { signDisplay: "exceptZero" }).format(
    amount,
  )
}

// ---------------------------------------------------------------------------
// Staleness

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
export function resolveNow(
  now: Date | string | number | undefined,
): number | null {
  if (now === undefined) return null
  const t = typeof now === "string" ? Date.parse(now) : new Date(now).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * "Updated yesterday", "Updated 3 days ago", "Updated 2 weeks ago" when the
 * data is more than 24 hours old. Null when fresh, unknown, or before mount.
 */
export function staleText(
  asOf: string | undefined,
  now: number | null,
): string | null {
  if (!asOf || now === null) return null
  const t = Date.parse(asOf)
  if (!Number.isFinite(t)) return null
  const age = now - t
  if (age <= 24 * HOUR_MS) return null
  // Words in an English sentence ("Updated 3 days ago"), so English like the
  // rest of the copy; the locale formats numbers and dates, not phrases.
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" })
  const days = Math.floor(age / DAY_MS)
  if (days < 7) return `Updated ${rtf.format(-days, "day")}`
  if (days < 30) return `Updated ${rtf.format(-Math.floor(days / 7), "week")}`
  if (days < 365) {
    return `Updated ${rtf.format(-Math.floor(days / 30), "month")}`
  }
  return `Updated ${rtf.format(-Math.floor(days / 365), "year")}`
}
