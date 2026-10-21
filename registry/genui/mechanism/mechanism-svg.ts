import type { MechanismPart } from "./mechanism.schema"
import {
  buildScene,
  extremesOf,
  figureHeight,
  fitView,
  projectionFor,
  readyParts,
  type SceneItem,
} from "./mechanism-utils"

/*
 * Mechanism as a standalone SVG string, for a model to look at its own
 * figure (a host rasterizes it and sends the image back), or for a server to
 * save one. No React, no DOM, no CSS: the light theme's colours are written
 * in. Each view is the figure as the component draws it at rest, at one
 * camera angle; several views sit side by side so the shape reads in 3D.
 */

const W = 640

// The light theme, as hex: the card, the ink and the accent's sky.
const CARD = "#ffffff"
const INK = "#3d3d3d"
const SKY_500 = "#0ea5e9"
const SKY_600 = "#0284c7"

/** `over` mixed into `base` at `p` (0 to 1), in sRGB. */
function mix(base: string, over: string, p: number) {
  const ch = (hex: string, i: number) =>
    Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return `#${[0, 1, 2]
    .map((i) =>
      Math.round(ch(base, i) * (1 - p) + ch(over, i) * p)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`
}

// The component's light ramps: four tones by facing, then the top face.
const INK_RAMP = [0.17, 0.12, 0.08, 0.04, 0.015]
const SKY_RAMP = [0.42, 0.32, 0.24, 0.16, 0.08]
const TONES = INK_RAMP.map((p) => mix(CARD, INK, p))
const ACCENT_TONES = SKY_RAMP.map((p) => mix(CARD, SKY_500, p))
const EDGE = mix(CARD, INK, 0.75)
const CREASE = mix(CARD, INK, 0.25)
const DETAIL = mix(CARD, INK, 0.3)
const ACCENT_DETAIL = mix(CARD, SKY_600, 0.5)
const BOLT = mix(CARD, INK, 0.55)

const path = (d: string, attrs: string) =>
  d ? `<path d="${d}" ${attrs}/>` : ""

function solid(item: Extract<SceneItem, { kind: "solid" }>, accent: boolean) {
  const tones = accent ? ACCENT_TONES : TONES
  const edge = accent ? SKY_600 : EDGE
  const out: string[] = []
  // The faces, faint as a group for a see-through shell.
  const faces: string[] = []
  for (const f of item.facets ?? []) {
    const c = tones[f.shade] ?? tones[2]
    faces.push(
      path(
        f.d,
        `fill="${c}" stroke="${c}" stroke-width="0.6" stroke-linejoin="round"`,
      ),
    )
  }
  if (!item.ghost) faces.push(path(item.paths.fill, `fill="${CARD}"`))
  item.paths.shades.forEach((d, level) => {
    faces.push(path(d, `fill="${tones[level]}"`))
  })
  const top = path(item.paths.top, `fill="${tones[4]}"`)
  if (!item.topLast) faces.push(top)
  out.push(
    item.ghost ? `<g opacity="0.3">${faces.join("")}</g>` : faces.join(""),
  )
  out.push(
    path(
      item.detail,
      `fill="none" stroke="${accent ? ACCENT_DETAIL : DETAIL}" stroke-width="0.7" stroke-linecap="round"`,
    ),
  )
  for (const [x, y] of item.dots)
    out.push(`<circle cx="${x}" cy="${y}" r="1.1" fill="${BOLT}"/>`)
  const marks = path(
    item.marks,
    `fill="none" stroke="${edge}" stroke-width="0.8" opacity="0.7"`,
  )
  if (!item.topLast) out.push(marks)
  out.push(
    path(
      item.paths.crease,
      `fill="none" stroke="${CREASE}" stroke-width="0.8"`,
    ),
  )
  out.push(
    path(
      item.paths.outline,
      `fill="none" stroke="${edge}" stroke-width="1" stroke-linejoin="round" stroke-linecap="round"`,
    ),
  )
  if (item.topLast) {
    out.push(path(item.paths.top, `fill="${CARD}"`))
    out.push(
      path(
        item.paths.top,
        `fill="${tones[4]}" stroke="${edge}" stroke-width="1" stroke-linejoin="round"`,
      ),
    )
    out.push(marks)
  }
  return out.join("")
}

function pipe(item: Extract<SceneItem, { kind: "pipe" }>, accent: boolean) {
  const round = `stroke-linecap="round" stroke-linejoin="round" fill="none"`
  const flow = `stroke="${SKY_500}" stroke-dasharray="6 9" ${round}`
  if (item.stream)
    return path(
      item.d,
      `stroke-width="${Math.max(1.6, item.width * 0.5)}" ${flow}`,
    )
  return [
    path(
      item.d,
      `stroke="${accent ? SKY_600 : EDGE}" stroke-width="${item.width + 2}" ${round}`,
    ),
    path(item.d, `stroke="${CARD}" stroke-width="${item.width}" ${round}`),
    path(
      item.d,
      `stroke="${accent ? mix(CARD, SKY_500, 0.15) : mix(CARD, INK, 0.05)}" stroke-width="${item.width}" ${round}`,
    ),
    item.flow > 0
      ? path(
          item.d,
          `stroke-width="${Math.max(1.4, item.width * 0.45)}" ${flow}`,
        )
      : "",
  ].join("")
}

export interface MechanismSvgOptions {
  /** Camera angles, one view each, side by side. Default: the front view and turned 90°. */
  azimuths?: number[]
}

/** The figure as an SVG string, or null when no part is drawable yet. */
export function mechanismSvg(
  input: (Partial<MechanismPart> | undefined)[] | undefined,
  { azimuths = [45, 135] }: MechanismSvgOptions = {},
): string | null {
  const parts = readyParts(input)
  const points = parts.flatMap(extremesOf)
  const H = figureHeight(points, W)
  const view = fitView(points, W, H, 28)
  if (!view || !azimuths.length) return null
  const accent = new Set(parts.filter((p) => p.accent).map((p) => p.id))
  const panels = azimuths.map((azimuth, i) => {
    const scene = buildScene(parts, projectionFor(view, azimuth, W, H), 0)
    const body = scene
      .map((item) =>
        item.kind === "pipe"
          ? pipe(item, accent.has(item.id))
          : solid(item, accent.has(item.id)),
      )
      .join("")
    const divider = i
      ? `<line x1="0" y1="16" x2="0" y2="${H - 16}" stroke="${mix(CARD, INK, 0.12)}"/>`
      : ""
    return `<g transform="translate(${i * W} 0)">${divider}${body}</g>`
  })
  const width = W * azimuths.length
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}"><rect width="${width}" height="${H}" fill="${CARD}"/>${panels.join("")}</svg>`
}

/**
 * What to send with the image of a figure (mechanismSvg, rasterized), so the
 * model checks it against the real object and redraws if it reads wrong.
 * `notes` are reviewMechanism's, added when there are any.
 */
export function lookMessage(
  title: string | undefined,
  notes: { message: string }[] = [],
  views = "from the front and turned 90°",
): string {
  const thing = title?.trim() ? `the real ${title.trim()}` : "the real object"
  return [
    `This is how your figure renders, ${views}. Compare it with ${thing}: its silhouette, proportions, orientation, and the details that make it recognisable.`,
    ...(notes.length
      ? [
          "The structure check also found:",
          ...notes.map((n) => `- ${n.message}`),
        ]
      : []),
    "If it doesn't read as the real thing, call show_mechanism again with the corrected figure. If it does, reply with one short sentence.",
  ].join("\n")
}
