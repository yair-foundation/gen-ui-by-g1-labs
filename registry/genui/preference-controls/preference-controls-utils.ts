/**
 * Preference Controls: pure helpers for values, diffs, presets, formatting
 * and batching. No React, no Zod, so they run anywhere (and in Node tests).
 *
 * Every helper takes a control (or a list of controls) and plain values and
 * returns new values; nothing is mutated.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type SliderFormat = "currency" | "number" | "percent"

export type SliderControl = {
  type: "slider"
  id: string
  label: string
  min: number
  max: number
  step: number
  value: number
  unit?: string
  format?: SliderFormat
  currency?: string
  minLabel?: string
  maxLabel?: string
}

export type SegmentedControl = {
  type: "segmented"
  id: string
  label: string
  options: { value: string; label: string }[]
  value: string
}

export type PrioritiesControl = {
  type: "priorities"
  id: string
  label: string
  items: { id: string; label: string }[]
}

export type ToggleControl = {
  type: "toggle"
  id: string
  label: string
  value: boolean
  help?: string
}

export type ChipsControl = {
  type: "chips"
  id: string
  label: string
  options: string[]
  value: string[]
  max?: number
}

export type DateRangeControl = {
  type: "date-range"
  id: string
  label: string
  start: string
  end: string
  min?: string
  max?: string
}

export type Control =
  | SliderControl
  | SegmentedControl
  | PrioritiesControl
  | ToggleControl
  | ChipsControl
  | DateRangeControl

export type DateRange = { start: string; end: string }

/**
 * One control's value: a number (slider), an option value (segmented), item
 * ids most important first (priorities), a boolean (toggle), the selected
 * options (chips) or a date range.
 */
export type ControlValue = number | string | boolean | string[] | DateRange

export type Values = Record<string, ControlValue>

export type Preset = { id: string; label: string; values: Values }

export type UpdateRequest = {
  action: "update"
  values: Values
  changed: string[]
}

// ---- Validation ----

const isStr = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)
const isStrArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every(isStr)

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD form. */
export function isIsoDate(v: unknown): v is string {
  if (!isStr(v) || !ISO_DATE.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

/** True once a streamed control has every field it needs to render. */
export function isControlReady(c: unknown): c is Control {
  if (!c || typeof c !== "object") return false
  const o = c as Record<string, unknown>
  if (!isStr(o.id) || !isStr(o.label)) return false
  switch (o.type) {
    case "slider":
      return (
        isNum(o.min) &&
        isNum(o.max) &&
        isNum(o.step) &&
        isNum(o.value) &&
        o.max > o.min &&
        o.step > 0
      )
    case "segmented":
      return (
        Array.isArray(o.options) &&
        o.options.length >= 2 &&
        o.options.every(
          (x) => x && typeof x === "object" && isStr(x.value) && isStr(x.label),
        ) &&
        isStr(o.value)
      )
    case "priorities":
      return (
        Array.isArray(o.items) &&
        o.items.length >= 2 &&
        o.items.every(
          (x) => x && typeof x === "object" && isStr(x.id) && isStr(x.label),
        )
      )
    case "toggle":
      return typeof o.value === "boolean"
    case "chips":
      return (
        isStrArray(o.options) && o.options.length > 0 && isStrArray(o.value)
      )
    case "date-range":
      return isIsoDate(o.start) && isIsoDate(o.end)
    default:
      return false
  }
}

/** Rounds to the slider's step grid and clamps to its range. */
export function snapToStep(c: SliderControl, v: number): number {
  const steps = Math.round((v - c.min) / c.step)
  const decimals = Math.max(
    (String(c.step).split(".")[1] ?? "").length,
    (String(c.min).split(".")[1] ?? "").length,
  )
  const snapped = Number((c.min + steps * c.step).toFixed(decimals))
  return Math.min(c.max, Math.max(c.min, snapped))
}

const unique = <T>(xs: T[]) => [...new Set(xs)]

/**
 * Validates a value for a control (from a preset, a stored result or user
 * input). Returns the normalised value, or undefined when it doesn't fit.
 */
export function coerceValue(c: Control, v: unknown): ControlValue | undefined {
  switch (c.type) {
    case "slider":
      return isNum(v) ? snapToStep(c, v) : undefined
    case "segmented":
      return isStr(v) && c.options.some((o) => o.value === v) ? v : undefined
    case "toggle":
      return typeof v === "boolean" ? v : undefined
    case "priorities": {
      if (!isStrArray(v)) return undefined
      const ids = c.items.map((i) => i.id)
      // Known ids in the given order, then any missing ones in their original order.
      const known = unique(v.filter((id) => ids.includes(id)))
      if (known.length === 0) return undefined
      return [...known, ...ids.filter((id) => !known.includes(id))]
    }
    case "chips": {
      if (!isStrArray(v)) return undefined
      const picked = unique(v.filter((x) => c.options.includes(x)))
      return c.max !== undefined ? picked.slice(0, Math.max(0, c.max)) : picked
    }
    case "date-range": {
      if (!v || typeof v !== "object") return undefined
      const r = v as Record<string, unknown>
      if (!isIsoDate(r.start) || !isIsoDate(r.end)) return undefined
      return r.start <= r.end
        ? { start: r.start, end: r.end }
        : { start: r.end, end: r.start }
    }
  }
}

/** The value a control arrives with, normalised so it always fits. */
export function initialValueOf(c: Control): ControlValue {
  switch (c.type) {
    case "slider":
      return snapToStep(c, c.value)
    case "segmented":
      return c.options.some((o) => o.value === c.value)
        ? c.value
        : (c.options[0]?.value ?? c.value)
    case "toggle":
      return c.value
    case "priorities":
      return unique(c.items.map((i) => i.id))
    case "chips":
      return coerceValue(c, c.value) ?? []
    case "date-range":
      return (
        coerceValue(c, { start: c.start, end: c.end }) ?? {
          start: c.start,
          end: c.end,
        }
      )
  }
}

export function initialValues(controls: Control[]): Values {
  return Object.fromEntries(controls.map((c) => [c.id, initialValueOf(c)]))
}

// ---- Equality and diff ----

/**
 * Compares two values of the same control. Priorities compare by order;
 * chips compare as a set (selection order doesn't matter).
 */
export function valueEquals(
  c: Control,
  a: ControlValue | undefined,
  b: ControlValue | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b
  switch (c.type) {
    case "priorities":
      return (
        isStrArray(a) &&
        isStrArray(b) &&
        a.length === b.length &&
        a.every((x, i) => x === b[i])
      )
    case "chips": {
      if (!isStrArray(a) || !isStrArray(b)) return false
      const sa = new Set(a)
      const sb = new Set(b)
      return sa.size === sb.size && [...sa].every((x) => sb.has(x))
    }
    case "date-range": {
      const ra = a as DateRange
      const rb = b as DateRange
      return ra.start === rb.start && ra.end === rb.end
    }
    default:
      return a === b
  }
}

/** Ids of the controls whose value differs between `base` and `next`, in control order. */
export function diffValues(
  controls: Control[],
  base: Values,
  next: Values,
): string[] {
  return controls
    .filter((c) => !valueEquals(c, base[c.id], next[c.id]))
    .map((c) => c.id)
}

export function valuesEqual(controls: Control[], a: Values, b: Values) {
  return diffValues(controls, a, b).length === 0
}

// ---- Presets ----

/**
 * Applies a preset on top of the current values. Unknown control ids and
 * values that don't fit a control are ignored.
 */
export function applyPreset(
  controls: Control[],
  current: Values,
  preset: Pick<Preset, "values">,
): Values {
  const next = { ...current }
  for (const c of controls) {
    if (!(c.id in preset.values)) continue
    const v = coerceValue(c, preset.values[c.id])
    if (v !== undefined) next[c.id] = v
  }
  return next
}

/**
 * The first preset whose values all match the current values, or null
 * ("Custom"). A preset that sets none of the controls never matches.
 */
export function matchPreset<P extends Pick<Preset, "values">>(
  controls: Control[],
  current: Values,
  presets: P[],
): P | null {
  for (const p of presets) {
    const relevant = controls.filter((c) => c.id in p.values)
    if (relevant.length === 0) continue
    const matches = relevant.every((c) => {
      const v = coerceValue(c, p.values[c.id])
      return v !== undefined && valueEquals(c, v, current[c.id])
    })
    if (matches) return p
  }
  return null
}

// ---- Formatting ----

function numberFormat(c: SliderControl, locale: string): Intl.NumberFormat {
  const decimals = (String(c.step).split(".")[1] ?? "").length
  const digits = { minimumFractionDigits: 0, maximumFractionDigits: decimals }
  if (c.format === "currency") {
    // Whole steps read "€650"; fractional steps show cents ("$8.50").
    const cents = decimals > 0 ? Math.max(2, decimals) : 0
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: c.currency ?? "USD",
        minimumFractionDigits: cents,
        maximumFractionDigits: cents,
      })
    } catch {
      // Invalid currency code: fall through to a plain number.
    }
  }
  return new Intl.NumberFormat(locale, digits)
}

/** "€650", "40%", "30 min", "3 activities a day". */
export function formatSlider(
  c: SliderControl,
  v: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = numberFormat(c, locale).format(v)
  if (c.format === "percent") return `${n}%`
  if (c.unit && c.format !== "currency") return `${n} ${c.unit}`
  return n
}

/** The slider's spoken value: the number, plus the end label at either end. */
export function sliderValueText(
  c: SliderControl,
  v: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const text = formatSlider(c, v, locale)
  if (v <= c.min && c.minLabel) return `${text}, ${c.minLabel}`
  if (v >= c.max && c.maxLabel) return `${text}, ${c.maxLabel}`
  return text
}

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`)

/** "Oct 12 – 18, 2026" style; the year is shown only when it isn't `currentYear`. */
export function formatDateRange(
  r: DateRange,
  locale: string = DEFAULT_LOCALE,
  currentYear?: number,
): string {
  if (!isIsoDate(r.start) || !isIsoDate(r.end)) return `${r.start} – ${r.end}`
  const a = utc(r.start)
  const b = utc(r.end)
  const sameYear =
    currentYear !== undefined &&
    a.getUTCFullYear() === currentYear &&
    b.getUTCFullYear() === currentYear
  const fmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  })
  if (r.start === r.end) return fmt.format(a)
  return typeof fmt.formatRange === "function"
    ? fmt.formatRange(a, b)
    : `${fmt.format(a)} – ${fmt.format(b)}`
}

/** Inclusive number of days in a range (1 for a single day). */
export function rangeDays(r: DateRange): number {
  if (!isIsoDate(r.start) || !isIsoDate(r.end)) return 0
  return Math.round((utc(r.end).getTime() - utc(r.start).getTime()) / 864e5) + 1
}

export type FormatOptions = { locale?: string; currentYear?: number }

/** A control's value as plain text, e.g. "€650", "Casual", "On", "Food, Views". */
export function formatValue(
  c: Control,
  v: ControlValue | undefined,
  opts: FormatOptions = {},
): string {
  const { locale = DEFAULT_LOCALE, currentYear } = opts
  if (v === undefined) return ""
  switch (c.type) {
    case "slider":
      return isNum(v) ? formatSlider(c, v, locale) : ""
    case "segmented":
      return c.options.find((o) => o.value === v)?.label ?? String(v)
    case "toggle":
      return v ? "On" : "Off"
    case "priorities":
      return isStrArray(v)
        ? v
            .map((id) => c.items.find((i) => i.id === id)?.label ?? id)
            .join(", ")
        : ""
    case "chips":
      return isStrArray(v) ? (v.length ? v.join(", ") : "None") : ""
    case "date-range":
      return formatDateRange(v as DateRange, locale, currentYear)
  }
}

/** One change as text: "Budget: €900 → €650", "Must-haves: added Vegetarian". */
export function describeChange(
  c: Control,
  from: ControlValue | undefined,
  to: ControlValue | undefined,
  opts: FormatOptions = {},
): string {
  if (c.type === "chips" && isStrArray(from) && isStrArray(to)) {
    const added = to.filter((x) => !from.includes(x))
    const removed = from.filter((x) => !to.includes(x))
    const parts = [
      added.length ? `added ${added.join(", ")}` : "",
      removed.length ? `removed ${removed.join(", ")}` : "",
    ].filter(Boolean)
    return `${c.label}: ${parts.join("; ")}`
  }
  if (c.type === "priorities") {
    return `${c.label}: ${formatValue(c, to, opts)}`
  }
  return `${c.label}: ${formatValue(c, from, opts)} → ${formatValue(c, to, opts)}`
}

/** All changes from `base` to `next`, joined with " · ". Empty when nothing changed. */
export function summarizeChanges(
  controls: Control[],
  base: Values,
  next: Values,
  opts: FormatOptions = {},
): string {
  return diffValues(controls, base, next)
    .map((id) => {
      const c = controls.find((x) => x.id === id) as Control
      return describeChange(c, base[id], next[id], opts)
    })
    .join(" · ")
}

// ---- Edits ----

/** Moves an item within a list. Indexes are clamped; returns a new array. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from < 0 || from >= list.length) return list.slice()
  const target = Math.max(0, Math.min(list.length - 1, to))
  const next = list.slice()
  const [item] = next.splice(from, 1)
  next.splice(target, 0, item)
  return next
}

/** Toggles a chip, respecting `max`: at the limit, new chips aren't added. */
export function toggleChip(c: ChipsControl, current: string[], option: string) {
  if (current.includes(option)) return current.filter((x) => x !== option)
  if (c.max !== undefined && current.length >= c.max) return current
  return [...current, option]
}

/** Sets one end of a range; the other end follows if they would cross. */
export function setRangeEnd(
  r: DateRange,
  edge: "start" | "end",
  value: string,
): DateRange {
  if (!isIsoDate(value)) return r
  if (edge === "start") {
    return { start: value, end: value > r.end ? value : r.end }
  }
  return { start: value < r.start ? value : r.start, end: value }
}

// ---- Batching ----

/**
 * Records one edit in a batch of pending edits (keyed by control id). An edit
 * that brings a control back to its baseline value leaves the batch, so the
 * batch is always exactly the set of controls that differ.
 */
export function batchEdit(
  batch: Values,
  c: Control,
  value: ControlValue,
  baseline: ControlValue | undefined,
): Values {
  const next = { ...batch }
  if (valueEquals(c, value, baseline)) delete next[c.id]
  else next[c.id] = value
  return next
}

/** Current values: the baseline with the pending edits on top. */
export function currentValues(
  controls: Control[],
  baseline: Values,
  edits: Values,
): Values {
  return Object.fromEntries(
    controls.map((c) => [c.id, edits[c.id] ?? baseline[c.id]]),
  )
}

/**
 * When new props arrive (the agent regenerated), keep only the edits the user
 * made after the last send that still differ from the new baseline, so an
 * in-progress drag isn't thrown away.
 */
export function rebaseEdits(
  controls: Control[],
  edits: Values,
  nextBaseline: Values,
  lastSent: Values | null,
): Values {
  const kept: Values = {}
  for (const c of controls) {
    const v = edits[c.id]
    if (v === undefined) continue
    if (lastSent && valueEquals(c, v, lastSent[c.id])) continue
    if (valueEquals(c, v, nextBaseline[c.id])) continue
    kept[c.id] = v
  }
  return kept
}

/** The update to send for the current values, or null when nothing changed. */
export function buildUpdate(
  controls: Control[],
  baseline: Values,
  current: Values,
): UpdateRequest | null {
  const changed = diffValues(controls, baseline, current)
  if (changed.length === 0) return null
  return { action: "update", values: { ...current }, changed }
}

/**
 * What a send should do now. 'update' when the values differ from both the
 * baseline and what was last sent; 'reset' when the user came back to the
 * baseline after sending something else; null when there is nothing new.
 */
export function nextSend(
  controls: Control[],
  baseline: Values,
  current: Values,
  lastSent: Values | null,
): "update" | "reset" | null {
  if (lastSent && valuesEqual(controls, current, lastSent)) return null
  const changed = diffValues(controls, baseline, current).length > 0
  if (changed) return "update"
  return lastSent ? "reset" : null
}

// ---- Labels ----

const DETERMINERS = new Set(["your", "the", "this", "my", "our", "a", "an"])
const PREPOSITIONS = new Set([
  "for",
  "in",
  "on",
  "to",
  "from",
  "with",
  "of",
  "about",
  "at",
])

/**
 * A short noun for the Update button, from `appliesTo`:
 * "your 5-day Lisbon itinerary" → "itinerary", "your meal plan for next week"
 * → "meal plan", nothing → "answer".
 */
export function shortLabel(appliesTo?: string): string {
  if (!appliesTo) return "answer"
  const words = appliesTo.trim().split(/\s+/).filter(Boolean)
  const cut = words.findIndex(
    (w, i) => i > 0 && PREPOSITIONS.has(w.toLowerCase()),
  )
  const head = (cut === -1 ? words : words.slice(0, cut)).filter(
    (w) => !DETERMINERS.has(w.toLowerCase()),
  )
  if (head.length === 0) return "answer"
  const last = head[head.length - 1].replace(/[.,;:!?]+$/, "")
  const prev = head[head.length - 2]
  // Keep a plain lowercase modifier ("meal plan"), drop names and numbers.
  const label =
    prev && /^[a-z]+$/.test(prev) ? `${prev} ${last.toLowerCase()}` : last
  const out = /^[A-Z][a-z]+$/.test(label) ? label.toLowerCase() : label
  return out.length > 24 || !/[a-z]/i.test(out) ? "answer" : out
}
