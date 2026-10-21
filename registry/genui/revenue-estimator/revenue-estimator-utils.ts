import { DEFAULT_LOCALE } from "@/components/genui/locale"

/** Clamp to [min, max] and snap to the step grid that starts at min. */
export function snapCount(n: number, min: number, max: number, step: number) {
  const clamped = Math.min(max, Math.max(min, n))
  const snapped = min + Math.round((clamped - min) / step) * step
  return Math.min(max, snapped)
}

export function formatMoney(
  n: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
) {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: Number.isInteger(n) ? 0 : 2,
    }).format(n)
  } catch {
    // Unknown currency code while streaming.
    return String(n)
  }
}

/** Currency symbol and separators around a number, for rolling digits. */
export function moneyParts(
  n: number,
  currency: string,
  locale: string = DEFAULT_LOCALE,
) {
  const decimals = Number.isInteger(n) ? 0 : 2
  let parts: Intl.NumberFormatPart[] = []
  try {
    parts = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).formatToParts(n)
  } catch {
    // Unknown currency code while streaming.
  }
  const first = parts.findIndex((p) => p.type === "integer")
  const last = parts.findLastIndex((p) =>
    ["integer", "group", "decimal", "fraction"].includes(p.type),
  )
  const text = (from: Intl.NumberFormatPart[]) =>
    from.map((p) => p.value).join("")
  return {
    prefix: first > 0 ? text(parts.slice(0, first)) : "",
    suffix: last >= 0 ? text(parts.slice(last + 1)) : "",
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    decimals,
  }
}
