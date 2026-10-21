/**
 * Artifact Preview: pure helpers (no React, no DOM), so they can be
 * unit-tested and run anywhere.
 *
 * - safeSource: which `src` values may be loaded, framed, opened or
 *   downloaded, by kind (data: URLs must carry a MIME type that matches).
 * - decodeDataText: the text inside a data: URL, for text-like previews.
 * - parseCsv: RFC 4180 (quoted commas, "" escapes, newlines in quotes).
 * - parseJson: a strict JSON parser that builds a tree model (paths, depth)
 *   and reports errors with line and column.
 * - parseMarkdown / parseInline: a tiny block and inline parser. Links are
 *   http(s) only; nothing is ever turned into HTML.
 * - formatSize / metaParts / resolveActions: words and defaults for the UI.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export const ARTIFACT_KINDS = [
  "pdf",
  "image",
  "code",
  "text",
  "csv",
  "json",
  "markdown",
  "other",
] as const
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number]

export const ARTIFACT_ACTIONS = ["download", "open"] as const
export type ArtifactAction = (typeof ARTIFACT_ACTIONS)[number]

/** Kinds whose content is text the component can show. */
export const TEXT_KINDS: readonly ArtifactKind[] = [
  "code",
  "text",
  "csv",
  "json",
  "markdown",
]

export function isTextKind(kind: ArtifactKind | undefined): boolean {
  return kind !== undefined && TEXT_KINDS.includes(kind)
}

export function normalizeKind(kind: unknown): ArtifactKind {
  return typeof kind === "string" &&
    (ARTIFACT_KINDS as readonly string[]).includes(kind)
    ? (kind as ArtifactKind)
    : "other"
}

// ---- URLs ----------------------------------------------------------------

export type SafeSource = {
  url: string
  scheme: "http" | "blob" | "data"
  /** Lowercased MIME type, for data: URLs only. */
  mime?: string
}

/** MIME types a data: URL may carry for each kind. */
const DATA_MIME: Record<ArtifactKind, RegExp> = {
  pdf: /^application\/pdf$/,
  image: /^image\/(?:png|jpeg|gif|webp|avif|svg\+xml)$/,
  code: /^(?:text\/(?:plain|x-[a-z0-9.+-]+|javascript|css|csv|markdown|xml|x-sql)|application\/(?:json|javascript|typescript|sql|xml|x-sh|x-yaml|yaml|toml))$/,
  text: /^text\/plain$/,
  csv: /^(?:text\/csv|text\/plain)$/,
  json: /^(?:application\/json|text\/plain)$/,
  markdown: /^(?:text\/markdown|text\/x-markdown|text\/plain)$/,
  // Anything else is only ever downloaded, but never a type a browser would
  // run as a page or script if the file were opened from the download bar.
  other:
    /^(?!text\/html$|application\/xhtml\+xml$|image\/svg\+xml$|text\/javascript$|application\/javascript$)[a-z0-9.+-]+\/[a-z0-9.+-]+$/,
}

const DATA_URL = /^data:([^,]*?),/i

/** The MIME type of a data: URL ("" when none is given), or null. */
export function dataUrlMime(url: string): string | null {
  const match = DATA_URL.exec(url)
  if (!match) return null
  return (match[1].split(";")[0] ?? "").trim().toLowerCase()
}

/** The normalized URL if it is an absolute http(s) link, otherwise null. */
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
 * Whether `src` may be used for this kind, and how:
 * - http(s): any kind.
 * - blob: only with an http(s) origin (created by the host page).
 * - data: only when its MIME type matches the kind (no data:text/html, no
 *   data:image/svg+xml for a "code" file, and so on).
 * Everything else (javascript:, file:, relative paths) is null.
 */
export function safeSource(
  src: unknown,
  kind: ArtifactKind,
): SafeSource | null {
  if (typeof src !== "string") return null
  const value = src.trim()
  if (!value) return null
  if (/^data:/i.test(value)) {
    const mime = dataUrlMime(value)
    if (!mime || !DATA_MIME[kind].test(mime)) return null
    return { url: value, scheme: "data", mime }
  }
  if (/^blob:/i.test(value)) {
    return safeHttpUrl(value.slice(5)) ? { url: value, scheme: "blob" } : null
  }
  const http = safeHttpUrl(value)
  return http ? { url: http, scheme: "http" } : null
}

/** Opening in a new tab is limited to http(s) and blob: URLs. */
export function canOpen(source: SafeSource | null): boolean {
  return source?.scheme === "http" || source?.scheme === "blob"
}

/**
 * The browser's PDF viewer can frame http(s) and blob: URLs. data: PDFs are
 * blocked in frames by several browsers, so they get the fallback instead.
 */
export function canFramePdf(source: SafeSource | null): boolean {
  return canOpen(source)
}

/**
 * The text inside a data: URL (base64 or percent-encoded, UTF-8), or null
 * when it isn't one or can't be decoded.
 */
export function decodeDataText(url: string): string | null {
  const match = DATA_URL.exec(url)
  if (!match) return null
  const params = match[1].split(";").map((p) => p.trim().toLowerCase())
  const payload = url.slice(match[0].length)
  try {
    if (params.includes("base64")) {
      const binary = atob(payload.replace(/\s+/g, ""))
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    }
    return decodeURIComponent(payload)
  } catch {
    return null
  }
}

/** A file name safe to suggest for a download: no paths or control chars. */
export function safeFileName(name: unknown, fallback = "download"): string {
  if (typeof name !== "string") return fallback
  const base = name.split(/[\\/]/).pop() ?? ""
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
  const clean = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").trim()
  return clean && clean !== "." && clean !== ".." ? clean : fallback
}

/** MIME type for a Blob built from inline content. */
export function contentMime(kind: ArtifactKind): string {
  switch (kind) {
    case "csv":
      return "text/csv;charset=utf-8"
    case "json":
      return "application/json;charset=utf-8"
    case "markdown":
      return "text/markdown;charset=utf-8"
    default:
      return "text/plain;charset=utf-8"
  }
}

// ---- Actions -------------------------------------------------------------

/** Used when the agent doesn't pass `actions`. */
export function defaultActions(kind: ArtifactKind): ArtifactAction[] {
  return isTextKind(kind) ? ["download"] : ["open", "download"]
}

/**
 * The actions to show, in a fixed order, keeping only ones that can work:
 * Open needs an http(s)/blob URL, Download needs either a URL or text.
 * Unknown values are dropped (the set is closed).
 */
export function resolveActions(
  requested: readonly unknown[] | undefined,
  kind: ArtifactKind,
  can: { download: boolean; open: boolean },
): ArtifactAction[] {
  const wanted = new Set(
    (requested ?? defaultActions(kind)).filter(
      (a): a is ArtifactAction =>
        typeof a === "string" &&
        (ARTIFACT_ACTIONS as readonly string[]).includes(a),
    ),
  )
  const order: ArtifactAction[] = ["open", "download"]
  return order.filter((a) => wanted.has(a) && can[a])
}

// ---- Formatting ----------------------------------------------------------

/** Human-readable size: 1536 → "1.5 KB", 48_300_000 → "46 MB". */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  if (rounded >= 1024 && i < units.length - 1) return `1 ${units[i + 1]}`
  return `${rounded} ${units[i]}`
}

/** UTF-8 byte length of a string. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

export function formatCount(
  n: number,
  one: string,
  many = `${one}s`,
  locale: string = DEFAULT_LOCALE,
) {
  return `${new Intl.NumberFormat(locale).format(n)} ${n === 1 ? one : many}`
}

/** The upper-cased extension of a file name ("report.csv" → "CSV"), or "". */
export function extensionOf(name: string | undefined): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name ?? "")
  return match ? match[1].toUpperCase() : ""
}

/** "PDF", "SVG image", "SQL", "CSV", "JSON", "Markdown", "ZIP file"… */
export function kindLabel(
  kind: ArtifactKind,
  name?: string,
  language?: string,
): string {
  const ext = extensionOf(name)
  switch (kind) {
    case "pdf":
      return "PDF"
    case "image":
      return ext ? `${ext} image` : "Image"
    case "code":
      return language?.trim() || ext || "Code"
    case "text":
      return "Text"
    case "csv":
      return "CSV"
    case "json":
      return "JSON"
    case "markdown":
      return "Markdown"
    default:
      return ext ? `${ext} file` : "File"
  }
}

/** "2" → "v2", "v2.1" → "v2.1", "Draft" → "Draft". */
export function formatVersion(version: string | undefined): string {
  const v = version?.trim()
  if (!v) return ""
  return /^\d/.test(v) ? `v${v}` : v
}

/** Medium date ("Oct 8, 2026"); date-only strings are read as UTC. */
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

/** The facts after the file name: "PDF · 4 pages · 212 KB · v2". */
export function metaParts(
  input: {
    kind: ArtifactKind
    name?: string
    language?: string
    pages?: number
    lines?: number
    rows?: number
    sizeBytes?: number
    version?: string
  },
  locale: string = DEFAULT_LOCALE,
): string[] {
  const parts = [kindLabel(input.kind, input.name, input.language)]
  if (input.kind === "pdf" && input.pages && input.pages > 0) {
    parts.push(formatCount(Math.round(input.pages), "page", undefined, locale))
  }
  if (input.rows !== undefined)
    parts.push(formatCount(input.rows, "row", undefined, locale))
  else if (input.lines !== undefined && input.lines > 0) {
    parts.push(formatCount(input.lines, "line", undefined, locale))
  }
  const size = formatSize(input.sizeBytes)
  if (size) parts.push(size)
  const version = formatVersion(input.version)
  if (version) parts.push(version)
  return parts
}

/** Lines of a text file; a trailing newline doesn't add an empty line. */
export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split(/\r\n|\r|\n/)
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
  return lines
}

// ---- CSV -----------------------------------------------------------------

export type CsvResult = {
  /** Every record, header included, padded to the same width. */
  rows: string[][]
  /** Set when a quoted field never closes (the rest became one field). */
  error?: string
}

/**
 * RFC 4180 with the usual leniencies: CRLF, LF or CR line breaks, a leading
 * BOM, a missing final newline, and stray quotes inside unquoted fields kept
 * as text. Empty lines are skipped.
 */
export function parseCsv(text: string, delimiter = ","): CsvResult {
  const rows: string[][] = []
  let error: string | undefined
  let row: string[] = []
  let field = ""
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0
  let quoted = false
  let fieldStarted = false

  const endField = () => {
    row.push(field)
    field = ""
    fieldStarted = false
  }
  const endRow = () => {
    endField()
    // A blank line is a single empty field: skip it.
    if (!(row.length === 1 && row[0] === "")) rows.push(row)
    row = []
  }

  while (i < text.length) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }
    if (ch === '"' && !fieldStarted) {
      quoted = true
      fieldStarted = true
      i++
      continue
    }
    if (ch === delimiter) {
      endField()
      i++
      continue
    }
    if (ch === "\r" || ch === "\n") {
      endRow()
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1
      continue
    }
    field += ch
    fieldStarted = true
    i++
  }
  if (quoted) error = "A quoted field is never closed."
  if (field !== "" || fieldStarted || row.length > 0) endRow()

  const width = rows.reduce((max, r) => Math.max(max, r.length), 0)
  for (const r of rows) while (r.length < width) r.push("")
  return error ? { rows, error } : { rows }
}

/** "Showing 200 of 1,240 rows", or "60 rows" when everything is shown. */
export function csvRowsLabel(
  shown: number,
  total: number,
  locale: string = DEFAULT_LOCALE,
): string {
  return shown < total
    ? `Showing ${new Intl.NumberFormat(locale).format(shown)} of ${formatCount(total, "row", undefined, locale)}`
    : formatCount(total, "row", undefined, locale)
}

const NUMERIC = /^[-+]?[$€£¥]?\s?\d[\d,]*(?:\.\d+)?%?$|^[-+]?\.\d+$/

/** Columns whose non-empty cells are all numbers (right-aligned in tables). */
export function numericColumns(rows: string[][]): boolean[] {
  const width = rows[0]?.length ?? 0
  return Array.from({ length: width }, (_, c) => {
    let seen = false
    for (const r of rows) {
      const v = r[c]?.trim() ?? ""
      if (!v) continue
      if (!NUMERIC.test(v)) return false
      seen = true
    }
    return seen
  })
}

// ---- JSON ----------------------------------------------------------------

export type JsonType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null"

export type JsonNode = {
  /** JSONPath-style address: $, $.items[0], $["first name"]. */
  path: string
  /** Property name or array index; null for the root. */
  key: string | number | null
  depth: number
  type: JsonType
  /** For primitives. */
  value?: string | number | boolean | null
  /** For objects and arrays, in source order. */
  children?: JsonNode[]
}

export type JsonError = {
  message: string
  /** 1-based. */
  line: number
  /** 1-based. */
  column: number
  /** 0-based character offset. */
  offset: number
}

export type JsonParseResult =
  | { ok: true; root: JsonNode }
  | { ok: false; error: JsonError }

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const MAX_JSON_DEPTH = 512

export function childPath(parent: string, key: string | number): string {
  if (typeof key === "number") return `${parent}[${key}]`
  return IDENTIFIER.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`
}

/** 1-based line and column of a character offset. */
export function lineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  const end = Math.min(offset, text.length)
  for (let i = 0; i < end; i++) {
    const ch = text[i]
    if (ch === "\n" || (ch === "\r" && text[i + 1] !== "\n")) {
      line++
      lineStart = i + 1
    }
  }
  return { line, column: end - lineStart + 1 }
}

class JsonSyntaxError extends Error {
  readonly offset: number
  constructor(message: string, offset: number) {
    super(message)
    this.offset = offset
  }
}

const NUMBER = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y
const describe = (ch: string | undefined) =>
  ch === undefined ? "end of input" : `'${ch}'`

/**
 * A strict JSON parser (RFC 8259) that builds the tree directly, so keys
 * like "__proto__" are plain data, and reports where it failed.
 */
export function parseJson(text: string): JsonParseResult {
  let i = 0

  const ws = () => {
    while (i < text.length) {
      const c = text[i]
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++
      else break
    }
  }
  const fail = (message: string, at = i): never => {
    throw new JsonSyntaxError(message, at)
  }

  const parseString = (): string => {
    const start = i
    i++ // opening quote
    while (i < text.length) {
      const c = text[i]
      if (c === '"') {
        i++
        return JSON.parse(text.slice(start, i)) as string
      }
      if (c === "\\") {
        const next = text[i + 1]
        if (next === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
            fail("Invalid unicode escape in string", i)
          }
          i += 6
          continue
        }
        if (next === undefined || !'"\\/bfnrt'.includes(next)) {
          fail("Invalid escape in string", i)
        }
        i += 2
        continue
      }
      if (c.charCodeAt(0) < 0x20) fail("Unescaped control character in string")
      i++
    }
    return fail("Unterminated string", start)
  }

  const parseValue = (
    path: string,
    key: string | number | null,
    depth: number,
  ): JsonNode => {
    if (depth > MAX_JSON_DEPTH) fail("Nesting is too deep")
    ws()
    const c = text[i]
    if (c === "{") {
      i++
      const children: JsonNode[] = []
      ws()
      if (text[i] === "}") {
        i++
        return { path, key, depth, type: "object", children }
      }
      while (true) {
        ws()
        if (text[i] !== '"') {
          fail(
            `Expected a property name in double quotes, found ${describe(text[i])}`,
          )
        }
        const name = parseString()
        ws()
        if (text[i] !== ":") {
          fail(`Expected ':' after property name, found ${describe(text[i])}`)
        }
        i++
        children.push(parseValue(childPath(path, name), name, depth + 1))
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "}") {
          i++
          return { path, key, depth, type: "object", children }
        }
        fail(
          `Expected ',' or '}' after property value, found ${describe(text[i])}`,
        )
      }
    }
    if (c === "[") {
      i++
      const children: JsonNode[] = []
      ws()
      if (text[i] === "]") {
        i++
        return { path, key, depth, type: "array", children }
      }
      while (true) {
        const index = children.length
        children.push(parseValue(childPath(path, index), index, depth + 1))
        ws()
        if (text[i] === ",") {
          i++
          continue
        }
        if (text[i] === "]") {
          i++
          return { path, key, depth, type: "array", children }
        }
        fail(`Expected ',' or ']' after array item, found ${describe(text[i])}`)
      }
    }
    if (c === '"') {
      return { path, key, depth, type: "string", value: parseString() }
    }
    for (const [word, value] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const) {
      if (text.startsWith(word, i)) {
        i += word.length
        return {
          path,
          key,
          depth,
          type: value === null ? "null" : "boolean",
          value,
        }
      }
    }
    if (c === "-" || (c !== undefined && c >= "0" && c <= "9")) {
      NUMBER.lastIndex = i
      const match = NUMBER.exec(text)
      if (!match) return fail("Invalid number")
      i += match[0].length
      return { path, key, depth, type: "number", value: Number(match[0]) }
    }
    return fail(
      c === undefined
        ? "Unexpected end of input"
        : `Unexpected character ${describe(c)}`,
    )
  }

  try {
    const root = parseValue("$", null, 0)
    ws()
    if (i < text.length)
      fail(`Unexpected ${describe(text[i])} after the JSON value`)
    return { ok: true, root }
  } catch (e) {
    if (!(e instanceof JsonSyntaxError)) throw e
    const offset = Math.min(e.offset, text.length)
    return {
      ok: false,
      error: { message: e.message, offset, ...lineColumn(text, offset) },
    }
  }
}

export function isContainer(node: JsonNode): boolean {
  return node.type === "object" || node.type === "array"
}

/** Paths of containers shallower than `maxDepth`: open by default. */
export function defaultExpanded(root: JsonNode, maxDepth = 2): Set<string> {
  const open = new Set<string>()
  const walk = (node: JsonNode) => {
    if (!isContainer(node) || node.depth >= maxDepth) return
    open.add(node.path)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return open
}

/** Every container path, for "Expand all". */
export function allContainerPaths(root: JsonNode): Set<string> {
  const open = new Set<string>()
  const walk = (node: JsonNode) => {
    if (!isContainer(node)) return
    open.add(node.path)
    for (const child of node.children ?? []) walk(child)
  }
  walk(root)
  return open
}

/** "3 keys", "12 items", "empty". */
export function containerSummary(
  node: JsonNode,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = node.children?.length ?? 0
  if (n === 0) return "empty"
  return node.type === "array"
    ? formatCount(n, "item", undefined, locale)
    : formatCount(n, "key", undefined, locale)
}

/** A primitive as JSON source text: strings quoted, the rest as is. */
export function primitiveText(node: JsonNode): string {
  if (node.type === "string") return JSON.stringify(node.value)
  return String(node.value)
}

/** Pretty-printed JSON (2 spaces) or null when it doesn't parse. */
export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

// ---- Markdown ------------------------------------------------------------

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: InlineNode[] }

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: string[] }
  | { type: "code"; language?: string; code: string }
  | { type: "quote"; text: string }
  | { type: "rule" }

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const BULLET = /^ {0,3}[-*+][ \t]+(.*)$/
const ORDERED = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/
const RULE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/
const QUOTE = /^ {0,3}>[ \t]?(.*)$/

/**
 * Block structure: ATX headings, paragraphs, flat bullet and numbered
 * lists, fenced code, block quotes and rules. Nested lists are flattened.
 */
export function parseMarkdown(text: string): MarkdownBlock[] {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\r|\n/)
  const blocks: MarkdownBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length) {
        const close = lines[i].trim()
        if (
          close.startsWith(marker[0].repeat(marker.length)) &&
          /^(`+|~+)$/.test(close)
        ) {
          i++
          break
        }
        body.push(lines[i])
        i++
      }
      blocks.push({
        type: "code",
        language: fence[2] || undefined,
        code: body.join("\n"),
      })
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        text: (heading[2] ?? "").trim(),
      })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ type: "rule" })
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push((QUOTE.exec(lines[i])?.[1] ?? "").trim())
        i++
      }
      blocks.push({ type: "quote", text: body.filter(Boolean).join(" ") })
      continue
    }
    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (bullet || ordered) {
      const isOrdered = !bullet
      const items: string[] = []
      while (i < lines.length) {
        const l = lines[i]
        const b = BULLET.exec(l)
        const o = ORDERED.exec(l)
        if (b || o) {
          items.push(((b ? b[1] : o?.[2]) ?? "").trim())
          i++
          continue
        }
        // Indented continuation of the previous item.
        if (l.trim() && /^\s+/.test(l) && items.length) {
          items[items.length - 1] += ` ${l.trim()}`
          i++
          continue
        }
        break
      }
      blocks.push({
        type: "list",
        ordered: isOrdered,
        start: isOrdered ? Number(ordered?.[1] ?? 1) : 1,
        items,
      })
      continue
    }
    const para: string[] = []
    while (i < lines.length) {
      const l = lines[i]
      if (
        !l.trim() ||
        FENCE.test(l) ||
        HEADING.test(l) ||
        RULE.test(l) ||
        QUOTE.test(l) ||
        BULLET.test(l) ||
        ORDERED.test(l)
      ) {
        break
      }
      para.push(l.trim())
      i++
    }
    blocks.push({ type: "paragraph", text: para.join(" ") })
  }
  return blocks
}

type Stop = "**" | "*" | null
type Parsed = { nodes: InlineNode[]; end: number; closed: boolean }

const MAX_INLINE_DEPTH = 6
const ESCAPABLE = /[\\`*[\]()_!#>-]/

function pushNode(nodes: InlineNode[], node: InlineNode) {
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

/** Link targets may carry a title: [a](https://x "Title"). Drop it. */
function linkTarget(raw: string) {
  return raw
    .trim()
    .replace(/\s+(["'(]).*$/, "")
    .replace(/^<(.*)>$/, "$1")
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
    pushNode(nodes, { type: "text", value: buf })
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
        pushNode(nodes, { type: "code", value: src.slice(i + 1, close) })
        i = close + 1
        continue
      }
      buf += ch
      i++
      continue
    }

    if (ch === "*") {
      if (src.startsWith("**", i)) {
        if (depth < MAX_INLINE_DEPTH && hasDoubleStar(src, i + 2, limit)) {
          const inner = parseRange(src, i + 2, limit, "**", depth + 1)
          if (inner.closed) {
            flush()
            pushNode(nodes, { type: "strong", children: inner.nodes })
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
        depth < MAX_INLINE_DEPTH &&
        next !== undefined &&
        !/\s/.test(next) &&
        findSingleStar(src, i + 1, limit) !== -1
      ) {
        const inner = parseRange(src, i + 1, limit, "*", depth + 1)
        if (inner.closed) {
          flush()
          pushNode(nodes, { type: "em", children: inner.nodes })
          i = inner.end
          continue
        }
      }
      buf += ch
      i++
      continue
    }

    // Images are never loaded: ![alt](src) shows its alt text.
    const image = ch === "!" && src[i + 1] === "["
    if (ch === "[" || image) {
      const open = image ? i + 1 : i
      const close = src.indexOf("]", open + 1)
      if (close !== -1 && close < limit && src[close + 1] === "(") {
        const paren = matchParen(src, close + 1, limit)
        if (paren !== -1 && paren < limit) {
          const children = parseRange(
            src,
            open + 1,
            close,
            null,
            depth + 1,
          ).nodes
          const href = image
            ? null
            : safeHttpUrl(linkTarget(src.slice(close + 2, paren)))
          flush()
          if (href) {
            pushNode(nodes, {
              type: "link",
              href,
              children: children.length
                ? children
                : [{ type: "text", value: href }],
            })
          } else {
            // Unsafe or malformed URL, or an image: keep only the words.
            pushNode(nodes, { type: "text", value: toPlainText(children) })
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

// ---- Syntax colours (shared: src/components/genui/code-highlight) --------

export {
  type CodeLanguage,
  codeLanguage,
  type Token,
  type TokenType,
  tokenizeJson,
  tokenizeLines,
  tokenizeSql,
} from "@/components/genui/code-highlight"

// ---- CSV table -----------------------------------------------------------

/** A plain number in a cell (no currency sign, unit or grouping yet), or null. */
function plainNumber(value: string): number | null {
  const v = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * A numeric cell with digit grouping (121250 → "121,250"), keeping the
 * decimals it was written with. Anything else is shown as written.
 */
export function formatCell(
  value: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const n = plainNumber(value)
  if (n === null) return value
  const decimals = value.trim().split(".")[1]?.length ?? 0
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

/** A cell's sortable number: plain, with a currency sign, grouping or a %. */
export function cellNumber(value: string): number | null {
  const v = value.trim().replace(/[$€£¥,%\s]/g, "")
  if (!/^[-+]?\d*\.?\d+$/.test(v)) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export type CsvSort = { column: number; dir: "asc" | "desc" } | null

/**
 * Rows sorted by one column: numerically when the column is numeric,
 * otherwise as text with numbers inside compared by value ("D-9" before
 * "D-10"). Empty cells always go last. Stable for equal values.
 */
export function sortRows(
  rows: readonly string[][],
  sort: CsvSort,
  numeric: boolean,
  locale: string = DEFAULT_LOCALE,
): string[][] {
  if (!sort) return [...rows]
  const sign = sort.dir === "asc" ? 1 : -1
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" })
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row[sort.column]?.trim() ?? ""
      const y = b.row[sort.column]?.trim() ?? ""
      if (!x || !y) return x === y ? a.i - b.i : x ? -1 : 1
      const nx = numeric ? cellNumber(x) : null
      const ny = numeric ? cellNumber(y) : null
      const c = nx !== null && ny !== null ? nx - ny : collator.compare(x, y)
      return c === 0 ? a.i - b.i : c * sign
    })
    .map((d) => d.row)
}

/** The next sort when a column's label is clicked: ascending, descending, off. */
export function nextSort(current: CsvSort, column: number): CsvSort {
  if (!current || current.column !== column) return { column, dir: "asc" }
  return current.dir === "asc" ? { column, dir: "desc" } : null
}

/** Column order with the column at position `from` moved to position `to`. */
export function moveColumn(order: readonly number[], from: number, to: number): number[] {
  const next = [...order]
  if (from < 0 || from >= next.length) return next
  const [col] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, col)
  return next
}
