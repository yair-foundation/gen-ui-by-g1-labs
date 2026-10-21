"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  PreviewCard,
  PreviewCardPanel,
  PreviewCardTrigger,
} from "@/components/animate-ui/components/base/preview-card"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Skeleton, genuiType } from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"

import type { CitationsInput, Source } from "./citations.schema"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type CitationsStatus = "streaming" | "ready"

export type CitationsProps = Partial<Omit<CitationsInput, "sources">> & {
  /** Sources may be partial while the tool call streams. */
  sources?: Partial<Source>[]
  /** Lifecycle, controlled by the host. */
  status?: CitationsStatus
  /**
   * "inline" (default): the answer with citation chips, then the sources.
   * "sources": only the sources list, for hosts that render the answer text
   * themselves or don't show prose.
   */
  display?: "inline" | "sources"
  className?: string
}

type ReadySource = Source & { n: number }

/** Only http(s) links are rendered as links; anything else is dropped. */
function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}

function siteName(s: Partial<Source>) {
  if (s.publisher) return s.publisher
  const host = safeUrl(s.url)?.hostname.replace(/^www\./, "")
  return host ? host.split(".").slice(0, -1).join(".") || host : "source"
}

function formatDate(iso: string | undefined, locale: string) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d)
}

// ---- Text parsing --------------------------------------------------------

// Keys are assigned while parsing; the text is append-only as it streams,
// so positional keys stay stable.
type Inline =
  | { key: string; kind: "text"; value: string; bold?: boolean }
  | { key: string; kind: "cite"; refs: number[] }
type Block =
  | { key: string; kind: "p"; inline: Inline[] }
  | { key: string; kind: "ul"; items: { key: string; inline: Inline[] }[] }

const MARKERS = /((?:\[\d+(?:\s*,\s*\d+)*\])+)/g

function parseInline(line: string, prefix: string): Inline[] {
  const out: Inline[] = []
  const key = () => `${prefix}-${out.length}`
  for (const part of line.split(MARKERS)) {
    if (!part) continue
    if (/^\[\d/.test(part)) {
      const refs = [...part.matchAll(/\d+/g)].map((m) => Number(m[0]))
      out.push({ key: key(), kind: "cite", refs: [...new Set(refs)] })
    } else {
      part.split(/(\*\*[^*]+\*\*)/g).forEach((t) => {
        if (!t) return
        if (t.startsWith("**") && t.endsWith("**") && t.length > 4) {
          out.push({
            key: key(),
            kind: "text",
            value: t.slice(2, -2),
            bold: true,
          })
        } else out.push({ key: key(), kind: "text", value: t })
      })
    }
  }
  return out
}

function parseText(text: string, streaming: boolean): Block[] {
  // Hide a marker that's still being written, e.g. a trailing "[1" or "[".
  const src = streaming ? text.replace(/\[[\d,\s]*$/, "") : text
  return src
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b, bi): Block => {
      const key = `b${bi}`
      const lines = b.split("\n")
      if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
        return {
          key,
          kind: "ul",
          items: lines.map((l, li) => ({
            key: `${key}-${li}`,
            inline: parseInline(l.replace(/^\s*[-*]\s+/, ""), `${key}-${li}`),
          })),
        }
      }
      return { key, kind: "p", inline: parseInline(lines.join(" "), key) }
    })
}

function Chip({
  refs,
  byN,
  marker,
  streaming,
  listId,
  onJump,
}: {
  refs: number[]
  byN: Map<number, ReadySource>
  marker: "domain" | "number"
  streaming: boolean
  listId: string
  onJump: (n: number) => void
}) {
  const locale = useGenUILocale()
  const found = refs.map((n) => byN.get(n)).filter((s): s is ReadySource => !!s)
  const first = found[0]
  if (!first) {
    // Still streaming in, or the agent cited a source it didn't provide.
    return streaming ? (
      <Skeleton className="mx-0.5 inline-block h-4 w-10 rounded-full align-middle" />
    ) : (
      <Tooltip>
        <TooltipTrigger
          render={
            <Badge
              variant="warning"
              className="mx-0.5 px-1.5 text-[13px]"
              role="img"
              aria-label="Missing source"
            />
          }
        >
          ?
        </TooltipTrigger>
        <TooltipContent>
          This citation points to a source that wasn&apos;t provided
        </TooltipContent>
      </Tooltip>
    )
  }
  const label =
    marker === "number"
      ? found.map((s) => s.n).join(",")
      : `${siteName(first)}${found.length > 1 ? ` +${found.length - 1}` : ""}`
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={250}
        closeDelay={100}
        render={
          <motion.a
            href={`#${listId}-${first.n}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            aria-label={`Source: ${found.map((s) => s.title).join("; ")}`}
            onClick={(e: React.MouseEvent) => {
              e.preventDefault()
              onJump(first.n)
            }}
            className={cn(
              "mx-0.5 inline-flex items-center gap-1 rounded-full border border-border bg-transparent align-[0.1em] text-[13px] leading-5 font-medium text-muted-foreground no-underline transition-colors outline-none hover:bg-foreground/15 hover:text-foreground dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring/50",
              marker === "number"
                ? "min-w-5 justify-center px-1.5"
                : "max-w-40 px-2",
            )}
          />
        }
      >
        <span className="truncate">{label}</span>
      </PreviewCardTrigger>
      <PreviewCardPanel side="top" className="flex w-72 flex-col gap-3 p-3">
        {found.map((s) => (
          <div key={s.n} className="flex flex-col gap-1">
            <p className={cn(genuiType.body, "leading-snug font-medium")}>
              {s.title}
            </p>
            {s.quote && <p className={genuiType.body}>“{s.quote}”</p>}
            <p className={cn(genuiType.meta, "truncate")}>
              {siteName(s)}
              {formatDate(s.published, locale) &&
                ` · ${formatDate(s.published, locale)}`}
            </p>
          </div>
        ))}
      </PreviewCardPanel>
    </PreviewCard>
  )
}

// ---- Component -----------------------------------------------------------

export function Citations({
  text = "",
  sources = [],
  marker = "domain",
  status = "ready",
  display = "inline",
  className,
}: CitationsProps) {
  const locale = useGenUILocale()
  // Expanded by default; the user can still collapse the list.
  const [open, setOpen] = React.useState(true)
  const [highlight, setHighlight] = React.useState<number | null>(null)
  const listId = React.useId()
  const streaming = status === "streaming"

  const ready: ReadySource[] = sources.flatMap((s, i) =>
    typeof s.title === "string" && typeof s.url === "string"
      ? [{ ...(s as Source), n: i + 1 }]
      : [],
  )
  const byN = new Map(ready.map((s) => [s.n, s]))
  const blocks = display === "sources" ? [] : parseText(text, streaming)

  const jumpTo = (n: number) => {
    setOpen(true)
    setHighlight(n)
    // After the list expands, bring the source into view and focus its link.
    requestAnimationFrame(() => {
      const el = document.getElementById(`${listId}-${n}`)
      el?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      el?.querySelector("a")?.focus({ preventScroll: true })
    })
    setTimeout(() => setHighlight((h) => (h === n ? null : h)), 1600)
  }

  const renderInline = (inline: Inline[]) =>
    inline.map((t) =>
      t.kind === "cite" ? (
        <Chip
          key={t.key}
          refs={t.refs}
          byN={byN}
          marker={marker}
          streaming={streaming}
          listId={listId}
          onJump={jumpTo}
        />
      ) : t.bold ? (
        <strong key={t.key}>{t.value}</strong>
      ) : (
        <React.Fragment key={t.key}>{t.value}</React.Fragment>
      ),
    )

  return (
    <MotionConfig reducedMotion="user">
      <div
        data-genui=""
        data-slot="citations"
        data-status={status}
        aria-busy={streaming}
        className={cn(
          "@container flex flex-col gap-3 text-[14px] leading-relaxed",
          className,
        )}
      >
        {blocks.map((b) =>
          b.kind === "p" ? (
            <p key={b.key}>{renderInline(b.inline)}</p>
          ) : (
            <ul key={b.key} className="flex list-disc flex-col gap-1 pl-5">
              {b.items.map((item) => (
                <li key={item.key}>{renderInline(item.inline)}</li>
              ))}
            </ul>
          ),
        )}
        {streaming && blocks.length === 0 && ready.length === 0 && (
          <ShimmeringText
            text="Reading sources…"
            color="var(--muted-foreground)"
            shimmeringColor="var(--foreground)"
            className="text-[13px]"
          />
        )}

        {ready.length > 0 && (
          <div className="flex flex-col gap-3">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={listId}
              onClick={() => setOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-md text-left text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              Sources
              <Badge variant="info" className="tabular-nums">
                {ready.length}
              </Badge>
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "ml-auto size-4 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
            <AutoHeight>
              {/* Kept in the DOM while collapsed so aria-controls and jumps resolve. */}
              <ol
                id={listId}
                hidden={!open}
                className="flex flex-col divide-y divide-border overflow-hidden rounded-[10px] border border-border"
              >
                {ready.map((s) => {
                  const url = safeUrl(s.url)
                  return (
                    <li
                      key={s.n}
                      id={`${listId}-${s.n}`}
                      className={cn(
                        "flex items-center gap-3 px-3 py-3 transition-colors duration-500",
                        highlight === s.n && "bg-muted dark:bg-white/5",
                      )}
                    >
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] leading-none font-medium text-muted-foreground tabular-nums dark:bg-white/10">
                        {s.n}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:justify-between @md:gap-4">
                        {url ? (
                          <a
                            href={url.href}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className={cn(
                              genuiType.body,
                              "min-w-0 rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50",
                            )}
                          >
                            {s.title}
                            <span className="sr-only">
                              {" "}
                              (opens in a new tab)
                            </span>
                          </a>
                        ) : (
                          <span
                            className={cn(
                              genuiType.body,
                              "min-w-0 font-medium",
                            )}
                          >
                            {s.title}
                          </span>
                        )}
                        <span
                          className={cn(
                            genuiType.meta,
                            "shrink-0 @md:text-right",
                          )}
                        >
                          {siteName(s)}
                          {formatDate(s.published, locale) &&
                            ` · ${formatDate(s.published, locale)}`}
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </AutoHeight>
          </div>
        )}
      </div>
    </MotionConfig>
  )
}
