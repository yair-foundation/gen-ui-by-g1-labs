/**
 * Pure helpers for Quantity Scaler: scaling modes, rounding, unit switching
 * and the copied shopping list. No React, so they can be unit-tested alone.
 */

export type ScaleItem = {
  id: string
  name: string
  quantity: number
  unit?: string
  scale?: "linear" | "fixed" | "step"
  round?: number
}

/** A scaled amount ready to show: the number, its unit and decimals to print. */
export type Scaled = { quantity: number; unit: string; decimals: number }

export type UnitLabel = { singular: string; plural: string }

// Absorbs float noise such as 2.0000000000000004 before rounding.
const EPS = 1e-9

function decimalsOf(n: number) {
  const s = String(n)
  if (s.includes("e-")) return Number(s.split("e-")[1])
  return (s.split(".")[1] ?? "").length
}

/** Rounds to a multiple of `step`, to the nearest one or up. */
export function roundTo(x: number, step: number, dir: "nearest" | "up") {
  const n = x / step
  const k = dir === "up" ? Math.ceil(n - EPS) : Math.round(n + EPS)
  return Number((k * step).toFixed(decimalsOf(step)))
}

/** Small units that switch to the larger one at 1000. */
const LARGER: Record<string, string> = { g: "kg", ml: "l", mL: "L" }
const LARGE = new Set(["kg", "l", "L", "lb", "lbs"])

/** Steps for grams and millilitres: 25 normally, finer for small amounts. */
function smallStep(x: number) {
  if (x >= 100) return 25
  if (x >= 20) return 5
  return 1
}

/**
 * The amount for `value` people, given `item.quantity` for `base` people.
 * - fixed: never changes.
 * - step: rounds up to whole units.
 * - linear: rounds by unit (g/ml to 25, kg/l to 0.1, counts up to whole,
 *   other units up to the next half) unless `round` sets decimal places.
 *   Grams switch to kg (ml to l) at 1000 when `round` isn't set.
 * Anything above zero stays above zero.
 */
export function scaleItem(
  item: ScaleItem,
  value: number,
  base: number,
): Scaled {
  const unit = (item.unit ?? "").trim()
  const q = item.quantity
  if (!Number.isFinite(q) || q <= 0) return { quantity: 0, unit, decimals: 0 }

  const mode = item.scale ?? "linear"
  if (mode === "fixed") {
    const decimals = Math.min(
      3,
      item.round ??
        (LARGE.has(unit) ? Math.max(1, decimalsOf(q)) : decimalsOf(q)),
    )
    return { quantity: Number(q.toFixed(decimals)), unit, decimals }
  }

  const raw = base > 0 && value > 0 ? (q * value) / base : q

  if (mode === "step") {
    return { quantity: Math.max(1, Math.ceil(raw - EPS)), unit, decimals: 0 }
  }

  if (item.round !== undefined) {
    const decimals = Math.min(3, Math.max(0, Math.trunc(item.round)))
    const step = 10 ** -decimals
    const v = roundTo(raw, step, unit === "" ? "up" : "nearest")
    return { quantity: Math.max(v, step), unit, decimals }
  }

  const larger = LARGER[unit]
  if (larger) {
    const v = Math.max(roundTo(raw, smallStep(raw), "nearest"), 1)
    if (v >= 1000) {
      return {
        quantity: Math.max(roundTo(raw / 1000, 0.1, "nearest"), 0.1),
        unit: larger,
        decimals: 1,
      }
    }
    return { quantity: v, unit, decimals: 0 }
  }

  if (LARGE.has(unit)) {
    return {
      quantity: Math.max(roundTo(raw, 0.1, "nearest"), 0.1),
      unit,
      decimals: 1,
    }
  }

  if (unit === "") {
    return { quantity: Math.max(1, Math.ceil(raw - EPS)), unit, decimals: 0 }
  }

  const v = Math.max(roundTo(raw, 0.5, "up"), 0.5)
  return { quantity: v, unit, decimals: Number.isInteger(v) ? 0 : 1 }
}

/** "1.5 kg", "8", "2.5 tbsp". */
export function formatQuantity(s: Scaled): string {
  const n = s.quantity.toFixed(s.decimals)
  return s.unit ? `${n} ${s.unit}` : n
}

export function unitWord(n: number, label: UnitLabel): string {
  return n === 1 ? label.singular : label.plural
}

/** A whole count within [min, max]; max never falls below min. */
export function clampCount(n: number, min = 1, max = 50): number {
  const lo = Math.max(1, Math.trunc(min))
  const hi = Math.max(lo, Math.trunc(max))
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, Math.round(n)))
}

/** A typed count, or null when it isn't a whole number. */
export function parseCount(text: string): number | null {
  const t = text.trim()
  return /^\d{1,4}$/.test(t) ? Number(t) : null
}

/** "For 5 people" then one "• Potatoes — 1.5 kg" line per item. */
export function copyText(
  items: ScaleItem[],
  value: number,
  base: number,
  label: UnitLabel,
): string {
  return [
    `For ${value} ${unitWord(value, label)}`,
    ...items.map(
      (i) => `• ${i.name} — ${formatQuantity(scaleItem(i, value, base))}`,
    ),
  ].join("\n")
}
