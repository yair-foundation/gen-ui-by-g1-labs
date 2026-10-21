"use client";

import * as React from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/genui/segmented";
import { useGenUILocale } from "@/components/genui/locale";
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface";

import {
  type Actual,
  type CrossingCopy,
  type Granularity,
  type Row,
  buildRows,
  changeVsLast,
  cleanForecast,
  cleanHistory,
  crossingCopy,
  crossingDate,
  crossingRange,
  formatChange,
  formatPeriod,
  formatRange,
  formatValue,
  horizonSummary,
  isNum,
  parseDate,
  periodPhrase,
  rangeText,
  rowText,
  summaryText,
  targetDirection,
  yDomain,
} from "./forecast-utils";
import type {
  ForecastDriver,
  ForecastHistoryPoint,
  ForecastInput,
  ForecastMetric,
  ForecastPoint,
  ForecastResult,
  ForecastScenario,
  ForecastTarget,
  ForecastThreshold,
} from "./forecast.schema";

export type ForecastStatus = "streaming" | "ready";

type PartialScenario = Partial<Omit<ForecastScenario, "points">> & {
  points?: Partial<ForecastHistoryPoint>[];
};

export type ForecastProps = Partial<
  Omit<
    ForecastInput,
    | "metric"
    | "history"
    | "forecast"
    | "scenarios"
    | "target"
    | "threshold"
    | "drivers"
    | "accuracy"
    | "source"
  >
> & {
  /** Every field may be partial while the tool call streams. */
  metric?: Partial<ForecastMetric>;
  history?: Partial<ForecastHistoryPoint>[];
  forecast?: Partial<ForecastPoint>[];
  scenarios?: PartialScenario[];
  target?: Partial<ForecastTarget>;
  threshold?: Partial<ForecastThreshold>;
  drivers?: Partial<ForecastDriver>[];
  accuracy?: { label?: string; mape?: number };
  source?: { label?: string; url?: string };
  /** Lifecycle, controlled by the host. */
  status?: ForecastStatus;
  /**
   * Called for each action the user takes. The forecast never locks; every
   * action is a handoff to the agent or your own flow.
   */
  onResult?: (result: ForecastResult) => void;
  /** Actions from history (one or several). Shown as sent; never calls onResult. */
  result?: ForecastResult | ForecastResult[];
  className?: string;
};

type Mode = "median" | "scenarios";

// One chart token for actuals, the median and both bands (at low opacities),
// picked per theme for the most contrast on the card. Scenario lines add two
// more steps and are told apart by dash pattern as well.
const COLOR_TOKENS =
  "[--forecast-main:var(--chart-5)] [--forecast-s1:var(--chart-2)] [--forecast-s2:var(--chart-3)] dark:[--forecast-main:var(--chart-1)] dark:[--forecast-s1:var(--chart-2)] dark:[--forecast-s2:var(--chart-1)]";
const SCENARIO_COLORS = [
  "var(--forecast-main)",
  "var(--forecast-s1)",
  "var(--forecast-s2)",
];
const SCENARIO_DASHES = ["6 3", "8 3 2 3", "2 3"];
const MEDIAN_DASH = "5 4";
const OUTER_OPACITY = 0.12;
const INNER_OPACITY = 0.18;

const chartConfig: ChartConfig = { main: { label: "Forecast" } };

const isStr = (v: unknown): v is string => typeof v === "string" && v !== "";

/** Only http(s) links are rendered as links; anything else is dropped. */
function safeUrl(url?: string) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function formatAsOf(asOf: string, locale: string) {
  const date = parseDate(asOf);
  if (!date) return asOf;
  return new Intl.DateTimeFormat(
    locale,
    asOf.includes("T")
      ? {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }
      : { month: "short", day: "numeric", year: "numeric" },
  ).format(date);
}

/** A dot on the crossing, with a pill label kept inside the plot. */
function markerShape(
  label: string,
  place: "above" | "below",
  align: "start" | "middle" | "end",
) {
  return function Marker({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) {
    const h = 20;
    const w = label.length * 7 + 14;
    const left =
      align === "start" ? cx - 10 : align === "end" ? cx - w + 10 : cx - w / 2;
    const top = place === "above" ? cy - h - 8 : cy + 8;
    return (
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="var(--surface-bg)"
          stroke="var(--foreground)"
          strokeWidth={1.5}
        />
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          rx={h / 2}
          fill="var(--surface-bg)"
          stroke="var(--border)"
        />
        <text
          x={left + w / 2}
          y={top + h / 2}
          dy="0.35em"
          textAnchor="middle"
          fontSize={12}
          fontWeight={500}
          fill="var(--foreground)"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {label}
        </text>
      </g>
    );
  };
}

/** Little line and fill samples for the key under the chart. */
function Swatch({
  kind,
  color = "var(--forecast-main)",
  dash,
}: {
  kind: "line" | "outer" | "inner" | "rule";
  color?: string;
  dash?: string;
}) {
  if (kind === "outer" || kind === "inner") {
    return (
      <svg aria-hidden width="14" height="10" className="shrink-0">
        <rect
          width="14"
          height="10"
          rx="2"
          fill={color}
          fillOpacity={
            kind === "outer" ? OUTER_OPACITY : OUTER_OPACITY + INNER_OPACITY
          }
        />
      </svg>
    );
  }
  return (
    <svg aria-hidden width="16" height="2" className="shrink-0">
      <line
        x1="0"
        x2="16"
        y1="1"
        y2="1"
        stroke={kind === "rule" ? "var(--muted-foreground)" : color}
        strokeWidth={kind === "rule" ? 1 : 2}
        strokeDasharray={dash}
      />
    </svg>
  );
}

function sameResult(a: ForecastResult, b: ForecastResult) {
  return (
    a.action === b.action &&
    (a.action !== "alert" || (b.action === "alert" && a.value === b.value))
  );
}

export function Forecast({
  title,
  metric = {},
  granularity: granularityProp,
  history: historyProp = [],
  forecast: forecastProp = [],
  scenarios = [],
  target,
  threshold,
  drivers = [],
  method,
  accuracy,
  assumptionsNote,
  asOf,
  source,
  actions = [],
  status: lifecycle = "ready",
  onResult,
  result,
  className,
}: ForecastProps) {
  const locale = useGenUILocale();
  const streaming = lifecycle === "streaming";
  const reduceMotion = useReducedMotion();
  const titleId = React.useId();
  const hintId = React.useId();
  const g: Granularity = granularityProp ?? "month";

  const [mode, setMode] = React.useState<Mode>("median");
  const [kbIndex, setKbIndex] = React.useState<number | null>(null);
  const [sent, setSent] = React.useState<ForecastResult[]>(() =>
    result === undefined ? [] : Array.isArray(result) ? result : [result],
  );

  // Clean, sorted data; the forecast starts after the last actual.
  const history = cleanHistory(historyProp);
  const anchor: Actual | undefined = history[history.length - 1];
  const forecast = cleanForecast(forecastProp, anchor?.x);
  const readyScenarios = scenarios
    .filter((s) => isStr(s.id) && isStr(s.label))
    .slice(0, 3)
    .map((s) => ({
      id: s.id as string,
      label: s.label as string,
      note: s.note,
      points: cleanHistory(s.points),
    }))
    .filter((s) => s.points.length > 0);
  const scenarioLabels = readyScenarios.map((s) => s.label);
  const showScenarios = mode === "scenarios" && readyScenarios.length > 0;

  const rows: Row[] = buildRows(
    history,
    forecast,
    readyScenarios.map((s) => s.points),
  );
  const canDraw = history.length >= 1 && forecast.length >= (streaming ? 2 : 1);

  const readyTarget =
    isNum(target?.value) && isStr(target?.label)
      ? (target as ForecastTarget)
      : null;
  const readyThreshold =
    isNum(threshold?.value) &&
    isStr(threshold?.label) &&
    (threshold?.direction === "below" || threshold?.direction === "above")
      ? (threshold as ForecastThreshold)
      : null;
  const domain = yDomain(rows, [
    ...(readyTarget ? [readyTarget.value] : []),
    ...(readyThreshold ? [readyThreshold.value] : []),
  ]);

  const horizon = horizonSummary(forecast);
  const change = changeVsLast(history, forecast);
  const range = horizon ? rangeText(horizon, metric, locale) : null;

  // Crossings only once the forecast is complete; a partial one would move.
  const thresholdCopy: CrossingCopy | null =
    readyThreshold && horizon && !streaming
      ? crossingCopy({
          kind: "threshold",
          label: readyThreshold.label,
          value: readyThreshold.value,
          direction: readyThreshold.direction,
          range: crossingRange(
            anchor,
            forecast,
            readyThreshold.value,
            readyThreshold.direction,
          ),
          metric,
          granularity: g,
          horizonX: horizon.x,
          locale,
        })
      : null;
  const targetDir = readyTarget
    ? targetDirection(readyTarget.value, anchor?.value)
    : "above";
  const targetCopy: CrossingCopy | null =
    readyTarget && horizon && !streaming
      ? crossingCopy({
          kind: "target",
          label: readyTarget.label,
          value: readyTarget.value,
          direction: targetDir,
          range: crossingRange(anchor, forecast, readyTarget.value, targetDir),
          metric,
          granularity: g,
          horizonX: horizon.x,
          by: readyTarget.by,
          locale,
        })
      : null;
  const details = [thresholdCopy?.detail, targetCopy?.detail].filter(isStr);
  const crossingWhen =
    thresholdCopy?.marker && thresholdCopy.markerX !== null
      ? crossingDate(thresholdCopy.markerX, g, locale)
      : null;

  const summary = horizon
    ? summaryText({ metric, granularity: g, history, forecast, locale })
    : "";

  const readyDrivers = drivers
    .filter(
      (d): d is ForecastDriver =>
        isStr(d.label) && (d.effect === "up" || d.effect === "down"),
    )
    .slice(0, 5);
  const sourceUrl = safeUrl(source?.url);
  const accuracyText = accuracy?.label
    ? `${accuracy.label}${isNum(accuracy.mape) ? ` (MAPE ${formatValue(accuracy.mape, { format: "percent" }, "full", locale)})` : ""}`
    : null;
  const methodLine = [method, accuracyText].filter(isStr);

  const canAdjust = actions.includes("adjust");
  const canAlert = actions.includes("alert") && readyThreshold !== null;

  const fire = (r: ForecastResult) => {
    if (streaming) return;
    setSent((prev) =>
      prev.some((p) => sameResult(p, r)) ? prev : [...prev, r],
    );
    onResult?.(r);
  };
  const sentText = (r: ForecastResult) =>
    r.action === "adjust"
      ? "Asked to show the assumptions behind this forecast."
      : `Asked for an alert at ${formatValue(r.value, metric, "compact", locale)}${readyThreshold ? ` (${readyThreshold.label})` : ""}.`;

  const v = (n: number, style: "axis" | "compact" | "full" = "full") =>
    formatValue(n, metric, style, locale);

  // Keyboard: Left/Right walk the rows; Home/End jump; Escape clears. The
  // walk starts at the last actual, where history meets forecast.
  const anchorIndex = rows.findIndex((r) => r.kind === "anchor");
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return;
    const last = rows.length - 1;
    const current = kbIndex ?? (anchorIndex >= 0 ? anchorIndex : last);
    let next: number | null = current;
    if (e.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (e.key === "ArrowRight") next = Math.min(last, current + 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") next = null;
    else return;
    e.preventDefault();
    setKbIndex(next);
  };
  const activeRow = kbIndex !== null ? rows[kbIndex] : undefined;

  const xMin = rows[0]?.x ?? 0;
  const xMax = rows[rows.length - 1]?.x ?? 1;
  const alignAt = (x: number) => {
    const f = xMax > xMin ? (x - xMin) / (xMax - xMin) : 0.5;
    return f < 0.2 ? "start" : f > 0.8 ? "end" : "middle";
  };
  const placeAt = (y: number) => {
    if (!domain) return "above";
    const f = (y - domain[0]) / (domain[1] - domain[0] || 1);
    return f > 0.7 ? "below" : "above";
  };
  const animate = !streaming && !reduceMotion;

  const tooltip = (
    <ChartTooltip
      cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
      defaultIndex={kbIndex ?? undefined}
      active={kbIndex !== null ? true : undefined}
      isAnimationActive={false}
      content={({ active: shown, payload }: TooltipContentProps) => {
        const r = payload?.[0]?.payload as Row | undefined;
        if (!shown || !r) return null;
        const line = (k: string, val: string, key?: string) => (
          <div key={key ?? k} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {val}
            </span>
          </div>
        );
        return (
          <div className="grid min-w-40 gap-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-[13px] shadow-xl dark:shadow-none">
            <div className="font-medium">
              {formatPeriod(r.t, g, "long", locale)}
            </div>
            {isNum(r.actual) && line("Actual", v(r.actual))}
            {r.kind === "forecast" &&
              (showScenarios
                ? r.scenarios.map((s, i) =>
                    isNum(s)
                      ? line(scenarioLabels[i] ?? "", v(s), `s${i}`)
                      : null,
                  )
                : isNum(r.p50) && (
                    <>
                      {line("Median", v(r.p50))}
                      {r.outer &&
                        line(
                          "80% range",
                          formatRange(
                            r.outer[0],
                            r.outer[1],
                            metric,
                            "compact",
                            " – ",
                            locale,
                          ),
                        )}
                      {r.inner &&
                        line(
                          "50% range",
                          formatRange(
                            r.inner[0],
                            r.inner[1],
                            metric,
                            "compact",
                            " – ",
                            locale,
                          ),
                        )}
                    </>
                  ))}
          </div>
        );
      }}
    />
  );

  const hasOuter = rows.some((r) => r.kind === "forecast" && r.outer);
  const hasInner = rows.some((r) => r.kind === "forecast" && r.inner);

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="forecast"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Forecast"}
        className={cn(COLOR_TOKENS, className)}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {isStr(metric.label) ? (
            <p className={cn(genuiType.meta, "text-muted-foreground")}>
              {metric.label}
            </p>
          ) : (
            streaming && <Skeleton className="h-3 w-24" />
          )}
        </SurfaceHeader>

        <div className="flex flex-col">
          {horizon && !streaming ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className="flex flex-col gap-1.5 border-t border-border px-3 py-3"
            >
              {crossingWhen && readyThreshold ? (
                // "When does it cross?" is the answer when a threshold is crossed.
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className={genuiType.display}>
                    {`~${crossingWhen}`}
                  </span>
                  <span className={cn(genuiType.body, "text-muted-foreground")}>
                    {readyThreshold.label}
                    <span className="sr-only"> (median forecast)</span>
                  </span>
                </p>
              ) : (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className={genuiType.display}>
                    {v(horizon.p50, "compact")}
                  </span>
                  <span className={cn(genuiType.body, "text-muted-foreground")}>
                    {periodPhrase(horizon.t, g, locale)}
                    <span className="sr-only"> (median forecast)</span>
                  </span>
                </p>
              )}
              {range && !crossingWhen && (
                <p className={cn(genuiType.body, "tabular-nums")}>
                  {range.charAt(0).toUpperCase() + range.slice(1)}
                </p>
              )}
              {targetCopy?.marker && (
                <p className={cn(genuiType.body, "font-medium")}>
                  {targetCopy.marker}
                </p>
              )}
              {/* Change and crossing details stay available to screen readers. */}
              <p className="sr-only">
                {[
                  change
                    ? `${formatChange(change, metric, locale)} vs ${formatPeriod(change.fromT, g, "long", locale)}.`
                    : null,
                  ...details,
                ]
                  .filter(isStr)
                  .join(" ")}
              </p>
            </motion.div>
          ) : (
            streaming && (
              <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
            )
          )}

          <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
            {readyScenarios.length > 0 && (
              <div>
                <Segmented
                  label="Forecast view"
                  value={mode}
                  options={[
                    { value: "median", label: "Median" },
                    { value: "scenarios", label: "Scenarios" },
                  ]}
                  onChange={setMode}
                />
              </div>
            )}

            {canDraw && domain ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
              >
                <figure
                  // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so the arrow keys can move between points
                  tabIndex={0}
                  aria-label={`${title ?? metric.label ?? "Forecast"} chart`}
                  aria-describedby={hintId}
                  onKeyDown={onKeyDown}
                  onFocus={(e) => {
                    if (
                      e.currentTarget.matches(":focus-visible") &&
                      kbIndex === null
                    )
                      setKbIndex(
                        anchorIndex >= 0 ? anchorIndex : rows.length - 1,
                      );
                  }}
                  onBlur={() => setKbIndex(null)}
                  className="m-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {/* The SVG is visual only; the table below carries the numbers. */}
                  <ChartContainer
                    aria-hidden
                    config={chartConfig}
                    className="aspect-auto h-64 w-full"
                  >
                    <ComposedChart
                      data={rows}
                      accessibilityLayer={false}
                      margin={{ top: 12, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="x"
                        type="number"
                        scale="time"
                        domain={["dataMin", "dataMax"]}
                        ticks={rows.map((r) => r.x)}
                        interval="preserveStartEnd"
                        minTickGap={20}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={(x: number) =>
                          formatPeriod(x, g, "tick", locale)
                        }
                      />
                      <YAxis
                        domain={domain}
                        tickCount={5}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={4}
                        width="auto"
                        tickFormatter={(n: number) => v(n, "axis")}
                      />
                      {tooltip}

                      {!showScenarios && hasOuter && (
                        <Area
                          dataKey="outer"
                          type="linear"
                          stroke="none"
                          fill="var(--forecast-main)"
                          fillOpacity={OUTER_OPACITY}
                          activeDot={false}
                          connectNulls
                          isAnimationActive={animate}
                        />
                      )}
                      {!showScenarios && hasInner && (
                        <Area
                          dataKey="inner"
                          type="linear"
                          stroke="none"
                          fill="var(--forecast-main)"
                          fillOpacity={INNER_OPACITY}
                          activeDot={false}
                          connectNulls
                          isAnimationActive={animate}
                        />
                      )}

                      {anchor && (
                        <ReferenceLine
                          x={anchor.x}
                          stroke="var(--muted-foreground)"
                          strokeOpacity={0.6}
                          label={{
                            value: "Today",
                            position: "insideTopLeft",
                            fill: "var(--muted-foreground)",
                            fontSize: 12,
                          }}
                        />
                      )}
                      {readyTarget && (
                        <ReferenceLine
                          y={readyTarget.value}
                          stroke="var(--muted-foreground)"
                          strokeDasharray="4 4"
                          label={{
                            value: readyTarget.label,
                            position: "insideBottomLeft",
                            fill: "var(--muted-foreground)",
                            fontSize: 12,
                          }}
                        />
                      )}
                      {readyThreshold && (
                        <ReferenceLine
                          y={readyThreshold.value}
                          stroke="var(--muted-foreground)"
                          strokeDasharray="2 3"
                          label={{
                            value: `${readyThreshold.label} (${v(readyThreshold.value, "compact")})`,
                            position: "insideBottomLeft",
                            fill: "var(--muted-foreground)",
                            fontSize: 12,
                          }}
                        />
                      )}

                      <Line
                        dataKey="actual"
                        type="linear"
                        stroke="var(--forecast-main)"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 3, fill: "var(--forecast-main)" }}
                        isAnimationActive={animate}
                      />
                      {!showScenarios && (
                        <Line
                          dataKey="p50"
                          type="linear"
                          stroke="var(--forecast-main)"
                          strokeWidth={2}
                          strokeDasharray={MEDIAN_DASH}
                          dot={false}
                          activeDot={{ r: 3, fill: "var(--forecast-main)" }}
                          connectNulls
                          isAnimationActive={animate}
                        />
                      )}
                      {showScenarios &&
                        readyScenarios.map((s, i) => (
                          <Line
                            key={s.id}
                            dataKey={(r: Row) => r.scenarios[i]}
                            name={s.label}
                            type="linear"
                            stroke={SCENARIO_COLORS[i]}
                            strokeWidth={2}
                            strokeDasharray={SCENARIO_DASHES[i]}
                            dot={false}
                            activeDot={{ r: 3, fill: SCENARIO_COLORS[i] }}
                            connectNulls
                            isAnimationActive={animate}
                          />
                        ))}

                      {!showScenarios &&
                        readyThreshold &&
                        thresholdCopy?.marker &&
                        thresholdCopy.markerX !== null && (
                          <ReferenceDot
                            x={thresholdCopy.markerX}
                            y={readyThreshold.value}
                            r={0}
                            shape={markerShape(
                              thresholdCopy.marker,
                              placeAt(readyThreshold.value),
                              alignAt(thresholdCopy.markerX),
                            )}
                          />
                        )}
                      {!showScenarios &&
                        readyTarget &&
                        targetCopy?.marker &&
                        targetCopy.markerX !== null && (
                          <ReferenceDot
                            x={targetCopy.markerX}
                            y={readyTarget.value}
                            r={0}
                            shape={markerShape(
                              targetCopy.marker,
                              placeAt(readyTarget.value),
                              alignAt(targetCopy.markerX),
                            )}
                          />
                        )}
                    </ComposedChart>
                  </ChartContainer>
                </figure>

                <ul
                  aria-label="Chart key"
                  className={cn(
                    genuiType.meta,
                    "mt-2 flex flex-wrap items-center gap-x-4 gap-y-1",
                  )}
                >
                  <li className="inline-flex items-center gap-1.5">
                    <Swatch kind="line" />
                    Actual
                  </li>
                  {showScenarios ? (
                    readyScenarios.map((s, i) => (
                      <li
                        key={s.id}
                        className="inline-flex items-center gap-1.5"
                      >
                        <Swatch
                          kind="line"
                          color={SCENARIO_COLORS[i]}
                          dash={SCENARIO_DASHES[i]}
                        />
                        {s.label}
                      </li>
                    ))
                  ) : (
                    <>
                      <li className="inline-flex items-center gap-1.5">
                        <Swatch kind="line" dash={MEDIAN_DASH} />
                        Median forecast
                      </li>
                      {hasInner && (
                        <li className="inline-flex items-center gap-1.5">
                          <Swatch kind="inner" />
                          50% range
                        </li>
                      )}
                      {hasOuter && (
                        <li className="inline-flex items-center gap-1.5">
                          <Swatch kind="outer" />
                          80% range
                        </li>
                      )}
                    </>
                  )}
                </ul>

                <p id={hintId} className="sr-only">
                  {summary ? `${summary} ` : ""}
                  Use the left and right arrow keys to move between points.
                </p>
              </motion.div>
            ) : (
              <Skeleton className="h-64 w-full rounded-[10px]" />
            )}

            <div aria-live="polite" className="sr-only">
              {activeRow
                ? rowText(activeRow, {
                    metric,
                    granularity: g,
                    scenarioLabels,
                    showScenarios,
                    locale,
                  })
                : ""}
            </div>

            {showScenarios && readyScenarios.some((s) => s.note) && (
              <ul className="sr-only">
                {readyScenarios
                  .filter((s) => s.note)
                  .map((s) => (
                    <li key={s.id}>{`${s.label}: ${s.note}`}</li>
                  ))}
              </ul>
            )}

            {canDraw && (
              <table className="sr-only">
                <caption>{`${metric.label ?? title ?? "Forecast"}: actuals and forecast by ${g}`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Period</th>
                    <th scope="col">Actual</th>
                    <th scope="col">Median forecast</th>
                    {hasOuter && <th scope="col">80% range</th>}
                    {hasInner && <th scope="col">50% range</th>}
                    {readyScenarios.map((s) => (
                      <th key={s.id} scope="col">
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.x}>
                      <th scope="row">
                        {formatPeriod(r.t, g, "long", locale)}
                      </th>
                      <td>{isNum(r.actual) ? v(r.actual) : "—"}</td>
                      <td>
                        {r.kind === "forecast" && isNum(r.p50) ? v(r.p50) : "—"}
                      </td>
                      {hasOuter && (
                        <td>
                          {r.kind === "forecast" && r.outer
                            ? formatRange(
                                r.outer[0],
                                r.outer[1],
                                metric,
                                "full",
                                " to ",
                                locale,
                              )
                            : "—"}
                        </td>
                      )}
                      {hasInner && (
                        <td>
                          {r.kind === "forecast" && r.inner
                            ? formatRange(
                                r.inner[0],
                                r.inner[1],
                                metric,
                                "full",
                                " to ",
                                locale,
                              )
                            : "—"}
                        </td>
                      )}
                      {readyScenarios.map((s, i) => {
                        const sv = r.scenarios[i];
                        return (
                          <td key={s.id}>
                            {r.kind === "forecast" && isNum(sv) ? v(sv) : "—"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {(readyDrivers.length > 0 ||
            methodLine.length > 0 ||
            assumptionsNote) &&
            !streaming && (
              // Why the forecast looks this way: on request, not by default.
              <details className="group/why border-t border-border px-3 py-3">
                <summary
                  className={cn(
                    genuiType.meta,
                    "inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden",
                  )}
                >
                  Drivers and assumptions
                  <ChevronDownIcon
                    aria-hidden
                    className="size-3.5 transition-transform group-open/why:rotate-180"
                  />
                </summary>
                <div className="flex flex-col gap-3 pt-3">
                  {readyDrivers.length > 0 && (
                    <ul className="flex flex-col gap-1.5">
                      {readyDrivers.map((d) => {
                        const Icon =
                          d.effect === "up" ? ArrowUpIcon : ArrowDownIcon;
                        return (
                          <li
                            key={d.label}
                            className={cn(genuiType.body, "flex gap-2")}
                          >
                            <Icon
                              aria-hidden
                              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                            />
                            <span className="min-w-0">
                              <span className="sr-only">
                                {d.effect === "up"
                                  ? "Pushes up: "
                                  : "Pushes down: "}
                              </span>
                              <span className="font-medium">{d.label}</span>
                              {d.note && ` · ${d.note}`}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {(methodLine.length > 0 || assumptionsNote) && (
                    <p className={genuiType.meta}>
                      {[methodLine.join(" · "), assumptionsNote]
                        .filter(isStr)
                        .join(" ")}
                    </p>
                  )}
                </div>
              </details>
            )}
        </div>

        <SurfaceFooter className="flex-col items-stretch gap-3">
          <div
            aria-live="polite"
            className={cn(
              "flex flex-col gap-1",
              sent.length === 0 && "sr-only",
            )}
          >
            {sent.map((r) => (
              <p
                key={r.action === "alert" ? `alert-${r.value}` : r.action}
                className={cn(genuiType.body, "flex items-center gap-1.5")}
              >
                <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                {sentText(r)}
              </p>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p
              className={cn(
                genuiType.meta,
                "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1",
              )}
            >
              {streaming ? (
                <ShimmeringText
                  text="Running the forecast…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : (
                <>
                  {asOf && <span>{formatAsOf(asOf, locale)}</span>}
                  {asOf && source?.label && <span aria-hidden>·</span>}
                  {source?.label &&
                    (sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-6 items-center gap-1 rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {source.label}
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <span>{source.label}</span>
                    ))}
                </>
              )}
            </p>
            {(canAdjust || canAlert) && (
              <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                {canAdjust && (
                  <Button
                    size="sm"
                    variant={
                      canAlert && readyThreshold ? "secondary" : "default"
                    }
                    disabled={streaming}
                    onClick={() => fire({ action: "adjust" })}
                    className="flex-1 sm:flex-none"
                  >
                    <SlidersHorizontalIcon aria-hidden />
                    Change assumptions
                  </Button>
                )}
                {canAlert && readyThreshold && (
                  <Button
                    size="sm"
                    disabled={streaming}
                    onClick={() =>
                      fire({ action: "alert", value: readyThreshold.value })
                    }
                    className="flex-1 sm:flex-none"
                  >
                    <BellIcon aria-hidden />
                    Set an alert
                    <span className="sr-only">{` for ${readyThreshold.label} at ${v(readyThreshold.value, "compact")}`}</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  );
}
