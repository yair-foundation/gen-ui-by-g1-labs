"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowDownRightIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  FlaskConicalIcon,
  InfoIcon,
  MinusIcon,
  StethoscopeIcon,
} from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { IconTip } from "@/components/genui/hint";
import { useGenUILocale } from "@/components/genui/locale";
import { Segmented } from "@/components/genui/segmented";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import type {
  LabHistoryPoint,
  LabMarker,
  LabRange,
  LabResultsInput,
  LabResultsResult,
} from "./lab-results.schema";
import {
  type LabFilter,
  type LabPosition,
  type LabStatus,
  cleanHistory,
  countPositions,
  countsSummary,
  filterMarkers,
  formatDate,
  formatNumber,
  groupMarkers,
  isOutOfRange,
  markerStatus,
  optimalText,
  positionLabel,
  rangeText,
  spectrumScale,
  trendDelta,
} from "./lab-results-utils";

export type LabResultsStatus = "streaming" | "ready";

type PartialMarker = Partial<Omit<LabMarker, "range" | "history">> & {
  range?: Partial<LabRange>;
  history?: Partial<LabHistoryPoint>[];
};

type ReadyMarker = LabMarker & { st: LabStatus; past: LabHistoryPoint[] };

export type LabResultsProps = Partial<
  Omit<LabResultsInput, "markers" | "lab" | "source">
> & {
  /** Markers may be partial while the tool call streams. */
  markers?: PartialMarker[];
  lab?: { name?: string };
  source?: { label?: string; url?: string };
  /** Lifecycle, controlled by the host. */
  status?: LabResultsStatus;
  /**
   * Called each time the user presses "What is this?". The card never locks;
   * the user may ask about several markers.
   */
  onResult?: (result: LabResultsResult) => void;
  /** Requests from history (one or several). Shown as sent; never calls onResult. */
  result?: LabResultsResult | LabResultsResult[];
  className?: string;
};

// Zone fills, per theme, from the neutral chart scale. Out-of-range zones are
// the muted track; within is a soft fill; the optimal band a stronger one.
const ZONE_WITHIN = "bg-chart-1 dark:bg-chart-3";
const ZONE_OPTIMAL = "bg-chart-2";

const STATUS_ICON: Record<LabPosition, typeof CheckIcon> = {
  below: ArrowDownIcon,
  within: CheckIcon,
  above: ArrowUpIcon,
  unknown: MinusIcon,
};

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const;

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function isComplete(m: PartialMarker): m is LabMarker {
  return (
    typeof m.id === "string" &&
    typeof m.name === "string" &&
    isNum(m.value) &&
    typeof m.unit === "string" &&
    typeof m.range === "object" &&
    m.range !== null
  );
}

const pct = (f: number) => `${(f * 100).toFixed(2)}%`;

/** The lab's range on a padded track, with the value marked on it. */
function SpectrumBar({ marker }: { marker: ReadyMarker }) {
  const locale = useGenUILocale();
  const scale = spectrumScale(marker.value, marker.range);
  if (!scale) return null;
  const { zones, ticks, at, clamped } = scale;
  const zone = (z: [number, number] | null, cls: string, key: string) =>
    z && (
      <span
        key={key}
        className={cn("absolute inset-y-0", cls)}
        style={{ left: pct(z[0]), width: pct(z[1] - z[0]) }}
      />
    );

  return (
    <div aria-hidden className="relative w-full pt-1">
      <div className="relative h-4">
        <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full border border-border bg-transparent">
          {zone(zones.within, ZONE_WITHIN, "within")}
          {zone(zones.optimal, ZONE_OPTIMAL, "optimal")}
        </div>
        {clamped ? (
          <span
            className={cn(
              "absolute top-1/2 flex -translate-y-1/2 items-center text-foreground",
              clamped === "below"
                ? "left-0 -translate-x-1/2"
                : "right-0 translate-x-1/2",
            )}
          >
            {clamped === "below" ? (
              <ChevronLeftIcon className="size-5" strokeWidth={3.5} />
            ) : (
              <ChevronRightIcon className="size-5" strokeWidth={3.5} />
            )}
          </span>
        ) : (
          <span
            className="absolute inset-y-0 flex -translate-x-1/2 items-center justify-center"
            style={{ left: pct(at) }}
          >
            <span className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground/60" />
            <span className="relative size-4 rounded-full bg-foreground ring-[3px] ring-card" />
          </span>
        )}
      </div>
      <div className="relative h-4">
        {ticks.map((t) => (
          <span
            key={t.kind}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-[13px] leading-none tabular-nums text-muted-foreground"
            style={{ left: pct(t.at) }}
          >
            <span className="mb-0.5 h-1 w-px bg-border" />
            {formatNumber(t.value, locale)}
          </span>
        ))}
      </div>
    </div>
  );
}

/** All results for one marker, with the lab's range as a band. */
function TrendChart({
  marker,
  takenAt,
}: {
  marker: ReadyMarker;
  takenAt?: string;
}) {
  const locale = useGenUILocale();
  const reduceMotion = useReducedMotion();
  const points = [
    ...marker.past,
    { date: takenAt ?? "", value: marker.value },
  ].map((p, i, all) => ({
    label:
      formatDate(p.date, "short", locale) ??
      (i === all.length - 1 ? "Latest" : ""),
    long: formatDate(p.date, "long", locale) ?? "Latest result",
    v: p.value,
  }));
  const low = isNum(marker.range.low) ? marker.range.low : undefined;
  const high = isNum(marker.range.high) ? marker.range.high : undefined;
  const domainVals = [
    ...points.map((p) => p.v),
    ...(low !== undefined ? [low] : []),
    ...(high !== undefined ? [high] : []),
  ];
  let lo = Math.min(...domainVals);
  let hi = Math.max(...domainVals);
  if (hi === lo) {
    lo -= 1;
    hi += 1;
  }
  const pad = (hi - lo) * 0.15;
  const yMin = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
  const yMax = hi + pad;

  const config: ChartConfig = {
    v: {
      label: marker.name,
      theme: { light: "var(--chart-5)", dark: "var(--chart-1)" },
    },
    band: {
      label: "Lab's range",
      theme: { light: "var(--chart-1)", dark: "var(--chart-3)" },
    },
  };
  const range = rangeText(marker.range, locale);

  return (
    <div className="flex flex-col gap-1 pt-2">
      {/* The SVG is visual only; the table below carries the numbers. */}
      <ChartContainer
        aria-hidden
        config={config}
        className="aspect-auto h-36 w-full"
      >
        <LineChart
          data={points}
          accessibilityLayer={false}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        >
          <CartesianGrid vertical={false} />
          {(low !== undefined || high !== undefined) && (
            <ReferenceArea
              y1={low ?? yMin}
              y2={high ?? yMax}
              fill="var(--color-band)"
              fillOpacity={0.35}
              strokeOpacity={0}
              ifOverflow="hidden"
            />
          )}
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={16}
          />
          <YAxis
            domain={[yMin, yMax]}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width="auto"
            tickFormatter={(v) =>
              new Intl.NumberFormat(locale, {
                maximumFractionDigits: 2,
              }).format(Number(v))
            }
          />
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) =>
                  (payload?.[0]?.payload as { long?: string } | undefined)
                    ?.long ?? ""
                }
                formatter={(value) => (
                  <span className="font-mono font-medium tabular-nums text-foreground">
                    {`${formatNumber(Number(value), locale)} ${marker.unit}`}
                  </span>
                )}
              />
            }
          />
          <Line
            dataKey="v"
            type="linear"
            stroke="var(--color-v)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--color-v)" }}
            activeDot={{ r: 4 }}
            isAnimationActive={!reduceMotion}
          />
        </LineChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>
          {`${marker.name} results${range ? `. Lab's range: ${range} ${marker.unit}` : ""}`}
        </caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">{`Value (${marker.unit})`}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dates may repeat
            <tr key={i}>
              <th scope="row">{p.long}</th>
              <td>{formatNumber(p.v, locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MarkerRow({
  marker,
  takenAt,
  onExplain,
}: {
  marker: ReadyMarker;
  takenAt?: string;
  onExplain?: () => void;
}) {
  const locale = useGenUILocale();
  const [open, setOpen] = React.useState(false);
  const trendId = React.useId();
  const { st } = marker;
  const out = isOutOfRange(st.position);
  const Icon = STATUS_ICON[st.position];
  const range = rangeText(marker.range, locale);
  const optimal = optimalText(marker.range, locale);
  const hasBar = spectrumScale(marker.value, marker.range) !== null;
  const delta = trendDelta(marker.value, marker.past, takenAt, locale);
  const hasTrend = marker.past.length > 0;

  return (
    <motion.li {...enter} className="flex flex-col gap-3 px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="min-w-0 text-[16px] leading-6 font-medium">
          {marker.name}
          {marker.abbreviation && (
            <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">
              {marker.abbreviation}
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-[16px] leading-6 tabular-nums">
            <span className="font-medium">
              {formatNumber(marker.value, locale)}
            </span>
            <span className="ml-1 text-[13px] text-muted-foreground">
              {marker.unit}
            </span>
          </span>
          {out ? (
            <Badge variant="warning" className="shrink-0">
              <Icon aria-hidden />
              {positionLabel[st.position]}
            </Badge>
          ) : st.position === "within" ? (
            // In range is the quiet case: a check, named for tooltips and screen readers.
            <IconTip label={positionLabel.within}>
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400">
                <CheckIcon aria-hidden className="size-3.5" />
                <span className="sr-only">{positionLabel.within}</span>
              </span>
            </IconTip>
          ) : (
            <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
              <Icon aria-hidden className="size-3.5" />
              {positionLabel[st.position]}
            </span>
          )}
          {st.critical && <Badge variant="destructive">Critical</Badge>}
          {hasTrend && delta && (
            // The change since the last result sits with the value it describes.
            <span className="flex min-w-0 flex-nowrap items-center gap-2">
              {delta &&
                (delta.direction === "same" ? (
                  <span className={cn(genuiType.meta, "tabular-nums")}>
                    <span aria-hidden>{delta.text}</span>
                    <span className="sr-only">{delta.srText}</span>
                  </span>
                ) : (
                  <>
                    {/* Green when the change moves toward the range, red when away; neutral when in range. */}
                    <Badge
                      variant={
                        st.position === "within" || st.position === "unknown"
                          ? "outline"
                          : (st.position === "above") ===
                              (delta.direction === "down")
                            ? "success"
                            : "destructive"
                      }
                      className="h-5 shrink-0 tabular-nums"
                    >
                      {delta.direction === "up" ? (
                        <ArrowUpRightIcon aria-hidden />
                      ) : (
                        <ArrowDownRightIcon aria-hidden />
                      )}
                      <span aria-hidden>{delta.amount}</span>
                      <span className="sr-only">
                        {delta.direction === "up" ? "increase" : "decrease"}
                      </span>
                    </Badge>
                    {delta.since && (
                      <span className={cn(genuiType.meta, "tabular-nums")}>
                        <span aria-hidden>{`since ${delta.since}`}</span>
                        <span className="sr-only">{delta.srText}</span>
                      </span>
                    )}
                  </>
                ))}
            </span>
          )}
          {(hasTrend || (marker.explain && onExplain)) && (
            <span className="-mr-1.5 flex shrink-0 items-center gap-0.5">
              {hasTrend && (
                <IconTip label={open ? "Hide trend" : "Show trend"}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-expanded={open}
                    aria-controls={trendId}
                    aria-label={`${open ? "Hide" : "Show"} trend for ${marker.name}`}
                    onClick={() => setOpen((o) => !o)}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                  >
                    <ChevronDownIcon
                      aria-hidden
                      className={cn("transition-transform", open && "rotate-180")}
                    />
                  </Button>
                </IconTip>
              )}
              {marker.explain && onExplain && (
                <IconTip label="What is this?">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`What is ${marker.name}?`}
                    onClick={onExplain}
                    className="text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
                  >
                    <CircleHelpIcon aria-hidden />
                  </Button>
                </IconTip>
              )}
            </span>
          )}
        </div>
      </div>

      <div className="min-w-0">
        {hasBar ? (
          <>
            <SpectrumBar marker={marker} />
            <span className="sr-only">
              {`Lab's range: ${range} ${marker.unit}.`}
            </span>
          </>
        ) : (
          <p className={genuiType.meta}>
            {range
              ? `Range ${range}${/\d/.test(range) ? ` ${marker.unit}` : ""}`
              : "No range given"}
          </p>
        )}
      </div>

      {optimal && (
        <p className="sr-only">
          {`Lab's optimal band: ${optimal} ${marker.unit}`}
          {st.optimal !== null &&
            ` (this result is ${st.optimal ? "inside" : "outside"} it)`}
        </p>
      )}

      {hasTrend && (
        <div id={trendId} hidden={!open}>
          {open && <TrendChart marker={marker} takenAt={takenAt} />}
        </div>
      )}
    </motion.li>
  );
}

export function LabResults({
  panel,
  takenAt,
  lab,
  markers = [],
  clinicianNote,
  source,
  status: lifecycle = "ready",
  onResult,
  result,
  className,
}: LabResultsProps) {
  const locale = useGenUILocale();
  const streaming = lifecycle === "streaming";
  const titleId = React.useId();
  const [filter, setFilter] = React.useState<LabFilter>("all");
  const [sent, setSent] = React.useState<LabResultsResult[]>(() =>
    result === undefined ? [] : Array.isArray(result) ? result : [result],
  );

  // While streaming, the last marker may still be arriving: hold it back.
  const settled = streaming ? markers.slice(0, -1) : markers;
  const ready: ReadyMarker[] = settled.filter(isComplete).map((m) => ({
    ...m,
    st: markerStatus(m.value, m.range, m.flag),
    past: cleanHistory(m.history, takenAt).slice(-12),
  }));

  const counts = countPositions(ready.map((m) => m.st.position));
  const outCount = counts.above + counts.below;
  const showFilter = !streaming && outCount > 0 && ready.length > 1;
  const activeFilter: LabFilter = showFilter ? filter : "all";
  const visible = filterMarkers(ready, activeFilter, (m) => m.st.position);
  const groups = groupMarkers(visible);
  const grouped = ready.some((m) => m.group?.trim());

  const takenText = formatDate(takenAt, "long", locale);
  const sourceUrl = safeUrl(source?.url);

  const fire = (r: LabResultsResult) => {
    if (streaming) return;
    setSent((prev) =>
      prev.some((p) => p.markerId === r.markerId) ? prev : [...prev, r],
    );
    onResult?.(r);
  };
  const nameOf = (id: string) =>
    ready.find((m) => m.id === id)?.name ??
    markers.find((m) => m.id === id)?.name ??
    id;

  const rows = (list: ReadyMarker[]) =>
    list.map((m) => (
      <MarkerRow
        key={m.id}
        marker={m}
        takenAt={takenAt}
        onExplain={
          m.explain && !streaming
            ? () => fire({ action: "explain", markerId: m.id })
            : undefined
        }
      />
    ));

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="lab-results"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={panel ? titleId : undefined}
        aria-label={panel ? undefined : "Lab results"}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400"
          >
            <FlaskConicalIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <SurfaceTitle id={titleId}>{panel}</SurfaceTitle>
            {streaming ? (
              <Skeleton className="h-4 w-56" />
            ) : (
              (ready.length > 0 || takenText || lab?.name) && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  {ready.length > 0 && (
                    <p className={cn(genuiType.body, "font-medium")}>
                      {countsSummary(counts)}
                    </p>
                  )}
                  {lab?.name && <span className="sr-only">{lab.name}</span>}
                  {takenText &&
                    (lab?.name ? (
                      <IconTip label={lab.name}>
                        <span
                          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can read the lab name
                          tabIndex={0}
                          className={cn(
                            genuiType.meta,
                            "ml-auto cursor-default rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          )}
                        >
                          {takenText}
                        </span>
                      </IconTip>
                    ) : (
                      <span className={cn(genuiType.meta, "ml-auto")}>
                        {takenText}
                      </span>
                    ))}
                </div>
              )
            )}
          </div>
        </SurfaceHeader>

        {showFilter && (
          <div className="border-t border-border px-3 py-3">
            <Segmented
              label="Filter markers"
              value={activeFilter}
              onChange={setFilter}
              options={[
                { value: "all", label: `All (${ready.length})` },
                { value: "out", label: `Out of range (${outCount})` },
              ]}
            />
          </div>
        )}

        <AutoHeight deps={[activeFilter, visible.length]}>
          <div className="border-t border-border">
            {grouped ? (
              <div className="flex flex-col">
                {groups.map((g, i) => {
                  const label = g.group ?? "Other";
                  const hid = `${titleId}-g${i}`;
                  return (
                    <section
                      key={label}
                      aria-labelledby={hid}
                      className={cn(i > 0 && "pt-0")}
                    >
                      <h4
                        id={hid}
                        className="bg-muted/60 px-3 py-2.5 text-[12px] leading-4 font-medium text-muted-foreground dark:bg-white/[0.05]"
                      >
                        {label}
                      </h4>
                      <ul className="flex flex-col divide-y divide-border">
                        {rows(g.markers)}
                      </ul>
                    </section>
                  );
                })}
              </div>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {rows(visible)}
              </ul>
            )}
            {streaming && (
              <div
                aria-hidden
                className="flex flex-col gap-2 border-t border-border px-3 py-3"
              >
                <div className="flex justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-20" />
                </div>
                <Skeleton className="h-2.5 w-full rounded-full" />
              </div>
            )}
            <div className="flex flex-col gap-3 border-t border-border px-3 py-4">
              <div
                aria-live="polite"
                className={cn(
                  "flex flex-col gap-1",
                  sent.length === 0 && "sr-only",
                )}
              >
                {sent.map((r) => (
                  <p
                    key={r.markerId}
                    className={cn(genuiType.body, "flex items-center gap-1.5")}
                  >
                    <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                    {`Asked what ${nameOf(r.markerId)} is.`}
                  </p>
                ))}
              </div>
              {clinicianNote && !streaming && (
                // A note box: a hollow bordered card around an inset, tinted box.
                <div className="rounded-[14px] border border-border p-1">
                  <div className="flex items-start gap-3 rounded-[10px] bg-sky-500/10 p-3 dark:bg-sky-400/10">
                    <span
                      aria-hidden
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400"
                    >
                      <StethoscopeIcon className="size-4" />
                    </span>
                    <p
                      className={cn(
                        genuiType.body,
                        "min-w-0 self-center whitespace-pre-line text-muted-foreground",
                      )}
                    >
                      <span className="mr-1.5 text-[15px] font-medium text-foreground">
                        Clinician
                      </span>
                      {clinicianNote}
                    </p>
                  </div>
                </div>
              )}
              {streaming && (
                <p className="text-[13px]">
                  <ShimmeringText
                    text="Loading results…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                </p>
              )}
              <p
                className={cn(
                  genuiType.meta,
                  "flex flex-wrap items-center gap-x-1.5",
                )}
              >
                <InfoIcon aria-hidden className="size-3.5 shrink-0" />
                {source?.label && !streaming && (
                  <>
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-6 items-center rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="sr-only">Source: </span>
                        {source.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span>
                        <span className="sr-only">Source: </span>
                        {source.label}
                      </span>
                    )}
                    <span aria-hidden>·</span>
                  </>
                )}
                <span>Not medical advice.</span>
              </p>
            </div>
          </div>
        </AutoHeight>

        {ready.length > 0 && (
          <table className="sr-only">
            <caption>{`${panel ?? "Lab"} results, all markers`}</caption>
            <thead>
              <tr>
                <th scope="col">Marker</th>
                <th scope="col">Value</th>
                <th scope="col">Unit</th>
                <th scope="col">Lab's range</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {ready.map((m) => (
                <tr key={m.id}>
                  <th scope="row">
                    {m.abbreviation ? `${m.name} (${m.abbreviation})` : m.name}
                  </th>
                  <td>{formatNumber(m.value, locale)}</td>
                  <td>{m.unit}</td>
                  <td>{rangeText(m.range, locale) ?? "None given"}</td>
                  <td>
                    {`${positionLabel[m.st.position]}${m.st.critical ? ", critical" : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Surface>
    </MotionConfig>
  );
}
