/**
 * Mechanism: pure helpers. No React, no Zod, no DOM, so they run anywhere
 * and test in Node.
 *
 * The isometric camera, the extruded solids and their four-tone shading are
 * ported from Anatomy's kit (kit/iso-kit.ts, MIT, © 2026 Ryan,
 * https://github.com/wheresryan22/anatomy), trimmed to what the schema needs:
 * prisms that stand on the floor, seen from a camera that turns about the
 * vertical axis.
 *
 * - Camera: world [x, y, z] (z up) to screen, depth for painting order.
 * - Solids: a floor outline extruded up, as fill, shades, top and lines.
 * - Parts: readiness while streaming, outlines for box, cylinder and gear,
 *   motion at a time t, and the whole scene sorted back to front.
 *
 * Inputs are typed loosely because the tool call may still be streaming.
 */

import type {
  MechanismMotion,
  MechanismPart,
  MechanismShape,
} from "./mechanism.schema"

export type Flat = [number, number]
export type Point3 = [number, number, number]
export type Plane = [number, number]

export interface Projection {
  origin: Flat
  scale: number
  azimuth: number
  elevation: number
}

export interface SolidPaths {
  fill: string
  outline: string
  crease: string
  top: string
  /** Visible sides bucketed by how they face the light, darkest first. */
  shades: string[]
}

export const AZIMUTH = 45
export const ELEVATION = 30
export const SHADES = 4

const RADIANS = Math.PI / 180
const UNIT = Math.sqrt(1.6)

// ---------------------------------------------------------------------------
// Camera

function cameraOf({ scale, azimuth, elevation }: Projection) {
  const a = azimuth * RADIANS
  const e = elevation * RADIANS
  return {
    sinA: Math.sin(a),
    cosA: Math.cos(a),
    sinE: Math.sin(e),
    cosE: Math.cos(e),
    k: scale * UNIT,
  }
}

/** World to screen. */
export function iso([x, y, z]: Point3, P: Projection): Flat {
  const { sinA, cosA, sinE, cosE, k } = cameraOf(P)
  return [
    P.origin[0] + (x * sinA - y * cosA) * k,
    P.origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k,
  ]
}

/** Larger is nearer the viewer; paint in ascending order. */
export function depthOf([x, y, z]: Point3, P: Projection) {
  const { sinA, cosA, sinE, cosE } = cameraOf(P)
  return (x * cosA + y * sinA) * cosE + z * sinE
}

/** The floor direction pointing at the viewer. */
export function towardViewer(P: Projection): Plane {
  const { sinA, cosA } = cameraOf(P)
  return [cosA, sinA]
}

/** Screen pixels per world unit. */
export const pixelsPerUnit = (P: Projection) => P.scale * UNIT

/** Any angle in degrees to 0 ≤ a < 360. */
export const normalizeAngle = (deg: number) => ((deg % 360) + 360) % 360

// ---------------------------------------------------------------------------
// Paths and outlines

const tenth = (value: number) => {
  const text = (Math.round(value * 10) / 10).toFixed(1).replace(/\.0$/, "")
  return text === "-0" ? "0" : text
}

export function pathOf(points: Flat[], closed = false) {
  if (!points.length) return ""
  return (
    points
      .map(([x, y], at) => `${at ? "L" : "M"}${tenth(x)} ${tenth(y)}`)
      .join("") + (closed ? "Z" : "")
  )
}

/** A rounded rectangle centred on (cx, cy), as floor points. */
export function roundedRect(
  cx: number,
  cy: number,
  w: number,
  d: number,
  r = 0,
  steps = 6,
): Plane[] {
  const x = cx - w / 2
  const y = cy - d / 2
  const radius = Math.max(0, Math.min(r, w / 2, d / 2))
  const corners: [number, number, number][] = [
    [x + w - radius, y + radius, -90],
    [x + w - radius, y + d - radius, 0],
    [x + radius, y + d - radius, 90],
    [x + radius, y + radius, 180],
  ]
  const out: Plane[] = []
  for (const [ccx, ccy, start] of corners) {
    const count = radius > 0 ? steps : 0
    for (let step = 0; step <= count; step++) {
      const angle = (start + (count ? (90 * step) / count : 45)) * RADIANS
      out.push([ccx + radius * Math.cos(angle), ccy + radius * Math.sin(angle)])
    }
  }
  return out
}

export function circleRing(
  cx: number,
  cy: number,
  r: number,
  steps = 40,
  phase = 0,
): Plane[] {
  return Array.from({ length: steps }, (_, step) => {
    const angle = phase + (step / steps) * Math.PI * 2
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as Plane
  })
}

/** Default tooth count: about one tooth per 6 units of radius. */
export const defaultTeeth = (r: number) =>
  Math.max(6, Math.min(60, Math.round(r / 6)))

/**
 * A spur gear's outline: `teeth` flat-topped teeth around a root circle,
 * turned by `phase` radians.
 */
export function gearRing(
  cx: number,
  cy: number,
  r: number,
  teeth: number,
  phase = 0,
): Plane[] {
  const n = Math.max(6, Math.round(teeth))
  const depth = Math.min(r * 0.18, 7)
  const root = r - depth
  const pitch = (Math.PI * 2) / n
  const out: Plane[] = []
  const at = (radius: number, angle: number): Plane => [
    cx + radius * Math.cos(angle),
    cy + radius * Math.sin(angle),
  ]
  for (let i = 0; i < n; i++) {
    const a = phase + i * pitch
    out.push(at(root, a))
    out.push(at(r, a + pitch * 0.12))
    out.push(at(r, a + pitch * 0.42))
    out.push(at(root, a + pitch * 0.54))
  }
  return out
}

/** Turns floor points about (cx, cy) by `angle` radians. */
export function rotateRing(
  ring: Plane[],
  cx: number,
  cy: number,
  angle: number,
): Plane[] {
  if (!angle) return ring
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return ring.map(([x, y]) => {
    const dx = x - cx
    const dy = y - cy
    return [cx + dx * c - dy * s, cy + dx * s + dy * c] as Plane
  })
}

function signedArea(points: Plane[] | Flat[]) {
  let area = 0
  for (let i = 0; i < points.length; i++) {
    const [ax, ay] = points[i]
    const [bx, by] = points[(i + 1) % points.length]
    area += ax * by - bx * ay
  }
  return area / 2
}

const oriented = (points: Flat[]) =>
  signedArea(points) < 0 ? [...points].reverse() : points

function convexHull(points: Flat[]): Flat[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (sorted.length < 3) return sorted
  const cross = (o: Flat, a: Flat, b: Flat) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Flat[] = []
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop()
    lower.push(p)
  }
  const upper: Flat[] = []
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/** Runs of consecutive edges whose flag equals `want`, as vertex indices. */
function runsOf(flags: boolean[], want: boolean) {
  const count = flags.length
  const runs: number[][] = []
  const start = flags.findIndex(
    (flag, i) => flag !== flags[(i + count - 1) % count],
  )
  if (start < 0)
    return flags[0] === want
      ? [Array.from({ length: count + 1 }, (_, i) => i % count)]
      : []
  let run: number[] | null = null
  for (let step = 0; step < count; step++) {
    const i = (start + step) % count
    if (flags[i] === want) {
      if (!run) run = [i]
      run.push((i + 1) % count)
    } else if (run) {
      runs.push(run)
      run = null
    }
  }
  if (run) runs.push(run)
  return runs
}

/**
 * A floor outline extruded straight up from `z` by `height`: the paper fill
 * that hides what's behind, the visible sides in four tones, the top, the
 * crease where top meets sides, and the silhouette. `convex: false` for
 * outlines with notches (gears).
 */
export function extrude(
  ring: Plane[],
  z: number,
  height: number,
  P: Projection,
  convex = true,
): SolidPaths {
  const count = ring.length
  const counter = signedArea(ring) > 0
  const [vx, vy] = towardViewer(P)
  const { sinA, cosA } = cameraOf(P)
  const normals = ring.map(([ax, ay], i) => {
    const [bx, by] = ring[(i + 1) % count]
    const dx = bx - ax
    const dy = by - ay
    const length = Math.hypot(dx, dy) || 1
    return (
      counter ? [dy / length, -dx / length] : [-dy / length, dx / length]
    ) as Plane
  })
  const facing = normals.map(([nx, ny]) => nx * vx + ny * vy > 1e-9)
  const top = ring.map(([x, y]) => iso([x, y, z + height], P))
  const bottom = ring.map(([x, y]) => iso([x, y, z], P))
  const outline: string[] = []
  const crease: string[] = []
  for (const run of runsOf(facing, false))
    outline.push(pathOf(run.map((i) => top[i])))
  for (const run of runsOf(facing, true)) {
    crease.push(pathOf(run.map((i) => top[i])))
    if (height > 0) outline.push(pathOf(run.map((i) => bottom[i])))
  }
  if (height > 0) {
    for (let i = 0; i < count; i++) {
      if (facing[(i + count - 1) % count] !== facing[i])
        outline.push(pathOf([top[i], bottom[i]]))
    }
  }
  let fill: string
  if (convex) {
    fill = pathOf(convexHull([...top, ...bottom]), true)
  } else {
    const parts = [pathOf(oriented(top), true), pathOf(oriented(bottom), true)]
    for (let i = 0; i < count; i++) {
      if (!facing[i]) continue
      const next = (i + 1) % count
      parts.push(
        pathOf(oriented([top[i], top[next], bottom[next], bottom[i]]), true),
      )
    }
    fill = parts.join("")
  }
  const buckets: string[][] = Array.from({ length: SHADES }, () => [])
  if (height > 0) {
    // The light comes from the viewer's left, so it turns with the camera.
    const [lx, ly] = [-sinA, cosA]
    for (let i = 0; i < count; i++) {
      if (!facing[i]) continue
      const [nx, ny] = normals[i]
      const lit = (nx * lx + ny * ly + 1) / 2
      const shade = Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)))
      const next = (i + 1) % count
      buckets[shade].push(
        pathOf(oriented([top[i], top[next], bottom[next], bottom[i]]), true),
      )
    }
  }
  return {
    fill,
    outline: outline.join(""),
    crease: crease.join(""),
    top: pathOf(oriented(top), true),
    shades: buckets.map((paths) => paths.join("")),
  }
}

// ---------------------------------------------------------------------------
// Round parts on any axis: a profile turned around a frame (Anatomy's lathe,
// simplified: flat-shaded facets, exact limbs, visible rims and creases)

export type Axis = "x" | "y" | "z"

export interface Frame {
  /** Where the axis starts (s = 0). */
  o: Point3
  /** Unit axis. */
  a: Point3
  /** Two unit radial directions; angle 0 points along u, turning toward w. */
  u: Point3
  w: Point3
}

/** A right-handed frame on a world axis: a = u × w. */
export function frameOf(o: Point3, axis: Axis = "z"): Frame {
  if (axis === "x") return { o, a: [1, 0, 0], u: [0, 1, 0], w: [0, 0, 1] }
  if (axis === "y") return { o, a: [0, 1, 0], u: [0, 0, 1], w: [1, 0, 0] }
  return { o, a: [0, 0, 1], u: [1, 0, 0], w: [0, 1, 0] }
}

const dot3 = (p: Point3, q: Point3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2]

/** The world point at distance s along the axis, radius r, angle th. */
export function pointOf(F: Frame, s: number, r: number, th: number): Point3 {
  const c = Math.cos(th) * r
  const n = Math.sin(th) * r
  return [
    F.o[0] + F.a[0] * s + F.u[0] * c + F.w[0] * n,
    F.o[1] + F.a[1] * s + F.u[1] * c + F.w[1] * n,
    F.o[2] + F.a[2] * s + F.u[2] * c + F.w[2] * n,
  ]
}

/** Unit vector toward the viewer, in world space. */
export function viewVector(P: Projection): Point3 {
  const a = P.azimuth * RADIANS
  const e = P.elevation * RADIANS
  return [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)]
}

/** 0 (darkest) to 3 (lightest), or 4 for faces that look up: the same light as extrude's sides. */
function shadeOf(n: Point3, P: Projection): number {
  if (n[2] > 0.85) return 4
  const a = P.azimuth * RADIANS
  const lit = settle(
    (n[0] * -Math.sin(a) + n[1] * Math.cos(a) + n[2] * 0.6 + 1) / 2,
  )
  return Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)))
}

/**
 * A value rounded far above floating-point noise, for ordering and bucketing.
 * Node and browsers can differ in the last bit of Math.sin and Math.cos, so
 * mirrored facets that tie in depth would sort differently on the server and
 * in the browser and break hydration.
 */
const settle = (v: number) => Math.round(v * 1e6) / 1e6

/**
 * A number written to the page as is (a bolt's position, a pipe's width),
 * rounded so the last bits of floating point, which differ between the
 * server's engine and the browser's, never reach an attribute.
 */
const hundredth = (v: number) => Math.round(v * 100) / 100

/** Valid [s, r] pairs (r ≥ 0), in order of s. */
export function readyProfile(profile: unknown): [number, number][] {
  if (!Array.isArray(profile)) return []
  const out: [number, number][] = []
  for (const p of profile) {
    if (Array.isArray(p) && finite(p[0]) && finite(p[1]) && p[1] >= 0)
      out.push([p[0], p[1]])
  }
  return out
    .map((p, i) => ({ p, i }))
    .sort((x, y) => x.p[0] - y.p[0] || x.i - y.i)
    .map(({ p }) => p)
}

export interface LatheDetail {
  open?: boolean
  ribs?: number
  rings?: number[]
  blades?: number
  bolts?: number
  /** Turned by spin, in radians: moves ribs, blades, bolts and the marker. */
  phase?: number
  /** Draw a radial marker on the end face (a spinning part with no other detail). */
  marker?: boolean
  /** Flat sides instead of a round body, 3 to 12: a square tower, a pyramid, a hex nut. */
  sides?: number
  /** Hollow centre of this radius through a straight body: its ends become rings. */
  bore?: number
}

/**
 * A straight body's half-section with a hole through it: out along the start
 * face, along the outside, back in along the end face, then down the bore.
 * Drawn open, so the bore's wall and both ring faces show.
 */
export function boredProfile(
  profile: [number, number][],
  bore: number,
): [number, number][] {
  if (profile.length < 2) return profile
  const [s0, r0] = profile[0]
  const [s1, r1] = profile[profile.length - 1]
  const hole = Math.min(bore, Math.min(r0, r1) * 0.98)
  if (!(hole > 0)) return profile
  return [[s0, hole], ...profile, [s1, hole], [s0, hole]]
}

export interface Facet {
  d: string
  /** 0–3 by facing, 4 for faces that look up. */
  shade: number
}

export interface LatheGeometry {
  /** Facets in painting order, merged into runs of one shade. */
  facets: Facet[]
  outline: string
  crease: string
  /** Ribs and seams: faint lines on the surface. */
  detail: string
  /** Blades, hub and marker on the end face. */
  marks: string
  dots: Flat[]
}

const LATHE_STEPS = 40

/** A profile turned around a frame, seen from P. */
export function latheGeometry(
  F: Frame,
  profileIn: [number, number][],
  P: Projection,
  opts: LatheDetail = {},
): LatheGeometry {
  const hollow =
    opts.bore && opts.bore > 0 ? boredProfile(profileIn, opts.bore) : null
  const profile = hollow ?? profileIn
  const V = viewVector(P)
  const aV = dot3(F.a, V)
  const uV = dot3(F.u, V)
  const wV = dot3(F.w, V)
  const R = Math.hypot(uV, wV)
  const phi = Math.atan2(wV, uV)
  const open = Boolean(opts.open) || Boolean(hollow)
  const sides =
    opts.sides && opts.sides >= 3 ? Math.min(12, Math.round(opts.sides)) : 0
  const N = sides || LATHE_STEPS
  const step = (Math.PI * 2) / N
  // A faceted body has a corner at `off`, so a square's sides face the frame's axes.
  const off = sides ? Math.PI / sides : 0
  const at = (s: number, r: number, th: number) => iso(pointOf(F, s, r, th), P)
  const radial = (th: number): Point3 => {
    const c = Math.cos(th)
    const n = Math.sin(th)
    return [
      F.u[0] * c + F.w[0] * n,
      F.u[1] * c + F.w[1] * n,
      F.u[2] * c + F.w[2] * n,
    ]
  }
  /** Outward normal of segment k at angle th (null for a degenerate segment). */
  const normalOf = (k: number, th: number): Point3 | null => {
    const [s0, r0] = profile[k]
    const [s1, r1] = profile[k + 1]
    const ds = s1 - s0
    const dr = r1 - r0
    const len = Math.hypot(ds, dr)
    if (len < 1e-9 || (r0 === 0 && r1 === 0)) return null
    const rad = radial(th)
    return [
      (-dr * F.a[0] + ds * rad[0]) / len,
      (-dr * F.a[1] + ds * rad[1]) / len,
      (-dr * F.a[2] + ds * rad[2]) / len,
    ]
  }
  const faces = (n: Point3 | null) => (n ? dot3(n, V) > 1e-6 : false)

  type Raw = { pts: Flat[]; depth: number; shade: number }
  const raw: Raw[] = []
  const last = profile.length - 1
  for (let k = 0; k < last; k++) {
    const [s0, r0] = profile[k]
    const [s1, r1] = profile[k + 1]
    for (let j = 0; j < N; j++) {
      const t0 = off + j * step
      const t1 = t0 + step
      let n = normalOf(k, t0 + step / 2)
      if (!n) continue
      if (!faces(n)) {
        if (!open) continue
        n = [-n[0], -n[1], -n[2]]
      }
      const quad: Point3[] = [
        pointOf(F, s0, r0, t0),
        pointOf(F, s0, r0, t1),
        pointOf(F, s1, r1, t1),
        pointOf(F, s1, r1, t0),
      ]
      const mid: Point3 = [
        (quad[0][0] + quad[2][0]) / 2,
        (quad[0][1] + quad[2][1]) / 2,
        (quad[0][2] + quad[2][2]) / 2,
      ]
      raw.push({
        pts: quad.map((q) => iso(q, P)),
        depth: settle(depthOf(mid, P)),
        shade: shadeOf(n, P),
      })
    }
  }
  // End faces of a closed body.
  const caps: { k: number; n: Point3 }[] = []
  if (!open && profile[0][1] > 0)
    caps.push({ k: 0, n: [-F.a[0], -F.a[1], -F.a[2]] })
  if (!open && profile[last][1] > 0) caps.push({ k: last, n: F.a })
  for (const cap of caps) {
    if (!faces(cap.n)) continue
    const [sc, rc] = profile[cap.k]
    const pts = Array.from({ length: N }, (_, j) => at(sc, rc, off + j * step))
    raw.push({
      pts,
      depth: settle(depthOf(pointOf(F, sc, 0, 0), P)),
      shade: shadeOf(cap.n, P),
    })
  }
  raw.sort((x, y) => x.depth - y.depth)
  const facets: Facet[] = []
  for (const f of raw) {
    const d = pathOf(oriented(f.pts), true)
    const prev = facets[facets.length - 1]
    if (prev && prev.shade === f.shade) prev.d += d
    else facets.push({ d, shade: f.shade })
  }

  // Limbs: where the surface turns away, solved exactly per segment. A
  // faceted body turns away at its corners instead (below).
  const outline: string[] = []
  for (const sign of sides ? [] : [1, -1]) {
    let run: Flat[] = []
    const flush = () => {
      if (run.length > 1) outline.push(pathOf(run))
      run = []
    }
    for (let k = 0; k < last; k++) {
      const [s0, r0] = profile[k]
      const [s1, r1] = profile[k + 1]
      const ds = s1 - s0
      if (Math.abs(ds) < 1e-9 || R < 1e-9 || (r0 === 0 && r1 === 0)) {
        flush()
        continue
      }
      const c = ((r1 - r0) * aV) / (ds * R)
      if (Math.abs(c) > 1) {
        flush()
        continue
      }
      const th = phi + sign * Math.acos(c)
      const a0 = at(s0, r0, th)
      const a1 = at(s1, r1, th)
      if (!run.length) run.push(a0)
      run.push(a1)
    }
    flush()
  }

  // Rings at each profile vertex: outline where one side shows, crease where
  // both show and the surface turns.
  const crease: string[] = []
  const sideFaces = (k: number, th: number, side: -1 | 1): Point3 | null => {
    if (side === -1) {
      if (k === 0)
        return !open && profile[0][1] > 0 ? (caps[0]?.n ?? null) : null
      return normalOf(k - 1, th)
    }
    if (k === last)
      return !open && profile[last][1] > 0 ? (F.a as Point3) : null
    return normalOf(k, th)
  }
  if (sides) {
    // Corners: an outline where one neighbouring side shows, a crease where both do.
    for (let k = 0; k < last; k++) {
      const [s0, r0] = profile[k]
      const [s1, r1] = profile[k + 1]
      if (r0 <= 0 && r1 <= 0) continue
      for (let j = 0; j < N; j++) {
        const th = off + j * step
        const nb = normalOf(k, th - step / 2)
        const na = normalOf(k, th + step / 2)
        const vb = open ? nb !== null : faces(nb)
        const va = open ? na !== null : faces(na)
        if (!vb && !va) continue
        const edge = pathOf([at(s0, r0, th), at(s1, r1, th)])
        if (vb && va) crease.push(edge)
        else outline.push(edge)
      }
    }
    // Rings: each side's edge, classed by the faces above and below it.
    for (let k = 0; k <= last; k++) {
      const [sk, rk] = profile[k]
      if (rk <= 0) continue
      for (let j = 0; j < N; j++) {
        const th = off + (j + 0.5) * step
        const nb = sideFaces(k, th, -1)
        const na = sideFaces(k, th, 1)
        const vb = open ? nb !== null : faces(nb)
        const va = open ? na !== null : faces(na)
        if (!vb && !va) continue
        const turn = nb && na ? dot3(nb, na) : 1
        const edge = pathOf([
          at(sk, rk, off + j * step),
          at(sk, rk, off + (j + 1) * step),
        ])
        if (vb !== va) outline.push(edge)
        else if (turn < 0.985) crease.push(edge)
      }
    }
  }
  for (let k = 0; k <= (sides ? -1 : last); k++) {
    const [sk, rk] = profile[k]
    if (rk <= 0) continue
    const cls: (0 | 1 | 2)[] = []
    for (let j = 0; j <= N; j++) {
      const th = j * step
      const nb = sideFaces(k, th, -1)
      const na = sideFaces(k, th, 1)
      const vb = open ? nb !== null : faces(nb)
      const va = open ? na !== null : faces(na)
      if (vb && va) {
        const turn = nb && na ? dot3(nb, na) : 1
        cls.push(turn < 0.985 ? 2 : 0)
      } else cls.push(vb || va ? 1 : 0)
    }
    for (const want of [1, 2] as const) {
      let run: Flat[] = []
      const target = want === 1 ? outline : crease
      for (let j = 0; j <= N; j++) {
        if (cls[j] === want) run.push(at(sk, rk, j * step))
        else {
          if (run.length > 1) target.push(pathOf(run))
          run = []
        }
      }
      if (run.length > 1) target.push(pathOf(run))
    }
  }

  // Ribs and seams, only where the surface faces the viewer.
  const detail: string[] = []
  const phase = opts.phase ?? 0
  if (opts.ribs && opts.ribs >= 3) {
    for (let i = 0; i < opts.ribs; i++) {
      const th = phase + (i * Math.PI * 2) / opts.ribs
      let run: Flat[] = []
      for (let k = 0; k < last; k++) {
        const [s0, r0] = profile[k]
        const [s1, r1] = profile[k + 1]
        const n = normalOf(k, th)
        if (Math.abs(s1 - s0) > 1e-9 && faces(n)) {
          if (!run.length) run.push(at(s0, r0, th))
          run.push(at(s1, r1, th))
        } else {
          if (run.length > 1) detail.push(pathOf(run))
          run = []
        }
      }
      if (run.length > 1) detail.push(pathOf(run))
    }
  }
  for (const sr of opts.rings ?? []) {
    if (!finite(sr)) continue
    const k = profile.findIndex(
      (p, i) =>
        i < last &&
        p[0] <= sr &&
        sr <= profile[i + 1][0] &&
        profile[i + 1][0] > p[0],
    )
    if (k < 0) continue
    const [s0, r0] = profile[k]
    const [s1, r1] = profile[k + 1]
    const r = r0 + ((r1 - r0) * (sr - s0)) / (s1 - s0)
    let run: Flat[] = []
    for (let j = 0; j <= N; j++) {
      const th = off + j * step
      if (faces(normalOf(k, sides ? th - step / 2 : th)))
        run.push(at(sr, r, th))
      else {
        if (run.length > 1) detail.push(pathOf(run))
        run = []
      }
    }
    if (run.length > 1) detail.push(pathOf(run))
  }

  // Blades, bolts and a marker on the far end face.
  const marks: string[] = []
  const dots: Flat[] = []
  const ends = profileIn
  let fk = ends.length - 1
  while (fk > 0 && ends[fk][1] <= 0) fk--
  const [sf, rf] = ends[fk]
  const faceSeen = open ? Math.abs(aV) > 0.08 : aV > 0.08
  if (rf > 0 && faceSeen) {
    if (opts.blades && opts.blades >= 2) {
      for (let i = 0; i < opts.blades; i++) {
        const th = phase + (i * Math.PI * 2) / opts.blades
        // A swept vane: root behind the tip, so the rotor reads as a fan.
        marks.push(
          pathOf([
            at(sf, rf * 0.24, th),
            at(sf, rf * 0.62, th + 0.12),
            at(sf, rf * 0.94, th + 0.3),
          ]),
        )
      }
      marks.push(
        pathOf(
          Array.from({ length: 24 }, (_, j) =>
            at(sf, rf * 0.22, (j * Math.PI * 2) / 24),
          ),
          true,
        ),
      )
    } else if (opts.marker) {
      marks.push(pathOf([at(sf, 0, 0), at(sf, rf * 0.78, phase)]))
      marks.push(
        pathOf(
          Array.from({ length: 24 }, (_, j) =>
            at(sf, rf * 0.14, (j * Math.PI * 2) / 24),
          ),
          true,
        ),
      )
    }
    if (opts.bolts && opts.bolts >= 3) {
      for (let i = 0; i < opts.bolts; i++)
        dots.push(
          at(sf, rf * 0.82, phase + (i * Math.PI * 2) / opts.bolts).map(
            hundredth,
          ) as Flat,
        )
    }
  }

  return {
    facets,
    outline: outline.join(""),
    crease: crease.join(""),
    detail: detail.join(""),
    marks: marks.join(""),
    dots,
  }
}

/**
 * A profile as an open truss, seen from P: legs at the corners of `sides`
 * flat faces, a ring at each profile point and X-bracing on every face, with
 * no fill, so what's behind shows through. The near members are outlines and
 * marks; the far ones are faint detail.
 */
export function latticeGeometry(
  F: Frame,
  profile: [number, number][],
  P: Projection,
  sidesIn = 4,
  phase = 0,
): LatheGeometry {
  const V = viewVector(P)
  const N = Math.max(3, Math.min(12, Math.round(sidesIn)))
  const step = (Math.PI * 2) / N
  const off = Math.PI / N + phase
  const at = (s: number, r: number, th: number) => iso(pointOf(F, s, r, th), P)
  const last = profile.length - 1
  /** Whether face j of segment k turns toward the viewer. */
  const front = (k: number, j: number) => {
    const [s0, r0] = profile[k]
    const [s1, r1] = profile[k + 1]
    const th = off + (j + 0.5) * step
    const c = Math.cos(th)
    const n = Math.sin(th)
    const rad: Point3 = [
      F.u[0] * c + F.w[0] * n,
      F.u[1] * c + F.w[1] * n,
      F.u[2] * c + F.w[2] * n,
    ]
    const ds = s1 - s0
    const dr = r1 - r0
    const normal: Point3 = [
      -dr * F.a[0] + ds * rad[0],
      -dr * F.a[1] + ds * rad[1],
      -dr * F.a[2] + ds * rad[2],
    ]
    return dot3(normal, V) > 0
  }
  const near: string[] = []
  const braces: string[] = []
  const far: string[] = []
  for (let k = 0; k < last; k++) {
    const [s0, r0] = profile[k]
    const [s1, r1] = profile[k + 1]
    if (r0 <= 0 && r1 <= 0) continue
    // Legs.
    for (let j = 0; j < N; j++) {
      const th = off + j * step
      const shown = front(k, j) || front(k, (j + N - 1) % N)
      ;(shown ? near : far).push(pathOf([at(s0, r0, th), at(s1, r1, th)]))
    }
    // Bracing: square-ish panels, one X each.
    const width = (r0 + r1) * Math.sin(Math.PI / N)
    const length = Math.hypot(s1 - s0, r1 - r0)
    const panels =
      width > 0 ? Math.max(1, Math.min(12, Math.round(length / width))) : 1
    for (let j = 0; j < N; j++) {
      const ta = off + j * step
      const tb = ta + step
      const target = front(k, j) ? braces : far
      for (let q = 0; q < panels; q++) {
        const f0 = q / panels
        const f1 = (q + 1) / panels
        const sA = s0 + (s1 - s0) * f0
        const rA = r0 + (r1 - r0) * f0
        const sB = s0 + (s1 - s0) * f1
        const rB = r0 + (r1 - r0) * f1
        target.push(pathOf([at(sA, rA, ta), at(sB, rB, tb)]))
        target.push(pathOf([at(sA, rA, tb), at(sB, rB, ta)]))
      }
    }
  }
  // Rings at each profile point.
  for (let k = 0; k <= last; k++) {
    const [sk, rk] = profile[k]
    if (rk <= 0) continue
    for (let j = 0; j < N; j++) {
      const shown = (k > 0 && front(k - 1, j)) || (k < last && front(k, j))
      ;(shown ? near : far).push(
        pathOf([at(sk, rk, off + j * step), at(sk, rk, off + (j + 1) * step)]),
      )
    }
  }
  return {
    facets: [],
    outline: near.join(""),
    crease: "",
    detail: far.join(""),
    marks: braces.join(""),
    dots: [],
  }
}

/**
 * An open rotor seen from P: `blades` flat blades from a hub, in the plane at
 * the frame's origin, with nothing between them. Windmill sails, a
 * propeller, a wind turbine or a helicopter's rotor.
 */
export function rotorGeometry(
  F: Frame,
  r: number,
  blades: number,
  chord: number,
  P: Projection,
  phase = 0,
): LatheGeometry {
  const V = viewVector(P)
  const aV = dot3(F.a, V)
  const hubR = Math.max(r * 0.05, Math.min(r * 0.12, chord * r * 0.4))
  const rootW = chord * r
  const tipW = rootW * 0.75
  const n = Math.max(2, Math.min(12, Math.round(blades)))
  const facing: Point3 = aV >= 0 ? F.a : [-F.a[0], -F.a[1], -F.a[2]]
  const shade = shadeOf(facing, P)
  const facets: Facet[] = []
  const outline: string[] = []
  for (let i = 0; i < n; i++) {
    const th = phase + (i * Math.PI * 2) / n
    const along = (rad: number, side: number) => {
      const t = th + Math.atan2(side, rad)
      return iso(pointOf(F, 0, Math.hypot(rad, side), t), P)
    }
    const blade = [
      along(hubR * 0.9, -rootW / 2),
      along(r, -tipW / 2),
      along(r, tipW / 2),
      along(hubR * 0.9, rootW / 2),
    ]
    const d = pathOf(blade, true)
    facets.push({ d, shade })
    outline.push(d)
  }
  // The hub: a short nose along the axis, drawn over the blade roots.
  const hub = latheGeometry(
    F,
    [
      [-hubR * 0.8, hubR],
      [hubR * 0.6, hubR],
      [hubR * 1.8, 0],
    ],
    P,
  )
  return {
    facets: [...facets, ...hub.facets],
    outline: outline.join("") + hub.outline,
    crease: hub.crease,
    detail: "",
    marks: "",
    dots: [],
  }
}

/** Lines on the visible sides of a box: windows, vents or panels. */
function boxPattern(
  corners: Plane[],
  z0: number,
  h: number,
  pattern: "windows" | "vents" | "panels",
  P: Projection,
): string {
  if (h <= 0) return ""
  const [vx, vy] = towardViewer(P)
  const counter = signedArea(corners) > 0
  const out: string[] = []
  for (let i = 0; i < corners.length; i++) {
    const A = corners[i]
    const B = corners[(i + 1) % corners.length]
    const dx = B[0] - A[0]
    const dy = B[1] - A[1]
    const len = Math.hypot(dx, dy)
    if (len < 1e-6) continue
    const [nx, ny] = counter ? [dy / len, -dx / len] : [-dy / len, dx / len]
    if (nx * vx + ny * vy <= 1e-6) continue
    const on = (f: number, z: number) =>
      iso([A[0] + dx * f, A[1] + dy * f, z], P)
    if (pattern === "windows") {
      const cols = Math.max(1, Math.min(40, Math.floor(len / 7)))
      const rows = Math.max(1, Math.min(80, Math.floor(h / 7)))
      const cellH = h / rows
      for (let r = 0; r < rows; r++) {
        const zc = z0 + (r + 0.5) * cellH
        for (let c = 0; c < cols; c++) {
          const f = (c + 0.5) / cols
          out.push(pathOf([on(f, zc - cellH * 0.3), on(f, zc + cellH * 0.3)]))
        }
      }
    } else if (pattern === "vents") {
      const count = Math.max(2, Math.min(14, Math.floor((h * 0.6) / 4)))
      for (let k = 0; k < count; k++) {
        const z = z0 + h * (0.2 + (0.6 * (k + 0.5)) / count)
        out.push(pathOf([on(0.18, z), on(0.82, z)]))
      }
    } else {
      const inset = Math.min(6, len * 0.12, h * 0.12)
      const f0 = inset / len
      const f1 = 1 - f0
      out.push(
        pathOf(
          [
            on(f0, z0 + inset),
            on(f1, z0 + inset),
            on(f1, z0 + h - inset),
            on(f0, z0 + h - inset),
          ],
          true,
        ),
      )
    }
  }
  return out.join("")
}

// ---------------------------------------------------------------------------
// Parts

const finite = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n)
const positive = (n: unknown): n is number => finite(n) && n > 0
const nonNegative = (n: unknown): n is number => finite(n) && n >= 0

const isPoint3 = (p: unknown): p is Point3 =>
  Array.isArray(p) &&
  p.length >= 3 &&
  finite(p[0]) &&
  finite(p[1]) &&
  finite(p[2])

/** A shape is drawable once its required numbers are there. */
export function isShape(s: unknown): s is MechanismShape {
  if (!s || typeof s !== "object") return false
  const shape = s as Partial<Record<string, unknown>>
  switch (shape.type) {
    case "box":
      return (
        finite(shape.x) &&
        finite(shape.y) &&
        positive(shape.w) &&
        positive(shape.d) &&
        nonNegative(shape.h)
      )
    case "cylinder":
    case "gear":
      return (
        finite(shape.x) &&
        finite(shape.y) &&
        positive(shape.r) &&
        nonNegative(shape.h)
      )
    case "lathe": {
      const prof = readyProfile(shape.profile)
      return (
        finite(shape.x) &&
        finite(shape.y) &&
        prof.length >= 2 &&
        prof.some(([, r]) => r > 0) &&
        prof[prof.length - 1][0] > prof[0][0]
      )
    }
    case "rotor":
      return (
        finite(shape.x) &&
        finite(shape.y) &&
        positive(shape.r) &&
        finite(shape.blades) &&
        shape.blades >= 2
      )
    case "pipe":
      return (
        Array.isArray(shape.points) && shape.points.filter(isPoint3).length >= 2
      )
    default:
      return false
  }
}

/** Ready parts, first occurrence of each id, in the given order. */
export function readyParts(
  parts: (Partial<MechanismPart> | undefined)[] | undefined,
): MechanismPart[] {
  const seen = new Set<string>()
  const out: MechanismPart[] = []
  for (const p of parts ?? []) {
    if (
      !p ||
      typeof p.id !== "string" ||
      typeof p.label !== "string" ||
      !isShape(p.shape) ||
      seen.has(p.id)
    )
      continue
    seen.add(p.id)
    out.push(p as MechanismPart)
  }
  return out
}

/** A motion that can actually play on this shape, else null. */
export function motionOf(part: MechanismPart): MechanismMotion | null {
  const m = part.motion
  if (!m) return null
  if (m.type === "spin")
    return part.shape.type !== "pipe" && finite(m.speed) && m.speed !== 0
      ? m
      : null
  if (m.type === "flow") return part.shape.type === "pipe" ? m : null
  if (m.type === "slide")
    return Array.isArray(m.by) && m.by.slice(0, 3).every(finite) ? m : null
  return null
}

/** True when any part moves. */
export const hasMotion = (parts: MechanismPart[]) =>
  parts.some((p) => motionOf(p) !== null)

/** A slide's offset at time t (seconds): out and back on a cosine, starting at rest. */
export function slideOffset(
  by: [number, number, number],
  seconds: number | undefined,
  t: number,
): Point3 {
  const period = finite(seconds) && seconds > 0 ? seconds : 2
  const f = (1 - Math.cos((2 * Math.PI * t) / period)) / 2
  return [by[0] * f, by[1] * f, by[2] * f]
}

/** A spin's angle in radians at time t (seconds). */
export const spinAngle = (speed: number, t: number) => 2 * Math.PI * speed * t

/** Pipe points that are valid. */
const pipePoints = (shape: Extract<MechanismShape, { type: "pipe" }>) =>
  shape.points.filter(isPoint3)

type RoundShape = Extract<MechanismShape, { type: "cylinder" | "lathe" }>

/** A round part's frame and profile; a cylinder is a two-point profile. */
function roundOf(s: RoundShape, off: Point3 = [0, 0, 0]) {
  const F = frameOf(
    [s.x + off[0], s.y + off[1], (s.z ?? 0) + off[2]],
    s.axis ?? "z",
  )
  const profile: [number, number][] =
    s.type === "cylinder"
      ? [
          [0, s.r],
          [s.h, s.r],
        ]
      : readyProfile(s.profile)
  return { F, profile }
}

/** The extreme points of a part, for fitting the view. */
export function extremesOf(part: MechanismPart): Point3[] {
  const s = part.shape
  const out: Point3[] = []
  const lift = (
    part.motion?.type === "slide" && Array.isArray(part.motion.by)
      ? part.motion.by
      : [0, 0, 0]
  ) as Point3
  const push = (p: Point3) => {
    out.push(p)
    if (lift.some((v) => v))
      out.push([p[0] + lift[0], p[1] + lift[1], p[2] + lift[2]])
  }
  if (s.type === "pipe") {
    const r = s.r ?? 3
    for (const [x, y, z] of pipePoints(s)) {
      push([x - r, y - r, z - r])
      push([x + r, y + r, z + r])
    }
    return out
  }
  if (s.type === "cylinder" || s.type === "lathe") {
    const { F, profile } = roundOf(s)
    for (const [ps, pr] of profile)
      for (let j = 0; j < 8; j++) push(pointOf(F, ps, pr, (j * Math.PI) / 4))
    return out
  }
  if (s.type === "rotor") {
    // Blades sweep the whole circle as the rotor turns.
    const F = frameOf([s.x, s.y, s.z ?? 0], s.axis ?? "z")
    for (let j = 0; j < 8; j++) push(pointOf(F, 0, s.r, (j * Math.PI) / 4))
    return out
  }
  const z0 = s.z ?? 0
  const z1 = z0 + s.h
  const halfW = s.type === "box" ? s.w / 2 : s.r
  const halfD = s.type === "box" ? s.d / 2 : s.r
  // A box can spin, so take the corners' full reach.
  const reach =
    s.type === "box" && part.motion?.type === "spin"
      ? Math.hypot(halfW, halfD)
      : null
  const w = reach ?? halfW
  const d = reach ?? halfD
  for (const dx of [-w, w])
    for (const dy of [-d, d])
      for (const z of [z0, z1]) push([s.x + dx, s.y + dy, z])
  return out
}

/** Where a part sits, for painting order. */
export function centreOf(part: MechanismPart): Point3 {
  const s = part.shape
  if (s.type === "pipe") {
    const pts = pipePoints(s)
    const sum = pts.reduce<Point3>(
      (acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]],
      [0, 0, 0],
    )
    return [sum[0] / pts.length, sum[1] / pts.length, sum[2] / pts.length]
  }
  if (s.type === "cylinder" || s.type === "lathe") {
    const { F, profile } = roundOf(s)
    const mid = (profile[0][0] + profile[profile.length - 1][0]) / 2
    return pointOf(F, mid, 0, 0)
  }
  if (s.type === "rotor") return [s.x, s.y, s.z ?? 0]
  const z0 = s.z ?? 0
  return [s.x, s.y, z0 + s.h / 2]
}

export interface View {
  /** World point at the middle of the card. */
  centre: Point3
  /** Screen scale that fits every angle of the camera. */
  scale: number
}

/**
 * The drawing's height for a width, from the object's shape over every
 * camera angle: a tower gets a tall card, an engine a wide one.
 */
export function figureHeight(
  points: Point3[],
  width: number,
  { min = 300, max = 520, pad = 28, elevation = ELEVATION } = {},
): number {
  if (!points.length) return min
  let spanX = 0
  let spanY = 0
  for (let azimuth = 0; azimuth < 360; azimuth += 15) {
    const P: Projection = { origin: [0, 0], scale: 1, azimuth, elevation }
    const xs = points.map((p) => iso(p, P))
    const lx = Math.min(...xs.map((q) => q[0]))
    const hx = Math.max(...xs.map((q) => q[0]))
    const ly = Math.min(...xs.map((q) => q[1]))
    const hy = Math.max(...xs.map((q) => q[1]))
    spanX = Math.max(spanX, hx - lx)
    spanY = Math.max(spanY, hy - ly)
  }
  if (spanX <= 0) return min
  const h = (width - 2 * pad) * (spanY / spanX) + 2 * pad
  return Math.round(Math.min(max, Math.max(min, h)))
}

/**
 * One scale and centre for every camera angle, so turning the view never
 * resizes the figure: the smallest scale that fits the extremes in the
 * box, checked every 15°.
 */
export function fitView(
  points: Point3[],
  width: number,
  height: number,
  pad = 24,
  elevation = ELEVATION,
): View | null {
  if (!points.length) return null
  const lo: Point3 = [Infinity, Infinity, Infinity]
  const hi: Point3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i])
      hi[i] = Math.max(hi[i], p[i])
    }
  const centre: Point3 = [
    (lo[0] + hi[0]) / 2,
    (lo[1] + hi[1]) / 2,
    (lo[2] + hi[2]) / 2,
  ]
  let scale = Infinity
  for (let azimuth = 0; azimuth < 360; azimuth += 15) {
    const P: Projection = { origin: [0, 0], scale: 1, azimuth, elevation }
    const c = iso(centre, P)
    let spanX = 0
    let spanY = 0
    for (const p of points) {
      const [sx, sy] = iso(p, P)
      spanX = Math.max(spanX, Math.abs(sx - c[0]))
      spanY = Math.max(spanY, Math.abs(sy - c[1]))
    }
    const fitX = spanX > 0 ? (width / 2 - pad) / spanX : Infinity
    const fitY = spanY > 0 ? (height / 2 - pad) / spanY : Infinity
    scale = Math.min(scale, fitX, fitY)
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1
  return { centre, scale }
}

/** The projection for a view at one camera angle, centred in the box. */
export function projectionFor(
  view: View,
  azimuth: number,
  width: number,
  height: number,
  elevation = ELEVATION,
): Projection {
  const P: Projection = {
    origin: [0, 0],
    scale: view.scale,
    azimuth,
    elevation,
  }
  const [cx, cy] = iso(view.centre, P)
  return { ...P, origin: [width / 2 - cx, height / 2 - cy] }
}

export type SceneItem =
  | {
      id: string
      kind: "solid"
      depth: number
      paths: SolidPaths
      /**
       * Opaque facets in painting order (round parts). When present they
       * replace paths.fill, paths.shades and paths.top.
       */
      facets?: Facet[]
      /** Drawn as a see-through shell: fills faint, so what's inside shows. */
      ghost: boolean
      /** Marks on a face: a hub ring, blades, a spin marker. */
      marks: string
      /** Faint lines on the surface: windows, vents, panels, ribs, seams. */
      detail: string
      /** Bolt heads. */
      dots: Flat[]
      /**
       * Paint the top face last, opaque and outlined. For notched outlines
       * (gears), whose hidden back flanks project onto the top face.
       */
      topLast: boolean
    }
  | {
      id: string
      kind: "pipe"
      depth: number
      d: string
      /** Stroke width in screen pixels. */
      width: number
      /** Flow speed when the pipe flows, else 0. */
      flow: number
      /** Only the flow is drawn, no tube. */
      stream: boolean
    }

const NO_PATHS: SolidPaths = {
  fill: "",
  outline: "",
  crease: "",
  top: "",
  shades: ["", "", "", ""],
}

/** One part at time t, in screen space. */
export function partItem(
  part: MechanismPart,
  P: Projection,
  t: number,
): SceneItem {
  const s = part.shape
  const motion = motionOf(part)
  const off: Point3 =
    motion?.type === "slide"
      ? slideOffset(motion.by, motion.seconds, t)
      : [0, 0, 0]
  const angle = motion?.type === "spin" ? spinAngle(motion.speed, t) : 0
  const centre = centreOf(part)
  const depth = settle(
    depthOf([centre[0] + off[0], centre[1] + off[1], centre[2] + off[2]], P),
  )
  if (s.type === "pipe") {
    const pts = pipePoints(s).map(([x, y, z]) =>
      iso([x + off[0], y + off[1], z + off[2]], P),
    )
    return {
      id: part.id,
      kind: "pipe",
      depth,
      d: pathOf(pts),
      width: hundredth(Math.max(1.5, 2 * (s.r ?? 3) * pixelsPerUnit(P))),
      flow: motion?.type === "flow" ? (motion.speed ?? 1) : 0,
      stream: Boolean(s.stream),
    }
  }
  if (s.type === "rotor") {
    const F = frameOf(
      [s.x + off[0], s.y + off[1], (s.z ?? 0) + off[2]],
      s.axis ?? "z",
    )
    const g = rotorGeometry(F, s.r, s.blades, s.chord ?? 0.15, P, angle)
    return {
      id: part.id,
      kind: "solid",
      depth,
      paths: { ...NO_PATHS, outline: g.outline, crease: g.crease },
      facets: g.facets,
      marks: "",
      detail: "",
      dots: [],
      topLast: false,
      ghost: Boolean(part.ghost),
    }
  }
  if (s.type === "cylinder" || s.type === "lathe") {
    const { F, profile } = roundOf(s, off)
    const g = s.lattice
      ? latticeGeometry(F, profile, P, s.sides ?? 4, angle)
      : latheGeometry(F, profile, P, {
          open: s.type === "lathe" ? s.open : false,
          bore: s.type === "cylinder" ? s.bore : undefined,
          sides: s.sides,
          ribs: s.ribs,
          rings: s.rings,
          blades: s.blades,
          bolts: s.bolts,
          phase: angle,
          marker: motion?.type === "spin" && !s.blades && !s.ribs && !s.bolts,
        })
    return {
      id: part.id,
      kind: "solid",
      depth,
      paths: { ...NO_PATHS, outline: g.outline, crease: g.crease },
      facets: g.facets,
      marks: g.marks,
      detail: g.detail,
      dots: g.dots,
      topLast: false,
      ghost: Boolean(part.ghost),
    }
  }
  const cx = s.x + off[0]
  const cy = s.y + off[1]
  const z0 = (s.z ?? 0) + off[2]
  const z1 = z0 + s.h
  let ring: Plane[]
  let convex = true
  let detail = ""
  if (s.type === "box") {
    ring = rotateRing(roundedRect(cx, cy, s.w, s.d, s.r ?? 0), cx, cy, angle)
    if (s.pattern) {
      const corners = rotateRing(
        roundedRect(cx, cy, s.w, s.d, 0),
        cx,
        cy,
        angle,
      )
      detail = boxPattern(corners, z0, s.h, s.pattern, P)
    }
  } else {
    ring = gearRing(cx, cy, s.r, s.teeth ?? defaultTeeth(s.r), angle)
    convex = false
  }
  const paths = extrude(ring, z0, s.h, P, convex)
  const marks: string[] = []
  if (s.type === "gear") {
    // Hub and bore on the top face.
    marks.push(
      pathOf(
        circleRing(cx, cy, s.r * 0.32, 32).map(([x, y]) => iso([x, y, z1], P)),
        true,
      ),
    )
    marks.push(
      pathOf(
        circleRing(cx, cy, s.r * 0.12, 24).map(([x, y]) => iso([x, y, z1], P)),
        true,
      ),
    )
  }
  return {
    id: part.id,
    kind: "solid",
    depth,
    paths,
    marks: marks.join(""),
    detail,
    dots: [],
    topLast: !convex,
    ghost: Boolean(part.ghost),
  }
}

interface Bounds {
  lo: Point3
  hi: Point3
}

function boundsOf(points: Point3[]): Bounds {
  const lo: Point3 = [Infinity, Infinity, Infinity]
  const hi: Point3 = [-Infinity, -Infinity, -Infinity]
  for (const p of points)
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i], p[i])
      hi[i] = Math.max(hi[i], p[i])
    }
  return { lo, hi }
}

const EPS = 0.5

/**
 * -1 when a must be painted before b, 1 when after, 0 when it doesn't
 * matter. A part resting on another (footprints overlap, one above the
 * other) goes after it; otherwise a part wholly behind another along the
 * view direction goes first.
 */
function paintOrder(a: Bounds, b: Bounds, toward: Plane): number {
  const overlapX = a.lo[0] < b.hi[0] - EPS && b.lo[0] < a.hi[0] - EPS
  const overlapY = a.lo[1] < b.hi[1] - EPS && b.lo[1] < a.hi[1] - EPS
  if (overlapX && overlapY) {
    if (a.hi[2] <= b.lo[2] + EPS) return -1
    if (b.hi[2] <= a.lo[2] + EPS) return 1
  }
  const along = (bx: Bounds) => {
    const xs = [bx.lo[0], bx.hi[0]]
    const ys = [bx.lo[1], bx.hi[1]]
    let lo = Infinity
    let hi = -Infinity
    for (const x of xs)
      for (const y of ys) {
        const v = x * toward[0] + y * toward[1]
        lo = Math.min(lo, v)
        hi = Math.max(hi, v)
      }
    return [lo, hi] as const
  }
  const [aLo, aHi] = along(a)
  const [bLo, bHi] = along(b)
  if (aHi <= bLo + EPS) return -1
  if (bHi <= aLo + EPS) return 1
  return 0
}

/**
 * A see-through shell is painted over what is inside it, so the parts show
 * through its faint faces and its outline stays on top. -1 when a goes first,
 * 1 when after, 0 when neither is a ghost or they don't overlap (one that
 * merely rests on or touches another is ordered as usual).
 */
function ghostOrder(
  a: MechanismPart,
  b: MechanismPart,
  ba: Bounds,
  bb: Bounds,
): number {
  if (Boolean(a.ghost) === Boolean(b.ghost)) return 0
  const inside = [0, 1, 2].every(
    (i) => ba.lo[i] < bb.hi[i] - EPS && bb.lo[i] < ba.hi[i] - EPS,
  )
  if (!inside) return 0
  return a.ghost ? 1 : -1
}

/**
 * A rotor is flat, so the side of its plane decides: a part on the viewer's
 * side is drawn after it, a part beyond it first. -1 when a goes first, 1
 * when after, 0 when neither is a rotor or it can't tell. Box overlap can't
 * decide this: sails and the tower behind them overlap in every direction.
 */
function rotorOrder(
  a: MechanismPart,
  b: MechanismPart,
  ba: Bounds,
  bb: Bounds,
  V: Point3,
): number {
  const mid = (x: Bounds): Point3 => [
    (x.lo[0] + x.hi[0]) / 2,
    (x.lo[1] + x.hi[1]) / 2,
    (x.lo[2] + x.hi[2]) / 2,
  ]
  const side = (rotor: MechanismPart, hub: Point3, other: Point3) => {
    if (rotor.shape.type !== "rotor") return 0
    const n = frameOf(hub, rotor.shape.axis ?? "z").a
    const d = dot3([other[0] - hub[0], other[1] - hub[1], other[2] - hub[2]], n)
    const facing = dot3(V, n)
    if (Math.abs(d) < EPS || Math.abs(facing) < 1e-6) return 0
    return d * facing > 0 ? 1 : -1
  }
  if (a.shape.type === "rotor" && b.shape.type !== "rotor")
    return -side(a, mid(ba), mid(bb))
  if (b.shape.type === "rotor" && a.shape.type !== "rotor")
    return side(b, mid(bb), mid(ba))
  return 0
}

/**
 * Every part at time t, sorted back to front: a topological order over
 * the pairs paintOrder can decide, taking the farthest part (by centre
 * depth) whenever several are free.
 */
export function buildScene(
  parts: MechanismPart[],
  P: Projection,
  t: number,
): SceneItem[] {
  const items = parts.map((p) => partItem(p, P, t))
  const bounds = parts.map((p) => {
    const m = motionOf(p)
    const off: Point3 =
      m?.type === "slide" ? slideOffset(m.by, m.seconds, t) : [0, 0, 0]
    const still = { ...p, motion: m?.type === "spin" ? p.motion : undefined }
    return boundsOf(
      extremesOf(still).map(
        ([x, y, z]) => [x + off[0], y + off[1], z + off[2]] as Point3,
      ),
    )
  })
  const toward = towardViewer(P)
  const V = viewVector(P)
  const n = items.length
  const after: number[][] = Array.from({ length: n }, () => [])
  const blockers = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const o =
        ghostOrder(parts[i], parts[j], bounds[i], bounds[j]) ||
        rotorOrder(parts[i], parts[j], bounds[i], bounds[j], V) ||
        paintOrder(bounds[i], bounds[j], toward)
      if (o < 0) {
        after[i].push(j)
        blockers[j]++
      } else if (o > 0) {
        after[j].push(i)
        blockers[i]++
      }
    }
  const done = new Array<boolean>(n).fill(false)
  const out: SceneItem[] = []
  for (let k = 0; k < n; k++) {
    let pick = -1
    for (let i = 0; i < n; i++) {
      if (done[i] || blockers[i] > 0) continue
      if (pick < 0 || items[i].depth < items[pick].depth) pick = i
    }
    // A cycle: break it at the farthest remaining part.
    if (pick < 0)
      for (let i = 0; i < n; i++)
        if (!done[i] && (pick < 0 || items[i].depth < items[pick].depth))
          pick = i
    done[pick] = true
    out.push(items[pick])
    for (const j of after[pick]) blockers[j]--
  }
  return out
}

// ---------------------------------------------------------------------------
// Review: structure checks on a finished figure

export type MechanismNoteKind =
  | "floating"
  | "buried"
  | "scale"
  | "plain"
  | "sparse"
  | "accent"
  | "hidden"
  | "ghosts"

export interface MechanismNote {
  kind: MechanismNoteKind
  /** One line for the model, naming the parts by label. */
  message: string
}

/** How far apart two parts can be and still count as touching. */
const TOUCH = 2

const touches = (a: Bounds, b: Bounds) =>
  [0, 1, 2].every(
    (i) => a.lo[i] <= b.hi[i] + TOUCH && b.lo[i] <= a.hi[i] + TOUCH,
  )

const isStream = (p: MechanismPart) =>
  p.shape.type === "pipe" && Boolean(p.shape.stream)

const hasDetail = (p: MechanismPart) => {
  const s = p.shape
  if (s.type === "gear" || s.type === "rotor") return true
  if (s.type === "box") return Boolean(s.pattern)
  if (s.type === "cylinder" || s.type === "lathe")
    return Boolean(
      s.ribs || s.rings?.length || s.blades || s.bolts || s.sides || s.lattice,
    )
  return false
}

/** A closed round body's radius at s along its axis (the larger at a step), or -1 off its ends. */
function radiusAt(profile: [number, number][], s: number) {
  let r = -1
  for (let i = 0; i + 1 < profile.length; i++) {
    const [s0, r0] = profile[i]
    const [s1, r1] = profile[i + 1]
    if (s < s0 - EPS || s > s1 + EPS) continue
    const f = s1 > s0 ? Math.min(1, Math.max(0, (s - s0) / (s1 - s0))) : 1
    r = Math.max(r, s1 > s0 ? r0 + (r1 - r0) * f : Math.max(r0, r1))
  }
  return r
}

/** How far inside a solid a part must stay, everywhere, to be hidden; a part flush with a face shows. */
const HIDDEN = 1

/** True when every point lies strictly within the solid `host` (a box or a closed round body). */
function enclosedBy(points: Point3[], host: MechanismPart, hostBounds: Bounds) {
  const s = host.shape
  // A see-through shell or a bored body hides nothing inside it.
  if (host.ghost || (s.type === "cylinder" && s.bore)) return false
  if (s.type === "box") {
    if (s.h <= 0) return false
    return points.every((p) =>
      [0, 1, 2].every(
        (i) =>
          p[i] >= hostBounds.lo[i] + HIDDEN &&
          p[i] <= hostBounds.hi[i] - HIDDEN,
      ),
    )
  }
  // An open or lattice body hides nothing inside it.
  if (
    (s.type === "cylinder" || s.type === "lathe") &&
    !s.lattice &&
    !(s.type === "lathe" && s.open)
  ) {
    const { F, profile } = roundOf(s)
    return points.every((p) => {
      const d: Point3 = [p[0] - F.o[0], p[1] - F.o[1], p[2] - F.o[2]]
      const along = dot3(d, F.a)
      const radial = Math.hypot(dot3(d, F.u), dot3(d, F.w))
      const r = radiusAt(profile, along)
      return (
        along >= profile[0][0] + HIDDEN &&
        along <= profile[profile.length - 1][0] - HIDDEN &&
        radial <= r - HIDDEN
      )
    })
  }
  return false
}

/**
 * The blades a part carries: a rotor, or a round part with blades on its far
 * end face. Its axis frame, the face's position along it and its radius.
 */
function bladesOf(p: MechanismPart) {
  const s = p.shape
  // A rotor's blades show from both sides; a body's blades only on its end face.
  if (s.type === "rotor")
    return {
      F: frameOf([s.x, s.y, s.z ?? 0], s.axis ?? "z"),
      at: 0,
      r: s.r,
      bothSides: true,
    }
  if ((s.type === "cylinder" || s.type === "lathe") && s.blades) {
    const { F, profile } = roundOf(s)
    const end = profile[profile.length - 1]
    return { F, at: end[0], r: end[1], bothSides: false }
  }
  return null
}

/** A solid, flat disc on the same axis as a bladed part, close to and as wide as its blades, so it hides them. */
function discOver(
  blades: NonNullable<ReturnType<typeof bladesOf>>,
  q: MechanismPart,
) {
  const s = q.shape
  if (q.ghost || s.type !== "cylinder" || s.bore) return false
  if (s.h > 0.2 * s.r || s.r < 0.9 * blades.r) return false
  const { F, profile } = roundOf(s)
  if (dot3(F.a, blades.F.a) < 0.999) return false
  const d: Point3 = [
    F.o[0] - blades.F.o[0],
    F.o[1] - blades.F.o[1],
    F.o[2] - blades.F.o[2],
  ]
  const along = dot3(d, blades.F.a) - blades.at
  const across = Math.hypot(
    d[0] - blades.F.a[0] * dot3(d, blades.F.a),
    d[1] - blades.F.a[1] * dot3(d, blades.F.a),
    d[2] - blades.F.a[2] * dot3(d, blades.F.a),
  )
  const reach = 0.4 * blades.r
  const lo = along + profile[0][0]
  const hi = along + profile[profile.length - 1][0]
  if (across > 0.3 * blades.r || lo > reach || hi < -reach) return false
  // Blades on an end face are only hidden by a disc that reaches that face or lies past it.
  return blades.bothSides || hi > 0.5
}

const named = (parts: MechanismPart[]) =>
  parts.map((p) => `'${p.label}'`).join(", ")

/**
 * Checks a finished figure for what makes it read wrong, though the schema
 * accepts it: parts floating apart from the object, parts hidden inside a
 * solid, an object far from the size the drawing is tuned for, no surface
 * detail, too few parts, too many accents. Notes, not errors: the figure
 * still renders. A host can send reviewMessage back to the model once so it
 * can redraw; the agent eval counts the notes.
 */
export function reviewMechanism(
  input: (Partial<MechanismPart> | undefined)[] | undefined,
): MechanismNote[] {
  const parts = readyParts(input)
  if (parts.length < 2) return []
  const notes: MechanismNote[] = []
  const bodies = parts.filter((p) => !isStream(p))
  const bounds = bodies.map((p) =>
    boundsOf(extremesOf({ ...p, motion: undefined })),
  )
  const solid = (i: number) => bodies[i].shape.type !== "pipe"

  // Floating: solids outside the largest group of parts that touch.
  const group = bodies.map((_, i) => i)
  const root = (i: number): number => {
    let k = i
    while (group[k] !== k) k = group[k]
    return k
  }
  for (let i = 0; i < bodies.length; i++)
    for (let j = i + 1; j < bodies.length; j++)
      if (touches(bounds[i], bounds[j])) group[root(i)] = root(j)
  const size = new Map<number, number>()
  bodies.forEach((_, i) => {
    if (solid(i)) size.set(root(i), (size.get(root(i)) ?? 0) + 1)
  })
  const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const loose = bodies.filter((_, i) => solid(i) && root(i) !== main)
  if (loose.length)
    notes.push({
      kind: "floating",
      message: `${named(loose)} ${loose.length === 1 ? "touches" : "touch"} nothing joined to the rest of the object. Move ${loose.length === 1 ? "it" : "them"} so ${loose.length === 1 ? "it rests" : "they rest"} on or ${loose.length === 1 ? "joins" : "join"} another part.`,
    })

  // Buried: a part entirely inside another solid, so it can't be seen.
  const buried: MechanismPart[] = []
  bodies.forEach((p, i) => {
    if (p.shape.type === "pipe") return
    const points = extremesOf({ ...p, motion: undefined })
    const host = bodies.findIndex(
      (q, j) =>
        j !== i &&
        q.shape.type !== "pipe" &&
        enclosedBy(points, q, bounds[j]) &&
        !enclosedBy(extremesOf({ ...q, motion: undefined }), p, bounds[i]),
    )
    if (host >= 0) buried.push(p)
  })
  if (buried.length)
    notes.push({
      kind: "buried",
      message: `${named(buried)} ${buried.length === 1 ? "is" : "are"} entirely inside another solid part, so ${buried.length === 1 ? "it" : "they"} can't be seen. Move ${buried.length === 1 ? "it" : "them"} to the surface, or leave ${buried.length === 1 ? "it" : "them"} out.`,
    })

  // Scale: the drawing's detail is tuned for a longest side of 200 to 260.
  const all = boundsOf(bounds.flatMap((b) => [b.lo, b.hi]))
  const span = Math.max(...[0, 1, 2].map((i) => all.hi[i] - all.lo[i]))
  if (span < 120 || span > 420)
    notes.push({
      kind: "scale",
      message: `The object is ${Math.round(span)} units across. Scale every part so its longest side is about 200 to 260 units.`,
    })

  // Hidden blades: a solid disc over a fan or rotor, which the blades show through only with a bore.
  const covers: MechanismPart[] = []
  const covered: MechanismPart[] = []
  for (const p of parts) {
    const blades = bladesOf(p)
    if (!blades) continue
    for (const q of parts) {
      if (q === p || !discOver(blades, q)) continue
      if (!covers.includes(q)) covers.push(q)
      if (!covered.includes(p)) covered.push(p)
    }
  }
  if (covers.length)
    notes.push({
      kind: "hidden",
      message: `${named(covers)} ${covers.length === 1 ? "is a solid disc" : "are solid discs"} over ${named(covered)}, so the blades are hidden from that side. Give ${covers.length === 1 ? "it" : "each"} a bore (a hollow centre, so it is a ring) and the blades show through.`,
    })

  const solids = parts.filter((p) => p.shape.type !== "pipe")
  if (solids.length >= 3 && !solids.some(hasDetail))
    notes.push({
      kind: "plain",
      message:
        "No part has surface detail. Where the real object has them, add windows, vents or panels to boxes, and ribs, rings, blades or bolts to round parts.",
    })
  if (parts.length < 6)
    notes.push({
      kind: "sparse",
      message: `Only ${parts.length} parts. A real object reads through its parts: use 8 to 40.`,
    })
  const ghosts = parts.filter((p) => p.ghost)
  if (ghosts.length > 2)
    notes.push({
      kind: "ghosts",
      message: `${ghosts.length} parts are ghosts (${named(ghosts)}). A see-through shell is only for the one casing that hides the workings when the user asks how it works; draw the rest solid, so the object stays recognisable.`,
    })
  const accents = parts.filter((p) => p.accent)
  if (accents.length > 2)
    notes.push({
      kind: "accent",
      message: `${accents.length} parts are accent (${named(accents)}). Keep one or two: the thing the figure is about.`,
    })
  return notes
}

/** The notes worded as a tool result for the model, or null when there are none. */
export function reviewMessage(notes: MechanismNote[]): string | null {
  if (!notes.length) return null
  return [
    "The figure was shown, but it may not read as the real thing. If these are right, call show_mechanism again with the corrected figure, without mentioning this check (the user doesn't see it); if not, leave it and don't reply:",
    ...notes.map((n) => `- ${n.message}`),
  ].join("\n")
}

// ---------------------------------------------------------------------------
// Words

/** "spins clockwise", "carries flow", "slides back and forth", or "". */
export function describeMotion(part: MechanismPart): string {
  const m = motionOf(part)
  if (!m) return ""
  if (m.type === "spin")
    return m.speed > 0 ? "turns counter-clockwise" : "turns clockwise"
  if (m.type === "flow") return "carries flow"
  return "slides back and forth"
}

/** One line per part for screen readers: "Drive gear, turns clockwise. Turns the output shaft." */
export function describePart(part: MechanismPart): string {
  const motion = describeMotion(part)
  const head = motion ? `${part.label}, ${motion}` : part.label
  return part.description ? `${head}. ${part.description}` : head
}

/** The view angle as the user turned it, relative to the start: "Turned 45° right". */
export function viewLabel(azimuth: number): string {
  const turn = normalizeAngle(azimuth - AZIMUTH)
  if (turn === 0) return "Front view"
  return turn <= 180
    ? `Turned ${Math.round(turn)}° left`
    : `Turned ${Math.round(360 - turn)}° right`
}
