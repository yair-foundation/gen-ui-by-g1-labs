/**
 * Seat Map: pure helpers for reading the layout, moving through it with the
 * keyboard, assigning seats and describing them. No React, no Zod, so they run
 * anywhere.
 *
 * Inputs are typed loosely because the map may still be streaming: any field
 * can be missing until the tool call finishes.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export const SEAT_FEATURES = [
  "window",
  "aisle",
  "middle",
  "extra-legroom",
  "exit-row",
  "accessible",
  "near-screen",
  "power",
  "restricted-view",
] as const

export type SeatFeature = (typeof SEAT_FEATURES)[number]
export type SeatState = "available" | "taken" | "blocked"

export const MARKER_KINDS = [
  "exit",
  "wing-start",
  "wing-end",
  "galley",
  "lavatory",
  "screen",
  "table",
] as const

export type MarkerKind = (typeof MARKER_KINDS)[number]

export const FEATURE_LABELS: Record<SeatFeature, string> = {
  window: "window",
  aisle: "aisle",
  middle: "middle",
  "extra-legroom": "extra legroom",
  "exit-row": "exit row",
  accessible: "accessible",
  "near-screen": "near the screen",
  power: "power outlet",
  "restricted-view": "restricted view",
}

/** How a section draws its rows. */
export const SECTION_LAYOUTS = ["grid", "curved", "boxes"] as const
export type SectionLayout = (typeof SECTION_LAYOUTS)[number]

/** Default arc angle, in degrees, of a curved row. */
export const DEFAULT_CURVE = 70

/** A seat or gap as it arrives, possibly incomplete. */
export type LooseCell = {
  id?: string
  label?: string
  state?: SeatState
  features?: (SeatFeature | undefined)[]
  price?: number
  note?: string
  zone?: string
  gap?: boolean
}

export type LooseRow = {
  label?: string
  seats?: (LooseCell | undefined)[]
  side?: "left" | "right"
}

export type LooseMarker = { afterRow?: string; kind?: MarkerKind }

export type LooseSection = {
  id?: string
  label?: string
  rows?: (LooseRow | undefined)[]
  markers?: (LooseMarker | undefined)[]
  layout?: SectionLayout
  curve?: number
  stage?: "front" | "below"
}

export type LooseZone = { id?: string; label?: string; price?: number }
export type Zone = { id: string; label: string; price: number }

export type ReadySeat = {
  id: string
  label?: string
  state: SeatState
  features: SeatFeature[]
  /** The seat's own price, else its zone's. */
  price?: number
  note?: string
  /** A zone id that matches one of the map's zones. */
  zone?: string
}

/** A seat, or null for a gap (an aisle or empty space). */
export type Cell = ReadySeat | null

export type ReadyRow = {
  label: string
  cells: Cell[]
  side?: "left" | "right"
}
export type ReadyMarker = { afterRow: string; kind: MarkerKind }

export type ReadySection = {
  id: string
  label: string
  rows: ReadyRow[]
  markers: ReadyMarker[]
  layout?: SectionLayout
  curve?: number
  stage?: "front" | "below"
}

export type Passenger = { id: string; name: string }

/** Zones that have fully arrived, keyed by id. */
export function readyZones(
  zones: (LooseZone | undefined)[] | undefined,
): Map<string, Zone> {
  const out = new Map<string, Zone>()
  for (const z of zones ?? []) {
    if (
      !z ||
      typeof z.id !== "string" ||
      typeof z.label !== "string" ||
      typeof z.price !== "number" ||
      out.has(z.id)
    )
      continue
    out.set(z.id, { id: z.id, label: z.label, price: z.price })
  }
  return out
}

/**
 * The parts of the map that have fully arrived, in order. Seats that name a
 * known zone and have no price of their own take the zone's price.
 */
export function readySections(
  sections: (LooseSection | undefined)[] | undefined,
  zones: Map<string, Zone> = new Map(),
): ReadySection[] {
  const out: ReadySection[] = []
  for (const s of sections ?? []) {
    if (!s || typeof s.id !== "string" || typeof s.label !== "string") continue
    const rows: ReadyRow[] = []
    for (const r of s.rows ?? []) {
      if (!r || typeof r.label !== "string" || !Array.isArray(r.seats)) continue
      const cells: Cell[] = []
      for (const c of r.seats) {
        if (!c) continue
        if (c.gap === true) cells.push(null)
        else if (typeof c.id === "string" && c.state) {
          const zone =
            typeof c.zone === "string" ? zones.get(c.zone) : undefined
          const price = typeof c.price === "number" ? c.price : zone?.price
          cells.push({
            id: c.id,
            label: c.label,
            state: c.state,
            features: (c.features ?? []).filter(
              (f): f is SeatFeature => typeof f === "string",
            ),
            price: typeof price === "number" && price > 0 ? price : undefined,
            note: typeof c.note === "string" && c.note ? c.note : undefined,
            zone: zone?.id,
          })
        }
      }
      if (cells.length)
        rows.push({
          label: r.label,
          cells,
          ...(r.side === "left" || r.side === "right" ? { side: r.side } : {}),
        })
    }
    const markers = (s.markers ?? []).filter(
      (m): m is ReadyMarker =>
        !!m && typeof m.afterRow === "string" && typeof m.kind === "string",
    )
    out.push({
      id: s.id,
      label: s.label,
      rows,
      markers,
      ...(s.layout ? { layout: s.layout } : {}),
      ...(typeof s.curve === "number" ? { curve: s.curve } : {}),
      ...(s.stage ? { stage: s.stage } : {}),
    })
  }
  return out
}

/** Where a seat sits, for lookups by id. */
export type SeatInfo = {
  seat: ReadySeat
  sectionId: string
  sectionLabel: string
  rowIndex: number
  rowLabel: string
  col: number
  /** Position in reading order across the whole map. */
  order: number
}

export function indexSeats(sections: ReadySection[]): Map<string, SeatInfo> {
  const map = new Map<string, SeatInfo>()
  let order = 0
  for (const s of sections) {
    s.rows.forEach((row, rowIndex) => {
      row.cells.forEach((seat, col) => {
        if (!seat || map.has(seat.id)) return
        map.set(seat.id, {
          seat,
          sectionId: s.id,
          sectionLabel: s.label,
          rowIndex,
          rowLabel: row.label,
          col,
          order: order++,
        })
      })
    })
  }
  return map
}

/**
 * Column letters for a plane-style header ("A B C · D E F"), read from seat ids
 * like "14C". One entry per column; null for aisles and unlettered columns.
 */
export function columnLetters(rows: ReadyRow[]): (string | null)[] {
  const width = Math.max(0, ...rows.map((r) => r.cells.length))
  const letters: (string | null)[] = []
  for (let col = 0; col < width; col++) {
    const counts = new Map<string, number>()
    for (const r of rows) {
      const m = r.cells[col]?.id.match(/^\d+\s*([A-Za-z]{1,2})$/)
      if (m) {
        const letter = m[1].toUpperCase()
        counts.set(letter, (counts.get(letter) ?? 0) + 1)
      }
    }
    let best: string | null = null
    let bestCount = 0
    for (const [letter, n] of counts) {
      if (n > bestCount) {
        best = letter
        bestCount = n
      }
    }
    letters.push(best)
  }
  return letters
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

/** Maps a key to a direction. Ctrl/Cmd + Home/End jump to the whole map's ends. */
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
 * Next focusable seat from `fromId`. `grid` holds the ids of seats that can
 * take focus and null for gaps and unavailable seats, which are skipped.
 * Up and down land on the nearest seat by column, skipping rows with none.
 * `coords` (same shape as `grid`) replaces the column with another position
 * across rows, e.g. each seat's angle on a curved row.
 * Returns null when there's nowhere to go.
 */
export function moveFocus(
  grid: (string | null)[][],
  fromId: string,
  direction: Direction,
  coords?: number[][],
): string | null {
  const at = (i: number, j: number) => {
    const v = coords?.[i]?.[j]
    return typeof v === "number" && Number.isFinite(v) ? v : j
  }
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
      const from = at(r, c)
      for (let i = r + step; i >= 0 && i < grid.length; i += step) {
        const target = grid[i]
        let best: string | null = null
        let bestDistance = Number.POSITIVE_INFINITY
        for (let j = 0; j < target.length; j++) {
          const id = target[j]
          const d = Math.abs(at(i, j) - from)
          // Ties go to the left-hand seat.
          if (id && d < bestDistance - 1e-9) {
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

/** The layout a section draws with: its own, else the map's, else by kind. */
export function layoutOf(
  section: { layout?: SectionLayout } | undefined,
  mapLayout?: "grid" | "curved",
  kind?: string,
): SectionLayout {
  return (
    section?.layout ?? mapLayout ?? (kind === "theater" ? "curved" : "grid")
  )
}

/** An arc angle in degrees, kept between 10° and 150°. */
export function clampCurve(curve?: number): number {
  return typeof curve === "number" && Number.isFinite(curve)
    ? Math.min(150, Math.max(10, curve))
    : DEFAULT_CURVE
}

/** A point on a curved row: its center, and its angle from the middle in degrees. */
export type ArcPoint = { x: number; y: number; angle: number }

export type ArcRow = {
  /** One per cell; null for gaps. */
  cells: (ArcPoint | null)[]
  /** Where the row label goes at each end. */
  start: ArcPoint
  end: ArcPoint
  radius: number
}

export type ArcLayout = { rows: ArcRow[]; width: number; height: number }

export type ArcOptions = {
  /** Arc angle in degrees. Default 70. */
  angle?: number
  /** Least distance between neighbouring seat centers, in seat widths. */
  pitch?: number
  /** Distance between rows, in seat widths. */
  rowPitch?: number
  /** Width of a gap, as a share of a seat's slot. */
  gap?: number
  /** Widest spacing between neighbours, in pitches, so sparse rows stay together. */
  maxSpread?: number
}

/** Half the extent of a seat turned to face the stage, with room for its ring. */
const SEAT_EXTENT = 0.75

/**
 * Seat positions for curved rows: concentric arcs around a center in front of
 * the stage, nearest row first. Every row spreads over the same angle, so
 * aisles at the same place in each row line up, and the first radius is the
 * smallest at which no row's seats touch. Units are seat widths; the stage is
 * above (smaller y), and (0, 0) is the top-left of the bounding box.
 */
export function arcLayout(
  rows: { cells: unknown[] }[],
  options: ArcOptions = {},
): ArcLayout {
  const theta = (clampCurve(options.angle) * Math.PI) / 180
  const pitch = options.pitch ?? 1.12
  const rowPitch = options.rowPitch ?? 1.3
  const gapWidth = options.gap ?? 0.7
  const maxSpread = options.maxSpread ?? 2

  // Slot centers along each row and its width, in slots.
  const slots = rows.map((row) => {
    let u = 0
    const centers = row.cells.map((c) => {
      const w = c ? 1 : gapWidth
      const center = u + w / 2
      u += w
      return center
    })
    return { centers, width: Math.max(1, u) }
  })
  // Neighbours are a slot apart: a chord of `pitch` needs this radius.
  const minRadius = (width: number) => pitch / (2 * Math.sin(theta / width / 2))
  let first = rowPitch
  slots.forEach((s, r) => {
    first = Math.max(first, minRadius(s.width) - r * rowPitch)
  })

  const point = (radius: number, phi: number) => ({
    x: radius * Math.sin(phi),
    y: radius * Math.cos(phi),
    angle: (phi * 180) / Math.PI,
  })
  const raw = slots.map((s, r) => {
    const radius = first + r * rowPitch
    const cap = 2 * Math.asin(Math.min(1, (maxSpread * pitch) / (2 * radius)))
    const step = Math.min(theta / s.width, cap)
    const at = (u: number) => point(radius, (u - s.width / 2) * step)
    const firstU = s.centers[0] ?? s.width / 2
    const lastU = s.centers.at(-1) ?? s.width / 2
    return {
      cells: rows[r].cells.map((c, k) => (c ? at(s.centers[k]) : null)),
      start: at(firstU - 1),
      end: at(lastU + 1),
      radius,
    }
  })

  const all = raw.flatMap((r) => [
    r.start,
    r.end,
    ...r.cells.filter((c): c is ArcPoint => !!c),
  ])
  if (!all.length) return { rows: [], width: 0, height: 0 }
  const minX = Math.min(...all.map((p) => p.x))
  const maxX = Math.max(...all.map((p) => p.x))
  const minY = Math.min(...all.map((p) => p.y))
  const maxY = Math.max(...all.map((p) => p.y))
  const shift = (p: ArcPoint): ArcPoint => ({
    x: p.x - minX + SEAT_EXTENT,
    y: p.y - minY + SEAT_EXTENT,
    angle: p.angle,
  })
  return {
    rows: raw.map((r) => ({
      cells: r.cells.map((c) => (c ? shift(c) : null)),
      start: shift(r.start),
      end: shift(r.end),
      radius: r.radius,
    })),
    width: maxX - minX + 2 * SEAT_EXTENT,
    height: maxY - minY + 2 * SEAT_EXTENT,
  }
}

/** Each cell's angle (NaN for gaps), for `moveFocus` on curved rows. */
export function arcCoords(layout: ArcLayout): number[][] {
  return layout.rows.map((r) => r.cells.map((c) => c?.angle ?? Number.NaN))
}

/**
 * Seat size in px for a layout `width` seats wide in `available` px: as big
 * as fits, between `min` (the tap target) and `max`. Wider maps scroll.
 */
export function seatSizeFor(
  available: number | null | undefined,
  width: number,
  min = 24,
  max = 32,
): number {
  if (!available || !(width > 0)) return max
  return Math.floor(Math.min(max, Math.max(min, available / width)))
}

/** Row indexes of boxes on each side of the stage: by `side`, else first half left. */
export function boxSides(rows: { side?: "left" | "right" }[]): {
  left: number[]
  right: number[]
} {
  const left: number[] = []
  const right: number[] = []
  const half = Math.ceil(rows.length / 2)
  rows.forEach((row, i) => {
    const side = row.side ?? (i < half ? "left" : "right")
    ;(side === "left" ? left : right).push(i)
  })
  return { left, right }
}

/** Fill strengths for zones, strongest (dearest) first. */
export const ZONE_LEVELS = 4

export type ZoneSummary = Zone & {
  /** Seats in the zone, and how many are available. */
  seats: number
  available: number
  /** 0 (strongest fill) to ZONE_LEVELS - 1. */
  level: number
}

/** Zones that have seats on the map, dearest first, with a fill level each. */
export function groupZones(
  zones: Map<string, Zone>,
  index: Map<string, SeatInfo>,
): ZoneSummary[] {
  const counts = new Map<string, { seats: number; available: number }>()
  for (const { seat } of index.values()) {
    if (!seat.zone) continue
    const c = counts.get(seat.zone) ?? { seats: 0, available: 0 }
    c.seats++
    if (seat.state === "available") c.available++
    counts.set(seat.zone, c)
  }
  const used = [...zones.values()]
    .filter((z) => counts.has(z.id))
    .sort((a, b) => b.price - a.price)
  return used.map((z, i) => ({
    ...z,
    seats: counts.get(z.id)?.seats ?? 0,
    available: counts.get(z.id)?.available ?? 0,
    level:
      used.length === 1
        ? 0
        : Math.round((i * (ZONE_LEVELS - 1)) / (used.length - 1)),
  }))
}

/** Seat id → passenger id. Pass the order of `passengers` to read it back. */
export type Assignments = Record<string, string>

export type PassengerPick = {
  assignments: Assignments
  activeId: string
  event:
    | { type: "assigned"; passengerId: string; seatId: string }
    | { type: "unassigned"; passengerId: string; seatId: string }
    | {
        type: "swapped"
        passengerId: string
        seatId: string
        /** The passenger who had the seat. */
        otherId: string
        /** Where they moved: the active passenger's old seat, if any. */
        otherSeatId?: string
      }
}

export function seatOf(
  assignments: Assignments,
  passengerId: string,
): string | undefined {
  return Object.keys(assignments).find((s) => assignments[s] === passengerId)
}

/** The first passenger without a seat, starting after `afterId` and wrapping. */
export function nextUnassigned(
  passengers: Passenger[],
  assignments: Assignments,
  afterId?: string,
): string | undefined {
  const start = afterId ? passengers.findIndex((p) => p.id === afterId) + 1 : 0
  for (let k = 0; k < passengers.length; k++) {
    const p = passengers[(start + k) % passengers.length]
    if (!seatOf(assignments, p.id)) return p.id
  }
  return undefined
}

/**
 * Click on a seat while assigning for `activeId`:
 * - the passenger's own seat: unassigns it;
 * - another passenger's seat: the two swap (the other gets the active
 *   passenger's old seat, or none);
 * - a free seat: assigns it, replacing the passenger's previous seat.
 * After assigning, moves on to the next passenger without a seat.
 */
export function pickForPassenger(
  passengers: Passenger[],
  assignments: Assignments,
  activeId: string,
  seatId: string,
): PassengerPick {
  const owner = assignments[seatId]
  const previous = seatOf(assignments, activeId)
  const next: Assignments = { ...assignments }

  if (owner === activeId) {
    delete next[seatId]
    return {
      assignments: next,
      activeId,
      event: { type: "unassigned", passengerId: activeId, seatId },
    }
  }

  if (previous) delete next[previous]
  next[seatId] = activeId
  if (owner && previous) next[previous] = owner

  const advanced = nextUnassigned(passengers, next, activeId) ?? activeId
  return {
    assignments: next,
    activeId: advanced,
    event: owner
      ? {
          type: "swapped",
          passengerId: activeId,
          seatId,
          otherId: owner,
          otherSeatId: previous,
        }
      : { type: "assigned", passengerId: activeId, seatId },
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

/**
 * Starting assignments from existing seats. Entries with a known passenger go
 * to them; the rest fill passengers without a seat, in order.
 */
export function initialAssignments(
  passengers: Passenger[],
  current: { passengerId?: string; seatId: string }[],
): Assignments {
  const out: Assignments = {}
  const ids = new Set(passengers.map((p) => p.id))
  const rest: string[] = []
  for (const c of current) {
    if (c.seatId in out) continue
    if (c.passengerId && ids.has(c.passengerId)) {
      if (!seatOf(out, c.passengerId)) out[c.seatId] = c.passengerId
    } else rest.push(c.seatId)
  }
  for (const seatId of rest) {
    if (seatId in out) continue
    const p = nextUnassigned(passengers, out)
    if (!p) break
    out[seatId] = p
  }
  return out
}

/**
 * True when every seat is in the same row and side by side, with no aisle or
 * other seat between them. Needs at least two seats.
 */
export function areTogether(
  seatIds: string[],
  index: Map<string, SeatInfo>,
): boolean {
  if (seatIds.length < 2) return false
  const infos = seatIds.map((id) => index.get(id))
  if (infos.some((i) => !i)) return false
  const first = infos[0] as SeatInfo
  const sameRow = infos.every(
    (i) => i?.sectionId === first.sectionId && i.rowIndex === first.rowIndex,
  )
  if (!sameRow) return false
  const cols = infos.map((i) => (i as SeatInfo).col).sort((a, b) => a - b)
  return cols.every((c, k) => k === 0 || c === cols[k - 1] + 1)
}

/** Sum of prices for paid seats, leaving out seats the user already holds. */
export function priceTotal(
  seatIds: string[],
  index: Map<string, SeatInfo>,
  held: Set<string> = new Set(),
): number {
  let total = 0
  for (const id of seatIds) {
    if (held.has(id)) continue
    total += index.get(id)?.seat.price ?? 0
  }
  return total
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
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }).format(amount)
}

export type SeatContext = {
  /** The seat's state after applying the user's held seats. */
  state: SeatState
  selected: boolean
  /** Passenger name the seat is assigned to. */
  selectedFor?: string
  /** The user already holds this seat. */
  current?: boolean
  /** The label of the seat's price zone, e.g. "Band A". */
  zoneLabel?: string
  formatPrice: (amount: number) => string
}

function stateText(ctx: SeatContext): string {
  if (ctx.selected)
    return ctx.selectedFor ? `selected for ${ctx.selectedFor}` : "selected"
  if (ctx.state === "taken") return "taken"
  if (ctx.state === "blocked") return "not available"
  return "available"
}

/** The facts after the seat id: zone, features, note, price, held, state. */
function seatFacts(seat: ReadySeat, ctx: SeatContext): string[] {
  const features = seat.features.map((f) => FEATURE_LABELS[f] ?? f)
  const facts: string[] = ctx.zoneLabel ? [ctx.zoneLabel] : []
  facts.push(...features)
  // A note that repeats a feature ("Restricted view") is said once.
  if (seat.note && !features.includes(seat.note.toLowerCase()))
    facts.push(seat.note)
  if (seat.price && !ctx.current && ctx.state === "available")
    facts.push(ctx.formatPrice(seat.price))
  if (ctx.current) facts.push("your current seat")
  facts.push(stateText(ctx))
  return facts
}

/** Accessible name: "Seat 14C, aisle, extra legroom, €25, available". */
export function describeSeat(seat: ReadySeat, ctx: SeatContext): string {
  return [`Seat ${seat.id}`, ...seatFacts(seat, ctx)].join(", ")
}

/** Visible detail line: "14C · Aisle · Extra legroom · €25 · Available". */
export function seatDetail(seat: ReadySeat, ctx: SeatContext): string {
  return [seat.id, ...seatFacts(seat, ctx)]
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join(" · ")
}

/** "Dana Levi" → "DL", "Sam" → "S". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ""
  const first = words[0].charAt(0)
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : ""
  return (first + last).toUpperCase()
}

export function pluralize(n: number, word: string, plural = `${word}s`) {
  return `${n} ${n === 1 ? word : plural}`
}

/** Live-region text for a passenger pick: "14C selected for Dana. 1 of 2 assigned." */
export function announcePassengerPick(
  pick: PassengerPick,
  passengers: Passenger[],
  label: (seatId: string) => string = (s) => s,
): string {
  const name = (id: string) => passengers.find((p) => p.id === id)?.name ?? id
  const assigned = passengers.filter((p) =>
    seatOf(pick.assignments, p.id),
  ).length
  const tally = `${assigned} of ${passengers.length} assigned.`
  const e = pick.event
  const parts: string[] = []
  if (e.type === "unassigned") {
    parts.push(`${label(e.seatId)} removed for ${name(e.passengerId)}.`)
  } else {
    parts.push(`${label(e.seatId)} selected for ${name(e.passengerId)}.`)
    if (e.type === "swapped") {
      parts.push(
        e.otherSeatId
          ? `${name(e.otherId)} moved to ${label(e.otherSeatId)}.`
          : `${name(e.otherId)} no longer has a seat.`,
      )
    }
  }
  parts.push(tally)
  if (e.type !== "unassigned" && pick.activeId !== e.passengerId) {
    parts.push(`Next: ${name(pick.activeId)}.`)
  }
  return parts.join(" ")
}

/** Live-region text for a count pick: "F7 selected. 2 of 4 selected." */
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
