"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  FileArchiveIcon,
  FileIcon,
  FileImageIcon,
  FileTextIcon,
  FileVideoIcon,
  FolderIcon,
  FolderOpenIcon,
  PaperclipIcon,
  LayoutGridIcon,
  ListIcon,
  type LucideIcon,
  PresentationIcon,
  SheetIcon,
  UsersIcon,
  XIcon,
} from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"
import { Segmented } from "@/components/genui/segmented"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { CheckMark, RadioMark } from "@/components/genui/genui-motion"

import {
  type FileKind,
  type FileRef,
  KIND_LABELS,
  type LooseNode,
  type ReadyFile,
  type ReadyFolder,
  type ReadyNode,
  type SortDirection,
  type SortKey,
  defaultDirection,
  findFolderPath,
  formatFullDate,
  formatModified,
  formatSize,
  isFolder,
  kindOf,
  pluralize,
  readyChildren,
  safeHttpUrl,
  sortNodes,
  toFileRef,
} from "./file-browser-utils"
import type { FileBrowserInput, FileBrowserResult } from "./file-browser.schema"

export type FileBrowserStatus =
  "streaming" | "ready" | "submitting" | "selected" | "cancelled"

export type FileBrowserProps = Partial<
  Omit<FileBrowserInput, "root" | "source">
> & {
  /** The tree may be partial at any depth while the tool call streams. */
  root?: LooseNode
  source?: { label?: string }
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: FileBrowserStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: FileBrowserResult) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Lists the
   * chosen files and never calls onResult.
   */
  result?: FileBrowserResult
  className?: string
}

type View = "list" | "grid"
type Cell = "main" | "open"

/** Items shown before the folder scrolls inside the card. */
const MAX_VISIBLE_ITEMS = 6

const KIND_ICONS: Record<FileKind, LucideIcon> = {
  doc: FileTextIcon,
  sheet: SheetIcon,
  slides: PresentationIcon,
  pdf: FileTextIcon,
  image: FileImageIcon,
  video: FileVideoIcon,
  archive: FileArchiveIcon,
  other: FileIcon,
}

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "name", label: "Name" },
  { value: "modified", label: "Modified" },
  { value: "size", label: "Size" },
]

const ORDER_LABELS: Record<SortKey, Record<SortDirection, string>> = {
  name: { asc: "A to Z", desc: "Z to A" },
  modified: { asc: "Oldest first", desc: "Newest first" },
  size: { asc: "Smallest first", desc: "Largest first" },
}

/** List columns: name, owner, modified, size, open. Narrow cards drop some. */
const LIST_COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_2.5rem] items-center gap-x-3 @sm:grid-cols-[minmax(0,1fr)_4.5rem_2.5rem] @md:grid-cols-[minmax(0,1fr)_6.5rem_4.5rem_2.5rem] @xl:grid-cols-[minmax(0,1fr)_8rem_6.5rem_4.5rem_2.5rem]"
const GRID_COLUMNS =
  "grid grid-cols-2 gap-3 px-3 py-3 @md:grid-cols-3 @2xl:grid-cols-4"

const activeRing =
  "group-focus-visible/grid:data-[active=true]:ring-2 group-focus-visible/grid:data-[active=true]:ring-ring/50 group-focus-visible/grid:data-[active=true]:ring-inset"

/** Each type in its own tint, the way Drive and Finder colour them. */
const KIND_TONES: Record<FileKind | "folder", string> = {
  folder:
    "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
  doc: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  sheet:
    "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  slides:
    "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  pdf: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
  image:
    "bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-400",
  video:
    "bg-fuchsia-500/15 text-fuchsia-600 dark:bg-fuchsia-400/15 dark:text-fuchsia-400",
  archive: "bg-muted text-muted-foreground dark:bg-white/10",
  other: "bg-muted text-muted-foreground dark:bg-white/10",
}

/** A file or folder's type icon in a tinted rounded box. */
function TypeIcon({
  kind,
  size = "sm",
}: {
  kind: FileKind | "folder"
  size?: "sm" | "lg"
}) {
  if (kind === "folder") return <FolderShape size={size} />
  const Icon = KIND_ICONS[kind] ?? FileIcon
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        size === "lg" ? "size-16 rounded-[16px]" : "size-10 rounded-[11px]",
        KIND_TONES[kind] ?? KIND_TONES.other,
      )}
    >
      <Icon className={size === "lg" ? "size-8" : "size-5"} />
    </span>
  )
}

/**
 * A folder drawn as a folder, in the macOS blue: a back panel with a tab, a
 * sheet of paper peeking out, and a lighter front flap.
 */
function FolderShape({ size = "sm" }: { size?: "sm" | "lg" }) {
  const id = React.useId()
  return (
    <svg
      aria-hidden
      viewBox="0 0 40 32"
      className={cn("shrink-0", size === "lg" ? "h-[52px] w-16" : "h-8 w-10")}
    >
      <defs>
        <linearGradient id={`${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8fd0f7" />
          <stop offset="1" stopColor="#68b3e6" />
        </linearGradient>
      </defs>
      {/* Back panel with the tab. */}
      <path
        d="M3.5 2h10.4a3 3 0 0 1 2.1.9l2.4 2.4a3 3 0 0 0 2.1.9H36.5A2.5 2.5 0 0 1 39 8.7V27.5a2.5 2.5 0 0 1-2.5 2.5h-33A2.5 2.5 0 0 1 1 27.5v-23A2.5 2.5 0 0 1 3.5 2z"
        fill="#5aa6dc"
      />
      {/* The paper inside. */}
      <rect x="3" y="7.2" width="34" height="6" rx="1.5" fill="#f4f8fb" />
      {/* Front flap. */}
      <path
        d="M1 11.5A2.5 2.5 0 0 1 3.5 9h33a2.5 2.5 0 0 1 2.5 2.5v16a2.5 2.5 0 0 1-2.5 2.5h-33A2.5 2.5 0 0 1 1 27.5z"
        fill={`url(#${id}-front)`}
      />
    </svg>
  )
}

function kindKey(node: LooseNode): FileKind | "folder" {
  return node.type === "folder" ? "folder" : kindOf(node)
}

/**
 * Rows and cells of the ARIA grid. The grid element keeps focus and points at
 * the active cell with aria-activedescendant, so these are deliberately not
 * focusable; and the grid view reflows rows into cards, which a <table> can't.
 */
function GridPart({
  part,
  ...props
}: React.ComponentProps<"div"> & {
  part: "row" | "rowgroup" | "gridcell" | "columnheader"
}) {
  return <div role={part} {...props} />
}

/** Selection marks (Halaska UI): a radio dot, or a filled box with a drawn check. */
function Indicator({ checked, multi }: { checked: boolean; multi: boolean }) {
  if (!multi) return <RadioMark checked={checked} className="size-5" />
  return (
    <span
      aria-hidden
      data-checked={checked || undefined}
      className="flex size-5 shrink-0 items-center justify-center rounded-[6px] border border-border bg-transparent text-background transition-colors duration-200 data-checked:bg-choice dark:data-checked:border-transparent dark:data-checked:bg-choice"
    >
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            key="indicator"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={genuiMotion.snappy}
            className="flex"
          >
            <CheckMark className="size-3" />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

function Modified({ iso }: { iso?: string }) {
  const locale = useGenUILocale()
  if (!iso) return null
  return (
    <time
      dateTime={iso}
      title={formatFullDate(iso, locale)}
      // Relative dates depend on the clock, which differs server vs client.
      suppressHydrationWarning
    >
      {formatModified(iso, undefined, locale)}
    </time>
  )
}

export function FileBrowser({
  title,
  source,
  root,
  startFolderId,
  selection = "multiple",
  max,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: FileBrowserProps) {
  const locale = useGenUILocale()
  const [navId, setNavId] = React.useState<string | null>(null)
  const [view, setView] = React.useState<View>("list")
  const [sort, setSort] = React.useState<{
    key: SortKey
    direction: SortDirection
  }>({ key: "name", direction: "asc" })
  const [selected, setSelected] = React.useState<FileRef[]>(() =>
    result?.action === "select" ? result.files : [],
  )
  const [decision, setDecision] = React.useState<
    "selected" | "cancelled" | null
  >(() =>
    result ? (result.action === "select" ? "selected" : "cancelled") : null,
  )
  const [active, setActive] = React.useState<{ id: string; cell: Cell } | null>(
    null,
  )
  const [announcement, setAnnouncement] = React.useState("")
  const gridRef = React.useRef<HTMLDivElement>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const rowsRef = React.useRef<HTMLDivElement>(null)
  const chipsRef = React.useRef<HTMLUListElement>(null)
  const chipFocus = React.useRef<number | null>(null)
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const hintId = `${baseId}-hint`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: FileBrowserStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready" && status !== "streaming"
  const done = status === "selected" || status === "cancelled"

  const selectable = selection !== "none"
  const multi = selection === "multiple"
  const count = selected.length
  const atMax = multi && max !== undefined && count >= max
  const canSubmit = selectable && !streaming && !locked && count > 0

  // The open folder: the user's choice, else the agent's start folder, else root.
  const rootReady = isFolder(root)
  const targetId = navId ?? startFolderId ?? (rootReady ? root.id : undefined)
  const foundPath = targetId ? findFolderPath(root, targetId) : null
  // While streaming, the start folder may not have arrived yet: wait for it.
  const path =
    foundPath ?? (rootReady && !streaming ? [root as ReadyFolder] : null)
  const current = path?.at(-1)
  const items = current
    ? sortNodes(readyChildren(current), sort.key, sort.direction, locale)
    : []

  const isSelected = (id: string) => selected.some((f) => f.id === id)
  const isDisabled = (node: ReadyNode) =>
    node.type === "file" && atMax && !isSelected(node.id)
  const openUrl = (node: ReadyNode) =>
    node.type === "file" ? safeHttpUrl(node.url) : null

  const activeItem = items.find((n) => n.id === active?.id) ?? items[0]
  const activeCell: Cell =
    active?.cell === "open" && activeItem && openUrl(activeItem)
      ? "open"
      : "main"
  const cellId = (index: number, cell: Cell) => `${baseId}-r${index}-${cell}`
  const activeIndex = activeItem ? items.indexOf(activeItem) : -1
  const activeCellId =
    activeIndex >= 0 ? cellId(activeIndex, activeCell) : undefined

  // A new folder starts at the top.
  const currentId = current?.id
  React.useEffect(() => {
    if (currentId === undefined) return
    if (gridRef.current) gridRef.current.scrollTop = 0
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [currentId])

  // Keep the active item in view while moving with the keyboard.
  React.useEffect(() => {
    if (!activeCellId) return
    if (document.activeElement !== gridRef.current) return
    document.getElementById(activeCellId)?.scrollIntoView({ block: "nearest" })
  }, [activeCellId])

  // After removing a chip, focus the next one (or the folder when none are left).
  React.useEffect(() => {
    const index = chipFocus.current
    if (index === null) return
    chipFocus.current = null
    const buttons = chipsRef.current?.querySelectorAll("button")
    if (buttons?.length) buttons[Math.min(index, buttons.length - 1)].focus()
    else gridRef.current?.focus()
  })

  const openFolder = (folder: ReadyFolder, focusId?: string) => {
    setNavId(folder.id)
    setActive(focusId ? { id: focusId, cell: "main" } : null)
    const n = readyChildren(folder).length
    setAnnouncement(
      `${folder.name}. ${n ? pluralize(n, "item") : "This folder is empty."}`,
    )
  }

  const goUp = () => {
    if (!path || path.length < 2) return
    openFolder(path[path.length - 2], path[path.length - 1].id)
  }

  const toggle = (file: ReadyFile) => {
    if (locked || !selectable) return
    const was = isSelected(file.id)
    let next: FileRef[]
    if (!multi) next = was ? [] : [toFileRef(file)]
    else if (was) next = selected.filter((f) => f.id !== file.id)
    else if (atMax) {
      setAnnouncement(`You can pick up to ${pluralize(max ?? 0, "file")}.`)
      return
    } else next = [...selected, toFileRef(file)]
    setSelected(next)
    setAnnouncement(
      `${file.name} ${was ? "removed" : "selected"}. ${next.length} selected.`,
    )
  }

  const removeChip = (ref: FileRef, index: number) => {
    if (locked) return
    const next = selected.filter((f) => f.id !== ref.id)
    chipFocus.current = index
    setSelected(next)
    setAnnouncement(`${ref.name} removed. ${next.length} selected.`)
  }

  const clickLink = (index: number) =>
    document.getElementById(cellId(index, "open"))?.querySelector("a")?.click()

  const activate = (node: ReadyNode, cell: Cell) => {
    const index = items.indexOf(node)
    if (cell === "open") return clickLink(index)
    if (node.type === "folder") return openFolder(node)
    // At the limit, toggle announces it instead of selecting.
    if (selectable) toggle(node)
    else if (openUrl(node)) clickLink(index)
  }

  const gridColumns = () => {
    if (view === "list" || !rowsRef.current) return 1
    const template = getComputedStyle(rowsRef.current).gridTemplateColumns
    return Math.max(1, template.split(" ").filter(Boolean).length)
  }

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey) return
    if ((e.key === "ArrowUp" && e.altKey) || e.key === "Backspace") {
      e.preventDefault()
      goUp()
      return
    }
    if (e.altKey || !activeItem) return
    const i = activeIndex
    const last = items.length - 1
    const go = (index: number, cell: Cell = "main") => {
      e.preventDefault()
      const node = items[Math.max(0, Math.min(last, index))]
      setActive({
        id: node.id,
        cell: cell === "open" && openUrl(node) ? "open" : "main",
      })
    }
    const cols = gridColumns()
    switch (e.key) {
      case "ArrowDown":
        if (i + cols <= last) return go(i + cols, activeCell)
        // Partial last row: jump to the last item.
        if (Math.floor(i / cols) < Math.floor(last / cols)) return go(last)
        return e.preventDefault()
      case "ArrowUp":
        if (i - cols >= 0) return go(i - cols, activeCell)
        return e.preventDefault()
      case "ArrowRight":
        if (activeCell === "main" && openUrl(activeItem)) {
          return go(i, "open")
        }
        if (view === "grid" && i < last) return go(i + 1)
        return e.preventDefault()
      case "ArrowLeft":
        if (activeCell === "open") return go(i)
        if (view === "grid" && i > 0) return go(i - 1, "open")
        return e.preventDefault()
      case "Home":
        return go(0)
      case "End":
        return go(last)
      case "Enter":
        e.preventDefault()
        return activate(activeItem, activeCell)
      case " ":
        e.preventDefault()
        if (activeCell === "open") return clickLink(i)
        if (activeItem.type === "file") toggle(activeItem)
        return
    }
  }

  const changeSortKey = (key: SortKey) => {
    setSort({ key, direction: defaultDirection(key) })
    setAnnouncement(
      `Sorted by ${key}, ${ORDER_LABELS[key][defaultDirection(key)].toLowerCase()}.`,
    )
  }
  const reverseSort = () => {
    const direction = sort.direction === "asc" ? "desc" : "asc"
    setSort({ key: sort.key, direction })
    setAnnouncement(ORDER_LABELS[sort.key][direction])
  }

  const submit = () => {
    if (!canSubmit) return
    setDecision("selected")
    onResult?.({ action: "select", files: selected })
  }

  const cancel = () => {
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  const heading = title ?? (streaming ? undefined : "Files")
  const TitleIcon = selectable ? PaperclipIcon : FolderOpenIcon
  const header = (
    <SurfaceHeader className="flex-row items-center gap-3 pb-3">
      <span
        aria-hidden
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400"
      >
        <TitleIcon className="size-5" />
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <SurfaceTitle id={titleId}>{heading}</SurfaceTitle>
        {source?.label && (
          <SurfaceDescription>{source.label}</SurfaceDescription>
        )}
      </div>
    </SurfaceHeader>
  )

  // Selected or cancelled: a compact record for the chat history.
  if (done) {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="file-browser"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader
            className={cn(
              "flex-row items-start justify-between gap-3",
              status === "selected" && selected.length > 0 ? "pb-3" : "pb-3",
            )}
          >
            <SurfaceTitle id={titleId}>{heading}</SurfaceTitle>
            <p aria-live="polite" className="shrink-0 pt-0.5">
              {status === "selected" ? (
                <Badge variant="success">
                  <CheckIcon aria-hidden />
                  Attached
                  <span className="sr-only">
                    {" "}
                    {pluralize(selected.length, "file")}
                  </span>
                </Badge>
              ) : (
                <Badge variant="outline">
                  <XIcon aria-hidden />
                  Cancelled
                  <span className="sr-only">. No files were attached.</span>
                </Badge>
              )}
            </p>
          </SurfaceHeader>
          {status === "selected" && selected.length > 0 && (
            <motion.ul
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-2 border-t border-border px-3 py-3"
            >
              {selected.map((f) => {
                return (
                  <li key={f.id} className="flex items-center gap-3">
                    <TypeIcon kind={f.kind} />
                    <span
                      className={cn(
                        genuiType.body,
                        "min-w-0 flex-1 font-medium break-words",
                      )}
                    >
                      {f.name}
                      <span className="sr-only">
                        , {KIND_LABELS[f.kind] ?? KIND_LABELS.other}
                      </span>
                    </span>
                  </li>
                )
              })}
            </motion.ul>
          )}
        </Surface>
      </MotionConfig>
    )
  }

  const scrolls = items.length > MAX_VISIBLE_ITEMS
  // The list's column headings are marked data-sticky-header, so the top
  // fade starts under them in both views.
  const fades = scrolls
  const waiting = !current
  const empty = !!current && items.length === 0 && !streaming
  const ariaSort = (key: SortKey) =>
    sort.key === key
      ? sort.direction === "asc"
        ? "ascending"
        : "descending"
      : undefined
  const SortIcon = sort.direction === "asc" ? ArrowUpIcon : ArrowDownIcon

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="file-browser"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={cn("@container", className)}
      >
        {header}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border px-3 py-3">
          <nav aria-label="Folder path" className="min-w-0 flex-1">
            <ol
              className={cn(
                genuiType.body,
                "flex flex-wrap items-center gap-1",
              )}
            >
              {path?.map((folder, i) => {
                const isCurrent = i === path.length - 1
                return (
                  <li
                    key={folder.id}
                    className="flex min-w-0 items-center gap-1"
                  >
                    {i > 0 && (
                      <ChevronRightIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    {isCurrent ? (
                      <span
                        aria-current="page"
                        className="inline-flex min-h-8 max-w-48 items-center gap-1.5 rounded-full bg-accent px-3 font-medium text-foreground dark:bg-white/[0.14]"
                      >
                        <FolderIcon aria-hidden className="size-3.5 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openFolder(folder, path[i + 1].id)}
                        className="inline-flex min-h-8 max-w-40 items-center truncate rounded-full bg-muted px-3 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-white/[0.06] dark:hover:bg-white/[0.12]"
                      >
                        <span className="truncate">{folder.name}</span>
                      </button>
                    )}
                  </li>
                )
              })}
              {waiting && (
                <li aria-hidden className="flex items-center gap-1">
                  {rootReady && (
                    <span className="inline-flex min-h-8 items-center rounded-full bg-muted px-3 text-muted-foreground dark:bg-white/[0.06]">
                      {root.name}
                    </span>
                  )}
                  <Skeleton className="h-4 w-24" />
                </li>
              )}
            </ol>
          </nav>

          <div className="flex items-center gap-1.5">
            <Select
              value={sort.key}
              onValueChange={(v) => {
                if (typeof v === "string") changeSortKey(v as SortKey)
              }}
              items={SORT_OPTIONS}
            >
              <SelectTrigger
                size="sm"
                aria-label="Sort by"
                className="min-w-24"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Order: ${ORDER_LABELS[sort.key][sort.direction]}. Reverse`}
                    onClick={reverseSort}
                    className="hover:bg-muted dark:hover:bg-white/10"
                  />
                }
              >
                <SortIcon aria-hidden />
              </TooltipTrigger>
              <TooltipContent>Reverse order</TooltipContent>
            </Tooltip>
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              fit
              options={[
                {
                  value: "list",
                  tip: "List view",
                  ariaLabel: "List view",
                  label: <ListIcon aria-hidden />,
                },
                {
                  value: "grid",
                  tip: "Grid view",
                  ariaLabel: "Grid view",
                  label: <LayoutGridIcon aria-hidden />,
                },
              ]}
            />
          </div>
        </div>

        <p id={hintId} className="sr-only">
          Arrow keys move between items. Enter opens a folder
          {selectable ? ", Space selects a file" : ""}. Backspace goes up a
          folder.
        </p>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <AutoHeight>
          {!waiting && (
            <ScrollFade
              scrollRef={scrollRef}
              className={cn("border-t border-border", fades && "max-h-[22rem]")}
            >
              {/* biome-ignore lint/a11y/useSemanticElements: an ARIA grid with aria-activedescendant; a <table> can't reflow into the card layout */}
              <div
                ref={gridRef}
                role="grid"
                tabIndex={0}
                aria-label={`Files in ${current.name}`}
                aria-describedby={hintId}
                aria-multiselectable={multi || undefined}
                aria-readonly={!selectable || locked || undefined}
                aria-activedescendant={activeCellId}
                onKeyDown={onGridKeyDown}
                className={cn(
                  "group/grid outline-none",
                  view === "list" && "px-2 py-2",
                )}
              >
                {view === "list" && items.length > 0 && (
                  <GridPart
                    part="row"
                    data-sticky-header
                    className={cn(
                      LIST_COLUMNS,
                      genuiType.label,
                      "sticky top-0 z-10 bg-(--surface-bg) py-2 dark:border dark:border-transparent",
                    )}
                  >
                    <GridPart
                      part="columnheader"
                      aria-sort={ariaSort("name")}
                      className="pl-3"
                    >
                      Name
                    </GridPart>
                    <GridPart part="columnheader" className="hidden @xl:block">
                      Owner
                    </GridPart>
                    <GridPart
                      part="columnheader"
                      aria-sort={ariaSort("modified")}
                      className="hidden @md:block"
                    >
                      Modified
                    </GridPart>
                    <GridPart
                      part="columnheader"
                      aria-sort={ariaSort("size")}
                      className="hidden text-right @sm:block"
                    >
                      Size
                    </GridPart>
                    <GridPart part="columnheader" className="pr-3">
                      <span className="sr-only">Open</span>
                    </GridPart>
                  </GridPart>
                )}
                <GridPart
                  ref={rowsRef}
                  part="rowgroup"
                  className={
                    view === "grid" && items.length
                      ? GRID_COLUMNS
                      : "flex flex-col"
                  }
                >
                  {items.map((node, index) => {
                    const file = node.type === "file" ? node : null
                    const checked = file ? isSelected(node.id) : false
                    const disabled = isDisabled(node) || (locked && !!file)
                    const url = openUrl(node)
                    const isActive = activeItem?.id === node.id
                    const mainId = cellId(index, "main")
                    const openId = cellId(index, "open")
                    const typeLabel = file
                      ? KIND_LABELS[kindOf(node)]
                      : "Folder"
                    const childCount = file ? 0 : readyChildren(node).length
                    const sizeText = file
                      ? formatSize(node.sizeBytes)
                      : pluralize(childCount, "item")
                    const onMainClick = () => {
                      setActive({ id: node.id, cell: "main" })
                      if (node.type === "folder") openFolder(node)
                      else if (selectable) toggle(node)
                    }
                    const link = url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        tabIndex={-1}
                        data-active={isActive && activeCell === "open"}
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                          "inline-flex size-8 items-center justify-center rounded-full text-muted-foreground opacity-0 outline-none transition-opacity group-hover/item:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 data-[active=true]:opacity-100 group-focus-visible/grid:group-data-[current=true]/item:opacity-100 [@media(hover:none)]:opacity-100",
                          activeRing,
                        )}
                      >
                        <ExternalLinkIcon aria-hidden className="size-3.5" />
                        <span className="sr-only">
                          Open {node.name} (opens in a new tab)
                        </span>
                      </a>
                    )
                    const sharedMark = file?.shared && (
                      <>
                        <IconTip label="Shared with others">
                          <span className="inline-flex shrink-0">
                            <UsersIcon
                              aria-hidden
                              className="size-3.5 text-muted-foreground"
                            />
                          </span>
                        </IconTip>
                        <span className="sr-only">, shared</span>
                      </>
                    )
                    const cellProps = {
                      id: mainId,
                      role: "gridcell",
                      "aria-selected": selectable && file ? checked : undefined,
                      "aria-disabled": disabled || undefined,
                      "data-active": isActive && activeCell === "main",
                    } as const
                    const mainCellProps = {
                      ...cellProps,
                      onClick: onMainClick,
                    } as const

                    if (view === "grid") {
                      return (
                        <motion.div
                          key={node.id}
                          role="row"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={genuiMotion.fade}
                          data-current={isActive || undefined}
                          className={cn(
                            "group/item relative overflow-hidden rounded-[10px] border border-border bg-transparent transition-colors",
                            checked &&
                              "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                            disabled
                              ? "opacity-50"
                              : "hover:bg-accent dark:hover:bg-white/5",
                          )}
                        >
                          <div
                            {...mainCellProps}
                            className={cn(
                              "flex h-full cursor-pointer flex-col rounded-[10px]",
                              disabled && "cursor-not-allowed",
                              activeRing,
                            )}
                          >
                            <span
                              aria-hidden
                              className="relative flex aspect-[16/10] items-center justify-center"
                            >
                              <TypeIcon kind={kindKey(node)} size="lg" />
                              {selectable && file && (
                                <span className="absolute top-2.5 left-2.5">
                                  <Indicator checked={checked} multi={multi} />
                                </span>
                              )}
                            </span>
                            <span className="flex items-start gap-2 px-3 pb-3">
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span
                                  className={cn(
                                    genuiType.body,
                                    "line-clamp-2 break-words",
                                  )}
                                >
                                  {node.name}
                                  <span className="sr-only">, {typeLabel}</span>
                                </span>
                                <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
                                  {sharedMark}
                                  <span className="truncate">
                                    {file ? (
                                      <>
                                        <Modified iso={node.modifiedAt} />
                                        {node.modifiedAt && sizeText && " · "}
                                        {sizeText}
                                      </>
                                    ) : (
                                      sizeText
                                    )}
                                  </span>
                                </span>
                              </span>
                            </span>
                          </div>
                          {link && (
                            <GridPart
                              id={openId}
                              part="gridcell"
                              className="absolute top-2 right-2 rounded-full bg-(--surface-bg)"
                            >
                              {link}
                            </GridPart>
                          )}
                        </motion.div>
                      )
                    }

                    const metaIds = `${baseId}-r${index}-owner ${baseId}-r${index}-modified ${baseId}-r${index}-size`
                    return (
                      <motion.div
                        key={node.id}
                        role="row"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={genuiMotion.fade}
                        // The whole row picks or opens, not just the name cell;
                        // the open link stops its own clicks.
                        onClick={onMainClick}
                        data-current={isActive || undefined}
                        className={cn(
                          LIST_COLUMNS,
                          "group/item min-h-12 cursor-pointer rounded-[10px] transition-colors",
                          checked &&
                            "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                          disabled
                            ? "cursor-not-allowed opacity-50"
                            : checked
                              ? "hover:bg-accent"
                              : "hover:bg-muted dark:hover:bg-white/5",
                        )}
                      >
                        <div
                          {...cellProps}
                          aria-describedby={metaIds}
                          className={cn(
                            "flex min-h-12 min-w-0 items-center gap-3 rounded-lg py-2 pl-3",
                            activeRing,
                          )}
                        >
                          {selectable &&
                            (file ? (
                              <Indicator checked={checked} multi={multi} />
                            ) : (
                              <span aria-hidden className="size-5 shrink-0" />
                            ))}
                          <TypeIcon kind={kindKey(node)} />
                          <span
                            title={node.name}
                            className={cn(genuiType.body, "truncate")}
                          >
                            {node.name}
                          </span>
                          <span className="sr-only">, {typeLabel}</span>
                          {sharedMark}
                        </div>
                        <GridPart
                          id={`${baseId}-r${index}-owner`}
                          part="gridcell"
                          className="hidden truncate text-[13px] text-muted-foreground @xl:block"
                        >
                          {file?.owner}
                        </GridPart>
                        <GridPart
                          id={`${baseId}-r${index}-modified`}
                          part="gridcell"
                          className="hidden truncate text-[13px] text-muted-foreground @md:block"
                        >
                          {file && <Modified iso={node.modifiedAt} />}
                        </GridPart>
                        <GridPart
                          id={`${baseId}-r${index}-size`}
                          part="gridcell"
                          className="hidden text-right text-[13px] tabular-nums text-muted-foreground @sm:block"
                        >
                          {sizeText}
                        </GridPart>
                        <GridPart
                          id={openId}
                          part="gridcell"
                          className="flex justify-end pr-2"
                        >
                          {link ??
                            (node.type === "folder" && (
                              <ChevronRightIcon
                                aria-hidden
                                className="mr-2 size-4 text-muted-foreground"
                              />
                            ))}
                        </GridPart>
                      </motion.div>
                    )
                  })}
                  {empty && (
                    <GridPart part="row">
                      <GridPart
                        part="gridcell"
                        className={cn(
                          genuiType.body,
                          "px-3 py-8 text-center text-muted-foreground",
                        )}
                      >
                        Empty folder
                      </GridPart>
                    </GridPart>
                  )}
                </GridPart>
              </div>
            </ScrollFade>
          )}

          {(waiting || (streaming && current)) &&
            (view === "grid" ? (
              <div
                aria-hidden
                className={cn(
                  GRID_COLUMNS,
                  items.length ? "pt-0" : "border-t border-border",
                )}
              >
                {Array.from({ length: items.length ? 1 : 3 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                  <Skeleton key={i} className="aspect-[4/3] rounded-[10px]" />
                ))}
              </div>
            ) : (
              <div
                aria-hidden
                className={cn(
                  "flex flex-col",
                  !items.length && "border-t border-border",
                )}
              >
                {Array.from({ length: items.length ? 1 : 3 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                  <div key={i} className="flex items-center gap-3 px-3 py-3">
                    <Skeleton className="size-5 rounded-full" />
                    <Skeleton className="h-4 flex-1" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ))}
        </AutoHeight>

        {(selectable || streaming) && (
          <SurfaceFooter className="gap-3">
            {selectable && selected.length > 0 && (
              <ul
                ref={chipsRef}
                aria-label="Selected files"
                className="flex w-full flex-wrap gap-1.5"
              >
                {selected.map((f, i) => {
                  const Icon = KIND_ICONS[f.kind] ?? FileIcon
                  return (
                    <motion.li
                      key={f.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className="inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-transparent pl-3.5 text-[13px]"
                    >
                      <Icon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="max-w-48 truncate">{f.name}</span>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              aria-label={`Remove ${f.name}`}
                              disabled={locked}
                              onClick={() => removeChip(f, i)}
                              className="mr-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
                            />
                          }
                        >
                          <XIcon aria-hidden className="size-3" />
                        </TooltipTrigger>
                        <TooltipContent>{`Remove ${f.name}`}</TooltipContent>
                      </Tooltip>
                    </motion.li>
                  )
                })}
              </ul>
            )}
            <p className={cn(genuiType.meta, "tabular-nums")}>
              {streaming ? (
                <ShimmeringText
                  text="Loading files…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "submitting" ? (
                "Saving…"
              ) : multi && max !== undefined ? (
                // The button carries the count; this line carries the limit.
                count === 0 ? (
                  `Choose up to ${max}`
                ) : (
                  `${count} selected · up to ${max}`
                )
              ) : null}
            </p>
            {selectable && (
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={cancel}
                  disabled={locked}
                >
                  Cancel
                </Button>
                <WhyDisabled
                  when={!canSubmit && status !== "submitting" && !locked}
                  reason="Select a file first"
                >
                  <Button size="sm" onClick={submit} disabled={!canSubmit}>
                    {status === "submitting"
                      ? "Saving…"
                      : multi && count > 0
                        ? `${submitLabel ?? "Select"} ${pluralize(count, "file")}`
                        : (submitLabel ?? "Select")}
                  </Button>
                </WhyDisabled>
              </div>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
