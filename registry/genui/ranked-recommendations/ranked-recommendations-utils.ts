/**
 * Ranked Recommendations: pure helpers (no React), so they can be unit-tested
 * in Node and reused on the server.
 *
 * - sortByRank: the order items are shown in, tolerant of partial items.
 * - summarizeConstraints: which constraints an item meets, and its missed musts.
 * - formatScore / formatPrice: display text plus a spoken equivalent.
 * - toggleSelection: radio/checkbox selection with an optional maximum.
 * - splitMarkers: "[n]" source markers inside a reason.
 * - safeUrl / safeImageSrc: only http(s) links, and http(s), same-origin path or data:image images.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type ConstraintKind = "must" | "nice"
export type MeetsValue = true | false | "partial"

export type ConstraintLike = { id: string; label: string; kind: ConstraintKind }

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/**
 * Sorts by `rank` (ascending). Ties and items without a rank keep their
 * original order; unranked items go last. Never mutates the input.
 */
export function sortByRank<T extends { rank?: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ra = typeof a.item.rank === "number" ? a.item.rank : Infinity
      const rb = typeof b.item.rank === "number" ? b.item.rank : Infinity
      if (ra !== rb) return ra < rb ? -1 : 1
      return a.index - b.index
    })
    .map((x) => x.item)
}

// ---------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------

export type ConstraintState = "met" | "missed" | "partial" | "unknown"

export type ConstraintRow = {
  constraint: ConstraintLike
  state: ConstraintState
}

export type ConstraintSummary = {
  /** Every constraint, in the order given, with this item's state. */
  rows: ConstraintRow[]
  /** Must-haves this item clearly doesn't meet. */
  missedMusts: ConstraintLike[]
  /** Must-haves it only partly meets. */
  partialMusts: ConstraintLike[]
  /** How many constraints it fully meets. */
  metCount: number
}

export function constraintState(value: unknown): ConstraintState {
  // Models often write the booleans as strings; read both the same way.
  if (value === true || value === "true") return "met"
  if (value === false || value === "false") return "missed"
  if (value === "partial") return "partial"
  return "unknown"
}

/** Per-item check against the shared constraints. Unknown ids in `meets` are ignored. */
export function summarizeConstraints(
  meets: Record<string, unknown> | undefined,
  constraints: ConstraintLike[],
): ConstraintSummary {
  const rows = constraints.map((constraint) => ({
    constraint,
    state: constraintState(meets?.[constraint.id]),
  }))
  return {
    rows,
    missedMusts: rows
      .filter((r) => r.constraint.kind === "must" && r.state === "missed")
      .map((r) => r.constraint),
    partialMusts: rows
      .filter((r) => r.constraint.kind === "must" && r.state === "partial")
      .map((r) => r.constraint),
    metCount: rows.filter((r) => r.state === "met").length,
  }
}

/** Spoken text for one constraint check, e.g. "Meets must-have: Quiet". */
export function describeConstraint(row: ConstraintRow): string {
  const kind = row.constraint.kind === "must" ? "must-have" : "nice-to-have"
  const verb = {
    met: "Meets",
    missed: "Misses",
    partial: "Partly meets",
    unknown: "Not known for",
  }[row.state]
  return `${verb} ${kind}: ${row.constraint.label}`
}

/** Labels split by kind, for the legend in the header. */
export function constraintLegend(constraints: ConstraintLike[]) {
  return {
    must: constraints.filter((c) => c.kind === "must").map((c) => c.label),
    nice: constraints.filter((c) => c.kind === "nice").map((c) => c.label),
  }
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

/**
 * "8.6 / 10", with a spoken "Score 8.6 out of 10". At most one decimal.
 * Returns null for missing or invalid scores (outOf must be > 0).
 */
export function formatScore(
  score: { value?: number; outOf?: number } | undefined,
  locale: string = DEFAULT_LOCALE,
): { text: string; spoken: string } | null {
  if (!score || typeof score.value !== "number") return null
  const outOf = typeof score.outOf === "number" ? score.outOf : 10
  if (!Number.isFinite(score.value) || !Number.isFinite(outOf) || outOf <= 0)
    return null
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const value = fmt.format(score.value)
  const max = fmt.format(outOf)
  return { text: `${value} / ${max}`, spoken: `Score ${value} out of ${max}` }
}

/** "$12 / user/month", "€0" → "Free". Falls back to "12 XYZ" for unknown codes. */
export function formatPrice(
  price: { amount?: number; currency?: string; period?: string } | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!price || typeof price.amount !== "number") return null
  if (!Number.isFinite(price.amount)) return null
  let amount: string
  if (price.amount === 0) {
    amount = "Free"
  } else {
    try {
      amount = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: price.currency ?? "",
        maximumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
      }).format(price.amount)
    } catch {
      amount = `${new Intl.NumberFormat(locale).format(price.amount)}${
        price.currency ? ` ${price.currency}` : ""
      }`
    }
  }
  const period = price.period?.trim()
  return period && price.amount !== 0 ? `${amount} / ${period}` : amount
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Toggles `id`. With max 1 (single choice) picking replaces the current
 * choice. With a higher max, adding past the limit is refused (returns the
 * same array). `max` undefined means no limit.
 */
export function toggleSelection(
  selected: string[],
  id: string,
  max?: number,
): string[] {
  if (selected.includes(id)) {
    // A radio can't be unticked by clicking it again.
    return max === 1 ? selected : selected.filter((s) => s !== id)
  }
  if (max === 1) return [id]
  if (max !== undefined && selected.length >= max) return selected
  return [...selected, id]
}

/** Keeps only ids that exist, in the order of `ids`, deduplicated, capped. */
export function sanitizeSelection(
  selected: string[],
  ids: string[],
  max?: number,
): string[] {
  const wanted = new Set(selected)
  const out = ids.filter((id) => wanted.has(id))
  return max !== undefined ? out.slice(0, max) : out
}

// ---------------------------------------------------------------------------
// Source markers
// ---------------------------------------------------------------------------

export type ReasonPart =
  | { kind: "text"; value: string }
  | { kind: "cite"; refs: number[] }

const MARKERS = /((?:\[\d+(?:\s*,\s*\d+)*\])+)/g

/**
 * Splits a reason into text and "[n]" markers (n is the 1-based position in
 * `sources`; "[1][3]" and "[1,3]" both work). While streaming, a marker that's
 * still being written ("[1" or "[") is hidden.
 */
export function splitMarkers(text: string, streaming = false): ReasonPart[] {
  const src = streaming ? text.replace(/\[[\d,\s]*$/, "") : text
  const out: ReasonPart[] = []
  for (const part of src.split(MARKERS)) {
    if (!part) continue
    if (/^\[\d/.test(part)) {
      const refs = [...part.matchAll(/\d+/g)].map((m) => Number(m[0]))
      out.push({ kind: "cite", refs: [...new Set(refs)] })
    } else {
      out.push({ kind: "text", value: part })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

/** Only http(s) URLs become links. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/**
 * http(s) images, a same-origin path starting with a single "/", or inline
 * data:image/* (not SVG, which can carry script).
 */
export function safeImageSrc(src: string | undefined): string | null {
  if (!src) return null
  if (/^\/(?![/\\])/.test(src)) return src
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(src)) return src
  return safeUrl(src)
}
