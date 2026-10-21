"use client"

import * as React from "react"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  InfoIcon,
  QuoteIcon,
  TriangleAlertIcon,
  CalendarIcon,
  ClockIcon,
  UsersIcon,
  UserIcon,
  MapPinIcon,
  WalletIcon,
  CreditCardIcon,
  TagIcon,
  PackageIcon,
  FileTextIcon,
  MailIcon,
  ShieldIcon,
  DatabaseIcon,
  ServerIcon,
  GlobeIcon,
  HashIcon,
  TrendingUpIcon,
  Building2Icon,
  type LucideIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  PreviewCard,
  PreviewCardPanel,
  PreviewCardTrigger,
} from "@/components/animate-ui/components/base/preview-card"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  genuiMotion,
} from "@/components/genui/surface"

import {
  extractToc,
  formatDate,
  headingIds,
  hostName,
  type InlineNode,
  markdownFilename,
  normalizeBlock,
  type PartialBlock,
  parseInline,
  safeHttpUrl,
  safeImageSrc,
  shouldShowToc,
  toMarkdown,
} from "./article-utils"
import type {
  ArticleBlockInput,
  ArticleInput,
  ArticleResult,
  ArticleIcon,
  ArticleSource,
} from "./article.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"
import {
  CODE_BG,
  TOKEN_CLASS,
  codeLanguage,
  tokenizeLines,
} from "@/components/genui/code-highlight"

export type ArticleStatus = "streaming" | "ready"

export type ArticleProps = Partial<Omit<ArticleInput, "blocks" | "sources">> & {
  /** Blocks append as the tool call streams; the last one may be partial. */
  blocks?: PartialBlock[]
  /** Sources may be partial while the tool call streams. */
  sources?: Partial<ArticleSource>[]
  /** Lifecycle, controlled by the host. */
  status?: ArticleStatus
  /**
   * Called when the user copies, downloads or opens the original. For
   * analytics only: the article never locks, so there is nothing to restore.
   */
  onResult?: (result: ArticleResult) => void
  className?: string
}

type ReadySource = Partial<ArticleSource> & {
  title: string
  url: string
  n: number
}

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const newTab = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
} as const

function sourceName(s: Partial<ArticleSource>) {
  return s.publisher || hostName(s.url) || "Source"
}

/** Pairs items with positional keys: content only ever appends while streaming. */
function keyed<T>(items: T[], prefix: string) {
  return items.map((value, i) => ({ value, key: `${prefix}${i}` }))
}

function useCopied() {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  return [copied, copy] as const
}

// ---- Inline ----------------------------------------------------------------

type InlineContext = {
  byN: Map<number, ReadySource>
  streaming: boolean
  listId: string
  onJump: (n: number) => void
}

function Cite({ refs, ctx }: { refs: number[]; ctx: InlineContext }) {
  const found = refs
    .map((n) => ctx.byN.get(n))
    .filter((s): s is ReadySource => !!s)
  const first = found[0]
  if (!first) {
    // Still streaming in, or the agent cited a source it didn't provide.
    return ctx.streaming ? (
      <Skeleton className="ml-1 inline-block h-5 w-6 rounded-full align-middle" />
    ) : (
      <span
        role="img"
        aria-label="Missing source"
        title="This citation points to a source that wasn't provided"
        className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1 align-middle text-[13px] leading-none text-muted-foreground dark:bg-white/10"
      >
        ?
      </span>
    )
  }
  return (
    <PreviewCard>
      <PreviewCardTrigger
        delay={250}
        closeDelay={100}
        render={
          <a
            href={`#${ctx.listId}-${first.n}`}
            aria-label={`Source ${found.map((s) => s.n).join(", ")}: ${found
              .map((s) => s.title)
              .join("; ")}`}
            onClick={(e: React.MouseEvent) => {
              e.preventDefault()
              ctx.onJump(first.n)
            }}
            className={cn(
              "relative ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 align-middle text-[13px] leading-none font-medium text-muted-foreground no-underline transition-colors after:absolute after:-inset-1.5 hover:bg-foreground/15 hover:text-foreground dark:bg-white/10 dark:hover:bg-white/15",
              focusRing,
            )}
          />
        }
      >
        {found.map((s) => s.n).join(",")}
      </PreviewCardTrigger>
      <PreviewCardPanel side="top" className="flex w-72 flex-col gap-3 p-3">
        {found.map((s) => (
          <div key={s.n} className="flex flex-col gap-1">
            <span className="truncate text-[13px] leading-4 text-muted-foreground">
              {s.n}. {sourceName(s)}
            </span>
            <p className="text-[13px] leading-snug font-medium">{s.title}</p>
          </div>
        ))}
      </PreviewCardPanel>
    </PreviewCard>
  )
}

function Inline({ nodes, ctx }: { nodes: InlineNode[]; ctx: InlineContext }) {
  return keyed(nodes, "i").map(({ value: n, key }) => {
    switch (n.type) {
      case "text":
        return <React.Fragment key={key}>{n.value}</React.Fragment>
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            <Inline nodes={n.children} ctx={ctx} />
          </strong>
        )
      case "em":
        return (
          <em key={key}>
            <Inline nodes={n.children} ctx={ctx} />
          </em>
        )
      case "code":
        return (
          <code
            key={key}
            className="rounded border border-border bg-transparent px-1 py-0.5 font-mono text-[13px]"
          >
            {n.value}
          </code>
        )
      case "link":
        return (
          <a
            key={key}
            href={n.href}
            {...newTab}
            className={cn(
              "rounded-sm underline decoration-foreground/30 underline-offset-2 transition-colors hover:decoration-foreground",
              focusRing,
            )}
          >
            <Inline nodes={n.children} ctx={ctx} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
      default:
        return <Cite key={key} refs={n.refs} ctx={ctx} />
    }
  })
}

function RichText({
  text,
  partial,
  ctx,
}: {
  text: string
  partial: boolean
  ctx: InlineContext
}) {
  return <Inline nodes={parseInline(text, { partial })} ctx={ctx} />
}

// ---- Blocks ----------------------------------------------------------------

function Figure({
  src,
  alt,
  caption,
}: {
  src: string
  alt: string
  caption?: string
}) {
  return (
    <figure className="flex flex-col gap-2">
      {/* biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="max-h-96 w-full rounded-[10px] object-cover"
      />
      {caption && (
        <figcaption className="text-[13px] leading-4 text-muted-foreground">
          {caption}
        </figcaption>
      )}
    </figure>
  )
}

function CodeBlock({
  code,
  language,
  disabled,
}: {
  code: string
  language?: string
  disabled: boolean
}) {
  const [copied, copy] = useCopied()
  const lang = codeLanguage(undefined, language, undefined)
  const tokens = React.useMemo(
    () => (lang ? tokenizeLines(code.split("\n"), lang) : null),
    [code, lang],
  )
  return (
    <div className={cn("overflow-hidden rounded-[10px]", CODE_BG)}>
      <div className="flex items-center justify-between gap-2 border-b border-foreground/5 dark:border-border py-1.5 pr-1.5 pl-4">
        <span className="font-mono text-[13px] leading-4 text-muted-foreground">
          {language ?? "Code"}
        </span>
        <WhyDisabled when={disabled} reason="Wait for the code to finish">
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled}
            onClick={() => copy(code)}
          >
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? "Copied" : "Copy"}
            <span className="sr-only">
              {language ? ` ${language}` : ""} code
            </span>
          </Button>
        </WhyDisabled>
        <span className="sr-only" aria-live="polite">
          {copied ? "Copied" : ""}
        </span>
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[13px] leading-6">
        <code>
          {tokens
            ? keyed(tokens, "ln").map(({ value: line, key }, index) => (
                <React.Fragment key={key}>
                  {index > 0 && "\n"}
                  {keyed(line, "tk").map(({ value: t, key: tk }) =>
                    t.type === "plain" ? (
                      <React.Fragment key={tk}>{t.text}</React.Fragment>
                    ) : (
                      <span key={tk} className={TOKEN_CLASS[t.type]}>
                        {t.text}
                      </span>
                    ),
                  )}
                </React.Fragment>
              ))
            : code}
        </code>
      </pre>
    </div>
  )
}

function Block({
  block,
  domId,
  partial,
  streaming,
  ctx,
}: {
  block: ArticleBlockInput
  domId?: string
  partial: boolean
  streaming: boolean
  ctx: InlineContext
}) {
  const locale = useGenUILocale()
  switch (block.type) {
    case "heading": {
      // The article title is the h2, so the doc's own levels shift down one.
      const Tag = block.level === 3 ? "h4" : "h3"
      // A summary section gets its icon in a tinted box, as a quick landmark.
      const summary = /^(summary|overview|tl;?dr|at a glance)\b/i.test(
        block.text.trim(),
      )
      return (
        <Tag
          id={domId}
          tabIndex={-1}
          className={cn(
            "scroll-mt-20 font-semibold text-balance outline-none",
            block.level === 3 ? "text-[14px]" : "text-[16px]",
            summary && "flex items-center gap-2.5",
          )}
        >
          {summary && (
            <span
              aria-hidden
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-sky-500 dark:bg-sky-400/15 dark:text-sky-400"
            >
              <FileTextIcon className="size-4" />
            </span>
          )}
          {block.text}
        </Tag>
      )
    }
    case "paragraph":
      return (
        <p className="text-[14px] leading-7">
          <RichText text={block.text} partial={partial} ctx={ctx} />
        </p>
      )
    case "list": {
      const List = block.ordered ? "ol" : "ul"
      const last = block.items.length - 1
      return (
        <List
          className={cn(
            "flex flex-col gap-1.5 pl-5 text-[14px] leading-7 marker:text-muted-foreground",
            block.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {keyed(block.items, "li").map(({ value, key }, i) => (
            <li key={key} className="pl-1">
              <RichText
                text={value}
                partial={partial && i === last}
                ctx={ctx}
              />
            </li>
          ))}
        </List>
      )
    }
    case "quote": {
      const [who, ...rest] = (block.cite ?? "").split(/,\s*/)
      const affiliation = rest.join(", ")
      return (
        <figure className="flex flex-col gap-4 rounded-[10px] border border-border p-4">
          <span
            aria-hidden
            className="inline-flex size-8 items-center justify-center rounded-md bg-sky-500/15 text-sky-500 dark:bg-sky-400/15 dark:text-sky-400"
          >
            <QuoteIcon className="size-4 fill-current" />
          </span>
          <blockquote className="text-[16px] leading-7 text-pretty text-foreground">
            <RichText text={block.text} partial={partial} ctx={ctx} />
          </blockquote>
          {block.cite && (
            <figcaption className="flex items-center justify-between gap-3 text-[13px]">
              <span className="min-w-0">
                <span className="font-medium text-foreground">{who}</span>
                {affiliation && (
                  <span className="text-muted-foreground">, {affiliation}</span>
                )}
              </span>
              <QuoteIcon
                aria-hidden
                className="size-4 shrink-0 rotate-180 fill-current text-sky-500/60 dark:text-sky-400/60"
              />
            </figcaption>
          )}
        </figure>
      )
    }
    case "callout": {
      const warning = block.tone === "warning"
      const Icon = warning ? TriangleAlertIcon : InfoIcon
      return (
        <div
          role="note"
          className="rounded-[10px] border border-border bg-transparent p-1"
        >
          <div
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-3 text-[13px] leading-6",
              warning
                ? "bg-orange-500/10 dark:bg-orange-400/10"
                : "bg-sky-500/10 dark:bg-sky-400/10",
            )}
          >
            <span
              className={cn(
                "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
                warning
                  ? "bg-orange-500/15 text-orange-500 dark:bg-orange-400/15 dark:text-orange-400"
                  : "bg-sky-500/15 text-sky-500 dark:bg-sky-400/15 dark:text-sky-400",
              )}
            >
              <Icon aria-hidden className="size-4" />
            </span>
            <p className="min-w-0 flex-1">
              <span className="sr-only">
                {warning ? "Warning: " : "Note: "}
              </span>
              <RichText text={block.text} partial={partial} ctx={ctx} />
            </p>
          </div>
        </div>
      )
    }
    case "image":
      return <Figure src={block.src} alt={block.alt} caption={block.caption} />
    case "code":
      return (
        <CodeBlock
          code={block.code}
          language={block.language}
          disabled={streaming}
        />
      )
    case "table": {
      const numeric = block.columns.map((name, ci) =>
        isNumberColumn(name, block.rows, ci),
      )
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b">
                {keyed(block.columns, "th").map(({ value, key }, ci) => (
                  <th
                    key={key}
                    scope="col"
                    className={cn(
                      "px-3 py-3 align-bottom font-medium text-muted-foreground first:pl-0 last:pr-0",
                      numeric[ci] ? "text-right" : "text-left",
                    )}
                  >
                    {value}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {keyed(block.rows, "tr").map(({ value: cells, key }) => (
                <tr key={key} className="border-b last:border-b-0">
                  {keyed(block.columns, "td").map(({ key: cellKey }, ci) => (
                    <td
                      key={cellKey}
                      className={cn(
                        "px-3 py-4 align-middle tabular-nums first:pl-0 last:pr-0",
                        numeric[ci] && "text-right whitespace-nowrap",
                      )}
                    >
                      {isChangeColumn(block.columns[ci]) &&
                      isChangeValue(cells[ci]) ? (
                        <ChangeBadge value={cells[ci] as string} />
                      ) : numeric[ci] ? (
                        groupDigits(cells[ci] ?? "", locale)
                      ) : (
                        <RichText
                          text={cells[ci] ?? ""}
                          partial={false}
                          ctx={ctx}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    }
    case "divider":
      return <hr className="border-t" />
    case "keyFacts":
      return (
        <dl className="grid gap-x-10 gap-y-4 border-y border-border py-4 sm:grid-cols-2">
          {keyed(block.items, "kf").map(({ value: f, key }) => (
            <div key={key} className="flex flex-col gap-0.5">
              <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
                {f.icon && ICONS[f.icon] && <FactIcon name={f.icon} />}
                {f.label}
              </dt>
              <dd className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-medium tracking-tight text-foreground tabular-nums">
                <FactValue value={f.value} />
              </dd>
            </div>
          ))}
        </dl>
      )
  }
}

const ICONS: Record<ArticleIcon, LucideIcon> = {
  calendar: CalendarIcon,
  clock: ClockIcon,
  users: UsersIcon,
  user: UserIcon,
  "map-pin": MapPinIcon,
  wallet: WalletIcon,
  "credit-card": CreditCardIcon,
  tag: TagIcon,
  package: PackageIcon,
  "file-text": FileTextIcon,
  mail: MailIcon,
  shield: ShieldIcon,
  database: DatabaseIcon,
  server: ServerIcon,
  globe: GlobeIcon,
  hash: HashIcon,
  "trending-up": TrendingUpIcon,
  building: Building2Icon,
}

const CHANGE_HEADER = /^(change|delta|diff|difference|Δ)\b/i
const isChangeColumn = (name?: string) =>
  !!name && CHANGE_HEADER.test(name.trim())
const isChangeValue = (v?: string) => !!v && /^[+\-−–]?\s*\d/.test(v.trim())

/** A plain number, optionally already grouped with commas: 1234, -3.5, 12,400. */
const PLAIN_NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/

/** A column whose filled cells are all plain numbers (change columns keep their badges). */
function isNumberColumn(name: string, rows: string[][], ci: number) {
  // Identifiers that happen to be digits (years, IDs, codes) are not quantities.
  if (isChangeColumn(name) || /\b(year|id|code|zip|phone)\b|#/i.test(name)) {
    return false
  }
  const cells = rows.map((r) => (r[ci] ?? "").trim()).filter(Boolean)
  return cells.length > 0 && cells.every((c) => PLAIN_NUMBER.test(c))
}

/** Digit grouping for an ungrouped plain number, keeping its decimals. */
function groupDigits(value: string, locale: string) {
  const v = value.trim()
  if (!/^-?\d+(?:\.\d+)?$/.test(v)) return v
  const decimals = v.split(".")[1]?.length ?? 0
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(v))
}

/** A change cell as a blue badge, with an arrow when it has a sign. */
function ChangeBadge({ value }: { value: string }) {
  const text = value.trim()
  const up = /^\+/.test(text)
  const down = /^[\-−–]/.test(text)
  const Arrow = up ? ArrowUpRightIcon : down ? ArrowDownRightIcon : null
  return (
    <Badge variant="info" className="tabular-nums">
      {Arrow && <Arrow aria-hidden />}
      <span className="sr-only">
        {up ? "Increase of " : down ? "Decrease of " : ""}
      </span>
      {text.replace(/^[+\-−–]\s*/, "")}
    </Badge>
  )
}

/** "4.1% (from 2.9%)": the figure, then its qualifier as a badge on the same line. */
function FactValue({ value }: { value: string }) {
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(value)
  if (!m?.[1]) return <>{value}</>
  return (
    <>
      <span>{m[1]}</span>
      <Badge variant="info" className="font-normal">
        {m[2]}
      </Badge>
    </>
  )
}

function FactIcon({ name }: { name: ArticleIcon }) {
  const Icon = ICONS[name]
  return <Icon aria-hidden className="size-3.5 shrink-0" />
}

// ---- Component -------------------------------------------------------------

export function Article({
  title,
  subtitle,
  byline,
  publishedAt,
  hero,
  blocks = [],
  sources = [],
  toc: tocProp,
  status = "ready",
  onResult,
  className,
}: ArticleProps) {
  const locale = useGenUILocale()
  const uid = React.useId()
  const titleId = `${uid}-title`
  const listId = `${uid}-src`
  const streaming = status === "streaming"
  const reduceMotion = useReducedMotion()
  const [highlight, setHighlight] = React.useState<number | null>(null)
  const [active, setActive] = React.useState<string | null>(null)
  const [copied, copy] = useCopied()

  // Blocks, normalized, with heading anchors; the last one may be partial.
  const ids = headingIds(blocks)
  const headingDomId = (slug: string) => `${uid}-h-${slug}`
  const items = blocks.flatMap((b, i) => {
    const block = normalizeBlock(b)
    const slug = ids[i]
    return block
      ? [
          {
            block,
            key: `b${i}`,
            domId: slug ? headingDomId(slug) : undefined,
            partial: streaming && i === blocks.length - 1,
          },
        ]
      : []
  })
  const toc = shouldShowToc(blocks, tocProp) ? extractToc(blocks) : []
  const tocKey = toc.map((t) => t.id).join(" ")

  const ready: ReadySource[] = sources.flatMap((s, i) =>
    typeof s?.title === "string" && typeof s.url === "string"
      ? [{ ...s, title: s.title, url: s.url, n: i + 1 }]
      : [],
  )
  const byN = new Map(ready.map((s) => [s.n, s]))

  const date = formatDate(publishedAt, locale)
  const originalUrl = safeHttpUrl(byline?.url)
  const heroSrc = safeImageSrc(hero?.src)

  // The text scrolls inside the card, so the card keeps a fixed height.
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const scrollBodyTo = (el: HTMLElement, block: "start" | "nearest") => {
    const body = bodyRef.current
    if (!body) return
    const box = body.getBoundingClientRect()
    const rect = el.getBoundingClientRect()
    const behavior = reduceMotion ? "auto" : "smooth"
    if (block === "start") {
      body.scrollTo({ top: body.scrollTop + rect.top - box.top, behavior })
    } else if (rect.top < box.top) {
      body.scrollTo({ top: body.scrollTop + rect.top - box.top, behavior })
    } else if (rect.bottom > box.bottom) {
      body.scrollTo({
        top: body.scrollTop + rect.bottom - box.bottom,
        behavior,
      })
    }
  }

  // Highlight the section being read: the last h2 above a line 30% down the text.
  React.useEffect(() => {
    const body = bodyRef.current
    const els = tocKey
      .split(" ")
      .filter(Boolean)
      .map((id) => document.getElementById(`${uid}-h-${id}`))
      .filter((el): el is HTMLElement => el !== null)
    if (!body || !els.length) return
    const update = () => {
      const box = body.getBoundingClientRect()
      const line = box.top + box.height * 0.3
      let current: string | null = null
      for (const el of els) {
        if (el.getBoundingClientRect().top <= line) current = el.id
      }
      setActive(current)
    }
    update()
    body.addEventListener("scroll", update, { passive: true })
    return () => body.removeEventListener("scroll", update)
  }, [tocKey, uid])

  const goTo = (domId: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    const el = document.getElementById(domId)
    if (!el) return
    scrollBodyTo(el, "start")
    el.focus({ preventScroll: true })
    setActive(domId)
  }

  const jumpTo = (n: number) => {
    setHighlight(n)
    const el = document.getElementById(`${listId}-${n}`)
    if (el) scrollBodyTo(el, "nearest")
    el?.querySelector("a")?.focus({ preventScroll: true })
    setTimeout(() => setHighlight((h) => (h === n ? null : h)), 1600)
  }

  const ctx: InlineContext = { byN, streaming, listId, onJump: jumpTo }

  const markdown = () =>
    toMarkdown(
      {
        title,
        subtitle,
        byline,
        publishedAt,
        hero,
        blocks,
        sources,
      },
      locale,
    )

  const onCopy = () => {
    copy(markdown())
    onResult?.({ action: "copy" })
  }

  const onDownload = () => {
    const blob = new Blob([markdown()], {
      type: "text/markdown;charset=utf-8",
    })
    const href = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = href
    a.download = markdownFilename(title)
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    onResult?.({ action: "download" })
  }

  const meta: { key: string; node: React.ReactNode }[] = []
  if (byline?.author) meta.push({ key: "author", node: byline.author })
  if (byline?.publication || originalUrl) {
    const label = byline?.publication || hostName(originalUrl)
    meta.push({
      key: "publication",
      node: originalUrl ? (
        <a
          href={originalUrl}
          {...newTab}
          onClick={() => onResult?.({ action: "open-original" })}
          className={cn(
            "rounded-sm underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground",
            focusRing,
          )}
        >
          {label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        label
      ),
    })
  }
  if (date) {
    meta.push({
      key: "date",
      node: <time dateTime={publishedAt}>{date}</time>,
    })
  }

  const dateMeta = meta.find((m) => m.key === "date")
  const credits = meta.filter((m) => m.key !== "date")

  const appear = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    transition: genuiMotion.fade,
  } as const

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="article"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Article"}
        className={cn("@container", className)}
      >
        <SurfaceHeader className="gap-1 px-5 pt-4 pb-4">
          {title ? (
            <h2
              id={titleId}
              className={cn(
                "font-figure text-[42px] leading-[1.05] font-normal tracking-tight text-balance",
              )}
            >
              {title}
            </h2>
          ) : (
            <Skeleton className="h-6 w-56" />
          )}
          {(subtitle || meta.length > 0) && (
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              {subtitle && (
                <p
                  className={cn(
                    genuiType.body,
                    "text-pretty text-muted-foreground",
                  )}
                >
                  {subtitle}
                </p>
              )}
              {credits.length > 0 && (
                <p
                  className={cn(
                    genuiType.meta,
                    "flex flex-wrap items-center gap-x-1.5",
                  )}
                >
                  {credits.map((m, i) => (
                    <React.Fragment key={m.key}>
                      {i > 0 && <span aria-hidden>·</span>}
                      <span>{m.node}</span>
                    </React.Fragment>
                  ))}
                </p>
              )}
              {/* The date is always the right-most item of the header line. */}
              {dateMeta && (
                <p className={cn(genuiType.meta, "ml-auto")}>{dateMeta.node}</p>
              )}
            </div>
          )}
        </SurfaceHeader>

        <div className="flex flex-col">
          {toc.length > 0 && (
            <nav
              aria-label="Contents"
              className="border-t border-border px-5 py-3"
            >
              <ol className="flex flex-wrap gap-0.5 rounded-lg border border-border p-0.5">
                {toc.map((t) => {
                  const domId = headingDomId(t.id)
                  const current = active === domId
                  return (
                    <motion.li key={t.id} {...appear} className="flex flex-1">
                      <a
                        href={`#${domId}`}
                        aria-current={current ? "location" : undefined}
                        onClick={goTo(domId)}
                        className={cn(
                          "inline-flex min-h-8 flex-1 items-center justify-center rounded-md px-2 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                          current &&
                            "bg-accent font-medium text-foreground",
                          focusRing,
                        )}
                      >
                        {t.text}
                      </a>
                    </motion.li>
                  )
                })}
              </ol>
            </nav>
          )}

          <div className="border-t border-border px-5 pt-4 pb-5">
            <ScrollFade
              scrollRef={bodyRef}
              label="Article text"
              className={cn(
                "-mx-2 max-w-[calc(68ch+1rem)]",
                toc.length > 0 ? "max-h-[22rem]" : "max-h-[26rem]",
              )}
              viewportClassName="flex flex-col gap-6 overflow-x-hidden overflow-y-auto px-2 pb-3"
            >
              {heroSrc && typeof hero?.alt === "string" && (
                <Figure src={heroSrc} alt={hero.alt} caption={hero.caption} />
              )}

              <div className="flex flex-col gap-4">
                {items.map((item) => (
                  <motion.div
                    key={item.key}
                    {...appear}
                    className={cn(
                      item.block.type === "heading" && "pt-2 first:pt-0",
                    )}
                  >
                    <Block
                      block={item.block}
                      domId={item.domId}
                      partial={item.partial}
                      streaming={streaming}
                      ctx={ctx}
                    />
                  </motion.div>
                ))}
                {streaming && (
                  <div aria-hidden className="flex flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-11/12" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                )}
              </div>

              {ready.length > 0 && (
                <section
                  aria-labelledby={`${listId}-label`}
                  className="flex flex-col gap-3"
                >
                  <h3
                    id={`${listId}-label`}
                    className="flex items-center gap-2 text-[15px] font-medium"
                  >
                    Sources
                    <Badge variant="info" className="tabular-nums">
                      {ready.length}
                    </Badge>
                  </h3>
                  <ol
                    id={listId}
                    className="flex flex-col divide-y divide-border overflow-hidden rounded-[10px] border border-border"
                  >
                    {ready.map((s) => {
                      const url = safeHttpUrl(s.url)
                      return (
                        <motion.li
                          key={s.id ?? s.n}
                          id={`${listId}-${s.n}`}
                          {...appear}
                          className={cn(
                            "flex items-center gap-3 px-3 py-3 transition-colors duration-500",
                            highlight === s.n && "bg-muted dark:bg-white/5",
                          )}
                        >
                          <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] leading-none font-medium tabular-nums text-muted-foreground dark:bg-white/10">
                            {s.n}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:justify-between @md:gap-4">
                            {url ? (
                              <a
                                href={url}
                                {...newTab}
                                className={cn(
                                  "min-w-0 rounded-sm text-[14px] font-medium hover:underline",
                                  focusRing,
                                )}
                              >
                                {s.title}
                                <span className="sr-only">
                                  {" "}
                                  (opens in a new tab)
                                </span>
                              </a>
                            ) : (
                              <span className="min-w-0 text-[14px] font-medium">
                                {s.title}
                              </span>
                            )}
                            <span
                              className={cn(
                                genuiType.meta,
                                "shrink-0 @md:text-right",
                              )}
                            >
                              {sourceName(s)}
                            </span>
                          </div>
                        </motion.li>
                      )
                    })}
                  </ol>
                </section>
              )}
            </ScrollFade>
          </div>
        </div>

        <SurfaceFooter className="px-5">
          {streaming && (
            <ShimmeringText
              text="Writing…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px]"
            />
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <WhyDisabled
              when={streaming || items.length === 0}
              reason="Available once the article is done"
            >
              <Button
                size="sm"
                disabled={streaming || items.length === 0}
                onClick={onCopy}
              >
                {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </WhyDisabled>
            <WhyDisabled
              when={streaming || items.length === 0}
              reason="Available once the article is done"
            >
              <IconTip label="Download as Markdown">
                <Button
                  size="icon-sm"
                  variant="secondary"
                  aria-label="Download as Markdown"
                  disabled={streaming || items.length === 0}
                  onClick={onDownload}
                >
                  <DownloadIcon aria-hidden />
                </Button>
              </IconTip>
            </WhyDisabled>
          </div>
          <span className="sr-only" aria-live="polite">
            {copied ? "Copied" : ""}
          </span>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
