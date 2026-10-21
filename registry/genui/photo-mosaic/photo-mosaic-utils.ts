/**
 * Photo Mosaic: pure helpers (no React, no DOM), so they can be unit-tested.
 *
 * - safeImageSrc: http(s) URLs, same-origin "/" paths and a few data:image types only.
 * - mosaicLayout: the grid for 1–5 photos (hero first).
 * - readyImages / streamingSlots: what to draw while the call streams.
 * - cleanTags: trimmed, de-duplicated chips, at most 5.
 * - wrapIndex / photoLabel: lightbox navigation and its words.
 */

import type { MosaicImage } from "./photo-mosaic.schema"

export const MAX_IMAGES = 5
export const MAX_TAGS = 5

// ---- URLs ----------------------------------------------------------------

/** The normalized URL if it is http(s); anything else is null. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** Raster and SVG data URIs a host may pass for its own or demo images. */
const SAFE_DATA_IMAGE =
  /^data:image\/(?:png|jpeg|webp|svg\+xml)(?:;[a-z0-9=.+-]+)*,/i

/**
 * The src if it is safe to load in an <img>: http(s), a same-origin path that
 * starts with a single "/", or a data: URI of type png, jpeg, webp or
 * svg+xml. Everything else (javascript:, blob:, protocol-relative URLs, other
 * data: types) is null.
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null
  const value = src.trim()
  if (!value) return null
  if (/^data:/i.test(value)) return SAFE_DATA_IMAGE.test(value) ? value : null
  if (/^\/(?![/\\])/.test(value)) return value
  return safeHttpUrl(value)
}

// ---- Layout --------------------------------------------------------------

export type MosaicLayoutName =
  | "single"
  | "pair"
  | "hero-2"
  | "hero-3"
  | "two-three"

export type MosaicCell = { gridColumn: string; gridRow: string }

export type MosaicLayout = {
  name: MosaicLayoutName
  gridTemplateColumns: string
  gridTemplateRows: string
  /** One placement per photo, in order. */
  cells: MosaicCell[]
}

const cell = (gridColumn: string, gridRow: string): MosaicCell => ({
  gridColumn,
  gridRow,
})

/**
 * The grid for `count` photos (clamped to 1–5):
 * 1 one wide photo; 2 side by side; 3 a hero (60%) and two stacked;
 * 4 a hero and three (one over two); 5 two over three.
 */
export function mosaicLayout(count: number): MosaicLayout {
  const n = Number.isFinite(count)
    ? Math.min(Math.max(Math.trunc(count), 1), MAX_IMAGES)
    : 3
  switch (n) {
    case 1:
      return {
        name: "single",
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr",
        cells: [cell("1", "1")],
      }
    case 2:
      return {
        name: "pair",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr",
        cells: [cell("1", "1"), cell("2", "1")],
      }
    case 4:
      return {
        name: "hero-3",
        gridTemplateColumns: "3fr 1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        cells: [
          cell("1", "1 / 3"),
          cell("2 / 4", "1"),
          cell("2", "2"),
          cell("3", "2"),
        ],
      }
    case 5:
      return {
        name: "two-three",
        gridTemplateColumns: "repeat(6, 1fr)",
        gridTemplateRows: "3fr 2fr",
        cells: [
          cell("1 / 4", "1"),
          cell("4 / 7", "1"),
          cell("1 / 3", "2"),
          cell("3 / 5", "2"),
          cell("5 / 7", "2"),
        ],
      }
    default:
      return {
        name: "hero-2",
        gridTemplateColumns: "3fr 2fr",
        gridTemplateRows: "1fr 1fr",
        cells: [cell("1", "1 / 3"), cell("2", "1"), cell("2", "2")],
      }
  }
}

// ---- Streaming -----------------------------------------------------------

const isString = (v: unknown): v is string => typeof v === "string"

/** The image if it has a src and alt text, normalized; otherwise null. */
export function normalizeImage(image: unknown): MosaicImage | null {
  if (!image || typeof image !== "object") return null
  const i = image as Record<string, unknown>
  if (!isString(i.src) || !isString(i.alt) || !i.alt.trim()) return null
  const caption = isString(i.caption) ? i.caption.trim() : ""
  return {
    src: i.src,
    alt: i.alt.trim(),
    caption: caption || undefined,
  }
}

/**
 * Photos ready to draw, at most 5. While streaming, the last one may still be
 * arriving (a half-written URL), so it's held back until the next one starts.
 */
export function readyImages(
  images: unknown,
  streaming: boolean,
): MosaicImage[] {
  if (!Array.isArray(images)) return []
  const complete = streaming ? images.slice(0, -1) : images
  const out: MosaicImage[] = []
  for (const raw of complete) {
    const image = normalizeImage(raw)
    if (image) out.push(image)
    if (out.length === MAX_IMAGES) break
  }
  return out
}

/**
 * How many tiles to draw while streaming: the default three-photo layout to
 * start with, then one placeholder after the photos that have arrived.
 */
export function streamingSlots(readyCount: number): number {
  const n = Number.isFinite(readyCount)
    ? Math.max(Math.trunc(readyCount), 0)
    : 0
  return Math.min(MAX_IMAGES, Math.max(3, n + 1))
}

/** Trimmed, non-empty, case-insensitively unique tags; at most 5. */
export function cleanTags(tags: unknown, streaming = false): string[] {
  if (!Array.isArray(tags)) return []
  const complete = streaming ? tags.slice(0, -1) : tags
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of complete) {
    if (!isString(raw)) continue
    const tag = raw.replace(/\s+/g, " ").trim()
    const key = tag.toLowerCase()
    if (!tag || seen.has(key)) continue
    seen.add(key)
    out.push(tag)
    if (out.length === MAX_TAGS) break
  }
  return out
}

// ---- Lightbox ------------------------------------------------------------

/** Index wrapped into [0, count): -1 is the last photo, count is the first. */
export function wrapIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0
  const i = Math.trunc(index)
  return ((i % count) + count) % count
}

/** "Photo 2 of 5: Yellow tram on a steep street". */
export function photoLabel(index: number, count: number, alt: string): string {
  return `Photo ${index + 1} of ${count}: ${alt}`
}
