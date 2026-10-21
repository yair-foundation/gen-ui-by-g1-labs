"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  ArrowRightLeftIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SignalLowIcon,
  SignalMediumIcon,
  XIcon,
} from "lucide-react"
import {
  LayoutGroup,
  MotionConfig,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import {
  type Board,
  type BoardMove,
  type CardPosition,
  type DueInfo,
  applyMoves,
  applyProposals,
  boardsEqual,
  buildBoard,
  diffBoards,
  dueInfo,
  findCard,
  indexFromMidpoints,
  moveCard,
  nearestColumnIndex,
  pluralize,
  reconcileBoard,
  restorePosition,
  safeHttpUrl,
  wipState,
} from "./kanban-board-utils"
import type {
  KanbanBoardInput,
  KanbanBoardResult,
  KanbanCard,
  KanbanColumn,
  KanbanPriority,
  KanbanProposal,
} from "./kanban-board.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type KanbanBoardStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "applied"
  | "revised"
  | "dismissed"

export type KanbanBoardProps = Partial<
  Omit<KanbanBoardInput, "columns" | "cards" | "proposals">
> & {
  /** Columns, cards and proposals may be partial while the tool call streams. */
  columns?: Partial<KanbanColumn>[]
  cards?: Partial<KanbanCard>[]
  proposals?: Partial<KanbanProposal>[]
  /**
   * The moment due dates are compared with ("Overdue"). Defaults to the
   * viewer's clock, read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host applies the result.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: KanbanBoardStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: KanbanBoardResult) => void
  /**
   * A decision from history. Restores the final arrangement read-only and
   * never calls onResult.
   */
  result?: KanbanBoardResult
  className?: string
}

/**
 * Priority: urgent and high are badges (D6: red, orange), the cases that need
 * a second look; medium and low stay a small muted signal so most cards keep
 * one short row.
 */
const PRIORITY: Record<
  KanbanPriority,
  | { label: string; variant: "destructive" | "warning" }
  | { label: string; Icon: typeof SignalLowIcon }
> = {
  urgent: { label: "Urgent", variant: "destructive" },
  high: { label: "High", variant: "warning" },
  medium: { label: "Medium", Icon: SignalMediumIcon },
  low: { label: "Low", Icon: SignalLowIcon },
}

/** Pointer travel (px) before a mouse press becomes a drag. */
const MOUSE_SLOP = 4
/** Touch and pen: hold this long (ms) without moving to pick a card up. */
const LONG_PRESS_MS = 300
const TOUCH_SLOP = 8
/** Columns scroll internally only beyond this many cards. */
const SCROLL_AFTER = 8

type Settle = { id: string; left: number; top: number }

type Change =
  | { kind: "suggested"; from: string; reason?: string }
  | { kind: "moved"; from: string }
  | { kind: "reordered" }
  | { kind: "undone"; to: string }

type Indicator = "before" | "after" | null

type PointerDrag = {
  cardId: string
  pointerId: number
  pointerType: string
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  width: number
  active: boolean
  timer: number
  userSelect: string
}

/** The viewer's clock, read after mount so server and client markup match. */
function useNow(enabled: boolean) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!enabled) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [enabled])
  return now
}

function DropLine({ edge }: { edge: "before" | "after" }) {
  return (
    <span
      aria-hidden
      data-slot="kanban-drop-indicator"
      className={cn(
        "pointer-events-none absolute inset-x-0 z-20 h-0.5 rounded-full bg-primary",
        edge === "before" ? "-top-[5px]" : "-bottom-[5px]",
      )}
    />
  )
}

function DueText({ info }: { info: DueInfo }) {
  return (
    <span
      className={cn(
        "text-[13px] leading-4 tabular-nums",
        info.overdue ? "font-medium text-destructive" : "text-muted-foreground",
      )}
    >
      {info.overdue
        ? `Overdue · ${info.label}`
        : info.today
          ? "Due today"
          : `Due ${info.label}`}
    </span>
  )
}

/**
 * One quiet row: priority, key, due date and assignee. Labels are read to
 * screen readers only. Shared by the card and its drag preview.
 */
function CardDetails({ card, due }: { card: KanbanCard; due: DueInfo | null }) {
  const labels = [...new Set(card.labels ?? [])].slice(0, 3)
  const priority = card.priority ? PRIORITY[card.priority] : null
  const hasMeta = priority || due || card.assignee || card.subtitle
  const href = safeHttpUrl(card.url)
  return (
    <>
      {labels.length > 0 && (
        <span className="sr-only">{`Labels: ${labels.join(", ")}`}</span>
      )}
      {hasMeta && (
        <div className="flex min-h-6 flex-wrap items-center gap-x-1.5 gap-y-1">
          {priority &&
            ("variant" in priority ? (
              <Badge variant={priority.variant} className="h-5 px-2">
                {priority.label}
                <span className="sr-only"> priority</span>
              </Badge>
            ) : (
              <span
                title={`${priority.label} priority`}
                className="inline-flex items-center text-muted-foreground"
              >
                <priority.Icon aria-hidden className="size-3.5" />
                <span className="sr-only">{`${priority.label} priority`}</span>
              </span>
            ))}
          {card.subtitle &&
            (href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className={cn(
                  genuiType.meta,
                  "min-w-0 truncate rounded-sm tabular-nums underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50",
                )}
              >
                {card.subtitle}
                <span className="sr-only">{`, open ${card.title} (opens in a new tab)`}</span>
              </a>
            ) : (
              <span
                className={cn(genuiType.meta, "min-w-0 truncate tabular-nums")}
              >
                {card.subtitle}
              </span>
            ))}
          {due && <DueText info={due} />}
          {card.assignee && (
            <span
              title={card.assignee.name}
              className="ml-auto inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-border bg-transparent text-xs font-medium text-muted-foreground uppercase"
            >
              <span aria-hidden>{card.assignee.initials}</span>
              <span className="sr-only">{`Assigned to ${card.assignee.name}`}</span>
            </span>
          )}
        </div>
      )}
    </>
  )
}

type CardProps = {
  card: KanbanCard
  /** The card sits in a finished column: faded, with a filled check. */
  done?: boolean
  due: DueInfo | null
  change: Change | null
  columnItems: { value: string; label: string }[]
  draggable: boolean
  canReview: boolean
  placeholder: boolean
  held: boolean
  indicator: Indicator
  settle: Settle | null
  seen: boolean
  focusRequested: boolean
  instructionsId: string
  onPointerDown: (e: React.PointerEvent<HTMLLIElement>, id: string) => void
  onHandleKeyDown: (
    e: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => void
  onHandleBlur: (e: React.FocusEvent<HTMLButtonElement>, id: string) => void
  onMove: (id: string, columnId: string) => void
  onUndo: (id: string) => void
  onRedo: (id: string) => void
  onFocused: () => void
  onSettled: () => void
}

function BoardCard({
  card,
  done = false,
  due,
  change,
  columnItems,
  draggable,
  canReview,
  placeholder,
  held,
  indicator,
  settle,
  seen,
  focusRequested,
  instructionsId,
  onPointerDown,
  onHandleKeyDown,
  onHandleBlur,
  onMove,
  onUndo,
  onRedo,
  onFocused,
  onSettled,
}: CardProps) {
  const bodyRef = React.useRef<HTMLDivElement>(null)
  const focusRef = React.useRef<HTMLElement | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const reduceMotion = useReducedMotion()
  const name = card.subtitle ? `${card.title} (${card.subtitle})` : card.title

  // After a pointer drop, glide from where the card was released into its slot.
  React.useLayoutEffect(() => {
    const el = bodyRef.current
    if (!settle || !el) return
    const rect = el.getBoundingClientRect()
    const dx = settle.left - (rect.left - x.get())
    const dy = settle.top - (rect.top - y.get())
    if (reduceMotion || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) {
      x.set(0)
      y.set(0)
      onSettled()
      return
    }
    x.set(dx)
    y.set(dy)
    const spring = genuiMotion.firm
    const ax = animate(x, 0, spring)
    const ay = animate(y, 0, spring)
    let cancelled = false
    Promise.all([ax, ay]).then(() => {
      if (!cancelled) onSettled()
    })
    return () => {
      cancelled = true
      ax.stop()
      ay.stop()
    }
  }, [settle, x, y, reduceMotion, onSettled])

  // Keep focus on the card when a move re-mounts it in another column.
  React.useLayoutEffect(() => {
    if (!focusRequested) return
    const el = focusRef.current
    if (el) {
      if (document.activeElement !== el) el.focus({ preventScroll: true })
      el.scrollIntoView({ block: "nearest", inline: "nearest" })
    }
    onFocused()
  }, [focusRequested, onFocused])

  return (
    <motion.li
      data-slot="kanban-card"
      data-kanban-card=""
      data-card-id={card.id}
      layout={settle ? false : "position"}
      layoutId={settle ? undefined : card.id}
      initial={seen ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      onPointerDown={draggable ? (e) => onPointerDown(e, card.id) : undefined}
      className={cn("relative", (settle || held) && "z-10")}
    >
      {indicator === "before" && <DropLine edge="before" />}
      <motion.div
        ref={bodyRef}
        data-slot="kanban-card-body"
        style={{ x, y }}
        className={cn(
          "group/card flex flex-col gap-1.5 rounded-[10px] border border-border/60 bg-card p-3.5 transition-[opacity,box-shadow] hover:bg-muted dark:border-transparent dark:bg-foreground/[0.14] dark:hover:bg-foreground/[0.18]",
          done && "opacity-60 hover:opacity-100",
          "has-[[data-slot=kanban-card-handle]:focus-visible]:ring-2 has-[[data-slot=kanban-card-handle]:focus-visible]:ring-ring/50",
          draggable &&
            "cursor-grab touch-manipulation select-none [-webkit-touch-callout:none]",
          placeholder && "opacity-40",
          held && "shadow-md dark:shadow-none ring-2 ring-ring",
        )}
      >
        <div className="flex items-start gap-1">
          {done && (
            <span
              aria-hidden
              className="mt-px mr-1 inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-background dark:bg-emerald-400"
            >
              <CheckIcon className="size-2.5" strokeWidth={3} />
            </span>
          )}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {draggable ? (
              <button
                ref={(el) => {
                  focusRef.current = el
                }}
                type="button"
                data-slot="kanban-card-handle"
                aria-roledescription="draggable card"
                aria-describedby={instructionsId}
                onKeyDown={(e) => onHandleKeyDown(e, card.id)}
                onBlur={(e) => onHandleBlur(e, card.id)}
                className={cn("relative", genuiHit, "cursor-grab text-left text-[13px] font-semibold break-words outline-none")}
              >
                {card.title}
              </button>
            ) : (
              <span
                ref={(el) => {
                  focusRef.current = el
                }}
                tabIndex={-1}
                className="text-[13px] font-semibold break-words outline-none"
              >
                {card.title}
              </span>
            )}
          </div>
          {draggable && (
            <Select
              value={card.columnId}
              items={columnItems}
              onValueChange={(value) => {
                if (typeof value === "string") onMove(card.id, value)
              }}
            >
              <SelectTrigger
                size="sm"
                aria-label={`Move ${name} to another column`}
                className="relative -mt-1 gap-0.5 rounded-full border-transparent bg-transparent px-1.5 pr-1 text-muted-foreground opacity-0 shadow-none transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 pointer-coarse:opacity-100 after:absolute after:inset-x-0 after:-inset-y-[9px] hover:bg-muted hover:text-foreground focus-visible:opacity-100 data-[popup-open]:opacity-100 data-[size=sm]:h-7 dark:bg-transparent [&_svg:not([class*='size-'])]:size-3"
              >
                <ArrowRightLeftIcon aria-hidden className="size-3.5" />
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectLabel>Move to</SelectLabel>
                  {columnItems.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
        </div>

        <CardDetails card={card} due={due} />

        {change && (
          <div className="flex items-center gap-2 text-[13px] leading-4">
            <div className="flex min-w-0 flex-1 flex-col">
              {change.kind === "suggested" ? (
                <span className="font-medium">
                  {`Suggested · from ${change.from}`}
                  {/* The why is one hover away and always read to screen readers. */}
                  {change.reason && (
                    <span className="sr-only">{`. ${change.reason}`}</span>
                  )}
                </span>
              ) : change.kind === "moved" ? (
                <span className="text-muted-foreground">{`Moved from ${change.from}`}</span>
              ) : change.kind === "reordered" ? (
                <span className="text-muted-foreground">Reordered</span>
              ) : (
                <span className="text-muted-foreground">{`Move to ${change.to} undone`}</span>
              )}
            </div>
            {canReview && (
              <Button
                size="xs"
                variant="outline"
                aria-label={
                  change.kind === "undone"
                    ? `Redo suggested move of ${name} to ${change.to}`
                    : `Undo move of ${name}`
                }
                onClick={() =>
                  change.kind === "undone" ? onRedo(card.id) : onUndo(card.id)
                }
              >
                {change.kind === "undone" ? "Redo" : "Undo"}
              </Button>
            )}
          </div>
        )}
      </motion.div>
      {indicator === "after" && <DropLine edge="after" />}
    </motion.li>
  )
}

function ColumnSkeleton() {
  return (
    <div
      aria-hidden
      className="flex w-64 max-w-[85%] shrink-0 flex-col gap-2"
    >
      <Skeleton className="h-11 rounded-[10px]" />
      <div className="flex flex-col gap-2 rounded-[10px] bg-foreground/[0.09] p-2">
        <Skeleton className="h-16 rounded-[10px] bg-card" />
        <Skeleton className="h-16 rounded-[10px] bg-card" />
      </div>
    </div>
  )
}

export function KanbanBoard({
  title,
  source,
  columns = [],
  cards = [],
  proposals = [],
  editable = true,
  submitLabel,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: KanbanBoardProps) {
  const locale = useGenUILocale()
  const groupId = React.useId()
  const instructionsId = React.useId()
  const headingPrefix = React.useId()

  const liveNow = useNow(nowProp === undefined)
  const fixedNow =
    nowProp === undefined ? Number.NaN : new Date(nowProp).getTime()
  const now = Number.isFinite(fixedNow) ? fixedNow : liveNow

  // ---- Data (may be partial while streaming) ----
  const readyColumns = columns.filter(
    (c): c is KanbanColumn =>
      typeof c.id === "string" && typeof c.title === "string",
  )
  const columnIds = readyColumns.map((c) => c.id)
  const columnById = new Map(readyColumns.map((c) => [c.id, c]))
  const readyCards = cards.filter(
    (c): c is KanbanCard =>
      typeof c.id === "string" &&
      typeof c.columnId === "string" &&
      typeof c.title === "string",
  )
  const cardById = new Map(readyCards.map((c) => [c.id, c]))
  const original = buildBoard(columnIds, readyCards)
  const proposalByCard = new Map<string, KanbanProposal>()
  for (const p of proposals) {
    if (typeof p.cardId !== "string" || typeof p.toColumnId !== "string") {
      continue
    }
    const home = findCard(original, p.cardId)
    if (
      !home ||
      home.columnId === p.toColumnId ||
      !columnById.has(p.toColumnId) ||
      proposalByCard.has(p.cardId)
    ) {
      continue
    }
    proposalByCard.set(p.cardId, p as KanbanProposal)
  }
  const readyProposals = [...proposalByCard.values()]
  const hasProposals = readyProposals.length > 0
  const initial = applyProposals(original, readyProposals)

  // ---- State ----
  const [arrangement, setArrangement] = React.useState<Board | null>(null)
  const [decision, setDecision] = React.useState<
    "applied" | "revised" | "dismissed" | null
  >(() =>
    result
      ? (
          { apply: "applied", revise: "revised", dismiss: "dismissed" } as const
        )[result.action]
      : null,
  )
  const [revising, setRevising] = React.useState(false)
  const [feedback, setFeedback] = React.useState(
    result?.action === "revise" ? result.feedback : "",
  )
  const [announcement, setAnnouncement] = React.useState("")
  const [focusId, setFocusId] = React.useState<string | null>(null)
  const [held, setHeld] = React.useState<{
    cardId: string
    snapshot: Board
  } | null>(null)
  const [drag, setDrag] = React.useState<{
    cardId: string
    width: number
  } | null>(null)
  const [target, setTarget] = React.useState<CardPosition | null>(null)
  const [settling, setSettling] = React.useState<Settle | null>(null)

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: KanbanBoardStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"
  const canDrag = editable && !locked
  const displayOnly = !editable && !hasProposals && !result && !decision

  // ---- The arrangement on screen ----
  let current: Board
  if (result) {
    current =
      result.action === "apply"
        ? applyMoves(original, result.moves)
        : result.action === "dismiss"
          ? original
          : initial
  } else if (status === "dismissed") {
    current = original
  } else {
    current = arrangement ? reconcileBoard(arrangement, initial) : initial
  }

  const moves: BoardMove[] = diffBoards(original, current, columnIds)
  const moveByCard = new Map(moves.map((m) => [m.cardId, m]))
  const changeCount = moves.length
  const dirty = !boardsEqual(current, initial)
  const totalCards = readyCards.filter((c) => columnById.has(c.columnId)).length

  const columnTitle = (id: string) => columnById.get(id)?.title ?? id
  const cardTitle = (id: string) => cardById.get(id)?.title ?? "Card"

  const changeFor = (id: string): Change | null => {
    const move = moveByCard.get(id)
    const proposal = proposalByCard.get(id)
    if (move && move.fromColumnId !== move.toColumnId) {
      if (proposal && proposal.toColumnId === move.toColumnId) {
        return {
          kind: "suggested",
          from: columnTitle(move.fromColumnId),
          reason: proposal.reason,
        }
      }
      return { kind: "moved", from: columnTitle(move.fromColumnId) }
    }
    if (move) return { kind: "reordered" }
    if (proposal && !locked) {
      return { kind: "undone", to: columnTitle(proposal.toColumnId) }
    }
    return null
  }

  // Cards already on screen don't replay their entry animation after a move.
  const seen = React.useRef(new Set<string>())
  React.useEffect(() => {
    for (const c of readyCards) seen.current.add(c.id)
  })

  // ---- Announcements ----
  const lastAnnouncement = React.useRef("")
  const announce = (text: string) => {
    // A repeated message gets a trailing space so screen readers read it again.
    const next = text === lastAnnouncement.current ? `${text} ` : text
    lastAnnouncement.current = next
    setAnnouncement(next)
  }
  const positionText = (board: Board, id: string) => {
    const pos = findCard(board, id)
    if (!pos) return ""
    return `Column ${columnTitle(pos.columnId)}, position ${pos.index + 1} of ${board[pos.columnId].length}.`
  }

  const onFocused = React.useCallback(() => setFocusId(null), [])
  const onSettled = React.useCallback(() => setSettling(null), [])

  // ---- Edits ----
  const commit = (next: Board, focus?: string) => {
    setArrangement(next)
    if (focus) setFocusId(focus)
  }

  const menuMove = (id: string, columnId: string) => {
    const pos = findCard(current, id)
    if (!pos || pos.columnId === columnId || !(columnId in current)) return
    const next = moveCard(current, id, columnId, current[columnId].length)
    commit(next, id)
    announce(
      `Moved ${cardTitle(id)} to ${columnTitle(columnId)}, position ${next[columnId].length} of ${next[columnId].length}.`,
    )
  }

  const undo = (id: string) => {
    const pos = restorePosition(original, current, id)
    if (!pos) return
    const next = moveCard(current, id, pos.columnId, pos.index)
    commit(next, id)
    announce(`${cardTitle(id)} moved back to ${columnTitle(pos.columnId)}.`)
  }

  const redo = (id: string) => {
    const proposal = proposalByCard.get(id)
    if (!proposal || !(proposal.toColumnId in current)) return
    const next = moveCard(
      current,
      id,
      proposal.toColumnId,
      current[proposal.toColumnId].length,
    )
    commit(next, id)
    announce(
      `${cardTitle(id)} moved to ${columnTitle(proposal.toColumnId)}, as suggested.`,
    )
  }

  const reset = () => {
    setArrangement(null)
    setHeld(null)
    announce("Board reset.")
  }

  const apply = () => {
    setHeld(null)
    setDecision("applied")
    onResult?.({ action: "apply", moves })
  }

  const requestChanges = () => {
    const text = feedback.trim()
    if (!text) return
    setRevising(false)
    setHeld(null)
    setDecision("revised")
    onResult?.({ action: "revise", feedback: text })
  }

  const dismiss = () => {
    setHeld(null)
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  // ---- Keyboard drag ----
  const isHeld = (id: string) => canDrag && held?.cardId === id

  const onHandleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (!canDrag || drag) return
    const { key } = e
    if (!held) {
      if (key === " " || key === "Enter") {
        e.preventDefault()
        setHeld({ cardId: id, snapshot: current })
        announce(
          `Picked up ${cardTitle(id)}. ${positionText(current, id)} Use the arrow keys to move, Space to drop, Escape to cancel.`,
        )
      }
      return
    }
    if (held.cardId !== id) return
    const pos = findCard(current, id)
    if (!pos) return
    const ci = columnIds.indexOf(pos.columnId)
    let to: CardPosition | null = null
    switch (key) {
      case "ArrowUp":
        to = { columnId: pos.columnId, index: pos.index - 1 }
        break
      case "ArrowDown":
        to = { columnId: pos.columnId, index: pos.index + 1 }
        break
      case "ArrowLeft":
      case "ArrowRight": {
        const next = columnIds[ci + (key === "ArrowLeft" ? -1 : 1)]
        if (next) {
          to = {
            columnId: next,
            index: Math.min(pos.index, current[next].length),
          }
        }
        break
      }
      case " ":
      case "Enter":
        e.preventDefault()
        setHeld(null)
        announce(
          `Dropped in ${columnTitle(pos.columnId)}, position ${pos.index + 1} of ${current[pos.columnId].length}.`,
        )
        return
      case "Tab":
        setHeld(null)
        announce(
          `Dropped in ${columnTitle(pos.columnId)}, position ${pos.index + 1} of ${current[pos.columnId].length}.`,
        )
        return
      case "Escape": {
        e.preventDefault()
        const back = held.snapshot
        setHeld(null)
        commit(back, id)
        announce(
          `Move cancelled. ${cardTitle(id)} is back in ${positionText(back, id).replace(/^Column /, "")}`,
        )
        return
      }
      default:
        return
    }
    e.preventDefault()
    if (!to) {
      announce(`${cardTitle(id)}. ${positionText(current, id)}`)
      return
    }
    const room = current[to.columnId].filter((c) => c !== id).length
    const index = Math.max(0, Math.min(to.index, room))
    if (to.columnId === pos.columnId && index === pos.index) {
      announce(`${cardTitle(id)}. ${positionText(current, id)}`)
      return
    }
    const next = moveCard(current, id, to.columnId, index)
    commit(next, id)
    announce(`${cardTitle(id)}. ${positionText(next, id)}`)
  }

  const onHandleBlur = (e: React.FocusEvent<HTMLButtonElement>, id: string) => {
    // Focus moved elsewhere (not a re-mount): drop the card where it is.
    if (held?.cardId === id && e.relatedTarget) {
      setHeld(null)
      announce(`Dropped ${cardTitle(id)}. ${positionText(current, id)}`)
    }
  }

  // ---- Pointer drag (mouse, touch, pen) ----
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const scrollEdges = useScrollEdges(scrollerRef, readyColumns.length)
  // One column (16rem plus the 0.75rem gap) at a time; snapping settles it.
  const scrollColumns = (dir: -1 | 1) =>
    scrollerRef.current?.scrollBy({
      left: dir * 268,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    })
  const columnEls = React.useRef(new Map<string, HTMLElement>())
  const dragRef = React.useRef<PointerDrag | null>(null)
  const pointer = React.useRef({ x: 0, y: 0 })
  const targetRef = React.useRef<CardPosition | null>(null)
  const rafRef = React.useRef(0)
  const overlayX = useMotionValue(0)
  const overlayY = useMotionValue(0)

  const handlers = React.useRef({
    move: (_e: PointerEvent) => {},
    up: (_e: PointerEvent) => {},
    cancel: () => {},
    activate: () => {},
    tick: () => {},
  })

  // Stable wrappers, so window listeners can be added and removed by identity.
  const [listeners] = React.useState(() => {
    const l = {
      move: (e: PointerEvent) => handlers.current.move(e),
      up: (e: PointerEvent) => handlers.current.up(e),
      cancel: () => handlers.current.cancel(),
      key: (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault()
          handlers.current.cancel()
        }
      },
      // While a touch drag is active, the page must not scroll under it.
      touchmove: (e: TouchEvent) => {
        if (dragRef.current?.active && e.cancelable) e.preventDefault()
      },
      contextmenu: (e: Event) => {
        if (dragRef.current) e.preventDefault()
      },
      loop: () => {
        handlers.current.tick()
        if (dragRef.current?.active) {
          rafRef.current = requestAnimationFrame(l.loop)
        }
      },
      attach: () => {
        window.addEventListener("pointermove", l.move)
        window.addEventListener("pointerup", l.up)
        window.addEventListener("pointercancel", l.cancel)
        window.addEventListener("touchmove", l.touchmove, { passive: false })
        window.addEventListener("contextmenu", l.contextmenu)
      },
      detach: () => {
        window.removeEventListener("pointermove", l.move)
        window.removeEventListener("pointerup", l.up)
        window.removeEventListener("pointercancel", l.cancel)
        window.removeEventListener("touchmove", l.touchmove)
        window.removeEventListener("contextmenu", l.contextmenu)
        window.removeEventListener("keydown", l.key)
        cancelAnimationFrame(rafRef.current)
      },
    }
    return l
  })

  const updateTarget = () => {
    const d = dragRef.current
    const scroller = scrollerRef.current
    if (!d?.active || !scroller) return
    const { x, y } = pointer.current
    const r = scroller.getBoundingClientRect()
    const margin = 32
    let next: CardPosition | null = null
    // Released well outside the board: nothing moves.
    if (
      x >= r.left - margin &&
      x <= r.right + margin &&
      y >= r.top - margin &&
      y <= r.bottom + margin
    ) {
      const els = columnIds.map((id) => columnEls.current.get(id))
      const spans = els.map((el) => {
        const b = el?.getBoundingClientRect()
        return b
          ? { left: b.left, right: b.right }
          : { left: Number.POSITIVE_INFINITY, right: Number.POSITIVE_INFINITY }
      })
      const ci = nearestColumnIndex(spans, x)
      const colEl = els[ci]
      if (ci >= 0 && colEl) {
        const mids = [
          ...colEl.querySelectorAll<HTMLElement>("[data-kanban-card]"),
        ]
          .filter((el) => el.dataset.cardId !== d.cardId)
          .map((el) => {
            const b = el.getBoundingClientRect()
            return b.top + b.height / 2
          })
        next = { columnId: columnIds[ci], index: indexFromMidpoints(mids, y) }
      }
    }
    const prev = targetRef.current
    if (prev?.columnId !== next?.columnId || prev?.index !== next?.index) {
      targetRef.current = next
      setTarget(next)
    }
  }

  const endDrag = () => {
    const d = dragRef.current
    if (d?.timer) window.clearTimeout(d.timer)
    if (d?.active) document.body.style.userSelect = d.userSelect
    listeners.detach()
    dragRef.current = null
    targetRef.current = null
    setDrag(null)
    setTarget(null)
  }

  /** Let the card glide from the drag preview into its (new or old) slot. */
  const settleFromOverlay = (id: string) =>
    setSettling({ id, left: overlayX.get(), top: overlayY.get() })

  const activate = () => {
    const d = dragRef.current
    if (!d || d.active || !canDrag) return
    d.active = true
    d.userSelect = document.body.style.userSelect
    document.body.style.userSelect = "none"
    overlayX.set(pointer.current.x - d.offsetX)
    overlayY.set(pointer.current.y - d.offsetY)
    setDrag({ cardId: d.cardId, width: d.width })
    window.addEventListener("keydown", listeners.key)
    updateTarget()
    rafRef.current = requestAnimationFrame(listeners.loop)
    announce(`Picked up ${cardTitle(d.cardId)}.`)
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    pointer.current = { x: e.clientX, y: e.clientY }
    if (!d.active) {
      const distance = Math.hypot(e.clientX - d.startX, e.clientY - d.startY)
      if (d.pointerType === "mouse") {
        if (distance > MOUSE_SLOP) activate()
      } else if (distance > TOUCH_SLOP) {
        // The finger moved before the long press: it's a scroll.
        endDrag()
      }
      return
    }
    overlayX.set(e.clientX - d.offsetX)
    overlayY.set(e.clientY - d.offsetY)
    updateTarget()
  }

  const onPointerUp = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!d.active) return endDrag()
    const t = targetRef.current
    const pos = findCard(current, d.cardId)
    settleFromOverlay(d.cardId)
    if (t && pos && !(t.columnId === pos.columnId && t.index === pos.index)) {
      const next = moveCard(current, d.cardId, t.columnId, t.index)
      commit(next)
      announce(
        `Dropped ${cardTitle(d.cardId)} in ${columnTitle(t.columnId)}, position ${t.index + 1} of ${next[t.columnId].length}.`,
      )
    } else {
      announce(`${cardTitle(d.cardId)} was not moved.`)
    }
    endDrag()
  }

  const onPointerCancel = () => {
    const d = dragRef.current
    if (d?.active) {
      settleFromOverlay(d.cardId)
      announce(`Move cancelled. ${cardTitle(d.cardId)} was not moved.`)
    }
    endDrag()
  }

  /** Auto-scrolls the board (and a long column) when the pointer nears an edge. */
  const tick = () => {
    const d = dragRef.current
    const scroller = scrollerRef.current
    if (!d?.active || !scroller) return
    const { x, y } = pointer.current
    let scrolled = false
    const r = scroller.getBoundingClientRect()
    const edge = Math.min(56, r.width / 4)
    const speed = (overlap: number) =>
      Math.ceil((Math.min(overlap, edge) / edge) * 16)
    const maxLeft = scroller.scrollWidth - scroller.clientWidth
    if (x < r.left + edge && scroller.scrollLeft > 0) {
      scroller.scrollLeft -= speed(r.left + edge - x)
      scrolled = true
    } else if (x > r.right - edge && scroller.scrollLeft < maxLeft) {
      scroller.scrollLeft += speed(x - (r.right - edge))
      scrolled = true
    }
    const t = targetRef.current
    const list = t
      ? columnEls.current
          .get(t.columnId)
          ?.querySelector<HTMLElement>("[data-slot=kanban-column-list]")
      : null
    if (list && list.scrollHeight > list.clientHeight) {
      const lr = list.getBoundingClientRect()
      const vEdge = Math.min(40, lr.height / 4)
      if (y < lr.top + vEdge && list.scrollTop > 0) {
        list.scrollTop -= speed(lr.top + vEdge - y)
        scrolled = true
      } else if (
        y > lr.bottom - vEdge &&
        list.scrollTop < list.scrollHeight - list.clientHeight
      ) {
        list.scrollTop += speed(y - (lr.bottom - vEdge))
        scrolled = true
      }
    }
    if (scrolled) updateTarget()
  }

  React.useLayoutEffect(() => {
    handlers.current = {
      move: onPointerMove,
      up: onPointerUp,
      cancel: onPointerCancel,
      activate,
      tick,
    }
  })

  React.useEffect(
    () => () => {
      const d = dragRef.current
      if (d?.timer) window.clearTimeout(d.timer)
      if (d?.active) document.body.style.userSelect = d.userSelect
      listeners.detach()
    },
    [listeners],
  )

  const onCardPointerDown = (
    e: React.PointerEvent<HTMLLIElement>,
    id: string,
  ) => {
    if (!canDrag || held || dragRef.current) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    const control = (e.target as HTMLElement).closest(
      "a,button,input,textarea,select,[role=combobox]",
    )
    if (control && control.getAttribute("data-slot") !== "kanban-card-handle") {
      return
    }
    const body =
      e.currentTarget.querySelector<HTMLElement>(
        "[data-slot=kanban-card-body]",
      ) ?? e.currentTarget
    const rect = body.getBoundingClientRect()
    pointer.current = { x: e.clientX, y: e.clientY }
    dragRef.current = {
      cardId: id,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      active: false,
      timer:
        e.pointerType === "mouse"
          ? 0
          : window.setTimeout(() => handlers.current.activate(), LONG_PRESS_MS),
      userSelect: "",
    }
    listeners.attach()
  }

  const indicatorFor = (
    columnId: string,
    ids: string[],
  ): { id: string | null; edge: "before" | "after" } | null => {
    if (!drag || !target || target.columnId !== columnId) return null
    const origin = findCard(current, drag.cardId)
    if (origin?.columnId === columnId && origin.index === target.index) {
      return null
    }
    const others = ids.filter((id) => id !== drag.cardId)
    if (target.index < others.length) {
      return { id: others[target.index], edge: "before" }
    }
    return { id: ids.at(-1) ?? null, edge: "after" }
  }

  const columnItems = readyColumns.map((c) => ({
    value: c.id,
    label: c.title,
  }))
  const dragCard = drag ? cardById.get(drag.cardId) : undefined
  const showFooter =
    !displayOnly &&
    (changeCount > 0 ||
      hasProposals ||
      status === "applied" ||
      status === "revised" ||
      status === "dismissed")
  const sourceUrl = safeHttpUrl(source?.url)
  const applyLabel =
    submitLabel ??
    (changeCount > 0 ? `Apply ${pluralize(changeCount, "change")}` : "Apply")

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="kanban-board"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-label={title ?? "Board"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <SurfaceTitle>
              {title ?? (streaming ? undefined : "Board")}
            </SurfaceTitle>
            {(scrollEdges.prev || scrollEdges.next) && (
              <div className="-mr-2 flex items-center gap-1">
                <WhyDisabled
                  when={!scrollEdges.prev}
                  reason="Already at the first column"
                >
                  <IconTip label="Previous columns">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Scroll to previous columns"
                      disabled={!scrollEdges.prev}
                      onClick={() => scrollColumns(-1)}
                    >
                      <ChevronLeftIcon />
                    </Button>
                  </IconTip>
                </WhyDisabled>
                <WhyDisabled
                  when={!scrollEdges.next}
                  reason="Already at the last column"
                >
                  <IconTip label="Next columns">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Scroll to next columns"
                      disabled={!scrollEdges.next}
                      onClick={() => scrollColumns(1)}
                    >
                      <ChevronRightIcon />
                    </Button>
                  </IconTip>
                </WhyDisabled>
              </div>
            )}
          </div>
          {totalCards > 0 && (
            <span className="sr-only">{pluralize(totalCards, "card")}</span>
          )}
          {source?.label && (
            <p className={genuiType.meta}>
              {sourceUrl ? (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {source.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                source.label
              )}
            </p>
          )}
          {streaming ? (
            <p className="text-[13px] leading-4">
              <ShimmeringText
                text="Loading board…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            </p>
          ) : null}
        </SurfaceHeader>

        <p id={instructionsId} className="sr-only">
          Press Space or Enter to pick up this card. Then use the arrow keys to
          move it between and within columns, Space or Enter to drop it, or
          Escape to cancel. You can also use the card's move menu. Nothing is
          saved until you apply.
        </p>
        <p className="sr-only" aria-live="assertive" aria-atomic="true">
          {announcement}
        </p>

        <LayoutGroup id={groupId}>
          <div className="relative">
            <motion.div
              ref={scrollerRef}
              layoutScroll
              role="region"
              aria-label={`${title ?? "Board"} columns`}
              data-dragging={drag ? "true" : undefined}
              className="flex snap-x snap-mandatory scroll-px-3 items-start gap-3 overflow-x-auto border-t border-border px-3 pt-3 pb-3 sm:snap-proximity data-[dragging=true]:snap-none"
            >
              {readyColumns.length === 0 &&
                streaming &&
                ["a", "b", "c", "d"].map((k) => <ColumnSkeleton key={k} />)}

              {readyColumns.map((column) => {
                const ids = current[column.id] ?? []
                const count = ids.length
                const wip = wipState(count, column.limit)
                const scrolls = count > SCROLL_AFTER
                const indicator = indicatorFor(column.id, ids)
                const headingId = `${headingPrefix}-${column.id}`
                return (
                  <section
                    key={column.id}
                    ref={(el) => {
                      if (el) columnEls.current.set(column.id, el)
                      else columnEls.current.delete(column.id)
                    }}
                    aria-labelledby={headingId}
                    data-slot="kanban-column"
                    data-wip={wip}
                    className="flex w-64 max-w-[85%] shrink-0 snap-start flex-col gap-2"
                  >
                    <header className="flex min-h-11 items-center gap-2 rounded-[10px] bg-foreground/[0.09] px-3">
                      <h4
                        id={headingId}
                        className="min-w-0 truncate text-[14px] font-semibold"
                      >
                        {column.title}
                      </h4>
                      <span className="text-[13px] leading-4 tabular-nums text-muted-foreground">
                        <span className="sr-only">
                          {column.limit
                            ? `${pluralize(count, "card")}, limit ${column.limit}`
                            : pluralize(count, "card")}
                        </span>
                        <span
                          aria-hidden
                          className="inline-flex items-baseline"
                        >
                          <SlidingNumber number={count} initiallyStable />
                          {column.limit ? `\u00a0/ ${column.limit}` : null}
                        </span>
                      </span>
                      {wip === "over" && (
                        <Badge variant="destructive" className="ml-auto h-5">
                          Over limit
                        </Badge>
                      )}
                    </header>
                    <motion.ul
                      layoutScroll={scrolls}
                      data-slot="kanban-column-list"
                      aria-label={`${column.title}, ${pluralize(count, "card")}`}
                      className={cn(
                        "flex min-h-12 flex-col gap-2 rounded-[10px] bg-foreground/[0.09] p-2",
                        scrolls &&
                          "max-h-[38rem] overflow-y-auto overscroll-auto",
                      )}
                    >
                      {ids.map((id) => {
                        const card = cardById.get(id)
                        if (!card) return null
                        return (
                          <BoardCard
                            key={id}
                            card={card}
                            done={column.done}
                            due={card.due ? dueInfo(card.due, now, locale) : null}
                            change={changeFor(id)}
                            columnItems={columnItems}
                            draggable={canDrag}
                            canReview={!locked}
                            placeholder={drag?.cardId === id}
                            held={isHeld(id)}
                            indicator={
                              indicator?.id === id ? indicator.edge : null
                            }
                            settle={settling?.id === id ? settling : null}
                            seen={seen.current.has(id)}
                            focusRequested={focusId === id}
                            instructionsId={instructionsId}
                            onPointerDown={onCardPointerDown}
                            onHandleKeyDown={onHandleKeyDown}
                            onHandleBlur={onHandleBlur}
                            onMove={menuMove}
                            onUndo={undo}
                            onRedo={redo}
                            onFocused={onFocused}
                            onSettled={onSettled}
                          />
                        )
                      })}
                      {count === 0 &&
                        (streaming ? (
                          <li aria-hidden>
                            <Skeleton className="h-16 rounded-[10px] bg-card" />
                          </li>
                        ) : (
                          <li className="relative rounded-lg border border-dashed px-3 py-3 text-center text-[13px] leading-4 text-muted-foreground">
                            {indicator && <DropLine edge="before" />}
                            No cards
                          </li>
                        ))}
                    </motion.ul>
                  </section>
                )
              })}
            </motion.div>
            <ScrollFades edges={scrollEdges} />
          </div>
        </LayoutGroup>

        {showFooter && (
          <SurfaceFooter
            aria-live="polite"
            className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {status === "applied" ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4" />
                Applied {pluralize(changeCount, "change")}
              </p>
            ) : status === "dismissed" ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <XIcon aria-hidden className="size-4" />
                Dismissed. Nothing moved.
              </p>
            ) : status === "revised" ? (
              <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
                <MessageSquareIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>
                  Changes requested
                  {feedback && (
                    <span className="text-foreground">: “{feedback}”</span>
                  )}
                </span>
              </p>
            ) : revising ? (
              <div className="flex w-full flex-col gap-2">
                <Textarea
                  autoFocus
                  aria-label="What should change?"
                  placeholder="What should change?"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      requestChanges()
                    }
                    if (e.key === "Escape") setRevising(false)
                  }}
                  className="min-h-16"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setRevising(false)}
                  >
                    Cancel
                  </Button>
                  <WhyDisabled
                    when={!feedback.trim()}
                    reason="Describe the change first"
                  >
                    <Button
                      size="sm"
                      onClick={requestChanges}
                      disabled={!feedback.trim()}
                    >
                      Send request
                    </Button>
                  </WhyDisabled>
                </div>
              </div>
            ) : (
              <>
                {/* The changes are marked on the cards; the footer only counts them. */}
                <p className={genuiType.meta}>
                  {streaming
                    ? "Loading suggestions…"
                    : changeCount > 0
                      ? pluralize(changeCount, "change")
                      : "No changes"}
                </p>
                <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                  <WhyDisabled when={locked} reason="Already sent">
                    <IconTip label="Request changes">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Request changes"
                        onClick={() => setRevising(true)}
                        disabled={locked}
                      >
                        <MessageSquareIcon />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                  {hasProposals ? (
                    <WhyDisabled
                      when={locked || !dirty}
                      reason="Nothing to reset"
                    >
                      <IconTip label="Reset board">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Reset board"
                          onClick={reset}
                          disabled={locked || !dirty}
                        >
                          <RotateCcwIcon />
                        </Button>
                      </IconTip>
                    </WhyDisabled>
                  ) : (
                    <WhyDisabled
                      when={locked || !dirty}
                      reason="Nothing to reset"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={reset}
                        disabled={locked || !dirty}
                      >
                        Reset
                      </Button>
                    </WhyDisabled>
                  )}
                  {hasProposals && (
                    <WhyDisabled when={locked} reason="Already sent">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={dismiss}
                        disabled={locked}
                      >
                        Dismiss
                      </Button>
                    </WhyDisabled>
                  )}
                  <WhyDisabled
                    when={locked || changeCount === 0}
                    reason="Move a card first"
                  >
                    <Button
                      size="sm"
                      onClick={apply}
                      disabled={locked || changeCount === 0}
                    >
                      {status === "submitting" ? "Applying…" : applyLabel}
                    </Button>
                  </WhyDisabled>
                </div>
              </>
            )}
          </SurfaceFooter>
        )}
      </Surface>

      {drag &&
        dragCard &&
        typeof document !== "undefined" &&
        createPortal(
          <MotionConfig reducedMotion="user">
            <motion.div
              aria-hidden
              data-slot="kanban-drag-preview"
              style={{ x: overlayX, y: overlayY, width: drag.width }}
              className="pointer-events-none fixed top-0 left-0 z-[100] cursor-grabbing"
            >
              <motion.div
                initial={{ scale: 1, rotate: 0 }}
                animate={{ scale: 1.03, rotate: 1.5 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex flex-col gap-1.5 rounded-lg border bg-card p-3.5 text-card-foreground shadow-lg dark:shadow-none"
              >
                <span className="text-[13px] font-semibold break-words">
                  {dragCard.title}
                </span>
                <CardDetails
                  card={dragCard}
                  due={dragCard.due ? dueInfo(dragCard.due, now, locale) : null}
                />
              </motion.div>
            </motion.div>
          </MotionConfig>,
          document.body,
        )}
    </MotionConfig>
  )
}

/** Which sides of a horizontal scroller have more content past the edge. */
function useScrollEdges(
  ref: React.RefObject<HTMLElement | null>,
  dep?: unknown,
) {
  const [edges, setEdges] = React.useState({ prev: false, next: false })
  // biome-ignore lint/correctness/useExhaustiveDependencies: dep re-measures when the content changes
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const prev = el.scrollLeft > 4
      const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
      setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    resize?.observe(el)
    const mutation = new MutationObserver(update)
    mutation.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", update)
      resize?.disconnect()
      mutation.disconnect()
    }
  }, [ref, dep])
  return edges
}

/** Edge fades that say the row goes on; each shows only on its side. */
function ScrollFades({ edges }: { edges: { prev: boolean; next: boolean } }) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-14 bg-linear-to-r from-card to-transparent transition-opacity duration-200",
          edges.prev ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-14 bg-linear-to-l from-card to-transparent transition-opacity duration-200",
          edges.next ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  )
}
