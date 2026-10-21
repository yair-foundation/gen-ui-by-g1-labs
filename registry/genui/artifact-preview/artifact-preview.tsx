"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BracesIcon,
  CheckIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  CopyIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileCodeIcon,
  FileIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  GripVerticalIcon,
  ImageOffIcon,
  Maximize2Icon,
  TriangleAlertIcon,
  WrapTextIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
} from "@/components/genui/surface"

import {
  type ArtifactAction,
  type ArtifactKind,
  allContainerPaths,
  byteLength,
  canFramePdf,
  canOpen,
  type CodeLanguage,
  codeLanguage,
  containerSummary,
  type CsvSort,
  contentMime,
  decodeDataText,
  defaultExpanded,
  csvRowsLabel,
  formatCell,
  type InlineNode,
  isContainer,
  isTextKind,
  type JsonNode,
  type MarkdownBlock,
  metaParts,
  moveColumn,
  nextSort,
  normalizeKind,
  numericColumns,
  parseCsv,
  parseInline,
  parseJson,
  parseMarkdown,
  prettyJson,
  primitiveText,
  resolveActions,
  type SafeSource,
  safeFileName,
  safeSource,
  sortRows,
  splitLines,
  tokenizeLines,
} from "./artifact-preview-utils"
import type {
  ArtifactPreviewInput,
  ArtifactPreviewResult,
} from "./artifact-preview.schema"
import { CODE_BG, TOKEN_CLASS } from "@/components/genui/code-highlight"
import { IconTip } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"
import { Segmented } from "@/components/genui/segmented"

export type ArtifactPreviewStatus = "streaming" | "ready"

export type ArtifactPreviewProps = Partial<
  Omit<ArtifactPreviewInput, "actions">
> & {
  /** Actions may be partial while the tool call streams. */
  actions?: (ArtifactAction | undefined)[]
  /** Lifecycle, controlled by the host. */
  status?: ArtifactPreviewStatus
  /** Called when the user downloads or opens the file. For analytics: the preview never locks. */
  onResult?: (result: ArtifactPreviewResult) => void
  /** A result from history. Nothing to restore: the preview never locks. */
  result?: ArtifactPreviewResult
  /**
   * A link the host adds to the footer as the main action, e.g. to a details page. It
   * replaces Download when set.
   */
  link?: { label: string; href: string }
  className?: string
}

const CSV_PREVIEW_ROWS = 200
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const newTab = {
  target: "_blank",
  rel: "noopener noreferrer nofollow",
} as const
const mono = "font-mono text-[13px] leading-6"


const KIND_ICONS: Record<ArtifactKind, typeof FileIcon> = {
  pdf: FileTextIcon,
  image: FileImageIcon,
  code: FileCodeIcon,
  text: FileTextIcon,
  csv: FileSpreadsheetIcon,
  json: BracesIcon,
  markdown: FileTextIcon,
  other: FileIcon,
}

/** Stable keys without using the map index (these lists never reorder). */
function keyed<T>(items: readonly T[], prefix: string) {
  const out: { key: string; value: T; index: number }[] = []
  for (let i = 0; i < items.length; i++) {
    out.push({ key: `${prefix}${i}`, value: items[i], index: i })
  }
  return out
}

/** The browser's built-in PDF viewer; null until known (server render). */
const noopSubscribe = () => () => {}
function usePdfViewerEnabled(): boolean | null {
  return React.useSyncExternalStore(
    noopSubscribe,
    () =>
      typeof navigator !== "undefined" &&
      (navigator as Navigator & { pdfViewerEnabled?: boolean })
        .pdfViewerEnabled === true,
    () => null,
  )
}

// ---- Small controls --------------------------------------------------------

function Placeholder({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof FileIcon
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 bg-transparent px-6 py-10 text-center">
      <Icon aria-hidden className="size-5 text-muted-foreground" />
      <p className={cn(genuiType.body, "font-medium")}>{title}</p>
      {children}
    </div>
  )
}

// ---- Previews --------------------------------------------------------------

function CodeView({
  text,
  wrap,
  errorLine,
  lang,
}: {
  text: string
  wrap: boolean
  /** 1-based line to mark, e.g. where JSON failed to parse. */
  errorLine?: number
  /** Colours SQL or JSON; other code stays plain. */
  lang?: CodeLanguage | null
}) {
  const lines = splitLines(text)
  const tokens = React.useMemo(() => (lang ? tokenizeLines(lines, lang) : null), [lines, lang])
  return (
    <pre className={cn(mono, "py-2")}>
      <code
        className={cn("grid grid-cols-[auto_1fr]", !wrap && "w-max min-w-full")}
      >
        {keyed(lines, "l").map(({ key, value, index }) => {
          const error = errorLine === index + 1
          return (
            <React.Fragment key={key}>
              <span
                aria-hidden
                className={cn(
                  "sticky left-0 bg-[var(--scroller-bg,var(--card))] pr-3 pl-4 text-right text-muted-foreground/70 tabular-nums select-none",
                  error && "font-semibold text-destructive",
                )}
              >
                {index + 1}
              </span>
              <span
                className={cn(
                  "pr-4",
                  wrap
                    ? "whitespace-pre-wrap [overflow-wrap:anywhere]"
                    : "whitespace-pre",
                  error && "bg-destructive/10",
                )}
              >
                {tokens?.[index]?.length
                  ? keyed(tokens[index], "t").map(({ key: tk, value: t }) =>
                      t.type === "plain" ? (
                        <React.Fragment key={tk}>{t.text}</React.Fragment>
                      ) : (
                        <span key={tk} className={TOKEN_CLASS[t.type]}>
                          {t.text}
                        </span>
                      ),
                    )
                  : value || " "}
              </span>
            </React.Fragment>
          )
        })}
      </code>
    </pre>
  )
}

function CsvTable({
  name,
  rows,
  total,
  order,
  sort,
  onSort,
  onMove,
}: {
  name: string
  rows: string[][]
  total: number
  /** Column indexes in display order. */
  order: number[]
  sort: CsvSort
  onSort: (column: number) => void
  /** Moves the column at display position `from` to position `to`. */
  onMove: (from: number, to: number) => void
}) {
  const locale = useGenUILocale()
  const [header = [], ...rest] = rows
  const numeric = numericColumns(rest)
  const body = sortRows(rest, sort, sort ? numeric[sort.column] : false, locale)
  const hintId = React.useId()
  // Dragging a header: where it came from, and where it would land.
  const [drag, setDrag] = React.useState<{ from: number; over: number } | null>(null)
  const [announce, setAnnounce] = React.useState("")
  const nameOf = (col: number) => header[col] || `Column ${col + 1}`
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return
    onMove(from, to)
    setAnnounce(`${nameOf(order[from])} moved to column ${to + 1} of ${order.length}.`)
  }
  return (
    <>
      <span id={hintId} className="sr-only">
        Sorts by this column. Alt with the left or right arrow moves the column.
      </span>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <caption className="sr-only">
          {name}: showing {body.length} of {total} rows
        </caption>
        <thead>
          <tr>
            {order.map((col, pos) => {
              const sorted = sort?.column === col ? sort.dir : null
              const dropping = drag && drag.over === pos && drag.from !== pos
              return (
                <th
                  key={col}
                  scope="col"
                  draggable
                  aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move"
                    e.dataTransfer.setData("text/plain", nameOf(col))
                    setDrag({ from: pos, over: pos })
                  }}
                  onDragOver={(e) => {
                    if (!drag) return
                    e.preventDefault()
                    if (drag.over !== pos) setDrag({ ...drag, over: pos })
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (drag) move(drag.from, pos)
                    setDrag(null)
                  }}
                  onDragEnd={() => setDrag(null)}
                  className={cn(
                    "group/th sticky top-0 z-10 cursor-grab border-b bg-card px-3 py-2 text-left font-medium whitespace-nowrap text-muted-foreground active:cursor-grabbing",
                    numeric[col] && "text-right",
                    drag?.from === pos && "opacity-50",
                    // A 2px line on the side the column will land.
                    dropping &&
                      (drag.from < pos
                        ? "shadow-[inset_-2px_0_0_var(--foreground)]"
                        : "shadow-[inset_2px_0_0_var(--foreground)]"),
                  )}
                >
                  {/* Out of the flow, in the cell's padding: the label lines up with its column. */}
                  <GripVerticalIcon
                    aria-hidden
                    className="absolute top-1/2 left-0 size-3.5 -translate-y-1/2 opacity-0 transition-opacity group-hover/th:opacity-60"
                  />
                  <button
                    type="button"
                    aria-describedby={hintId}
                    onClick={() => onSort(col)}
                    onKeyDown={(e) => {
                      if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return
                      e.preventDefault()
                      move(pos, pos + (e.key === "ArrowLeft" ? -1 : 1))
                    }}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-sm align-middle hover:text-foreground",
                      // Number columns align right, so their arrow goes first.
                      numeric[col] && "flex-row-reverse",
                      sorted && "text-foreground",
                      focusRing,
                    )}
                  >
                    {nameOf(col)}
                    {sorted ? (
                      sorted === "asc" ? (
                        <ArrowUpIcon aria-hidden className="size-3.5" />
                      ) : (
                        <ArrowDownIcon aria-hidden className="size-3.5" />
                      )
                    ) : (
                      <ArrowUpIcon
                        aria-hidden
                        className="size-3.5 opacity-0 transition-opacity group-hover/th:opacity-40"
                      />
                    )}
                  </button>
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {keyed(body, "r").map(({ key, value: cells }) => (
            <tr key={key}>
              {order.map((col) => (
                <td
                  key={col}
                  className={cn(
                    "max-w-80 border-b px-3 py-1.5 align-top whitespace-pre-wrap [overflow-wrap:anywhere]",
                    numeric[col] && "text-right tabular-nums",
                  )}
                >
                  {numeric[col] ? formatCell(cells[col] ?? "", locale) : cells[col]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function JsonValue({ node }: { node: JsonNode }) {
  return (
    <span
      className={cn(
        "[overflow-wrap:anywhere]",
        node.type === "string"
          ? TOKEN_CLASS.string
          : node.type === "number"
            ? TOKEN_CLASS.number
            : TOKEN_CLASS.literal,
      )}
    >
      {primitiveText(node)}
    </span>
  )
}

function JsonKey({ node }: { node: JsonNode }) {
  if (node.key === null) return null
  return (
    <span>
      <span className={typeof node.key === "number" ? "text-muted-foreground" : TOKEN_CLASS.key}>
        {typeof node.key === "number" ? node.key : JSON.stringify(node.key)}
      </span>
      <span className="text-muted-foreground">{": "}</span>
    </span>
  )
}

function JsonTreeNode({
  node,
  open,
  onToggle,
}: {
  node: JsonNode
  open: Set<string>
  onToggle: (path: string) => void
}) {
  const locale = useGenUILocale()
  if (!isContainer(node)) {
    return (
      <li className="pl-5">
        <JsonKey node={node} />
        <JsonValue node={node} />
      </li>
    )
  }
  const [start, end] = node.type === "array" ? ["[", "]"] : ["{", "}"]
  const children = node.children ?? []
  if (children.length === 0) {
    return (
      <li className="pl-5">
        <JsonKey node={node} />
        <span className="text-muted-foreground">
          {start}
          {end}
        </span>
      </li>
    )
  }
  const expanded = open.has(node.path)
  const name =
    node.key === null
      ? "Root"
      : typeof node.key === "number"
        ? `Item ${node.key}`
        : node.key
  return (
    <li>
      <button
        type="button"
        aria-expanded={expanded}
        aria-label={`${name}, ${node.type}, ${containerSummary(node, locale)}`}
        onClick={() => onToggle(node.path)}
        className={cn(
          "inline-flex min-h-6 max-w-full items-center rounded-md text-left hover:bg-muted",
          focusRing,
        )}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "mx-0.5 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0">
          <JsonKey node={node} />
          {expanded ? (
            start
          ) : (
            <>
              {start}…{end}
              <span className="ml-2 font-sans text-[13px] text-muted-foreground">
                {containerSummary(node, locale)}
              </span>
            </>
          )}
        </span>
      </button>
      {expanded && (
        <>
          <ul className="ml-[0.6875rem] border-l pl-2">
            {children.map((child) => (
              <JsonTreeNode
                key={child.path}
                node={child}
                open={open}
                onToggle={onToggle}
              />
            ))}
          </ul>
          <span aria-hidden className="block pl-5">
            {end}
          </span>
        </>
      )}
    </li>
  )
}

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return keyed(nodes, "n").map(({ key, value: n }) => {
    switch (n.type) {
      case "text":
        return <React.Fragment key={key}>{n.value}</React.Fragment>
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            <Inline nodes={n.children} />
          </strong>
        )
      case "em":
        return (
          <em key={key}>
            <Inline nodes={n.children} />
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
      default:
        return (
          <a
            key={key}
            href={n.href}
            {...newTab}
            className={cn(
              "rounded-sm underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground",
              focusRing,
            )}
          >
            <Inline nodes={n.children} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
    }
  })
}

/** The card title is an h3, so the document's headings start at h4. */
const HEADING_TAGS = ["h4", "h5", "h6", "h6", "h6", "h6"] as const

function MarkdownView({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <div className="flex max-w-[68ch] flex-col gap-3 px-3 py-3 text-[13px] leading-6">
      {keyed(blocks, "b").map(({ key, value: b }) => {
        switch (b.type) {
          case "heading": {
            const Tag = HEADING_TAGS[b.level - 1]
            return (
              <Tag
                key={key}
                className={cn(
                  "pt-1 font-semibold text-balance first:pt-0",
                  b.level === 1 ? "text-[14px]" : "text-[13px]",
                )}
              >
                <Inline nodes={parseInline(b.text)} />
              </Tag>
            )
          }
          case "paragraph":
            return (
              <p key={key}>
                <Inline nodes={parseInline(b.text)} />
              </p>
            )
          case "list": {
            const List = b.ordered ? "ol" : "ul"
            return (
              <List
                key={key}
                start={b.ordered && b.start !== 1 ? b.start : undefined}
                className={cn(
                  "flex flex-col gap-1 pl-5 marker:text-muted-foreground",
                  b.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {keyed(b.items, "i").map(({ key: itemKey, value }) => (
                  <li key={itemKey} className="pl-1">
                    <Inline nodes={parseInline(value)} />
                  </li>
                ))}
              </List>
            )
          }
          case "code":
            return (
              <pre
                key={key}
                className={cn(
                  mono,
                  "overflow-x-auto rounded-lg border border-border bg-transparent px-4 py-3",
                )}
              >
                <code>{b.code}</code>
              </pre>
            )
          case "quote":
            return (
              <blockquote
                key={key}
                className="border-l-2 pl-3 text-muted-foreground"
              >
                <Inline nodes={parseInline(b.text)} />
              </blockquote>
            )
          default:
            return <hr key={key} className="border-t" />
        }
      })}
    </div>
  )
}

function ImageView({
  src,
  alt,
  zoom,
  expanded,
}: {
  src: string
  alt: string
  zoom: "fit" | "actual"
  expanded: boolean
}) {
  const [failed, setFailed] = React.useState<string | null>(null)
  if (failed === src) {
    return (
      <Placeholder icon={ImageOffIcon} title="Image unavailable">
        <p className={cn(genuiType.meta, "max-w-sm")}>{alt}</p>
      </Placeholder>
    )
  }
  return (
    <div
      className={cn(
        "flex bg-transparent p-3",
        expanded ? "min-h-full" : "min-h-40",
      )}
    >
      {/* biome-ignore lint/performance/noImgElement: agent-provided URLs and data: images; next/image would need every host configured */}
      <img
        src={src}
        alt={alt}
        decoding="async"
        referrerPolicy="no-referrer"
        draggable={false}
        onError={() => setFailed(src)}
        className={cn(
          "m-auto shrink-0 rounded-lg",
          zoom === "fit"
            ? cn(
                "max-w-full object-contain",
                expanded ? "max-h-[calc(96dvh-9rem)]" : "max-h-[26rem]",
              )
            : "max-w-none",
        )}
      />
    </div>
  )
}

// ---- Component -------------------------------------------------------------

type View = "preview" | "raw"

export function ArtifactPreview({
  name,
  kind: kindProp,
  src,
  content,
  language,
  sizeBytes,
  pages,
  version,
  summary,
  actions,
  status = "ready",
  onResult,
  link,
  className,
}: ArtifactPreviewProps) {
  const locale = useGenUILocale()
  const streaming = status === "streaming"
  const kind = normalizeKind(kindProp)
  const Icon = KIND_ICONS[kind]
  const label = name ?? "File"
  const source: SafeSource | null = React.useMemo(
    () => (streaming ? null : safeSource(src, kind)),
    [src, kind, streaming],
  )

  // Inline text, or the text inside a matching data: URL. Nothing is parsed
  // until the tool call finishes: partial CSV or JSON would only mislead.
  const text = React.useMemo(() => {
    if (streaming || !isTextKind(kind)) return null
    if (typeof content === "string") return content
    return source?.scheme === "data" ? decodeDataText(source.url) : null
  }, [streaming, kind, content, source])

  const csv = React.useMemo(
    () => (kind === "csv" && text !== null ? parseCsv(text) : null),
    [kind, text],
  )
  const json = React.useMemo(
    () => (kind === "json" && text !== null ? parseJson(text) : null),
    [kind, text],
  )
  const markdown = React.useMemo(
    () => (kind === "markdown" && text !== null ? parseMarkdown(text) : null),
    [kind, text],
  )
  const raw = React.useMemo(() => {
    if (text === null) return ""
    return kind === "json" && json?.ok ? (prettyJson(text) ?? text) : text
  }, [kind, text, json])

  // ---- View state (shared by the inline preview and the expanded dialog)
  const [view, setView] = React.useState<View>("preview")
  const [wrapOverride, setWrap] = React.useState<boolean | null>(null)
  const wrap = wrapOverride ?? (kind === "text" || kind === "markdown")
  const [zoom, setZoom] = React.useState<"fit" | "actual">("fit")
  const [openPaths, setOpenPaths] = React.useState<Set<string> | null>(null)
  const jsonRoot = json?.ok ? json.root : null
  const open = React.useMemo(
    () =>
      openPaths ?? (jsonRoot ? defaultExpanded(jsonRoot) : new Set<string>()),
    [openPaths, jsonRoot],
  )
  const allPaths = React.useMemo(
    () => (jsonRoot ? allContainerPaths(jsonRoot) : new Set<string>()),
    [jsonRoot],
  )
  const allOpen = allPaths.size > 0 && open.size === allPaths.size
  const lang = codeLanguage(kind, language, name)

  // CSV: column order (drag) and sort (click a label), shared with the dialog.
  const csvWidth = csv?.rows[0]?.length ?? 0
  const [csvOrderState, setCsvOrder] = React.useState<number[] | null>(null)
  const csvOrder =
    csvOrderState?.length === csvWidth ? csvOrderState : Array.from({ length: csvWidth }, (_, i) => i)
  const [csvSort, setCsvSort] = React.useState<CsvSort>(null)

  // Copy, for files whose text is here.
  const [copied, setCopied] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(copyTimer.current), [])
  const copyText = async () => {
    if (text === null) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
      onResult?.({ action: "copy" })
    } catch {
      // Clipboard blocked (permissions, insecure context): nothing to copy into.
    }
  }
  const togglePath = (path: string) => {
    const next = new Set(open)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    setOpenPaths(next)
  }

  // ---- Actions
  const pdfViewer = usePdfViewerEnabled()
  const blobDownload = text !== null
  const urlDownload = source !== null && !blobDownload
  const openable = canOpen(source)
  // While streaming, judge from the props so the buttons show (disabled)
  // instead of popping in when the call finishes.
  const pending = streaming ? safeSource(src, kind) : null
  const pendingText =
    streaming &&
    isTextKind(kind) &&
    (typeof content === "string" || pending?.scheme === "data")
  const shown = resolveActions(
    actions?.filter((a): a is ArtifactAction => typeof a === "string"),
    kind,
    streaming
      ? {
          download: pendingText || pending !== null,
          open: canOpen(pending),
        }
      : {
          download: blobDownload || urlDownload,
          open: openable,
        },
  )
  const fileName = safeFileName(name)
  const onBlobDownload = () => {
    if (text === null) return
    const blob = new Blob([text], { type: contentMime(kind) })
    const href = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = href
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(href), 1000)
    onResult?.({ action: "download" })
  }
  const downloadContent = (
    <>
      <DownloadIcon aria-hidden />
      Download
      <span className="sr-only"> {label}</span>
    </>
  )
  const downloadButton =
    urlDownload && source ? (
      <Button
        size="sm"
        disabled={streaming}
        nativeButton={false}
        render={
          <a
            href={source.url}
            download={fileName}
            // Cross-origin servers may ignore `download`; open in a new tab then.
            {...(source.scheme === "http" ? newTab : {})}
            onClick={() => onResult?.({ action: "download" })}
          />
        }
      >
        {downloadContent}
      </Button>
    ) : (
      <Button size="sm" disabled={streaming} onClick={onBlobDownload}>
        {downloadContent}
      </Button>
    )
  const openContent = (
    <>
      <ExternalLinkIcon aria-hidden />
      <span className="sr-only">Open {label} (opens in a new tab)</span>
    </>
  )
  const openButton = source ? (
    <IconTip label="Open">
      <Button
        size="icon-sm"
        variant="secondary"
        nativeButton={false}
        render={
          <a
            href={source.url}
            {...newTab}
            onClick={() => onResult?.({ action: "open" })}
          />
        }
      >
        {openContent}
      </Button>
    </IconTip>
  ) : (
    <Button size="icon-sm" variant="secondary" title="Open" disabled>
      {openContent}
    </Button>
  )

  // ---- Expanded view (native <dialog>: focus containment and Escape built in)
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const expandRef = React.useRef<HTMLButtonElement>(null)
  const [expanded, setExpanded] = React.useState(false)
  const openDialog = () => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open || typeof dialog.showModal !== "function") return
    dialog.showModal()
    setExpanded(true)
  }
  const closeDialog = () => dialogRef.current?.close()

  // ---- What the preview area shows
  const imageSrc = kind === "image" ? source?.url : undefined
  const framePdf = kind === "pdf" && canFramePdf(source) && pdfViewer === true
  const hasPreview =
    !streaming && (text !== null || imageSrc !== undefined || framePdf)
  const viewOptions: Record<string, [string, string]> = {
    csv: ["Table", "Raw"],
    json: ["Tree", "Raw"],
    markdown: ["Preview", "Raw"],
  }
  const viewLabels = text !== null ? viewOptions[kind] : undefined
  const showingRaw = viewLabels !== undefined && view === "raw"
  const showsCode =
    text !== null &&
    (kind === "code" ||
      kind === "text" ||
      showingRaw ||
      (kind === "json" && !json?.ok))
  const csvBody = csv ? Math.max(csv.rows.length - 1, 0) : 0
  const csvShown = Math.min(csvBody, CSV_PREVIEW_ROWS)

  const lineCount =
    text !== null && (kind === "code" || kind === "text")
      ? splitLines(text).length
      : undefined
  const meta = kindProp
    ? metaParts(
        {
          kind,
          name,
          language,
          pages,
          lines: lineCount,
          rows: csv ? csvBody : undefined,
          sizeBytes:
            sizeBytes ?? (text !== null ? byteLength(text) : undefined),
          version,
        },
        locale,
      )
    : []

  const segmented =
    hasPreview && viewLabels ? (
      <Segmented
        label={`${label} view`}
        value={view}
        onChange={setView}
        options={[
          { value: "preview", label: viewLabels[0] },
          { value: "raw", label: viewLabels[1] },
        ]}
      />
    ) : hasPreview && kind === "image" ? (
      <Segmented
        label={`${label} zoom`}
        value={zoom}
        onChange={setZoom}
        options={[
          { value: "fit", label: "Fit" },
          { value: "actual", label: "100%" },
        ]}
      />
    ) : null

  /** Wrap, expand/collapse all and the full view, as icon buttons. */
  const icons = (inDialog: boolean) => {
    const jsonTree = kind === "json" && jsonRoot !== null && !showingRaw && allPaths.size > 1
    if (!hasPreview || (!showsCode && !jsonTree && inDialog)) return null
    return (
      <div className="flex shrink-0 items-center gap-1">
        {showsCode && (
          <IconTip label="Wrap lines">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Wrap lines"
              aria-pressed={wrap}
              onClick={() => setWrap(!wrap)}
              className="aria-pressed:bg-muted"
            >
              <WrapTextIcon aria-hidden />
            </Button>
          </IconTip>
        )}
        {jsonTree && (
          <IconTip label={allOpen ? "Collapse all" : "Expand all"}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={allOpen ? "Collapse all" : "Expand all"}
              onClick={() => setOpenPaths(allOpen ? new Set(["$"]) : new Set(allPaths))}
            >
              {allOpen ? <ChevronsDownUpIcon aria-hidden /> : <ChevronsUpDownIcon aria-hidden />}
            </Button>
          </IconTip>
        )}
        {!inDialog && (
          <IconTip label="Expand">
            <Button
              ref={expandRef}
              size="icon-sm"
              variant="ghost"
              aria-label={`Expand ${label}`}
              aria-haspopup="dialog"
              onClick={openDialog}
            >
              <Maximize2Icon aria-hidden />
            </Button>
          </IconTip>
        )}
      </div>
    )
  }

  /**
   * A toolbar row only when there's a view switch to hold (it spans the
   * width, icons after it). Without one, the icons sit on the meta line, or
   * on the dialog's own row.
   */
  const toolbar = (inDialog: boolean) => {
    const rowsNote =
      kind === "csv" && csv && !showingRaw && csvShown < csvBody ? (
        <span className={cn(genuiType.meta, "shrink-0 tabular-nums")}>
          {csvRowsLabel(csvShown, csvBody, locale)}
        </span>
      ) : null
    if (segmented) {
      return (
        <div className="flex items-center gap-2 border-b px-3 py-3">
          {segmented}
          {rowsNote}
          {icons(inDialog)}
        </div>
      )
    }
    const iconRow = inDialog ? icons(true) : null
    return iconRow ? <div className="flex justify-end border-b px-3 py-2">{iconRow}</div> : null
  }

  const body = (inDialog: boolean): React.ReactNode => {
    if (streaming) {
      return (
        <div aria-hidden className="flex flex-col gap-2 px-3 py-3">
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      )
    }
    if (kind === "pdf") {
      if (framePdf && source) {
        return (
          <iframe
            src={source.url}
            title={`${label} (PDF preview)`}
            referrerPolicy="no-referrer"
            className={cn(
              "block w-full border-0 bg-muted",
              inDialog ? "min-h-0 flex-1" : "h-[24rem]",
            )}
          />
        )
      }
      if (pdfViewer === null && canFramePdf(source)) {
        return <Skeleton className="h-[24rem] rounded-none" />
      }
      return (
        <Placeholder
          icon={FileTextIcon}
          title={source ? "No inline preview" : "No file link"}
        />
      )
    }
    if (kind === "image") {
      return imageSrc ? (
        <ImageView
          src={imageSrc}
          alt={summary ?? label}
          zoom={zoom}
          expanded={inDialog}
        />
      ) : (
        <Placeholder icon={ImageOffIcon} title="Image unavailable" />
      )
    }
    if (kind === "other") {
      return <Placeholder icon={FileIcon} title="No preview" />
    }
    if (text === null) {
      return (
        <Placeholder
          icon={Icon}
          title={openable ? "No preview" : "Content not included"}
        />
      )
    }
    if (kind === "json" && json && !json.ok) {
      return (
        <>
          <div className="border-b p-2">
            <div className="rounded-[10px] border border-border bg-transparent p-1">
              <p
                role="alert"
                className="flex items-center gap-3 rounded-md bg-red-500/10 px-3 py-3 text-[13px] dark:bg-red-400/10"
              >
                <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/15 dark:bg-red-400/15">
                  <TriangleAlertIcon
                    aria-hidden
                    className="size-4 shrink-0 text-red-500 dark:text-red-400"
                  />
                </span>
                <span className="min-w-0 flex-1">
                  Invalid JSON on line {json.error.line}, column{" "}
                  {json.error.column}: {json.error.message}.
                </span>
              </p>
            </div>
          </div>
          <CodeView text={text} wrap={wrap} errorLine={json.error.line} lang="json" />
        </>
      )
    }
    if (showsCode) {
      return (
        <CodeView
          text={raw}
          wrap={wrap}
          lang={kind === "csv" || kind === "markdown" ? null : lang}
        />
      )
    }
    if (csv) {
      return (
        <>
          {csv.error && (
            <div className="border-b p-2">
              <div className="rounded-[10px] border border-border bg-transparent p-1">
                <p className="flex items-center gap-3 rounded-md bg-orange-500/10 px-3 py-3 text-[13px] dark:bg-orange-400/10">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500/15 dark:bg-orange-400/15">
                    <TriangleAlertIcon
                      aria-hidden
                      className="size-4 shrink-0 text-orange-500 dark:text-orange-400"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    {csv.error} The last rows may be merged.
                  </span>
                </p>
              </div>
            </div>
          )}
          {csv.rows.length > 0 ? (
            <CsvTable
              name={label}
              rows={csv.rows.slice(0, CSV_PREVIEW_ROWS + 1)}
              total={csvBody}
              order={csvOrder}
              sort={csvSort}
              onSort={(column) => setCsvSort((current) => nextSort(current, column))}
              onMove={(from, to) => setCsvOrder(moveColumn(csvOrder, from, to))}
            />
          ) : (
            <p
              className={cn(genuiType.body, "px-3 py-3 text-muted-foreground")}
            >
              Empty file
            </p>
          )}
        </>
      )
    }
    if (jsonRoot) {
      return (
        <ul className={cn(mono, "px-3 py-2")}>
          <JsonTreeNode node={jsonRoot} open={open} onToggle={togglePath} />
        </ul>
      )
    }
    if (markdown) return <MarkdownView blocks={markdown} />
    return null
  }

  /** Scrollable previews; the PDF frame and placeholders scroll themselves. */
  const scrolls = hasPreview && !framePdf
  const codeSurface = showsCode || (jsonRoot !== null && !showingRaw && kind === "json")
  const region = (inDialog: boolean) =>
    scrolls ? (
      <ScrollFade
        label={`${label} preview`}
        className={cn(inDialog ? "min-h-0 flex-1" : "max-h-[24rem]", codeSurface && CODE_BG)}
      >
        {body(inDialog)}
      </ScrollFade>
    ) : (
      body(inDialog)
    )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="artifact-preview"
        data-status={status}
        aria-busy={streaming}
        aria-label={label}
        className={className}
      >
        <SurfaceHeader className="border-b border-border pb-3">
          <SurfaceTitle className="[overflow-wrap:anywhere]">
            {name}
          </SurfaceTitle>
          <div className="flex items-center gap-2">
            {meta.length > 0 ? (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                className={cn(
                  genuiType.meta,
                  "flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5",
                )}
              >
                {meta.map((m, i) => (
                  <React.Fragment key={m}>
                    {i > 0 && <span aria-hidden>·</span>}
                    <span className="tabular-nums">{m}</span>
                  </React.Fragment>
                ))}
              </motion.p>
            ) : (
              streaming && <Skeleton className="h-3 w-40" />
            )}
            {/* No view switch: the icons share the meta line instead of a row of their own. */}
            {!segmented && <div className="ml-auto">{icons(false)}</div>}
          </div>
          {/* The reply already says what the file is; keep it for screen readers. */}
          {summary && <p className="sr-only">{summary}</p>}
        </SurfaceHeader>

        {toolbar(false)}
        {region(false)}

        {(streaming || shown.length > 0 || link) && (
          <SurfaceFooter>
            {streaming ? (
              <ShimmeringText
                text="Loading preview…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
                className="text-[13px]"
              />
            ) : null}
            <div className="ml-auto flex flex-wrap gap-2">
              {shown.includes("open") && openButton}
              {(text !== null || pendingText) && (
                <Button size="sm" variant="outline" disabled={streaming} onClick={copyText}>
                  {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
                  {copied ? "Copied" : "Copy"}
                  <span className="sr-only"> {label}</span>
                </Button>
              )}
              {link ? (
                <Button
                  size="sm"
                  nativeButton={false}
                  disabled={streaming}
                  render={<a href={link.href} />}
                >
                  {link.label}
                </Button>
              ) : (
                shown.includes("download") && downloadButton
              )}
            </div>
          </SurfaceFooter>
        )}

        {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; Escape and the Close button cover keyboards */}
        <dialog
          ref={dialogRef}
          aria-label={`${label}, expanded`}
          onClose={() => {
            setExpanded(false)
            expandRef.current?.focus()
          }}
          onClick={(e) => {
            // Clicks on the dialog element itself land on the backdrop.
            if (e.target === e.currentTarget) closeDialog()
          }}
          className="m-auto h-[96dvh] max-h-none w-[min(96vw,72rem)] max-w-none overflow-hidden rounded-3xl border border-border bg-card p-0 text-card-foreground backdrop:bg-black/70"
        >
          {expanded && (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
                <h2 className={cn(genuiType.title, "min-w-0 truncate")}>
                  {label}
                </h2>
                <IconTip label="Close">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Close"
                    onClick={closeDialog}
                  >
                    <XIcon />
                  </Button>
                </IconTip>
              </div>
              {toolbar(true)}
              {region(true)}
            </div>
          )}
        </dialog>
      </Surface>
    </MotionConfig>
  )
}
