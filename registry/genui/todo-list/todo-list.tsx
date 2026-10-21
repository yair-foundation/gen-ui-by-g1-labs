"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EllipsisIcon,
  GripVerticalIcon,
  ListChecksIcon,
  PencilIcon,
  PlusIcon,
  SignalHighIcon,
  SignalLowIcon,
  SignalMediumIcon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import {
  AnimatePresence,
  LayoutGroup,
  MotionConfig,
  motion,
  useMotionValue,
  useReducedMotion,
} from "motion/react"

import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/genui/date-picker"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import {
  type DueDisplay,
  type TodoItemData,
  type TodoPriority,
  applyTodoChanges,
  canReorder,
  cleanItem,
  countChanges,
  countItems,
  countsText,
  dayKeyOf,
  diffTodos,
  dueBucket,
  dueDisplay,
  groupItems,
  indexFromMidpoints,
  moveInGroup,
  parseDue,
  parseQuickAdd,
  pluralize,
  safeTimeZone,
  uniqueId,
} from "./todo-list-utils"
import type {
  TodoItem,
  TodoListInput,
  TodoListProgress,
  TodoListResult,
  TodoSuggestion,
} from "./todo-list.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"

export type TodoListStatus =
  | "streaming"
  | "ready"
  | "saving"
  | "saved"
  | "discarded"

export type TodoListProps = Partial<
  Omit<TodoListInput, "items" | "suggestions">
> & {
  /** Items and suggestions may be partial while the tool call streams. */
  items?: Partial<TodoItem>[]
  suggestions?: Partial<TodoSuggestion>[]
  /**
   * The moment "today" and "overdue" are computed from. Defaults to the
   * viewer's clock, read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'saving' while the host writes a save to the tasks app.
   */
  status?: TodoListStatus
  /**
   * Called on Save (with the changes since the last save) and on Discard.
   * The list stays usable after a save, so it can be called more than once.
   */
  onResult?: (result: TodoListResult) => void
  /**
   * Called on every edit with the working copy, so the host can keep it
   * across reloads (it isn't sent to the agent). Pass it back as `progress`.
   */
  onProgress?: (progress: TodoListProgress) => void
  /** A saved working copy (from `onProgress`). The list stays editable. */
  progress?: TodoListProgress
  /**
   * A save or discard from history. When present on mount (and without
   * `progress`), restores the saved list read-only and never calls onResult.
   */
  result?: TodoListResult
  className?: string
}

/** The working list: items plus deleted placeholders (for Undo). */
type Row = TodoItemData & { removed?: boolean }

type PointerDrag = {
  id: string
  group: string
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  width: number
  active: boolean
  userSelect: string
}

type GroupView = {
  key: string
  label: string
  rows: Row[]
  /** Live (not deleted) ids in display order, for reordering. */
  ids: string[]
  reorderable: boolean
}

const PRIORITY: Record<
  TodoPriority,
  { Icon: typeof SignalHighIcon; label: string }
> = {
  high: { Icon: SignalHighIcon, label: "High priority" },
  medium: { Icon: SignalMediumIcon, label: "Medium priority" },
  low: { Icon: SignalLowIcon, label: "Low priority" },
}

/** How long a checked item stays in place before moving to Done. */
const SETTLE_MS = 1000
/** Pointer travel (px) before pressing the handle becomes a drag. */
const DRAG_SLOP = 4

const quote = (text: string) => `“${text}”`

function toMs(value: Date | string | number | undefined) {
  if (value === undefined) return undefined
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(t) ? undefined : t
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

/** Valid items from (possibly partial) props. Repeat ids are skipped. */
function readyItems(items: Partial<TodoItem>[]) {
  const out: (TodoItemData & { isNew?: boolean })[] = []
  const seen = new Set<string>()
  for (const i of items) {
    if (typeof i.id !== "string" || typeof i.text !== "string") continue
    if (seen.has(i.id)) continue
    seen.add(i.id)
    const subtasks = (i.subtasks ?? [])
      .filter(
        (s) => s && typeof s.id === "string" && typeof s.text === "string",
      )
      .slice(0, 10)
      .map((s) => ({ id: s.id, text: s.text, done: Boolean(s.done) }))
    const tags = (i.tags ?? [])
      .filter((t): t is string => typeof t === "string" && t.trim() !== "")
      .slice(0, 3)
    out.push({
      ...cleanItem({
        id: i.id,
        text: i.text,
        done: Boolean(i.done),
        due: i.due,
        priority: i.priority,
        notes: i.notes,
        tags,
        subtasks,
        assignee:
          i.assignee?.name && i.assignee.initials
            ? { name: i.assignee.name, initials: i.assignee.initials }
            : undefined,
      }),
      ...(i.isNew ? { isNew: true } : {}),
    })
  }
  return out
}

const stripRow = ({ removed: _removed, ...item }: Row) => cleanItem(item)

/**
 * Inline text editor: Enter or leaving the field saves, Escape cancels.
 * `refocus` is false when focus already moved elsewhere (a blur).
 */
function EditField({
  initial,
  label,
  onSave,
  onCancel,
}: {
  initial: string
  label: string
  onSave: (text: string, refocus: boolean) => void
  onCancel: (refocus: boolean) => void
}) {
  const [value, setValue] = React.useState(initial)
  const done = React.useRef(false)
  const finish = (save: boolean, refocus = true) => {
    if (done.current) return
    done.current = true
    if (save && value.trim()) onSave(value.trim(), refocus)
    else onCancel(refocus)
  }
  return (
    <Input
      autoFocus
      aria-label={label}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          finish(true)
        }
        if (e.key === "Escape") {
          e.preventDefault()
          finish(false)
        }
      }}
      onBlur={() => finish(true, false)}
      className="h-7 -my-1 -ml-1.5 px-1.5"
    />
  )
}

/** "3 changes", with the count rolling digit by digit as it changes. */
function ChangeCount({ count }: { count: number }) {
  return (
    <span>
      <span className="sr-only">{pluralize(count, "change")}</span>
      <span aria-hidden className="inline-flex items-baseline gap-[0.25em]">
        <SlidingNumber number={count} initiallyStable />
        {count === 1 ? "change" : "changes"}
      </span>
    </span>
  )
}

function DueText({
  display,
  done,
  className,
}: {
  display: DueDisplay
  done: boolean
  className?: string
}) {
  const overdue = display.overdue && !done
  const text = overdue
    ? display.text
    : display.time
      ? `${display.label} ${display.time}`
      : display.label
  const Icon = overdue ? CircleAlertIcon : CalendarIcon
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[13px] leading-4 tabular-nums",
        overdue ? "font-medium text-destructive" : "text-muted-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span aria-hidden>{text}</span>
      <span className="sr-only">
        {overdue
          ? display.long
          : display.long.replace(/^Overdue, was due/, "Was due")}
      </span>
    </span>
  )
}

function DropLine({ edge }: { edge: "before" | "after" }) {
  return (
    <span
      aria-hidden
      data-slot="todo-list-drop-indicator"
      className={cn(
        "pointer-events-none absolute inset-x-2 z-20 h-0.5 rounded-full bg-primary",
        edge === "before" ? "-top-px" : "-bottom-px",
      )}
    />
  )
}

export function TodoList({
  title,
  source,
  items = [],
  groupBy = "none",
  timeZone,
  allowAdd = true,
  allowEdit = true,
  hideDone = false,
  suggestions = [],
  now: nowInput,
  status: statusProp,
  onResult,
  onProgress,
  progress,
  result,
  className,
}: TodoListProps) {
  const locale = useGenUILocale()
  const uid = React.useId()
  const rootRef = React.useRef<HTMLElement>(null)
  const reduceMotion = useReducedMotion()

  // ---- Data (may be partial while streaming) ----
  const incoming = readyItems(items)
  const loaded: TodoItemData[] = incoming
    .filter((i) => !i.isNew)
    .map(({ isNew: _n, ...i }) => i)
  const initialRows: Row[] = incoming.map(({ isNew: _n, ...i }) => i)
  const readySuggestions = suggestions
    .filter(
      (s): s is TodoSuggestion =>
        typeof s?.text === "string" && s.text.trim() !== "",
    )
    .slice(0, 5)

  // ---- Time ----
  const tz = safeTimeZone(timeZone)
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  const pinned = toMs(nowInput)
  const clock = useNow(mounted && pinned === undefined)
  // Without a time zone, wait for the viewer's (after mount) even when pinned.
  const now = pinned !== undefined && (tz || mounted) ? pinned : clock
  const today = now === null ? null : dayKeyOf(now, tz)

  // ---- State ----
  const [fromHistory] = React.useState(
    () => result !== undefined && progress === undefined,
  )
  const [rows, setRows] = React.useState<Row[] | null>(
    () => progress?.items ?? null,
  )
  const [baseline, setBaseline] = React.useState<TodoItemData[] | null>(
    () => progress?.baseline ?? null,
  )
  const [handled, setHandled] = React.useState<
    Map<string, "added" | "dismissed">
  >(
    () =>
      new Map(
        (progress?.handledSuggestions ?? []).map((t) => [t, "dismissed"]),
      ),
  )
  const [savedCount, setSavedCount] = React.useState<number | null>(null)
  const [settling, setSettling] = React.useState<Set<string>>(() => new Set())
  const [doneOpen, setDoneOpen] = React.useState(false)
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set())
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [optionsId, setOptionsId] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState("")
  const [skip, setSkip] = React.useState({ due: false, priority: false })
  const [held, setHeld] = React.useState<{
    id: string
    group: string
    snapshot: Row[]
  } | null>(null)
  const [drag, setDrag] = React.useState<{
    id: string
    group: string
    width: number
  } | null>(null)
  const [target, setTarget] = React.useState<number | null>(null)
  const [message, setMessage] = React.useState("")
  const [moveMessage, setMoveMessage] = React.useState("")
  const [focusKey, setFocusKey] = React.useState<string | null>(null)

  const decision =
    fromHistory && result
      ? result.action === "save"
        ? "saved"
        : "discarded"
      : null
  // A host-provided "ready" (or nothing) yields to the restored decision.
  const status: TodoListStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"
  const canEdit = allowEdit && !locked
  const canTick = !locked

  // ---- The list on screen ----
  let current: Row[]
  if (fromHistory && result) {
    current =
      result.action === "save"
        ? applyTodoChanges(loaded, result.changes)
        : loaded
  } else {
    current = rows ?? initialRows
  }
  const live = current.filter((r) => !r.removed)
  const base = baseline ?? loaded
  const baseIds = new Set(base.map((i) => i.id))
  const changes =
    fromHistory && result?.action === "save"
      ? result.changes
      : diffTodos(base, live.map(stripRow))
  const changeCount = countChanges(changes)
  const edited = new Set(changes.updated.map((u) => u.id))
  const hasTombstones = current.some((r) => r.removed)
  const counts = countItems(live, now, tz)
  const saveLabel = source?.label ? `Save to ${source.label}` : "Save"
  const listName = title ?? "To-do list"

  // ---- Groups ----
  const isActive = (r: Row) => !r.done || settling.has(r.id)
  const activeRows = current.filter(isActive)
  const doneRows = current.filter((r) => !isActive(r))
  const doneLive = doneRows.filter((r) => !r.removed).length
  const byId = new Map(current.map((r) => [r.id, r]))
  const reorderAllowed = canEdit && canReorder(groupBy)
  const groups: GroupView[] = groupItems(
    // Items that are settling sort as if still open, so they stay in place.
    activeRows.map((r) => (settling.has(r.id) ? { ...r, done: false } : r)),
    groupBy,
    now,
    tz,
  ).map((g) => {
    const groupRows = g.items.map((i) => byId.get(i.id) ?? i)
    return {
      key: g.key,
      label: g.label,
      rows: groupRows,
      ids: groupRows.filter((r) => !r.removed && !r.done).map((r) => r.id),
      reorderable: reorderAllowed,
    }
  })
  const groupOf = (key: string) => groups.find((g) => g.key === key)
  const showHeadings =
    groupBy !== "none" && !(groupBy === "due" && now === null)

  // ---- Announcements and focus ----
  const lastMessage = React.useRef("")
  const announce = (text: string) => {
    // A repeated message gets a trailing space so screen readers read it again.
    const next = text === lastMessage.current ? `${text} ` : text
    lastMessage.current = next
    setMessage(next)
  }
  const lastMove = React.useRef("")
  const announceMove = (text: string) => {
    const next = text === lastMove.current ? `${text} ` : text
    lastMove.current = next
    setMoveMessage(next)
  }

  React.useLayoutEffect(() => {
    if (!focusKey) return
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-focus-key="${CSS.escape(focusKey)}"]`,
    )
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
    el?.scrollIntoView({ block: "nearest" })
    setFocusKey(null)
  }, [focusKey])

  // ---- Edits ----
  const handledList = (map: Map<string, string>) => [...map.keys()]

  const commit = (
    next: Row[],
    opts: {
      baseline?: TodoItemData[]
      handled?: Map<string, "added" | "dismissed">
    } = {},
  ) => {
    setRows(next)
    setSavedCount(null)
    onProgress?.({
      items: next.filter((r) => !r.removed).map(stripRow),
      baseline: opts.baseline ?? base,
      handledSuggestions: handledList(opts.handled ?? handled),
    })
  }

  const patch = (id: string, fields: Partial<TodoItemData>) =>
    commit(
      current.map((r) => {
        if (r.id !== id) return r
        const next: Row = { ...r, ...fields }
        for (const [k, v] of Object.entries(fields)) {
          if (v === undefined) delete (next as Record<string, unknown>)[k]
        }
        return next
      }),
    )

  // Timers that move checked items to Done.
  const timers = React.useRef(new Map<string, number>())
  React.useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) window.clearTimeout(t)
    }
  }, [])

  const settle = (id: string) => {
    timers.current.delete(id)
    const row = rootRef.current?.querySelector<HTMLElement>(
      `[data-row-id="${CSS.escape(id)}"]`,
    )
    // Keep focus in the list when the focused row moves away.
    if (row?.contains(document.activeElement)) {
      const all = [
        ...(rootRef.current?.querySelectorAll<HTMLElement>("[data-todo-row]") ??
          []),
      ]
      const at = all.indexOf(row)
      const other = all[at + 1] ?? all[at - 1]
      setFocusKey(
        other?.dataset.rowId
          ? `${other.dataset.rowId}:check`
          : hideDone
            ? "add"
            : "done-toggle",
      )
    }
    setSettling((s) => {
      const next = new Set(s)
      next.delete(id)
      return next
    })
  }

  const toggleDone = (id: string, on: boolean) => {
    const row = byId.get(id)
    if (!row) return
    patch(id, { done: on })
    const pending = timers.current.get(id)
    if (pending) {
      window.clearTimeout(pending)
      timers.current.delete(id)
    }
    if (on) {
      setSettling((s) => new Set(s).add(id))
      if (reduceMotion) settle(id)
      else
        timers.current.set(
          id,
          window.setTimeout(() => settle(id), SETTLE_MS),
        )
      announce(
        hideDone
          ? `Marked ${quote(row.text)} done.`
          : `Marked ${quote(row.text)} done. It moves to Done.`,
      )
    } else {
      const wasInDone = !settling.has(id)
      setSettling((s) => {
        const next = new Set(s)
        next.delete(id)
        return next
      })
      if (wasInDone) setFocusKey(`${id}:check`)
      announce(`${quote(row.text)} is back on the list.`)
    }
  }

  const toggleSubtask = (id: string, subId: string, on: boolean) => {
    const row = byId.get(id)
    if (!row?.subtasks) return
    patch(id, {
      subtasks: row.subtasks.map((s) =>
        s.id === subId ? { ...s, done: on } : s,
      ),
    })
  }

  const saveText = (id: string, text: string, refocus: boolean) => {
    if (text !== byId.get(id)?.text) patch(id, { text })
    setEditingId(null)
    if (refocus) setFocusKey(`${id}:edit`)
  }

  const startEdit = (id: string) => {
    if (!canEdit) return
    setOptionsId(null)
    setEditingId(id)
  }

  const remove = (id: string) => {
    const row = byId.get(id)
    if (!row) return
    commit(current.map((r) => (r.id === id ? { ...r, removed: true } : r)))
    setOptionsId(null)
    setEditingId(null)
    setFocusKey(`${id}:undo`)
    announce(`Deleted ${quote(row.text)}. Undo is available.`)
  }

  const restore = (id: string) => {
    const row = byId.get(id)
    commit(
      current.map((r) => {
        if (r.id !== id) return r
        const { removed: _removed, ...rest } = r
        return rest
      }),
    )
    setFocusKey(`${id}:check`)
    if (row) announce(`Restored ${quote(row.text)}.`)
  }

  const setDue = (id: string, due: string | undefined) => {
    const row = byId.get(id)
    patch(id, { due })
    if (!row) return
    const display = dueDisplay(due, now, tz, locale)
    announce(
      display
        ? `${quote(row.text)}: ${display.long.toLowerCase()}.`
        : `${quote(row.text)}: no due date.`,
    )
  }

  const setPriority = (id: string, priority: TodoPriority | undefined) => {
    const row = byId.get(id)
    patch(id, { priority })
    if (row) {
      announce(
        `${quote(row.text)}: ${priority ? PRIORITY[priority].label.toLowerCase() : "no priority"}.`,
      )
    }
  }

  // ---- Quick add ----
  const parsed = parseQuickAdd(
    draft,
    today ?? "1970-01-01",
    today === null ? { ...skip, due: true } : skip,
  )
  const parsedDue = parsed.due
    ? dueDisplay(parsed.due, now, tz, locale)
    : null

  const addItem = (item: Omit<TodoItemData, "id">, fromSuggestion?: string) => {
    const id = uniqueId([...current, ...base], "new")
    const nextHandled = fromSuggestion
      ? new Map(handled).set(fromSuggestion, "added" as const)
      : handled
    if (fromSuggestion) setHandled(nextHandled)
    commit([...current, cleanItem({ ...item, id })], { handled: nextHandled })
    const display = item.due ? dueDisplay(item.due, now, tz, locale) : null
    announce(
      `Added ${quote(item.text)}${display ? `, ${display.long.toLowerCase()}` : ""}.`,
    )
    return id
  }

  const submitDraft = () => {
    if (!parsed.text || locked || !allowAdd) return
    addItem({
      text: parsed.text,
      done: false,
      ...(parsed.due ? { due: parsed.due } : {}),
      ...(parsed.priority ? { priority: parsed.priority } : {}),
    })
    setDraft("")
    setSkip({ due: false, priority: false })
  }

  const visibleSuggestions = readySuggestions.filter(
    (s) => !handled.has(s.text),
  )

  const nextSuggestionFocus = (text: string) => {
    const i = visibleSuggestions.findIndex((s) => s.text === text)
    const next = visibleSuggestions[i + 1] ?? visibleSuggestions[i - 1]
    return next ? `suggestion:${next.text}` : allowAdd ? "add" : null
  }

  const acceptSuggestion = (s: TodoSuggestion) => {
    const focus = nextSuggestionFocus(s.text)
    addItem(
      {
        text: s.text,
        done: false,
        ...(parseDue(s.due) ? { due: s.due } : {}),
        tags: (s.tags ?? []).filter((t) => t?.trim()).slice(0, 3),
      },
      s.text,
    )
    if (focus) setFocusKey(focus)
  }

  const dismissSuggestion = (s: TodoSuggestion) => {
    const focus = nextSuggestionFocus(s.text)
    const next = new Map(handled).set(s.text, "dismissed" as const)
    setHandled(next)
    onProgress?.({
      items: live.map(stripRow),
      baseline: base,
      handledSuggestions: handledList(next),
    })
    if (focus) setFocusKey(focus)
    announce(`Dismissed the suggestion ${quote(s.text)}.`)
  }

  // ---- Save and discard ----
  const save = () => {
    if (locked || changeCount === 0) return
    const clean = live.map(stripRow)
    onResult?.({ action: "save", changes })
    setRows(clean)
    setBaseline(clean)
    setSavedCount(changeCount)
    setEditingId(null)
    setOptionsId(null)
    setHeld(null)
    onProgress?.({
      items: clean,
      baseline: clean,
      handledSuggestions: handledList(handled),
    })
    announce(
      `Saved ${pluralize(changeCount, "change")}${source?.label ? ` to ${source.label}` : ""}.`,
    )
  }

  const discard = () => {
    if (locked) return
    const nextHandled = new Map(
      [...handled].filter(([, how]) => how === "dismissed"),
    )
    setHandled(nextHandled)
    setRows(base.map((i) => ({ ...i })))
    setSavedCount(null)
    setEditingId(null)
    setOptionsId(null)
    setHeld(null)
    setSettling(new Set())
    for (const t of timers.current.values()) window.clearTimeout(t)
    timers.current.clear()
    onResult?.({ action: "discard" })
    onProgress?.({
      items: base,
      baseline: base,
      handledSuggestions: handledList(nextHandled),
    })
    announce("Changes discarded.")
  }

  // ---- Keyboard reordering ----
  const positionText = (id: string, group: GroupView, list = group.ids) =>
    `${list.indexOf(id) + 1} of ${list.length}${showHeadings ? ` in ${group.label}` : ""}`

  const onHandleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
    group: GroupView,
  ) => {
    if (!group.reorderable || drag) return
    const { key } = e
    const text = byId.get(id)?.text ?? "Task"
    if (!held) {
      if (key === " " || key === "Enter") {
        e.preventDefault()
        setHeld({ id, group: group.key, snapshot: current })
        announceMove(
          `Picked up ${quote(text)}, position ${positionText(id, group)}. Use the up and down arrow keys to move it, Space to drop, Escape to cancel.`,
        )
      }
      return
    }
    if (held.id !== id) return
    const from = group.ids.indexOf(id)
    let to: number | null = null
    switch (key) {
      case "ArrowUp":
        to = from - 1
        break
      case "ArrowDown":
        to = from + 1
        break
      case "Home":
        to = 0
        break
      case "End":
        to = group.ids.length - 1
        break
      case " ":
      case "Enter":
      case "Tab": {
        if (key !== "Tab") e.preventDefault()
        setHeld(null)
        announceMove(
          `Dropped ${quote(text)} at position ${positionText(id, group)}.`,
        )
        return
      }
      case "Escape": {
        e.preventDefault()
        const back = held.snapshot
        setHeld(null)
        commit(back)
        setFocusKey(`${id}:handle`)
        announceMove(`Move cancelled. ${quote(text)} is back where it was.`)
        return
      }
      default:
        return
    }
    e.preventDefault()
    if (to < 0 || to >= group.ids.length || to === from) {
      announceMove(`${quote(text)}, position ${positionText(id, group)}.`)
      return
    }
    const next = moveInGroup(current, id, group.ids, to)
    const ids = group.ids.filter((x) => x !== id)
    ids.splice(to, 0, id)
    commit(next)
    setFocusKey(`${id}:handle`)
    announceMove(`${quote(text)}, position ${positionText(id, group, ids)}.`)
  }

  const onHandleBlur = (e: React.FocusEvent<HTMLButtonElement>, id: string) => {
    // Focus moved elsewhere (not a re-render): drop the item where it is.
    if (held?.id === id && e.relatedTarget) {
      setHeld(null)
      announceMove(`Dropped ${quote(byId.get(id)?.text ?? "task")}.`)
    }
  }

  // ---- Pointer reordering (mouse, touch, pen) on the handle ----
  const dragRef = React.useRef<PointerDrag | null>(null)
  const pointer = React.useRef({ x: 0, y: 0 })
  const targetRef = React.useRef<number | null>(null)
  const overlayX = useMotionValue(0)
  const overlayY = useMotionValue(0)

  const handlers = React.useRef({
    move: (_e: PointerEvent) => {},
    up: (_e: PointerEvent) => {},
    cancel: () => {},
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
      attach: () => {
        window.addEventListener("pointermove", l.move)
        window.addEventListener("pointerup", l.up)
        window.addEventListener("pointercancel", l.cancel)
      },
      detach: () => {
        window.removeEventListener("pointermove", l.move)
        window.removeEventListener("pointerup", l.up)
        window.removeEventListener("pointercancel", l.cancel)
        window.removeEventListener("keydown", l.key)
      },
    }
    return l
  })

  const updateTarget = () => {
    const d = dragRef.current
    if (!d?.active || !rootRef.current) return
    const mids = [
      ...rootRef.current.querySelectorAll<HTMLElement>(
        `[data-todo-row][data-group="${CSS.escape(d.group)}"]`,
      ),
    ]
      .filter((el) => el.dataset.rowId !== d.id && el.dataset.done !== "true")
      .map((el) => {
        const b = el.getBoundingClientRect()
        return b.top + b.height / 2
      })
    const next = indexFromMidpoints(mids, pointer.current.y)
    if (next !== targetRef.current) {
      targetRef.current = next
      setTarget(next)
    }
  }

  const endDrag = () => {
    const d = dragRef.current
    if (d?.active) document.body.style.userSelect = d.userSelect
    listeners.detach()
    dragRef.current = null
    targetRef.current = null
    setDrag(null)
    setTarget(null)
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    pointer.current = { x: e.clientX, y: e.clientY }
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= DRAG_SLOP)
        return
      d.active = true
      d.userSelect = document.body.style.userSelect
      document.body.style.userSelect = "none"
      setDrag({ id: d.id, group: d.group, width: d.width })
      window.addEventListener("keydown", listeners.key)
      announceMove(`Picked up ${quote(byId.get(d.id)?.text ?? "task")}.`)
    }
    overlayX.set(e.clientX - d.offsetX)
    overlayY.set(e.clientY - d.offsetY)
    updateTarget()
  }

  const onPointerUp = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!d.active) return endDrag()
    const group = groupOf(d.group)
    const t = targetRef.current
    const text = quote(byId.get(d.id)?.text ?? "task")
    if (group && t !== null && t !== group.ids.indexOf(d.id)) {
      const ids = group.ids.filter((x) => x !== d.id)
      ids.splice(t, 0, d.id)
      commit(moveInGroup(current, d.id, group.ids, t))
      announceMove(
        `Moved ${text} to position ${positionText(d.id, group, ids)}.`,
      )
    } else {
      announceMove(`${text} was not moved.`)
    }
    endDrag()
  }

  const onPointerCancel = () => {
    const d = dragRef.current
    if (d?.active) {
      announceMove(
        `Move cancelled. ${quote(byId.get(d.id)?.text ?? "task")} was not moved.`,
      )
    }
    endDrag()
  }

  React.useLayoutEffect(() => {
    handlers.current = {
      move: onPointerMove,
      up: onPointerUp,
      cancel: onPointerCancel,
    }
  })

  React.useEffect(
    () => () => {
      const d = dragRef.current
      if (d?.active) document.body.style.userSelect = d.userSelect
      listeners.detach()
    },
    [listeners],
  )

  const onHandlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    id: string,
    group: GroupView,
  ) => {
    if (!group.reorderable || held || dragRef.current) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    const row = e.currentTarget.closest<HTMLElement>("[data-todo-row]")
    if (!row) return
    const rect = row.getBoundingClientRect()
    pointer.current = { x: e.clientX, y: e.clientY }
    dragRef.current = {
      id,
      group: group.key,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      active: false,
      userSelect: "",
    }
    listeners.attach()
  }

  /** Where the drop line goes while dragging. */
  let indicator: { id: string; edge: "before" | "after" } | null = null
  const dragGroup = drag ? groupOf(drag.group) : undefined
  if (
    drag &&
    dragGroup &&
    target !== null &&
    target !== dragGroup.ids.indexOf(drag.id)
  ) {
    const others = dragGroup.ids.filter((x) => x !== drag.id)
    if (target < others.length)
      indicator = { id: others[target], edge: "before" }
    else if (others.length > 0)
      indicator = { id: others[others.length - 1], edge: "after" }
  }

  // ---- Render ----
  const renderRow = (row: Row, group: GroupView | null) => {
    if (row.removed) {
      if (locked) return null
      return (
        <motion.li
          key={row.id}
          layout="position"
          data-slot="todo-list-deleted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={genuiMotion.fade}
          className="flex items-center gap-2 bg-transparent px-3 py-2.5 text-[13px] leading-4 text-muted-foreground"
        >
          <span className="min-w-0 flex-1 break-words">
            Deleted {quote(row.text)}
          </span>
          {canEdit && (
            <Button
              size="xs"
              variant="secondary"
              data-focus-key={`${row.id}:undo`}
              aria-label={`Undo deleting ${quote(row.text)}`}
              onClick={() => restore(row.id)}
            >
              Undo
            </Button>
          )}
        </motion.li>
      )
    }

    const name = quote(row.text)
    const display = dueDisplay(row.due, now, tz, locale)
    const bucket = dueBucket(row.due, now, tz)
    // In due groups, "Today" under the Today heading says nothing new.
    const showDue =
      display &&
      !(
        groupBy === "due" &&
        !row.done &&
        !display.time &&
        (bucket === "today" || bucket === "tomorrow")
      )
    const isNewRow = !baseIds.has(row.id)
    const isEdited = !isNewRow && edited.has(row.id)
    const reorderable = group?.reorderable === true && !row.done
    const isHeld = held?.id === row.id
    const editing = canEdit && editingId === row.id
    const optionsOpen = canEdit && optionsId === row.id
    const subtasks = row.subtasks ?? []
    const subDone = subtasks.filter((s) => s.done).length
    const hasDetails = subtasks.length > 0 || Boolean(row.notes)
    const detailsOpen = hasDetails && !collapsed.has(row.id)
    const detailsId = `${uid}-details-${row.id}`
    const optionsPanelId = `${uid}-options-${row.id}`
    const tags = (row.tags ?? []).filter(
      (t, i) => !(groupBy === "tag" && i === 0 && group?.label === t),
    )
    const priority = row.priority ? PRIORITY[row.priority] : null

    return (
      <motion.li
        key={row.id}
        layout="position"
        data-todo-row=""
        data-row-id={row.id}
        data-group={group?.key ?? "done"}
        data-done={row.done}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={genuiMotion.fade}
        className={cn(
          "group/row relative flex items-start gap-2 px-3 py-2.5",
          isNewRow && !locked
            ? "bg-muted/40 dark:bg-white/5"
            : "bg-(--surface-bg)",
          drag?.id === row.id && "opacity-40",
          isHeld && "z-10 ring-2 ring-ring ring-inset",
        )}
      >
        {indicator?.id === row.id && indicator.edge === "before" && (
          <DropLine edge="before" />
        )}

        {group?.reorderable && (
          <IconTip label={`Reorder ${name}`}>
            <button
              type="button"
              disabled={!reorderable || streaming}
              data-focus-key={`${row.id}:handle`}
              data-slot="todo-list-handle"
              aria-label={`Reorder ${name}`}
              aria-roledescription="draggable task"
              aria-describedby={`${uid}-reorder-help`}
              onKeyDown={(e) => onHandleKeyDown(e, row.id, group)}
              onBlur={(e) => onHandleBlur(e, row.id)}
              onPointerDown={(e) => onHandlePointerDown(e, row.id, group)}
              className={cn(
                "relative", genuiHit, "-ml-1.5 inline-flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50",
                row.done && "invisible",
              )}
            >
              <GripVerticalIcon aria-hidden className="size-4" />
            </button>
          </IconTip>
        )}

        <Checkbox
          nativeButton
          size="sm"
          data-focus-key={`${row.id}:check`}
          aria-label={`Done: ${row.text}`}
          checked={row.done}
          disabled={!canTick}
          onCheckedChange={(on) => toggleDone(row.id, Boolean(on))}
          // Larger tap area than the 18px box, without changing its look.
          className="relative mt-[3px] after:absolute after:-inset-2 [&[data-checked],&[data-indeterminate]]:bg-choice"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {editing ? (
            <EditField
              initial={row.text}
              label={`Edit task ${name}`}
              onSave={(text, refocus) => saveText(row.id, text, refocus)}
              onCancel={(refocus) => {
                setEditingId(null)
                if (refocus) setFocusKey(`${row.id}:edit`)
              }}
            />
          ) : (
            <motion.span
              animate={{ opacity: row.done ? 0.6 : 1 }}
              transition={{ duration: 0.2 }}
              className={cn(
                "text-[13px] leading-5 break-words",
                row.done &&
                  "text-muted-foreground line-through decoration-muted-foreground/60",
                canEdit && "cursor-text",
              )}
              // Mouse shortcut only; the Edit button is the keyboard path.
              onClick={canEdit ? () => startEdit(row.id) : undefined}
            >
              {row.text}
            </motion.span>
          )}

          {(priority ||
            showDue ||
            tags.length > 0 ||
            row.assignee ||
            hasDetails ||
            (!locked && (isNewRow || isEdited))) && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-x-3 gap-y-1",
                genuiType.meta,
              )}
            >
              {priority && (
                <span
                  className="inline-flex items-center text-foreground"
                  title={priority.label}
                >
                  <priority.Icon aria-hidden className="size-3.5" />
                  <span className="sr-only">{priority.label}</span>
                </span>
              )}
              {showDue && display && (
                <DueText display={display} done={row.done} />
              )}
              {tags.length > 0 && (
                <span>
                  <span className="sr-only">Tags: </span>
                  {tags.join(" · ")}
                </span>
              )}
              {row.assignee && (
                <span
                  title={row.assignee.name}
                  className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[13px] leading-4 font-medium text-foreground"
                >
                  <span aria-hidden>{row.assignee.initials}</span>
                  <span className="sr-only">
                    Assigned to {row.assignee.name}
                  </span>
                </span>
              )}
              {hasDetails && (
                <button
                  type="button"
                  aria-expanded={detailsOpen}
                  aria-controls={detailsId}
                  aria-label={`${detailsOpen ? "Hide" : "Show"} details for ${name}${subtasks.length ? `, ${subDone} of ${subtasks.length} subtasks done` : ""}`}
                  onClick={() =>
                    setCollapsed((s) => {
                      const next = new Set(s)
                      if (next.has(row.id)) next.delete(row.id)
                      else next.add(row.id)
                      return next
                    })
                  }
                  className="relative -mx-1 inline-flex h-5 items-center gap-1 rounded-md px-1 tabular-nums outline-none after:absolute after:-inset-y-1 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {subtasks.length > 0 && (
                    <>
                      <ListChecksIcon aria-hidden className="size-3.5" />
                      {subDone}/{subtasks.length}
                    </>
                  )}
                  {row.notes && (
                    <StickyNoteIcon aria-hidden className="size-3.5" />
                  )}
                  <ChevronRightIcon
                    aria-hidden
                    className={cn(
                      "size-3 transition-transform motion-reduce:transition-none",
                      detailsOpen && "rotate-90",
                    )}
                  />
                </button>
              )}
              {!locked && isNewRow && (
                <span className="inline-flex items-center gap-0.5 font-medium text-foreground">
                  <PlusIcon aria-hidden className="size-3" />
                  Added
                </span>
              )}
              {!locked && isEdited && <span>Edited</span>}
            </div>
          )}

          {detailsOpen && (
            <div id={detailsId} className="flex flex-col gap-2 pt-1">
              {row.notes && (
                <p
                  className={cn(
                    "break-words whitespace-pre-line",
                    genuiType.meta,
                  )}
                >
                  <span className="sr-only">Notes: </span>
                  {row.notes}
                </p>
              )}
              {subtasks.length > 0 && (
                <ul
                  aria-label={`Subtasks of ${name}`}
                  className="flex flex-col gap-2"
                >
                  {subtasks.map((s) => (
                    <li key={s.id}>
                      {/* The subtask's text toggles it too (it isn't editable). */}
                      {/* biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside renders the button and input */}
                      <label
                        className={cn(
                          "-mx-2 -my-1 flex items-start gap-2 rounded-lg px-2 py-1 transition-colors",
                          canTick
                            ? "cursor-pointer hover:bg-muted"
                            : "cursor-default",
                        )}
                      >
                        <Checkbox
                          nativeButton
                          size="sm"
                          aria-label={`Done: ${s.text} (subtask of ${row.text})`}
                          checked={s.done}
                          disabled={!canTick}
                          onCheckedChange={(on) =>
                            toggleSubtask(row.id, s.id, Boolean(on))
                          }
                          className="relative mt-px after:absolute after:-inset-1 [&[data-checked],&[data-indeterminate]]:bg-choice"
                        />
                        <span
                          className={cn(
                            "text-[13px] leading-4 break-words",
                            s.done &&
                              "text-muted-foreground line-through decoration-muted-foreground/60",
                          )}
                        >
                          {s.text}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {optionsOpen && (
            <fieldset
              id={optionsPanelId}
              aria-label={`Options for ${name}`}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation()
                  setOptionsId(null)
                  setFocusKey(`${row.id}:more`)
                }
              }}
              className="mt-1.5 flex flex-col gap-3 rounded-[10px] border border-border bg-transparent p-3.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <label
                  htmlFor={`${optionsPanelId}-due`}
                  className={cn(genuiType.label, "w-14")}
                >
                  Due
                </label>
                <DatePicker
                  id={`${optionsPanelId}-due`}
                  type="date"
                  aria-label={`Due date for ${name}`}
                  value={parseDue(row.due, tz)?.dayKey ?? ""}
                  onValueChange={(v) => setDue(row.id, v || undefined)}
                  className="w-auto bg-background"
                />
                {row.due && (
                  <Button
                    size="xs"
                    variant="secondary"
                    aria-label={`Remove the due date from ${name}`}
                    onClick={() => setDue(row.id, undefined)}
                  >
                    No date
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span aria-hidden className={cn(genuiType.label, "w-14")}>
                  Priority
                </span>
                <fieldset
                  aria-label={`Priority for ${name}`}
                  className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0"
                >
                  {(
                    [
                      [undefined, "None"],
                      ["high", "High"],
                      ["medium", "Medium"],
                      ["low", "Low"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={label}
                      size="xs"
                      variant="ghost"
                      aria-pressed={row.priority === value}
                      className={cn(
                        "h-8 px-3",
                        row.priority === value &&
                          "bg-background ring-2 ring-choice ring-inset hover:bg-background",
                      )}
                      onClick={() => setPriority(row.id, value)}
                    >
                      {value &&
                        (() => {
                          const Icon = PRIORITY[value].Icon
                          return <Icon aria-hidden />
                        })()}
                      {label}
                    </Button>
                  ))}
                </fieldset>
              </div>
              <div className="flex">
                <Button
                  size="xs"
                  variant="secondary"
                  className="-ml-1 text-destructive hover:text-destructive"
                  onClick={() => remove(row.id)}
                >
                  <Trash2Icon aria-hidden />
                  Delete task
                </Button>
              </div>
            </fieldset>
          )}
        </div>

        {canEdit && !editing && (
          // Quiet until the row is hovered or focused, where hover exists.
          <div
            className={cn(
              "-mr-1.5 flex shrink-0 items-center transition-opacity motion-reduce:transition-none",
              !optionsOpen &&
                "[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/row:opacity-100 [@media(hover:hover)]:group-hover/row:opacity-100",
            )}
          >
            <IconTip label={`Edit ${name}`}>
              <Button
                size="icon-sm"
                variant="ghost"
                data-focus-key={`${row.id}:edit`}
                aria-label={`Edit ${name}`}
                onClick={() => startEdit(row.id)}
              >
                <PencilIcon />
              </Button>
            </IconTip>
            <IconTip label={`More options for ${name}`}>
              <Button
                size="icon-sm"
                variant="ghost"
                data-focus-key={`${row.id}:more`}
                aria-label={`More options for ${name}`}
                aria-expanded={optionsOpen}
                aria-controls={optionsOpen ? optionsPanelId : undefined}
                onClick={() => {
                  setEditingId(null)
                  setOptionsId(optionsOpen ? null : row.id)
                }}
              >
                <EllipsisIcon />
              </Button>
            </IconTip>
          </div>
        )}

        {indicator?.id === row.id && indicator.edge === "after" && (
          <DropLine edge="after" />
        )}
      </motion.li>
    )
  }

  const dragRow = drag ? byId.get(drag.id) : undefined
  const showAdd = allowAdd && !(fromHistory && result)
  const showSuggestions =
    visibleSuggestions.length > 0 && allowAdd && !(fromHistory && result)
  const nothingLeft =
    !streaming && groups.every((g) => g.rows.every((r) => r.removed))

  const footerText = streaming ? (
    <ShimmeringText
      text="Loading the list…"
      color="var(--muted-foreground)"
      shimmeringColor="var(--foreground)"
    />
  ) : status === "saving" ? (
    "Saving…"
  ) : changeCount > 0 ? (
    <ChangeCount count={changeCount} />
  ) : savedCount !== null ? (
    <span className="inline-flex items-center gap-1.5 text-foreground">
      <CheckIcon aria-hidden className="size-3.5" />
      Saved · <ChangeCount count={savedCount} />
    </span>
  ) : (
    <span className="sr-only">No changes</span>
  )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        ref={rootRef}
        data-slot="todo-list"
        data-status={status}
        aria-busy={streaming || status === "saving"}
        aria-label={listName}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
          {/* The rows show the counts; the Save button names the source. */}
          {live.length > 0 && <p className="sr-only">{countsText(counts)}</p>}
        </SurfaceHeader>

        <p id={`${uid}-reorder-help`} className="sr-only">
          Press Space or Enter to pick up this task. Then use the up and down
          arrow keys to move it within its group, Space or Enter to drop it, or
          Escape to cancel.
        </p>
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {message}
        </p>
        <p className="sr-only" aria-live="assertive" aria-atomic="true">
          {moveMessage}
        </p>

        {showAdd && (
          <form
            className="flex flex-col gap-2 border-t border-border px-3 py-3"
            onSubmit={(e) => {
              e.preventDefault()
              submitDraft()
            }}
          >
            <div className="flex items-center gap-2">
              <Input
                data-focus-key="add"
                aria-label={`Add a task to ${listName}`}
                aria-describedby={`${uid}-add-hint`}
                placeholder="Add a task"
                value={draft}
                disabled={locked}
                onChange={(e) => {
                  setDraft(e.target.value)
                  if (!e.target.value) setSkip({ due: false, priority: false })
                }}
                className="h-9"
              />
              <WhyDisabled
                when={!locked && !parsed.text}
                reason="Type a task first"
              >
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={locked || !parsed.text}
                >
                  <PlusIcon aria-hidden />
                  Add
                </Button>
              </WhyDisabled>
            </div>
            <p id={`${uid}-add-hint`} className="sr-only">
              You can type a day like tomorrow or friday, and !high or !low for
              priority.
            </p>
            {(parsedDue || parsed.priority) && (
              <div
                aria-live="polite"
                className="flex flex-wrap items-center gap-2 text-[13px] leading-4"
              >
                {parsedDue && parsed.due && (
                  <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-transparent pr-1 pl-2.5">
                    <CalendarIcon
                      aria-hidden
                      className="size-3.5 text-muted-foreground"
                    />
                    <span>{parsedDue.long}</span>
                    <span className="text-muted-foreground">
                      from {quote(parsed.dueSource ?? "")}
                    </span>
                    <button
                      type="button"
                      aria-label={`Don't set a due date; keep ${quote(parsed.dueSource ?? "")} in the text`}
                      onClick={() => setSkip((s) => ({ ...s, due: true }))}
                      className="relative inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none after:absolute after:-inset-0.5 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <XIcon aria-hidden className="size-3" />
                    </button>
                  </span>
                )}
                {parsed.priority && (
                  <span className="inline-flex h-7 items-center gap-1 rounded-full border border-border bg-transparent pr-1 pl-2.5">
                    {(() => {
                      const Icon = PRIORITY[parsed.priority].Icon
                      return <Icon aria-hidden className="size-3.5" />
                    })()}
                    <span>{PRIORITY[parsed.priority].label}</span>
                    <button
                      type="button"
                      aria-label={`Don't set a priority; keep ${quote(parsed.prioritySource ?? "")} in the text`}
                      onClick={() => setSkip((s) => ({ ...s, priority: true }))}
                      className="relative inline-flex size-5 items-center justify-center rounded-full text-muted-foreground outline-none after:absolute after:-inset-0.5 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <XIcon aria-hidden className="size-3" />
                    </button>
                  </span>
                )}
              </div>
            )}
          </form>
        )}

        <AutoHeight>
          <ScrollFade
            className="border-t border-border"
            viewportClassName="overflow-y-auto py-2"
          >
            <LayoutGroup id={uid}>
              {groups.map((group, gi) => {
                const headingId = `${uid}-group-${gi}`
                const liveCount = group.rows.filter((r) => !r.removed).length
                return (
                  <div key={group.key} className={cn(gi > 0 && "pt-2")}>
                    {showHeadings && (
                      <h4
                        id={headingId}
                        className={cn("px-3 pt-2 pb-0.5", genuiType.label)}
                      >
                        {group.label}
                        <span className="sr-only">, {liveCount}</span>
                      </h4>
                    )}
                    <ul
                      aria-labelledby={showHeadings ? headingId : undefined}
                      aria-label={
                        showHeadings ? undefined : `${listName}: tasks`
                      }
                      className="flex flex-col"
                    >
                      <AnimatePresence initial={false}>
                        {group.rows.map((row) => renderRow(row, group))}
                      </AnimatePresence>
                    </ul>
                  </div>
                )
              })}

              {streaming && (
                <div aria-hidden className="flex gap-3 px-3 py-2.5">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-4 flex-1" />
                </div>
              )}

              {nothingLeft && (
                <p className="px-3 py-3 text-[13px] leading-5 text-muted-foreground">
                  {doneLive > 0 ? "Nothing left to do." : "No tasks yet."}
                </p>
              )}

              {!hideDone && doneRows.length > 0 && (
                <div className="pt-1">
                  <button
                    type="button"
                    data-focus-key="done-toggle"
                    aria-expanded={doneOpen}
                    aria-controls={`${uid}-done`}
                    onClick={() => setDoneOpen((o) => !o)}
                    className="flex min-h-8 w-full items-center gap-1.5 px-3 py-1.5 text-left text-[13px] leading-4 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={cn(
                        "size-3.5 transition-transform motion-reduce:transition-none",
                        doneOpen && "rotate-90",
                      )}
                    />
                    Done ({doneLive})
                  </button>
                  {doneOpen && (
                    <ul
                      id={`${uid}-done`}
                      aria-label={`${listName}: done`}
                      className="flex flex-col"
                    >
                      <AnimatePresence initial={false}>
                        {doneRows.map((row) => renderRow(row, null))}
                      </AnimatePresence>
                    </ul>
                  )}
                </div>
              )}
            </LayoutGroup>
          </ScrollFade>

          {showSuggestions && (
            <section
              aria-labelledby={`${uid}-suggested`}
              className="flex flex-col gap-0.5 border-t border-border px-3 py-3"
            >
              <h4 id={`${uid}-suggested`} className={genuiType.label}>
                Suggested
              </h4>
              <ul className="flex flex-col">
                <AnimatePresence initial={false}>
                  {visibleSuggestions.map((s) => {
                    const display = dueDisplay(s.due, now, tz, locale)
                    return (
                      <motion.li
                        key={s.text}
                        layout="position"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={genuiMotion.fade}
                        className="flex items-center gap-3 py-1.5"
                      >
                        <div
                          className="flex min-w-0 flex-1 flex-col gap-0.5"
                          title={s.reason}
                        >
                          <span className="text-[13px] leading-5 break-words">
                            {s.text}
                          </span>
                          {display && (
                            <DueText display={display} done={false} />
                          )}
                          {s.reason && (
                            <span className="sr-only">. {s.reason}</span>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={locked}
                            data-focus-key={`suggestion:${s.text}`}
                            aria-label={`Add ${quote(s.text)}`}
                            onClick={() => acceptSuggestion(s)}
                          >
                            <PlusIcon aria-hidden />
                            Add
                          </Button>
                          <IconTip label="Dismiss">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              disabled={locked}
                              aria-label={`Dismiss ${quote(s.text)}`}
                              onClick={() => dismissSuggestion(s)}
                            >
                              <XIcon aria-hidden />
                            </Button>
                          </IconTip>
                        </div>
                      </motion.li>
                    )
                  })}
                </AnimatePresence>
              </ul>
            </section>
          )}
        </AutoHeight>

        <SurfaceFooter aria-live="polite" className="justify-between">
          {status === "saved" ? (
            <p className="flex items-center gap-1.5 text-[13px] leading-5">
              <CheckIcon aria-hidden className="size-4" />
              {changeCount > 0
                ? `Saved · ${pluralize(changeCount, "change")}`
                : "Saved"}
            </p>
          ) : status === "discarded" ? (
            <p className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <XIcon aria-hidden className="size-4" />
              Changes discarded
            </p>
          ) : (
            <>
              <p className={cn("tabular-nums", genuiType.meta)}>{footerText}</p>
              <div className="ml-auto flex flex-wrap gap-2">
                <WhyDisabled
                  when={!locked && changeCount === 0 && !hasTombstones}
                  reason="No changes to discard"
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={locked || (changeCount === 0 && !hasTombstones)}
                    onClick={discard}
                  >
                    Discard<span className="sr-only"> changes</span>
                  </Button>
                </WhyDisabled>
                <WhyDisabled
                  when={!locked && changeCount === 0}
                  reason="No changes to save"
                >
                  <Button
                    size="sm"
                    disabled={locked || changeCount === 0}
                    onClick={save}
                  >
                    {status === "saving" ? "Saving…" : saveLabel}
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>

      {drag &&
        dragRow &&
        typeof document !== "undefined" &&
        createPortal(
          <MotionConfig reducedMotion="user">
            <motion.div
              aria-hidden
              data-slot="todo-list-drag-preview"
              style={{ x: overlayX, y: overlayY, width: drag.width }}
              className="pointer-events-none fixed top-0 left-0 z-[100] cursor-grabbing"
            >
              <motion.div
                initial={{ scale: 1 }}
                animate={{ scale: 1.02 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex items-start gap-2 rounded-[10px] border bg-card px-3 py-3 text-card-foreground shadow-lg dark:shadow-none"
              >
                <GripVerticalIcon className="-ml-1.5 size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
                <span className="text-[13px] leading-5 break-words">
                  {dragRow.text}
                </span>
              </motion.div>
            </motion.div>
          </MotionConfig>,
          document.body,
        )}
    </MotionConfig>
  )
}
