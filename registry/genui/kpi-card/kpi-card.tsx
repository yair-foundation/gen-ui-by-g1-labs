"use client";

import * as React from "react";
import { ArrowDownRightIcon, ArrowUpRightIcon, MinusIcon } from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";
import { useGenUILocale } from "@/components/genui/locale";

import type {
  KpiAction,
  KpiBars,
  KpiCardInput,
  KpiCardResult,
  KpiDotsRow,
  KpiHeadline,
  KpiItem,
  KpiPeriod,
  KpiSegments,
  KpiTile,
  KpiValue,
} from "./kpi-card.schema";
import {
  type FillToken,
  TREEMAP_FILLS,
  TREEMAP_OTHER_FILL,
  type ValueFormat,
  barScale,
  deltaDirection,
  describeDelta,
  formatDelta,
  formatValue,
  layoutTiles,
  mergeSmallTiles,
  niceTicks,
  rollerParts,
  segmentFractions,
  textToneFor,
  tileDetail,
} from "./kpi-card-utils";
import { IconTip } from "@/components/genui/hint";
import { Segmented } from "@/components/genui/segmented";
import { SERIES_BG, SERIES_VARS } from "@/components/genui/series-colors";

type SegmentPart = KpiSegments["parts"][number];
type Bar = KpiBars["bars"][number];

/** The visual as it arrives while the tool call streams. */
export type KpiVisualPartial =
  | ({ type: "segments" } & Partial<Omit<KpiSegments, "type" | "parts">> & {
        parts?: Partial<SegmentPart>[];
      })
  | { type: "dots"; rows?: Partial<KpiDotsRow>[] }
  | { type: "treemap"; tiles?: Partial<KpiTile>[] }
  | ({ type: "bars" } & Partial<Omit<KpiBars, "type" | "bars">> & {
        bars?: Partial<Bar>[];
      })
  | { type?: undefined };

/** One period's metrics, partial while streaming. */
export type KpiBlockPartial = {
  headline?: Partial<KpiHeadline>;
  visual?: KpiVisualPartial;
  items?: Partial<KpiItem>[];
  footer?: Partial<KpiValue>;
};

export type KpiCardProps = Partial<
  Omit<KpiCardInput, "data" | "periods" | "action">
> & {
  /** May be partial while the tool call streams. */
  periods?: Partial<KpiPeriod>[];
  data?: Record<string, KpiBlockPartial | undefined>;
  action?: Partial<KpiAction>;
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready";
  /**
   * Called when the user presses the header's arrow button. The card stays
   * live afterwards; there's no finished state to restore.
   */
  onResult?: (result: KpiCardResult) => void;
  className?: string;
};

// Segment and legend fills by position: the categorical colours (vermilion,
// cool blue, cassis, sage, wasabi; validated as neighbours in both themes, see
// series-colors). The legend beside them carries every name and value.
const SEGMENT_BG = SERIES_BG;
/** The primary mark: filled dots and the highlighted bar. */
const PRIMARY_BG = "bg-chart-5 dark:bg-chart-1";
const BAR_BG = "bg-chart-2";
/** Forecast bars: a hatch of the border color (no gradient fills). */
const HATCH: React.CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 6px)",
};

// Treemap tile classes, per theme, from the contrast-checked fill table.
const LIGHT_BG: Record<FillToken, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
  muted: "bg-muted ring-1 ring-inset ring-border",
};
const DARK_BG: Record<FillToken, string> = {
  "chart-1": "dark:bg-chart-1",
  "chart-2": "dark:bg-chart-2",
  "chart-3": "dark:bg-chart-3",
  "chart-4": "dark:bg-chart-4",
  "chart-5": "dark:bg-chart-5",
  muted: "dark:bg-muted dark:ring-1 dark:ring-inset dark:ring-border",
};
const LIGHT_TEXT = { light: "text-card", dark: "text-foreground" };
const DARK_TEXT = {
  light: "dark:text-foreground",
  dark: "dark:text-background",
};

function tileClasses(slot: { light: FillToken; dark: FillToken }) {
  return cn(
    LIGHT_BG[slot.light],
    DARK_BG[slot.dark],
    LIGHT_TEXT[textToneFor("light", slot.light)],
    DARK_TEXT[textToneFor("dark", slot.dark)],
  );
}

const TILE_GAP = 4;
const TILE_MIN = 56;

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const;

/** A validated BCP 47 tag; the host's locale when missing or invalid. */
function safeLocale(locale: string | undefined, fallback: string) {
  if (!locale) return fallback;
  try {
    return Intl.getCanonicalLocales(locale)[0] ?? fallback;
  } catch {
    return fallback;
  }
}

function useWidth<T extends HTMLElement>() {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.round(entry.contentRect.width)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isFormat = (v: unknown): v is KpiValue["format"] =>
  v === "currency" || v === "number" || v === "percent";

// ---------------------------------------------------------------------------
// Values and deltas
// ---------------------------------------------------------------------------

/**
 * A formatted number that rolls its digits when it changes (e.g. on a period
 * switch). The real text is in an sr-only span; the roller is hidden.
 */
function AnimatedValue({
  value,
  fmt,
  className,
}: {
  value: number;
  fmt: ValueFormat;
  className?: string;
}) {
  const text = formatValue(value, fmt);
  const parts = rollerParts(value, fmt);
  if (!parts) {
    return <span className={cn("tabular-nums", className)}>{text}</span>;
  }
  return (
    <span className={cn("inline-flex tabular-nums", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex items-center whitespace-pre">
        {parts.prefix}
        <SlidingNumber
          key={`${fmt.format}-${fmt.currency}`}
          number={parts.number}
          decimalPlaces={parts.decimals}
          decimalSeparator={parts.decimalSeparator}
          thousandSeparator={parts.thousandSeparator}
          initiallyStable
        />
        {parts.suffix}
      </span>
    </span>
  );
}

/** Sign, arrow and text; never color alone. */
function Delta({
  delta,
  label,
  locale,
  className,
}: {
  delta: number;
  label?: string;
  locale: string;
  className?: string;
}) {
  const dir = deltaDirection(delta);
  const Icon =
    dir === "up"
      ? ArrowUpRightIcon
      : dir === "down"
        ? ArrowDownRightIcon
        : MinusIcon;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 text-[13px] tabular-nums",
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      <span aria-hidden>{formatDelta(delta, locale)}</span>
      {/* The label ("vs last week") is read out but not repeated on every row. */}
      <span className="sr-only">{describeDelta(delta, locale, label)}</span>
    </span>
  );
}

/** A change beside a value: tinted badge, magnitude only. Up is green unless `upIsBad`. */
function DeltaBadge({
  delta,
  label,
  locale,
  upIsBad,
}: {
  delta: number;
  label?: string;
  locale: string;
  upIsBad?: boolean;
}) {
  const dir = deltaDirection(delta);
  const Icon =
    dir === "up"
      ? ArrowUpRightIcon
      : dir === "down"
        ? ArrowDownRightIcon
        : null;
  const good = upIsBad ? dir === "down" : dir === "up";
  const variant = dir === "flat" ? "outline" : good ? "success" : "destructive";
  return (
    <Badge variant={variant} className="h-5 shrink-0 tabular-nums">
      {Icon && <Icon aria-hidden />}
      <span aria-hidden>
        {formatDelta(Math.abs(delta), locale).replace(/^\+/, "")}
      </span>
      {/* The label ("vs last week") is read out but not repeated on every row. */}
      <span className="sr-only">{describeDelta(delta, locale, label)}</span>
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Period switch
// ---------------------------------------------------------------------------

function PeriodSwitch({
  periods,
  active,
  title,
  disabled,
  onChange,
}: {
  periods: KpiPeriod[];
  active: string;
  title: string;
  disabled: boolean;
  onChange: (key: string) => void;
}) {
  return (
    <Segmented
      label={`Period for ${title}`}
      value={active}
      options={periods.map((p) => ({ value: p.key, label: p.label }))}
      onChange={onChange}
      disabled={disabled}
    />
  );
}

// ---------------------------------------------------------------------------
// Items under the headline
// ---------------------------------------------------------------------------

/** Tiles per row on a wide card: all of them up to 4, then split evenly (5 → 3+2). */
const itemColumns = (n: number) =>
  n <= 4 ? Math.max(1, n) : n === 5 || n === 6 || n === 9 ? 3 : 4;
const ITEM_COLUMNS: Record<number, string> = {
  1: "",
  2: "@md:grid-cols-2",
  3: "@md:grid-cols-3",
  4: "@md:grid-cols-4",
};

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

function SegmentsVisual({
  parts,
  fmt,
  caption,
}: {
  parts: SegmentPart[];
  fmt: ValueFormat;
  caption: string;
}) {
  const fractions = segmentFractions(parts.map((p) => p.value));
  const pct = (f: number) =>
    new Intl.NumberFormat(fmt.locale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(f);
  const largest = parts.reduce(
    (best, p, i) => (p.value > parts[best].value ? i : best),
    0,
  );
  return (
    <figure
      aria-label={`Stacked bar, ${parts.length} ${parts.length === 1 ? "part" : "parts"}. Largest: ${parts[largest].label}, ${formatValue(parts[largest].value, fmt)} (${pct(fractions[largest])}).`}
    >
      <div aria-hidden className="flex h-3 w-full gap-[3px]">
        {parts.map((_, i) =>
          fractions[i] > 0 ? (
            <motion.span
              // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
              key={i}
              className={cn("block h-full rounded-full", SEGMENT_BG[i])}
              style={{ flexBasis: 0 }}
              initial={{ flexGrow: 0 }}
              animate={{ flexGrow: fractions[i] }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          ) : null,
        )}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
            <tr key={i}>
              <th scope="row">{p.label}</th>
              <td>{formatValue(p.value, fmt)}</td>
              <td>{pct(fractions[i])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** The legend when there are no items: the table above carries it for AT. */
function PartsLegend({
  parts,
  fmt,
}: {
  parts: SegmentPart[];
  fmt: ValueFormat;
}) {
  return (
    <ul aria-hidden className="flex flex-wrap gap-x-8 gap-y-2.5">
      {parts.map((p, i) => (
        <motion.li
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
          key={i}
          {...enter}
          className="flex flex-[1_1_min(100%,14rem)] items-center gap-2 text-[13px]"
        >
          <span
            className={cn("size-2.5 shrink-0 rounded-[3px]", SEGMENT_BG[i])}
          />
          <span className="min-w-0 flex-1 truncate">{p.label}</span>
          <AnimatedValue value={p.value} fmt={fmt} className="font-medium" />
        </motion.li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Dots
// ---------------------------------------------------------------------------

function DotsVisual({
  rows,
  locale,
  streaming,
  caption,
}: {
  rows: KpiDotsRow[];
  locale: string;
  streaming: boolean;
  caption: string;
}) {
  const fmtFor = (r: KpiDotsRow): ValueFormat => ({
    format: r.format,
    currency: r.currency,
    locale,
  });
  const counts = (r: KpiDotsRow) => {
    const total = Math.max(1, Math.min(10, Math.round(r.total)));
    const filled = Math.max(0, Math.min(total, Math.round(r.filled)));
    return { total, filled };
  };
  return (
    <figure
      aria-label={`${rows.length} ${rows.length === 1 ? "meter" : "meters"}: ${rows
        .map((r) => {
          const c = counts(r);
          return `${r.label} ${c.filled} of ${c.total}`;
        })
        .join(", ")}.`}
    >
      <ul aria-hidden className="flex flex-wrap gap-x-10 gap-y-4">
        {rows.map((r, i) => {
          const { total, filled } = counts(r);
          return (
            <motion.li
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
              key={i}
              {...enter}
              className="flex flex-[1_1_min(100%,18rem)] items-center justify-between gap-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className={cn("truncate", genuiType.meta)}>
                  {r.label}
                </span>
                <AnimatedValue
                  value={r.value}
                  fmt={fmtFor(r)}
                  className="font-figure text-[30px] font-normal tracking-tight leading-none"
                />
              </div>
              <div className="flex shrink-0 items-center">
                <span className="flex gap-1.5">
                  {Array.from({ length: total }, (_, d) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional
                      key={d}
                      className={cn(
                        "size-3.5 rounded-full transition-colors",
                        d < filled
                          ? "bg-choice"
                          : "border border-muted-foreground/60",
                      )}
                    />
                  ))}
                </span>
              </div>
            </motion.li>
          );
        })}
        {streaming && (
          <li className="flex flex-[1_1_min(100%,18rem)] items-center justify-between gap-4">
            <span className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-28" />
            </span>
            <Skeleton className="h-3.5 w-28" />
          </li>
        )}
      </ul>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Value</th>
            <th scope="col">Progress</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const { total, filled } = counts(r);
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
              <tr key={i}>
                <th scope="row">{r.label}</th>
                <td>{formatValue(r.value, fmtFor(r))}</td>
                <td>{`${filled} of ${total}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Treemap
// ---------------------------------------------------------------------------

function TreemapVisual({
  tiles,
  locale,
  caption,
}: {
  tiles: KpiTile[];
  locale: string;
  caption: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  // Same as the box's CSS: 1.45:1, at least 240px tall.
  const height = Math.max(240, Math.round(width / 1.45));
  const pct = (share: number) =>
    formatValue(share, { format: "percent", locale });

  const shown =
    width > 0
      ? mergeSmallTiles(tiles, width, height, { min: TILE_MIN, gap: TILE_GAP })
      : [];
  const rects =
    width > 0
      ? layoutTiles(
          shown.map((t) => t.share),
          width,
          height,
          TILE_GAP,
        )
      : [];
  // Fill by rank; "Other" is always muted.
  let rank = 0;
  const placed = rects.map((r) => {
    const tile = shown[r.index];
    const slot = tile.other
      ? TREEMAP_OTHER_FILL
      : (TREEMAP_FILLS[rank++] ?? TREEMAP_OTHER_FILL);
    return { ...r, tile, slot };
  });

  const sorted = [...tiles].sort((a, b) => b.share - a.share);
  const top = sorted[0];
  const mergedCount = shown.find((t) => t.other)?.merged?.length ?? 0;

  return (
    <figure
      aria-label={`Treemap, ${tiles.length} ${tiles.length === 1 ? "category" : "categories"}. Largest: ${top.label}, ${pct(top.share)}.${mergedCount > 0 ? ` ${mergedCount} small categories are grouped as Other.` : ""}`}
    >
      <div
        ref={ref}
        aria-hidden
        className="relative aspect-[1.45] min-h-60 w-full"
      >
        {placed.map((p) => {
          const detail = tileDetail(p.w, p.h);
          const showDelta =
            isNum(p.tile.delta) &&
            (detail === "full" || (detail === "medium" && p.w >= 120));
          return (
            <motion.div
              key={p.tile.label}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className={cn(
                "absolute flex flex-col justify-between gap-1 overflow-hidden rounded-lg",
                detail === "small" ? "p-2" : "p-3",
                tileClasses(p.slot),
              )}
              style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
            >
              <span className="w-full truncate text-[13px] font-medium">
                {p.tile.label}
              </span>
              <div className="flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
                <span
                  className={cn(
                    "font-semibold tracking-tight tabular-nums leading-none",
                    detail === "full"
                      ? "text-2xl"
                      : detail === "medium"
                        ? "text-[16px]"
                        : "text-[13px]",
                  )}
                >
                  {pct(p.tile.share)}
                </span>
                {showDelta && isNum(p.tile.delta) && (
                  <Delta
                    delta={p.tile.delta}
                    locale={locale}
                    className="rounded-full bg-card px-1.5 py-0.5 font-medium text-card-foreground"
                  />
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Category</th>
            <th scope="col">Share</th>
            <th scope="col">Change</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
            <tr key={i}>
              <th scope="row">{t.label}</th>
              <td>{pct(t.share)}</td>
              <td>{isNum(t.delta) ? describeDelta(t.delta, locale) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Bars
// ---------------------------------------------------------------------------

function BarsVisual({
  bars,
  highlight,
  forecastFrom,
  fmt,
  caption,
}: {
  bars: Bar[];
  highlight?: string;
  forecastFrom?: string;
  fmt: ValueFormat;
  caption: string;
}) {
  const values = bars.map((b) => b.value);
  const ticks = niceTicks(Math.max(...values), 4);
  const top = ticks[ticks.length - 1];
  const axis = (v: number) => formatValue(v, { ...fmt, compact: true });
  const forecastIndex = forecastFrom
    ? bars.findIndex((b) => b.label === forecastFrom)
    : -1;
  const isForecast = (i: number) => forecastIndex >= 0 && i >= forecastIndex;
  const highest = bars.reduce(
    (best, b, i) => (b.value > bars[best].value ? i : best),
    0,
  );
  const highlighted = bars.find((b) => b.label === highlight);
  const longestTick = ticks
    .map(axis)
    .reduce((a, b) => (b.length > a.length ? b : a));

  return (
    <figure
      aria-label={[
        `Bar chart, ${bars.length} bars from ${bars[0].label} to ${bars[bars.length - 1].label}.`,
        `Highest: ${bars[highest].label}, ${formatValue(bars[highest].value, fmt)}.`,
        highlighted
          ? `Highlighted: ${highlighted.label}, ${formatValue(highlighted.value, fmt)}.`
          : "",
        forecastIndex >= 0 ? `Forecast from ${forecastFrom}.` : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        aria-hidden
        className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5 pt-5"
      >
        {/* Y axis: an invisible copy of the widest label sizes the column. */}
        <div className="relative h-40 text-end text-[13px] tabular-nums text-muted-foreground">
          <span className="invisible block h-0 overflow-hidden">
            {longestTick}
          </span>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute end-0 translate-y-1/2 leading-none"
              style={{ bottom: `${(t / top) * 100}%` }}
            >
              {axis(t)}
            </span>
          ))}
        </div>
        <div className="relative h-40">
          {ticks.map((t) => (
            <span
              key={t}
              className={cn(
                "absolute inset-x-0 border-t border-border",
                t > 0 && "border-dashed",
              )}
              style={{ bottom: `${(t / top) * 100}%` }}
            />
          ))}
          <div className="absolute inset-0 flex items-end gap-1 sm:gap-1.5">
            {bars.map((b, i) => {
              const h = barScale(b.value, top) * 100;
              const on = b.label === highlight;
              const forecast = isForecast(i);
              return (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
                  key={i}
                  className="relative flex h-full min-w-0 flex-1 items-end justify-center"
                >
                  <motion.div
                    className={cn(
                      "w-full max-w-7 rounded-t-md rounded-b-sm",
                      forecast
                        ? "border border-dashed border-muted-foreground/60"
                        : on
                          ? PRIMARY_BG
                          : BAR_BG,
                    )}
                    style={forecast ? HATCH : undefined}
                    initial={{ height: 0 }}
                    animate={{ height: `${h}%` }}
                    transition={{ duration: 0.4, ease: "easeOut" }}
                  />
                  {on && (
                    <span
                      className="absolute whitespace-nowrap text-[13px] font-semibold tabular-nums"
                      style={{ bottom: `calc(${h}% + 4px)` }}
                    >
                      {axis(b.value)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <span />
        <div className="flex gap-1 sm:gap-1.5">
          {bars.map((b, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
              key={i}
              className={cn(
                "min-w-0 flex-1 truncate text-center text-[13px]",
                b.label === highlight
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>
      {forecastIndex >= 0 && (
        // Only the hatch needs a key; solid bars read as actuals.
        <div aria-hidden className={cn("mt-3 flex", genuiType.meta)}>
          <span className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[3px] border border-dashed border-muted-foreground/60"
              style={HATCH}
            />
            Forecast
          </span>
        </div>
      )}
      <table className="sr-only">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Value</th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
            <tr key={i}>
              <th scope="row">{b.label}</th>
              <td>{formatValue(b.value, fmt)}</td>
              <td>
                {[
                  b.label === highlight ? "Highlighted" : "",
                  isForecast(i) ? "Forecast" : "",
                ]
                  .filter(Boolean)
                  .join(", ") || "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

function Visual({
  visual,
  streaming,
  fallback,
  locale,
  caption,
}: {
  visual: KpiVisualPartial | undefined;
  streaming: boolean;
  /** The headline's format, for visuals that don't set their own. */
  fallback: ValueFormat;
  locale: string;
  caption: string;
}) {
  if (!visual?.type) return null;
  switch (visual.type) {
    case "segments": {
      const parts = (visual.parts ?? []).filter(
        (p): p is SegmentPart => typeof p.label === "string" && isNum(p.value),
      );
      // Widths depend on every part, so wait for the whole set.
      if (streaming || parts.length === 0)
        return <Skeleton className="h-3 w-full rounded-full" />;
      const fmt: ValueFormat = {
        format: visual.format ?? fallback.format,
        currency: visual.currency ?? fallback.currency,
        locale,
      };
      return <SegmentsVisual parts={parts} fmt={fmt} caption={caption} />;
    }
    case "dots": {
      const rows = (visual.rows ?? []).filter(
        (r): r is KpiDotsRow =>
          typeof r.label === "string" &&
          isNum(r.value) &&
          isFormat(r.format) &&
          isNum(r.filled) &&
          isNum(r.total),
      );
      if (rows.length === 0 && !streaming) return null;
      return (
        <DotsVisual
          rows={rows}
          locale={locale}
          streaming={streaming}
          caption={caption}
        />
      );
    }
    case "treemap": {
      const tiles = (visual.tiles ?? []).filter(
        (t): t is KpiTile =>
          typeof t.label === "string" && isNum(t.share) && t.share > 0,
      );
      if (streaming || tiles.length === 0)
        return <Skeleton className="aspect-[1.45] min-h-60 w-full rounded-lg" />;
      return <TreemapVisual tiles={tiles} locale={locale} caption={caption} />;
    }
    case "bars": {
      const bars = (visual.bars ?? []).filter(
        (b): b is Bar => typeof b.label === "string" && isNum(b.value),
      );
      if (streaming || bars.length < 2)
        return <Skeleton className="h-52 w-full rounded-[10px]" />;
      const fmt: ValueFormat = {
        format: visual.format ?? fallback.format,
        currency: visual.currency ?? fallback.currency,
        locale,
      };
      return (
        <BarsVisual
          bars={bars}
          highlight={visual.highlight}
          forecastFrom={visual.forecastFrom}
          fmt={fmt}
          caption={caption}
        />
      );
    }
    default:
      return null;
  }
}

export function KpiCard({
  title,
  periods: periodsProp = [],
  defaultPeriod,
  data = {},
  action,
  locale: localeProp,
  status: lifecycle = "ready",
  onResult,
  className,
}: KpiCardProps) {
  const hostLocale = useGenUILocale();
  const streaming = lifecycle === "streaming";
  // The agent's locale, when it sets one, wins over the host's.
  const locale = safeLocale(localeProp, hostLocale);
  const titleId = React.useId();
  const [picked, setPicked] = React.useState<string | null>(null);

  const periods = periodsProp.filter(
    (p): p is KpiPeriod =>
      typeof p.key === "string" && typeof p.label === "string",
  );
  const hasPeriods = periods.length > 1;
  const keys = periods.map((p) => p.key);
  const active = hasPeriods
    ? picked && keys.includes(picked)
      ? picked
      : defaultPeriod && keys.includes(defaultPeriod)
        ? defaultPeriod
        : keys[0]
    : undefined;
  const block: KpiBlockPartial | undefined =
    (active ? data[active] : undefined) ??
    data.default ??
    (hasPeriods ? undefined : Object.values(data)[0]);
  const activeLabel = periods.find((p) => p.key === active)?.label;
  const caption = [title, activeLabel].filter(Boolean).join(", ") || "Metrics";

  const actionKind = action?.kind;
  const showAction = Boolean(action?.label && actionKind);

  const headline = block?.headline;
  const headlineReady = isNum(headline?.value) && isFormat(headline?.format);
  const fallback: ValueFormat = {
    format: headlineReady ? headline?.format : undefined,
    currency: headline?.currency,
    locale,
  };
  const visual = block?.visual;
  const items = (block?.items ?? []).filter(
    (i): i is KpiItem =>
      typeof i.label === "string" && isNum(i.value) && isFormat(i.format),
  );
  const footer = block?.footer;
  const footerReady =
    typeof footer?.label === "string" &&
    isNum(footer.value) &&
    isFormat(footer.format);
  const isSegments = visual?.type === "segments";
  const segmentParts =
    visual?.type === "segments"
      ? (visual.parts ?? []).filter(
          (p): p is SegmentPart =>
            typeof p.label === "string" && isNum(p.value),
        )
      : [];
  // Nothing after the headline has arrived yet, so it may still come.
  const awaitingHeadline =
    streaming && !headlineReady && !visual?.type && items.length === 0;
  const awaitingVisual = streaming && !visual?.type && items.length === 0;

  const headlineEl = headlineReady ? (
    <div className="flex flex-col gap-1.5">
      {headline?.label && (
        <span className={genuiType.meta}>{headline.label}</span>
      )}
      <AnimatedValue
        value={headline?.value as number}
        fmt={{
          format: headline?.format,
          currency: headline?.currency,
          locale,
        }}
        className={genuiType.display}
      />
    </div>
  ) : awaitingHeadline ? (
    <div className="flex flex-col gap-1.5">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-9 w-44" />
    </div>
  ) : null;

  const visualEl = visual?.type ? (
    <motion.div key={visual.type} {...enter}>
      <Visual
        visual={visual}
        streaming={streaming}
        fallback={fallback}
        locale={locale}
        caption={caption}
      />
    </motion.div>
  ) : awaitingVisual ? (
    <Skeleton className="h-24 w-full rounded-[10px]" />
  ) : null;

  const segmentsLegend =
    isSegments && items.length === 0 && !streaming && segmentParts.length > 0;
  const swatches = isSegments;
  // Items stream one by one; a placeholder row stands in for the next one.
  const itemsStreaming = streaming && Array.isArray(block?.items) && !footer;

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="kpi-card"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Metrics"}
        lang={locale}
        className={cn(SERIES_VARS, className)}
      >
        <SurfaceHeader className="gap-3 pb-3">
          <div className="flex min-h-7 items-center gap-2">
            <SurfaceTitle id={titleId} className="min-w-0 flex-1 truncate">
              {title}
            </SurfaceTitle>
            {showAction && actionKind && (
              <IconTip label={action?.label ?? `Open ${title ?? "details"}`}>
                <Button
                  size="icon-sm"
                  variant="outline"
                  aria-label={`Open ${title ?? "details"}`}
                  disabled={streaming}
                  onClick={() =>
                    onResult?.({
                      action: actionKind,
                      ...(active ? { period: active } : {}),
                    })
                  }
                  className="ms-auto -my-1 rounded-full"
                >
                  <ArrowUpRightIcon aria-hidden />
                </Button>
              </IconTip>
            )}
          </div>
          {hasPeriods && active && (
            <PeriodSwitch
              periods={periods}
              active={active}
              title={title ?? "metrics"}
              disabled={streaming}
              onChange={setPicked}
            />
          )}
        </SurfaceHeader>

        <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
          {isSegments ? (
            // Headline and its bar read as one unit.
            <div className="flex flex-col gap-3">
              {headlineEl}
              {visualEl}
            </div>
          ) : (
            <>
              {headlineEl}
              {visualEl}
            </>
          )}

          {segmentsLegend && (
            <PartsLegend
              parts={segmentParts}
              fmt={{
                format:
                  (visual?.type === "segments" ? visual.format : undefined) ??
                  fallback.format,
                currency:
                  (visual?.type === "segments" ? visual.currency : undefined) ??
                  fallback.currency,
                locale,
              }}
            />
          )}
        </div>

        {(items.length > 0 || itemsStreaming) && (
          <div className="@container border-t border-border px-3 py-3">
            {/* One row of tiles when the card is wide (never one alone on a row);
                one line per item when it is narrow. */}
            <ul
              className={cn(
                "grid grid-cols-1 gap-x-6 gap-y-3",
                ITEM_COLUMNS[
                  itemColumns(items.length + (itemsStreaming ? 1 : 0))
                ],
              )}
            >
              {items.map((item, i) => (
                <motion.li
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional, so values roll on a period switch
                  key={i}
                  {...enter}
                  className="flex min-w-0 items-center justify-between gap-3 text-[13px] @md:flex-col @md:items-start @md:justify-start @md:gap-1"
                >
                  <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    {swatches && (
                      <span
                        aria-hidden
                        className={cn(
                          "size-2.5 shrink-0 rounded-[3px]",
                          SEGMENT_BG[i] ?? "bg-muted",
                        )}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <AnimatedValue
                      value={item.value}
                      fmt={{
                        format: item.format,
                        currency: item.currency,
                        locale,
                      }}
                      className="font-medium text-foreground @md:text-[16px]"
                    />
                    {isNum(item.delta) && (
                      // A fixed slot on narrow cards, so the values above stay in one column.
                      <span className="inline-flex min-w-[4.75rem] justify-end @md:min-w-0">
                        <DeltaBadge
                          delta={item.delta}
                          label={item.deltaLabel}
                          locale={locale}
                          upIsBad={item.upIsBad}
                        />
                      </span>
                    )}
                  </span>
                </motion.li>
              ))}
              {itemsStreaming && (
                <li aria-hidden className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-24" />
                </li>
              )}
            </ul>
          </div>
        )}
        {footerReady && footer && (
          <SurfaceFooter aria-live="polite" className="justify-between">
            <span className={genuiType.body}>{footer.label}</span>
            <AnimatedValue
              value={footer.value as number}
              fmt={{
                format: footer.format,
                currency: footer.currency,
                locale,
              }}
              className={genuiType.title}
            />
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  );
}
