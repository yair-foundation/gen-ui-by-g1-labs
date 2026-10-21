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
  const lit = (n[0] * -Math.sin(a) + n[1] * Math.cos(a) + n[2] * 0.6 + 1) / 2
  return Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)))
}

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
  const profile = profileIn
  const V = viewVector(P)
  const aV = dot3(F.a, V)
  const uV = dot3(F.u, V)
  const wV = dot3(F.w, V)
  const R = Math.hypot(uV, wV)
  const phi = Math.atan2(wV, uV)
  const open = Boolean(opts.open)
  const N = LATHE_STEPS
  const step = (Math.PI * 2) / N
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
      const t0 = j * step
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
        depth: depthOf(mid, P),
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
    const pts = Array.from({ length: N }, (_, j) => at(sc, rc, j * step))
    raw.push({
      pts,
      depth: depthOf(pointOf(F, sc, 0, 0), P),
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

  // Limbs: where the surface turns away, solved exactly per segment.
  const outline: string[] = []
  for (const sign of [1, -1]) {
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
  for (let k = 0; k <= last; k++) {
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
      const th = j * step
      if (faces(normalOf(k, th))) run.push(at(sr, r, th))
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
  let fk = last
  while (fk > 0 && profile[fk][1] <= 0) fk--
  const [sf, rf] = profile[fk]
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
          Array.from({ length: N }, (_, j) => at(sf, rf * 0.22, j * step)),
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
        dots.push(at(sf, rf * 0.82, phase + (i * Math.PI * 2) / opts.bolts))
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
  const depth = depthOf(
    [centre[0] + off[0], centre[1] + off[1], centre[2] + off[2]],
    P,
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
      width: Math.max(1.5, 2 * (s.r ?? 3) * pixelsPerUnit(P)),
      flow: motion?.type === "flow" ? (motion.speed ?? 1) : 0,
      stream: Boolean(s.stream),
    }
  }
  if (s.type === "cylinder" || s.type === "lathe") {
    const { F, profile } = roundOf(s, off)
    const g = latheGeometry(F, profile, P, {
      open: s.type === "lathe" ? s.open : false,
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
  const n = items.length
  const after: number[][] = Array.from({ length: n }, () => [])
  const blockers = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const o = paintOrder(bounds[i], bounds[j], toward)
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
