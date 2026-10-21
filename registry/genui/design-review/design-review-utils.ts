import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type {
  DesignReviewKind,
  DesignReviewResult,
} from "./design-review.schema"

export const KIND_LABEL: Record<DesignReviewKind, string> = {
  rule: "Rule",
  component: "Component",
  pattern: "Pattern",
  token: "Token",
  artifact: "Artifact",
  flow: "Flow",
}

export const RISK_LABEL = {
  low: "Low impact",
  medium: "Medium impact",
  high: "High impact",
} as const

/** Text blocks: runs of "- " lines become a list, other lines paragraphs. */
export type TextBlock =
  | { type: "p"; text: string }
  | { type: "list"; items: string[] }

export function textBlocks(text: string): TextBlock[] {
  const blocks: TextBlock[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const item = /^[-*•]\s+(.*)$/.exec(line)
    if (item) {
      const last = blocks[blocks.length - 1]
      if (last?.type === "list") last.items.push(item[1])
      else blocks.push({ type: "list", items: [item[1]] })
    } else {
      blocks.push({ type: "p", text: line })
    }
  }
  return blocks
}

/** A colour the browser can paint and that can't escape the style value. */
export function safeColor(value: string | undefined): string | null {
  if (!value) return null
  const v = value.trim()
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return v
  if (/^(?:rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,%\s/+-]+\)$/i.test(v)) return v
  return null
}

/** Image src: http(s), or a same-site path with a single leading "/". */
export function safeImageSrc(url: string | undefined): string | null {
  if (!url) return null
  const u = url.trim()
  if (/^\/(?![/\\])/.test(u)) return u
  try {
    const parsed = new URL(u)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}

export function safeHttpUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}

/** "Oct 13, 2026", in UTC so server and client agree. */
export function formatDay(
  iso: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** The decision as a badge and a one-line record. */
export function decisionMeta(result: DesignReviewResult) {
  switch (result.action) {
    case "approve":
      return { badge: "Approved", tone: "success" as const, verb: "Approved" }
    case "decline":
      return {
        badge: "Declined",
        tone: "destructive" as const,
        verb: "Declined",
      }
    case "modify":
      return {
        badge: "Changes requested",
        tone: "info" as const,
        verb: "Sent back with changes",
      }
  }
}

export function checkSummary(checks: { status: "pass" | "warn" | "fail" }[]): {
  pass: number
  warn: number
  fail: number
} {
  const tally = { pass: 0, warn: 0, fail: 0 }
  for (const c of checks) tally[c.status] += 1
  return tally
}
