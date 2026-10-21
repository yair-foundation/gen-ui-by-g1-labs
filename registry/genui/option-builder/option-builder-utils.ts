/**
 * Option Builder: pure helpers (no React; the only import is the default
 * locale), so they can be unit tested and reused by the host.
 *
 * - Aggregates: each metric combines the selected options' values with its
 *   `aggregate` (sum, max, min, avg). Options without a value for a metric
 *   don't take part. An empty selection sums to 0; max/min/avg have no value.
 * - Budgets: with better "lower" the budget is a ceiling (over when the total
 *   is above it); with better "higher" it is a floor (short when below it).
 * - Score ("budget" formula): every budgeted metric with a value scores
 *   100 at or under half its budget, falls linearly to 70 at the budget and to
 *   0 at twice the budget (for "higher", the ratio is inverted: budget/total).
 *   The score is the rounded average. Grades: A ≥ 90, B ≥ 80, C ≥ 70, D ≥ 60,
 *   F below. So "exactly on budget" is a C, and anything over drops fast.
 * - Dependencies: `requires` is followed transitively (cycles are safe);
 *   `excludes` works both ways.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type MetricFormat = "number" | "currency" | "bytes" | "duration-ms"
export type Aggregate = "sum" | "max" | "min" | "avg"
export type Grade = "A" | "B" | "C" | "D" | "F"

export type MetricLike = {
  id: string
  label: string
  unit?: string
  format?: MetricFormat
  currency?: string
  aggregate?: Aggregate
  budget?: number
  better?: "lower" | "higher"
}

export type OptionLike = {
  id: string
  name: string
  groupId: string
  metrics?: Partial<Record<string, number>>
  requires?: string[]
  excludes?: string[]
  /** The reason it can't be chosen. */
  disabled?: string
}

export type GroupLike = {
  id: string
  label: string
  min?: number
  max?: number
}

export type SelectionModel = {
  options: OptionLike[]
  groups: GroupLike[]
  /** Most options in the whole selection (dependencies included). */
  max?: number
}

export type Totals = Record<string, number | null>

// ---- Aggregation ----------------------------------------------------------

/** Rounds away float noise (0.1 + 0.2), keeping 6 decimals. */
function clean(n: number) {
  return Math.round(n * 1e6) / 1e6
}

export function aggregate(values: number[], kind: Aggregate = "sum") {
  const finite = values.filter((v) => Number.isFinite(v))
  if (kind === "sum") return clean(finite.reduce((a, b) => a + b, 0))
  if (finite.length === 0) return null
  if (kind === "max") return Math.max(...finite)
  if (kind === "min") return Math.min(...finite)
  return clean(finite.reduce((a, b) => a + b, 0) / finite.length)
}

/** One total per metric over the selected option ids. */
export function computeTotals(
  metrics: MetricLike[],
  options: Pick<OptionLike, "id" | "metrics">[],
  selected: Iterable<string>,
): Totals {
  const ids = new Set(selected)
  const chosen = options.filter((o) => ids.has(o.id))
  return Object.fromEntries(
    metrics.map((m) => [
      m.id,
      aggregate(
        chosen
          .map((o) => o.metrics?.[m.id])
          .filter((v): v is number => typeof v === "number"),
        m.aggregate ?? "sum",
      ),
    ]),
  )
}

// ---- Budgets and score ----------------------------------------------------

export type BudgetState = {
  /** Over a ceiling, or short of a floor. */
  exceeded: boolean
  /** How far past the budget, always ≥ 0 (0 when within). */
  by: number
}

export function budgetState(
  metric: MetricLike,
  total: number | null,
): BudgetState | null {
  if (typeof metric.budget !== "number" || total === null) return null
  const higher = metric.better === "higher"
  const diff = clean(higher ? metric.budget - total : total - metric.budget)
  return { exceeded: diff > 0, by: Math.max(0, diff) }
}

/** 0–100 for one budgeted metric; null when it has no budget or value. */
export function metricScore(metric: MetricLike, total: number | null) {
  const budget = metric.budget
  if (typeof budget !== "number" || budget <= 0 || total === null) return null
  const ratio =
    metric.better === "higher"
      ? total <= 0
        ? Number.POSITIVE_INFINITY
        : budget / total
      : Math.max(0, total) / budget
  if (ratio <= 0.5) return 100
  if (ratio <= 1) return 100 - ((ratio - 0.5) / 0.5) * 30
  return Math.max(0, 70 - (ratio - 1) * 70)
}

export function gradeFor(score: number): Grade {
  if (score >= 90) return "A"
  if (score >= 80) return "B"
  if (score >= 70) return "C"
  if (score >= 60) return "D"
  return "F"
}

export function computeScore(
  metrics: MetricLike[],
  totals: Totals,
): { value: number; grade: Grade } | null {
  const scores = metrics
    .map((m) => metricScore(m, totals[m.id] ?? null))
    .filter((s): s is number => s !== null)
  if (scores.length === 0) return null
  const value = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  return { value, grade: gradeFor(value) }
}

// ---- Inline meters --------------------------------------------------------

/** The largest value any option has for a metric (0 when none). */
export function metricMax(
  options: Pick<OptionLike, "metrics">[],
  metricId: string,
) {
  let max = 0
  for (const o of options) {
    const v = o.metrics?.[metricId]
    if (typeof v === "number" && Number.isFinite(v) && v > max) max = v
  }
  return max
}

/** An option's value relative to the max, clamped to 0–1. */
export function meterRatio(value: number | undefined, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || max <= 0) return 0
  return Math.min(1, Math.max(0, value / max))
}

// ---- Requires / excludes --------------------------------------------------

function byId(model: SelectionModel) {
  return new Map(model.options.map((o) => [o.id, o]))
}

/** The ids plus everything they require, transitively. Unknown ids drop out. */
export function dependencyClosure(
  model: SelectionModel,
  ids: Iterable<string>,
): Set<string> {
  const map = byId(model)
  const out = new Set<string>()
  const queue = [...ids]
  while (queue.length) {
    const id = queue.shift() as string
    const option = map.get(id)
    if (!option || out.has(id)) continue
    out.add(id)
    for (const dep of option.requires ?? []) if (!out.has(dep)) queue.push(dep)
  }
  return out
}

export function conflicts(a: OptionLike, b: OptionLike) {
  return (
    a.id !== b.id &&
    ((a.excludes ?? []).includes(b.id) || (b.excludes ?? []).includes(a.id))
  )
}

/** Picked options that would be replaced when `id` is chosen (single-choice). */
function replacedBy(model: SelectionModel, picked: string[], id: string) {
  if (model.max === 1) return picked.filter((p) => p !== id)
  const map = byId(model)
  const option = map.get(id)
  const group = model.groups.find((g) => g.id === option?.groupId)
  if (group?.max !== 1) return []
  return picked.filter((p) => p !== id && map.get(p)?.groupId === group.id)
}

/** Removes ids and every picked option that (transitively) needs them. */
function withoutDependents(
  model: SelectionModel,
  picked: string[],
  removed: string[],
) {
  return picked.filter((p) => {
    if (removed.includes(p)) return false
    const needs = dependencyClosure(model, [p])
    return !removed.some((r) => needs.has(r))
  })
}

/**
 * Why `id` can't be selected right now, or null when it can. Assumes it isn't
 * selected yet.
 */
export function blockReason(
  model: SelectionModel,
  picked: string[],
  id: string,
): string | null {
  const map = byId(model)
  const option = map.get(id)
  if (!option) return "Unavailable"
  if (option.disabled) return option.disabled

  const base = withoutDependents(model, picked, replacedBy(model, picked, id))
  const current = dependencyClosure(model, base)
  const adds = [...dependencyClosure(model, [id])]
    .filter((x) => !current.has(x))
    .map((x) => map.get(x) as OptionLike)

  for (const m of adds) {
    if (m.id !== id && m.disabled)
      return `Needs ${m.name}, which is unavailable`
  }
  for (const m of adds) {
    for (const s of current) {
      const other = map.get(s) as OptionLike
      if (conflicts(m, other)) {
        return m.id === id
          ? `Can't combine with ${other.name}`
          : `Needs ${m.name}, which can't be combined with ${other.name}`
      }
    }
  }
  for (let i = 0; i < adds.length; i++) {
    for (let j = i + 1; j < adds.length; j++) {
      if (conflicts(adds[i], adds[j])) {
        return `Needs ${adds[i].name} and ${adds[j].name}, which can't be combined`
      }
    }
  }

  const next = [...current, ...adds.map((m) => m.id)]
  if (model.max !== undefined && model.max > 1 && next.length > model.max) {
    return `Limit of ${model.max} reached`
  }
  for (const g of model.groups) {
    if (g.max === undefined) continue
    const count = next.filter((x) => map.get(x)?.groupId === g.id).length
    if (count > g.max) {
      if (option.groupId === g.id) return `Up to ${g.max} in ${g.label}`
      const dep = adds.find((m) => m.groupId === g.id)
      return `Needs ${dep?.name ?? g.label}, but ${g.label} allows ${g.max}`
    }
  }
  return null
}

export type ToggleOutcome = {
  picked: string[]
  /** Ids that joined the selection besides the toggled one (dependencies). */
  added: string[]
  /** Ids that left the selection besides the toggled one. */
  removed: string[]
}

/**
 * Turns an option on (adding what it requires, replacing the previous pick in
 * a single-choice group) or off (dropping what depended on it). `picked` holds
 * the user's own choices; the selection is its dependency closure.
 */
export function toggleOption(
  model: SelectionModel,
  picked: string[],
  id: string,
  on: boolean,
): ToggleOutcome {
  const before = dependencyClosure(model, picked)
  let next: string[]
  if (on) {
    const base = withoutDependents(model, picked, replacedBy(model, picked, id))
    next = base.includes(id) ? base : [...base, id]
  } else {
    next = withoutDependents(model, picked, [id])
  }
  const after = dependencyClosure(model, next)
  return {
    picked: next,
    added: [...after].filter((x) => x !== id && !before.has(x)),
    removed: [...before].filter((x) => x !== id && !after.has(x)),
  }
}

/** Groups whose `min` isn't met yet. */
export function unmetGroups(
  model: SelectionModel,
  selected: Set<string>,
): GroupLike[] {
  const map = byId(model)
  return model.groups.filter((g) => {
    if (!g.min) return false
    let count = 0
    for (const id of selected) if (map.get(id)?.groupId === g.id) count++
    return count < g.min
  })
}

// ---- Formatting -----------------------------------------------------------

export type MetricParts = {
  /** The full string, e.g. "375.4 KB", "$1,450/mo". */
  text: string
  /** Text before the digits (sign, currency symbol). */
  prefix: string
  /** The absolute number shown, already scaled (375.4 for 384,410 bytes). */
  number: number
  decimals: number
  decimalSeparator: string
  groupSeparator: string
  /** Text after the digits, e.g. " KB", " ms", "/mo". */
  suffix: string
}

function unitSuffix(unit?: string) {
  if (!unit) return ""
  return /^[/%]/.test(unit) ? unit : ` ${unit}`
}

function decimalsFor(n: number, maxDecimals = 2) {
  for (let d = 0; d < maxDecimals; d++) {
    const f = 10 ** d
    if (Math.abs(Math.round(n * f) / f - n) < 1e-9) return d
  }
  return maxDecimals
}

function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6)
  return {
    decimalSeparator: parts.find((p) => p.type === "decimal")?.value ?? ".",
    groupSeparator: parts.find((p) => p.type === "group")?.value ?? ",",
  }
}

function currencyDigits(currency: string, locale: string) {
  try {
    return (
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
      }).resolvedOptions().maximumFractionDigits ?? 2
    )
  } catch {
    return 2
  }
}

/** Scales bytes to B / KB / MB / GB (1 KB = 1,024 bytes). */
export function scaleBytes(bytes: number): { value: number; unit: string } {
  const abs = Math.abs(bytes)
  const units = ["B", "KB", "MB", "GB", "TB"]
  let i = 0
  let v = abs
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return {
    value: i === 0 ? Math.round(v) : Math.round(v * 10) / 10,
    unit: units[i],
  }
}

/** A metric value split into parts, so the digits can animate. */
export function metricParts(
  value: number,
  metric: Pick<MetricLike, "format" | "unit" | "currency">,
  locale: string = DEFAULT_LOCALE,
): MetricParts {
  const sign = value < 0 ? "−" : ""
  const abs = Math.abs(value)
  const seps = separators(locale)
  const build = (
    number: number,
    decimals: number,
    prefix: string,
    suffix: string,
  ): MetricParts => {
    const digits = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(number)
    return {
      text: `${prefix}${digits}${suffix}`,
      prefix,
      number,
      decimals,
      suffix,
      ...seps,
    }
  }

  switch (metric.format) {
    case "bytes": {
      const { value: v, unit } = scaleBytes(abs)
      return build(v, decimalsFor(v, 1), sign, ` ${unit}`)
    }
    case "duration-ms": {
      if (abs >= 1000) {
        const s = Math.round(abs / 10) / 100
        return build(s, decimalsFor(s), sign, " s")
      }
      return build(Math.round(abs), 0, sign, " ms")
    }
    case "currency": {
      if (metric.currency) {
        try {
          const digits = currencyDigits(metric.currency, locale)
          const factor = 10 ** digits
          const rounded = Math.round(abs * factor) / factor
          const decimals = Number.isInteger(rounded) ? 0 : digits
          const parts = new Intl.NumberFormat(locale, {
            style: "currency",
            currency: metric.currency,
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
          }).formatToParts(rounded)
          const isNum = (t: string) =>
            t === "integer" ||
            t === "group" ||
            t === "decimal" ||
            t === "fraction"
          const first = parts.findIndex((p) => isNum(p.type))
          let last = first
          parts.forEach((p, i) => {
            if (isNum(p.type)) last = i
          })
          const join = (ps: Intl.NumberFormatPart[]) =>
            ps.map((p) => p.value).join("")
          return build(
            rounded,
            decimals,
            sign + join(parts.slice(0, first)),
            join(parts.slice(last + 1)) + unitSuffix(metric.unit),
          )
        } catch {
          // Invalid currency code: fall through to a plain number.
        }
      }
      const rounded = Math.round(abs * 100) / 100
      return build(
        rounded,
        decimalsFor(rounded),
        sign,
        unitSuffix(metric.unit ?? metric.currency),
      )
    }
    default: {
      const rounded = Math.round(abs * 100) / 100
      return build(rounded, decimalsFor(rounded), sign, unitSuffix(metric.unit))
    }
  }
}

export function formatMetric(
  value: number,
  metric: Pick<MetricLike, "format" | "unit" | "currency">,
  locale: string = DEFAULT_LOCALE,
) {
  return metricParts(value, metric, locale).text
}

/**
 * A spoken summary of the totals, e.g.
 * "Load time 381 ms, over budget by 81 ms. Size 375.4 KB. Score 88, grade B."
 */
export function describeTotals(
  metrics: MetricLike[],
  totals: Totals,
  score: { value: number; grade: Grade } | null,
  scoreLabel = "Score",
  locale: string = DEFAULT_LOCALE,
) {
  const lines = metrics.map((m) => {
    const total = totals[m.id] ?? null
    if (total === null) return `${m.label}: none`
    const state = budgetState(m, total)
    const value = formatMetric(total, m, locale)
    if (!state?.exceeded) return `${m.label} ${value}`
    const by = formatMetric(state.by, m, locale)
    return m.better === "higher"
      ? `${m.label} ${value}, short of the target by ${by}`
      : `${m.label} ${value}, over budget by ${by}`
  })
  if (score) lines.push(`${scoreLabel} ${score.value}, grade ${score.grade}`)
  return `${lines.join(". ")}.`
}

export function joinAnd(words: string[]) {
  if (words.length <= 1) return words.join("")
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}
