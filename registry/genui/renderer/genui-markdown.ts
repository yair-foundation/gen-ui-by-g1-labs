import type { GenUICall } from "./genui-renderer"

/*
 * A Markdown fallback for a call, for hosts that can't render components: a
 * plain-text client, an email digest, a voice assistant's transcript, a log.
 * Generic: it walks the props and writes what it finds (a heading from the
 * title, bullet lists, tables for lists of records). Pass a formatter for a
 * tool when you want its fallback worded by hand.
 */

export type MarkdownOptions = {
  /** Per-tool wording, keyed by tool name. Return null to skip the call. */
  formatters?: Record<string, (props: Record<string, unknown>) => string | null>
  /** Cap on the output length. Default 2000 characters. */
  maxChars?: number
}

const TITLE_KEYS = ["title", "name", "heading", "question", "action"]
const SKIP_KEYS = new Set(["id", "toolCallId", "html", "locale", "timezone"])

const label = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase())

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

const scalar = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v === "string") return v.replace(/\|/g, "\\|")
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  return null
}

/** A list of records with mostly scalar fields becomes a table. */
function table(rows: Record<string, unknown>[]): string | null {
  const keys: string[] = []
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (!SKIP_KEYS.has(k) && scalar(v) !== null && !keys.includes(k)) {
        keys.push(k)
      }
    }
  }
  if (keys.length === 0 || keys.length > 6) return null
  const head = `| ${keys.map(label).join(" | ")} |`
  const rule = `| ${keys.map(() => "---").join(" | ")} |`
  const body = rows.map(
    (row) => `| ${keys.map((k) => scalar(row[k]) ?? "").join(" | ")} |`,
  )
  return [head, rule, ...body].join("\n")
}

function node(key: string, value: unknown, depth: number): string[] {
  if (SKIP_KEYS.has(key) || depth > 4) return []
  const s = scalar(value)
  if (s !== null) return [`- **${label(key)}:** ${s}`]
  if (Array.isArray(value)) {
    if (value.length === 0) return []
    if (value.every(isRecord)) {
      const t = table(value)
      if (t) return [`**${label(key)}**`, "", t]
      return [
        `**${label(key)}**`,
        "",
        ...value.flatMap((item, i) => [
          `${i + 1}. ${walk(item, depth + 1).join("\n   ")}`,
        ]),
      ]
    }
    const items = value.map(scalar).filter((v): v is string => v !== null)
    return items.length
      ? [`**${label(key)}:** ${items.join(", ")}`]
      : []
  }
  if (isRecord(value)) {
    const inner = walk(value, depth + 1)
    return inner.length ? [`**${label(key)}**`, "", ...inner, ""] : []
  }
  return []
}

function walk(props: Record<string, unknown>, depth: number): string[] {
  const lines: string[] = []
  for (const [k, v] of Object.entries(props)) {
    if (TITLE_KEYS.includes(k) && depth === 0) continue
    lines.push(...node(k, v, depth))
  }
  return lines
}

/**
 * The call as Markdown. Interactive parts become text: there's nothing to
 * press, so say in prose what the user can ask for.
 */
export function callToMarkdown(
  call: Pick<GenUICall, "name" | "props">,
  { formatters = {}, maxChars = 2000 }: MarkdownOptions = {},
): string {
  const custom = formatters[call.name]?.(call.props)
  if (custom === null) return ""
  if (typeof custom === "string") return custom
  const titleKey = TITLE_KEYS.find((k) => typeof call.props[k] === "string")
  const title = titleKey ? (call.props[titleKey] as string) : undefined
  const lines = [...(title ? [`### ${title}`, ""] : []), ...walk(call.props, 0)]
  const out = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return out.length > maxChars ? `${out.slice(0, maxChars - 1)}…` : out
}
