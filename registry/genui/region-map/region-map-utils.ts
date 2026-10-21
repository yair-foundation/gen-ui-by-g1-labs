/**
 * Region Map: pure helpers (no React, no d3), so they can be unit-tested in Node.
 *
 * - resolveRegionId / featureKey / regionName: id lookups. US states resolve to
 *   their 2-letter code; countries to ISO 3166-1 alpha-3.
 * - quantize / bucketOf / bucketLabels: equal-width buckets on nice bounds.
 * - formatValue: currency, number or percent, compact or full.
 * - layoutPins: places pin labels so they don't overlap or leave the map.
 * - summarize: the one-sentence description for assistive tech.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export type Geography = "us-states" | "world"
export type ValueFormat = "currency" | "number" | "percent"
export type ScaleFormat = { format?: ValueFormat; currency?: string }

// ---------------------------------------------------------------------------
// Ids

/** [FIPS, USPS code, name] for the 50 states and DC (the states in us-atlas). */
export const US_STATES: readonly (readonly [string, string, string])[] = [
  ["01", "AL", "Alabama"],
  ["02", "AK", "Alaska"],
  ["04", "AZ", "Arizona"],
  ["05", "AR", "Arkansas"],
  ["06", "CA", "California"],
  ["08", "CO", "Colorado"],
  ["09", "CT", "Connecticut"],
  ["10", "DE", "Delaware"],
  ["11", "DC", "District of Columbia"],
  ["12", "FL", "Florida"],
  ["13", "GA", "Georgia"],
  ["15", "HI", "Hawaii"],
  ["16", "ID", "Idaho"],
  ["17", "IL", "Illinois"],
  ["18", "IN", "Indiana"],
  ["19", "IA", "Iowa"],
  ["20", "KS", "Kansas"],
  ["21", "KY", "Kentucky"],
  ["22", "LA", "Louisiana"],
  ["23", "ME", "Maine"],
  ["24", "MD", "Maryland"],
  ["25", "MA", "Massachusetts"],
  ["26", "MI", "Michigan"],
  ["27", "MN", "Minnesota"],
  ["28", "MS", "Mississippi"],
  ["29", "MO", "Missouri"],
  ["30", "MT", "Montana"],
  ["31", "NE", "Nebraska"],
  ["32", "NV", "Nevada"],
  ["33", "NH", "New Hampshire"],
  ["34", "NJ", "New Jersey"],
  ["35", "NM", "New Mexico"],
  ["36", "NY", "New York"],
  ["37", "NC", "North Carolina"],
  ["38", "ND", "North Dakota"],
  ["39", "OH", "Ohio"],
  ["40", "OK", "Oklahoma"],
  ["41", "OR", "Oregon"],
  ["42", "PA", "Pennsylvania"],
  ["44", "RI", "Rhode Island"],
  ["45", "SC", "South Carolina"],
  ["46", "SD", "South Dakota"],
  ["47", "TN", "Tennessee"],
  ["48", "TX", "Texas"],
  ["49", "UT", "Utah"],
  ["50", "VT", "Vermont"],
  ["51", "VA", "Virginia"],
  ["53", "WA", "Washington"],
  ["54", "WV", "West Virginia"],
  ["55", "WI", "Wisconsin"],
  ["56", "WY", "Wyoming"],
]

/**
 * [ISO numeric, alpha-3, name] for every country in world-atlas 110m. The
 * three without a numeric id (Kosovo, N. Cyprus, Somaliland) are matched by
 * name and keyed by a user-assigned code.
 */
export const COUNTRIES: readonly (readonly [string, string, string])[] = [
  ["004", "AFG", "Afghanistan"],
  ["008", "ALB", "Albania"],
  ["010", "ATA", "Antarctica"],
  ["012", "DZA", "Algeria"],
  ["024", "AGO", "Angola"],
  ["031", "AZE", "Azerbaijan"],
  ["032", "ARG", "Argentina"],
  ["036", "AUS", "Australia"],
  ["040", "AUT", "Austria"],
  ["044", "BHS", "Bahamas"],
  ["050", "BGD", "Bangladesh"],
  ["051", "ARM", "Armenia"],
  ["056", "BEL", "Belgium"],
  ["064", "BTN", "Bhutan"],
  ["068", "BOL", "Bolivia"],
  ["070", "BIH", "Bosnia and Herzegovina"],
  ["072", "BWA", "Botswana"],
  ["076", "BRA", "Brazil"],
  ["084", "BLZ", "Belize"],
  ["090", "SLB", "Solomon Islands"],
  ["096", "BRN", "Brunei"],
  ["100", "BGR", "Bulgaria"],
  ["104", "MMR", "Myanmar"],
  ["108", "BDI", "Burundi"],
  ["112", "BLR", "Belarus"],
  ["116", "KHM", "Cambodia"],
  ["120", "CMR", "Cameroon"],
  ["124", "CAN", "Canada"],
  ["140", "CAF", "Central African Republic"],
  ["144", "LKA", "Sri Lanka"],
  ["148", "TCD", "Chad"],
  ["152", "CHL", "Chile"],
  ["156", "CHN", "China"],
  ["158", "TWN", "Taiwan"],
  ["170", "COL", "Colombia"],
  ["178", "COG", "Congo"],
  ["180", "COD", "Democratic Republic of the Congo"],
  ["188", "CRI", "Costa Rica"],
  ["191", "HRV", "Croatia"],
  ["192", "CUB", "Cuba"],
  ["196", "CYP", "Cyprus"],
  ["203", "CZE", "Czechia"],
  ["204", "BEN", "Benin"],
  ["208", "DNK", "Denmark"],
  ["214", "DOM", "Dominican Republic"],
  ["218", "ECU", "Ecuador"],
  ["222", "SLV", "El Salvador"],
  ["226", "GNQ", "Equatorial Guinea"],
  ["231", "ETH", "Ethiopia"],
  ["232", "ERI", "Eritrea"],
  ["233", "EST", "Estonia"],
  ["238", "FLK", "Falkland Islands"],
  ["242", "FJI", "Fiji"],
  ["246", "FIN", "Finland"],
  ["250", "FRA", "France"],
  ["260", "ATF", "French Southern Territories"],
  ["262", "DJI", "Djibouti"],
  ["266", "GAB", "Gabon"],
  ["268", "GEO", "Georgia"],
  ["270", "GMB", "Gambia"],
  ["275", "PSE", "Palestine"],
  ["276", "DEU", "Germany"],
  ["288", "GHA", "Ghana"],
  ["300", "GRC", "Greece"],
  ["304", "GRL", "Greenland"],
  ["320", "GTM", "Guatemala"],
  ["324", "GIN", "Guinea"],
  ["328", "GUY", "Guyana"],
  ["332", "HTI", "Haiti"],
  ["340", "HND", "Honduras"],
  ["348", "HUN", "Hungary"],
  ["352", "ISL", "Iceland"],
  ["356", "IND", "India"],
  ["360", "IDN", "Indonesia"],
  ["364", "IRN", "Iran"],
  ["368", "IRQ", "Iraq"],
  ["372", "IRL", "Ireland"],
  ["376", "ISR", "Israel"],
  ["380", "ITA", "Italy"],
  ["384", "CIV", "Côte d'Ivoire"],
  ["388", "JAM", "Jamaica"],
  ["392", "JPN", "Japan"],
  ["398", "KAZ", "Kazakhstan"],
  ["400", "JOR", "Jordan"],
  ["404", "KEN", "Kenya"],
  ["408", "PRK", "North Korea"],
  ["410", "KOR", "South Korea"],
  ["414", "KWT", "Kuwait"],
  ["417", "KGZ", "Kyrgyzstan"],
  ["418", "LAO", "Laos"],
  ["422", "LBN", "Lebanon"],
  ["426", "LSO", "Lesotho"],
  ["428", "LVA", "Latvia"],
  ["430", "LBR", "Liberia"],
  ["434", "LBY", "Libya"],
  ["440", "LTU", "Lithuania"],
  ["442", "LUX", "Luxembourg"],
  ["450", "MDG", "Madagascar"],
  ["454", "MWI", "Malawi"],
  ["458", "MYS", "Malaysia"],
  ["466", "MLI", "Mali"],
  ["478", "MRT", "Mauritania"],
  ["484", "MEX", "Mexico"],
  ["496", "MNG", "Mongolia"],
  ["498", "MDA", "Moldova"],
  ["499", "MNE", "Montenegro"],
  ["504", "MAR", "Morocco"],
  ["508", "MOZ", "Mozambique"],
  ["512", "OMN", "Oman"],
  ["516", "NAM", "Namibia"],
  ["524", "NPL", "Nepal"],
  ["528", "NLD", "Netherlands"],
  ["540", "NCL", "New Caledonia"],
  ["548", "VUT", "Vanuatu"],
  ["554", "NZL", "New Zealand"],
  ["558", "NIC", "Nicaragua"],
  ["562", "NER", "Niger"],
  ["566", "NGA", "Nigeria"],
  ["578", "NOR", "Norway"],
  ["586", "PAK", "Pakistan"],
  ["591", "PAN", "Panama"],
  ["598", "PNG", "Papua New Guinea"],
  ["600", "PRY", "Paraguay"],
  ["604", "PER", "Peru"],
  ["608", "PHL", "Philippines"],
  ["616", "POL", "Poland"],
  ["620", "PRT", "Portugal"],
  ["624", "GNB", "Guinea-Bissau"],
  ["626", "TLS", "Timor-Leste"],
  ["630", "PRI", "Puerto Rico"],
  ["634", "QAT", "Qatar"],
  ["642", "ROU", "Romania"],
  ["643", "RUS", "Russia"],
  ["646", "RWA", "Rwanda"],
  ["682", "SAU", "Saudi Arabia"],
  ["686", "SEN", "Senegal"],
  ["688", "SRB", "Serbia"],
  ["694", "SLE", "Sierra Leone"],
  ["703", "SVK", "Slovakia"],
  ["704", "VNM", "Vietnam"],
  ["705", "SVN", "Slovenia"],
  ["706", "SOM", "Somalia"],
  ["710", "ZAF", "South Africa"],
  ["716", "ZWE", "Zimbabwe"],
  ["724", "ESP", "Spain"],
  ["728", "SSD", "South Sudan"],
  ["729", "SDN", "Sudan"],
  ["732", "ESH", "Western Sahara"],
  ["740", "SUR", "Suriname"],
  ["748", "SWZ", "Eswatini"],
  ["752", "SWE", "Sweden"],
  ["756", "CHE", "Switzerland"],
  ["760", "SYR", "Syria"],
  ["762", "TJK", "Tajikistan"],
  ["764", "THA", "Thailand"],
  ["768", "TGO", "Togo"],
  ["780", "TTO", "Trinidad and Tobago"],
  ["784", "ARE", "United Arab Emirates"],
  ["788", "TUN", "Tunisia"],
  ["792", "TUR", "Turkey"],
  ["795", "TKM", "Turkmenistan"],
  ["800", "UGA", "Uganda"],
  ["804", "UKR", "Ukraine"],
  ["807", "MKD", "North Macedonia"],
  ["818", "EGY", "Egypt"],
  ["826", "GBR", "United Kingdom"],
  ["834", "TZA", "Tanzania"],
  ["840", "USA", "United States"],
  ["854", "BFA", "Burkina Faso"],
  ["858", "URY", "Uruguay"],
  ["860", "UZB", "Uzbekistan"],
  ["862", "VEN", "Venezuela"],
  ["887", "YEM", "Yemen"],
  ["894", "ZMB", "Zambia"],
  ["", "XKX", "Kosovo"],
  ["", "CYN", "Northern Cyprus"],
  ["", "SOL", "Somaliland"],
]

/** Other names agents (and the atlas) use for countries, mapped to alpha-3. */
const COUNTRY_ALIASES: readonly (readonly [string, string])[] = [
  ["United States of America", "USA"],
  ["US", "USA"],
  ["America", "USA"],
  ["UK", "GBR"],
  ["Great Britain", "GBR"],
  ["Britain", "GBR"],
  ["Russian Federation", "RUS"],
  ["Republic of Korea", "KOR"],
  ["Korea", "KOR"],
  ["Korea, Republic of", "KOR"],
  ["DPRK", "PRK"],
  ["Czech Republic", "CZE"],
  ["Ivory Coast", "CIV"],
  ["Dem. Rep. Congo", "COD"],
  ["DR Congo", "COD"],
  ["DRC", "COD"],
  ["Congo-Kinshasa", "COD"],
  ["Republic of the Congo", "COG"],
  ["Congo-Brazzaville", "COG"],
  ["Central African Rep.", "CAF"],
  ["Dominican Rep.", "DOM"],
  ["Bosnia and Herz.", "BIH"],
  ["Bosnia", "BIH"],
  ["Eq. Guinea", "GNQ"],
  ["S. Sudan", "SSD"],
  ["Solomon Is.", "SLB"],
  ["Falkland Is.", "FLK"],
  ["W. Sahara", "ESH"],
  ["Fr. S. Antarctic Lands", "ATF"],
  ["Macedonia", "MKD"],
  ["eSwatini", "SWZ"],
  ["Swaziland", "SWZ"],
  ["East Timor", "TLS"],
  ["UAE", "ARE"],
  ["The Bahamas", "BHS"],
  ["The Gambia", "GMB"],
  ["Viet Nam", "VNM"],
  ["Lao PDR", "LAO"],
  ["Burma", "MMR"],
  ["Türkiye", "TUR"],
  ["Turkiye", "TUR"],
  ["Holland", "NLD"],
  ["The Netherlands", "NLD"],
  ["N. Cyprus", "CYN"],
  ["Iran, Islamic Republic of", "IRN"],
  ["Syrian Arab Republic", "SYR"],
  ["State of Palestine", "PSE"],
]

/** Lowercase, no accents, punctuation collapsed to single spaces. */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

type Lookup = { byId: Map<string, string>; names: Map<string, string> }
const lookups = new Map<Geography, Lookup>()

function getLookup(geography: Geography): Lookup {
  const cached = lookups.get(geography)
  if (cached) return cached
  const byId = new Map<string, string>()
  const names = new Map<string, string>()
  if (geography === "us-states") {
    for (const [fips, code, name] of US_STATES) {
      byId.set(code, code)
      byId.set(fips, code)
      byId.set(normalizeName(name), code)
      names.set(code, name)
    }
    byId.set("washington dc", "DC")
    byId.set("washington d c", "DC")
  } else {
    for (const [num, a3, name] of COUNTRIES) {
      byId.set(a3, a3)
      if (num) byId.set(num, a3)
      byId.set(normalizeName(name), a3)
      names.set(a3, name)
    }
    for (const [alias, a3] of COUNTRY_ALIASES) {
      if (names.has(a3)) byId.set(normalizeName(alias), a3)
    }
  }
  const lookup = { byId, names }
  lookups.set(geography, lookup)
  return lookup
}

/**
 * The canonical key for an id the agent sent: a US code like "TX" (from "TX",
 * "US-TX", FIPS "48" or "Texas"), or an alpha-3 like "PRT" (from "PRT",
 * numeric "620" or 620, or "Portugal"). Null when it isn't on the map.
 */
export function resolveRegionId(
  geography: Geography,
  raw: string | number | null | undefined,
): string | null {
  if (raw === null || raw === undefined) return null
  const { byId } = getLookup(geography)
  const value = String(raw).trim()
  if (!value) return null
  if (/^\d{1,3}$/.test(value)) {
    const width = geography === "us-states" ? 2 : 3
    return byId.get(value.padStart(width, "0")) ?? null
  }
  const upper = value.toUpperCase()
  if (geography === "us-states") {
    const code = upper.replace(/^US[-_ ]/, "")
    if (/^[A-Z]{2}$/.test(code) && byId.has(code)) return code
  } else if (/^[A-Z]{3}$/.test(upper) && byId.has(upper)) {
    return upper
  }
  return byId.get(normalizeName(value)) ?? null
}

/** The canonical key for an atlas feature, from its id or, failing that, its name. */
export function featureKey(
  geography: Geography,
  id: string | number | undefined,
  name: string | undefined,
): string | null {
  return (
    (id !== undefined ? resolveRegionId(geography, id) : null) ??
    (name ? resolveRegionId(geography, name) : null)
  )
}

/** Display name for a canonical key. */
export function regionName(geography: Geography, key: string): string {
  return getLookup(geography).names.get(key) ?? key
}

// ---------------------------------------------------------------------------
// Buckets

export type Buckets = {
  /** Lower bound of the first bucket. */
  lo: number
  /** Width of each bucket. */
  step: number
  /** Number of buckets (3–7). */
  count: number
  /** count + 1 bounds, from lo to lo + step × count. */
  bounds: number[]
}

/** The smallest of 1, 2, 2.5, 5 × 10ⁿ that is ≥ raw. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const base = 10 ** Math.floor(Math.log10(raw))
  const f = raw / base
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return clean(nice * base)
}

/** Strips floating-point noise such as 0.30000000000000004. */
const clean = (n: number) => Number(n.toPrecision(12))

/**
 * Equal-width buckets on nice bounds that cover every value. Starts at 0 when
 * the data is non-negative and the smallest value is near 0 relative to the
 * largest, so ranges read "$0–$10M"; otherwise starts just below the minimum.
 */
export function quantize(values: number[], steps = 5): Buckets | null {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return null
  const count = Math.min(7, Math.max(3, Math.round(steps) || 5))
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  // Equal values sit in the top bucket, so they read as present, not faint.
  const zeroBased = min >= 0 && (min <= max / 3 || min === max)
  const from = zeroBased ? 0 : min
  let step = niceStep((max - from) / count || Math.abs(max) / count || 1)
  let lo = 0
  for (let i = 0; i < 40; i++) {
    lo = zeroBased ? 0 : clean(Math.floor(min / step) * step)
    if (lo + step * count >= max) break
    step = niceStep(step * 1.01)
  }
  const bounds = Array.from({ length: count + 1 }, (_, i) =>
    clean(lo + i * step),
  )
  return { lo, step, count, bounds }
}

/** Bucket index for a value (lower bound inclusive), or -1 for no value. */
export function bucketOf(value: number | null | undefined, b: Buckets): number {
  if (value === null || value === undefined || !Number.isFinite(value))
    return -1
  const i = Math.floor((value - b.lo) / b.step + 1e-9)
  return Math.min(b.count - 1, Math.max(0, i))
}

/** "$0–$10M", "$10M–$20M", … */
export function bucketLabels(
  b: Buckets,
  scale: ScaleFormat,
  locale: string = DEFAULT_LOCALE,
): string[] {
  return b.bounds
    .slice(0, -1)
    .map(
      (lo, i) =>
        `${formatValue(lo, scale, "compact", locale)}–${formatValue(b.bounds[i + 1], scale, "compact", locale)}`,
    )
}

/**
 * Share of the strong color mixed into the neutral base, per bucket: one hue,
 * light to strong, so it reads without color vision.
 */
export function bucketStrength(index: number, count: number): number {
  if (count <= 1) return 100
  return Math.round(22 + (78 * index) / (count - 1))
}

/** Strength of the soft tint for highlighted regions without a value. */
export const HIGHLIGHT_STRENGTH = 55

// ---------------------------------------------------------------------------
// Formatting

/**
 * Formats a value. Percent values are percentages (12.5 means 12.5%), as in
 * the chart component. Compact gives "$10M"; full gives "$10,000,000".
 */
export function formatValue(
  value: number,
  scale: ScaleFormat,
  style: "compact" | "full" = "compact",
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(value)) return "No data"
  const compact: Intl.NumberFormatOptions =
    style === "compact"
      ? { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : { maximumFractionDigits: Number.isInteger(value) ? 0 : 2 }
  if (scale.format === "currency" && scale.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: scale.currency,
        minimumFractionDigits: 0,
        ...compact,
      }).format(value)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  if (scale.format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(value / 100)
  }
  return new Intl.NumberFormat(locale, compact).format(value)
}

// ---------------------------------------------------------------------------
// Pin label layout

export type Box = { x: number; y: number; w: number; h: number }

export type PinInput = {
  id: string
  /** Anchor (the dot), in pixels from the map's top-left. */
  x: number
  y: number
  /** Label size in pixels. */
  w: number
  h: number
  /** Higher is placed first and gets the best spot. */
  priority?: number
}

export type PinPlacement = {
  id: string
  box: Box
  side: "above" | "below"
  /** Leader line from the anchor to the label edge. */
  leader: { x1: number; y1: number; x2: number; y2: number }
}

export type LayoutOptions = {
  /** Leader length from the dot to the nearest label edge. */
  leader?: number
  /** Minimum space between labels. */
  gap?: number
  /** Minimum space between a label and the map's edge. */
  pad?: number
  /** Radius around every dot that labels keep clear of. */
  dot?: number
}

/** Pill width estimate for a text-xs label with an icon. */
export function estimateLabelWidth(label: string): number {
  return Math.ceil(label.length * 7 + 38)
}

export function overlap(a: Box, b: Box, gap = 0): number {
  const w = Math.min(a.x + a.w, b.x + b.w) + gap - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) + gap - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), Math.max(lo, hi))

/**
 * Greedy label placement. Each pin's label prefers to sit centered above its
 * dot; if that collides with a placed label, another pin's dot or the map's
 * edge, it tries spots further up, shifted sideways, then below. Labels are
 * clamped horizontally inside the map. If nothing fits, the spot with the
 * least overlap wins.
 */
export function layoutPins(
  pins: PinInput[],
  width: number,
  height: number,
  options: LayoutOptions = {},
): PinPlacement[] {
  const { leader = 20, gap = 4, pad = 4, dot = 6 } = options
  const order = pins
    .map((p, i) => ({ p, i }))
    .sort((a, b) => (b.p.priority ?? 0) - (a.p.priority ?? 0) || a.i - b.i)
  const dots = pins.map((p) => ({
    id: p.id,
    box: { x: p.x - dot, y: p.y - dot, w: dot * 2, h: dot * 2 },
  }))
  const placed: Box[] = []
  const out = new Map<number, PinPlacement>()

  for (const { p, i } of order) {
    const shifts = [0, -1, 1, -2, 2].map((k) => (k * (p.w + gap)) / 2)
    const candidates: { box: Box; side: "above" | "below"; cost: number }[] = []
    for (const side of ["above", "below"] as const) {
      for (let level = 0; level < 10; level++) {
        for (const [s, dx] of shifts.entries()) {
          const lift = leader + level * (p.h + gap)
          const box = {
            x: clamp(p.x + dx - p.w / 2, pad, width - pad - p.w),
            y: side === "above" ? p.y - lift - p.h : p.y + lift,
            w: p.w,
            h: p.h,
          }
          const cost =
            level + Math.ceil(s / 2) * 0.75 + (side === "below" ? 2.5 : 0)
          candidates.push({ box, side, cost })
        }
      }
    }
    candidates.sort((a, b) => a.cost - b.cost)

    const inBounds = (b: Box) => b.y >= pad && b.y + b.h <= height - pad
    const collisions = (b: Box) =>
      placed.reduce((sum, o) => sum + overlap(b, o, gap), 0) +
      dots.reduce((sum, d) => sum + (d.id === p.id ? 0 : overlap(b, d.box)), 0)

    let best = candidates.find(
      (c) => inBounds(c.box) && collisions(c.box) === 0,
    )
    if (!best) {
      // Nothing fits: keep it on the map with the least overlap.
      let min = Number.POSITIVE_INFINITY
      for (const c of candidates) {
        const box = {
          ...c.box,
          y: clamp(c.box.y, pad, height - pad - c.box.h),
        }
        const score = collisions(box) + c.cost
        if (score < min) {
          min = score
          best = { ...c, box }
        }
      }
    }
    if (!best) continue
    const { box, side } = best
    placed.push(box)
    const r = Math.min(box.h / 2, box.w / 2)
    out.set(i, {
      id: p.id,
      box,
      side,
      leader: {
        x1: p.x,
        y1: p.y,
        x2: clamp(p.x, box.x + r, box.x + box.w - r),
        y2: side === "above" ? box.y + box.h : box.y,
      },
    })
  }
  return pins.flatMap((_, i) => {
    const placement = out.get(i)
    return placement ? [placement] : []
  })
}

// ---------------------------------------------------------------------------
// Summary

export function summarize({
  title,
  geography,
  regions,
  highlightCount = 0,
  pinCount = 0,
}: {
  title?: string
  geography: Geography
  /** Regions with values, any order. `text` is the formatted value. */
  regions: { name: string; value: number; text: string }[]
  highlightCount?: number
  pinCount?: number
}): string {
  const noun = (n: number) =>
    geography === "us-states"
      ? n === 1
        ? "state"
        : "states"
      : n === 1
        ? "country"
        : "countries"
  const parts: string[] = []
  if (regions.length === 1) {
    parts.push(`${regions[0].name} ${regions[0].text}`)
  } else if (regions.length > 1) {
    const sorted = [...regions].sort((a, b) => b.value - a.value)
    const hi = sorted[0]
    const lo = sorted[sorted.length - 1]
    parts.push(
      `highest ${hi.name} ${hi.text}, lowest ${lo.name} ${lo.text} (${regions.length} ${noun(regions.length)})`,
    )
  }
  if (highlightCount > 0) {
    parts.push(`${highlightCount} ${noun(highlightCount)} highlighted`)
  }
  if (pinCount > 0) {
    parts.push(
      `${pinCount} ${pinCount === 1 ? "location" : "locations"} marked`,
    )
  }
  const head =
    title ?? (geography === "us-states" ? "Map of US states" : "World map")
  return parts.length ? `${head}: ${parts.join("; ")}` : head
}
