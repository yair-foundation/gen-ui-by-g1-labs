"use client";

import * as React from "react";
import {
  ArrowRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronRightIcon,
  CookieIcon,
  CroissantIcon,
  CupSodaIcon,
  DrumstickIcon,
  DumbbellIcon,
  FootprintsIcon,
  GlassWaterIcon,
  type LucideIcon,
  MoonIcon,
  PillIcon,
  SaladIcon,
  ShareIcon,
} from "lucide-react";
import { MotionConfig, motion } from "motion/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import type {
  InsightAction,
  InsightBubble,
  InsightBubbles,
  InsightCardInput,
  InsightCardResult,
  InsightCompare,
  InsightDotCalendar,
  InsightMarkedDay,
  InsightProgress,
  InsightSequence,
  InsightSequenceIcon,
  InsightSequenceItem,
  InsightStreak,
} from "./insight-card.schema";
import {
  type AmountFormat,
  buildMonthGrid,
  formatAmount,
  formatDayCount,
  formatRelativeDay,
  packCircles,
  parseBold,
  parseDay,
  sequenceCounts,
  sequencePhrases,
  streakDayPhrases,
  streakLength,
  toDayKey,
  weekdayName,
  weekdayOrder,
} from "./insight-card-utils";
import { IconTip, WhyDisabled } from "@/components/genui/hint";
import { DEFAULT_LOCALE, useGenUILocale } from "@/components/genui/locale";

type CompareItem = InsightCompare["items"][number];
type StreakDay = InsightStreak["days"][number];

/** The visual as it arrives while the tool call streams. */
export type InsightVisualPartial =
  | ({ type: "bubbles" } & Partial<Omit<InsightBubbles, "type" | "items">> & {
        items?: Partial<InsightBubble>[];
      })
  | ({ type: "dot-calendar" } & Partial<
      Omit<InsightDotCalendar, "type" | "marked">
    > & { marked?: Partial<InsightMarkedDay>[] })
  | ({ type: "progress" } & Partial<Omit<InsightProgress, "type">>)
  | ({ type: "compare" } & Partial<Omit<InsightCompare, "type" | "items">> & {
        items?: Partial<CompareItem>[];
      })
  | ({ type: "streak" } & Partial<Omit<InsightStreak, "type" | "days">> & {
        days?: Partial<StreakDay>[];
      })
  | ({ type: "sequence" } & Partial<Omit<InsightSequence, "type" | "items">> & {
        items?: Partial<InsightSequenceItem>[];
      })
  | { type?: undefined };

export type InsightCardProps = Partial<
  Omit<InsightCardInput, "visual" | "action">
> & {
  /** May be partial while the tool call streams. */
  visual?: InsightVisualPartial;
  action?: Partial<InsightAction>;
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready";
  /**
   * Called when the user presses the action link or the share button. The
   * card stays live afterwards; there's no finished state to restore.
   */
  onResult?: (result: InsightCardResult) => void;
  className?: string;
};

// Fills by rank. Light and dark use different steps of the neutral chart
// scale so the largest item always has the most contrast, like the Chart.
const SLOTS = [
  {
    fill: "fill-chart-5 dark:fill-chart-1",
    bg: "bg-chart-5 dark:bg-chart-1",
    text: "fill-background",
  },
  {
    fill: "fill-chart-3 dark:fill-chart-2",
    bg: "bg-chart-3 dark:bg-chart-2",
    text: "fill-background dark:fill-foreground",
  },
  {
    fill: "fill-chart-2 dark:fill-chart-3",
    bg: "bg-chart-2 dark:bg-chart-3",
    text: "fill-background dark:fill-foreground",
  },
  {
    fill: "fill-chart-1 dark:fill-chart-4",
    bg: "bg-chart-1 dark:bg-chart-4",
    text: "fill-foreground",
  },
];
const OTHER_SLOT = {
  fill: "fill-muted stroke-border",
  bg: "bg-muted ring-1 ring-inset ring-border",
  text: "fill-muted-foreground",
};
/** The primary mark: marked days, done days, progress, the current period. */
const PRIMARY_BG = "bg-chart-5 dark:bg-chart-1";
const EMPTY_DOT = "bg-border";

/** A validated BCP 47 tag, or undefined (the host's locale is used). */
function safeLocale(locale: string | undefined) {
  if (!locale) return undefined;
  try {
    return Intl.getCanonicalLocales(locale)[0];
  } catch {
    return undefined;
  }
}

/** The current time, set after mount so server and client markup match. */
function useNow() {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => setNow(new Date()), []);
  return now;
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

function formatDay(key: string, locale: string, style: "short" | "long") {
  const parsed = parseDay(key);
  if (!parsed) return key;
  return new Intl.DateTimeFormat(locale, {
    weekday: style,
    month: style,
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(parsed.year, parsed.month, parsed.day)));
}

/** A small label over a mark. Decorative: the mark's own name says the same. */
function Tip({
  children,
  style,
  below,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  below?: boolean;
}) {
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "pointer-events-none absolute z-10 flex w-max max-w-48 -translate-x-1/2 flex-col rounded-lg border bg-popover px-2.5 py-1.5 text-start text-[13px] leading-4 text-popover-foreground shadow-sm dark:shadow-none",
        !below && "-translate-y-full",
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Bubbles
// ---------------------------------------------------------------------------

const LABEL_SIZE = 12;
const VALUE_SIZE = 12;
/** Rough average glyph width as a share of the font size. */
const GLYPH = 0.58;

/** Usable width of a circle's chord at distance `y` from its centre. */
function chord(r: number, y: number) {
  return 2 * Math.sqrt(Math.max(0, r * r - y * y)) - 6;
}

/**
 * The label's lines when it fits inside the bubble (one line, or two split
 * at the space nearest the middle), or null to list it in the legend.
 */
function labelLines(r: number, label: string, value: string) {
  const w = (text: string, size: number) => text.length * size * GLYPH;
  if (r < 22 || w(value, VALUE_SIZE) > chord(r, 15)) return null;
  // One label line + value: about −12 to +15 around the centre.
  if (w(label, LABEL_SIZE) <= chord(r, 15)) return [label];
  if (r < 30) return null;
  const spaces = [...label.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (spaces.length === 0) return null;
  const cut = spaces.reduce((best, i) =>
    Math.abs(i - label.length / 2) < Math.abs(best - label.length / 2)
      ? i
      : best,
  );
  const lines = [label.slice(0, cut), label.slice(cut + 1)];
  // Two label lines + value: about −20 to +22 around the centre.
  return lines.every((l) => w(l, LABEL_SIZE) <= chord(r, 22)) ? lines : null;
}

function BubblesVisual({
  items,
  amount,
}: {
  items: InsightBubble[];
  amount: AmountFormat;
}) {
  const [ref, width] = useWidth<HTMLElement>();
  const [active, setActive] = React.useState<number | null>(null);
  const height = Math.round(Math.min(220, Math.max(160, width * 0.55)));

  const display = (item: InsightBubble) =>
    item.display ?? formatAmount(item.value, amount);
  const total = items.reduce((sum, i) => sum + i.value, 0);

  // Rank by value (ties keep input order); "other" items never take a color.
  const rank = new Map<number, number>();
  const byValue = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => b.item.value - a.item.value || a.index - b.index);
  for (const [i, { index }] of byValue.entries()) rank.set(index, i);
  let colorRank = 0;
  const slot = new Map<number, (typeof SLOTS)[number]>();
  for (const [index] of [...rank.entries()].sort((a, b) => a[1] - b[1])) {
    slot.set(
      index,
      items[index].other ? OTHER_SLOT : SLOTS[colorRank++ % SLOTS.length],
    );
  }

  const circles =
    width > 0
      ? packCircles(
          items.map((i) => i.value),
          width,
          height,
          4,
        )
      : [];
  const placed = circles.map((c) => ({
    ...c,
    item: items[c.index],
    lines: labelLines(c.r, items[c.index].label, display(items[c.index])),
  }));
  const legend = placed
    .filter((c) => !c.lines)
    .sort((a, b) => (rank.get(a.index) ?? 0) - (rank.get(b.index) ?? 0));
  const activeCircle = placed.find((c) => c.index === active);
  const top = items[[...rank.entries()].find(([, r]) => r === 0)?.[0] ?? 0];

  return (
    <div>
      <figure
        ref={ref}
        aria-label={`Bubble chart, ${items.length} ${items.length === 1 ? "item" : "items"}. Largest: ${top.label}, ${display(top)}.`}
        className="relative w-full"
        style={{ height }}
      >
        {width > 0 && (
          // Visual only: the buttons over it and the table below carry the data.
          <svg
            aria-hidden
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block overflow-visible"
          >
            {placed.map((c) => {
              const s = slot.get(c.index) ?? SLOTS[0];
              const lines = c.lines;
              return (
                <g key={c.index} transform={`translate(${c.x} ${c.y})`}>
                  <motion.g
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{
                      duration: 0.25,
                      ease: "easeOut",
                      delay: (rank.get(c.index) ?? 0) * 0.05,
                    }}
                  >
                    <circle r={c.r} className={s.fill} />
                    {lines && (
                      <text
                        textAnchor="middle"
                        className={cn("select-none", s.text)}
                      >
                        {lines.map((line, i) => (
                          <tspan
                            key={line}
                            x={0}
                            y={(lines.length === 1 ? -2 : -9) + i * 13}
                            fontSize={LABEL_SIZE}
                            fontWeight={500}
                          >
                            {line}
                          </tspan>
                        ))}
                        <tspan
                          x={0}
                          y={lines.length === 1 ? 12 : 18}
                          fontSize={VALUE_SIZE}
                          className="tabular-nums"
                        >
                          {display(c.item)}
                        </tspan>
                      </text>
                    )}
                  </motion.g>
                </g>
              );
            })}
          </svg>
        )}
        {/* Round hit targets over each bubble: hover, focus or tap shows the tip. */}
        {placed.map((c) => {
          const size = Math.max(24, c.r * 2);
          const show = () => setActive(c.index);
          const hide = () => setActive((a) => (a === c.index ? null : a));
          return (
            <button
              key={c.index}
              type="button"
              aria-label={`${c.item.label}: ${display(c.item)}`}
              className="absolute cursor-default rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              style={{
                left: c.x - size / 2,
                top: c.y - size / 2,
                width: size,
                height: size,
              }}
              onPointerEnter={show}
              onPointerLeave={hide}
              onFocus={show}
              onBlur={hide}
              onClick={show}
              onKeyDown={(e) => {
                if (e.key === "Escape") setActive(null);
              }}
            />
          );
        })}
        {activeCircle && (
          <Tip
            below={activeCircle.y - activeCircle.r < 44}
            style={{
              left: Math.min(Math.max(activeCircle.x, 64), width - 64),
              top:
                activeCircle.y - activeCircle.r < 44
                  ? activeCircle.y + activeCircle.r + 6
                  : activeCircle.y - activeCircle.r - 6,
            }}
          >
            <span className="font-medium">{activeCircle.item.label}</span>
            <span className="tabular-nums text-muted-foreground">
              {display(activeCircle.item)}
            </span>
          </Tip>
        )}
      </figure>

      {legend.length > 0 && (
        // The table below carries the same data for assistive tech.
        <ul
          aria-hidden
          className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[13px] leading-4"
        >
          {legend.map((c) => (
            <li key={c.index} className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  slot.get(c.index)?.bg,
                )}
              />
              <span>{c.item.label}</span>
              <span className="tabular-nums text-muted-foreground">
                {display(c.item)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
            <tr key={i}>
              <th scope="row">{item.label}</th>
              <td>{display(item)}</td>
              <td>
                {total > 0
                  ? new Intl.NumberFormat(amount.locale, {
                      style: "percent",
                    }).format(item.value / total)
                  : "–"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dot calendar
// ---------------------------------------------------------------------------

function DotCalendarVisual({
  month,
  weekStart,
  marked,
  amount,
  now,
}: {
  month: string;
  weekStart: 0 | 1;
  marked: InsightMarkedDay[];
  amount: AmountFormat;
  now: Date | null;
}) {
  const [active, setActive] = React.useState<string | null>(null);
  const grid = buildMonthGrid(month, weekStart);
  if (!grid) return null;
  const { locale = DEFAULT_LOCALE } = amount;
  const keyFor = (day: number) => `${month}-${String(day).padStart(2, "0")}`;
  const marks = new Map(
    marked
      .filter((m) => m.date.startsWith(`${month}-`))
      .map((m) => [m.date, m]),
  );
  const today = now ? toDayKey(now) : null;
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "narrow",
    timeZone: "UTC",
  });
  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(grid.year, grid.month, 1)));
  const describe = (m: InsightMarkedDay) =>
    [m.label, m.value !== undefined ? formatAmount(m.value, amount) : null]
      .filter(Boolean)
      .join(", ");

  return (
    <div>
      <figure
        aria-label={`${monthName}: ${marks.size} of ${grid.daysInMonth} days marked`}
        className="grid w-full grid-cols-7 gap-y-1"
      >
        {weekdayOrder(weekStart).map((d) => (
          <span
            key={`h${d}`}
            aria-hidden
            className={cn("pb-1 text-center", genuiType.meta)}
          >
            {weekday.format(new Date(Date.UTC(2023, 0, 1 + d)))}
          </span>
        ))}
        {grid.cells.map((day, i) => {
          if (day === null) {
            // biome-ignore lint/suspicious/noArrayIndexKey: blank cells are positional
            return <span key={`b${i}`} aria-hidden />;
          }
          const key = keyFor(day);
          const mark = marks.get(key);
          const isToday = key === today;
          const dot = (
            <span
              aria-hidden
              className={cn(
                "size-3.5 rounded-full",
                mark ? PRIMARY_BG : EMPTY_DOT,
                isToday &&
                  "ring-1 ring-foreground ring-offset-2 ring-offset-card",
              )}
            />
          );
          if (!mark?.label) {
            return (
              <span
                key={key}
                aria-hidden
                className="grid h-7 place-items-center"
              >
                {dot}
              </span>
            );
          }
          const show = () => setActive(key);
          const hide = () => setActive((a) => (a === key ? null : a));
          return (
            <span key={key} className="relative grid h-7 place-items-center">
              <button
                type="button"
                aria-label={`${formatDay(key, locale, "long")}: ${describe(mark)}`}
                className="grid size-6 cursor-default place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onPointerEnter={show}
                onPointerLeave={hide}
                onFocus={show}
                onBlur={hide}
                onClick={show}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setActive(null);
                }}
              >
                {dot}
              </button>
              {active === key && (
                <Tip style={{ left: "50%", top: -4 }}>
                  <span className="font-medium">
                    {formatDay(key, locale, "short")}
                  </span>
                  <span className="text-muted-foreground">
                    {describe(mark)}
                  </span>
                </Tip>
              )}
            </span>
          );
        })}
      </figure>

      <ul className="sr-only">
        {[...marks.values()]
          .sort((a, b) => a.date.localeCompare(b.date, locale))
          .map((m) => (
            <li key={m.date}>
              {formatDay(m.date, locale, "long")}
              {describe(m) && `: ${describe(m)}`}
            </li>
          ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress, compare, streak
// ---------------------------------------------------------------------------

function ProgressVisual({
  value,
  target,
  label = "Progress",
  amount,
}: {
  value: number;
  target: number;
  label: string | undefined;
  amount: AmountFormat;
}) {
  const fmt = (n: number) => formatAmount(n, amount);
  const over = value > target;
  const pct = Math.min(1, value / target);
  // What's left (or over) answers "am I on track?", so it leads.
  return (
    <figure
      aria-label={`${label}: ${fmt(value)} of ${fmt(target)}`}
      className="flex flex-col gap-3"
    >
      <p className="flex items-baseline gap-1.5">
        <span className={genuiType.display}>
          {fmt(over ? value - target : target - value)}
        </span>
        <span className={genuiType.body}>{over ? "over" : "left"}</span>
      </p>
      {/* The figures above and below are the accessible values. */}
      <div
        aria-hidden
        className="h-2 overflow-hidden rounded-full bg-muted dark:bg-white/10"
      >
        <motion.div
          className="h-full rounded-full bg-choice"
          initial={{ width: 0 }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        />
      </div>
      <span className={cn("tabular-nums", genuiType.meta)}>
        {fmt(value)} of {fmt(target)}
      </span>
    </figure>
  );
}

function CompareVisual({
  items,
  amount,
}: {
  items: CompareItem[];
  amount: AmountFormat;
}) {
  const max = Math.max(0, ...items.map((i) => i.value));
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, i) => (
        <motion.li
          // biome-ignore lint/suspicious/noArrayIndexKey: periods are positional
          key={i}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={genuiMotion.fade}
          className="flex items-center gap-3"
        >
          <span className="w-24 shrink-0 truncate text-[13px] leading-4 text-muted-foreground">
            {item.label}
          </span>
          <span aria-hidden className="h-2 min-w-0 flex-1">
            <motion.span
              className={cn(
                "block h-full rounded-full",
                i === 0 ? PRIMARY_BG : "bg-chart-2 dark:bg-chart-3",
              )}
              initial={{ width: 0 }}
              animate={{ width: max > 0 ? `${(item.value / max) * 100}%` : 0 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </span>
          <span className="shrink-0 text-[13px] leading-4 tabular-nums">
            {formatAmount(item.value, amount)}
          </span>
        </motion.li>
      ))}
    </ul>
  );
}

function StreakVisual({
  days,
  count: countProp,
  label = "Streak",
  locale,
  now,
  streaming,
}: {
  days: StreakDay[];
  count: number | undefined;
  label: string | undefined;
  locale: string;
  now: Date | null;
  streaming: boolean;
}) {
  // While streaming, a computed default would jump when `count` arrives.
  const count = countProp ?? (streaming ? undefined : streakLength(days));
  const today = now ? toDayKey(now) : null;
  const phrases = streakDayPhrases(days, locale);
  return (
    <figure className="flex flex-col gap-5">
      {/* The sr-only summary and list below carry the same content. */}
      <div aria-hidden className="flex items-baseline gap-1.5">
        {count === undefined ? (
          <Skeleton className="h-10 w-12" />
        ) : (
          <>
            <span className="font-figure lining-nums text-[44px] leading-none font-normal tracking-tighter tabular-nums">
              {formatAmount(count, { locale })}
            </span>
            <span className={genuiType.body}>
              {count === 1 ? "day" : "days"}
            </span>
          </>
        )}
      </div>
      <ol
        aria-hidden
        className={cn(
          "flex",
          days.length <= 7 ? "justify-between" : "flex-wrap gap-x-2 gap-y-3",
        )}
      >
        {days.map((d) => (
          <motion.li
            key={d.date}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={genuiMotion.fade}
            className="flex w-8 flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                "grid size-8 place-items-center rounded-full",
                d.done
                  ? cn(PRIMARY_BG, "text-card")
                  : "border-2 border-muted-foreground/40",
                d.date === today &&
                  "ring-1 ring-foreground ring-offset-2 ring-offset-card",
              )}
            >
              {d.done && <CheckIcon className="size-4" strokeWidth={3} />}
            </span>
            <span className="text-[13px] leading-4 text-muted-foreground">
              {weekdayName(d.date, locale, "narrow")}
            </span>
          </motion.li>
        ))}
      </ol>
      {count !== undefined && (
        <figcaption className="sr-only">
          {`${label}: ${formatDayCount(count, locale)}.`}
        </figcaption>
      )}
      <ul className="sr-only">
        {days.map((d, i) => (
          <li key={d.date} aria-current={d.date === today ? "date" : undefined}>
            {phrases[i]}
            {i < days.length - 1 ? "," : "."}
          </li>
        ))}
      </ul>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Sequence
// ---------------------------------------------------------------------------

const SEQUENCE_ICONS: Record<InsightSequenceIcon, LucideIcon> = {
  meal: DrumstickIcon,
  salad: SaladIcon,
  breakfast: CroissantIcon,
  snack: CookieIcon,
  drink: CupSodaIcon,
  workout: DumbbellIcon,
  walk: FootprintsIcon,
  sleep: MoonIcon,
  pill: PillIcon,
  check: CheckIcon,
  book: BookOpenIcon,
  water: GlassWaterIcon,
};

function SequenceVisual({
  items,
  remainingLabel,
  streaming,
}: {
  items: InsightSequenceItem[];
  remainingLabel: string | undefined;
  streaming: boolean;
}) {
  const { done, remaining } = sequenceCounts(items);
  const phrases = sequencePhrases(items, remainingLabel);
  return (
    <figure aria-label={`${done} of ${items.length} done`}>
      {/* The sr-only list below carries the same content. */}
      <div
        aria-hidden
        className="flex w-fit max-w-full flex-wrap items-center gap-y-1.5 rounded-[20px] border border-border bg-transparent py-1.5 ps-1.5 pe-3"
      >
        {items.map((item, i) => {
          const prevDone = i > 0 && items[i - 1].done;
          if (!item.done) {
            return (
              <motion.span
                // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional and labels may repeat
                key={i}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className={cn(
                  "size-2 shrink-0 rounded-full bg-muted-foreground/60",
                  prevDone ? "ms-3" : i > 0 && "ms-2",
                )}
              />
            );
          }
          const Icon = SEQUENCE_ICONS[item.icon ?? "check"] ?? CheckIcon;
          return (
            <motion.span
              // biome-ignore lint/suspicious/noArrayIndexKey: steps are positional and labels may repeat
              key={i}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              style={{ zIndex: i + 1 }}
              className={cn(
                "relative grid size-9 shrink-0 place-items-center rounded-full border bg-card text-foreground ring-2 ring-muted",
                prevDone ? "-ms-2.5" : i > 0 && "ms-3",
              )}
            >
              <Icon className="size-4" />
            </motion.span>
          );
        })}
        {remainingLabel && remaining > 0 && (
          <span className={cn("ms-3 shrink-0", genuiType.meta)}>
            {remainingLabel}
          </span>
        )}
      </div>
      {!streaming && (
        <ul className="sr-only">
          {phrases.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: phrases are positional
            <li key={i}>
              {p}
              {i < phrases.length - 1 ? "," : "."}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

const SKELETON_HEIGHT: Record<string, string> = {
  bubbles: "h-44",
  "dot-calendar": "h-48",
  progress: "h-14",
  compare: "h-16",
  streak: "h-28",
  sequence: "h-12",
};

function Visual({
  visual,
  streaming,
  locale,
  now,
}: {
  visual: InsightVisualPartial | undefined;
  streaming: boolean;
  locale: string;
  now: Date | null;
}) {
  const placeholder = (
    <Skeleton
      className={cn(
        "w-full rounded-[10px]",
        (visual?.type && SKELETON_HEIGHT[visual.type]) ?? "h-32",
      )}
    />
  );
  if (!visual?.type) return streaming ? placeholder : null;

  const amount: AmountFormat =
    "format" in visual
      ? { format: visual.format, currency: visual.currency, locale }
      : { locale };

  switch (visual.type) {
    case "bubbles": {
      const items = (visual.items ?? []).filter(
        (i): i is InsightBubble =>
          typeof i.label === "string" &&
          typeof i.value === "number" &&
          Number.isFinite(i.value),
      );
      // The packing depends on every item, so wait for the whole set.
      if (streaming || items.length === 0) return placeholder;
      return <BubblesVisual items={items} amount={amount} />;
    }
    case "dot-calendar": {
      if (!visual.month || !buildMonthGrid(visual.month, 0)) return placeholder;
      const marked = (visual.marked ?? []).filter(
        (m): m is InsightMarkedDay =>
          typeof m.date === "string" && parseDay(m.date) !== null,
      );
      return (
        <DotCalendarVisual
          month={visual.month}
          weekStart={visual.weekStart ?? 0}
          marked={marked}
          amount={amount}
          now={now}
        />
      );
    }
    case "progress": {
      const { value, target, label } = visual;
      if (
        typeof value !== "number" ||
        typeof target !== "number" ||
        target <= 0
      ) {
        return placeholder;
      }
      return (
        <ProgressVisual
          value={value}
          target={target}
          label={label}
          amount={amount}
        />
      );
    }
    case "compare": {
      const items = (visual.items ?? []).filter(
        (i): i is CompareItem =>
          typeof i.label === "string" && typeof i.value === "number",
      );
      if (items.length === 0) return placeholder;
      return <CompareVisual items={items} amount={amount} />;
    }
    case "streak": {
      const days = (visual.days ?? []).filter(
        (d): d is StreakDay =>
          typeof d.date === "string" && typeof d.done === "boolean",
      );
      if (days.length === 0) return placeholder;
      return (
        <StreakVisual
          days={days}
          count={visual.count}
          label={visual.label}
          locale={locale}
          now={now}
          streaming={streaming}
        />
      );
    }
    case "sequence": {
      const items = (visual.items ?? []).filter(
        (i): i is InsightSequenceItem =>
          typeof i.label === "string" && typeof i.done === "boolean",
      );
      if (items.length === 0) return placeholder;
      return (
        <SequenceVisual
          items={items}
          remainingLabel={visual.remainingLabel}
          streaming={streaming}
        />
      );
    }
    default:
      return null;
  }
}

export function InsightCard({
  title,
  insight,
  timestamp,
  visual,
  action,
  share = false,
  locale: localeProp,
  status: lifecycle = "ready",
  onResult,
  className,
}: InsightCardProps) {
  const streaming = lifecycle === "streaming";
  const hostLocale = useGenUILocale();
  const locale = safeLocale(localeProp) ?? hostLocale;
  const now = useNow();
  const titleId = React.useId();

  const relative =
    timestamp && now ? formatRelativeDay(timestamp, now, locale) : null;
  const actionKind = action?.kind;
  const showAction = Boolean(action?.label && actionKind);

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="insight-card"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Insight"}
        className={className}
      >
        <div className="flex flex-col gap-1 px-3 pt-3 pb-3">
          {/* One row: the title, then the one quiet meta line and share. */}
          <div className="flex min-h-7 items-center gap-2">
            <SurfaceTitle id={titleId} className="min-w-0 flex-1">
              {title}
            </SurfaceTitle>
            {relative && timestamp && (
              <time
                dateTime={timestamp}
                className={cn("shrink-0", genuiType.meta)}
              >
                {relative}
              </time>
            )}
            {share && (
              <WhyDisabled when={streaming} reason="Still loading…">
                <IconTip label="Share insight">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Share insight"
                    disabled={streaming}
                    onClick={() => onResult?.({ action: "share" })}
                    className="-me-2 shrink-0 text-muted-foreground"
                  >
                    <ShareIcon />
                  </Button>
                </IconTip>
              </WhyDisabled>
            )}
          </div>
          {insight ? (
            <p
              className={cn(
                genuiType.body,
                "text-pretty text-muted-foreground",
              )}
            >
              {parseBold(insight, streaming).map((s, i) =>
                s.bold ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                  <strong key={i} className="font-semibold text-foreground">
                    {s.text}
                  </strong>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
                  <React.Fragment key={i}>{s.text}</React.Fragment>
                ),
              )}
            </p>
          ) : (
            streaming && (
              <div className="flex flex-col gap-1.5 pt-1">
                <Skeleton className="h-3.5 w-full" />
                <Skeleton className="h-3.5 w-2/3" />
              </div>
            )
          )}
        </div>

        {(visual?.type || streaming) && (
          <div className="border-t border-border px-3 py-3">
            <motion.div
              key={visual?.type ?? "none"}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
            >
              <Visual
                visual={visual}
                streaming={streaming}
                locale={locale}
                now={now}
              />
            </motion.div>
          </div>
        )}

        {showAction && actionKind === "open" ? (
          // "open" is a round arrow at the bottom right; the label names it.
          <SurfaceFooter className="justify-end">
            <WhyDisabled when={streaming} reason="Still loading…">
              <IconTip label={action?.label}>
                <Button
                  size="icon-lg"
                  disabled={streaming}
                  aria-label={action?.label}
                  title={action?.label}
                  onClick={() => onResult?.({ action: "open" })}
                  className="rounded-full"
                >
                  <ArrowRightIcon aria-hidden />
                </Button>
              </IconTip>
            </WhyDisabled>
          </SurfaceFooter>
        ) : (
          showAction &&
          actionKind && (
            <SurfaceFooter>
              <WhyDisabled when={streaming} reason="Still loading…">
                <Button
                  variant="link"
                  size="sm"
                  disabled={streaming}
                  onClick={() => onResult?.({ action: actionKind })}
                  className="-ms-2.5"
                >
                  {action?.label}
                  <ChevronRightIcon data-icon="inline-end" aria-hidden />
                </Button>
              </WhyDisabled>
            </SurfaceFooter>
          )
        )}
      </Surface>
    </MotionConfig>
  );
}
