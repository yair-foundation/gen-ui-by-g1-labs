"use client";

import * as React from "react";
import { Menu } from "@base-ui/react/menu";
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChevronDownIcon,
  DownloadIcon,
  TrendingDownIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering";
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
  FunnelAction,
  FunnelInput,
  FunnelPeriod,
  FunnelResult,
  FunnelSegment,
  FunnelSource,
  FunnelStep,
  FunnelValue,
} from "./funnel.schema";
import {
  type FunnelSegmentData,
  type FunnelStepData,
  RECOVERY_SHARE,
  barWidth,
  biggestDrop,
  conversionChange,
  csvFileName,
  describeFunnel,
  describePts,
  direction,
  dropCounts,
  estimateOpportunity,
  findIncreases,
  formatAsOf,
  formatCompact,
  formatCount,
  formatMoney,
  formatPct,
  formatPrice,
  formatPts,
  funnelCsv,
  normalizeSegments,
  overallConversion,
  pctOfFirst,
  stepConversions,
} from "./funnel-utils";

export type FunnelProps = Partial<
  Omit<
    FunnelInput,
    "steps" | "segments" | "period" | "value" | "source" | "actions"
  >
> & {
  /** Steps and segments may be partial while the tool call streams. */
  steps?: Partial<FunnelStep>[];
  segments?: Partial<FunnelSegment>[];
  period?: Partial<FunnelPeriod>;
  value?: Partial<FunnelValue>;
  source?: Partial<FunnelSource>;
  actions?: (FunnelAction | undefined)[];
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready";
  /**
   * Called each time the user drills into a step or exports. The funnel
   * never locks; there's no finished state to restore.
   */
  onResult?: (result: FunnelResult) => void;
  className?: string;
};

// Neutral chart steps per theme, so the first series has the most contrast.
const PRIMARY_BG = "bg-chart-5 dark:bg-chart-1";
const SERIES_BG = [
  "bg-chart-5 dark:bg-chart-1",
  "bg-chart-3 dark:bg-chart-2",
  "bg-chart-2 dark:bg-chart-3",
  "bg-chart-1 dark:bg-chart-4 ring-1 ring-inset ring-foreground/25",
];

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const;

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

const isStep = (s: Partial<FunnelStep>): s is FunnelStepData =>
  typeof s.id === "string" &&
  typeof s.label === "string" &&
  isNum(s.count) &&
  s.count >= 0;

function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

/** A compact count ("18.2K") with the full number for screen readers. */
function Count({ n }: { n: number }) {
  const locale = useGenUILocale();
  const compact = formatCompact(n, locale);
  const full = formatCount(n, locale);
  if (compact === full) return <>{full}</>;
  return (
    <>
      <span aria-hidden>{compact}</span>
      <span className="sr-only">{full}</span>
    </>
  );
}

/** Sign, arrow and text; never color alone. */
function Change({
  text,
  description,
  value,
  className,
}: {
  text: string;
  description: string;
  value: number;
  className?: string;
}) {
  const locale = useGenUILocale();
  const dir = direction(value, text, locale);
  const Icon =
    dir === "up"
      ? ArrowUpRightIcon
      : dir === "down"
        ? ArrowDownRightIcon
        : null;
  return (
    <Badge
      variant={
        dir === "up" ? "success" : dir === "down" ? "destructive" : "outline"
      }
      className={cn("tabular-nums", className)}
    >
      {Icon && <Icon aria-hidden />}
      <span aria-hidden>{text.replace(/^[+−-]\s*/, "")}</span>
      <span className="sr-only">{description}</span>
    </Badge>
  );
}

/** The overall conversion, rolling to its new value on a view switch. */
function Conversion({ ratio }: { ratio: number }) {
  const locale = useGenUILocale();
  const text = formatPct(ratio, locale);
  const decimal =
    new Intl.NumberFormat(locale)
      .formatToParts(1.5)
      .find((p) => p.type === "decimal")?.value ?? ".";
  const decimals = text.includes(decimal) ? 1 : 0;
  const pct = Math.round(ratio * 100 * 10 ** decimals) / 10 ** decimals;
  return (
    <span className={cn("inline-flex", genuiType.display)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="inline-flex items-center">
        <SlidingNumber
          key={decimals}
          number={pct}
          decimalPlaces={decimals}
          decimalSeparator={decimal}
          initiallyStable
        />
        %
      </span>
    </span>
  );
}

/** A horizontal bar on a muted track, animating its width. */
function Bar({
  width,
  className,
  trackClassName,
  instant,
}: {
  width: number;
  className?: string;
  trackClassName?: string;
  instant: boolean;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "overflow-hidden bg-muted dark:bg-white/10",
        trackClassName,
      )}
    >
      <motion.div
        className={cn("h-full", className)}
        initial={{ width: instant ? `${width}%` : "0%" }}
        animate={{ width: `${width}%` }}
        transition={{ duration: instant ? 0 : 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

function ViewSwitch({
  options,
  value,
  name,
  title,
  disabled,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  name: string;
  title: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="flex w-full max-w-full min-w-0 flex-wrap gap-0.5 rounded-full border border-border bg-transparent p-1">
      <legend className="sr-only">{`View for ${title}`}</legend>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label
            key={o.value}
            className={cn(
              "relative inline-flex h-8 min-w-12 flex-1 cursor-pointer items-center justify-center truncate rounded-full px-3.5 text-[13px] font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
              on
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:text-foreground",
              !on && !disabled && "hover:bg-accent",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              disabled={disabled}
              onChange={() => onChange(o.value)}
              className="sr-only"
            />
            {o.label}
          </label>
        );
      })}
    </fieldset>
  );
}

function DrillMenu({
  steps,
  counts,
  disabled,
  single,
  onPick,
}: {
  steps: FunnelStepData[];
  counts: number[];
  disabled: boolean;
  single?: boolean;
  onPick: (stepId: string) => void;
}) {
  const locale = useGenUILocale();
  return (
    <Menu.Root>
      <Menu.Trigger
        disabled={disabled}
        render={<Button size="sm" variant={single ? "default" : "secondary"} />}
      >
        Drill into step
        <ChevronDownIcon aria-hidden />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner
          sideOffset={4}
          align="end"
          className="isolate z-50 outline-none"
        >
          <Menu.Popup className="min-w-48 origin-(--transform-origin) rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10 outline-none">
            {steps.map((s, i) => (
              <Menu.Item
                key={s.id}
                label={s.label}
                onClick={() => onPick(s.id)}
                className="flex min-h-9 cursor-default items-center justify-between gap-4 rounded-lg px-3 py-2 text-[13px] outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
              >
                <span>{`Drill into ${s.label}`}</span>
                <span
                  aria-hidden
                  className="text-[13px] tabular-nums text-muted-foreground"
                >
                  {formatCompact(counts[i] ?? s.count, locale)}
                </span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

const ALL = "all";
const COMPARE = "compare";
const segValue = (id: string) => `segment:${id}`;

export function Funnel({
  title,
  steps: stepsProp = [],
  period,
  segments: segmentsProp,
  value,
  insight,
  source,
  asOf,
  actions = [],
  status: lifecycle = "ready",
  onResult,
  className,
}: FunnelProps) {
  const locale = useGenUILocale();
  const streaming = lifecycle === "streaming";
  const reduceMotion = Boolean(useReducedMotion());
  const titleId = React.useId();
  const radioName = React.useId();
  const [view, setView] = React.useState(ALL);
  const [announcement, setAnnouncement] = React.useState("");

  const steps = stepsProp.filter(isStep);
  const allCounts = steps.map((s) => s.count);
  // Segments need every step to be checked against, so wait for the payload.
  const { valid: segments, issues } = streaming
    ? { valid: [] as FunnelSegmentData[], issues: [] }
    : normalizeSegments(segmentsProp, steps.length);
  const activeSegment = segments.find((s) => segValue(s.id) === view);
  const mode: "all" | "segment" | "compare" =
    view === COMPARE && segments.length > 0
      ? "compare"
      : activeSegment
        ? "segment"
        : "all";
  const viewValue = mode === "all" ? ALL : view;

  const counts = activeSegment ? activeSegment.counts : allCounts;
  const complete = !streaming && steps.length >= 2;
  const ofFirst = pctOfFirst(counts);
  const conversions = stepConversions(counts);
  const drops = dropCounts(counts);
  const drop = complete ? biggestDrop(counts) : null;
  const increases = findIncreases(steps, counts);
  const showPrevious = mode === "all";
  const hasPrevious = steps.some((s) => isNum(s.previous));
  // The previous period is in the header's change and the hidden table, not
  // drawn per step, so bars scale to this period's first step.
  const base = counts[0] ?? 0;

  const overall = complete ? overallConversion(counts) : null;
  const change =
    complete && mode !== "segment" ? conversionChange(steps) : null;
  const currency = value?.currency;
  const opportunity =
    complete && currency
      ? estimateOpportunity(allCounts, value?.perConversion)
      : null;

  const canDrill = actions.includes("drill-down");
  const canExport = actions.includes("export");
  const compareLabel = period?.compareLabel;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const scope = activeSegment?.label;
  const caption = [title ?? "Funnel", scope].filter(Boolean).join(", ");

  const drill = (stepId: string) =>
    onResult?.({
      action: "drill-down",
      stepId,
      ...(mode === "segment" && activeSegment
        ? { segmentId: activeSegment.id }
        : {}),
    });

  const exportCsv = () => {
    const fileName = csvFileName(title);
    const blob = new Blob([funnelCsv(steps, segments)], {
      type: "text/csv;charset=utf-8",
    });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    setAnnouncement(`Exported ${fileName}`);
    onResult?.({ action: "export" });
  };

  const viewOptions = [
    { value: ALL, label: "All" },
    ...segments.map((s) => ({ value: segValue(s.id), label: s.label })),
    { value: COMPARE, label: "Compare" },
  ];
  const changeView = (next: string) => {
    setView(next);
    const label = viewOptions.find((o) => o.value === next)?.label ?? "";
    const seg = segments.find((s) => segValue(s.id) === next);
    const conv = overallConversion(seg ? seg.counts : allCounts);
    setAnnouncement(
      next === COMPARE
        ? `Comparing ${segments.map((s) => s.label).join(" and ")}`
        : `Showing ${label}${conv !== null ? `: ${formatPct(conv, locale)} convert` : ""}`,
    );
  };

  const sourceUrl = safeUrl(source?.url);
  const showMeta = Boolean(asOf || source?.label);
  const showFooter = showMeta || canDrill || canExport || streaming;

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="funnel"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Funnel"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex flex-col gap-0.5">
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            {period?.label && (
              <p className={cn(genuiType.meta, "text-muted-foreground")}>
                {period.label}
                {compareLabel && hasPrevious && ` vs ${compareLabel}`}
              </p>
            )}
          </div>
        </SurfaceHeader>

        {(overall !== null && first && last) || streaming ? (
          <div className="border-t border-border px-3 py-3">
            {overall !== null && first && last ? (
              <motion.div {...enter} className="flex flex-col gap-y-1">
                <div className="flex min-w-0 flex-nowrap items-baseline gap-2">
                  <Conversion ratio={overall} />
                  {change && (
                    <Change
                      text={formatPts(change.deltaPts, locale)}
                      description={`${describePts(change.deltaPts, locale)}${compareLabel ? ` vs ${compareLabel}` : " vs the previous period"}`}
                      value={change.deltaPts}
                      className="shrink-0 text-[13px] font-medium"
                    />
                  )}
                </div>
                <span className={genuiType.meta}>
                  {first.label}
                  {" to "}
                  {last.label}
                  {scope && `, ${scope}`}
                </span>
              </motion.div>
            ) : streaming ? (
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-3 w-44" />
              </div>
            ) : null}
          </div>
        ) : null}

        {segments.length > 0 && (
          <div className="border-t border-border px-3 py-2">
            <ViewSwitch
              options={viewOptions}
              value={viewValue}
              name={radioName}
              title={title ?? "funnel"}
              disabled={streaming}
              onChange={changeView}
            />
          </div>
        )}

        {mode === "compare" ? (
          <figure
            aria-label={`Compare ${segments
              .map((s) => {
                const c = overallConversion(s.counts);
                return `${s.label}${c !== null ? ` ${formatPct(c, locale)}` : ""}`;
              })
              .join(", ")} conversion from ${first?.label} to ${last?.label}.`}
            className="m-0 flex flex-col gap-4 border-t border-border px-3 py-3"
          >
            {/* Each segment's overall conversion: the comparison asked for. */}
            <ol aria-hidden className="flex flex-wrap gap-x-5 gap-y-1">
              {segments.map((s, k) => {
                const c = overallConversion(s.counts);
                return (
                  <li key={s.id} className="flex items-center gap-1.5">
                    <span
                      className={cn("size-2.5 rounded-[3px]", SERIES_BG[k])}
                    />
                    <span className={genuiType.body}>{s.label}</span>
                    {c !== null && (
                      <span className="font-figure text-[24px] font-normal tracking-tight tabular-nums">
                        {formatPct(c, locale)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            <ol className="flex flex-col gap-3">
              {steps.map((step, i) => (
                <motion.li
                  key={step.id}
                  {...enter}
                  className="flex flex-col gap-1.5"
                >
                  <span className="min-w-0 truncate text-[13px] font-medium">
                    {step.label}
                  </span>
                  <div
                    aria-hidden
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1"
                  >
                    {segments.map((s, k) => {
                      const ratio = pctOfFirst(s.counts)[i];
                      return (
                        <React.Fragment key={s.id}>
                          <span className={genuiType.meta}>{s.label}</span>
                          <Bar
                            width={barWidth(s.counts[i], s.counts[0])}
                            className={cn("rounded-sm", SERIES_BG[k])}
                            trackClassName="h-3 rounded-sm"
                            instant={reduceMotion}
                          />
                          <span className="text-end text-[13px] tabular-nums">
                            {formatPct(ratio, locale)}
                          </span>
                        </React.Fragment>
                      );
                    })}
                  </div>
                </motion.li>
              ))}
            </ol>
            <table className="sr-only">
              <caption>{`${title ?? "Funnel"}, by segment`}</caption>
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  {segments.map((s) => (
                    <React.Fragment key={s.id}>
                      <th scope="col">{`${s.label} count`}</th>
                      <th scope="col">{`${s.label} % of first step`}</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {steps.map((step, i) => (
                  <tr key={step.id}>
                    <th scope="row">{step.label}</th>
                    {segments.map((s) => (
                      <React.Fragment key={s.id}>
                        <td>{formatCount(s.counts[i], locale)}</td>
                        <td>{formatPct(pctOfFirst(s.counts)[i], locale)}</td>
                      </React.Fragment>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </figure>
        ) : (
          <figure
            aria-label={
              complete
                ? describeFunnel(steps, counts, scope, locale)
                : undefined
            }
            className="m-0 border-t border-border px-3 py-3"
          >
            <ol className="flex flex-col">
              {steps.map((step, i) => {
                const count = counts[i];
                const increase = increases.find((x) => x.index === i);
                const conv = conversions[i];
                return (
                  <motion.li key={step.id} {...enter} className="flex flex-col">
                    {i > 0 && (
                      <div className="flex items-stretch gap-3 ps-3">
                        <span aria-hidden className="w-px shrink-0 bg-border" />
                        <p
                          className={cn(
                            "flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5",
                            genuiType.meta,
                          )}
                        >
                          {increase ? (
                            <span className="inline-flex items-center gap-1 font-medium text-foreground">
                              <TriangleAlertIcon
                                aria-hidden
                                className="size-3.5 shrink-0"
                              />
                              {increase.message}
                            </span>
                          ) : conv === null ? (
                            <span>No one reached the step before</span>
                          ) : (
                            <>
                              <span className="tabular-nums">
                                {formatPct(conv, locale)} continue
                              </span>
                              {/* The drop itself is in the hidden table. */}
                              <span className="sr-only">
                                {`, ${formatCount(drops[i], locale)} leave`}
                              </span>
                              {drop?.index === i && (
                                <span className="inline-flex items-center gap-1 font-medium text-foreground">
                                  <TrendingDownIcon
                                    aria-hidden
                                    className="size-3.5 shrink-0"
                                  />
                                  Biggest drop
                                </span>
                              )}
                            </>
                          )}
                        </p>
                      </div>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex min-h-5 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                          {step.label}
                        </span>
                        <span className="shrink-0 text-[13px] font-medium tabular-nums">
                          <Count n={count} />
                          <span className="font-normal text-muted-foreground">
                            {" · "}
                            {formatPct(ofFirst[i], locale)}
                            <span className="sr-only"> of the first step</span>
                          </span>
                        </span>
                      </div>
                      <Bar
                        width={barWidth(count, base)}
                        className={cn("rounded-md", PRIMARY_BG)}
                        trackClassName="h-5 rounded-md"
                        instant={reduceMotion}
                      />
                    </div>
                  </motion.li>
                );
              })}
              {streaming && (
                <li aria-hidden className="flex flex-col gap-1.5 pt-3">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-6 w-full" />
                </li>
              )}
            </ol>
            {steps.length > 0 && (
              <table className="sr-only">
                <caption>{caption}</caption>
                <thead>
                  <tr>
                    <th scope="col">Step</th>
                    <th scope="col">Count</th>
                    <th scope="col">% of first step</th>
                    <th scope="col">Step conversion</th>
                    {showPrevious && hasPrevious && (
                      <th scope="col">{compareLabel ?? "Previous period"}</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {steps.map((step, i) => (
                    <tr key={step.id}>
                      <th scope="row">{step.label}</th>
                      <td>{formatCount(counts[i], locale)}</td>
                      <td>{formatPct(ofFirst[i], locale)}</td>
                      <td>
                        {conversions[i] === null
                          ? "–"
                          : formatPct(conversions[i] as number, locale)}
                      </td>
                      {showPrevious && hasPrevious && (
                        <td>
                          {isNum(step.previous)
                            ? formatCount(step.previous, locale)
                            : "–"}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </figure>
        )}

        {complete && (issues.length > 0 || opportunity || insight) && (
          <motion.div
            {...enter}
            className="flex flex-col gap-2 border-t border-border px-3 py-3"
          >
            {issues.map((issue) => (
              <div
                key={issue.id}
                className="rounded-[10px] border border-border bg-transparent p-1"
              >
                <p className="flex items-center gap-3 rounded-md bg-orange-500/10 px-3 py-3 text-[13px] dark:bg-orange-400/10">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500/15 dark:bg-orange-400/15">
                    <TriangleAlertIcon
                      aria-hidden
                      className="size-4 shrink-0 text-orange-500 dark:text-orange-400"
                    />
                  </span>
                  <span className="min-w-0 flex-1">{issue.message}</span>
                </p>
              </div>
            ))}
            {insight && <p className={genuiType.body}>{insight}</p>}
            {opportunity && currency && (
              // The assumption (they then convert like everyone else, at
              // perConversion each) is spelled out for screen readers only.
              <p className={genuiType.body}>
                {`Recovering ${formatPct(RECOVERY_SHARE, locale)} after ${steps[opportunity.index - 1]?.label} ≈ `}
                <span className="font-medium tabular-nums">
                  +{formatMoney(opportunity.value, currency, locale)}
                </span>
                <span className="sr-only">
                  {` per period: ${formatCount(opportunity.lost, locale)} people leave there; at ${formatPrice(value?.perConversion as number, currency, locale)} per conversion, if they then convert like everyone else.`}
                </span>
              </p>
            )}
          </motion.div>
        )}

        {showFooter && (
          <SurfaceFooter className="justify-between gap-y-2">
            <div
              className={cn(
                "flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1",
                genuiType.meta,
              )}
            >
              {streaming ? (
                <ShimmeringText
                  text="Loading funnel…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : (
                <>
                  {source?.label &&
                    (sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {source.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span>{source.label}</span>
                    ))}
                  {source?.label && asOf && <span aria-hidden>·</span>}
                  {asOf && (
                    <time dateTime={asOf} suppressHydrationWarning>
                      <span className="sr-only">As of </span>
                      {formatAsOf(asOf, undefined, locale)}
                    </time>
                  )}
                </>
              )}
            </div>
            {(canDrill || canExport) && steps.length > 0 && (
              <div className="ms-auto flex flex-wrap gap-2">
                {canDrill && (
                  <DrillMenu
                    steps={steps}
                    counts={counts}
                    disabled={streaming}
                    single={!canExport}
                    onPick={drill}
                  />
                )}
                {canExport && (
                  <Button
                    size="sm"
                    variant={canDrill ? "secondary" : "default"}
                    disabled={streaming}
                    onClick={exportCsv}
                  >
                    <DownloadIcon aria-hidden />
                    Export CSV
                  </Button>
                )}
              </div>
            )}
          </SurfaceFooter>
        )}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </Surface>
    </MotionConfig>
  );
}
