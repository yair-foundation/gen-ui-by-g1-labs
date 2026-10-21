/**
 * Slide Gallery: pure helpers (no React, no DOM), so they can be unit-tested.
 *
 * - safeImageSrc: http(s) URLs, same-origin paths and a few data:image types.
 * - wrapIndex / clampIndex / neighborIndices: slide navigation.
 * - swipeDirection: next/previous from a pointer gesture.
 * - toggleSelection: single/multiple picking with a max.
 * - slideLabel / slideAnnouncement / counterText: words for the UI.
 * - parseInline: a tiny tokenizer for **bold**, *italic*, `code` and
 *   [text](url) links in captions. Unsafe links render as plain text.
 */

import type {
  DeckSlide,
  ImageSlide,
  Slide,
  SlideGalleryAspect,
  SlideGallerySelection,
} from "./slide-gallery.schema"

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

// ---- Navigation ----------------------------------------------------------

/** Index wrapped into [0, count): -1 is the last slide, count is the first. */
export function wrapIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0
  const i = Math.trunc(index)
  return ((i % count) + count) % count
}

/** Index clamped into [0, count - 1]; 0 when there are no slides. */
export function clampIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0
  return Math.min(Math.max(Math.trunc(index), 0), count - 1)
}

/** The previous and next slide indices (wrapped), without duplicates or `index`. */
export function neighborIndices(index: number, count: number): number[] {
  if (count <= 1) return []
  const out = [wrapIndex(index + 1, count), wrapIndex(index - 1, count)]
  return [...new Set(out)].filter((i) => i !== index)
}

/** Stage shape when the agent doesn't set one: 16:9 for decks, 4:3 for images. */
export function defaultAspect(
  first: { type?: string } | null | undefined,
): SlideGalleryAspect {
  return first?.type === "deck" ? "16:9" : "4:3"
}

/** Width over height, e.g. 16 / 9. */
export function aspectRatio(aspect: SlideGalleryAspect): number {
  const [w, h] = aspect.split(":").map(Number)
  return w > 0 && h > 0 ? w / h : 4 / 3
}

export const SWIPE_THRESHOLD = 40

/**
 * 1 for "next" (swiped left), -1 for "previous" (swiped right), 0 when the
 * gesture is too short or mostly vertical (a scroll).
 */
export function swipeDirection(
  dx: number,
  dy: number,
  threshold = SWIPE_THRESHOLD,
): -1 | 0 | 1 {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0
  if (Math.abs(dx) < threshold || Math.abs(dx) <= Math.abs(dy)) return 0
  return dx < 0 ? 1 : -1
}

// ---- Selection -----------------------------------------------------------

/** How many slides can be picked: 1 for single, `max` (or no limit) for multiple. */
export function selectionLimit(
  mode: SlideGallerySelection,
  max?: number,
): number {
  if (mode === "none") return 0
  if (mode === "single") return 1
  return typeof max === "number" && max >= 1 ? Math.floor(max) : Infinity
}

/**
 * The selection after toggling `id`. Single replaces the pick; multiple adds
 * until the max is reached, then ignores new picks (removing always works).
 */
export function toggleSelection(
  selected: readonly string[],
  id: string,
  mode: SlideGallerySelection,
  max?: number,
): string[] {
  if (mode === "none") return [...selected]
  if (selected.includes(id)) return selected.filter((s) => s !== id)
  if (mode === "single") return [id]
  if (selected.length >= selectionLimit(mode, max)) return [...selected]
  return [...selected, id]
}

/** True when another slide can't be added (multiple mode at its max). */
export function isSelectionFull(
  selected: readonly string[],
  mode: SlideGallerySelection,
  max?: number,
): boolean {
  return mode === "multiple" && selected.length >= selectionLimit(mode, max)
}

/** Ids in slide order, dropping any that aren't slides (stale or restored ids). */
export function orderSelection(
  selected: readonly string[],
  slides: readonly { id: string }[],
): string[] {
  const set = new Set(selected)
  return slides.filter((s) => set.has(s.id)).map((s) => s.id)
}

// ---- Slides --------------------------------------------------------------

export type PartialSlide = Partial<ImageSlide> | Partial<DeckSlide>

const isString = (v: unknown): v is string => typeof v === "string"

/** The slide if it has enough to render, normalized; otherwise null. */
export function normalizeSlide(slide: unknown): Slide | null {
  if (!slide || typeof slide !== "object") return null
  const s = slide as Record<string, unknown>
  if (!isString(s.id) || !s.id) return null
  if (s.type === "image") {
    if (!isString(s.src) || !isString(s.alt) || !s.alt.trim()) return null
    return {
      type: "image",
      id: s.id,
      src: s.src,
      alt: s.alt,
      caption: isString(s.caption) && s.caption ? s.caption : undefined,
      credit: isString(s.credit) && s.credit ? s.credit : undefined,
    }
  }
  if (s.type === "deck") {
    if (!isString(s.title)) return null
    const bullets = Array.isArray(s.bullets)
      ? s.bullets.filter(isString).slice(0, 6)
      : []
    const stat = s.stat as { value?: unknown; label?: unknown } | undefined
    return {
      type: "deck",
      id: s.id,
      title: s.title,
      subtitle: isString(s.subtitle) && s.subtitle ? s.subtitle : undefined,
      bullets: bullets.length ? bullets : undefined,
      notes: isString(s.notes) && s.notes.trim() ? s.notes : undefined,
      stat:
        stat && isString(stat.value) && isString(stat.label)
          ? { value: stat.value, label: stat.label }
          : undefined,
    }
  }
  return null
}

/**
 * Slides ready to show. While streaming, the last slide may still be arriving
 * (a half-written URL or title), so it's held back until the next one starts.
 * Duplicate ids keep the first.
 */
export function readySlides(slides: unknown, streaming: boolean): Slide[] {
  if (!Array.isArray(slides)) return []
  const complete = streaming ? slides.slice(0, -1) : slides
  const seen = new Set<string>()
  const out: Slide[] = []
  for (const raw of complete) {
    const slide = normalizeSlide(raw)
    if (!slide || seen.has(slide.id)) continue
    seen.add(slide.id)
    out.push(slide)
  }
  return out
}

function truncate(text: string, max: number) {
  const t = text.replace(/\s+/g, " ").trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** Short name for a slide: the deck title, or the image caption (else alt). */
export function slideLabel(slide: Slide, max = 80): string {
  if (slide.type === "deck") return truncate(slide.title, max)
  const caption = slide.caption ? toPlainText(parseInline(slide.caption)) : ""
  return truncate(caption || slide.alt, max)
}

/** "3 of 12", or "3 of 12 so far" while slides are still arriving. */
export function slidePosition(
  index: number,
  count: number,
  streaming = false,
): string {
  return `${index + 1} of ${count}${streaming ? " so far" : ""}`
}

/** Polite announcement after navigating: "Slide 3 of 12: Living room". */
export function slideAnnouncement(
  index: number,
  count: number,
  slide: Slide,
  streaming = false,
): string {
  return `Slide ${slidePosition(index, count, streaming)}: ${slideLabel(slide)}`
}

/** The visible counter: "3 / 12", or "1 / …" while streaming. */
export function counterText(
  index: number,
  count: number,
  streaming = false,
): string {
  return `${index + 1} / ${streaming ? "…" : count}`
}

/** Footer summary of a selection in progress. */
export function selectionSummary(
  count: number,
  mode: SlideGallerySelection,
  max?: number,
): string {
  const limit = selectionLimit(mode, max)
  if (count === 0) {
    if (mode === "single") return "Pick one"
    return Number.isFinite(limit) ? `Pick up to ${limit}` : "Pick one or more"
  }
  const tail =
    mode === "multiple" && Number.isFinite(limit) ? ` of up to ${limit}` : ""
  return `${count} selected${tail}`
}

// ---- Inline tokenizer (captions) -----------------------------------------

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }

type Stop = "**" | "*" | null
type Parsed = { nodes: InlineNode[]; end: number; closed: boolean }

const MAX_DEPTH = 6
const ESCAPABLE = /[\\`*[\]()_]/

function push(nodes: InlineNode[], node: InlineNode) {
  const last = nodes[nodes.length - 1]
  if (node.type === "text") {
    if (!node.value) return
    if (last?.type === "text") {
      last.value += node.value
      return
    }
  }
  if ((node.type === "strong" || node.type === "em") && !node.children.length)
    return
  nodes.push(node)
}

function findSingleStar(src: string, from: number, limit: number) {
  for (let j = from; j < limit; j++) {
    if (src[j] !== "*") continue
    if (src[j + 1] === "*") {
      j++
      continue
    }
    if (src[j - 1] !== "*") return j
  }
  return -1
}

function matchParen(src: string, open: number, limit: number) {
  let depth = 0
  for (let j = open; j < limit; j++) {
    if (src[j] === "(") depth++
    else if (src[j] === ")" && --depth === 0) return j
  }
  return -1
}

function hasDoubleStar(src: string, from: number, limit: number) {
  const j = src.indexOf("**", from)
  return j !== -1 && j + 2 <= limit
}

function parseRange(
  src: string,
  start: number,
  limit: number,
  stop: Stop,
  depth: number,
): Parsed {
  const nodes: InlineNode[] = []
  let buf = ""
  const flush = () => {
    push(nodes, { type: "text", value: buf })
    buf = ""
  }

  let i = start
  while (i < limit) {
    const ch = src[i]

    if (stop === "**" && src.startsWith("**", i)) {
      flush()
      return { nodes, end: i + 2, closed: true }
    }
    if (
      stop === "*" &&
      ch === "*" &&
      !(src.startsWith("**", i) && hasDoubleStar(src, i + 2, limit))
    ) {
      flush()
      return { nodes, end: i + 1, closed: true }
    }

    if (ch === "\\" && i + 1 < limit && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1]
      i += 2
      continue
    }

    if (ch === "`") {
      const close = src.indexOf("`", i + 1)
      if (close !== -1 && close < limit) {
        flush()
        push(nodes, { type: "code", value: src.slice(i + 1, close) })
        i = close + 1
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === "*") {
      if (src.startsWith("**", i)) {
        if (depth < MAX_DEPTH && hasDoubleStar(src, i + 2, limit)) {
          const inner = parseRange(src, i + 2, limit, "**", depth + 1)
          if (inner.closed) {
            flush()
            push(nodes, { type: "strong", children: inner.nodes })
            i = inner.end
            continue
          }
        }
        buf += "**"
        i += 2
        continue
      }
      const next = src[i + 1]
      if (
        depth < MAX_DEPTH &&
        next !== undefined &&
        !/\s/.test(next) &&
        findSingleStar(src, i + 1, limit) !== -1
      ) {
        const inner = parseRange(src, i + 1, limit, "*", depth + 1)
        if (inner.closed) {
          flush()
          push(nodes, { type: "em", children: inner.nodes })
          i = inner.end
          continue
        }
      }
      buf += ch
      i++
      continue
    }

    if (ch === "[") {
      const close = src.indexOf("]", i + 1)
      if (close !== -1 && close < limit && src[close + 1] === "(") {
        const paren = matchParen(src, close + 1, limit)
        if (paren !== -1 && paren < limit) {
          const href = safeHttpUrl(src.slice(close + 2, paren))
          const children = parseRange(src, i + 1, close, null, depth + 1).nodes
          flush()
          if (href) {
            push(nodes, {
              type: "link",
              href,
              children: children.length
                ? children
                : [{ type: "text", value: href }],
            })
          } else {
            // Unsafe or malformed URL: keep only the words, never a link.
            push(nodes, { type: "text", value: toPlainText(children) })
          }
          i = paren + 1
          continue
        }
      }
      buf += ch
      i++
      continue
    }

    buf += ch
    i++
  }
  flush()
  return { nodes, end: limit, closed: false }
}

/** Parse **bold**, *italic*, `code` and [text](https://…) links. */
export function parseInline(text: unknown): InlineNode[] {
  if (typeof text !== "string" || !text) return []
  return parseRange(text, 0, text.length, null, 0).nodes
}

export function toPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((n) =>
      n.type === "text" || n.type === "code"
        ? n.value
        : toPlainText(n.children),
    )
    .join("")
}
