/**
 * Cart: totals as a pure function, in integer minor units (cents) so that
 * 3 × 2.49 is 7.47, not 7.470000000000001.
 *
 * These are display totals. The host's checkout recomputes the real amount.
 */

export type TotalsLine = { unitPrice: number; quantity: number }

export type CartTotals = {
  /** Sum of unit price × quantity. */
  subtotal: number
  shipping: number
  /** The applied discount, never more than the subtotal. */
  discount: number
  /** subtotal + shipping − discount, never below zero. */
  total: number
  /** Number of units across all lines. */
  count: number
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

/** Amount in integer minor units. */
export function toMinor(amount: number, digits = 2): number {
  // toFixed first: 1.005 * 100 is 100.49999999999999 in floating point.
  return Math.round(Number((amount * 10 ** digits).toFixed(6)))
}

export function fromMinor(minor: number, digits = 2): number {
  return minor / 10 ** digits
}

/** One line's total, in major units. */
export function lineTotal(line: TotalsLine, digits = 2): number {
  return fromMinor(toMinor(line.unitPrice, digits) * line.quantity, digits)
}

export function computeTotals(
  items: TotalsLine[],
  shippingPrice = 0,
  promoAmount = 0,
  digits = 2,
): CartTotals {
  let subtotal = 0
  let count = 0
  for (const item of items) {
    const quantity = Math.max(0, Math.floor(item.quantity))
    subtotal += toMinor(item.unitPrice, digits) * quantity
    count += quantity
  }
  const shipping = Math.max(0, toMinor(shippingPrice, digits))
  const discount = Math.min(Math.max(0, toMinor(promoAmount, digits)), subtotal)
  const total = Math.max(0, subtotal + shipping - discount)
  return {
    subtotal: fromMinor(subtotal, digits),
    shipping: fromMinor(shipping, digits),
    discount: fromMinor(discount, digits),
    total: fromMinor(total, digits),
    count,
  }
}
