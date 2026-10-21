"use client"

import * as React from "react"
import {
  ArrowDownIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  CheckIcon,
  GripVerticalIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  surfaceInset,
  type SurfaceVariant,
} from "@/components/genui/surface"
import { ScrollFade } from "@/components/genui/scroll-fade"

import type {
  CellValue,
  Column,
  DataTableInput,
  DataTableResult,
  Row,
  TableAction,
} from "./data-table.schema"

export type DataTableStatus = "streaming" | "ready" | "submitted"

type PartialColumn = Partial<Omit<Column, "type" | "sortable">> & {
  type?: Column["type"]
  sortable?: boolean
}
type ReadyColumn = PartialColumn & { key: string; label: string }
type PartialRow = Partial<Row>
type ReadyRow = PartialRow & { id: string }

export type DataTableProps = Partial<
  Omit<DataTableInput, "columns" | "rows" | "actions">
> & {
  /** Columns, rows and actions may be partial while the tool call streams. */
  columns?: PartialColumn[]
  rows?: PartialRow[]
  actions?: Partial<TableAction>[]
  /**
   * Lifecycle, controlled by the host. Selection works while 'streaming';
   * actions wait for the full payload. When omitted, the component tracks
   * the user's action itself.
   */
  status?: DataTableStatus
  /** Called once when the user runs a bulk action. */
  onResult?: (result: DataTableResult) => void
  /**
   * An action from history. Renders the locked table with the rows that were
   * acted on, and never calls onResult.
   */
  result?: DataTableResult
  /**
   * Defaults to "card". Pass "flush" to let a display-only table sit in the
   * message like text.
   */
  surface?: SurfaceVariant
  className?: string
}

const isNumeric = (type?: Column["type"]) =>
  type === "number" || type === "currency" || type === "percent"

function formatCell(
  value: CellValue | undefined,
  col: PartialColumn,
  locale: string,
): string {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") {
    const digits =
      col.decimals !== undefined
        ? {
            minimumFractionDigits: col.decimals,
            maximumFractionDigits: col.decimals,
          }
        : {}
    if (col.type === "currency" && col.currency) {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: col.currency,
          ...digits,
        }).format(value)
      } catch {
        // Fall through for invalid currency codes.
      }
    }
    const n = new Intl.NumberFormat(locale, digits).format(value)
    return col.type === "percent" ? `${n}%` : n
  }
  if (col.type === "date") {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(d)
    }
  }
  return value
}

/** Nulls last; numbers numerically; everything else as text. */
function compare(
  a: CellValue | undefined,
  b: CellValue | undefined,
  locale: string,
) {
  const aEmpty = a === null || a === undefined || a === ""
  const bEmpty = b === null || b === undefined || b === ""
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), locale, { numeric: true })
}

/** A column named change, delta or diff shows its values as blue badges. */
const isChangeColumn = (col: PartialColumn) =>
  /^(change|delta|diff|difference|\u0394)\b/i.test(
    (col.label ?? col.key ?? "").trim(),
  )

function Cell({
  value,
  col,
}: {
  value: CellValue | undefined
  col: PartialColumn
}) {
  const locale = useGenUILocale()
  if (isChangeColumn(col) && value !== null && value !== undefined) {
    const text = formatCell(value, col, locale)
    const sign =
      typeof value === "number"
        ? Math.sign(value)
        : /^\+/.test(text)
          ? 1
          : /^[-\u2212\u2013]/.test(text)
            ? -1
            : 0
    if (typeof value === "number" || /^[+\-\u2212\u2013]?\s*\d/.test(text)) {
      const Arrow =
        sign > 0 ? ArrowUpRightIcon : sign < 0 ? ArrowDownRightIcon : null
      return (
        <Badge variant="info" className="tabular-nums">
          {Arrow && <Arrow aria-hidden />}
          <span className="sr-only">
            {sign > 0 ? "Increase of " : sign < 0 ? "Decrease of " : ""}
          </span>
          {text.replace(/^[+\-\u2212\u2013]\s*/, "")}
        </Badge>
      )
    }
  }
  // Only negative statuses get a badge; the rest read as plain text.
  if (col.type === "status" && col.negative?.includes(String(value))) {
    return <Badge variant="destructive">{String(value)}</Badge>
  }
  return <>{formatCell(value, col, locale)}</>
}

export function DataTable({
  title,
  description,
  columns = [],
  rows = [],
  selectable = false,
  actions = [],
  sort: initialSort,
  pageSize,
  status: statusProp,
  onResult,
  surface,
  result,
  className,
}: DataTableProps) {
  const locale = useGenUILocale()
  const [sort, setSort] = React.useState(initialSort)
  const [expanded, setExpanded] = React.useState(false)
  // Column order the user chose (keys); empty until a column is moved.
  const [order, setOrder] = React.useState<string[]>([])
  // Dragging a header: where it came from, and where it would land.
  const [drag, setDrag] = React.useState<{ from: number; over: number } | null>(
    null,
  )
  const [announce, setAnnounce] = React.useState("")
  const hintId = React.useId()
  // Selection = the agent's pre-selection, overridden by the user's toggles.
  const [overrides, setOverrides] = React.useState<Map<string, boolean>>(
    () => new Map(),
  )
  const [submittedNow, setSubmitted] = React.useState<{
    label: string
    count: number
  } | null>(null)
  // A result from history wins over local state: those rows were acted on.
  const restoredIds = result ? new Set(result.rowIds) : null
  const submitted =
    submittedNow ??
    (result
      ? {
          label:
            actions.find((a) => a.id === result.action)?.label ?? result.action,
          count: result.rowIds.length,
        }
      : null)
  const titleId = React.useId()

  // A host-provided "ready" (or nothing) yields to the user's action.
  const status: DataTableStatus =
    submitted && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status === "submitted"

  const baseCols = columns.filter(
    (c): c is ReadyColumn =>
      typeof c.key === "string" && typeof c.label === "string",
  )
  // The user's order first; columns that arrive later keep their place at the end.
  const cols =
    order.length === 0
      ? baseCols
      : [
          ...order.flatMap((k) => baseCols.find((c) => c.key === k) ?? []),
          ...baseCols.filter((c) => !order.includes(c.key)),
        ]
  const readyRows = rows.filter((r): r is ReadyRow => typeof r.id === "string")
  const readyActions = actions.filter(
    (a): a is TableAction =>
      typeof a.id === "string" && typeof a.label === "string",
  )
  const canSelect = selectable && !locked

  const isSelected = (row: ReadyRow) =>
    restoredIds
      ? restoredIds.has(row.id)
      : (overrides.get(row.id) ?? Boolean(row.selected))

  const sortCol = sort && cols.find((c) => c.key === sort.key)
  const sorted = sortCol
    ? [...readyRows].sort(
        (a, b) =>
          (sort.direction === "asc" ? 1 : -1) *
          compare(a.cells?.[sortCol.key], b.cells?.[sortCol.key], locale),
      )
    : readyRows

  // Every row by default; a page size only when the agent asks for one.
  const visible = expanded || !pageSize ? sorted : sorted.slice(0, pageSize)
  const hiddenCount = sorted.length - visible.length
  const loadedRows = readyRows.filter((r) => r.cells)
  const selectedIds = loadedRows.filter(isSelected).map((r) => r.id)
  const selectedCount = selectedIds.length
  const allSelected = selectedCount > 0 && selectedCount === loadedRows.length

  const setMany = (ids: string[], on: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev)
      for (const id of ids) next.set(id, on)
      return next
    })

  // First click: the natural direction (numbers high to low), then the
  // opposite, then off.
  const toggleSort = (key: string) =>
    setSort((s) => {
      const first = isNumeric(cols.find((c) => c.key === key)?.type)
        ? "desc"
        : "asc"
      if (s?.key !== key) return { key, direction: first }
      return s.direction === first
        ? { key, direction: first === "asc" ? "desc" : "asc" }
        : undefined
    })

  // The first column is the row's name and stays pinned; the rest can move.
  const move = (from: number, to: number) => {
    if (from < 1 || to < 1 || to >= cols.length || from === to) return
    const keys = cols.map((c) => c.key)
    const [key] = keys.splice(from, 1)
    keys.splice(to, 0, key)
    setOrder(keys)
    setAnnounce(
      `${cols[from].label} moved to column ${to + 1} of ${cols.length}.`,
    )
  }

  const run = (action: TableAction) => {
    setSubmitted({ label: action.label, count: selectedIds.length })
    onResult?.({ action: action.id, rowIds: selectedIds })
  }

  const firstKey = cols[0]?.key
  const dropEdge = (pos: number) =>
    drag && drag.over === pos && drag.from !== pos
      ? drag.from < pos
        ? "shadow-[inset_-2px_0_0_var(--foreground)]"
        : "shadow-[inset_2px_0_0_var(--foreground)]"
      : undefined

  // Outer cells align with the surface edge: 20px in a card, flush with text otherwise.
  const edgeStart = "pl-5 group-data-[variant=flush]/surface:pl-0"
  const edgeEnd = "pr-5 group-data-[variant=flush]/surface:pr-0"
  // The selection and name columns stay visible while the table scrolls sideways.
  const stickyCell = "sticky z-[1] bg-(--row-bg,var(--surface-bg))"
  const firstColCell = cn(
    stickyCell,
    selectable ? "left-11" : cn("left-0", edgeStart),
  )
  // Larger tap area than the 20px box, without changing its look.
  const tapArea = "relative after:absolute after:-inset-2"
  const showFooter =
    (selectable && readyActions.length > 0) || streaming || locked

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        variant={surface ?? "card"}
        data-slot="data-table"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={titleId}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && (
            <SurfaceDescription>{description}</SurfaceDescription>
          )}
        </SurfaceHeader>

        <AutoHeight>
          {/* Side fades blend into the surface and start after the fixed columns. */}
          <ScrollFade className="border-t border-border [--scroller-bg:var(--surface-bg)]">
            <span id={hintId} className="sr-only">
              Sorts by this column. Alt with the left or right arrow moves the
              column.
            </span>
            <p aria-live="polite" className="sr-only">
              {announce}
            </p>
            <table
              aria-labelledby={titleId}
              className="w-full border-collapse text-[13px]"
            >
              <thead>
                <tr className="border-b">
                  {selectable && (
                    <th
                      scope="col"
                      data-sticky-start
                      className={cn(
                        stickyCell,
                        "left-0 z-[2] w-11 py-2.5",
                        edgeStart,
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
                        disabled={!canSelect || loadedRows.length === 0}
                        className={tapArea}
                        onCheckedChange={(on) =>
                          setMany(
                            loadedRows.map((r) => r.id),
                            Boolean(on),
                          )
                        }
                      />
                    </th>
                  )}
                  {cols.map((col, pos) => {
                    const movable = pos > 0 && cols.length > 2
                    const sortable = col.sortable !== false
                    const active = sort?.key === col.key
                    const Icon = !active
                      ? ArrowUpDownIcon
                      : sort.direction === "asc"
                        ? ArrowUpIcon
                        : ArrowDownIcon
                    return (
                      <th
                        key={col.key}
                        scope="col"
                        data-sticky-start={col === cols[0] || undefined}
                        draggable={movable || undefined}
                        onDragStart={
                          movable
                            ? (e) => {
                                e.dataTransfer.effectAllowed = "move"
                                e.dataTransfer.setData("text/plain", col.label)
                                setDrag({ from: pos, over: pos })
                              }
                            : undefined
                        }
                        onDragOver={(e) => {
                          if (!drag || pos < 1) return
                          e.preventDefault()
                          if (drag.over !== pos) setDrag({ ...drag, over: pos })
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          if (drag) move(drag.from, pos)
                          setDrag(null)
                        }}
                        onDragEnd={() => setDrag(null)}
                        aria-sort={
                          active
                            ? sort.direction === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                        className={cn(
                          "group/th relative px-3 py-2.5 whitespace-nowrap",
                          movable && "cursor-grab active:cursor-grabbing",
                          drag?.from === pos && "opacity-50",
                          dropEdge(pos),
                          genuiType.label,
                          isNumeric(col.type) ? "text-right" : "text-left",
                          col === cols[0] && firstColCell,
                          col === cols.at(-1) && edgeEnd,
                        )}
                      >
                        {/* In the cell's padding, so the label stays aligned with its column. */}
                        {movable && (
                          <GripVerticalIcon
                            aria-hidden
                            className="absolute top-1/2 left-0 size-3.5 -translate-y-1/2 opacity-0 transition-opacity group-hover/th:opacity-60"
                          />
                        )}
                        {sortable ? (
                          <button
                            type="button"
                            aria-describedby={movable ? hintId : undefined}
                            onClick={() => toggleSort(col.key)}
                            onKeyDown={(e) => {
                              if (
                                !movable ||
                                !e.altKey ||
                                (e.key !== "ArrowLeft" &&
                                  e.key !== "ArrowRight")
                              )
                                return
                              e.preventDefault()
                              move(pos, pos + (e.key === "ArrowLeft" ? -1 : 1))
                            }}
                            className={cn(
                              "relative -mx-1.5 inline-flex items-center gap-1 rounded-full px-1.5 outline-none after:absolute after:-inset-x-1 after:-inset-y-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                              // Number columns align right, so their arrow goes
                              // first and the label lines up with the digits.
                              isNumeric(col.type) && "flex-row-reverse",
                              active && "text-foreground",
                            )}
                          >
                            {col.label}
                            <Icon
                              aria-hidden
                              className={cn("size-3", !active && "opacity-40")}
                            />
                          </button>
                        ) : (
                          col.label
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  if (!row.cells) {
                    return (
                      <tr
                        key={row.id}
                        aria-hidden
                        className="border-b last:border-b-0"
                      >
                        <td
                          colSpan={cols.length + (selectable ? 1 : 0)}
                          className="px-3 py-3"
                        >
                          <Skeleton className="h-4" />
                        </td>
                      </tr>
                    )
                  }
                  const rowSelected = isSelected(row)
                  const name = firstKey
                    ? formatCell(row.cells[firstKey], cols[0], locale)
                    : row.id
                  return (
                    <motion.tr
                      key={row.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2 }}
                      data-selected={rowSelected || undefined}
                      // Solid fills (not translucent) so sticky cells cover what
                      // scrolls beneath them. --muted and --accent are
                      // translucent, and color-mix keeps their alpha, so the
                      // tints mix the foreground into the surface instead.
                      style={
                        {
                          "--row-base": rowSelected
                            ? "color-mix(in oklab, var(--foreground) 8%, var(--surface-bg))"
                            : row.flag
                              ? "color-mix(in oklab, var(--foreground) 5%, var(--surface-bg))"
                              : "var(--surface-bg)",
                          // Hover: a little stronger on a tinted row.
                          "--row-hover":
                            rowSelected || row.flag
                              ? "color-mix(in oklab, var(--foreground) 12%, var(--surface-bg))"
                              : "color-mix(in oklab, var(--foreground) 6%, var(--surface-bg))",
                        } as React.CSSProperties
                      }
                      className={cn(
                        "border-b bg-(--row-bg) align-top transition-colors last:border-b-0 [--row-bg:var(--row-base)]",
                        // Sticky cells read --row-bg too, so the hover covers them.
                        canSelect &&
                          "cursor-pointer hover:[--row-bg:var(--row-hover)]",
                      )}
                      // A click anywhere on the row toggles its checkbox, like a
                      // label. Pointer only: keyboard and screen readers use the
                      // checkbox itself, so the row adds no extra tab stop. Clicks
                      // on the checkbox (or any control) and text selections are
                      // left alone.
                      onClick={
                        canSelect
                          ? (e) => {
                              const target = e.target as HTMLElement
                              if (target.closest("button, a, input, label"))
                                return
                              if (window.getSelection()?.toString()) return
                              setMany([row.id], !rowSelected)
                            }
                          : undefined
                      }
                    >
                      {selectable && (
                        <td
                          className={cn(
                            stickyCell,
                            "left-0 z-[2] w-11 py-3",
                            edgeStart,
                          )}
                        >
                          <Checkbox
                            nativeButton
                            size="sm"
                            aria-label={`Select ${name}`}
                            checked={rowSelected}
                            disabled={!canSelect}
                            onCheckedChange={(on) =>
                              setMany([row.id], Boolean(on))
                            }
                            className={tapArea}
                          />
                        </td>
                      )}
                      {cols.map((col, i) => (
                        <td
                          key={col.key}
                          className={cn(
                            "px-3 py-3",
                            i === 0 && firstColCell,
                            i === cols.length - 1 && edgeEnd,
                            isNumeric(col.type)
                              ? "text-right whitespace-nowrap tabular-nums"
                              : "text-left",
                            // The identifying column wraps; the rest stay on one
                            // line, so narrow screens scroll instead of squashing.
                            i === 0
                              ? "min-w-40 font-medium"
                              : "whitespace-nowrap",
                          )}
                        >
                          <Cell value={row.cells?.[col.key]} col={col} />
                          {i === 0 && row.flag && (
                            <p
                              className={cn(
                                "mt-0.5 font-normal",
                                genuiType.meta,
                              )}
                            >
                              {row.flag}
                            </p>
                          )}
                        </td>
                      ))}
                    </motion.tr>
                  )
                })}
                {streaming && readyRows.length === 0 && (
                  <tr aria-hidden>
                    <td
                      colSpan={Math.max(cols.length, 1) + (selectable ? 1 : 0)}
                      className="px-3 py-3"
                    >
                      <Skeleton className="h-4" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </ScrollFade>

          {hiddenCount > 0 && (
            <div className={cn("border-t border-border py-3", surfaceInset)}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setExpanded(true)}
              >
                Show {hiddenCount} more {hiddenCount === 1 ? "row" : "rows"}
              </Button>
            </div>
          )}
        </AutoHeight>

        {showFooter && (
          <SurfaceFooter
            aria-live="polite"
            className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {locked && submitted ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4" />
                {submitted.label}: {submitted.count}{" "}
                {submitted.count === 1 ? "row" : "rows"}
              </p>
            ) : (
              <>
                <p className={genuiType.meta}>
                  {streaming ? (
                    <ShimmeringText
                      text="Loading rows…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : (
                    <span className="inline-flex items-center tabular-nums">
                      <span className="sr-only">{selectedCount}</span>
                      <SlidingNumber
                        aria-hidden
                        number={selectedCount}
                        initiallyStable
                      />
                      &nbsp;selected
                    </span>
                  )}
                </p>
                {readyActions.length > 0 && (
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    {readyActions.map((a) => (
                      <WhyDisabled
                        key={a.id}
                        when={streaming || selectedCount === 0}
                        reason={
                          streaming
                            ? "Still loading…"
                            : "Select at least one row"
                        }
                      >
                        <Button
                          size="sm"
                          variant={
                            a.variant === "destructive"
                              ? "destructive"
                              : readyActions.length === 1
                                ? "default"
                                : "outline"
                          }
                          disabled={streaming || selectedCount === 0}
                          onClick={() => run(a)}
                        >
                          {a.label}
                        </Button>
                      </WhyDisabled>
                    ))}
                  </div>
                )}
              </>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
