/**
 * Comparison Matrix: pure helpers (no React), so they can be unit-tested in
 * Node and reused on the server.
 *
 * - bestItemIds: the winning option(s) in a row, by direction, ties included.
 * - isEqualRow / partitionRows: rows where every option has the same value.
 * - normalizeRow / weightedScores: the optional weighted score.
 * - formatValue / spokenValue / formatPrice: display text.
 * - groupCriteria, safeUrl, commonCurrency: small helpers.
 *
 * Weighted score (0–100, rounded):
 *
 *   score(item) = round(100 × Σ weight_c × n_c(item) / Σ weight_c)
 *
 * over the criteria with weight > 0 that can be scored:
 * - number, currency, rating with `better`: min–max normalised across the
 *   known values in the row, so the best value is 1 and the worst 0:
 *     higher: n = (v − min) / (max − min)
 *     lower:  n = (max − v) / (max − min)
 *   When every known value is equal, each scores 1.
 * - boolean: true = 1, false = 0.
 * Text rows and rows without `better` are never scored. An unknown value
 * (null) scores 0, so missing data can't win.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type CompareValue = string | number | boolean | null
export type CriterionType =
  | "text"
  | "number"
  | "boolean"
  | "rating"
  | "currency"

export type CriterionLike = {
  id: string
  type?: CriterionType
  better?: "higher" | "lower"
  unit?: string
  currency?: string
  outOf?: number
  weight?: number
}

/** values[itemId][criterionId]; records may be partial while streaming. */
export type ValuesMap = Record<
  string,
  Record<string, CompareValue | undefined> | undefined
>

export type PriceLike = { amount?: number; currency?: string; period?: string }

const EPS = 1e-9

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export function getValue(
  values: ValuesMap | undefined,
  itemId: string,
  criterionId: string,
): CompareValue | undefined {
  return values?.[itemId]?.[criterionId]
}

/** The key has arrived (null counts: it means "not known"). */
export function hasValue(
  values: ValuesMap | undefined,
  itemId: string,
  criterionId: string,
): boolean {
  const record = values?.[itemId]
  return (
    record !== undefined &&
    Object.hasOwn(record, criterionId) &&
    record[criterionId] !== undefined
  )
}

export function isKnown(
  value: CompareValue | undefined,
): value is string | number | boolean {
  return (
    value !== null &&
    value !== undefined &&
    !(typeof value === "string" && value.trim() === "")
  )
}

/** Numbers, and plain numeric strings ("16", "4.5"). Everything else is null. */
export function toNumber(value: CompareValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return Number(value)
  }
  return null
}

const isNumericType = (type?: CriterionType) =>
  type === "number" || type === "currency" || type === "rating"

/** The row has a winning direction: a best value can be marked. */
export function isRanked(c: CriterionLike): boolean {
  return isNumericType(c.type) && c.better !== undefined
}

// ---------------------------------------------------------------------------
// Best per row
// ---------------------------------------------------------------------------

/**
 * Ids of the best option(s) in a ranked row. Ties mark all. Empty when the
 * row isn't ranked, fewer than two values are known, or every known value is
 * equal (nothing stands out).
 */
export function bestItemIds(
  c: CriterionLike,
  itemIds: string[],
  values: ValuesMap | undefined,
): string[] {
  if (!isRanked(c)) return []
  const known = itemIds
    .map((id) => ({ id, n: toNumber(getValue(values, id, c.id)) }))
    .filter((e): e is { id: string; n: number } => e.n !== null)
  if (known.length < 2) return []
  const nums = known.map((e) => e.n)
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  if (max - min < EPS) return []
  const target = c.better === "higher" ? max : min
  return known.filter((e) => Math.abs(e.n - target) < EPS).map((e) => e.id)
}

/** Highest-scoring ids (ties mark all); empty when every score is equal. */
export function bestScoreIds(scores: Record<string, number>): string[] {
  const entries = Object.entries(scores)
  if (entries.length < 2) return []
  const nums = entries.map(([, s]) => s)
  const max = Math.max(...nums)
  if (max === Math.min(...nums)) return []
  return entries.filter(([, s]) => s === max).map(([id]) => id)
}

// ---------------------------------------------------------------------------
// Equal rows
// ---------------------------------------------------------------------------

const normText = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()

/** Same value for comparison purposes. Unknown equals only unknown. */
export function sameValue(
  a: CompareValue | undefined,
  b: CompareValue | undefined,
): boolean {
  const aKnown = isKnown(a)
  const bKnown = isKnown(b)
  if (!aKnown || !bKnown) return aKnown === bKnown
  const an = toNumber(a)
  const bn = toNumber(b)
  if (an !== null && bn !== null) return Math.abs(an - bn) < EPS
  if (typeof a === "string" && typeof b === "string") {
    return normText(a) === normText(b)
  }
  return a === b
}

/** Every option has the same value (missing counts as unknown). */
export function isEqualRow(
  c: CriterionLike,
  itemIds: string[],
  values: ValuesMap | undefined,
): boolean {
  if (itemIds.length < 2) return false
  const first = getValue(values, itemIds[0], c.id)
  return itemIds.every((id) => sameValue(getValue(values, id, c.id), first))
}

/**
 * Splits rows into the ones that differ and the ones that are the same for
 * every option. With highlight "all", nothing is folded.
 */
export function partitionRows<T extends CriterionLike>(
  criteria: T[],
  itemIds: string[],
  values: ValuesMap | undefined,
  highlight: "differences" | "all" = "differences",
): { different: T[]; same: T[] } {
  if (highlight === "all") return { different: criteria, same: [] }
  const different: T[] = []
  const same: T[] = []
  for (const c of criteria) {
    if (isEqualRow(c, itemIds, values)) same.push(c)
    else different.push(c)
  }
  return { different, same }
}

/** Groups in first-appearance order; ungrouped rows use the key "". */
export function groupCriteria<T extends { group?: string }>(
  criteria: T[],
): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const c of criteria) {
    const key = c.group ?? ""
    const list = map.get(key)
    if (list) list.push(c)
    else map.set(key, [c])
  }
  return [...map.entries()]
}

// ---------------------------------------------------------------------------
// Weighted score
// ---------------------------------------------------------------------------

const hasWeight = (c: CriterionLike) =>
  typeof c.weight === "number" && Number.isFinite(c.weight) && c.weight > 0

/** Counts toward the weighted score. */
export function isScorable(c: CriterionLike): boolean {
  return hasWeight(c) && (isRanked(c) || c.type === "boolean")
}

/**
 * Each option's value in the row on a 0–1 scale (1 = best), or null when the
 * row can't be scored. Unknown values are 0.
 */
export function normalizeRow(
  c: CriterionLike,
  itemIds: string[],
  values: ValuesMap | undefined,
): Record<string, number> | null {
  if (c.type === "boolean") {
    return Object.fromEntries(
      itemIds.map((id) => [id, getValue(values, id, c.id) === true ? 1 : 0]),
    )
  }
  if (!isRanked(c)) return null
  const nums = itemIds.map((id) => toNumber(getValue(values, id, c.id)))
  const known = nums.filter((n): n is number => n !== null)
  if (known.length === 0) {
    return Object.fromEntries(itemIds.map((id) => [id, 0]))
  }
  const min = Math.min(...known)
  const max = Math.max(...known)
  const span = max - min
  return Object.fromEntries(
    itemIds.map((id, i) => {
      const n = nums[i]
      if (n === null) return [id, 0]
      if (span < EPS) return [id, 1]
      return [id, c.better === "higher" ? (n - min) / span : (max - n) / span]
    }),
  )
}

/**
 * Weighted scores out of 100 (see the formula at the top of this file), or
 * null when no row has a weight.
 */
export function weightedScores(
  criteria: CriterionLike[],
  itemIds: string[],
  values: ValuesMap | undefined,
): { scores: Record<string, number>; criteria: string[] } | null {
  const scored = criteria.filter(isScorable)
  if (scored.length === 0 || itemIds.length === 0) return null
  const total = scored.reduce((sum, c) => sum + (c.weight ?? 0), 0)
  const sums: Record<string, number> = Object.fromEntries(
    itemIds.map((id) => [id, 0]),
  )
  for (const c of scored) {
    const row = normalizeRow(c, itemIds, values)
    if (!row) continue
    for (const id of itemIds) sums[id] += (c.weight ?? 0) * row[id]
  }
  return {
    scores: Object.fromEntries(
      itemIds.map((id) => [id, Math.round((100 * sums[id]) / total)]),
    ),
    criteria: scored.map((c) => c.id),
  }
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatNumber(
  n: number,
  locale: string = DEFAULT_LOCALE,
): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n)
}

export function formatMoney(
  amount: number,
  currency: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        // Whole amounts without cents: "$1,440", not "$1,440.00".
        ...(Number.isInteger(amount) ? { maximumFractionDigits: 0 } : {}),
      }).format(amount)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  return formatNumber(amount, locale)
}

/** Units that attach without a space: "98%", "21°". */
const tightUnit = (unit: string) => /^(%|°|″|"|x|×)/.test(unit)

export function withUnit(text: string, unit?: string): string {
  if (!unit) return text
  return tightUnit(unit) ? `${text}${unit}` : `${text} ${unit}`
}

/**
 * Display text for a cell. Unknown is "—"; booleans "Yes"/"No"; ratings
 * "4.5 / 5"; currency with the criterion's (or fallback) currency.
 */
export function formatValue(
  value: CompareValue | undefined,
  c: Pick<CriterionLike, "type" | "unit" | "currency" | "outOf">,
  fallbackCurrency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!isKnown(value)) return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  const n = toNumber(value)
  if (n === null) return String(value)
  switch (c.type) {
    case "currency":
      return withUnit(
        formatMoney(n, c.currency ?? fallbackCurrency, locale),
        c.unit,
      )
    case "rating":
      return `${formatNumber(n, locale)} / ${formatNumber(c.outOf ?? 5, locale)}`
    case "number":
      return withUnit(formatNumber(n, locale), c.unit)
    default:
      return typeof value === "number"
        ? withUnit(formatNumber(n, locale), c.unit)
        : value
  }
}

/** Like formatValue, but unknown reads "not known" (for screen readers). */
export function spokenValue(
  value: CompareValue | undefined,
  c: Pick<CriterionLike, "type" | "unit" | "currency" | "outOf">,
  fallbackCurrency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!isKnown(value)) return "not known"
  if (c.type === "rating") {
    const n = toNumber(value)
    if (n !== null) {
      return `${formatNumber(n, locale)} out of ${formatNumber(c.outOf ?? 5, locale)}`
    }
  }
  return formatValue(value, c, fallbackCurrency, locale)
}

/** Rating as a 0–1 fraction of its scale, for the small bar. */
export function ratingFraction(
  value: CompareValue | undefined,
  outOf = 5,
): number | null {
  const n = toNumber(value)
  if (n === null || outOf <= 0) return null
  return Math.min(1, Math.max(0, n / outOf))
}

/** "$29 / user / month"; null until the amount has arrived. */
export function formatPrice(
  price: PriceLike | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!price || typeof price.amount !== "number") return null
  const money = formatMoney(price.amount, price.currency, locale)
  return price.period ? `${money} / ${price.period}` : money
}

/** The first price currency among the items, for currency rows without one. */
export function commonCurrency(
  items: { price?: PriceLike }[],
): string | undefined {
  return items.find((i) => i.price?.currency)?.price?.currency
}

/** Only http(s) links from agent data; anything else is dropped. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}
