/**
 * Term Explainer: pure helpers (no React, no DOM), so they can be unit-tested.
 *
 * The range always comes from the user's document; these helpers only place
 * the value on it. They never judge what a value means.
 *
 * - parseNumericValue / resolveValue: the number in "4.1 mmol/L".
 * - rangeStatus / statusLabel: below, within or above the range, in words.
 * - rangeScale: positions for the inline range bar, missing bounds included.
 * - withUnit / formatRange / describeValue: unit display.
 * - disclaimerText: the short "not advice" line.
 * - safeHttpUrl: only http(s) links are rendered.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

// ---- URLs ----------------------------------------------------------------

/** The normalized URL if it is http(s); anything else is null. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

// ---- Values --------------------------------------------------------------

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)

/**
 * The first number in a printed value: "4.1 mmol/L" → 4.1, "24.9%" → 24.9,
 * "1,250 mg" → 1250, "4,1 mmol/L" → 4.1, "−0.5" → -0.5. Null when there is none.
 */
export function parseNumericValue(value: unknown): number | null {
  if (isNum(value)) return value
  if (typeof value !== "string") return null
  const m = value
    .replace(/−/g, "-")
    .match(/[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:[.,]\d+)?/)
  if (!m) return null
  let s = m[0]
  if (/^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(s)) {
    s = s.replace(/,/g, "") // Thousands separators: 1,250.5
  } else {
    s = s.replace(",", ".") // Decimal comma: 4,1
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** `numericValue` when set, otherwise the number read from `value`. */
export function resolveValue(context: {
  value?: string
  numericValue?: number
}): number | null {
  return isNum(context.numericValue)
    ? context.numericValue
    : parseNumericValue(context.value)
}

// ---- Range ---------------------------------------------------------------

export type RangeStatus = "below" | "within" | "above"

/**
 * Where the value sits on the document's range. Bounds are inclusive. With
 * only one bound, the other side is open. Null with no bounds, a missing
 * value, or a range whose low is above its high.
 */
export function rangeStatus(
  value: number | null | undefined,
  low?: number,
  high?: number,
): RangeStatus | null {
  if (!isNum(value)) return null
  const hasLow = isNum(low)
  const hasHigh = isNum(high)
  if (!hasLow && !hasHigh) return null
  if (hasLow && hasHigh && low > high) return null
  if (hasLow && value < low) return "below"
  if (hasHigh && value > high) return "above"
  return "within"
}

export function statusLabel(status: RangeStatus): string {
  return status === "within"
    ? "Within range"
    : status === "above"
      ? "Above range"
      : "Below range"
}

export type RangeScale = {
  /** Start of the document's range on the bar, 0–100. */
  bandStart: number
  /** End of the document's range on the bar, 0–100. */
  bandEnd: number
  /** The value's marker, 0–100. */
  valuePct: number
}

/**
 * Positions for the range bar. The range takes the middle of the bar with
 * room either side; a missing bound runs the range to that end of the bar.
 * The bar widens to fit a value far outside the range.
 */
export function rangeScale(
  value: number | null | undefined,
  low?: number,
  high?: number,
): RangeScale | null {
  if (rangeStatus(value, low, high) === null || !isNum(value)) return null
  let lo: number
  let hi: number
  if (isNum(low) && isNum(high)) {
    const span = high - low || Math.abs(high) || 1
    lo = low - span * 0.5
    hi = high + span * 0.5
  } else if (isNum(high)) {
    const span = Math.abs(high) || 1
    lo = high - span
    hi = high + span * 0.5
  } else {
    const l = low as number
    const span = Math.abs(l) || 1
    lo = l - span * 0.5
    hi = l + span
  }
  const pad = (hi - lo) * 0.05
  if (value < lo) lo = value - pad
  if (value > hi) hi = value + pad
  const pct = (x: number) =>
    Math.min(100, Math.max(0, ((x - lo) / (hi - lo)) * 100))
  return {
    bandStart: isNum(low) ? pct(low) : 0,
    bandEnd: isNum(high) ? pct(high) : 100,
    valuePct: pct(value),
  }
}

// ---- Units ---------------------------------------------------------------

/** Units written straight after the number: "24.9%", "37 °C" is still spaced. */
const TIGHT_UNITS = new Set(["%", "‰", "°"])

/** A number and its unit: "4.1 mmol/L", "24.9%". */
export function withUnit(text: string, unit?: string): string {
  const u = unit?.trim()
  if (!u) return text
  return TIGHT_UNITS.has(u) ? `${text}${u}` : `${text} ${u}`
}

export function formatNumber(
  n: number,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(n)
}

/**
 * The range in words: "3.5–5.1 mmol/L", "up to 200 mg/dL",
 * "at least 40 mg/dL". Null when there are no bounds.
 */
export function formatRange(
  range: { low?: number; high?: number; unit?: string } | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!range) return null
  const { low, high, unit } = range
  const f = (n: number) => formatNumber(n, locale)
  if (isNum(low) && isNum(high)) {
    if (low > high) return null
    return withUnit(`${f(low)}–${f(high)}`, unit)
  }
  if (isNum(high)) return `up to ${withUnit(f(high), unit)}`
  if (isNum(low)) return `at least ${withUnit(f(low), unit)}`
  return null
}

/**
 * One sentence for screen readers and copy: "Your result: 4.1 mmol/L, within
 * the range 3.5–5.1 mmol/L (Your lab's reference range)."
 */
export function describeValue(
  context: {
    label?: string
    value?: string
    numericValue?: number
    range?: { low?: number; high?: number; unit?: string; source?: string }
  },
  locale: string = DEFAULT_LOCALE,
): string {
  const head = `${context.label ?? "Value"}: ${context.value ?? ""}`.trim()
  const range = formatRange(context.range, locale)
  const status = rangeStatus(
    resolveValue(context),
    context.range?.low,
    context.range?.high,
  )
  if (!range || !status) return `${head}.`
  const where =
    status === "within" ? "within" : status === "above" ? "above" : "below"
  const from = context.range?.source ? ` (${context.range.source})` : ""
  return `${head}, ${where} the range ${range}${from}.`
}

// ---- Disclaimer ----------------------------------------------------------

export type DisclaimerKind = "medical" | "financial" | "legal"

/**
 * The one short disclaimer line (8 words at most). `personal` is true when
 * the user's own value is shown, so the line points them to a professional.
 */
export function disclaimerText(
  kind: DisclaimerKind | null | undefined,
  personal = false,
): string | null {
  switch (kind) {
    case "medical":
      return personal
        ? "Not medical advice. Ask your clinician."
        : "Not medical advice."
    case "financial":
      return personal
        ? "Not financial advice. Check the full terms."
        : "Not financial advice."
    case "legal":
      return personal ? "Not legal advice. Ask a lawyer." : "Not legal advice."
    default:
      return null
  }
}
