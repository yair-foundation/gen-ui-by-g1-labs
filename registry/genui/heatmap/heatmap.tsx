"use client";

import * as React from "react";
import { CheckIcon } from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  surfaceInset,
  genuiMotion,
} from "@/components/genui/surface";
import { ScrollFade } from "@/components/genui/scroll-fade";
import { useGenUILocale } from "@/components/genui/locale";

import {
  activityStats,
  bucketLabels,
  bucketLevels,
  buildCalendar,
  buildScale,
  buildValueGrid,
  calendarSummary,
  cohortFocusColumn,
  cohortObserved,
  compactHour,
  dayNumber,
  expandWeekday,
  findExtremes,
  formatValue,
  fullHour,
  hourColumns,
  hourOf,
  hourRange,
  type Level,
  levelOf,
  monthlyTotals,
  peakPhrase,
  resolveIndex,
  type Scale,
  type Side,
  textTone,
  type ValueFormat,
  type ValueGrid,
} from "./heatmap-utils";
import type {
  HeatmapCell,
  HeatmapDay,
  HeatmapHighlight,
  HeatmapInput,
  HeatmapResult,
  HeatmapScale,
} from "./heatmap.schema";

export type HeatmapStatus = "streaming" | "ready" | "submitted";

export type HeatmapProps = Partial<
  Omit<HeatmapInput, "cells" | "days" | "scale" | "highlight">
> & {
  /** Cells and days may be partial while the tool call streams. */
  cells?: Partial<HeatmapCell>[];
  days?: Partial<HeatmapDay>[];
  scale?: Partial<HeatmapScale>;
  highlight?: Partial<HeatmapHighlight>;
  /** Lifecycle, controlled by the host. */
  status?: HeatmapStatus;
  /** Called once when the user chooses a cell (only when selectable). */
  onResult?: (result: HeatmapResult) => void;
  /** A choice from history. Restores the selection and locks; never calls onResult. */
  result?: HeatmapResult;
  className?: string;
};

type Layout = "matrix" | "calendar" | "cohort";
type Pos = { r: number; c: number };

type CellModel = {
  /**
   * value/null: a real cell. blank: outside the calendar range or past the
   * cohort triangle. pending: not streamed yet.
   */
  kind: "value" | "null" | "blank" | "pending";
  value: number | null;
  /** Full name for assistive tech: "Friday, 7 PM". */
  label: string;
  /** Short name for the tooltip and the result line: "Fri 7 PM". */
  short: string;
  /** Name in the summary: "Fri 7–8 PM". */
  summaryName: string;
  row?: string;
  column?: string;
  date?: string;
};

type Head = { text: string; sr: string };

type Model = {
  rowHeads: Head[];
  colHeads: Head[];
  /** Calendar month labels. */
  months: { column: number; text: string }[];
  cells: CellModel[][];
  columnCount: number;
  /** Cohort sizes as text, per row. */
  sizes: string[] | null;
  values: number[];
  grid: ValueGrid;
  hours: boolean;
  days: { date: string; value: number | null }[];
};

const EMPTY_MODEL: Model = {
  rowHeads: [],
  colHeads: [],
  months: [],
  cells: [],
  columnCount: 0,
  sizes: null,
  values: [],
  grid: [],
  hours: false,
  days: [],
};

const BLANK: CellModel = {
  kind: "blank",
  value: null,
  label: "",
  short: "",
  summaryName: "",
};

const isText = (s: unknown): s is string => typeof s === "string";

function utcDate(key: string) {
  return new Date(`${key}T00:00:00Z`);
}

function buildModel(
  layout: Layout,
  props: Pick<
    HeatmapProps,
    "rows" | "columns" | "cells" | "days" | "cohortSizes" | "weekStart"
  >,
  streaming: boolean,
  locale: string,
): Model {
  if (layout === "calendar") {
    const byDate = new Map<string, number | null>();
    for (const d of props.days ?? []) {
      if (!isText(d.date) || dayNumber(d.date) === null) continue;
      if (d.value === undefined || byDate.has(d.date)) continue;
      byDate.set(
        d.date,
        typeof d.value === "number" && Number.isFinite(d.value)
          ? d.value
          : null,
      );
    }
    const dates = [...byDate.keys()].sort();
    const cal =
      dates.length > 0
        ? buildCalendar(dates[0], dates[dates.length - 1], props.weekStart ?? 0)
        : null;
    if (!cal) return EMPTY_MODEL;
    const long = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const short = new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const narrow = new Intl.DateTimeFormat(locale, {
      weekday: "narrow",
      timeZone: "UTC",
    });
    const longDay = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      timeZone: "UTC",
    });
    const monthName = new Intl.DateTimeFormat(locale, {
      month: "short",
      timeZone: "UTC",
    });
    // Jan 4 2026 is a Sunday: + weekday gives that weekday.
    const weekdayDate = (w: number) => new Date(Date.UTC(2026, 0, 4 + w));
    const values: number[] = [];
    const cells = cal.cells.map((row) =>
      row.map((date): CellModel => {
        if (!date) return BLANK;
        const v = byDate.get(date);
        if (typeof v === "number") values.push(v);
        const d = utcDate(date);
        return {
          kind: v === undefined ? "null" : v === null ? "null" : "value",
          value: v ?? null,
          label: long.format(d),
          short: short.format(d),
          summaryName: short.format(d),
          date,
        };
      }),
    );
    return {
      ...EMPTY_MODEL,
      rowHeads: cal.weekdays.map((w) => ({
        // Initials on alternate rows (Mon, Wed, Fri), like most calendars.
        text: w % 2 === 1 && w < 6 ? narrow.format(weekdayDate(w)) : "",
        sr: longDay.format(weekdayDate(w)),
      })),
      months: cal.months.map((m) => ({
        column: m.column,
        text: monthName.format(new Date(Date.UTC(m.year, m.month, 1))),
      })),
      cells,
      columnCount: cal.weeks,
      values,
      grid: cells.map((row) =>
        row.map((cell) => (cell.kind === "blank" ? undefined : cell.value)),
      ),
      days: dates.map((date) => ({ date, value: byDate.get(date) ?? null })),
    };
  }

  const rows = (props.rows ?? []).filter(isText);
  let columns = (props.columns ?? []).filter(isText);
  if (layout === "cohort" && columns.length === 0 && !streaming) {
    // No period labels: number the periods from the cells.
    const last = Math.max(
      -1,
      ...(props.cells ?? []).map((c) =>
        typeof c.column === "number" ? c.column : -1,
      ),
    );
    columns = Array.from({ length: last + 1 }, (_, i) => String(i));
  }
  if (rows.length === 0 || columns.length === 0) return EMPTY_MODEL;

  const resolved = (props.cells ?? []).flatMap((cell) => {
    const r = resolveIndex(cell.row, rows);
    const c = resolveIndex(cell.column, columns);
    if (r < 0 || c < 0 || cell.value === undefined) return [];
    return [{ row: r, column: c, value: cell.value }];
  });
  const grid = buildValueGrid(rows.length, columns.length, resolved);
  const hours = layout === "matrix" && hourColumns(columns);
  const colName = (c: number) => {
    const h = hours ? hourOf(columns[c]) : null;
    return h === null ? columns[c] : fullHour(h);
  };
  const values: number[] = [];
  const cells = grid.map((row, r) =>
    row.map((v, c): CellModel => {
      if (typeof v === "number") values.push(v);
      let kind: CellModel["kind"];
      if (v === undefined) {
        if (layout === "cohort") {
          kind =
            streaming && c < cohortObserved(r, rows.length, columns.length)
              ? "pending"
              : "blank";
        } else {
          kind = streaming ? "pending" : "null";
        }
      } else {
        kind = v === null ? "null" : "value";
      }
      const h = hours ? hourOf(columns[c]) : null;
      return layout === "cohort"
        ? {
            kind,
            value: v ?? null,
            label: `${rows[r]} cohort, ${columns[c]}`,
            short: `${rows[r]} · ${columns[c]}`,
            summaryName: `${rows[r]} · ${columns[c]}`,
            row: rows[r],
            column: columns[c],
          }
        : {
            kind,
            value: v ?? null,
            label: `${expandWeekday(rows[r])}, ${colName(c)}`,
            short: `${rows[r]} ${colName(c)}`,
            summaryName: `${rows[r]} ${h === null ? colName(c) : hourRange(h)}`,
            row: rows[r],
            column: columns[c],
          };
    }),
  );
  const sizes =
    layout === "cohort" && props.cohortSizes?.length
      ? rows.map((_, r) => {
          const n = props.cohortSizes?.[r];
          return typeof n === "number" && Number.isFinite(n)
            ? new Intl.NumberFormat(locale).format(n)
            : "";
        })
      : null;
  return {
    ...EMPTY_MODEL,
    rowHeads: rows.map((r) => ({ text: r, sr: r })),
    colHeads: columns.map((col) => {
      const h = hours ? hourOf(col) : null;
      return h === null
        ? { text: col, sr: col }
        : { text: compactHour(h), sr: fullHour(h) };
    }),
    cells,
    columnCount: columns.length,
    sizes,
    values,
    grid,
    hours,
  };
}

// ---------------------------------------------------------------------------
// Color

/** One ink per side, mixed into the neutral base (the Region Map's approach). */
const INK: Record<Exclude<Side, "mid">, string> = {
  high: "var(--heatmap-high)",
  low: "var(--heatmap-low)",
};

function fillFor(level: Level): string | undefined {
  if (level.kind === "none") return undefined;
  if (level.kind === "zero" || level.strength === 0 || level.side === "mid") {
    return "var(--muted)";
  }
  return `color-mix(in srgb, ${INK[level.side]} ${level.strength}%, var(--muted))`;
}

const TONE_LIGHT = { light: "text-card", dark: "text-foreground" } as const;
const TONE_DARK = {
  light: "dark:text-foreground",
  dark: "dark:text-background",
} as const;

/** Text color with the better contrast on the fill, per theme. */
function toneFor(level: Level): string {
  const strength = level.kind === "bucket" ? level.strength : 0;
  const side = level.kind === "bucket" ? level.side : "high";
  return cn(
    TONE_LIGHT[textTone("light", strength, side)],
    TONE_DARK[textTone("dark", strength, side)],
  );
}

/** A small minus on the low side of a diverging scale, so it reads without color. */
function LowMark() {
  return (
    <span
      aria-hidden
      className="absolute top-1/2 left-1/2 h-px w-1.5 -translate-x-1/2 -translate-y-1/2 bg-current"
    />
  );
}

const isLow = (level: Level) =>
  level.kind === "bucket" && level.side === "low" && level.strength > 0;

// ---------------------------------------------------------------------------

type Rect = { left: number; top: number; width: number; height: number };

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), Math.max(lo, hi));

const MAX_SIZE: Record<Layout, number> = {
  matrix: 40,
  calendar: 18,
  cohort: 52,
};

export function Heatmap({
  title,
  description,
  layout = "matrix",
  rows,
  columns,
  cells: cellsProp,
  days,
  cohortSizes,
  format = "number",
  currency,
  unit,
  scale: scaleProp = {},
  highlight,
  selectable = false,
  weekStart = 0,
  status: statusProp,
  onResult,
  result,
  className,
}: HeatmapProps) {
  const locale = useGenUILocale();
  const [decision, setDecision] = React.useState<HeatmapResult | null>(
    result ?? null,
  );
  const [width, setWidth] = React.useState(0);
  const [hover, setHover] = React.useState<Pos | null>(null);
  const [active, setActive] = React.useState<Pos | null>(null);
  const [focused, setFocused] = React.useState(false);
  const [tipHidden, setTipHidden] = React.useState(false);
  const [rects, setRects] = React.useState<{
    tip: Rect | null;
    pill: Rect | null;
    viewLeft: number;
    viewRight: number;
  }>({ tip: null, pill: null, viewLeft: 0, viewRight: 0 });
  const [, setScrollTick] = React.useState(0);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const scrollerRef = React.useRef<HTMLDivElement>(null);
  const moved = React.useRef(false);
  const uid = React.useId();
  const titleId = `${uid}-title`;
  const hintId = `${uid}-hint`;
  const domId = (p: Pos) => `${uid}-cell-${p.r}-${p.c}`;

  // A host-provided "ready" (or nothing) yields to the user's choice.
  const status: HeatmapStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready");
  const streaming = status === "streaming";
  const locked = status !== "ready";

  const model = React.useMemo(
    () =>
      buildModel(
        layout,
        { rows, columns, cells: cellsProp, days, cohortSizes, weekStart },
        streaming,
        locale,
      ),
    [
      layout,
      rows,
      columns,
      cellsProp,
      days,
      cohortSizes,
      weekStart,
      streaming,
      locale,
    ],
  );

  const diverging = scaleProp.diverging;
  const fmt: ValueFormat = {
    format,
    currency,
    unit,
    signed: diverging?.midpoint === 0,
  };
  const full = (v: number | null) => formatValue(v, fmt, "full", locale);
  const compact = (v: number | null) => formatValue(v, fmt, "compact", locale);
  const scale: Scale | null = buildScale(model.values, {
    steps: scaleProp.steps,
    min: scaleProp.min,
    max: scaleProp.max,
    diverging,
  });
  const levelAt = (cell: CellModel): Level =>
    cell.kind === "value" && scale
      ? levelOf(cell.value, scale)
      : { kind: "none" };

  const R = model.cells.length;
  const C = model.columnCount;
  const hasGrid = R > 0 && C > 0;
  const cellAt = (p: Pos | null) => (p ? model.cells[p.r]?.[p.c] : undefined);
  const navigable = (p: Pos) => {
    const kind = cellAt(p)?.kind;
    return kind === "value" || kind === "null";
  };

  // Peaks and the highlighted cell (once the data is complete).
  const peaks = findExtremes(model.grid, "max");
  const lows =
    scale?.kind === "diverging" ? findExtremes(model.grid, "min") : [];
  const highlightPos = ((): Pos | null => {
    if (!highlight || streaming || !hasGrid) return null;
    if (layout === "calendar" && isText(highlight.date)) {
      for (const [r, row] of model.cells.entries()) {
        const c = row.findIndex((cell) => cell.date === highlight.date);
        if (c >= 0) return { r, c };
      }
      return null;
    }
    if (
      layout !== "calendar" &&
      highlight.row !== undefined &&
      highlight.column !== undefined
    ) {
      const r = resolveIndex(
        highlight.row,
        model.rowHeads.map((h) => h.sr),
      );
      const c = resolveIndex(highlight.column, (columns ?? []).filter(isText));
      return r >= 0 && c >= 0 ? { r, c } : null;
    }
    // A label without a cell marks the highest value.
    return highlight.label && peaks[0]
      ? { r: peaks[0].row, c: peaks[0].column }
      : null;
  })();
  const highlightCell = cellAt(highlightPos);
  const highlightText = highlightCell
    ? (highlight?.label ?? compact(highlightCell.value))
    : null;

  const firstNavigable = (): Pos | null => {
    for (let r = 0; r < R; r++) {
      for (let c = 0; c < C; c++) if (navigable({ r, c })) return { r, c };
    }
    return null;
  };
  const activePos: Pos | null =
    (active && navigable(active) ? active : null) ??
    highlightPos ??
    (peaks[0] ? { r: peaks[0].row, c: peaks[0].column } : null) ??
    firstNavigable();

  const matches = (cell: CellModel, d: HeatmapResult | null) =>
    !!d &&
    ("date" in d
      ? cell.date === d.date
      : cell.row === d.row && cell.column === d.column);

  const select = (cell: CellModel) => {
    if (!selectable || locked || cell.kind !== "value") return;
    const next: HeatmapResult = cell.date
      ? { action: "select", date: cell.date }
      : { action: "select", row: cell.row ?? "", column: cell.column ?? "" };
    setDecision(next);
    onResult?.(next);
  };

  // --- Sizing ---------------------------------------------------------------
  React.useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const maxLen = (list: string[]) => Math.max(0, ...list.map((s) => s.length));
  const gap = layout === "cohort" ? 3 : 2;
  const labelW =
    layout === "calendar"
      ? 18
      : clamp(maxLen(model.rowHeads.map((h) => h.text)) * 7 + 12, 28, 120);
  const sizeW = model.sizes ? clamp(maxLen(model.sizes) * 7.5 + 12, 40, 72) : 0;
  const stickyW = labelW + gap + (model.sizes ? sizeW + gap : 0);
  const fit = Math.floor((width - stickyW - gap * (C + 1)) / Math.max(1, C));
  const size =
    width > 0
      ? clamp(fit, selectable ? 22 : 12, MAX_SIZE[layout])
      : layout === "cohort"
        ? 32
        : 14;
  const pitch = size + gap;
  const colTextLen = maxLen(model.colHeads.map((h) => h.text));
  // Labels are text-xs (12px): about 7px per character.
  const rotate = !model.hours && colTextLen * 7 + 4 > pitch;
  const headH = rotate ? Math.min(96, colTextLen * 7 + 6) : 16;
  const labelEvery = model.hours
    ? ([1, 2, 3, 4, 6].find((n) => n * pitch >= 26) ?? 6)
    : 1;
  const showText = layout !== "calendar" && size >= 36;

  // Keep the newest weeks in view.
  React.useLayoutEffect(() => {
    // Runs again when weeks stream in (C) or the card resizes.
    if (layout !== "calendar" || width === 0 || C === 0) return;
    const s = scrollerRef.current;
    if (s) s.scrollLeft = s.scrollWidth;
  }, [layout, C, width]);

  // --- Tooltip and callout positions -----------------------------------------
  const tipPos = hover ?? (focused && !tipHidden ? activePos : null);
  const tipCell = cellAt(tipPos);
  const tipKey = tipPos ? `${tipPos.r}-${tipPos.c}` : "";
  const pillKey = highlightPos ? `${highlightPos.r}-${highlightPos.c}` : "";

  React.useLayoutEffect(() => {
    const frame = frameRef.current;
    const scroller = scrollerRef.current;
    if (!frame || !scroller) return;
    const base = frame.getBoundingClientRect();
    const measure = (key: string): Rect | null => {
      if (!key) return null;
      const el = document.getElementById(`${uid}-cell-${key}`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: r.left - base.left,
        top: r.top - base.top,
        width: r.width,
        height: r.height,
      };
    };
    const view = scroller.getBoundingClientRect();
    const next = {
      tip: measure(tipKey),
      pill: measure(pillKey),
      viewLeft: view.left - base.left + stickyW,
      viewRight: view.right - base.left,
    };
    setRects((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    );
  });

  // Move focus (selectable) and scroll the active cell into view after a key.
  React.useEffect(() => {
    if (!moved.current || !active) return;
    moved.current = false;
    const el = document.getElementById(`${uid}-cell-${active.r}-${active.c}`);
    const scroller = scrollerRef.current;
    if (!el || !scroller) return;
    if (selectable) el.focus({ preventScroll: true });
    const s = scroller.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    if (e.left < s.left + stickyW) {
      scroller.scrollLeft -= s.left + stickyW - e.left + 4;
    } else if (e.right > s.right) {
      scroller.scrollLeft += e.right - s.right + 4;
    }
  }, [active, selectable, stickyW, uid]);

  // --- Keyboard ---------------------------------------------------------------
  const step = (from: Pos, dr: number, dc: number): Pos | null => {
    let r = from.r + dr;
    let c = from.c + dc;
    while (r >= 0 && r < R && c >= 0 && c < C) {
      if (navigable({ r, c })) return { r, c };
      r += dr;
      c += dc;
    }
    return null;
  };
  const jump = (to: Pos, dr: number, dc: number): Pos | null => {
    const p = { r: clamp(to.r, 0, R - 1), c: clamp(to.c, 0, C - 1) };
    if (navigable(p)) return p;
    return step(p, dr, dc) ?? step(p, -dr, -dc);
  };
  const edgeOfRow = (r: number, end: boolean) =>
    end ? step({ r, c: C }, 0, -1) : step({ r, c: -1 }, 0, 1);
  const edgeOfGrid = (end: boolean): Pos | null => {
    if (!end) return firstNavigable();
    for (let r = R - 1; r >= 0; r--) {
      const p = edgeOfRow(r, true);
      if (p) return p;
    }
    return null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setTipHidden(true);
      setHover(null);
      return;
    }
    const from = activePos;
    if (!from) return;
    let next: Pos | null;
    switch (e.key) {
      case "ArrowRight":
        next = step(from, 0, 1);
        break;
      case "ArrowLeft":
        next = step(from, 0, -1);
        break;
      case "ArrowDown":
        next = step(from, 1, 0);
        break;
      case "ArrowUp":
        next = step(from, -1, 0);
        break;
      case "Home":
        next = e.ctrlKey ? edgeOfGrid(false) : edgeOfRow(from.r, false);
        break;
      case "End":
        next = e.ctrlKey ? edgeOfGrid(true) : edgeOfRow(from.r, true);
        break;
      case "PageUp":
        // Calendar: about a month back. Others: five rows up.
        next =
          layout === "calendar"
            ? jump({ r: from.r, c: from.c - 4 }, 0, -1)
            : jump({ r: from.r - 5, c: from.c }, -1, 0);
        break;
      case "PageDown":
        next =
          layout === "calendar"
            ? jump({ r: from.r, c: from.c + 4 }, 0, 1)
            : jump({ r: from.r + 5, c: from.c }, 1, 0);
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next) {
      moved.current = true;
      setActive(next);
      setHover(null);
      setTipHidden(false);
    }
  };

  const posFromEvent = (e: React.SyntheticEvent): Pos | null => {
    const el = (e.target as Element).closest?.("[data-cell]");
    if (!el) return null;
    return {
      r: Number(el.getAttribute("data-r")),
      c: Number(el.getAttribute("data-c")),
    };
  };

  // --- Summary ----------------------------------------------------------------
  const names = (points: { row: number; column: number }[]) =>
    points.map((p) => model.cells[p.row]?.[p.column]?.summaryName ?? "");
  let summary = "";
  if (!streaming && model.values.length > 0) {
    if (layout === "calendar") {
      summary = calendarSummary(activityStats(model.days), locale);
    } else if (layout === "cohort") {
      const focus = cohortFocusColumn(model.grid);
      if (focus) {
        const col = model.colHeads[focus.column]?.sr ?? "";
        summary = `${col} ${format === "percent" ? "retention " : ""}averages ${formatValue(focus.average, { ...fmt, unit: undefined }, "full", locale)}`;
      }
    } else if (peaks.length > 0) {
      summary = `Highest: ${peakPhrase(names(peaks), full(peaks[0].value))}`;
      if (lows.length > 0) {
        summary += ` · Lowest: ${peakPhrase(names(lows), full(lows[0].value))}`;
      }
    }
  }

  // --- Legend -----------------------------------------------------------------
  const anyNull = model.cells.some((row) => row.some((c) => c.kind === "null"));
  const anyZero =
    scale?.kind === "sequential" &&
    scale.zeroBased &&
    model.values.some((v) => v === 0);
  const legendLevels = scale ? bucketLevels(scale) : [];
  const legendLabels = scale ? bucketLabels(scale, fmt, locale) : [];

  const chosen = decision
    ? model.cells.flat().find((cell) => matches(cell, decision))
    : undefined;
  const chosenName = chosen
    ? chosen.short
    : decision
      ? "date" in decision
        ? decision.date
        : `${decision.row} ${decision.column}`
      : null;

  const srSummary = [title, summary].filter(Boolean).join(": ");
  const pillVisible =
    !!rects.pill &&
    !!highlightText &&
    pillKey !== tipKey &&
    rects.pill.left + rects.pill.width / 2 >= rects.viewLeft &&
    rects.pill.left + rects.pill.width / 2 <= rects.viewRight;

  // --- Cells ------------------------------------------------------------------
  const box = { width: size, height: size };
  const renderCell = (cell: CellModel, r: number, c: number) => {
    const key = `${r}-${c}`;
    if (cell.kind === "blank") {
      return (
        <td key={key} aria-hidden className="p-0">
          <div style={box} />
        </td>
      );
    }
    if (cell.kind === "pending") {
      return (
        <td key={key} aria-hidden className="p-0">
          <Skeleton className="rounded-[3px]" style={box} />
        </td>
      );
    }
    const pos = { r, c };
    const level = levelAt(cell);
    const fill = fillFor(level);
    const isActive = activePos?.r === r && activePos?.c === c;
    const isHighlight = highlightPos?.r === r && highlightPos?.c === c;
    const isSelected = matches(cell, decision);
    const name = `${cell.label}: ${full(cell.value)}${isHighlight && highlight?.label ? `. ${highlight.label}` : ""}`;
    const text = showText && cell.kind === "value" ? compact(cell.value) : null;
    const content =
      text && text.length * 7 <= size - 4 ? (
        text
      ) : isLow(level) ? (
        <LowMark />
      ) : null;
    const visual = cn(
      "relative flex items-center justify-center rounded-[3px] text-xs font-medium tabular-nums transition-[background-color] duration-300 motion-reduce:transition-none",
      level.kind === "none"
        ? "border border-border bg-transparent"
        : toneFor(level),
      isHighlight &&
        "z-[1] ring-2 ring-foreground/70 ring-offset-1 ring-offset-card",
      isSelected &&
        "z-[1] ring-2 ring-foreground ring-offset-2 ring-offset-card",
    );

    if (selectable) {
      const canPick = !locked && cell.kind === "value";
      return (
        <td key={key} data-cell="" data-r={r} data-c={c} className="p-0">
          <button
            id={domId(pos)}
            type="button"
            tabIndex={isActive ? 0 : -1}
            aria-label={name}
            aria-pressed={isSelected}
            aria-disabled={canPick ? undefined : true}
            onClick={() => select(cell)}
            onFocus={() => {
              setActive(pos);
              setFocused(true);
              setTipHidden(false);
            }}
            onBlur={() => setFocused(false)}
            className={cn(
              visual,
              "outline-none focus-visible:z-[2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              canPick ? "cursor-pointer" : "cursor-default",
            )}
            style={{ ...box, background: fill }}
          >
            {content}
          </button>
        </td>
      );
    }
    return (
      <td
        key={key}
        id={domId(pos)}
        aria-label={name}
        data-cell=""
        data-r={r}
        data-c={c}
        className="p-0"
      >
        <div
          className={cn(
            visual,
            isActive &&
              focused &&
              "z-[2] outline-2 outline-offset-2 outline-ring",
          )}
          style={{ ...box, background: fill }}
        >
          {content}
        </div>
      </td>
    );
  };

  const sticky =
    "sticky z-[3] bg-(--surface-bg) p-0 font-normal text-muted-foreground";
  const fixedW = (w: number) => ({ width: w, minWidth: w, maxWidth: w });

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="heatmap"
        data-status={status}
        data-layout={layout}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Heatmap"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && (
            <SurfaceDescription>{description}</SurfaceDescription>
          )}
        </SurfaceHeader>

        {(summary || streaming) && (
          <div className={cn("border-t border-border py-3", surfaceInset)}>
            {summary ? (
              <p className={cn(genuiType.body, "font-medium tabular-nums")}>
                {summary}
              </p>
            ) : (
              <Skeleton className="mt-0.5 h-4 w-56" />
            )}
          </div>
        )}

        <figure
          aria-label={srSummary || undefined}
          className={cn(
            "m-0 flex flex-col gap-3 border-t border-border py-3",
            surfaceInset,
          )}
        >
          <div
            ref={frameRef}
            className="relative w-full [--heatmap-high:var(--chart-5)] [--heatmap-low:var(--chart-2)] dark:[--heatmap-high:var(--chart-1)] dark:[--heatmap-low:var(--chart-2)]"
          >
            {hasGrid ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
              >
                <ScrollFade
                  scrollRef={scrollerRef}
                  viewportClassName="overscroll-x-contain"
                  className="[--scroller-bg:var(--surface-bg)]"
                  onScroll={() => setScrollTick((t) => t + 1)}
                >
                  <table
                    // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a data grid is a table with grid behaviour (APG data grid); its cells act as gridcells
                    role="grid"
                    aria-labelledby={title ? titleId : undefined}
                    aria-label={title ? undefined : "Heatmap"}
                    aria-describedby={hintId}
                    aria-readonly={selectable ? undefined : true}
                    aria-activedescendant={
                      !selectable && activePos ? domId(activePos) : undefined
                    }
                    tabIndex={selectable ? -1 : 0}
                    onKeyDown={onKeyDown}
                    onFocus={() => {
                      if (!selectable) {
                        setFocused(true);
                        setTipHidden(false);
                      }
                    }}
                    onBlur={() => {
                      if (!selectable) setFocused(false);
                    }}
                    onPointerOver={(e) => {
                      const p = posFromEvent(e);
                      if (p) setHover(p);
                    }}
                    onPointerLeave={() => setHover(null)}
                    onClick={(e) => {
                      const p = posFromEvent(e);
                      if (p && navigable(p)) setActive(p);
                    }}
                    className="w-max border-separate outline-none"
                    style={{ borderSpacing: gap }}
                  >
                    {layout === "calendar" ? (
                      <thead aria-hidden>
                        <tr>
                          <td colSpan={C + 1} className="p-0">
                            <div className="relative h-4 text-xs leading-none text-muted-foreground">
                              {model.months.map((m) => (
                                <span
                                  key={`${m.column}-${m.text}`}
                                  className="absolute bottom-0.5 whitespace-nowrap"
                                  style={{
                                    left: labelW + gap + m.column * pitch,
                                  }}
                                >
                                  {m.text}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      </thead>
                    ) : (
                      <thead>
                        <tr>
                          <th
                            scope="col"
                            data-sticky-start
                            className={cn(sticky, "left-0")}
                            style={{ ...fixedW(labelW), height: headH }}
                          >
                            <span className="sr-only">
                              {layout === "cohort" ? "Cohort" : ""}
                            </span>
                          </th>
                          {model.sizes && (
                            <th
                              scope="col"
                              data-sticky-start
                              className={cn(
                                sticky,
                                "pe-1 pb-0.5 text-end align-bottom text-xs leading-none",
                              )}
                              style={{
                                ...fixedW(sizeW),
                                left: labelW + gap,
                                height: headH,
                              }}
                            >
                              <span aria-hidden>Size</span>
                              <span className="sr-only">Cohort size</span>
                            </th>
                          )}
                          {model.colHeads.map((h, c) => (
                            <th
                              // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                              key={c}
                              scope="col"
                              className="p-0 align-bottom text-xs leading-none font-normal text-muted-foreground"
                            >
                              <span className="sr-only">{h.sr}</span>
                              <span
                                aria-hidden
                                className="flex items-end justify-center pb-0.5"
                                style={{ width: size, height: headH }}
                              >
                                <span
                                  className={cn(
                                    "whitespace-nowrap",
                                    rotate &&
                                      "max-h-full truncate [writing-mode:vertical-rl] rotate-180",
                                  )}
                                >
                                  {c % labelEvery === 0 ? h.text : ""}
                                </span>
                              </span>
                            </th>
                          ))}
                        </tr>
                      </thead>
                    )}
                    <tbody>
                      {model.cells.map((row, r) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
                        <tr key={r}>
                          <th
                            scope="row"
                            data-sticky-start
                            className={cn(
                              sticky,
                              "left-0 pe-1.5 text-start align-middle text-xs leading-none",
                            )}
                            style={{ ...fixedW(labelW), height: size }}
                          >
                            {layout === "calendar" ? (
                              <>
                                <span className="sr-only">
                                  {model.rowHeads[r]?.sr}
                                </span>
                                <span aria-hidden>
                                  {model.rowHeads[r]?.text}
                                </span>
                              </>
                            ) : (
                              <span
                                className="block truncate"
                                title={model.rowHeads[r]?.sr}
                              >
                                {model.rowHeads[r]?.text}
                              </span>
                            )}
                          </th>
                          {model.sizes && (
                            <td
                              data-sticky-start
                              className={cn(
                                sticky,
                                "pe-1 text-end align-middle text-xs tabular-nums",
                              )}
                              style={{ ...fixedW(sizeW), left: labelW + gap }}
                            >
                              {model.sizes[r]}
                            </td>
                          )}
                          {row.map((cell, c) => renderCell(cell, r, c))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollFade>
              </motion.div>
            ) : streaming ? (
              <Skeleton
                className={cn(
                  "w-full rounded-[10px]",
                  layout === "calendar" ? "h-[120px]" : "h-40",
                )}
              />
            ) : (
              <p className="py-6 text-center text-[13px] text-muted-foreground">
                No data to show.
              </p>
            )}

            {tipCell && rects.tip && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-20 flex w-max max-w-56 flex-col rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm dark:shadow-none"
                style={{
                  left: clamp(
                    rects.tip.left + rects.tip.width / 2,
                    72,
                    width - 72,
                  ),
                  top:
                    rects.tip.top < 44
                      ? rects.tip.top + rects.tip.height + 6
                      : rects.tip.top - 6,
                  transform:
                    rects.tip.top < 44
                      ? "translateX(-50%)"
                      : "translate(-50%, -100%)",
                }}
              >
                <span className="font-medium">{tipCell.short}</span>
                <span className="tabular-nums text-muted-foreground">
                  {full(tipCell.value)}
                </span>
              </div>
            )}

            {pillVisible && rects.pill && (
              <span
                aria-hidden
                className="pointer-events-none absolute z-10 inline-flex h-6 items-center whitespace-nowrap rounded-full border bg-card px-2.5 text-xs font-medium text-foreground shadow-sm dark:shadow-none"
                style={{
                  left: clamp(
                    rects.pill.left + rects.pill.width / 2,
                    56,
                    width - 56,
                  ),
                  top:
                    rects.pill.top < 28
                      ? rects.pill.top + rects.pill.height + 5
                      : rects.pill.top - 5,
                  transform:
                    rects.pill.top < 28
                      ? "translateX(-50%)"
                      : "translate(-50%, -100%)",
                }}
              >
                {highlightText}
              </span>
            )}
          </div>

          {scale && (
            <motion.ul
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              aria-label="Legend"
              className={cn(
                "flex flex-wrap gap-x-3 gap-y-1.5 tabular-nums",
                genuiType.meta,
              )}
            >
              {anyZero && (
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="size-3 rounded-sm bg-muted" />
                  {compact(0)}
                </li>
              )}
              {legendLevels.map((level, i) => {
                const midpoint =
                  scale.kind === "diverging" ? compact(scale.midpoint) : "";
                const even = scale.count % 2 === 0;
                const swatch = (l: Level) => (
                  <span
                    aria-hidden
                    className={cn(
                      "relative size-3 shrink-0 rounded-sm",
                      toneFor(l),
                    )}
                    style={{ background: fillFor(l) }}
                  >
                    {isLow(l) && <LowMark />}
                  </span>
                );
                return (
                  <React.Fragment key={legendLabels[i]}>
                    {scale.kind === "diverging" &&
                      even &&
                      i === scale.count / 2 && (
                        <li className="flex items-center gap-1.5">
                          {swatch({
                            kind: "bucket",
                            index: -1,
                            side: "mid",
                            strength: 0,
                          })}
                          {`Midpoint ${midpoint}`}
                        </li>
                      )}
                    <li className="flex items-center gap-1.5">
                      {swatch(level)}
                      {legendLabels[i]}
                      {level.side === "mid" && ` (midpoint ${midpoint})`}
                    </li>
                  </React.Fragment>
                );
              })}
              {anyNull && (
                <li className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-3 rounded-sm border bg-transparent"
                  />
                  No data
                </li>
              )}
            </motion.ul>
          )}
        </figure>

        <p id={hintId} className="sr-only">
          {selectable
            ? "Arrow keys move between cells. Press Enter to choose one."
            : "Arrow keys move between cells."}
        </p>
        {highlightCell && highlightText && (
          <p className="sr-only">
            {`Highlighted: ${highlightCell.label}, ${full(highlightCell.value)}${highlight?.label ? ` (${highlight.label})` : ""}`}
          </p>
        )}
        {!streaming && model.values.length > 0 && (
          <SrData layout={layout} model={model} title={title} full={full} />
        )}

        {selectable && (
          // The live region stays mounted; the footer shows only real state.
          <div aria-live="polite">
            {status === "submitted" ? (
              <SurfaceFooter>
                <p className="flex items-center gap-1.5 text-[13px]">
                  <CheckIcon aria-hidden className="size-4" />
                  {chosenName ? `Selected ${chosenName}` : "Selection sent"}
                </p>
              </SurfaceFooter>
            ) : streaming ? (
              <SurfaceFooter>
                <p className={genuiType.meta}>
                  <ShimmeringText
                    text="Loading…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                </p>
              </SurfaceFooter>
            ) : (
              <p className="sr-only">
                {layout === "calendar"
                  ? "Choose a day in the calendar."
                  : "Choose a cell in the grid."}
              </p>
            )}
          </div>
        )}
      </Surface>
    </MotionConfig>
  );
}

/** The data for assistive tech: the full table, or for a calendar the top days and monthly totals. */
function SrData({
  layout,
  model,
  title,
  full,
}: {
  layout: Layout;
  model: Model;
  title?: string;
  full: (v: number | null) => string;
}) {
  const locale = useGenUILocale();
  if (layout === "calendar") {
    const long = new Intl.DateTimeFormat(locale, {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
    const monthName = new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const top = model.days
      .filter((d): d is { date: string; value: number } => d.value !== null)
      .sort((a, b) => b.value - a.value || a.date.localeCompare(b.date, locale))
      .slice(0, 10);
    return (
      <div className="sr-only">
        <p>Top days</p>
        <ol>
          {top.map((d) => (
            <li
              key={d.date}
            >{`${long.format(utcDate(d.date))}: ${full(d.value)}`}</li>
          ))}
        </ol>
        <table>
          <caption>{`${title ?? "Activity"}, by month`}</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Total</th>
              <th scope="col">Active days</th>
            </tr>
          </thead>
          <tbody>
            {monthlyTotals(model.days).map((m) => (
              <tr key={m.month}>
                <th scope="row">
                  {monthName.format(utcDate(`${m.month}-01`))}
                </th>
                <td>{m.days > 0 ? full(m.total) : "No data"}</td>
                <td>{m.active}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <table className="sr-only">
      <caption>{title ?? "Heatmap data"}</caption>
      <thead>
        <tr>
          <th scope="col">{layout === "cohort" ? "Cohort" : ""}</th>
          {model.sizes && <th scope="col">Cohort size</th>}
          {model.colHeads.map((h, c) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
            <th key={c} scope="col">
              {h.sr}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {model.cells.map((row, r) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <tr key={r}>
            <th scope="row">{model.rowHeads[r]?.sr}</th>
            {model.sizes && <td>{model.sizes[r]}</td>}
            {row.map((cell, c) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional
              <td key={c}>{cell.kind === "blank" ? "" : full(cell.value)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
