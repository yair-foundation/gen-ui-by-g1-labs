/**
 * Search Results: pure helpers for local faceted search. No React, so they
 * can be unit-tested on their own.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type {
  FacetValue,
  SearchFacet,
  SearchFilters,
} from "./search-results.schema"

export type RangeFilter = { min?: number; max?: number }

/** The user's local filters, keyed by facet id. Inactive entries are allowed. */
export type FilterState = Record<string, string[] | RangeFilter | boolean>

export type FacetDef = Pick<SearchFacet, "id" | "label" | "type"> &
  Partial<Pick<SearchFacet, "unit" | "format" | "currency">>

/** Anything with facet values (results may be partial while streaming). */
export type Faceted = { facets?: Record<string, FacetValue | undefined> }

export type FacetOption = { value: string; label: string; count: number }

export type FilterChip = {
  key: string
  facetId: string
  /** The checkbox value this chip removes; absent for ranges and toggles. */
  value?: string
  label: string
}

export type Highlight = { text: string; match: boolean }

// ---------------------------------------------------------------------------
// Values

/** Checkbox option keys for a raw value: arrays spread, booleans as "true"/"false". */
export function optionKeys(value: FacetValue | undefined | null): string[] {
  if (value === undefined || value === null) return []
  if (Array.isArray(value)) {
    return value.filter((s) => typeof s === "string" && s !== "")
  }
  if (typeof value === "boolean") return [value ? "true" : "false"]
  if (typeof value === "number") {
    return Number.isFinite(value) ? [String(value)] : []
  }
  return value === "" ? [] : [value]
}

export function optionLabel(key: string): string {
  if (key === "true") return "Yes"
  if (key === "false") return "No"
  return key
}

/** A finite number from a number or a numeric string; otherwise null. */
export function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function isRange(value: unknown): value is RangeFilter {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ---------------------------------------------------------------------------
// Filtering

export function isFilterActive(
  facet: Pick<FacetDef, "type">,
  filter: FilterState[string] | undefined,
): boolean {
  switch (facet.type) {
    case "checkbox":
      return Array.isArray(filter) && filter.length > 0
    case "range":
      return (
        isRange(filter) &&
        (filter.min !== undefined || filter.max !== undefined)
      )
    case "toggle":
      return filter === true
    default:
      return false
  }
}

export function matchesFacet(
  item: Faceted,
  facet: Pick<FacetDef, "id" | "type">,
  filter: FilterState[string] | undefined,
): boolean {
  if (!isFilterActive(facet, filter)) return true
  const value = item.facets?.[facet.id]
  if (facet.type === "checkbox" && Array.isArray(filter)) {
    const keys = optionKeys(value)
    return filter.some((k) => keys.includes(k))
  }
  if (facet.type === "range" && isRange(filter)) {
    const n = numericValue(value)
    if (n === null) return false
    return (
      (filter.min === undefined || n >= filter.min) &&
      (filter.max === undefined || n <= filter.max)
    )
  }
  return value === true
}

/**
 * Results matching every active filter. `exceptId` leaves one facet out, which
 * is how a facet's own option counts are computed (like real faceted search:
 * picking "2 bedrooms" doesn't zero the count for "3 bedrooms").
 */
export function filterResults<T extends Faceted>(
  items: T[],
  facets: FacetDef[],
  filters: FilterState,
  exceptId?: string,
): T[] {
  const active = facets.filter(
    (f) => f.id !== exceptId && isFilterActive(f, filters[f.id]),
  )
  if (active.length === 0) return items
  return items.filter((item) =>
    active.every((f) => matchesFacet(item, f, filters[f.id])),
  )
}

/**
 * Options for a checkbox facet: every value found in the results (plus any
 * picked value), with the count each would match given the other filters.
 * Numbers sort numerically, text naturally, so options don't jump around.
 */
export function facetOptions(
  items: Faceted[],
  facet: FacetDef,
  facets: FacetDef[],
  filters: FilterState,
  locale: string = DEFAULT_LOCALE,
): FacetOption[] {
  const keys = new Set<string>()
  for (const item of items) {
    for (const k of optionKeys(item.facets?.[facet.id])) keys.add(k)
  }
  const picked = filters[facet.id]
  if (Array.isArray(picked)) for (const k of picked) keys.add(k)

  const counts = new Map<string, number>()
  for (const item of filterResults(items, facets, filters, facet.id)) {
    for (const k of new Set(optionKeys(item.facets?.[facet.id]))) {
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }

  const list = [...keys]
  const numeric = list.length > 0 && list.every((k) => numericValue(k) !== null)
  list.sort((a, b) =>
    numeric
      ? Number(a) - Number(b)
      : a.localeCompare(b, locale, { numeric: true, sensitivity: "base" }),
  )
  return list.map((k) => ({
    value: k,
    label: optionLabel(k),
    count: counts.get(k) ?? 0,
  }))
}

/** How many results a toggle facet would leave, given the other filters. */
export function toggleCount(
  items: Faceted[],
  facet: FacetDef,
  facets: FacetDef[],
  filters: FilterState,
): number {
  return filterResults(items, facets, filters, facet.id).filter(
    (item) => item.facets?.[facet.id] === true,
  ).length
}

/** Min and max of a range facet over all results; null when there's no spread. */
export function rangeBounds(
  items: Faceted[],
  facetId: string,
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const item of items) {
    const n = numericValue(item.facets?.[facetId])
    if (n === null) continue
    if (n < min) min = n
    if (n > max) max = n
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
    return null
  }
  return { min, max }
}

/** A round slider step: about 1/100 of the span, 1 at least for whole numbers. */
export function rangeStep(min: number, max: number, integer = true): number {
  const raw = (max - min) / 100
  if (!(raw > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(raw))
  const n = raw / pow
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10
  const step = nice * pow
  return integer ? Math.max(1, Math.round(step)) : step
}

/** The slider position for a range filter: open edges sit at the bounds. */
export function effectiveRange(
  filter: FilterState[string] | undefined,
  bounds: { min: number; max: number },
): [number, number] {
  const r = isRange(filter) ? filter : {}
  const clamp = (n: number) => Math.min(bounds.max, Math.max(bounds.min, n))
  return [clamp(r.min ?? bounds.min), clamp(r.max ?? bounds.max)]
}

/**
 * A slider position as a filter. An edge at its bound (within `tolerance`,
 * e.g. half a step) stays open, so it keeps covering results loaded later.
 */
export function toRangeFilter(
  [lo, hi]: [number, number],
  bounds: { min: number; max: number },
  tolerance = 0,
): RangeFilter {
  const out: RangeFilter = {}
  if (lo > bounds.min + tolerance) out.min = lo
  if (hi < bounds.max - tolerance) out.max = hi
  return out
}

// ---------------------------------------------------------------------------
// Sorting

function sortValue(value: FacetValue | undefined): number | string | null {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value[0] ?? null
  if (typeof value === "boolean") return value ? 1 : 0
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  return value === "" ? null : value
}

/**
 * Sorted copy. 'relevance' (or no sort) keeps the order the agent sent.
 * Missing values go last; ties keep their original order.
 */
export function sortResults<T extends Faceted>(
  items: T[],
  sort?: { key?: string; direction?: "asc" | "desc" },
  locale: string = DEFAULT_LOCALE,
): T[] {
  const key = sort?.key
  if (!key || key === "relevance") return items
  const dir = sort.direction === "desc" ? -1 : 1
  return items
    .map((item, index) => ({ item, index }))
    .sort((x, y) => {
      const a = sortValue(x.item.facets?.[key])
      const b = sortValue(y.item.facets?.[key])
      if (a === null || b === null) {
        if (a === b) return x.index - y.index
        return a === null ? 1 : -1
      }
      const c =
        typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b), locale, { numeric: true })
      return c === 0 ? x.index - y.index : dir * c
    })
    .map((x) => x.item)
}

// ---------------------------------------------------------------------------
// Snippets

/**
 * Splits a snippet on **double asterisks** into plain and matched parts.
 * An unclosed marker (e.g. mid-stream) is dropped rather than shown.
 */
export function parseHighlights(input: string): Highlight[] {
  const out: Highlight[] = []
  const push = (text: string, match: boolean) => {
    if (!text) return
    const last = out.at(-1)
    if (last && last.match === match) last.text += text
    else out.push({ text, match })
  }
  let plain = ""
  let i = 0
  while (i < input.length) {
    if (input.startsWith("**", i)) {
      const end = input.indexOf("**", i + 2)
      if (end === -1) {
        plain += input.slice(i + 2)
        break
      }
      push(plain, false)
      plain = ""
      push(input.slice(i + 2, end), true)
      i = end + 2
      continue
    }
    plain += input[i]
    i++
  }
  push(plain, false)
  return out
}

// ---------------------------------------------------------------------------
// Text

const count = (n: number, locale: string) =>
  new Intl.NumberFormat(locale).format(n)

/** "Showing 12 of 46" when the source has more; otherwise "12 results". */
export function countText(
  shown: number,
  total?: number,
  locale: string = DEFAULT_LOCALE,
): string {
  if (typeof total === "number" && total > shown) {
    return `Showing ${count(shown, locale)} of ${count(total, locale)}`
  }
  return `${count(shown, locale)} ${shown === 1 ? "result" : "results"}`
}

/** "5 match your filters". */
export function matchText(
  matching: number,
  locale: string = DEFAULT_LOCALE,
): string {
  if (matching === 0) return "None match your filters"
  return `${count(matching, locale)} ${matching === 1 ? "matches" : "match"} your filters`
}

/** A range facet number with its currency or unit. */
export function formatFacetNumber(
  n: number,
  facet: Partial<FacetDef>,
  locale: string = DEFAULT_LOCALE,
): string {
  let text = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(n)
  if (facet.format === "currency" && facet.currency) {
    try {
      text = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: facet.currency,
        maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
      }).format(n)
    } catch {
      // Invalid currency code: keep the plain number.
    }
  }
  return facet.unit ? `${text} ${facet.unit}` : text
}

/** "€900 – €1,400", "From €900" or "Up to €1,400". */
export function rangeText(
  filter: RangeFilter,
  facet: Partial<FacetDef>,
  locale: string = DEFAULT_LOCALE,
) {
  const lo =
    filter.min !== undefined && formatFacetNumber(filter.min, facet, locale)
  const hi =
    filter.max !== undefined && formatFacetNumber(filter.max, facet, locale)
  if (lo && hi) return `${lo} – ${hi}`
  if (lo) return `From ${lo}`
  if (hi) return `Up to ${hi}`
  return "Any"
}

// ---------------------------------------------------------------------------
// Active filters

export function activeFilterCount(
  facets: FacetDef[],
  filters: FilterState,
): number {
  return facets.filter((f) => isFilterActive(f, filters[f.id])).length
}

/** One removable chip per picked value, range and toggle. */
export function filterChips(
  facets: FacetDef[],
  filters: FilterState,
  locale: string = DEFAULT_LOCALE,
): FilterChip[] {
  const chips: FilterChip[] = []
  for (const f of facets) {
    const v = filters[f.id]
    if (!isFilterActive(f, v)) continue
    if (f.type === "checkbox" && Array.isArray(v)) {
      for (const value of v) {
        chips.push({
          key: `${f.id}:${value}`,
          facetId: f.id,
          value,
          label: `${f.label}: ${optionLabel(value)}`,
        })
      }
    } else if (f.type === "range" && isRange(v)) {
      chips.push({
        key: f.id,
        facetId: f.id,
        label: `${f.label}: ${rangeText(v, f, locale)}`,
      })
    } else {
      chips.push({ key: f.id, facetId: f.id, label: f.label })
    }
  }
  return chips
}

export function removeChip(filters: FilterState, chip: FilterChip) {
  const next = { ...filters }
  const current = next[chip.facetId]
  if (chip.value !== undefined && Array.isArray(current)) {
    const rest = current.filter((v) => v !== chip.value)
    if (rest.length) next[chip.facetId] = rest
    else delete next[chip.facetId]
  } else {
    delete next[chip.facetId]
  }
  return next
}

/** The active filters, as sent to the agent with 'search' and 'load-more'. */
export function toSearchFilters(
  facets: FacetDef[],
  filters: FilterState,
): SearchFilters {
  const out: SearchFilters = {}
  for (const f of facets) {
    const v = filters[f.id]
    if (!isFilterActive(f, v)) continue
    if (f.type === "checkbox" && Array.isArray(v)) out[f.id] = [...v]
    else if (f.type === "range" && isRange(v)) {
      const r: RangeFilter = {}
      if (v.min !== undefined) r.min = v.min
      if (v.max !== undefined) r.max = v.max
      out[f.id] = r
    } else out[f.id] = true
  }
  return out
}
