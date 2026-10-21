"use client"

import * as React from "react"
import {
  AlignLeftIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  HashIcon,
  LayoutGridIcon,
  LinkIcon,
  PlusIcon,
  Redo2Icon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { DatePicker } from "@/components/genui/date-picker"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { LogoTile } from "@/components/genui/logo-tile"
import { ScrollFade } from "@/components/genui/scroll-fade"
import { SERIES_TAG, SERIES_VARS } from "@/components/genui/series-colors"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  type SurfaceVariant,
} from "@/components/genui/surface"

import {
  type TableRow,
  applyResult,
  cellAddress,
  changeCount,
  describeChanges,
  diffRows,
  editText,
  formatValue,
  homeEndCell,
  isEmpty,
  optionTone,
  PAGE_ROWS,
  parseInput,
  sortRows,
  stepCell,
} from "./editable-table-utils"
import type {
  EditableCell,
  EditableColumn,
  EditableRow,
  EditableTableInput,
  EditableTableResult,
} from "./editable-table.schema"

export type EditableTableStatus = "streaming" | "ready" | "submitted"

type PartialColumn = Partial<Omit<EditableColumn, "type" | "sortable">> & {
  type?: EditableColumn["type"]
  sortable?: boolean
}
type ReadyColumn = PartialColumn & { key: string; label: string }

export type EditableTableProps = Partial<
  Omit<EditableTableInput, "columns" | "rows">
> & {
  /** Columns and rows may be partial while the tool call streams. */
  columns?: PartialColumn[]
  rows?: Partial<EditableRow>[]
  /**
   * Lifecycle, controlled by the host. Editing waits for the full payload.
   * When omitted, the component tracks the user's save itself.
   */
  status?: EditableTableStatus
  /** Called once when the user saves. */
  onResult?: (result: EditableTableResult) => void
  /** A save from history. Renders the saved table, locked; never calls onResult. */
  result?: EditableTableResult
  /** Defaults to "card". */
  surface?: SurfaceVariant
  className?: string
}

type Pos = { row: string; col: string }
type Editing = Pos & { draft: string; error?: string }

const TYPE_ICON = {
  text: AlignLeftIcon,
  number: HashIcon,
  select: LayoutGridIcon,
  url: LinkIcon,
  date: CalendarIcon,
} as const

const COPY = {
  hint: "Click a cell twice to edit",
  keys: "Arrow keys move between cells. Enter or typing edits a cell, Escape cancels an edit or, on a selected cell, clears the selection, Delete clears the value.",
}

/** A select value as a tag: its option's series colour, or blue past the fifth (D43). */
function Tag({ value, col }: { value: string; col: PartialColumn }) {
  const tone = optionTone(value, { key: col.key ?? "", ...col })
  return (
    <Badge
      variant="info"
      className={tone === null ? undefined : SERIES_TAG[tone]}
    >
      {value}
    </Badge>
  )
}

/** One cell's value, read-only. */
function CellView({
  value,
  col,
  locked,
}: {
  value: EditableCell | undefined
  col: PartialColumn
  locked: boolean
}) {
  const locale = useGenUILocale()
  if (isEmpty(value)) return <span className="sr-only">Empty</span>
  const text = formatValue(value, { key: col.key ?? "", ...col }, locale)
  if (col.type === "select") return <Tag value={text} col={col} />
  if (col.type === "url") {
    const cls =
      "underline decoration-foreground/25 underline-offset-4 hover:decoration-foreground"
    // A link only once saved: while editing, a click picks the cell.
    return locked ? (
      <a
        href={
          /^https?:/i.test(String(value)) ? String(value) : `https://${value}`
        }
        target="_blank"
        rel="noopener noreferrer"
        className={cls}
      >
        {text}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      <span className={cls}>{text}</span>
    )
  }
  return <>{text}</>
}

/** Text, number and URL cells edit in a plain input laid over the cell. */
function TextEditor({
  col,
  label,
  editing,
  onDraft,
  onCommit,
  onCancel,
}: {
  col: ReadyColumn
  label: string
  editing: Editing
  onDraft: (draft: string) => void
  onCommit: (move?: "down" | "right" | "left") => boolean
  onCancel: () => void
}) {
  // Enter, Tab and Escape close the editor; the blur that follows must not commit again.
  const done = React.useRef(false)
  const close = (fn: () => unknown) => {
    if (done.current) return
    done.current = true
    // A rejected value keeps the editor open for another try.
    if (fn() === false) done.current = false
  }
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the user just opened this cell
      autoFocus
      aria-label={label}
      aria-invalid={editing.error ? true : undefined}
      inputMode={
        col.type === "number" ? "decimal" : col.type === "url" ? "url" : "text"
      }
      value={editing.draft}
      onChange={(e) => onDraft(e.target.value)}
      onFocus={(e) => {
        // Typing into a cell replaces it; Enter or a double-click keeps it.
        const end = e.target.value.length
        e.target.setSelectionRange(end, end)
      }}
      onBlur={() => close(onCommit)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault()
          close(() => onCommit("down"))
        } else if (e.key === "Tab") {
          e.preventDefault()
          close(() => onCommit(e.shiftKey ? "left" : "right"))
        } else if (e.key === "Escape") {
          e.preventDefault()
          close(onCancel)
        }
        e.stopPropagation()
      }}
      className={cn(
        "absolute inset-0 w-full min-w-0 bg-(--surface-bg) px-3 text-[13px] outline-none",
        "ring-2 ring-choice ring-inset aria-invalid:ring-destructive",
        col.type === "number" && "text-right tabular-nums",
      )}
    />
  )
}

/** Select cells open their options at once; picking one saves it. */
function SelectEditor({
  col,
  label,
  value,
  onPick,
  onClose,
}: {
  col: ReadyColumn
  label: string
  value: EditableCell | undefined
  onPick: (value: string) => void
  onClose: () => void
}) {
  const current = isEmpty(value) ? null : String(value)
  return (
    <Select
      defaultOpen
      value={current}
      onValueChange={(v) => {
        if (typeof v === "string") onPick(v)
      }}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SelectTrigger
        aria-label={label}
        className="absolute inset-0 h-full! w-full rounded-none border-0 bg-(--surface-bg) px-3 ring-2 ring-choice ring-inset hover:bg-(--surface-bg) dark:hover:bg-(--surface-bg)"
      >
        {current ? (
          <Tag value={current} col={col} />
        ) : (
          <span className="text-muted-foreground">Pick one</span>
        )}
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {(col.options ?? []).map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Date cells open the shared date picker at once. */
function DateEditor({
  label,
  value,
  onPick,
  onClose,
}: {
  label: string
  value: EditableCell | undefined
  onPick: (value: string) => void
  onClose: () => void
}) {
  return (
    <DatePicker
      // Opening the editor opens the calendar: one gesture, not two.
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      aria-label={label}
      value={isEmpty(value) ? "" : String(value)}
      onValueChange={onPick}
      className="absolute inset-0 h-full rounded-none border-0 bg-(--surface-bg) ring-2 ring-choice ring-inset hover:bg-(--surface-bg) dark:hover:bg-(--surface-bg)"
    />
  )
}

export function EditableTable({
  title,
  description,
  columns = [],
  rows = [],
  allowAdd = true,
  allowDelete = true,
  sort: initialSort,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  surface,
  className,
}: EditableTableProps) {
  const locale = useGenUILocale()
  const titleId = React.useId()
  const keysId = React.useId()
  const tableRef = React.useRef<HTMLTableElement>(null)
  const nextId = React.useRef(1)
  const focusPending = React.useRef(false)
  // When a picker last closed: the click that closed it mustn't reopen it.
  const pickerClosedAt = React.useRef(0)
  // Set by a click outside the cells while an editor is open: once the editor
  // closes (and saves), the cell is let go instead of selected again.
  const dismissing = React.useRef(false)

  const [sort, setSort] = React.useState(initialSort)
  // null until the first edit: the table follows the agent's rows until then.
  const [edited, setEdited] = React.useState<TableRow[] | null>(null)
  const [past, setPast] = React.useState<TableRow[][]>([])
  const [future, setFuture] = React.useState<TableRow[][]>([])
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set())
  const [active, setActive] = React.useState<Pos | null>(null)
  const [editing, setEditing] = React.useState<Editing | null>(null)
  const [announce, setAnnounce] = React.useState("")
  const [savedNow, setSaved] = React.useState<EditableTableResult | null>(null)

  const saved = savedNow ?? result ?? null
  // A host-provided "ready" (or nothing) yields to the user's save.
  const status: EditableTableStatus =
    saved && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status === "submitted"
  const canEdit = !streaming && !locked

  const cols = columns.filter(
    (c): c is ReadyColumn =>
      typeof c.key === "string" && typeof c.label === "string",
  )
  const keys = cols.map((c) => c.key)
  const base = React.useMemo(
    () =>
      rows.flatMap((r) =>
        typeof r.id === "string" ? [{ id: r.id, cells: r.cells ?? {} }] : [],
      ),
    [rows],
  )
  const loading = rows.filter((r) => typeof r.id === "string" && !r.cells)
  // Logos are the agent's data, not cells: they follow the row's id.
  const logos = new Map(
    rows.flatMap((r) =>
      typeof r.id === "string" && r.logo?.url ? [[r.id, r.logo]] : [],
    ),
  )
  const current: TableRow[] =
    !savedNow && result ? applyResult(base, result) : (edited ?? base)
  const visible = sortRows(current, sort, locale)
  const diff = diffRows(base, current, keys)
  const changes = changeCount(diff)

  const rowIndex = (id: string) => visible.findIndex((r) => r.id === id)
  const colIndex = (key: string) => keys.indexOf(key)
  const nameOf = (row: TableRow) =>
    formatValue(row.cells[keys[0]], cols[0] ?? { key: "" }, locale) ||
    `Row ${rowIndex(row.id) + 1}`
  const cellLabel = (row: TableRow, col: ReadyColumn) =>
    `${col.label}, ${nameOf(row)}`

  // Focus follows the active cell once the user is working in the grid.
  React.useEffect(() => {
    if (!focusPending.current || editing || !active) return
    focusPending.current = false
    tableRef.current
      ?.querySelector<HTMLElement>(
        `[data-row="${CSS.escape(active.row)}"][data-col="${CSS.escape(active.col)}"]`,
      )
      ?.focus()
  })

  const commitRows = (next: TableRow[], message: string) => {
    setPast((p) => [...p, current])
    setFuture([])
    setEdited(next)
    setAnnounce(message)
  }

  const go = (pos: Pos | null) => {
    if (dismissing.current) {
      dismissing.current = false
      setActive(null)
      return
    }
    focusPending.current = true
    setActive(pos)
  }

  // A click anywhere but a cell (the page, the header, the footer) lets the
  // selected cell go. Clicks in a cell's own picker popup don't count. An open
  // editor saves first: its blur, or its popup closing, ends in go().
  React.useEffect(() => {
    if (!active) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      const cell = target?.closest('[role="gridcell"]')
      const inTable = Boolean(cell && tableRef.current?.contains(cell))
      // A rejected value holds its cell for one click, so the user sees why.
      // The next click anywhere else drops it; the cell keeps its old value.
      if (
        editing?.error &&
        !(
          cell?.getAttribute("data-row") === editing.row &&
          cell?.getAttribute("data-col") === editing.col
        )
      ) {
        setEditing(null)
        setAnnounce("Edit discarded.")
        if (!inTable) setActive(null)
        return
      }
      if (inTable) return
      if (
        target?.closest(
          '[data-slot="select-content"], [data-slot="date-picker-popup"]',
        )
      )
        return
      if (editing) dismissing.current = true
      else setActive(null)
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true)
  }, [active, editing])

  // Arrows, and Tab while editing; left and right wrap across rows.
  const moveBy = (from: Pos, dr: number, dc: number) => {
    const [r, c] = stepCell(
      rowIndex(from.row),
      colIndex(from.col),
      dr,
      dc,
      visible.length,
      keys.length,
    )
    if (visible[r]) go({ row: visible[r].id, col: keys[c] })
  }

  const startEdit = (pos: Pos, draft?: string) => {
    const col = cols[colIndex(pos.col)]
    const row = current.find((r) => r.id === pos.row)
    if (!canEdit || !col || !row || col.readOnly) return
    setActive(pos)
    setEditing({ ...pos, draft: draft ?? editText(row.cells[pos.col]) })
  }

  const setCell = (pos: Pos, value: EditableCell) => {
    const row = current.find((r) => r.id === pos.row)
    const col = cols[colIndex(pos.col)]
    if (!row || !col || row.cells[pos.col] === value) return
    if (isEmpty(row.cells[pos.col]) && isEmpty(value)) return
    commitRows(
      current.map((r) =>
        r.id === pos.row
          ? { ...r, cells: { ...r.cells, [pos.col]: value } }
          : r,
      ),
      isEmpty(value)
        ? `${cellLabel(row, col)} cleared.`
        : `${cellLabel(row, col)} set to ${formatValue(value, col, locale)}.`,
    )
  }

  /** Saves the open editor's value; false when it was rejected. */
  const finishEdit = (move?: "down" | "right" | "left"): boolean => {
    if (!editing) return true
    const col = cols[colIndex(editing.col)]
    if (!col) {
      setEditing(null)
      return true
    }
    const parsed = parseInput(editing.draft, col)
    if (!parsed.ok) {
      // A rejected value keeps its cell selected, whatever was clicked.
      dismissing.current = false
      setEditing({ ...editing, error: parsed.error })
      setAnnounce(parsed.error)
      return false
    }
    setCell(editing, parsed.value)
    setEditing(null)
    const pos = { row: editing.row, col: editing.col }
    if (move === "down") moveBy(pos, 1, 0)
    else if (move === "right") moveBy(pos, 0, 1)
    else if (move === "left") moveBy(pos, 0, -1)
    else go(pos)
    return true
  }

  const cancelEdit = () => {
    if (!editing) return
    setEditing(null)
    go({ row: editing.row, col: editing.col })
  }

  const undo = () => {
    const prev = past.at(-1)
    if (!prev) return
    setPast(past.slice(0, -1))
    setFuture([current, ...future])
    setEdited(prev)
    setEditing(null)
    setAnnounce("Undone.")
  }
  const redo = () => {
    const [next, ...rest] = future
    if (!next) return
    setFuture(rest)
    setPast([...past, current])
    setEdited(next)
    setEditing(null)
    setAnnounce("Redone.")
  }

  const addRow = () => {
    const id = `new-${nextId.current++}`
    commitRows([...current, { id, cells: {}, isNew: true }], "Row added.")
    // Sorting would hide the empty row at the end; show it where it was added.
    setSort(undefined)
    const first = cols.find((c) => !c.readOnly)
    if (first) {
      setActive({ row: id, col: first.key })
      setEditing({ row: id, col: first.key, draft: "" })
    }
  }

  const deleteSelected = () => {
    const n = selected.size
    commitRows(
      current.filter((r) => !selected.has(r.id)),
      `${n} ${n === 1 ? "row" : "rows"} deleted.`,
    )
    setSelected(new Set())
    setActive(null)
    setEditing(null)
  }

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev)
      for (const id of ids) on ? next.add(id) : next.delete(id)
      return next
    })

  // First click ascending, then descending, then the agent's order.
  const toggleSort = (key: string) =>
    setSort((s) =>
      s?.key !== key
        ? { key, direction: "asc" }
        : s.direction === "asc"
          ? { key, direction: "desc" }
          : undefined,
    )

  const save = () => {
    setEditing(null)
    setActive(null)
    setSaved(diff)
    onResult?.(diff)
  }

  const onCellKey = (e: React.KeyboardEvent<HTMLElement>, pos: Pos) => {
    if (editing) return
    // Escape lets the selected cell go, like a click outside the cells. An
    // open editor or picker took the first Escape (it cancels); this is the next.
    if (e.key === "Escape" && active) {
      e.preventDefault()
      setActive(null)
      setAnnounce("Selection cleared.")
      e.currentTarget.blur()
      return
    }
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageUp: [-PAGE_ROWS, 0],
      PageDown: [PAGE_ROWS, 0],
    }
    if (step[e.key]) {
      e.preventDefault()
      moveBy(pos, ...step[e.key])
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault()
      const [r, c] = homeEndCell(
        rowIndex(pos.row),
        colIndex(pos.col),
        e.key,
        e.ctrlKey || e.metaKey,
        visible.length,
        keys.length,
      )
      if (visible[r]) go({ row: visible[r].id, col: keys[c] })
    } else if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault()
      startEdit(pos)
    } else if ((e.key === "Backspace" || e.key === "Delete") && canEdit) {
      e.preventDefault()
      if (!cols[colIndex(pos.col)]?.readOnly) setCell(pos, null)
    } else if (
      e.key.length === 1 &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      e.key !== " "
    ) {
      const type = cols[colIndex(pos.col)]?.type
      // Typing replaces a text cell; pickers just open.
      if (type === "select" || type === "date") {
        e.preventDefault()
        startEdit(pos)
      } else if (canEdit && !cols[colIndex(pos.col)]?.readOnly) {
        e.preventDefault()
        startEdit(pos, e.key)
      }
    }
  }

  const selectable = allowDelete
  const selectedCount = current.filter((r) => selected.has(r.id)).length
  const allSelected = selectedCount > 0 && selectedCount === current.length
  const activeAt =
    active && rowIndex(active.row) >= 0 && colIndex(active.col) >= 0
      ? cellAddress(colIndex(active.col), rowIndex(active.row))
      : null
  // Tab enters the grid at the active cell, else the first one.
  const tabStop = activeAt
    ? active
    : visible[0] && keys[0]
      ? { row: visible[0].id, col: keys[0] }
      : null
  const colSpan = Math.max(cols.length, 1) + (selectable ? 1 : 0)
  const sticky = "sticky z-[1] bg-(--row-bg,var(--surface-bg))"
  const tapArea = "relative after:absolute after:-inset-2"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        variant={surface ?? "card"}
        data-slot="editable-table"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={titleId}
        className={cn(SERIES_VARS, className)}
        onKeyDown={(e) => {
          // Undo and redo for the table, unless an input handles its own.
          if (!canEdit || !(e.metaKey || e.ctrlKey)) return
          if ((e.target as HTMLElement).closest("input, textarea")) return
          const k = e.key.toLowerCase()
          if (k === "z" && !e.shiftKey) {
            e.preventDefault()
            undo()
          } else if ((k === "z" && e.shiftKey) || k === "y") {
            e.preventDefault()
            redo()
          }
        }}
      >
        <SurfaceHeader className="flex-row items-start justify-between gap-3 pb-3">
          <div className="flex min-w-0 flex-col gap-1">
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            {description && (
              <SurfaceDescription>{description}</SurfaceDescription>
            )}
          </div>
          {!locked && (
            <div className="-my-1 flex shrink-0 gap-1">
              {(
                [
                  ["Undo", Undo2Icon, undo, past.length === 0],
                  ["Redo", Redo2Icon, redo, future.length === 0],
                ] as const
              ).map(([label, Icon, run, empty]) => {
                const button = (
                  <Button
                    key={label}
                    size="icon-sm"
                    variant="ghost"
                    aria-label={label}
                    disabled={!canEdit || empty}
                    onClick={run}
                    className="dark:hover:bg-white/10"
                  >
                    <Icon aria-hidden />
                  </Button>
                )
                return !canEdit || empty ? (
                  <WhyDisabled
                    key={label}
                    reason={`Nothing to ${label.toLowerCase()}`}
                  >
                    {button}
                  </WhyDisabled>
                ) : (
                  <IconTip key={label} label={label}>
                    {button}
                  </IconTip>
                )
              })}
            </div>
          )}
        </SurfaceHeader>

        <ScrollFade className="border-t border-border [--scroller-bg:var(--surface-bg)]">
          <span id={keysId} className="sr-only">
            {COPY.keys}
          </span>
          <p aria-live="polite" className="sr-only">
            {announce}
          </p>
          <table
            ref={tableRef}
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an editable table is an ARIA grid
            role="grid"
            aria-labelledby={titleId}
            aria-describedby={canEdit ? keysId : undefined}
            aria-readonly={!canEdit || undefined}
            aria-rowcount={visible.length + 1}
            className="w-full border-collapse text-[13px]"
          >
            <thead>
              <tr className="border-b">
                {selectable && (
                  <th
                    scope="col"
                    data-sticky-start
                    className={cn(
                      sticky,
                      "left-0 z-[2] w-11 border-r py-2.5 pl-3",
                    )}
                  >
                    <Checkbox
                      nativeButton
                      size="sm"
                      aria-label={
                        allSelected ? "Deselect all rows" : "Select all rows"
                      }
                      checked={allSelected}
                      indeterminate={selectedCount > 0 && !allSelected}
                      disabled={!canEdit || current.length === 0}
                      className={tapArea}
                      onCheckedChange={(on) =>
                        toggle(
                          current.map((r) => r.id),
                          Boolean(on),
                        )
                      }
                    />
                  </th>
                )}
                {cols.map((col, i) => {
                  const Icon = TYPE_ICON[col.type ?? "text"]
                  const sorted = sort?.key === col.key
                  const Arrow =
                    sort?.direction === "desc" ? ArrowDownIcon : ArrowUpIcon
                  return (
                    <th
                      key={col.key}
                      scope="col"
                      data-sticky-start={i === 0 || undefined}
                      aria-sort={
                        sorted
                          ? sort.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : undefined
                      }
                      className={cn(
                        "border-r px-3 py-2.5 text-left whitespace-nowrap last:border-r-0",
                        genuiType.label,
                        i === 0 &&
                          cn(sticky, selectable ? "left-11" : "left-0"),
                        active?.col === col.key &&
                          "bg-[color-mix(in_oklab,var(--foreground)_4%,var(--surface-bg))]",
                      )}
                    >
                      {col.sortable !== false && !streaming ? (
                        <button
                          type="button"
                          onClick={() => toggleSort(col.key)}
                          className={cn(
                            "relative -mx-1.5 inline-flex w-[calc(100%+0.75rem)] items-center gap-1.5 rounded-md px-1.5 outline-none after:absolute after:-inset-y-2.5 after:inset-x-0 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                            sorted && "text-foreground",
                          )}
                        >
                          <Icon aria-hidden className="size-3.5 shrink-0" />
                          {col.label}
                          {sorted && (
                            <Arrow
                              aria-hidden
                              className="ml-auto size-3.5 text-choice"
                            />
                          )}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1.5">
                          <Icon aria-hidden className="size-3.5 shrink-0" />
                          {col.label}
                        </span>
                      )}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {visible.map((row, ri) => {
                const isSel = selected.has(row.id)
                return (
                  <motion.tr
                    key={row.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.2 }}
                    aria-rowindex={ri + 2}
                    aria-selected={selectable ? isSel : undefined}
                    // Solid tint, so the sticky cells cover what scrolls under them.
                    style={
                      {
                        "--row-bg": isSel
                          ? "color-mix(in oklab, var(--foreground) 6%, var(--surface-bg))"
                          : "var(--surface-bg)",
                      } as React.CSSProperties
                    }
                    className="border-b bg-(--row-bg) last:border-b-0"
                  >
                    {selectable && (
                      <td
                        className={cn(
                          sticky,
                          "left-0 z-[2] w-11 border-r pl-3",
                        )}
                      >
                        <Checkbox
                          nativeButton
                          size="sm"
                          aria-label={`Select ${nameOf(row)}`}
                          checked={isSel}
                          disabled={!canEdit}
                          className={tapArea}
                          onCheckedChange={(on) =>
                            toggle([row.id], Boolean(on))
                          }
                        />
                      </td>
                    )}
                    {cols.map((col, ci) => {
                      const pos = { row: row.id, col: col.key }
                      const isActive =
                        active?.row === row.id && active.col === col.key
                      const isEditing =
                        editing?.row === row.id && editing.col === col.key
                      const isStop =
                        tabStop?.row === row.id && tabStop.col === col.key
                      const value = row.cells[col.key]
                      const label = cellLabel(row, col)
                      // A selected cell edits on the next single click. Select
                      // and date cells open a picker, so a selected one shows
                      // a chevron.
                      const picker =
                        canEdit &&
                        !col.readOnly &&
                        (col.type === "select" || col.type === "date")
                      const closePicker = () => {
                        pickerClosedAt.current = Date.now()
                        setEditing(null)
                        go(pos)
                      }
                      return (
                        <td
                          key={col.key}
                          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: cells of an ARIA grid
                          role="gridcell"
                          data-row={row.id}
                          data-col={col.key}
                          tabIndex={isEditing ? undefined : isStop ? 0 : -1}
                          aria-selected={isActive}
                          aria-readonly={!canEdit || col.readOnly || undefined}
                          aria-haspopup={
                            picker
                              ? col.type === "select"
                                ? "listbox"
                                : "dialog"
                              : undefined
                          }
                          onClick={(e) => {
                            // Clicks inside a picker's popup reach the cell
                            // through the React tree; only the cell's own count.
                            if (!e.currentTarget.contains(e.target as Node))
                              return
                            if (isEditing) return
                            // A value the editor rejects keeps it open.
                            if (editing && !finishEdit()) return
                            if (
                              isActive &&
                              canEdit &&
                              !col.readOnly &&
                              Date.now() - pickerClosedAt.current > 300
                            )
                              startEdit(pos)
                            else go(pos)
                          }}
                          onDoubleClick={() => startEdit(pos)}
                          onKeyDown={(e) => onCellKey(e, pos)}
                          className={cn(
                            "relative h-11 border-r px-3 py-2 whitespace-nowrap outline-none last:border-r-0",
                            ci === 0 &&
                              cn(
                                sticky,
                                "min-w-36 font-medium",
                                selectable ? "left-11" : "left-0",
                              ),
                            col.type === "number" && "text-right tabular-nums",
                            picker && "pr-9",
                            col.readOnly
                              ? "text-muted-foreground"
                              : canEdit && "cursor-cell",
                            isActive &&
                              !isEditing &&
                              "ring-2 ring-choice ring-inset",
                          )}
                        >
                          {ci === 0 && logos.has(row.id) ? (
                            <span className="flex items-center gap-2">
                              <LogoTile
                                size={20}
                                src={logos.get(row.id)?.url}
                                darkSrc={logos.get(row.id)?.darkUrl}
                              />
                              <CellView
                                value={value}
                                col={col}
                                locked={locked}
                              />
                            </span>
                          ) : (
                            <CellView value={value} col={col} locked={locked} />
                          )}
                          {picker && isActive && !isEditing && (
                            <ChevronDownIcon
                              aria-hidden
                              className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-muted-foreground"
                            />
                          )}
                          {isEditing &&
                            (col.type === "select" ? (
                              <SelectEditor
                                col={col}
                                label={label}
                                value={value}
                                onPick={(v) => {
                                  setCell(pos, v)
                                  closePicker()
                                }}
                                onClose={closePicker}
                              />
                            ) : col.type === "date" ? (
                              <DateEditor
                                label={label}
                                value={value}
                                onPick={(v) => {
                                  setCell(pos, v || null)
                                  closePicker()
                                }}
                                onClose={closePicker}
                              />
                            ) : (
                              <TextEditor
                                col={col}
                                label={label}
                                editing={editing}
                                onDraft={(draft) =>
                                  setEditing({
                                    ...editing,
                                    draft,
                                    error: undefined,
                                  })
                                }
                                onCommit={finishEdit}
                                onCancel={cancelEdit}
                              />
                            ))}
                        </td>
                      )
                    })}
                  </motion.tr>
                )
              })}
              {streaming &&
                (loading.length > 0
                  ? loading.map((r) => String(r.id))
                  : base.length === 0
                    ? ["first"]
                    : []
                ).map((id) => (
                  <tr
                    key={`loading-${id}`}
                    aria-hidden
                    className="border-b last:border-b-0"
                  >
                    <td colSpan={colSpan} className="px-3 py-3">
                      <Skeleton className="h-4" />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </ScrollFade>

        <SurfaceFooter
          aria-live="polite"
          className="flex-wrap items-center justify-between gap-x-3 gap-y-2"
        >
          {locked && saved ? (
            <p className="flex items-center gap-1.5 text-[13px]">
              <CheckIcon aria-hidden className="size-4" />
              Saved: {describeChanges(saved).toLowerCase()}
            </p>
          ) : streaming ? (
            <p className={genuiType.meta}>
              <ShimmeringText
                text="Loading rows…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            </p>
          ) : (
            <>
              <div className="flex min-h-9 items-center gap-1">
                {selectedCount > 0 ? (
                  <>
                    <p className="mr-2 text-[13px] font-medium tabular-nums">
                      {selectedCount} selected
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={deleteSelected}
                    >
                      <Trash2Icon aria-hidden />
                      Delete
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </Button>
                  </>
                ) : (
                  allowAdd && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="-ml-2 text-muted-foreground"
                      onClick={addRow}
                    >
                      <PlusIcon aria-hidden />
                      Add row
                    </Button>
                  )
                )}
              </div>
              <div className="ml-auto flex items-center gap-3">
                <p
                  className={cn(
                    genuiType.meta,
                    editing?.error && "text-destructive",
                    activeAt && !editing?.error && "font-mono",
                  )}
                >
                  {editing?.error ??
                    (activeAt ? (
                      <>
                        <span className="sr-only">Cell </span>
                        {activeAt}
                      </>
                    ) : (
                      <span className="max-sm:hidden">{COPY.hint}</span>
                    ))}
                </p>
                <WhyDisabled when={changes === 0} reason="No changes yet">
                  <Button size="sm" disabled={changes === 0} onClick={save}>
                    {submitLabel ?? "Save changes"}
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
