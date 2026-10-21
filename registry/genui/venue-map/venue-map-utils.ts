/**
 * Venue Map: pure helpers. No React, no Zod, so they run anywhere.
 *
 * - Geometry: ring sections are annular sectors on an ellipse around the
 *   focal point (angle 0 = top, clockwise); floor sections are rectangles in
 *   the floor area. All in one fixed viewBox.
 * - Buckets: single-hue price or availability bands on nice bounds.
 * - Sections: readiness while streaming, ordering, filters, descriptions.
 * - Seat step: rows, keyboard movement, count picking, together check and
 *   totals (adapted from seat-map).
 *
 * Inputs are typed loosely because the map may still be streaming.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

// ---------------------------------------------------------------------------
// Types

export type Ring = 1 | 2 | 3
export type Tier = "floor" | "lower" | "middle" | "upper"
export type FocalKind = "pitch" | "court" | "stage" | "rink"
export type SeatState = "available" | "taken" | "blocked"

export const VENUE_SEAT_FEATURES = [
  "aisle",
  "accessible",
  "companion",
  "restricted-view",
  "extra-legroom",
] as const

export type SeatFeature = (typeof VENUE_SEAT_FEATURES)[number]

export const FEATURE_LABELS: Record<SeatFeature, string> = {
  aisle: "aisle",
  accessible: "wheelchair space",
  companion: "companion seat",
  "restricted-view": "restricted view",
  "extra-legroom": "extra legroom",
}

export const TIER_LABELS: Record<Tier, string> = {
  floor: "Floor",
  lower: "Lower tier",
  middle: "Middle tier",
  upper: "Upper tier",
}

export type LooseCell = {
  id?: string
  label?: string
  state?: SeatState
  price?: number
  features?: (SeatFeature | undefined)[]
  gap?: boolean
}
export type LooseRow = { label?: string; seats?: (LooseCell | undefined)[] }

export type LoosePosition = {
  angle?: number
  span?: number
  ring?: number
  floor?: { x?: number; y?: number; w?: number; h?: number }
}

export type LooseSection = {
  id?: string
  label?: string
  tier?: Tier
  position?: LoosePosition
  price?: { from?: number; to?: number }
  available?: number
  accessible?: boolean
  view?: string
  rows?: (LooseRow | undefined)[]
}

export type RingPosition = {
  kind: "ring"
  angle: number
  span: number
  ring: Ring
}
export type FloorPosition = {
  kind: "floor"
  x: number
  y: number
  w: number
  h: number
}

export type ReadySeat = {
  id: string
  label?: string
  state: SeatState
  features: SeatFeature[]
  price?: number
}
export type Cell = ReadySeat | null
export type ReadyRow = { label: string; cells: Cell[] }

export type ReadySection = {
  id: string
  label: string
  tier: Tier
  position: RingPosition | FloorPosition
  price?: { from: number; to?: number }
  available: number
  accessible: boolean
  view?: string
  /** Undefined when the agent hasn't fetched this section's seats. */
  rows?: ReadyRow[]
}

// ---------------------------------------------------------------------------
// Geometry

export type View = {
  width: number
  height: number
  cx: number
  cy: number
  /** Outer radii of the bowl. */
  rx: number
  ry: number
}

export const VIEW: View = {
  width: 400,
  height: 300,
  cx: 200,
  cy: 150,
  rx: 192,
  ry: 142,
}

/** Inner and outer radius of each ring, as fractions of the bowl's radii. */
export const RING_BANDS: Record<Ring, [number, number]> = {
  1: [0.5, 0.66],
  2: [0.69, 0.83],
  3: [0.86, 1],
}

/** Radius of the focal area (inside ring 1). */
export const INNER = 0.47

const round = (n: number) => Math.round(n * 100) / 100
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

/** Any angle to [0, 360). */
export function normalizeAngle(a: number): number {
  return ((a % 360) + 360) % 360
}

/** The point at `angle` (0 = top, clockwise) and radius fraction `r`. */
export function pointAt(
  angle: number,
  r: number,
  view: View = VIEW,
): [number, number] {
  const t = (angle * Math.PI) / 180
  return [
    round(view.cx + view.rx * r * Math.sin(t)),
    round(view.cy - view.ry * r * Math.cos(t)),
  ]
}

/**
 * Angles and radii of a ring section after the gaps: a0 < a1, and a1 may pass
 * 360 when the section wraps past the top (350° + 20° ends at 370°).
 */
export type SectorBounds = { a0: number; a1: number; r0: number; r1: number }

export function sectorBounds(
  pos: Omit<RingPosition, "kind">,
  gapDeg = 1.2,
): SectorBounds {
  const span = clamp(pos.span, 0.5, 359)
  const gap = Math.min(Math.max(0, gapDeg), span / 4)
  const start = normalizeAngle(pos.angle)
  const [r0, r1] = RING_BANDS[pos.ring] ?? RING_BANDS[1]
  return { a0: start + gap / 2, a1: start + span - gap / 2, r0, r1 }
}

/** SVG path of an annular sector: outer arc clockwise, inner arc back. */
export function sectorPath(
  pos: Omit<RingPosition, "kind">,
  gapDeg = 1.2,
  view: View = VIEW,
): string {
  const { a0, a1, r0, r1 } = sectorBounds(pos, gapDeg)
  const large = a1 - a0 > 180 ? 1 : 0
  const [x0, y0] = pointAt(a0, r1, view)
  const [x1, y1] = pointAt(a1, r1, view)
  const [x2, y2] = pointAt(a1, r0, view)
  const [x3, y3] = pointAt(a0, r0, view)
  const orx = round(view.rx * r1)
  const ory = round(view.ry * r1)
  const irx = round(view.rx * r0)
  const iry = round(view.ry * r0)
  return `M${x0} ${y0}A${orx} ${ory} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${irx} ${iry} 0 ${large} 0 ${x3} ${y3}Z`
}

/** Where a ring section's label goes: the middle of its angle and depth. */
export function sectorLabelPoint(
  pos: Omit<RingPosition, "kind">,
  gapDeg = 1.2,
  view: View = VIEW,
): [number, number] {
  const { a0, a1, r0, r1 } = sectorBounds(pos, gapDeg)
  return pointAt((a0 + a1) / 2, (r0 + r1) / 2, view)
}

/** True when a viewBox point lies inside the section's sector. */
export function pointInSector(
  [x, y]: [number, number],
  bounds: SectorBounds,
  view: View = VIEW,
): boolean {
  const dx = (x - view.cx) / view.rx
  const dy = (view.cy - y) / view.ry
  const r = Math.hypot(dx, dy)
  if (r < bounds.r0 - 1e-6 || r > bounds.r1 + 1e-6) return false
  const angle = normalizeAngle((Math.atan2(dx, dy) * 180) / Math.PI)
  return normalizeAngle(angle - bounds.a0) <= bounds.a1 - bounds.a0 + 1e-6
}

/** The full ring, for placeholders while sections stream in. */
export function ringTrackPath(ring: Ring, view: View = VIEW): string {
  const [r0, r1] = RING_BANDS[ring]
  const ellipse = (r: number) => {
    const rx = round(view.rx * r)
    const ry = round(view.ry * r)
    const top = round(view.cy - ry)
    const bottom = round(view.cy + ry)
    return `M${view.cx} ${top}A${rx} ${ry} 0 1 1 ${view.cx} ${bottom}A${rx} ${ry} 0 1 1 ${view.cx} ${top}Z`
  }
  return `${ellipse(r1)}${ellipse(r0)}`
}

export type Rect = { x: number; y: number; w: number; h: number }

/** The rectangle inscribed in the focal ellipse: the pitch, court or rink. */
export function focalRect(view: View = VIEW): Rect {
  const hw = view.rx * INNER * Math.SQRT1_2
  const hh = view.ry * INNER * Math.SQRT1_2
  return {
    x: round(view.cx - hw),
    y: round(view.cy - hh),
    w: round(hw * 2),
    h: round(hh * 2),
  }
}

/** Share of the focal rectangle the stage takes, at the top. */
export const STAGE_SHARE = 0.28

/** Where the stage sits, for stage-focused venues. */
export function stageRect(view: View = VIEW): Rect {
  const f = focalRect(view)
  return { x: f.x, y: f.y, w: f.w, h: round(f.h * STAGE_SHARE) }
}

/** Where floor sections go: in front of the stage, or over the playing area. */
export function floorArea(
  focal: FocalKind | undefined,
  view: View = VIEW,
): Rect {
  const f = focalRect(view)
  if (focal !== "stage") return f
  const top = round(f.h * STAGE_SHARE + 4)
  return { x: f.x, y: round(f.y + top), w: f.w, h: round(f.h - top) }
}

/** A floor section (0–1 units in the floor area) in viewBox units, inset by the gap. */
export function floorRect(
  pos: Omit<FloorPosition, "kind">,
  area: Rect,
  gap = 1.5,
): Rect {
  const x = clamp(pos.x, 0, 1)
  const y = clamp(pos.y, 0, 1)
  const w = clamp(pos.w, 0, 1 - x)
  const h = clamp(pos.h, 0, 1 - y)
  return {
    x: round(area.x + x * area.w + gap / 2),
    y: round(area.y + y * area.h + gap / 2),
    w: round(Math.max(0, w * area.w - gap)),
    h: round(Math.max(0, h * area.h - gap)),
  }
}

// ---------------------------------------------------------------------------
// Buckets (single hue, light to strong)

export type Buckets = {
  lo: number
  step: number
  count: number
  /** count + 1 bounds. */
  bounds: number[]
}

const clean = (n: number) => Number(n.toPrecision(12))

/** The smallest of 1, 2, 2.5, 5 × 10ⁿ that is ≥ raw. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1
  const base = 10 ** Math.floor(Math.log10(raw))
  const f = raw / base
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return clean(nice * base)
}

/**
 * Equal-width buckets on nice bounds covering every value: at most `steps`
 * (2–6), fewer when the top ones would be empty, so the strongest shade is
 * always in use. With `zeroBased` unset, starts at 0 when the smallest value
 * is near 0 relative to the largest (good for counts; prices pass false).
 */
export function quantize(
  values: number[],
  steps = 4,
  zeroBased?: boolean,
): Buckets | null {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return null
  const wanted = clamp(Math.round(steps) || 4, 2, 6)
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  const fromZero = zeroBased ?? (min >= 0 && (min <= max / 3 || min === max))
  const from = fromZero ? Math.min(0, min) : min
  let step = niceStep((max - from) / wanted || Math.abs(max) / wanted || 1)
  let lo = 0
  for (let i = 0; i < 40; i++) {
    lo = fromZero ? Math.min(0, from) : clean(Math.floor(min / step) * step)
    if (lo + step * wanted >= max) break
    step = niceStep(step * 1.01)
  }
  // Drop empty buckets at the top; the maximum sits in the last one.
  const count = clamp(Math.ceil((max - lo) / step - 1e-9), 1, wanted)
  const bounds = Array.from({ length: count + 1 }, (_, i) =>
    clean(lo + i * step),
  )
  return { lo, step, count, bounds }
}

/** Bucket index (lower bound inclusive), or -1 for no value. */
export function bucketOf(value: number | undefined, b: Buckets): number {
  if (value === undefined || !Number.isFinite(value)) return -1
  const i = Math.floor((value - b.lo) / b.step + 1e-9)
  return clamp(i, 0, b.count - 1)
}

/** Share of the ink mixed into the base per bucket: 22% to 100%. */
export function bucketStrength(index: number, count: number): number {
  if (count <= 1) return 100
  return Math.round(22 + (78 * clamp(index, 0, count - 1)) / (count - 1))
}

/** Legend text per bucket, e.g. "€40–€60". */
export function bucketLabels(
  b: Buckets,
  format: (n: number) => string,
): string[] {
  return b.bounds
    .slice(0, -1)
    .map((lo, i) => `${format(lo)}–${format(b.bounds[i + 1])}`)
}

// ---------------------------------------------------------------------------
// Sections

const isNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n)

const defaultTier = (ring: Ring): Tier =>
  ring === 1 ? "lower" : ring === 2 ? "middle" : "upper"

function readyRows(rows: (LooseRow | undefined)[]): ReadyRow[] {
  const out: ReadyRow[] = []
  for (const r of rows) {
    if (!r || typeof r.label !== "string" || !Array.isArray(r.seats)) continue
    const cells: Cell[] = []
    for (const c of r.seats) {
      if (!c) continue
      if (c.gap === true) cells.push(null)
      else if (typeof c.id === "string" && c.state) {
        cells.push({
          id: c.id,
          label: c.label,
          state: c.state,
          features: (c.features ?? []).filter(
            (f): f is SeatFeature => typeof f === "string",
          ),
          price: isNum(c.price) && c.price >= 0 ? c.price : undefined,
        })
      }
    }
    if (cells.length) out.push({ label: r.label, cells })
  }
  return out
}

/** Sections that have fully arrived (id, label, position, availability). */
export function readySections(
  sections: (LooseSection | undefined)[] | undefined,
): ReadySection[] {
  const out: ReadySection[] = []
  const seen = new Set<string>()
  for (const s of sections ?? []) {
    if (!s || typeof s.id !== "string" || typeof s.label !== "string") continue
    if (seen.has(s.id) || !isNum(s.available)) continue
    const p = s.position
    let position: RingPosition | FloorPosition | null = null
    if (p?.floor) {
      const { x, y, w, h } = p.floor
      if (isNum(x) && isNum(y) && isNum(w) && isNum(h) && w > 0 && h > 0)
        position = { kind: "floor", x, y, w, h }
    } else if (
      p &&
      isNum(p.angle) &&
      isNum(p.span) &&
      p.span > 0 &&
      (p.ring === 1 || p.ring === 2 || p.ring === 3)
    ) {
      position = { kind: "ring", angle: p.angle, span: p.span, ring: p.ring }
    }
    if (!position) continue
    seen.add(s.id)
    const price =
      s.price && isNum(s.price.from)
        ? {
            from: s.price.from,
            ...(isNum(s.price.to) && s.price.to > s.price.from
              ? { to: s.price.to }
              : {}),
          }
        : undefined
    out.push({
      id: s.id,
      label: s.label,
      tier:
        s.tier ??
        (position.kind === "floor" ? "floor" : defaultTier(position.ring)),
      position,
      price,
      available: Math.max(0, Math.floor(s.available)),
      accessible: s.accessible === true,
      view: s.view,
      rows: Array.isArray(s.rows) ? readyRows(s.rows) : undefined,
    })
  }
  return out
}

/** Middle angle of a ring section, in [0, 360). */
export function centerAngle(pos: { angle: number; span: number }): number {
  return normalizeAngle(pos.angle + pos.span / 2)
}

/**
 * Reading order for the keyboard list: floor sections first (front to back,
 * left to right), then each ring from the inside out, clockwise from the top.
 */
export function orderSections<T extends Pick<ReadySection, "position">>(
  sections: T[],
): T[] {
  const key = (s: T): [number, number, number] =>
    s.position.kind === "floor"
      ? [0, s.position.y, s.position.x]
      : [s.position.ring, centerAngle(s.position), 0]
  return [...sections].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2] - kb[2]
  })
}

export type SectionFilters = { maxPrice?: number; accessibleOnly?: boolean }

export type SectionMatch = {
  soldOut: boolean
  /** The cheapest seat costs more than the max price. */
  overBudget: boolean
  /** "Accessible only" is on and the section has no accessible seating. */
  notAccessible: boolean
  /** Shown dimmed on the map. */
  dimmed: boolean
}

export function matchSection(
  s: Pick<ReadySection, "available" | "price" | "accessible">,
  f: SectionFilters,
): SectionMatch {
  const soldOut = s.available <= 0
  const overBudget =
    f.maxPrice !== undefined && !!s.price && s.price.from > f.maxPrice
  const notAccessible = !!f.accessibleOnly && !s.accessible
  return {
    soldOut,
    overBudget,
    notAccessible,
    dimmed: soldOut || overBudget || notAccessible,
  }
}

export function formatPrice(
  amount: number,
  currency?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      }).format(amount)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(
    amount,
  )
}

/**
 * "Sat 10 Oct, 15:00" in the venue's local time as written in the ISO string
 * (the offset is ignored), so server and browser agree. Unparseable: as is.
 */
export function formatEventStart(
  start: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(start)
  if (!m) return start
  const [, y, mo, d, h, mi] = m
  const utc = Date.UTC(+y, +mo - 1, +d, h ? +h : 0, mi ? +mi : 0)
  if (!Number.isFinite(utc)) return start
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(h ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: "UTC",
  }).format(utc)
}

export function pluralize(n: number, word: string, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`
}

/** "€65" or "from €55" when prices vary. */
export function priceText(
  price: ReadySection["price"],
  money: (n: number) => string,
): string | null {
  if (!price) return null
  return price.to !== undefined
    ? `from ${money(price.from)}`
    : money(price.from)
}

/** "€65" or "€55–€80". */
export function priceRange(
  price: ReadySection["price"],
  money: (n: number) => string,
): string | null {
  if (!price) return null
  return price.to !== undefined
    ? `${money(price.from)}–${money(price.to)}`
    : money(price.from)
}

/** Visible tooltip: "Section 112 · Behind the goal · from €65 · 48 left". */
export function sectionTip(
  s: ReadySection,
  m: SectionMatch,
  money: (n: number) => string,
): string {
  const parts = [`Section ${s.label}`]
  if (s.view) parts.push(s.view)
  if (m.soldOut) {
    parts.push("Sold out")
    return parts.join(" · ")
  }
  const p = priceText(s.price, money)
  if (p) parts.push(p)
  parts.push(`${s.available} left`)
  if (s.accessible) parts.push("Accessible")
  if (m.overBudget) parts.push("Above your max price")
  return parts.join(" · ")
}

/** Accessible name: "Section 112, lower tier, behind the goal, from €65, 48 left". */
export function describeSection(
  s: ReadySection,
  m: SectionMatch,
  money: (n: number) => string,
): string {
  const parts = [`Section ${s.label}`, TIER_LABELS[s.tier].toLowerCase()]
  if (s.view) parts.push(s.view.charAt(0).toLowerCase() + s.view.slice(1))
  if (m.soldOut) {
    parts.push("sold out")
    return parts.join(", ")
  }
  const p = priceText(s.price, money)
  if (p) parts.push(p)
  parts.push(`${s.available} left`)
  if (s.accessible) parts.push("accessible seating")
  if (m.overBudget) parts.push("above your max price")
  if (m.notAccessible) parts.push("no accessible seating")
  return parts.join(", ")
}

/** Price slider bounds from the sections' prices, on steps of `step`. */
export function priceSliderRange(
  sections: Pick<ReadySection, "price">[],
): { min: number; max: number; step: number } | null {
  const lows = sections
    .map((s) => s.price?.from)
    .filter((n): n is number => isNum(n))
  if (lows.length === 0) return null
  const lo = Math.min(...lows)
  const hi = Math.max(...lows)
  const step = hi - lo > 200 ? 10 : 5
  const min = Math.floor(lo / step) * step
  const max = Math.max(min + step, Math.ceil(hi / step) * step)
  return { min, max, step }
}

// ---------------------------------------------------------------------------
// Seat step (adapted from seat-map)

export type SeatInfo = {
  seat: ReadySeat
  rowIndex: number
  rowLabel: string
  col: number
  order: number
}

export function indexSeats(rows: ReadyRow[]): Map<string, SeatInfo> {
  const map = new Map<string, SeatInfo>()
  let order = 0
  rows.forEach((row, rowIndex) => {
    row.cells.forEach((seat, col) => {
      if (!seat || map.has(seat.id)) return
      map.set(seat.id, {
        seat,
        rowIndex,
        rowLabel: row.label,
        col,
        order: order++,
      })
    })
  })
  return map
}

/** "aisle" where every row has a gap (or nothing) in that column. */
export function columnKinds(rows: ReadyRow[]): ("seat" | "aisle")[] {
  const width = Math.max(0, ...rows.map((r) => r.cells.length))
  return Array.from({ length: width }, (_, col) =>
    rows.some((r) => r.cells[col]) ? "seat" : "aisle",
  )
}

export type Direction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "rowStart"
  | "rowEnd"
  | "first"
  | "last"

export function directionForKey(
  key: string,
  withModifier = false,
): Direction | null {
  switch (key) {
    case "ArrowLeft":
      return "left"
    case "ArrowRight":
      return "right"
    case "ArrowUp":
      return "up"
    case "ArrowDown":
      return "down"
    case "Home":
      return withModifier ? "first" : "rowStart"
    case "End":
      return withModifier ? "last" : "rowEnd"
    default:
      return null
  }
}

/**
 * Next focusable seat from `fromId`; null entries (gaps, unavailable seats)
 * are skipped. Up and down land on the nearest seat by column.
 */
export function moveFocus(
  grid: (string | null)[][],
  fromId: string,
  direction: Direction,
): string | null {
  const firstIn = (row: (string | null)[]) => row.find((id) => id) ?? null
  const lastIn = (row: (string | null)[]) =>
    [...row].reverse().find((id) => id) ?? null

  if (direction === "first") {
    for (const row of grid) {
      const id = firstIn(row)
      if (id) return id
    }
    return null
  }
  if (direction === "last") {
    for (let r = grid.length - 1; r >= 0; r--) {
      const id = lastIn(grid[r])
      if (id) return id
    }
    return null
  }

  let r = -1
  let c = -1
  for (let i = 0; i < grid.length && r < 0; i++) {
    const j = grid[i].indexOf(fromId)
    if (j >= 0) {
      r = i
      c = j
    }
  }
  if (r < 0) return null
  const row = grid[r]

  switch (direction) {
    case "left":
      for (let j = c - 1; j >= 0; j--) if (row[j]) return row[j]
      return null
    case "right":
      for (let j = c + 1; j < row.length; j++) if (row[j]) return row[j]
      return null
    case "rowStart": {
      const id = firstIn(row)
      return id === fromId ? null : id
    }
    case "rowEnd": {
      const id = lastIn(row)
      return id === fromId ? null : id
    }
    case "up":
    case "down": {
      const step = direction === "up" ? -1 : 1
      for (let i = r + step; i >= 0 && i < grid.length; i += step) {
        const target = grid[i]
        let best: string | null = null
        let bestDistance = Number.POSITIVE_INFINITY
        for (let j = 0; j < target.length; j++) {
          const id = target[j]
          const d = Math.abs(j - c)
          if (id && d < bestDistance) {
            best = id
            bestDistance = d
          }
        }
        if (best) return best
      }
      return null
    }
  }
}

export type CountPick = {
  selected: string[]
  event:
    | { type: "selected"; seatId: string; released?: string }
    | { type: "removed"; seatId: string }
}

/** Toggle a seat when picking `count` seats. Beyond the count, the oldest pick goes. */
export function pickForCount(
  selected: string[],
  count: number,
  seatId: string,
): CountPick {
  if (selected.includes(seatId)) {
    return {
      selected: selected.filter((s) => s !== seatId),
      event: { type: "removed", seatId },
    }
  }
  const next = [...selected, seatId]
  const released = next.length > Math.max(1, count) ? next.shift() : undefined
  return { selected: next, event: { type: "selected", seatId, released } }
}

/** Same row, side by side, nothing in between. Needs at least two seats. */
export function areTogether(
  seatIds: string[],
  index: Map<string, SeatInfo>,
): boolean {
  if (seatIds.length < 2) return false
  const infos = seatIds.map((id) => index.get(id))
  if (infos.some((i) => !i)) return false
  const first = infos[0] as SeatInfo
  if (!infos.every((i) => i?.rowIndex === first.rowIndex)) return false
  const cols = infos.map((i) => (i as SeatInfo).col).sort((a, b) => a - b)
  return cols.every((c, k) => k === 0 || c === cols[k - 1] + 1)
}

/** A seat's price: its own, else the section's single price. */
export function seatPrice(
  seat: Pick<ReadySeat, "price">,
  section: Pick<ReadySection, "price">,
): number | undefined {
  if (seat.price !== undefined) return seat.price
  return section.price && section.price.to === undefined
    ? section.price.from
    : undefined
}

/** Sum of the seats' prices; `complete` is false when any price is unknown. */
export function priceTotal(
  seatIds: string[],
  index: Map<string, SeatInfo>,
  section: Pick<ReadySection, "price">,
): { total: number; complete: boolean } {
  let total = 0
  let complete = true
  for (const id of seatIds) {
    const info = index.get(id)
    const p = info ? seatPrice(info.seat, section) : undefined
    if (p === undefined) complete = false
    else total += p
  }
  return { total, complete }
}

const seatName = (s: ReadySeat) => s.label ?? s.id

/**
 * Footer chips, one per row: "112 · Row F · 7, 8". Seats in map order.
 */
export function seatChips(
  sectionLabel: string,
  seatIds: string[],
  index: Map<string, SeatInfo>,
): { key: string; text: string }[] {
  const infos = seatIds
    .map((id) => index.get(id))
    .filter((i): i is SeatInfo => !!i)
    .sort((a, b) => a.order - b.order)
  const rows = new Map<number, SeatInfo[]>()
  for (const i of infos) {
    const list = rows.get(i.rowIndex) ?? []
    list.push(i)
    rows.set(i.rowIndex, list)
  }
  return [...rows.values()].map((list) => ({
    key: list.map((i) => i.seat.id).join("|"),
    text: `${sectionLabel} · Row ${list[0].rowLabel} · ${list.map((i) => seatName(i.seat)).join(", ")}`,
  }))
}

export type SeatContext = {
  state: SeatState
  selected: boolean
  price?: number
  formatPrice: (n: number) => string
}

function seatFacts(seat: ReadySeat, ctx: SeatContext): string[] {
  const facts: string[] = seat.features.map((f) => FEATURE_LABELS[f] ?? f)
  if (ctx.price !== undefined && ctx.state === "available")
    facts.push(ctx.formatPrice(ctx.price))
  facts.push(
    ctx.selected
      ? "selected"
      : ctx.state === "taken"
        ? "taken"
        : ctx.state === "blocked"
          ? "not available"
          : "available",
  )
  return facts
}

/** Accessible name: "Row F, seat 7, aisle, €55, available". */
export function describeSeat(
  seat: ReadySeat,
  rowLabel: string,
  ctx: SeatContext,
): string {
  return [
    `Row ${rowLabel}, seat ${seatName(seat)}`,
    ...seatFacts(seat, ctx),
  ].join(", ")
}

/** Visible detail line: "Row F · Seat 7 · Aisle · €55 · Available". */
export function seatDetail(
  seat: ReadySeat,
  rowLabel: string,
  ctx: SeatContext,
): string {
  return [`Row ${rowLabel}`, `Seat ${seatName(seat)}`, ...seatFacts(seat, ctx)]
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" · ")
}

/** Live-region text for a pick: "Row F seat 7 selected. 1 of 2 selected." */
export function announceCountPick(
  pick: CountPick,
  count: number,
  label: (seatId: string) => string = (s) => s,
): string {
  const e = pick.event
  const tally = `${pick.selected.length} of ${count} selected.`
  if (e.type === "removed") return `${label(e.seatId)} removed. ${tally}`
  return e.released
    ? `${label(e.seatId)} selected, ${label(e.released)} released. ${tally}`
    : `${label(e.seatId)} selected. ${tally}`
}
