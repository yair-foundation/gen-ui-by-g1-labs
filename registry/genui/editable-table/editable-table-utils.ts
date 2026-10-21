/* Pure helpers for the editable table, shared by the component and its tests. */

import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type {
  EditableCell,
  EditableColumn,
  EditableTableResult,
} from "./editable-table.schema"

export type Cells = Record<string, EditableCell>
/** A row as the table holds it. New rows have a local id and no real one. */
export type TableRow = { id: string; cells: Cells; isNew?: boolean }

type ColumnLike = Pick<EditableColumn, "key"> &
  Partial<Pick<EditableColumn, "type" | "options">>

export const isEmpty = (v: EditableCell | undefined): v is null | undefined =>
  v === null || v === undefined || v === ""

/** Spreadsheet column letters: 0 is A, 25 is Z, 26 is AA. */
export function columnLetter(index: number): string {
  let n = Math.max(0, Math.floor(index))
  let out = ""
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** "B3" for the second column of the third row (both zero-based). */
export const cellAddress = (col: number, row: number) =>
  `${columnLetter(col)}${row + 1}`

/** Rows Page Up and Page Down move. The card grows instead of scrolling, so there's no visible page to measure. */
export const PAGE_ROWS = 5

/**
 * The cell `dr` rows and `dc` columns from `row`, `col` in a `rows` × `cols`
 * grid. Up and down stop at the first and last row. Left and right wrap: past
 * the last column to the next row's first cell, before the first column to
 * the previous row's last cell, stopping at the table's corners.
 */
export function stepCell(
  row: number,
  col: number,
  dr: number,
  dc: number,
  rows: number,
  cols: number,
): [number, number] {
  if (rows <= 0 || cols <= 0) return [0, 0]
  if (dc !== 0) {
    const i = Math.min(Math.max(row * cols + col + dc, 0), rows * cols - 1)
    return [Math.floor(i / cols), i % cols]
  }
  return [Math.min(Math.max(row + dr, 0), rows - 1), col]
}

/**
 * Where Home or End goes from `row`, `col` in a `rows` × `cols` grid. Home goes
 * to the row's first cell; pressed there, it wraps to the previous row's first
 * cell (End mirrors it: the row's last cell, then the next row's), stopping
 * at the table's corners. With `toCorner` (Ctrl or ⌘), straight to the
 * table's first or last cell.
 */
export function homeEndCell(
  row: number,
  col: number,
  key: "Home" | "End",
  toCorner: boolean,
  rows: number,
  cols: number,
): [number, number] {
  if (rows <= 0 || cols <= 0) return [0, 0]
  const home = key === "Home"
  if (toCorner) return home ? [0, 0] : [rows - 1, cols - 1]
  const edge = home ? 0 : cols - 1
  if (col !== edge) return [row, edge]
  return [Math.min(Math.max(row + (home ? -1 : 1), 0), rows - 1), edge]
}

/** A strict "YYYY-MM-DD" as UTC midnight, or null (rejects 2026-02-31). */
export function parseIsoDay(value: unknown): number | null {
  if (typeof value !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const t = Date.UTC(y, mo, d)
  const back = new Date(t)
  return back.getUTCFullYear() === y &&
    back.getUTCMonth() === mo &&
    back.getUTCDate() === d
    ? t
    : null
}

/** "figma.com" from "https://www.figma.com/". Unparseable text is returned as is. */
export function urlLabel(value: string): string {
  const v = value.trim()
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(v) ? v : `https://${v}`)
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "")
    return `${u.hostname.replace(/^www\./, "")}${path}`
  } catch {
    return v
  }
}

/** An http(s) link for a URL cell, or null when it isn't one. */
export function urlHref(value: string): string | null {
  const v = value.trim()
  if (!v || /\s/.test(v)) return null
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(withScheme)
    if (u.protocol !== "http:" && u.protocol !== "https:") return null
    return u.hostname.includes(".") ? u.href : null
  } catch {
    return null
  }
}

/** The cell as text, in the host's locale. Empty cells are "". */
export function formatValue(
  value: EditableCell | undefined,
  col: ColumnLike,
  locale: string = DEFAULT_LOCALE,
): string {
  if (isEmpty(value)) return ""
  if (col.type === "number" && typeof value === "number") {
    return new Intl.NumberFormat(locale).format(value)
  }
  if (col.type === "date") {
    const t = parseIsoDay(value)
    if (t !== null) {
      return new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(t)
    }
  }
  if (col.type === "url") return urlLabel(String(value))
  return String(value)
}

/** How many select options get a colour of their own (D43); the rest stay blue. */
export const TAGGED_OPTIONS = 5

/**
 * The colour slot of a select value: its position in the column's options,
 * so it keeps its colour however the rows change. null for values past the
 * fifth option, values not in the list, and other column types.
 */
export function optionTone(
  value: EditableCell | undefined,
  col: ColumnLike,
): number | null {
  if (col.type !== "select" || isEmpty(value) || !col.options) return null
  const i = col.options.indexOf(String(value))
  return i >= 0 && i < TAGGED_OPTIONS ? i : null
}

/** The text an editor starts from: raw, so editing never loses precision. */
export function editText(value: EditableCell | undefined): string {
  return isEmpty(value) ? "" : String(value)
}

export type Parsed =
  | { ok: true; value: EditableCell }
  | { ok: false; error: string }

/** What the user typed, as the column's value. Blank clears the cell. */
export function parseInput(raw: string, col: ColumnLike): Parsed {
  const text = raw.trim()
  if (text === "") return { ok: true, value: null }
  switch (col.type) {
    case "number": {
      const n = Number(text.replace(/[,\s]/g, ""))
      return Number.isFinite(n)
        ? { ok: true, value: n }
        : { ok: false, error: "Enter a number" }
    }
    case "date":
      return parseIsoDay(text) !== null
        ? { ok: true, value: text.slice(0, 10) }
        : { ok: false, error: "Pick a date" }
    case "url":
      return urlHref(text)
        ? { ok: true, value: text }
        : { ok: false, error: "Enter a web address" }
    case "select": {
      const match = col.options?.find(
        (o) => o.toLowerCase() === text.toLowerCase(),
      )
      return match || !col.options?.length
        ? { ok: true, value: match ?? text }
        : { ok: false, error: "Pick one of the options" }
    }
    default:
      return { ok: true, value: text }
  }
}

/** Empty cells last; numbers and dates in order; everything else as text. */
export function compareCells(
  a: EditableCell | undefined,
  b: EditableCell | undefined,
  locale: string = DEFAULT_LOCALE,
): number {
  const ae = isEmpty(a)
  const be = isEmpty(b)
  if (ae || be) return ae === be ? 0 : ae ? 1 : -1
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), locale, { numeric: true })
}

/** Rows ordered by one column, empty cells last either way; ties keep their order. */
export function sortRows<R extends { cells: Cells }>(
  rows: R[],
  sort: { key: string; direction: "asc" | "desc" } | undefined,
  locale: string = DEFAULT_LOCALE,
): R[] {
  if (!sort) return rows
  const dir = sort.direction === "asc" ? 1 : -1
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const x = a.row.cells[sort.key]
      const y = b.row.cells[sort.key]
      const empties = Number(isEmpty(x)) - Number(isEmpty(y))
      return empties || dir * compareCells(x, y, locale) || a.i - b.i
    })
    .map((x) => x.row)
}

const same = (a: EditableCell | undefined, b: EditableCell | undefined) =>
  isEmpty(a) && isEmpty(b) ? true : a === b

/** What changed between the agent's rows and the table now. */
export function diffRows(
  original: { id: string; cells: Cells }[],
  current: TableRow[],
  keys: string[],
): EditableTableResult {
  const before = new Map(original.map((r) => [r.id, r.cells]))
  const kept = new Set<string>()
  const updated: EditableTableResult["updated"] = []
  const added: EditableTableResult["added"] = []
  for (const row of current) {
    if (row.isNew || !before.has(row.id)) {
      const cells: Cells = {}
      for (const k of keys) if (!isEmpty(row.cells[k])) cells[k] = row.cells[k]
      if (Object.keys(cells).length > 0) added.push({ cells })
      continue
    }
    kept.add(row.id)
    const prev = before.get(row.id) ?? {}
    const cells: Cells = {}
    for (const k of keys) {
      if (!same(prev[k], row.cells[k])) cells[k] = row.cells[k] ?? null
    }
    if (Object.keys(cells).length > 0) updated.push({ id: row.id, cells })
  }
  const deleted = original.map((r) => r.id).filter((id) => !kept.has(id))
  return { action: "save", updated, added, deleted }
}

export const changeCount = (r: EditableTableResult) =>
  r.updated.length + r.added.length + r.deleted.length

/** The table after a saved result, to replay it from history. */
export function applyResult(
  original: { id: string; cells: Cells }[],
  result: EditableTableResult,
): TableRow[] {
  const gone = new Set(result.deleted)
  const edits = new Map(result.updated.map((u) => [u.id, u.cells]))
  return [
    ...original
      .filter((r) => !gone.has(r.id))
      .map((r) => ({ id: r.id, cells: { ...r.cells, ...edits.get(r.id) } })),
    ...result.added.map((a, i) => ({
      id: `added-${i + 1}`,
      cells: a.cells,
      isNew: true,
    })),
  ]
}

/** A result in words: "2 edited, 1 added, 1 deleted". */
export function describeChanges(r: EditableTableResult): string {
  const parts = [
    r.updated.length && `${r.updated.length} edited`,
    r.added.length && `${r.added.length} added`,
    r.deleted.length && `${r.deleted.length} deleted`,
  ].filter(Boolean)
  return parts.length ? parts.join(", ") : "No changes"
}
