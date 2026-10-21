"use client"

import * as React from "react"
import { MotionConfig, motion } from "motion/react"

import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
  genuiType,
  surfaceInset,
} from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"
import { SERIES_VARS } from "@/components/genui/series-colors"
import { cn } from "@/lib/utils"

import {
  buildPoints,
  formatDay,
  formatPeriod,
  formatUsage,
  indexAt,
  rangeStat,
  stepPath,
  type UsagePoint,
} from "./usage-chart-utils"
import type { UsageChartInput, UsageStat, UsageValue } from "./usage-chart.schema"

export type UsageChartProps = Partial<Omit<UsageChartInput, "value" | "overlay" | "stats" | "data">> & {
  /** Fields may be partial while the tool call streams. */
  value?: Partial<UsageValue>
  overlay?: Partial<UsageValue>
  stats?: Partial<UsageStat>[]
  /** Days arrive progressively while streaming. */
  data?: Record<string, string | number>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

// Shared defaults: a fresh `{}` or `[]` every render would defeat the memos.
const NO_VALUE: Partial<UsageValue> = {}
const NO_STATS: Partial<UsageStat>[] = []
const NO_ROWS: Record<string, string | number>[] = []

/** The main mark: the Chart's first neutral step for each theme. */
const MARK = "[--mark:var(--chart-5)] dark:[--mark:var(--chart-1)]"
const OVERLAY = "var(--series-2)"

const PLOT_H = 168
const TOP = 8 // headroom above the tallest day
const TIP_W = 168 // the hover card's widest case, for flipping it off the edge

/** The width of an element, kept current as it resizes. */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = React.useRef<T>(null)
  const [width, setWidth] = React.useState(fallback)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width) || fallback)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [fallback])
  return [ref, width] as const
}

type PlotProps = {
  values: number[]
  overlays: number[] | null
  band: number
  width: number
  sy: (v: number) => number
  baseY: number
}

/** The two stepped areas. Pure, so scrubbing never redraws the paths. */
const Plot = React.memo(function Plot({ values, overlays, band, width, sy, baseY }: PlotProps) {
  return (
    <>
      <path d={stepPath(values, 0, band, sy, baseY)} fill="var(--mark)" fillOpacity={0.07} />
      <path
        d={stepPath(values, 0, band, sy)}
        fill="none"
        stroke="var(--mark)"
        strokeOpacity={0.75}
        strokeWidth={1.25}
        strokeLinejoin="round"
      />
      {overlays && (
        <>
          <path d={stepPath(overlays, 0, band, sy, baseY)} fill={OVERLAY} fillOpacity={0.12} />
          <path
            d={stepPath(overlays, 0, band, sy)}
            fill="none"
            stroke={OVERLAY}
            strokeWidth={1.5}
            strokeLinejoin="round"
          />
        </>
      )}
      <line x1={0} x2={width} y1={baseY} y2={baseY} stroke="var(--border)" />
    </>
  )
})

export function UsageChart({
  title,
  dateKey,
  value = NO_VALUE,
  overlay = NO_VALUE,
  stats = NO_STATS,
  data = NO_ROWS,
  summary,
  status: lifecycle = "ready",
  className,
}: UsageChartProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const titleId = React.useId()
  const clipId = React.useId().replace(/:/g, "")
  const [frameRef, width] = useWidth<HTMLDivElement>(480)
  // The day being scrubbed; null shows the whole period.
  const [scrub, setScrub] = React.useState<number | null>(null)

  const hasOverlay = Boolean(overlay.key)
  const points = React.useMemo<UsagePoint[]>(
    () => buildPoints(data, dateKey, value.key, overlay.key),
    [data, dateKey, value.key, overlay.key],
  )
  const n = points.length
  const canDraw = n >= 2

  const last = n - 1
  const active = scrub === null ? last : Math.min(scrub, last)
  const scrubbing = scrub !== null && canDraw
  const current = points[active]

  const readyStats = stats.filter(
    (s): s is UsageStat =>
      typeof s.label === "string" && typeof s.key === "string" && typeof s.op === "string",
  )

  const band = width / Math.max(1, n)
  const peak = Math.max(1, ...points.map((p) => p.value))
  const baseY = TOP + PLOT_H
  const sy = React.useCallback((v: number) => baseY - (Math.max(0, v) / peak) * PLOT_H, [baseY, peak])
  const values = React.useMemo(() => points.map((p) => p.value), [points])
  const overlays = React.useMemo(
    () => (hasOverlay ? points.map((p) => p.overlay ?? 0) : null),
    [points, hasOverlay],
  )

  const fmtValue = (v: number | null | undefined) => formatUsage(v, value, locale)
  const fmtOverlay = (v: number | null | undefined) => formatUsage(v, overlay, locale)

  const period =
    canDraw && current ? formatPeriod(points[0].t, current.t, locale) : undefined

  const step = (to: number) => setScrub(Math.min(last, Math.max(0, to)))
  const pointTo = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setScrub(indexAt(e.clientX - rect.left, 0, rect.width / n, n))
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    const from = scrub ?? last
    const to =
      e.key === "ArrowRight" || e.key === "ArrowUp"
        ? from + 1
        : e.key === "ArrowLeft" || e.key === "ArrowDown"
          ? from - 1
          : e.key === "PageUp"
            ? from + 7
            : e.key === "PageDown"
              ? from - 7
              : e.key === "Home"
                ? 0
                : e.key === "End"
                  ? last
                  : null
    if (to !== null) {
      e.preventDefault()
      step(to)
    } else if (e.key === "Escape") {
      setScrub(null)
    }
  }

  const cx = current ? (active + 0.5) * band : 0
  const cut = (active + 1) * band
  const tipLeft = cx > width - TIP_W - 24 ? cx - 12 - TIP_W : cx + 12

  const valueText = current
    ? `${formatDay(current.t, locale)}: ${value.label ?? "Value"} ${fmtValue(current.value)}${
        hasOverlay ? `, ${overlay.label ?? "Part"} ${fmtOverlay(current.overlay)}` : ""
      }. ${readyStats
        .map((s) => `${s.label} ${formatUsage(rangeStat(points, active, s), s, locale)}`)
        .join(", ")}`
    : undefined

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="usage-chart"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Usage"}
        className={cn(SERIES_VARS, className)}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          <SurfaceDescription className="tabular-nums">
            {period ?? " "}
          </SurfaceDescription>
        </SurfaceHeader>

        <div className={cn("border-t border-border py-3", surfaceInset)}>
          <div ref={frameRef} className={cn("relative", MARK)}>
            {canDraw ? (
              <>
                <div
                  role="slider"
                  tabIndex={0}
                  aria-label={`${title ?? "Usage"} by day`}
                  aria-valuemin={0}
                  aria-valuemax={last}
                  aria-valuenow={active}
                  aria-valuetext={valueText}
                  onPointerDown={pointTo}
                  onPointerMove={pointTo}
                  onPointerLeave={() => setScrub(null)}
                  onPointerCancel={() => setScrub(null)}
                  onPointerUp={(e) => e.pointerType === "touch" && setScrub(null)}
                  onKeyDown={onKeyDown}
                  onBlur={() => setScrub(null)}
                  className="block touch-pan-y rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {/* The SVG is visual only; the table below carries the numbers. */}
                  <svg aria-hidden width={width} height={baseY} className="block overflow-visible">
                    <defs>
                      <clipPath id={`${clipId}-reveal`}>
                        <motion.rect
                          x={0}
                          y={0}
                          height={baseY + 2}
                          initial={{ width: 0 }}
                          animate={{ width }}
                          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                        />
                      </clipPath>
                      <clipPath id={`${clipId}-before`}>
                        <rect x={0} y={0} width={cut} height={baseY + 2} />
                      </clipPath>
                      <clipPath id={`${clipId}-after`}>
                        <rect x={cut} y={0} width={Math.max(0, width - cut)} height={baseY + 2} />
                      </clipPath>
                    </defs>
                    <g clipPath={`url(#${clipId}-reveal)`}>
                      {scrubbing ? (
                        <>
                          <g clipPath={`url(#${clipId}-before)`}>
                            <Plot values={values} overlays={overlays} band={band} width={width} sy={sy} baseY={baseY} />
                          </g>
                          <g clipPath={`url(#${clipId}-after)`} opacity={0.28}>
                            <Plot values={values} overlays={overlays} band={band} width={width} sy={sy} baseY={baseY} />
                          </g>
                        </>
                      ) : (
                        <Plot values={values} overlays={overlays} band={band} width={width} sy={sy} baseY={baseY} />
                      )}
                    </g>
                    {scrubbing && current && (
                      <g>
                        <line x1={cx} x2={cx} y1={0} y2={baseY} stroke="var(--border)" />
                        <circle
                          cx={cx}
                          cy={sy(current.value)}
                          r={3.5}
                          fill="var(--card)"
                          stroke="var(--mark)"
                          strokeWidth={1.5}
                        />
                        {hasOverlay && current.overlay !== null && (
                          <circle
                            cx={cx}
                            cy={sy(current.overlay)}
                            r={3.5}
                            fill="var(--card)"
                            stroke={OVERLAY}
                            strokeWidth={1.5}
                          />
                        )}
                      </g>
                    )}
                  </svg>
                </div>

                {scrubbing && current && (
                  <motion.div
                    aria-hidden
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={genuiMotion.fade}
                    className="pointer-events-none absolute top-2 z-10 rounded-lg border bg-popover px-3 py-2 text-[12px] leading-[1.55] text-popover-foreground shadow-lg dark:shadow-none"
                    style={{ left: Math.max(0, tipLeft), width: TIP_W }}
                  >
                    <div className="pb-1 text-muted-foreground">{formatDay(current.t, locale)}</div>
                    <div className="grid gap-0.5">
                      <TipRow
                        color="var(--mark)"
                        label={value.label ?? "Value"}
                        value={fmtValue(current.value)}
                      />
                      {hasOverlay && (
                        <TipRow
                          color={OVERLAY}
                          label={overlay.label ?? "Part"}
                          value={current.overlay === null ? "—" : fmtOverlay(current.overlay)}
                        />
                      )}
                    </div>
                  </motion.div>
                )}

                <div className={cn("flex flex-wrap gap-x-4 gap-y-1 pt-2", genuiType.meta)}>
                  <LegendItem color="var(--mark)" label={labelWithUnit(value)} />
                  {hasOverlay && <LegendItem color={OVERLAY} label={labelWithUnit(overlay)} />}
                </div>
              </>
            ) : (
              <Skeleton className="w-full" style={{ height: PLOT_H + TOP }} />
            )}
          </div>
        </div>

        <dl
          className={cn(
            "flex flex-wrap gap-x-6 gap-y-3 border-t border-border py-3",
            surfaceInset,
          )}
        >
          {readyStats.length === 0 && streaming ? (
            <Skeleton className="h-12 w-40" />
          ) : (
            readyStats.map((s) => (
              <div key={s.label} className="flex min-w-24 flex-none flex-col">
                <dt className={genuiType.label}>{s.label}</dt>
                <dd className={genuiType.stat}>
                  {canDraw ? formatUsage(rangeStat(points, active, s), s, locale) : "—"}
                </dd>
              </div>
            ))
          )}
        </dl>

        {canDraw && (
          <div className="sr-only">
            <table>
              <caption>{`${title ?? "Usage"}: per day`}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">{value.label ?? "Value"}</th>
                  {hasOverlay && <th scope="col">{overlay.label ?? "Part"}</th>}
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.t}>
                    <th scope="row">{formatDay(p.t, locale)}</th>
                    <td>{fmtValue(p.value)}</td>
                    {hasOverlay && <td>{p.overlay === null ? "None" : fmtOverlay(p.overlay)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary && (
          <p
            className={cn(
              "border-t border-border py-3 text-muted-foreground",
              genuiType.body,
              surfaceInset,
            )}
          >
            {summary}
          </p>
        )}
      </Surface>
    </MotionConfig>
  )
}

const labelWithUnit = (v: Partial<UsageValue>) =>
  v.unit ? `${v.label ?? "Value"} (${v.unit})` : (v.label ?? "Value")

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden
        className="size-2.5 rounded-[3px] border-[1.5px]"
        style={{ borderColor: color }}
      />
      {label}
    </span>
  )
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className="size-2.5 shrink-0 rounded-[3px] border-[1.5px]"
        style={{ borderColor: color }}
      />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-medium tabular-nums">{value}</span>
    </div>
  )
}
