/**
 * Approval Request: pure helpers. No React, no DOM: safe to reuse on the
 * server (e.g. to check a decision before acting on it) and to unit-test in Node.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type ApprovalRisk = "low" | "medium" | "high"
export type AdjustValue = string | number | boolean
export type AdjustType = "number" | "text" | "select" | "toggle"

export type AdjustField = {
  id: string
  label: string
  type: AdjustType
  value: AdjustValue
  options?: string[]
  min?: number
  max?: number
}

// ---------------------------------------------------------------------------
// Risk

export type RiskMeta = {
  /** Visible text, so risk never relies on color alone. */
  label: string
  /** Lucide icon name the component maps to a component. */
  icon: "shield-check" | "shield-alert" | "alert-triangle"
}

const RISK: Record<ApprovalRisk, RiskMeta> = {
  low: { label: "Low risk", icon: "shield-check" },
  medium: { label: "Medium risk", icon: "shield-alert" },
  high: { label: "High risk", icon: "alert-triangle" },
}

/** Label and icon for a risk level. Unknown values read as medium. */
export function riskMeta(risk: string | undefined): RiskMeta {
  return RISK[
    (risk as ApprovalRisk) in RISK ? (risk as ApprovalRisk) : "medium"
  ]
}

// ---------------------------------------------------------------------------
// Reversibility

export type Reversibility = {
  kind: "reversible" | "partial" | "irreversible"
  text: string
}

/**
 * The reversibility line: "Can't be undone", "Undo within 30 seconds",
 * "Partly reversible: refunds are prorated within 14 days".
 */
/**
 * `reversible` as the model meant it. Models often write booleans as strings
 * ("false"), which the schema accepts too; read both the same way.
 */
export function readReversible(
  value: unknown,
): boolean | "partially" | undefined {
  if (value === true || value === "true") return true
  if (value === false || value === "false") return false
  if (value === "partially") return "partially"
  return undefined
}

export function reversibilityText({
  reversible,
  undoWindow,
  reversibleDetail,
}: {
  reversible: boolean | "partially" | undefined
  undoWindow?: string
  reversibleDetail?: string
}): Reversibility | null {
  const detail = reversibleDetail?.trim()
  const window = undoWindow?.trim()
  if (reversible === false) {
    return {
      kind: "irreversible",
      text: detail
        ? `Can't be undone: ${lowerFirst(detail)}`
        : "Can't be undone",
    }
  }
  if (reversible === "partially") {
    const why = detail ?? window
    return {
      kind: "partial",
      text: why ? `Partly reversible: ${lowerFirst(why)}` : "Partly reversible",
    }
  }
  if (reversible === true) {
    const head = window ?? "Can be undone"
    return {
      kind: "reversible",
      text: detail ? `${head}. ${upperFirst(detail)}` : head,
    }
  }
  return null
}

function lowerFirst(s: string) {
  // Keep acronyms and proper nouns ("API", "Stripe") as written.
  if (/^.[A-Z]/.test(s)) return s
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function upperFirst(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------------------------------------------------------------------------
// Confirm phrase

/** Whether the typed text matches the phrase: trimmed, case-insensitive. */
export function matchesConfirmPhrase(
  input: string | undefined,
  phrase: string | undefined,
): boolean {
  const want = phrase?.trim()
  if (!want) return true
  return (input ?? "").trim().toLocaleLowerCase() === want.toLocaleLowerCase()
}

/** How long the user holds Approve, in milliseconds. */
export const HOLD_MS = 1200

/**
 * Whether Approve needs a press and hold. Explicit `hold` wins; otherwise it
 * is on for risk 'high', unless a confirm phrase already asks for a deliberate
 * step (two hurdles on one button is friction, not safety).
 */
export function needsHold(opts: {
  hold?: boolean
  risk?: string
  confirmPhrase?: string
}): boolean {
  if (typeof opts.hold === "boolean") return opts.hold
  return opts.risk === "high" && !opts.confirmPhrase?.trim()
}

// ---------------------------------------------------------------------------
// Expiry

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** ISO string or epoch ms → epoch ms, or null. */
export function toEpoch(v: string | number | Date | undefined): number | null {
  if (v === undefined || v === "") return null
  const t =
    typeof v === "string" ? Date.parse(v) : v instanceof Date ? v.getTime() : v
  return Number.isFinite(t) ? t : null
}

/**
 * "Expires in 14 min", relative to `now`. Rounds down, so it never promises
 * more time than is left. Null when there's no valid deadline.
 */
export function expiryText(
  expiresAt: string | number | undefined,
  now: number,
): string | null {
  const end = toEpoch(expiresAt)
  if (end === null) return null
  const left = end - now
  if (left <= 0) return "Expired"
  if (left < MINUTE) return "Expires in under a minute"
  if (left < HOUR) return `Expires in ${Math.floor(left / MINUTE)} min`
  if (left < DAY) {
    const h = Math.floor(left / HOUR)
    const m = Math.floor((left % HOUR) / MINUTE)
    return m ? `Expires in ${h} h ${m} min` : `Expires in ${h} h`
  }
  const d = Math.floor(left / DAY)
  return `Expires in ${d} ${d === 1 ? "day" : "days"}`
}

// ---------------------------------------------------------------------------
// Cost

export type CostPeriod =
  | "one-time"
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"

export type FormattedCost = {
  /** "$1,200" (no cents for whole amounts). */
  amount: string
  /** "per year", or null for one-time charges. */
  period: string | null
  /** "$1,200 per year", for screen readers and summaries. */
  label: string
}

/** Formats a charge. Whole amounts drop the cents: "$1,200", "$19.99". */
export function formatCost(
  cost: { amount: number; currency: string; period?: CostPeriod },
  locale: string = DEFAULT_LOCALE,
): FormattedCost {
  const whole = Number.isInteger(cost.amount)
  let amount: string
  try {
    amount = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: cost.currency,
      ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}),
    }).format(cost.amount)
  } catch {
    // Invalid currency code: show the number and the code as given.
    amount = `${new Intl.NumberFormat(locale).format(cost.amount)} ${cost.currency}`
  }
  const period =
    cost.period && cost.period !== "one-time" ? `per ${cost.period}` : null
  return { amount, period, label: period ? `${amount} ${period}` : amount }
}

// ---------------------------------------------------------------------------
// Adjustable fields

/**
 * A raw control value as the field's typed value, or null when it isn't valid
 * (an empty or non-numeric number, a select value outside its options).
 */
export function normalizeAdjustment(
  field: AdjustField,
  raw: AdjustValue | undefined,
): AdjustValue | null {
  const value = raw === undefined ? field.value : raw
  switch (field.type) {
    case "number": {
      const text =
        typeof value === "number" ? String(value) : String(value).trim()
      if (text === "") return null
      const n = Number(text)
      return Number.isFinite(n) ? n : null
    }
    case "toggle":
      return value === true || value === "true"
    case "select": {
      const s = String(value)
      return field.options && !field.options.includes(s) ? null : s
    }
    default:
      return String(value)
  }
}

/** A short error for an invalid value, or null when it's fine. */
export function validateAdjustment(
  field: AdjustField,
  raw: AdjustValue | undefined,
): string | null {
  const value = normalizeAdjustment(field, raw)
  if (field.type === "number") {
    if (value === null) return "Enter a number"
    const n = value as number
    const { min, max } = field
    const outside =
      (min !== undefined && n < min) || (max !== undefined && n > max)
    if (!outside) return null
    if (min !== undefined && max !== undefined)
      return `Enter a number from ${min} to ${max}`
    return min !== undefined ? `Enter ${min} or more` : `Enter ${max} or less`
  }
  if (field.type === "select" && value === null) return "Choose an option"
  if (
    field.type === "text" &&
    String(field.value).trim() !== "" &&
    String(value).trim() === ""
  )
    return "Can't be empty"
  return null
}

function sameValue(field: AdjustField, a: AdjustValue | null) {
  const b = normalizeAdjustment(field, field.value)
  if (field.type === "text")
    return String(a ?? "").trim() === String(b ?? "").trim()
  return a === b
}

/**
 * The fields the user changed, with their typed values. Unchanged and invalid
 * fields are left out, so the agent only sees real adjustments.
 */
export function diffAdjustments(
  fields: AdjustField[],
  edits: Record<string, AdjustValue>,
): Record<string, AdjustValue> {
  const out: Record<string, AdjustValue> = {}
  for (const f of fields) {
    if (!(f.id in edits)) continue
    if (validateAdjustment(f, edits[f.id]) !== null) continue
    const v = normalizeAdjustment(f, edits[f.id])
    if (v === null || sameValue(f, v)) continue
    out[f.id] = f.type === "text" ? String(v).trim() : v
  }
  return out
}

// ---------------------------------------------------------------------------
// Decision record

export type ApprovalDecision =
  | { action: "approve"; adjustments?: Record<string, AdjustValue> }
  | { action: "reject"; reason?: string }
  | { action: "revise"; feedback: string }
  | { action: "alternative"; id: string }

/**
 * The one-line record shown after a decision: "Approved at 10:42 · with 1
 * change", "Rejected · Wrong list". `time` is the formatted decision time.
 */
export function decisionText(
  decision: ApprovalDecision,
  { time, alternativeLabel }: { time?: string; alternativeLabel?: string } = {},
): string {
  const at = time ? ` at ${time}` : ""
  switch (decision.action) {
    case "approve": {
      const n = Object.keys(decision.adjustments ?? {}).length
      return `Approved${at}${n ? ` · with ${n} ${n === 1 ? "change" : "changes"}` : ""}`
    }
    case "reject": {
      const reason = decision.reason?.trim()
      return `Rejected${at}${reason ? ` · ${reason}` : ""}`
    }
    case "revise":
      return `Sent back${at} · ${decision.feedback.trim()}`
    case "alternative":
      return `Chose instead${at} · ${alternativeLabel ?? decision.id}`
  }
}
