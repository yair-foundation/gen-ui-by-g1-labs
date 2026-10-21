/**
 * Product Options: variant availability and price, as pure functions.
 *
 * A value is available when the catalog doesn't mark it out of stock and, when
 * variants are given, at least one in-stock variant matches it together with
 * the user's other selections. So picking "Black" disables the sizes that
 * aren't in stock in black, and the user can never reach a dead combination.
 */

export type Selection = Record<string, string>

export type VariantOptionValue = {
  value: string
  available?: boolean
  priceDelta?: number
}

export type VariantOptionGroup = {
  id: string
  values: VariantOptionValue[]
}

export type Variant = {
  id: string
  options: Record<string, string>
  available: boolean
  stock?: number
}

/** In stock: marked available, and not at zero when stock is known. */
export function isVariantInStock(variant: Variant): boolean {
  return variant.available && (variant.stock === undefined || variant.stock > 0)
}

/** Every chosen option in `selection` matches the variant. */
function matches(variant: Variant, selection: Selection): boolean {
  return Object.entries(selection).every(
    ([optionId, value]) => variant.options[optionId] === value,
  )
}

/**
 * Whether `value` in group `optionId` can be chosen, given the user's
 * selections in the other groups.
 */
export function isValueAvailable(
  groups: VariantOptionGroup[],
  variants: Variant[] | undefined,
  selection: Selection,
  optionId: string,
  value: string,
): boolean {
  const group = groups.find((g) => g.id === optionId)
  const def = group?.values.find((v) => v.value === value)
  if (!def || def.available === false) return false
  if (!variants || variants.length === 0) return true

  // Only the other groups constrain this one; the value replaces its own group.
  const probe: Selection = { [optionId]: value }
  for (const g of groups) {
    if (g.id !== optionId && selection[g.id] !== undefined) {
      probe[g.id] = selection[g.id]
    }
  }
  return variants.some((v) => isVariantInStock(v) && matches(v, probe))
}

export type VariantState =
  /** Some groups have no selection yet. */
  | { kind: "incomplete"; missing: string[] }
  /** Every group is chosen and the combination can be bought. */
  | { kind: "available"; variant?: Variant; stock?: number }
  /** Every group is chosen but that combination is out of stock. */
  | { kind: "unavailable"; variant?: Variant }

/** Resolves the user's selection to a variant and whether it can be bought. */
export function resolveVariant(
  groups: VariantOptionGroup[],
  variants: Variant[] | undefined,
  selection: Selection,
): VariantState {
  const missing = groups
    .filter((g) => selection[g.id] === undefined)
    .map((g) => g.id)
  if (missing.length > 0) return { kind: "incomplete", missing }

  const valuesOk = groups.every((g) => {
    const def = g.values.find((v) => v.value === selection[g.id])
    return def !== undefined && def.available !== false
  })
  if (!variants || variants.length === 0) {
    return valuesOk ? { kind: "available" } : { kind: "unavailable" }
  }

  const exact: Selection = {}
  for (const g of groups) exact[g.id] = selection[g.id]
  const variant = variants.find((v) => matches(v, exact))
  if (!variant || !valuesOk || !isVariantInStock(variant)) {
    return { kind: "unavailable", variant }
  }
  return { kind: "available", variant, stock: variant.stock }
}

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

/** Amount in integer minor units (cents), so sums don't drift. */
export function toMinor(amount: number, digits = 2): number {
  // toFixed first: 1.005 * 100 is 100.49999999999999 in floating point.
  return Math.round(Number((amount * 10 ** digits).toFixed(6)))
}

export function fromMinor(minor: number, digits = 2): number {
  return minor / 10 ** digits
}

/**
 * Unit and total price for the selection: the base price plus each chosen
 * value's priceDelta, times the quantity. Computed in minor units.
 */
export function priceFor(
  baseAmount: number,
  groups: VariantOptionGroup[],
  selection: Selection,
  quantity: number,
  digits = 2,
): { unit: number; total: number; delta: number } {
  let deltaMinor = 0
  for (const g of groups) {
    const def = g.values.find((v) => v.value === selection[g.id])
    if (def?.priceDelta) deltaMinor += toMinor(def.priceDelta, digits)
  }
  const unitMinor = toMinor(baseAmount, digits) + deltaMinor
  return {
    unit: fromMinor(unitMinor, digits),
    total: fromMinor(unitMinor * quantity, digits),
    delta: fromMinor(deltaMinor, digits),
  }
}
