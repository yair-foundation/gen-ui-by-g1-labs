/**
 * Color Picker: pure color math. No React, no DOM, so it can be unit-tested
 * and reused on the server.
 *
 * - Hex, RGB and HSL conversion and validation (sRGB, 8 bits per channel).
 * - WCAG 2.x relative luminance and contrast ratio.
 * - OKLab color difference (ΔE, scaled ×100) and nearest-color search.
 */

export type Rgb = { r: number; g: number; b: number }
export type Hsl = { h: number; s: number; l: number }
export type Oklab = { L: number; a: number; b: number }

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** True for "#rgb", "#rrggbb", with or without the "#". */
export function isValidHex(input: string | undefined | null): boolean {
  return typeof input === "string" && HEX_PATTERN.test(input.trim())
}

/** Lowercase "#rrggbb", or null when the input isn't a hex color. */
export function normalizeHex(input: string | undefined | null): string | null {
  if (typeof input !== "string") return null
  const match = HEX_PATTERN.exec(input.trim())
  if (!match) return null
  let digits = match[1].toLowerCase()
  if (digits.length === 3) {
    digits = digits
      .split("")
      .map((d) => d + d)
      .join("")
  }
  return `#${digits}`
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value))

export function hexToRgb(hex: string): Rgb | null {
  const normal = normalizeHex(hex)
  if (!normal) return null
  const n = Number.parseInt(normal.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((c) =>
      Math.round(clamp(c, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

/** HSL with h in degrees (0–360), s and l in percent (0–100). Unrounded. */
export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return { h: 0, s: 0, l: l * 100 }
  const s = d / (1 - Math.abs(2 * l - 1))
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s: s * 100, l: l * 100 }
}

export function hslToRgb({ h, s, l }: Hsl): Rgb {
  const hn = (((h % 360) + 360) % 360) / 60
  const sn = clamp(s, 0, 100) / 100
  const ln = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * ln - 1)) * sn
  const x = c * (1 - Math.abs((hn % 2) - 1))
  const m = ln - c / 2
  let rgb: [number, number, number]
  if (hn < 1) rgb = [c, x, 0]
  else if (hn < 2) rgb = [x, c, 0]
  else if (hn < 3) rgb = [0, c, x]
  else if (hn < 4) rgb = [0, x, c]
  else if (hn < 5) rgb = [x, 0, c]
  else rgb = [c, 0, x]
  return {
    r: Math.round((rgb[0] + m) * 255),
    g: Math.round((rgb[1] + m) * 255),
    b: Math.round((rgb[2] + m) * 255),
  }
}

/** HSL rounded to whole degrees and percents, for display and sliders. */
export function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const { h, s, l } = rgbToHsl(rgb)
  return { h: Math.round(h) % 360, s: Math.round(s), l: Math.round(l) }
}

export function hslToHex(hsl: Hsl): string {
  return rgbToHex(hslToRgb(hsl))
}

export function formatRgb(hex: string): string {
  const rgb = hexToRgb(hex)
  return rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : ""
}

export function formatHsl(hex: string): string {
  const hsl = hexToHsl(hex)
  return hsl ? `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` : ""
}

/** sRGB channel (0–255) to linear light (0–1). */
function toLinear(channel: number) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  return (
    0.2126 * toLinear(rgb.r) +
    0.7152 * toLinear(rgb.g) +
    0.0722 * toLinear(rgb.b)
  )
}

/** WCAG contrast ratio between two colors, 1 to 21. Order doesn't matter. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export type ContrastLevel = "AAA" | "AA" | "AA large" | "fail"

/**
 * WCAG level for text at this ratio: AAA ≥ 7, AA ≥ 4.5, "AA large" ≥ 3
 * (large or bold text only), otherwise "fail".
 */
export function contrastLevel(ratio: number): ContrastLevel {
  // Compare at two decimals so 4.499… shown as "4.50" isn't called a fail.
  const r = Math.round(ratio * 100) / 100
  if (r >= 7) return "AAA"
  if (r >= 4.5) return "AA"
  if (r >= 3) return "AA large"
  return "fail"
}

/** Plain-language verdict for a contrast ratio. */
export function contrastVerdict(ratio: number): string {
  switch (contrastLevel(ratio)) {
    case "AAA":
      return "Passes AA and AAA"
    case "AA":
      return "Passes AA, fails AAA"
    case "AA large":
      return "Large text only (AA)"
    default:
      return "Fails AA"
  }
}

/** "4.52:1", or "21:1" for whole numbers. */
export function formatRatio(ratio: number): string {
  const r = Math.round(ratio * 100) / 100
  return `${Number.isInteger(r) ? r : r.toFixed(2)}:1`
}

/** Black or white, whichever has more contrast on this background. */
export function readableTextOn(hex: string): "#000000" | "#ffffff" {
  return contrastRatio(hex, "#000000") >= contrastRatio(hex, "#ffffff")
    ? "#000000"
    : "#ffffff"
}

/** sRGB hex to OKLab (Björn Ottosson, 2020). */
export function hexToOklab(hex: string): Oklab | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const r = toLinear(rgb.r)
  const g = toLinear(rgb.g)
  const b = toLinear(rgb.b)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  }
}

/**
 * Color difference: Euclidean distance in OKLab, ×100 so it reads like
 * classic ΔE (about 2 is barely noticeable; black to white is 100).
 * Returns Infinity when either color is invalid.
 */
export function deltaE(a: string, b: string): number {
  const x = hexToOklab(a)
  const y = hexToOklab(b)
  if (!x || !y) return Number.POSITIVE_INFINITY
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b) * 100
}

/** ΔE to one decimal, e.g. "2.1". */
export function formatDeltaE(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "–"
}

/**
 * The `count` palette colors closest to `hex`, nearest first, each with its
 * ΔE. Skips the color with `excludeId` (the color itself) and invalid hexes.
 */
export function nearestColors<T extends { id: string; hex: string }>(
  hex: string,
  palette: readonly T[],
  count = 3,
  excludeId?: string,
): (T & { deltaE: number })[] {
  return palette
    .filter((c) => c.id !== excludeId && isValidHex(c.hex))
    .map((c) => ({ ...c, deltaE: deltaE(hex, c.hex) }))
    .sort((a, b) => a.deltaE - b.deltaE)
    .slice(0, Math.max(0, count))
}

/** Lowercase, accent-insensitive text for matching. */
function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/**
 * True when every word of the query appears in the color's name, code, group
 * or hex. An empty query matches everything.
 */
export function matchesColor(
  color: { name?: string; code?: string; group?: string; hex?: string },
  query: string,
): boolean {
  const words = fold(query).replace(/#/g, "").split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold(
    [color.name, color.code, color.group, color.hex?.replace("#", "")]
      .filter(Boolean)
      .join(" "),
  )
  return words.every((w) => haystack.includes(w))
}
