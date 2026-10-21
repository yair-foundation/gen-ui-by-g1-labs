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
import { cn } from "@/lib/utils"

import {
  formatMeasure,
  makeBins,
  niceTicks,
  precisionOf,
  splitGroups,
  stackDots,
  summarize,
  type Summary,
  toNumber,
} from "./distribution-chart-utils"
import type {
  DistributionChartInput,
  DistributionMarker,
  DistributionMeasure,
} from "./distribution-chart.schema"

export type DistributionChartProps = Partial<
  Omit<DistributionChartInput, "measure" | "group" | "markers" | "data">
> & {
  /** Fields may be partial while the tool call streams. */
  measure?: Partial<DistributionMeasure>
  group?: { key?: string; label?: string }
  markers?: Partial<DistributionMarker>[]
  /** Values arrive progressively while streaming. */
  data?: Record<string, string | number>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type Item = { v: number; name?: string; group?: string }
type Hover = { x: number; y: number; title: string; rows: [string, string][] }

// Shared defaults: a fresh `{}` or `[]` every render would defeat the memos.
const NO_MEASURE: Partial<DistributionMeasure> = {}
const NO_ROWS: Record<string, string | number>[] = []
const NO_MARKERS: Partial<DistributionMarker>[] = []

/** The mark colour: the Chart's first neutral step for each theme. */
const MARK = "[--mark:var(--chart-5)] dark:[--mark:var(--chart-1)]"

const AXIS_H = 24 // room for the value ticks under the plot
const TOP = 22 // room for marker labels above the plot
const HIST_H = 200
const BOX_ROW = 48
const MAX_DOT_ROW = 132

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

/** A bar with rounded top corners, sitting on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x} ${y + h}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h}Z`
}

const percent = (part: number, whole: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    whole > 0 ? part / whole : 0,
  )

export function DistributionChart({
  title,
  description,
  type = "histogram",
  measure = NO_MEASURE,
  group,
  name: nameKey,
  bins: binCount,
  markers = NO_MARKERS,
  data = NO_ROWS,
  summary,
  status: lifecycle = "ready",
  className,
}: DistributionChartProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const titleId = React.useId()
  const [frameRef, width] = useWidth<HTMLDivElement>(560)
  const [hover, setHover] = React.useState<Hover | null>(null)

  const key = measure.key
  const groupKey = type === "histogram" ? undefined : group?.key

  const items = React.useMemo<Item[]>(() => {
    if (!key) return []
    return data.flatMap((row) => {
      const v = toNumber(row?.[key])
      if (v === null) return []
      return [
        {
          v,
          name: nameKey && row[nameKey] !== undefined ? String(row[nameKey]) : undefined,
          group: groupKey && row[groupKey] !== undefined ? String(row[groupKey]) : undefined,
        },
      ]
    })
  }, [data, key, nameKey, groupKey])

  const { groups, hidden } = React.useMemo(
    () => splitGroups(items, (i) => i.group),
    [items],
  )
  const stats = React.useMemo(
    () => groups.map((g) => summarize(g.items.map((i) => i.v))),
    [groups],
  )
  const overall = React.useMemo(() => summarize(items.map((i) => i.v)), [items])
  const digits = React.useMemo(() => precisionOf(items.map((i) => i.v)), [items])
  const readyMarkers = markers.filter(
    (m): m is DistributionMarker => typeof m.value === "number" && typeof m.label === "string",
  )

  const grouped = Boolean(groupKey) && groups.length > 1
  const bins = React.useMemo(
    () => (type === "histogram" ? makeBins(items.map((i) => i.v), binCount) : null),
    [type, items, binCount],
  )

  // The value axis: covers the data (or the bins) and every marker.
  const domainValues = [
    ...(bins?.counts.length
      ? [bins.start, bins.start + bins.counts.length * bins.width]
      : overall
        ? [overall.min, overall.max]
        : []),
    ...readyMarkers.map((m) => m.value),
  ]
  const lo = domainValues.length ? Math.min(...domainValues) : 0
  const hi = domainValues.length ? Math.max(...domainValues) : 1
  const ticks = niceTicks(lo, hi, width < 420 ? 4 : 6)
  const d0 = bins ? Math.min(lo, ticks[0]) : ticks[0]
  const d1 = Math.max(hi, ticks[ticks.length - 1])

  // Row labels (groups) sit left of the plot; a histogram's count axis does too.
  const labelW = grouped ? Math.min(120, Math.round(width * 0.26)) : type === "histogram" ? 36 : 8
  const padR = 12
  const plotW = Math.max(40, width - labelW - padR)
  const sx = (v: number) => labelW + ((v - d0) / (d1 - d0 || 1)) * plotW

  // Dots: shrink the dots until the tallest stack fits its row.
  const dotLayout = React.useMemo(() => {
    if (type !== "dots") return null
    for (const r of [4.5, 3.5, 2.75, 2]) {
      const pitch = 2 * r + 1.5
      const colW = (pitch / plotW) * (d1 - d0 || 1)
      const rows = groups.map((g) => stackDots(g.items.map((i) => i.v), d0, colW))
      const tallest = Math.max(1, ...rows.map((s) => s.tallest))
      const rowH = Math.max(36, Math.ceil(tallest / 2 + 0.5) * pitch * 2 + 8)
      if (rowH <= MAX_DOT_ROW || r === 2) return { r, pitch, rows, rowH: Math.min(rowH, MAX_DOT_ROW) }
    }
    return null
  }, [type, groups, plotW, d0, d1])

  const rowH = type === "box" ? BOX_ROW : (dotLayout?.rowH ?? 40)
  const plotH = type === "histogram" ? HIST_H : rowH * Math.max(1, groups.length)
  const height = TOP + plotH + AXIS_H
  const baseY = TOP + plotH

  const canDraw = items.length > 0 && Boolean(key)
  const unitTitle =
    measure.unit && measure.format !== "currency" && measure.format !== "percent"
      ? `${measure.label} (${measure.unit})`
      : measure.label

  const show = (e: React.PointerEvent, title: string, rows: [string, string][]) => {
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame) return
    setHover({ x: e.clientX - frame.left, y: e.clientY - frame.top, title, rows })
  }
  const hide = () => setHover(null)
  const fmt = (v: number) => formatMeasure(v, measure, "full", digits, locale)
  const summaryRows = (s: Summary): [string, string][] => [
    ["Median", fmt(s.median)],
    ["Middle half", `${fmt(s.q1)} – ${fmt(s.q3)}`],
    ["Range", `${fmt(s.min)} – ${fmt(s.max)}`],
    ["Count", String(s.n)],
  ]

  // ---- the plot -------------------------------------------------------------

  let plot: React.ReactNode = null
  if (canDraw && bins && type === "histogram") {
    const maxCount = Math.max(1, ...bins.counts)
    const yTicks = niceTicks(0, maxCount, 4).filter((t) => Number.isInteger(t))
    const yMax = yTicks[yTicks.length - 1] || maxCount
    const sy = (c: number) => baseY - (c / yMax) * plotH
    plot = (
      <>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={labelW} x2={labelW + plotW} y1={sy(t)} y2={sy(t)} stroke="var(--border)" />
            <text x={labelW - 8} y={sy(t)} textAnchor="end" dominantBaseline="central" fontSize={12} fill="var(--muted-foreground)">
              {t}
            </text>
          </g>
        ))}
        {bins.counts.map((count, i) => {
          const a = bins.start + i * bins.width
          const b = a + bins.width
          const x = sx(a) + 1
          const w = Math.max(1, sx(b) - sx(a) - 2)
          const label = `${fmt(a)} – ${fmt(b)}`
          return (
            <g
              // biome-ignore lint/suspicious/noArrayIndexKey: bins are positions
              key={i}
              onPointerMove={(e) => show(e, label, [["Count", String(count)], ["Share", percent(count, items.length, locale)]])}
              onPointerLeave={hide}
            >
              <rect x={sx(a)} y={TOP} width={sx(b) - sx(a)} height={plotH} fill="transparent" />
              {count > 0 && (
                <path
                  d={barPath(x, sy(count), w, baseY - sy(count))}
                  fill="var(--mark)"
                  className="transition-opacity group-hover/plot:opacity-60 hover:!opacity-100"
                />
              )}
            </g>
          )
        })}
      </>
    )
  } else if (canDraw && type === "box") {
    plot = groups.map((g, gi) => {
      const s = stats[gi]
      if (!s) return null
      const cy = TOP + gi * rowH + rowH / 2
      const bh = 18
      return (
        <g key={g.name} onPointerMove={(e) => show(e, g.name || measure.label || "Values", summaryRows(s))} onPointerLeave={hide}>
          <rect x={labelW} y={cy - rowH / 2} width={plotW} height={rowH} fill="transparent" />
          <line x1={sx(s.low)} x2={sx(s.q1)} y1={cy} y2={cy} stroke="var(--mark)" strokeWidth={1.5} />
          <line x1={sx(s.q3)} x2={sx(s.high)} y1={cy} y2={cy} stroke="var(--mark)" strokeWidth={1.5} />
          <line x1={sx(s.low)} x2={sx(s.low)} y1={cy - 6} y2={cy + 6} stroke="var(--mark)" strokeWidth={1.5} />
          <line x1={sx(s.high)} x2={sx(s.high)} y1={cy - 6} y2={cy + 6} stroke="var(--mark)" strokeWidth={1.5} />
          <rect
            x={sx(s.q1)}
            y={cy - bh / 2}
            width={Math.max(2, sx(s.q3) - sx(s.q1))}
            height={bh}
            rx={4}
            fill="var(--mark)"
            fillOpacity={0.3}
            stroke="var(--mark)"
            strokeWidth={1.5}
          />
          <line x1={sx(s.median)} x2={sx(s.median)} y1={cy - bh / 2} y2={cy + bh / 2} stroke="var(--foreground)" strokeWidth={2.5} />
          {g.items
            .filter((i) => s.outliers.includes(i.v))
            .map((i, k) => (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: outliers may repeat values
                key={k}
                cx={sx(i.v)}
                cy={cy}
                r={3.5}
                fill="var(--card)"
                stroke="var(--mark)"
                strokeWidth={1.5}
                onPointerMove={(e) => {
                  e.stopPropagation()
                  show(e, i.name ?? "Outlier", [[measure.label ?? "Value", fmt(i.v)]])
                }}
              />
            ))}
        </g>
      )
    })
  } else if (canDraw && type === "dots" && dotLayout) {
    const { r, pitch } = dotLayout
    plot = groups.map((g, gi) => {
      const cy = TOP + gi * rowH + rowH / 2
      const layout = dotLayout.rows[gi]
      return (
        <g key={g.name}>
          {g.items.map((item, k) => {
            const p = layout.positions[k]
            const y = cy - p.offset * pitch
            if (Math.abs(y - cy) > rowH / 2 - r) return null
            return (
              <circle
                // biome-ignore lint/suspicious/noArrayIndexKey: values may repeat
                key={k}
                cx={sx(p.x)}
                cy={y}
                r={r}
                fill="var(--mark)"
                className="hover:fill-foreground"
                onPointerMove={(e) =>
                  show(e, item.name ?? g.name ?? "Value", [
                    [measure.label ?? "Value", fmt(item.v)],
                    ...(item.name && grouped ? ([["Group", g.name]] as [string, string][]) : []),
                  ])
                }
                onPointerLeave={hide}
              />
            )
          })}
        </g>
      )
    })
  }

  const rowLabels = grouped
    ? groups.map((g, gi) => (
        <text
          key={g.name}
          x={0}
          y={TOP + gi * rowH + rowH / 2}
          dominantBaseline="central"
          fontSize={13}
          fill="var(--foreground)"
        >
          {g.name.length > 16 ? `${g.name.slice(0, 15)}…` : g.name}
        </text>
      ))
    : null

  const facts = !grouped && overall

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="distribution-chart"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Distribution"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && <SurfaceDescription>{description}</SurfaceDescription>}
        </SurfaceHeader>

        {facts && (
          <dl
            className={cn(
              "flex flex-wrap gap-x-10 gap-y-3 border-t border-border py-3",
              surfaceInset,
            )}
          >
            {summaryRows(facts).map(([label, value]) => (
              <div key={label} className="flex flex-col gap-0.5">
                <dt className={genuiType.label}>{label}</dt>
                <dd className="text-[14px] font-medium tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        <div className={cn("border-t border-border py-3", surfaceInset)}>
          <div ref={frameRef} className={cn("relative", MARK)}>
            {canDraw ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className="flex flex-col gap-1"
              >
                {type === "histogram" && <span className={genuiType.meta}>Count</span>}
                {/* The SVG is visual only; the tables below carry the numbers. */}
                <svg
                  aria-hidden
                  width={width}
                  height={height}
                  className="group/plot block overflow-visible"
                >
                  {type !== "histogram" &&
                    ticks.map((t) => (
                      <line key={t} x1={sx(t)} x2={sx(t)} y1={TOP} y2={baseY} stroke="var(--border)" />
                    ))}
                  {rowLabels}
                  {plot}
                  <line x1={labelW} x2={labelW + plotW} y1={baseY} y2={baseY} stroke="var(--border)" />
                  {ticks.map((t) => (
                    <text
                      key={t}
                      x={sx(t)}
                      y={baseY + 16}
                      textAnchor="middle"
                      fontSize={12}
                      fill="var(--muted-foreground)"
                    >
                      {formatMeasure(t, measure, "axis", undefined, locale)}
                    </text>
                  ))}
                  {readyMarkers.map((m, i) => (
                    <g key={`${m.label}-${m.value}`}>
                      <line
                        x1={sx(m.value)}
                        x2={sx(m.value)}
                        y1={TOP - 4 - (i % 2) * 0}
                        y2={baseY}
                        stroke="var(--foreground)"
                        strokeWidth={1.5}
                        strokeDasharray="4 3"
                      />
                      <text
                        x={sx(m.value)}
                        y={TOP - 10}
                        textAnchor={sx(m.value) > labelW + plotW * 0.8 ? "end" : sx(m.value) < labelW + plotW * 0.2 ? "start" : "middle"}
                        fontSize={12}
                        fontWeight={500}
                        fill="var(--foreground)"
                        stroke="var(--card)"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {m.label}
                      </text>
                    </g>
                  ))}
                </svg>
                <span className={cn(genuiType.meta, "self-end")}>{unitTitle}</span>
              </motion.div>
            ) : (
              <Skeleton className="h-60 w-full" />
            )}

            {hover && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-10 w-max max-w-[16rem] rounded-lg border bg-popover px-3 py-2 text-[12px] leading-[1.55] text-popover-foreground shadow-lg dark:shadow-none"
                style={{
                  left: Math.min(Math.max(4, hover.x + 12), Math.max(4, width - 200)),
                  top: Math.max(0, hover.y - 64),
                }}
              >
                <div className="pb-1 font-medium">{hover.title}</div>
                <div className="grid gap-0.5">
                  {hover.rows.map(([label, value]) => (
                    <div key={label} className="flex items-baseline gap-3">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="ml-auto font-mono font-medium tabular-nums">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {hidden > 0 && (
            <p className={cn(genuiType.meta, "pt-2")}>
              {hidden} more {hidden === 1 ? "group" : "groups"} not shown.
            </p>
          )}
        </div>

        {canDraw && (
          <div className="sr-only">
            <table>
              <caption>{`${title ?? "Distribution"}: summary`}</caption>
              <thead>
                <tr>
                  {grouped && <th scope="col">{group?.label ?? "Group"}</th>}
                  <th scope="col">Count</th>
                  <th scope="col">Median</th>
                  <th scope="col">Middle half</th>
                  <th scope="col">Range</th>
                  <th scope="col">Outliers</th>
                </tr>
              </thead>
              <tbody>
                {(grouped ? groups.map((g, i) => [g.name, stats[i]] as const) : [["", overall] as const]).map(
                  ([g, s]) =>
                    s && (
                      <tr key={g}>
                        {grouped && <th scope="row">{g}</th>}
                        <td>{s.n}</td>
                        <td>{fmt(s.median)}</td>
                        <td>{`${fmt(s.q1)} to ${fmt(s.q3)}`}</td>
                        <td>{`${fmt(s.min)} to ${fmt(s.max)}`}</td>
                        <td>{s.outliers.length ? s.outliers.map(fmt).join(", ") : "None"}</td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
            {bins && (
              <table>
                <caption>{`${title ?? "Distribution"}: counts per range`}</caption>
                <thead>
                  <tr>
                    <th scope="col">{measure.label ?? "Range"}</th>
                    <th scope="col">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {bins.counts.map((c, i) => {
                    const a = bins.start + i * bins.width
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: bins are positions
                      <tr key={i}>
                        <th scope="row">{`${fmt(a)} to ${fmt(a + bins.width)}`}</th>
                        <td>{c}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {readyMarkers.length > 0 && (
              <ul>
                {readyMarkers.map((m) => (
                  <li key={`${m.label}-${m.value}`}>{`Marked: ${m.label} at ${fmt(m.value)}`}</li>
                ))}
              </ul>
            )}
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
