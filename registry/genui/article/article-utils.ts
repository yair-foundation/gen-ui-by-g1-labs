/**
 * Article: pure helpers (no React, no DOM), so they can be unit-tested.
 *
 * - parseInline: a tiny tokenizer for **bold**, *italic*, `code`,
 *   [text](url) links and [n] citation markers. Tolerant of partial input
 *   while a tool call streams. Unsafe links render as plain text.
 * - headingIds / extractToc: unique slug ids and the contents list.
 * - estimateReadingMinutes: about 220 words a minute.
 * - toMarkdown: the article as Markdown, for Copy and Download.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type { ArticleBlockInput, ArticleSource } from "./article.schema"

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

/**
 * An image src: http(s), or a same-origin path starting with a single "/".
 * Protocol-relative URLs, javascript:, data: and the rest are null.
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src === "string" && /^\/(?![/\\])/.test(src.trim()))
    return src.trim()
  return safeHttpUrl(src)
}

/** "fieldjournal.example" from a URL, without "www.". */
export function hostName(url: unknown): string | null {
  const href = safeHttpUrl(url)
  return href ? new URL(href).hostname.replace(/^www\./, "") : null
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
// A citation marker still being written at the end, e.g. "[", "[1" or "[1,".
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
          push(nodes, {
            type: "text",
            value: toPlainText(label(i + 1, close)),
          })
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
 * half-written link or citation marker is hidden until it completes.
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

function codeSpan(value: string) {
  if (!value.includes("`")) return `\`${value}\``
  return `\`\` ${value} \`\``
}

export function inlineToMarkdown(nodes: InlineNode[]): string {
  return nodes
    .map((n) => {
      switch (n.type) {
        case "text":
          return n.value
        case "code":
          return codeSpan(n.value)
        case "strong":
          return `**${inlineToMarkdown(n.children)}**`
        case "em":
          return `*${inlineToMarkdown(n.children)}*`
        case "link":
          return `[${inlineToMarkdown(n.children)}](${n.href})`
        default:
          return n.refs.map((r) => `[${r}]`).join("")
      }
    })
    .join("")
}

// ---- Blocks --------------------------------------------------------------

/** A partial block from a streaming tool call. */
export type PartialBlock = Partial<ArticleBlockInput> | null | undefined

const isString = (v: unknown): v is string => typeof v === "string"

/**
 * The block if it has enough to render, normalized; otherwise null.
 * Images with a non-http(s) src are dropped.
 */
export function normalizeBlock(block: PartialBlock): ArticleBlockInput | null {
  if (!block || typeof block !== "object") return null
  const b = block as Record<string, unknown>
  switch (b.type) {
    case "heading":
      return isString(b.text)
        ? {
            type: "heading",
            level: b.level === 3 ? 3 : 2,
            text: b.text,
            id: isString(b.id) && b.id ? b.id : undefined,
          }
        : null
    case "paragraph":
      return isString(b.text) ? { type: "paragraph", text: b.text } : null
    case "list": {
      const items = Array.isArray(b.items) ? b.items.filter(isString) : []
      return items.length
        ? { type: "list", ordered: b.ordered === true, items }
        : null
    }
    case "quote":
      return isString(b.text)
        ? {
            type: "quote",
            text: b.text,
            cite: isString(b.cite) && b.cite ? b.cite : undefined,
          }
        : null
    case "callout":
      return isString(b.text)
        ? {
            type: "callout",
            tone: b.tone === "warning" ? "warning" : "note",
            text: b.text,
          }
        : null
    case "image": {
      const src = safeImageSrc(b.src)
      return src && isString(b.alt)
        ? {
            type: "image",
            src,
            alt: b.alt,
            caption: isString(b.caption) && b.caption ? b.caption : undefined,
          }
        : null
    }
    case "code":
      return isString(b.code)
        ? {
            type: "code",
            code: b.code,
            language:
              isString(b.language) && b.language ? b.language : undefined,
          }
        : null
    case "table": {
      const columns = Array.isArray(b.columns) ? b.columns.filter(isString) : []
      if (!columns.length) return null
      const rows = Array.isArray(b.rows)
        ? b.rows
            .filter((r): r is unknown[] => Array.isArray(r))
            .map((r) => r.map((c) => (isString(c) ? c : "")))
        : []
      return { type: "table", columns, rows }
    }
    case "divider":
      return { type: "divider" }
    case "keyFacts": {
      const items = Array.isArray(b.items)
        ? b.items.filter(
            (f): f is { label: string; value: string } =>
              !!f &&
              typeof f === "object" &&
              isString((f as { label?: unknown }).label) &&
              isString((f as { value?: unknown }).value),
          )
        : []
      return items.length ? { type: "keyFacts", items } : null
    }
    default:
      return null
  }
}

/** URL-safe, readable slug. Keeps letters in any script. */
export function slugify(text: string, fallback = "section"): string {
  const slug = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/, "")
  return slug || fallback
}

/**
 * Unique ids for headings, aligned with `blocks` (null for other blocks).
 * Earlier ids never change as more blocks stream in.
 */
export function headingIds(blocks: PartialBlock[]): (string | null)[] {
  const used = new Set<string>()
  return blocks.map((b) => {
    if (b?.type !== "heading" || !isString(b.text)) return null
    const base = slugify(isString(b.id) && b.id ? b.id : b.text)
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  })
}

export type TocEntry = { id: string; text: string }

/** Level-2 headings, in order, for the contents list. */
export function extractToc(blocks: PartialBlock[]): TocEntry[] {
  const ids = headingIds(blocks)
  return blocks.flatMap((b, i) => {
    const id = ids[i]
    return b?.type === "heading" && b.level !== 3 && id && isString(b.text)
      ? [{ id, text: b.text }]
      : []
  })
}

/** The contents list shows when asked, or by default with 3+ sections. */
export function shouldShowToc(blocks: PartialBlock[], toc?: boolean) {
  return toc ?? extractToc(blocks).length >= 3
}

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

const plain = (text: string) => toPlainText(parseInline(text))

/** The readable words of a block. */
export function blockText(block: ArticleBlockInput): string {
  switch (block.type) {
    case "heading":
    case "quote":
      return block.text
    case "paragraph":
    case "callout":
      return plain(block.text)
    case "list":
      return block.items.map(plain).join(" ")
    case "image":
      return block.caption ?? ""
    case "code":
      return block.code
    case "table":
      return [...block.columns, ...block.rows.flat()].map(plain).join(" ")
    case "keyFacts":
      return block.items.map((f) => `${f.label} ${f.value}`).join(" ")
    case "divider":
      return ""
  }
}

export const WORDS_PER_MINUTE = 220

/** Whole minutes at about 220 words a minute; at least 1. */
export function estimateReadingMinutes(blocks: PartialBlock[]): number {
  const words = blocks.reduce((sum, b) => {
    const block = normalizeBlock(b)
    return block ? sum + countWords(blockText(block)) : sum
  }, 0)
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

// ---- Dates ---------------------------------------------------------------

/** "Sep 14, 2026". Date-only strings are read as calendar dates (no timezone shift). */
export function formatDate(
  iso: unknown,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!isString(iso) || !iso) return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso)
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: dateOnly ? "UTC" : undefined,
  }).format(d)
}

// ---- Markdown ------------------------------------------------------------

export type MarkdownArticle = {
  title?: string
  subtitle?: string
  byline?: { author?: string; publication?: string; url?: string }
  publishedAt?: string
  hero?: { src?: string; alt?: string; caption?: string }
  blocks: PartialBlock[]
  sources?: Partial<ArticleSource>[]
}

const md = (text: string) => inlineToMarkdown(parseInline(text))

/** Stop a paragraph that starts with "# ", "- ", "1. " or ">" turning into another block. */
function escapeLineStart(text: string) {
  return text.replace(/^(\s*)(#{1,6}\s|[-+*]\s|\d+[.)]\s|>)/, "$1\\$2")
}

function tableCell(text: string) {
  return md(text)
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ")
}

function fence(code: string) {
  const longest = Math.max(
    0,
    ...(code.match(/`+/g) ?? []).map((run) => run.length),
  )
  return "`".repeat(Math.max(3, longest + 1))
}

function blockToMarkdown(b: ArticleBlockInput): string {
  switch (b.type) {
    case "heading":
      return `${b.level === 3 ? "###" : "##"} ${b.text.replace(/\s*\n\s*/g, " ")}`
    case "paragraph":
      return escapeLineStart(md(b.text))
    case "list":
      return b.items
        .map((item, i) => `${b.ordered ? `${i + 1}.` : "-"} ${md(item)}`)
        .join("\n")
    case "quote": {
      const lines = b.text.split("\n").map((l) => `> ${l}`)
      if (b.cite) lines.push(">", `> — ${b.cite}`)
      return lines.join("\n")
    }
    case "callout": {
      const label = b.tone === "warning" ? "Warning" : "Note"
      return md(b.text)
        .split("\n")
        .map((l, i) => (i === 0 ? `> **${label}:** ${l}` : `> ${l}`))
        .join("\n")
    }
    case "image": {
      const src = safeImageSrc(b.src)
      if (!src) return ""
      const img = `![${b.alt.replace(/[[\]]/g, "")}](${src})`
      return b.caption ? `${img}\n\n*${b.caption}*` : img
    }
    case "code": {
      const f = fence(b.code)
      return `${f}${b.language ?? ""}\n${b.code.replace(/\n$/, "")}\n${f}`
    }
    case "table": {
      const width = b.columns.length
      const row = (cells: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => tableCell(cells[i] ?? "")).join(" | ")} |`
      return [
        row(b.columns),
        `| ${b.columns.map(() => "---").join(" | ")} |`,
        ...b.rows.map(row),
      ].join("\n")
    }
    case "divider":
      return "---"
    case "keyFacts":
      return b.items.map((f) => `- **${f.label}:** ${f.value}`).join("\n")
  }
}

/** The whole article as Markdown. Unsafe links and images are left out. */
export function toMarkdown(
  article: MarkdownArticle,
  locale: string = DEFAULT_LOCALE,
): string {
  const parts: string[] = []
  if (article.title) parts.push(`# ${article.title}`)
  if (article.subtitle) parts.push(`*${article.subtitle}*`)

  const { author, publication, url } = article.byline ?? {}
  const href = safeHttpUrl(url)
  const meta = [
    author ? `By ${author}` : null,
    publication && href
      ? `[${publication}](${href})`
      : (publication ?? (href ? `<${href}>` : null)),
    formatDate(article.publishedAt, locale),
  ].filter(Boolean)
  if (meta.length) parts.push(meta.join(" · "))

  const heroSrc = safeImageSrc(article.hero?.src)
  if (heroSrc) {
    parts.push(
      `![${(article.hero?.alt ?? "").replace(/[[\]]/g, "")}](${heroSrc})`,
    )
    if (article.hero?.caption) parts.push(`*${article.hero.caption}*`)
  }

  for (const b of article.blocks) {
    const block = normalizeBlock(b)
    if (!block) continue
    const out = blockToMarkdown(block)
    if (out) parts.push(out)
  }

  const sources = (article.sources ?? []).filter(
    (s): s is Partial<ArticleSource> & { title: string } => isString(s?.title),
  )
  if (sources.length) {
    parts.push("## Sources")
    parts.push(
      sources
        .map((s, i) => {
          const link = safeHttpUrl(s.url)
          const title = link ? `[${s.title}](${link})` : s.title
          return `${i + 1}. ${title}${s.publisher ? `, ${s.publisher}` : ""}`
        })
        .join("\n"),
    )
  }
  return `${parts.join("\n\n")}\n`
}

/** "q3-churn-brief.md" */
export function markdownFilename(title?: string) {
  return `${slugify(title ?? "", "article")}.md`
}
