/**
 * Encyclopedia Snippet: pure helpers (no React, no DOM), so they can be
 * unit-tested.
 *
 * - safeHttpUrl / safeImageSrc: only http(s) links, and http(s), same-origin
 *   path ("/..."), or data:image images, are ever rendered.
 * - splitParagraphs: the summary's blank-line separated paragraphs.
 * - parseInline: a tiny tokenizer for **bold**, *italic*, `code`,
 *   [text](url) links and [n] reference markers (copied from Article, so this
 *   component stays self-contained). Unsafe links render as plain text.
 * - attributionText / copyText: the credit line and the clipboard text.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

// ---- URLs ----------------------------------------------------------------

/** The normalized URL if it is http(s); anything else (javascript:, data:, relative) is null. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

const DATA_IMAGE =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)(?:;[\w=.+-]+)*(?:;base64)?,/i

/**
 * An http(s) URL, a same-origin path that starts with a single "/", or an
 * inline data:image of a known type; otherwise null (protocol-relative "//",
 * javascript:, blob: and other data: types are rejected).
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null
  const s = src.trim()
  if (DATA_IMAGE.test(s)) return s
  if (/^\/(?![/\\])/.test(s)) return s
  return safeHttpUrl(s)
}

/** "encyclopedia.example" from a URL, without "www.". */
export function hostName(url: unknown): string | null {
  const href = safeHttpUrl(url)
  return href ? new URL(href).hostname.replace(/^www\./, "") : null
}

// ---- Paragraphs ----------------------------------------------------------

/**
 * Paragraphs separated by blank lines, trimmed, with single line breaks read
 * as spaces. Empty paragraphs are dropped.
 */
export function splitParagraphs(text: unknown): string[] {
  if (typeof text !== "string") return []
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean)
}

// ---- Inline tokenizer ----------------------------------------------------

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }
  | { type: "cite"; refs: number[] }

type Stop = "**" | "*" | null
type Ctx = { src: string; partial: boolean }
type Parsed = { nodes: InlineNode[]; end: number; closed: boolean }

const MAX_DEPTH = 6
const CITE = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]/y
// A reference marker still being written at the end, e.g. "[", "[1" or "[1,".
const PARTIAL_CITE_END = /\[[\d,\s]*$/
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
  if (node.type === "cite" && last?.type === "cite") {
    // [1][3] reads as one marker.
    last.refs = [...new Set([...last.refs, ...node.refs])]
    return
  }
  if ((node.type === "strong" || node.type === "em") && !node.children.length)
    return
  nodes.push(node)
}

/** Index of a lone "*" (not part of "**") in [from, limit), or -1. */
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

/** Index of the ")" closing the "(" at `open`, allowing balanced parens in URLs; or -1. */
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
  ctx: Ctx,
  start: number,
  limit: number,
  stop: Stop,
  depth: number,
): Parsed {
  const { src, partial } = ctx
  // Unclosed markup is only "still streaming" at the very end of the input.
  const open = partial && limit === src.length
  const nodes: InlineNode[] = []
  let buf = ""
  const flush = () => {
    push(nodes, { type: "text", value: buf })
    buf = ""
  }
  const label = (from: number, to: number) =>
    parseRange(ctx, from, to, null, depth + 1).nodes

  let i = start
  while (i < limit) {
    const ch = src[i]

    // Closing delimiters.
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

    // Escapes: \* stays a literal star.
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
      if (open) {
        flush()
        push(nodes, { type: "code", value: src.slice(i + 1, limit) })
        i = limit
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === "*") {
      if (src.startsWith("**", i)) {
        if (depth < MAX_DEPTH && (hasDoubleStar(src, i + 2, limit) || open)) {
          const inner = parseRange(ctx, i + 2, limit, "**", depth + 1)
          if (inner.closed || open) {
            flush()
            push(nodes, { type: "strong", children: inner.nodes })
            i = inner.end
            continue
          }
        }
        // A trailing "**" while streaming is the start of bold: hide it.
        if (open && i + 2 === limit) {
          i = limit
          continue
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
        (findSingleStar(src, i + 1, limit) !== -1 || open)
      ) {
        const inner = parseRange(ctx, i + 1, limit, "*", depth + 1)
        if (inner.closed || open) {
          flush()
          push(nodes, { type: "em", children: inner.nodes })
          i = inner.end
          continue
        }
      }
      if (open && i + 1 === limit) {
        i = limit
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === "[") {
      CITE.lastIndex = i
      const m = CITE.exec(src)
      if (m && i + m[0].length <= limit) {
        flush()
        const refs = m[1]
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => n > 0)
        push(nodes, { type: "cite", refs: [...new Set(refs)] })
        i += m[0].length
        continue
      }
      const close = src.indexOf("]", i + 1)
      if (close !== -1 && close < limit) {
        if (src[close + 1] === "(") {
          const paren = matchParen(src, close + 1, limit)
          if (paren !== -1 && paren < limit) {
            const href = safeHttpUrl(src.slice(close + 2, paren))
            const children = label(i + 1, close)
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
          if (open) {
            // The URL is still streaming: show the link text for now.
            flush()
            push(nodes, {
              type: "text",
              value: toPlainText(label(i + 1, close)),
            })
            i = limit
            continue
          }
        } else if (open && close + 1 === limit) {
          // "[text]" at the very end: a "(url)" may follow.
          flush()
          push(nodes, { type: "text", value: toPlainText(label(i + 1, close)) })
          i = limit
          continue
        }
        buf += ch
        i++
        continue
      }
      if (open) {
        // Unclosed "[" while streaming: show the words without the bracket.
        flush()
        for (const n of label(i + 1, limit)) push(nodes, n)
        i = limit
        continue
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

/**
 * Parse inline markup. Pass `partial` for text that is still streaming:
 * unclosed `**`, `*` and backticks then style the rest of the text, and a
 * half-written link or reference marker is hidden until it completes.
 */
export function parseInline(
  text: string,
  options: { partial?: boolean } = {},
): InlineNode[] {
  if (typeof text !== "string" || !text) return []
  const partial = options.partial ?? false
  const src = partial ? text.replace(PARTIAL_CITE_END, "") : text
  return parseRange({ src, partial }, 0, src.length, null, 0).nodes
}

/** The readable words: markup and reference markers removed. */
export function toPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
        case "code":
          return n.value
        case "cite":
          return ""
        default:
          return toPlainText(n.children)
      }
    })
    .join("")
}

/** A paragraph as plain text, with the space a removed marker leaves tidied. */
export function plainParagraph(text: string): string {
  return toPlainText(parseInline(text))
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

// ---- Attribution ---------------------------------------------------------

/** "Oct 8, 2026". Date-only strings are read as calendar dates (no timezone shift). */
export function formatDate(
  iso: unknown,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (typeof iso !== "string" || !iso) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: dateOnly ? "UTC" : undefined,
  }).format(d)
}

export type AttributionSource = {
  name?: string
  url?: string
  license?: string
  retrievedAt?: string
}

/** The source's name, or its host name, or "the source". */
export function sourceName(source: AttributionSource | undefined): string {
  return source?.name?.trim() || hostName(source?.url) || "the source"
}

/**
 * The credit line parts: "From Example Encyclopedia", "CC BY-SA 4.0",
 * "Retrieved Oct 8, 2026". Missing license or date are left out.
 */
export function attributionParts(
  source: AttributionSource | undefined,
  locale: string = DEFAULT_LOCALE,
): string[] {
  const date = formatDate(source?.retrievedAt, locale)
  return [
    `From ${sourceName(source)}`,
    source?.license?.trim() || null,
    date ? `Retrieved ${date}` : null,
  ].filter((p): p is string => !!p)
}

/** "From Example Encyclopedia · CC BY-SA 4.0 · Retrieved Oct 8, 2026" */
export function attributionText(
  source: AttributionSource | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  return attributionParts(source, locale).join(" · ")
}

/**
 * What Copy puts on the clipboard: the title, the summary as plain text and
 * the credit line with the source link.
 */
export function copyText(
  input: { title?: string; summary?: string; source?: AttributionSource },
  locale: string = DEFAULT_LOCALE,
): string {
  const parts: string[] = []
  if (input.title?.trim()) parts.push(input.title.trim())
  const paragraphs = splitParagraphs(input.summary)
    .map(plainParagraph)
    .filter(Boolean)
  if (paragraphs.length) parts.push(paragraphs.join("\n\n"))
  const href = safeHttpUrl(input.source?.url)
  const credit = attributionText(input.source, locale)
  parts.push(href ? `${credit}\n${href}` : credit)
  return `${parts.join("\n\n")}\n`
}
