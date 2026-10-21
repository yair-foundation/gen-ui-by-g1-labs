/**
 * Part Diagram: pure helpers. No React, no DOM, no imports, so validation and
 * geometry are deterministic and testable in Node.
 *
 * Coordinates are viewBox units. A part's offset at explode amount `t` (0–1)
 * is `explode * t`, applied as a translate to every shape in the part.
 */

export type Point = { x: number; y: number }
export type Box = { x: number; y: number; w: number; h: number }
export type ViewBox = { width: number; height: number }

type ShapeStyle = { strokeWidth?: number; fill?: boolean }

export type Shape =
  | ({ type: "circle"; cx: number; cy: number; r: number } & ShapeStyle)
  | ({
      type: "rect"
      x: number
      y: number
      width: number
      height: number
      rx?: number
    } & ShapeStyle)
  | ({
      type: "line"
      x1: number
      y1: number
      x2: number
      y2: number
    } & ShapeStyle)
  | ({ type: "polyline"; points: [number, number][] } & ShapeStyle)
  | ({ type: "path"; d: string } & ShapeStyle)

export type DiagramSystem = { id: string; label: string; summary?: string }

export type DiagramPart = {
  id: string
  label: string
  system?: string
  shapes: Shape[]
  /** Union of the shapes' bounds, at rest. */
  bbox: Box
  /** Offset at full explode, clamped to the viewBox size. */
  explode: Point
  /** Where the label points, at rest. */
  anchor: Point
}

export const DEFAULT_VIEWBOX: ViewBox = { width: 400, height: 260 }
export const MAX_PARTS = 40
export const MAX_SHAPES = 12
export const MAX_SYSTEMS = 8
export const PATH_D_MAX = 4000
export const STROKE = { min: 0.25, max: 6, default: 1.5 }

// ---------------------------------------------------------------------------
// Path data validation

/**
 * Characters allowed in path data: the SVG path commands, digits, signs,
 * decimal points, exponents, commas and whitespace. Anything else (`url(`,
 * `javascript:`, quotes, angle brackets) fails here. No nested quantifiers,
 * so it runs in linear time on any input.
 */
export const PATH_D_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9eE+\-.,\s]*$/

/** One token at the cursor: a command letter or a number. Sticky, so linear. */
const PATH_TOKEN =
  /[\s,]*(?:([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?))/y

const ARITY: Record<string, number> = {
  m: 2,
  l: 2,
  t: 2,
  h: 1,
  v: 1,
  c: 6,
  s: 4,
  q: 4,
  a: 7,
  z: 0,
}

type PathToken = { cmd: string } | { num: number }

function tokenizePath(d: string): PathToken[] | null {
  if (d.length > PATH_D_MAX || !PATH_D_CHARS.test(d)) return null
  const tokens: PathToken[] = []
  let i = 0
  while (i < d.length) {
    PATH_TOKEN.lastIndex = i
    const m = PATH_TOKEN.exec(d)
    if (!m) break
    if (m[1]) tokens.push({ cmd: m[1] })
    else {
      const num = Number(m[2])
      if (!Number.isFinite(num)) return null
      tokens.push({ num })
    }
    i = PATH_TOKEN.lastIndex
  }
  // Only separators may be left over.
  return /^[\s,]*$/.test(d.slice(i)) ? tokens : null
}

/**
 * Parses path data into the points that bound it (end points and control
 * points, absolute). Returns null for anything that isn't strict path data:
 * unknown characters, numbers before the first command, wrong parameter
 * counts, arc flags other than 0 or 1. Arcs contribute their end points only.
 */
export function parsePathPoints(d: string): Point[] | null {
  const tokens = tokenizePath(d)
  if (!tokens || tokens.length === 0) return null
  const first = tokens[0]
  if (!("cmd" in first) || first.cmd.toLowerCase() !== "m") return null

  const points: Point[] = []
  let cur: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (!("cmd" in t)) return null
    const cmd = t.cmd
    const lower = cmd.toLowerCase()
    const rel = cmd !== cmd.toUpperCase()
    const arity = ARITY[lower]
    i++
    const params: number[] = []
    while (i < tokens.length) {
      const n = tokens[i]
      if (!("num" in n)) break
      params.push(n.num)
      i++
    }
    if (arity === 0) {
      if (params.length) return null
      cur = start
      continue
    }
    if (params.length === 0 || params.length % arity !== 0) return null
    for (let g = 0; g < params.length; g += arity) {
      const p = params.slice(g, g + arity)
      const ox = rel ? cur.x : 0
      const oy = rel ? cur.y : 0
      // After the first pair, M/m repeats as L/l.
      const kind = lower === "m" && g > 0 ? "l" : lower
      switch (kind) {
        case "m":
          cur = { x: ox + p[0], y: oy + p[1] }
          start = cur
          points.push(cur)
          break
        case "l":
        case "t":
          cur = { x: ox + p[0], y: oy + p[1] }
          points.push(cur)
          break
        case "h":
          cur = { x: (rel ? cur.x : 0) + p[0], y: cur.y }
          points.push(cur)
          break
        case "v":
          cur = { x: cur.x, y: (rel ? cur.y : 0) + p[0] }
          points.push(cur)
          break
        case "c":
          points.push(
            { x: ox + p[0], y: oy + p[1] },
            { x: ox + p[2], y: oy + p[3] },
          )
          cur = { x: ox + p[4], y: oy + p[5] }
          points.push(cur)
          break
        case "s":
        case "q":
          points.push({ x: ox + p[0], y: oy + p[1] })
          cur = { x: ox + p[2], y: oy + p[3] }
          points.push(cur)
          break
        case "a":
          if (p[0] < 0 || p[1] < 0) return null
          if ((p[3] !== 0 && p[3] !== 1) || (p[4] !== 0 && p[4] !== 1))
            return null
          cur = { x: ox + p[5], y: oy + p[6] }
          points.push(cur)
          break
      }
    }
  }
  return points
}

/** True when `d` is strict SVG path data and safe to render. */
export function isValidPathD(d: unknown): d is string {
  return typeof d === "string" && parsePathPoints(d) !== null
}

// ---------------------------------------------------------------------------
// Shapes

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n)

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

function styleOf(raw: Record<string, unknown>): ShapeStyle {
  const style: ShapeStyle = {}
  if (finite(raw.strokeWidth))
    style.strokeWidth = clamp(raw.strokeWidth, STROKE.min, STROKE.max)
  if (raw.fill === true) style.fill = true
  return style
}

/**
 * A complete, drawable shape, or null while it is still streaming in or when
 * it is invalid (non-finite numbers, negative sizes, unsafe path data).
 */
export function sanitizeShape(raw: unknown): Shape | null {
  if (!raw || typeof raw !== "object") return null
  const s = raw as Record<string, unknown>
  switch (s.type) {
    case "circle":
      if (!finite(s.cx) || !finite(s.cy) || !finite(s.r) || s.r <= 0)
        return null
      return { type: "circle", cx: s.cx, cy: s.cy, r: s.r, ...styleOf(s) }
    case "rect": {
      if (
        !finite(s.x) ||
        !finite(s.y) ||
        !finite(s.width) ||
        !finite(s.height) ||
        s.width < 0 ||
        s.height < 0
      )
        return null
      const shape: Shape = {
        type: "rect",
        x: s.x,
        y: s.y,
        width: s.width,
        height: s.height,
        ...styleOf(s),
      }
      if (finite(s.rx) && s.rx > 0) shape.rx = s.rx
      return shape
    }
    case "line":
      if (!finite(s.x1) || !finite(s.y1) || !finite(s.x2) || !finite(s.y2))
        return null
      return {
        type: "line",
        x1: s.x1,
        y1: s.y1,
        x2: s.x2,
        y2: s.y2,
        ...styleOf(s),
      }
    case "polyline": {
      if (!Array.isArray(s.points)) return null
      const points = s.points.filter(
        (p): p is [number, number] =>
          Array.isArray(p) && p.length === 2 && finite(p[0]) && finite(p[1]),
      )
      if (points.length < 2 || points.length !== s.points.length) return null
      return { type: "polyline", points, ...styleOf(s) }
    }
    case "path":
      if (!isValidPathD(s.d)) return null
      return { type: "path", d: s.d, ...styleOf(s) }
    default:
      return null
  }
}

function boxOfPoints(points: Point[]): Box | null {
  if (points.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of points) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** Geometric bounds of one shape (stroke not included). */
export function shapeBounds(shape: Shape): Box | null {
  switch (shape.type) {
    case "circle":
      return {
        x: shape.cx - shape.r,
        y: shape.cy - shape.r,
        w: shape.r * 2,
        h: shape.r * 2,
      }
    case "rect":
      return { x: shape.x, y: shape.y, w: shape.width, h: shape.height }
    case "line":
      return boxOfPoints([
        { x: shape.x1, y: shape.y1 },
        { x: shape.x2, y: shape.y2 },
      ])
    case "polyline":
      return boxOfPoints(shape.points.map(([x, y]) => ({ x, y })))
    case "path": {
      const points = parsePathPoints(shape.d)
      return points ? boxOfPoints(points) : null
    }
  }
}

export function unionBox(boxes: (Box | null | undefined)[]): Box | null {
  const points: Point[] = []
  for (const b of boxes) {
    if (!b) continue
    points.push({ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y + b.h })
  }
  return boxOfPoints(points)
}

/** Bounds of a part: the union of its shapes. */
export function partBounds(shapes: Shape[]): Box | null {
  return unionBox(shapes.map(shapeBounds))
}

export const boxCenter = (b: Box): Point => ({
  x: b.x + b.w / 2,
  y: b.y + b.h / 2,
})

export const translateBox = (b: Box, o: Point): Box => ({
  ...b,
  x: b.x + o.x,
  y: b.y + o.y,
})

export const inflateBox = (b: Box, by: number): Box => ({
  x: b.x - by,
  y: b.y - by,
  w: b.w + by * 2,
  h: b.h + by * 2,
})

// ---------------------------------------------------------------------------
// Normalising streamed props

export function normalizeViewBox(raw: unknown): ViewBox {
  const v = (raw ?? {}) as Record<string, unknown>
  const ok = (n: unknown): n is number => finite(n) && n > 0 && n <= 10000
  return ok(v.width) && ok(v.height)
    ? { width: v.width, height: v.height }
    : DEFAULT_VIEWBOX
}

/** Complete systems only, first occurrence of each id, up to 8. */
export function normalizeSystems(raw: unknown): DiagramSystem[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DiagramSystem[] = []
  for (const s of raw) {
    if (!s || typeof s !== "object") continue
    const { id, label, summary } = s as Record<string, unknown>
    if (typeof id !== "string" || !id || typeof label !== "string" || !label)
      continue
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      label,
      summary: typeof summary === "string" && summary ? summary : undefined,
    })
    if (out.length === MAX_SYSTEMS) break
  }
  return out
}

/** The explode vector, capped at the viewBox size so a bad value can't fling a part away. */
export function clampExplode(raw: unknown, viewBox: ViewBox): Point {
  const e = (raw ?? {}) as Record<string, unknown>
  return {
    x: finite(e.dx) ? clamp(e.dx, -viewBox.width, viewBox.width) : 0,
    y: finite(e.dy) ? clamp(e.dy, -viewBox.height, viewBox.height) : 0,
  }
}

/**
 * Drawable parts: an id, a label and at least one complete shape. Duplicate
 * ids keep the first; at most 40 parts and 12 shapes each.
 */
export function normalizeParts(raw: unknown, viewBox: ViewBox): DiagramPart[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: DiagramPart[] = []
  for (const p of raw) {
    if (out.length === MAX_PARTS) break
    if (!p || typeof p !== "object") continue
    const r = p as Record<string, unknown>
    if (typeof r.id !== "string" || !r.id || seen.has(r.id)) continue
    if (typeof r.label !== "string" || !r.label) continue
    const shapes = (Array.isArray(r.shapes) ? r.shapes : [])
      .map(sanitizeShape)
      .filter((s): s is Shape => s !== null)
      .slice(0, MAX_SHAPES)
    const bbox = partBounds(shapes)
    if (!bbox) continue
    seen.add(r.id)
    const at = (r.labelAt ?? {}) as Record<string, unknown>
    out.push({
      id: r.id,
      label: r.label,
      system: typeof r.system === "string" && r.system ? r.system : undefined,
      shapes,
      bbox,
      explode: clampExplode(r.explode, viewBox),
      anchor:
        finite(at.x) && finite(at.y) ? { x: at.x, y: at.y } : boxCenter(bbox),
    })
  }
  return out
}

// ---------------------------------------------------------------------------
// Explode interpolation and layout

/** Slider value (0–100) to explode amount (0–1). */
export const explodeAmount = (value: number) =>
  finite(value) ? clamp(value / 100, 0, 1) : 0

/** A part's translate at explode amount `t`. */
export function offsetAt(explode: Point, t: number): Point {
  const k = clamp(finite(t) ? t : 0, 0, 1)
  return { x: explode.x * k, y: explode.y * k }
}

/** Where a part's label points at explode amount `t`. */
export function labelPoint(
  part: Pick<DiagramPart, "anchor" | "explode">,
  t: number,
): Point {
  const o = offsetAt(part.explode, t)
  return { x: part.anchor.x + o.x, y: part.anchor.y + o.y }
}

/**
 * The fixed frame the canvas shows: the viewBox plus every part both at rest
 * and fully exploded, padded, and widened or heightened so its aspect ratio
 * (height / width) stays within `minAspect`–`maxAspect`. Fixed, so dragging
 * the slider moves parts without zooming the drawing.
 */
export function canvasBox(
  viewBox: ViewBox,
  parts: Pick<DiagramPart, "bbox" | "explode">[],
  { pad = 8, minAspect = 0.45, maxAspect = 0.9 } = {},
): Box {
  const union = unionBox([
    { x: 0, y: 0, w: viewBox.width, h: viewBox.height },
    ...parts.flatMap((p) => [p.bbox, translateBox(p.bbox, p.explode)]),
  ]) ?? { x: 0, y: 0, w: viewBox.width, h: viewBox.height }
  let box = inflateBox(union, pad)
  const aspect = box.h / box.w
  if (aspect > maxAspect) {
    const w = box.h / maxAspect
    box = { ...box, x: box.x - (w - box.w) / 2, w }
  } else if (aspect < minAspect) {
    const h = box.w * minAspect
    box = { ...box, y: box.y - (h - box.h) / 2, h }
  }
  return box
}

/** A point as percentages of the canvas box, for positioning HTML over the SVG. */
export function toPercent(p: Point, box: Box): Point {
  return {
    x: clamp(((p.x - box.x) / box.w) * 100, 0, 100),
    y: clamp(((p.y - box.y) / box.h) * 100, 0, 100),
  }
}

/** Which way a label pill hangs off its point so it stays inside the canvas. */
export function labelPlacement(pct: Point): {
  align: "start" | "center" | "end"
  side: "above" | "below"
} {
  return {
    align: pct.x < 15 ? "start" : pct.x > 85 ? "end" : "center",
    side: pct.y < 18 ? "below" : "above",
  }
}

// ---------------------------------------------------------------------------
// System filtering

export const ALL = "all"

/** The filter to use: a known system id, or "all". */
export function resolveFilter(
  filter: string | undefined,
  systems: DiagramSystem[],
): string {
  return filter && systems.some((s) => s.id === filter) ? filter : ALL
}

/**
 * How a part is drawn: dimmed when a system is selected and the part isn't in
 * it. The active part (hovered or focused) is never dimmed.
 */
export function partTone(
  part: Pick<DiagramPart, "id" | "system">,
  filter: string,
  activeId: string | null,
): "active" | "normal" | "dim" {
  if (part.id === activeId) return "active"
  if (filter === ALL || part.system === filter) return "normal"
  return "dim"
}

export type PartGroup = {
  id: string
  label: string
  parts: DiagramPart[]
}

/** Parts grouped by system in system order; parts with an unknown system go last under "Other". */
export function groupParts(
  parts: DiagramPart[],
  systems: DiagramSystem[],
): PartGroup[] {
  const groups: PartGroup[] = systems.map((s) => ({
    id: s.id,
    label: s.label,
    parts: parts.filter((p) => p.system === s.id),
  }))
  const known = new Set(systems.map((s) => s.id))
  const other = parts.filter((p) => !p.system || !known.has(p.system))
  if (other.length) groups.push({ id: "", label: "Other", parts: other })
  return groups.filter((g) => g.parts.length > 0)
}

/** "A", "A and B", "A, B and C". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ""
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
}
