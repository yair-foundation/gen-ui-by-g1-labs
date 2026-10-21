import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type {
  AssumptionKind,
  AssumptionsResult,
  Correction,
  CorrectionValue,
} from "./assumptions.schema"

type Level = "low" | "medium" | "high"

type Sortable = {
  kind: AssumptionKind
  impact?: Level
  confidence?: Level
}

export type GroupKey = "assumed" | "unknown" | "limits"

export type AssumptionGroup<T> = {
  key: GroupKey
  label: string
  items: T[]
}

const GROUPS: { key: GroupKey; label: string; kinds: AssumptionKind[] }[] = [
  { key: "assumed", label: "Assumed", kinds: ["assumption"] },
  { key: "unknown", label: "Not known", kinds: ["unknown"] },
  { key: "limits", label: "Limits", kinds: ["constraint", "data-limit"] },
]

// High impact first; unrated last.
const IMPACT_RANK: Record<Level, number> = { high: 0, medium: 1, low: 2 }
// Least certain first, since those most need a look; unrated last.
const CONFIDENCE_RANK: Record<Level, number> = { low: 0, medium: 1, high: 2 }

/** Impact (high → low), then confidence (low → high). Stable for ties. */
export function compareItems(a: Sortable, b: Sortable) {
  const impact =
    (a.impact ? IMPACT_RANK[a.impact] : 3) -
    (b.impact ? IMPACT_RANK[b.impact] : 3)
  if (impact !== 0) return impact
  return (
    (a.confidence ? CONFIDENCE_RANK[a.confidence] : 3) -
    (b.confidence ? CONFIDENCE_RANK[b.confidence] : 3)
  )
}

/**
 * Groups items into "Assumed", "Not known" and "Limits", in that order, each
 * sorted with `compareItems`. Empty groups are left out.
 */
export function groupItems<T extends Sortable>(
  items: readonly T[],
): AssumptionGroup<T>[] {
  return GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    // Array.prototype.sort is stable, so ties keep the agent's order.
    items: items.filter((i) => g.kinds.includes(i.kind)).sort(compareItems),
  })).filter((g) => g.items.length > 0)
}

/** "Medium confidence · High impact". Empty when neither is set. */
export function metaText(confidence?: Level, impact?: Level) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return [
    confidence ? `${cap(confidence)} confidence` : null,
    impact ? `${cap(impact)} impact` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

export type ValidationResult =
  | { ok: true; value: CorrectionValue }
  | { ok: false; error: string }

const MAX_TEXT = 200

/**
 * Checks a raw editor value against the correction's type and returns the
 * typed value to send back. Text is trimmed; numbers are parsed.
 */
export function validateCorrection(
  correction: Pick<Correction, "type" | "options">,
  raw: unknown,
): ValidationResult {
  switch (correction.type) {
    case "number": {
      const text =
        typeof raw === "number" ? String(raw) : String(raw ?? "").trim()
      if (text === "") return { ok: false, error: "Enter a number." }
      const n = Number(text)
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, error: "Enter a number." }
    }
    case "boolean":
      return typeof raw === "boolean"
        ? { ok: true, value: raw }
        : { ok: false, error: "Choose yes or no." }
    case "select":
      if (correction.options && correction.options.length > 0) {
        return typeof raw === "string" && correction.options.includes(raw)
          ? { ok: true, value: raw }
          : { ok: false, error: "Choose one of the options." }
      }
      // A select without options degrades to free text.
      return validateCorrection({ type: "text" }, raw)
    default: {
      const text = typeof raw === "string" ? raw.trim() : ""
      if (text === "") return { ok: false, error: "Enter a value." }
      if (text.length > MAX_TEXT) {
        return {
          ok: false,
          error: `Keep it under ${MAX_TEXT} characters.`,
        }
      }
      return { ok: true, value: text }
    }
  }
}

const CURRENCY = /^[€$£¥₹₪]/

/**
 * Formats a corrected value for display: "Yes", "2 adults", "3%",
 * "€140/night", "£250,000".
 */
export function formatCorrectionValue(
  correction: Pick<Correction, "type" | "unit">,
  value: CorrectionValue,
  locale: string = DEFAULT_LOCALE,
): string {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value !== "number") return value
  const n = new Intl.NumberFormat(locale).format(value)
  const unit = correction.unit?.trim()
  if (!unit) return n
  if (CURRENCY.test(unit)) {
    const symbol = unit.charAt(0)
    const rest = unit.slice(1).trim()
    return `${symbol}${n}${rest ? joinUnit(rest) : ""}`
  }
  return `${n}${joinUnit(unit)}`
}

/** "%" and "/x" attach directly; words get a space. */
function joinUnit(unit: string) {
  return unit === "%" || unit.startsWith("/") ? unit : ` ${unit}`
}

/** Same value, ignoring surrounding whitespace in text. */
export function sameValue(
  a: CorrectionValue | undefined,
  b: CorrectionValue | undefined,
) {
  if (typeof a === "string" && typeof b === "string") {
    return a.trim() === b.trim()
  }
  return a === b
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`

/** Footer counts: "3 corrections · 2 confirmed". */
export function countsText(corrections: number, confirmed: number) {
  const parts = [
    corrections > 0 ? plural(corrections, "correction", "corrections") : null,
    confirmed > 0 ? `${confirmed} confirmed` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "No corrections yet"
}

/** The read-only record after sending: "Sent 2 corrections · 1 confirmed". */
export function resultText(result: AssumptionsResult) {
  if (result.action === "confirm-all") return "Confirmed everything"
  const sent = `Sent ${plural(result.corrections.length, "correction", "corrections")}`
  return result.confirmed.length
    ? `${sent} · ${result.confirmed.length} confirmed`
    : sent
}
