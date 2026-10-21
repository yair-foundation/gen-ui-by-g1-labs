"use client"

import * as React from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import {
  CartesianGrid,
  ReferenceLine,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
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
import { OTHER_COLOR, SERIES_VARS, seriesColor } from "@/components/genui/series-colors"
import { useGenUILocale } from "@/components/genui/locale"
import { cn } from "@/lib/utils"

import {
  describeCorrelation,
  formatMeasure,
  groupSlots,
  linearFit,
  OTHER,
  toNumber,
} from "./scatter-plot-utils"
import type { ScatterMeasure, ScatterPlotInput } from "./scatter-plot.schema"

export type ScatterPlotProps = Partial<
  Omit<ScatterPlotInput, "x" | "y" | "size" | "group" | "data">
> & {
  /** Fields may be partial while the tool call streams. */
  x?: Partial<ScatterMeasure>
  y?: Partial<ScatterMeasure>
  size?: Partial<ScatterMeasure>
  group?: { key?: string; label?: string }
  /** Points arrive progressively while streaming. */
  data?: Record<string, string | number>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type Point = {
  x: number
  y: number
  z: number | null
  name?: string
  group?: string
  slot: number
  highlighted: boolean
}

// Neutral palette steps picked per theme so the first group always has the
// most contrast against the background (the same steps as the Chart).
const LIGHT = ["--chart-5", "--chart-2", "--chart-1", "--chart-3"]
const DARK = ["--chart-1", "--chart-3", "--chart-2", "--chart-4"]
// Groups also differ by shape, so they never rely on shade alone.
const SHAPES = ["circle", "square", "triangle", "diamond"] as const
type Shape = (typeof SHAPES)[number]

// Shared defaults: a fresh `{}` or `[]` every render would defeat the memos.
const NO_MEASURE: Partial<ScatterMeasure> = {}
const NO_ROWS: Record<string, string | number>[] = []
const NO_NAMES: string[] = []

/** Marker area in px² (Recharts sizes points by area): fixed, or a range for bubbles. */
const DOT_AREA = 90
const BUBBLE_AREA: [number, number] = [60, 1100]

/** An SVG path for a marker of the given shape and radius, centred on (cx, cy). */
function markerPath(shape: Shape, cx: number, cy: number, r: number): string {
  switch (shape) {
    case "square": {
      const s = r * 0.9
      return `M${cx - s} ${cy - s}h${2 * s}v${2 * s}h${-2 * s}Z`
    }
    case "triangle": {
      const s = r * 1.15
      return `M${cx} ${cy - s}L${cx + s * 0.95} ${cy + s * 0.65}H${cx - s * 0.95}Z`
    }
    case "diamond": {
      const s = r * 1.2
      return `M${cx} ${cy - s}L${cx + s} ${cy}L${cx} ${cy + s}L${cx - s} ${cy}Z`
    }
    default:
      return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`
  }
}

/** A small legend glyph in the group's colour and shape. */
function Glyph({ slot, color }: { slot: number; color: string }) {
  return (
    <svg aria-hidden viewBox="0 0 12 12" className="size-3 shrink-0">
      <path d={markerPath(SHAPES[slot], 6, 6, 4.5)} fill={color} />
    </svg>
  )
}

/**
 * One point. The visible marker sits inside a larger transparent target, so
 * small points are easy to hover. Highlighted points carry their name.
 */
function PointShape(props: {
  cx?: number
  cy?: number
  width?: number
  payload?: Point
  fill?: string
  bubble?: boolean
}) {
  const { cx, cy, width = 10, payload, fill, bubble } = props
  if (cx === undefined || cy === undefined || !payload) return null
  const r = Math.max(4, width / 2)
  return (
    <g>
      <circle cx={cx} cy={cy} r={Math.max(r, 10)} fill="transparent" />
      <path
        d={markerPath(SHAPES[payload.slot], cx, cy, r)}
        fill={fill}
        fillOpacity={bubble ? 0.7 : 0.95}
        // A ring in the card colour keeps overlapping points apart.
        stroke="var(--card)"
        strokeWidth={1.5}
      />
      {payload.highlighted && payload.name && (
        <text
          x={cx + r + 6}
          y={cy}
          dominantBaseline="central"
          fontSize={12}
          fontWeight={500}
          fill="var(--foreground)"
          stroke="var(--card)"
          strokeWidth={3}
          paintOrder="stroke"
        >
          {payload.name}
        </text>
      )}
    </g>
  )
}

export function ScatterPlot({
  title,
  description,
  x = NO_MEASURE,
  y = NO_MEASURE,
  size,
  name: nameKey,
  group,
  highlight = NO_NAMES,
  trend = false,
  data = NO_ROWS,
  summary,
  status: lifecycle = "ready",
  className,
}: ScatterPlotProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const reduceMotion = useReducedMotion()
  const titleId = React.useId()

  const xKey = x.key
  const yKey = y.key
  const zKey = size?.key
  const groupKey = group?.key

  const { points, groups } = React.useMemo(() => {
    if (!xKey || !yKey) return { points: [] as Point[], groups: [] as string[] }
    const highlighted = new Set(highlight)
    const raw = data.flatMap((row) => {
      const px = toNumber(row?.[xKey])
      const py = toNumber(row?.[yKey])
      if (px === null || py === null) return []
      const name = nameKey && row[nameKey] !== undefined ? String(row[nameKey]) : undefined
      const g = groupKey && row[groupKey] !== undefined ? String(row[groupKey]) : undefined
      return [{ x: px, y: py, z: zKey ? toNumber(row[zKey]) : null, name, group: g }]
    })
    const slots = groupSlots(raw.flatMap((p) => (p.group === undefined ? [] : [p.group])))
    return {
      groups: groupKey ? slots.groups : [],
      points: raw.map(
        (p): Point => ({
          ...p,
          slot: p.group === undefined ? 0 : slots.slotOf(p.group),
          highlighted: !!p.name && highlighted.has(p.name),
        }),
      ),
    }
  }, [data, xKey, yKey, zKey, nameKey, groupKey, highlight])

  const bubble = Boolean(zKey) && points.some((p) => p.z !== null)
  // Without groups everything is one series in the first slot.
  const slotCount = Math.max(groups.length, 1)

  // The trend line runs across the points' x range.
  const fit = React.useMemo(
    () => (trend && points.length >= 5 ? linearFit(points) : null),
    [trend, points],
  )
  const segment = React.useMemo(() => {
    if (!fit) return null
    const xs = points.map((p) => p.x)
    const lo = Math.min(...xs)
    const hi = Math.max(...xs)
    return [
      { x: lo, y: fit.slope * lo + fit.intercept },
      { x: hi, y: fit.slope * hi + fit.intercept },
    ] as const
  }, [fit, points])

  // Groups get distinct categorical colours ("Other" a neutral grey).
  const groupColor = React.useCallback(
    (slot: number) => (groups[slot] === OTHER ? OTHER_COLOR : seriesColor(slot)),
    [groups],
  )

  const config = React.useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        Array.from({ length: slotCount }, (_, i) => [
          `g${i}`,
          // Groups get distinct categorical colours ("Other" a neutral grey);
          // a single set of points keeps the one-hue tone.
          groups.length > 1
            ? { label: groups[i], color: groups[i] === OTHER ? OTHER_COLOR : seriesColor(i) }
            : {
                label: y.label ?? "Points",
                theme: { light: `var(${LIGHT[0]})`, dark: `var(${DARK[0]})` },
              },
        ]),
      ),
    [slotCount, groups, y.label],
  )

  const canDraw = points.length > 0
  const animate = !streaming && !reduceMotion

  const chartNode = React.useMemo(
    () => (
      // The SVG is visual only; the table below carries the numbers.
      <ChartContainer aria-hidden config={config} className="aspect-auto h-72 w-full">
        <ScatterChart
          accessibilityLayer={false}
          margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid />
          <XAxis
            type="number"
            dataKey="x"
            domain={["auto", "auto"]}
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(v) => formatMeasure(toNumber(v), x, "axis", locale)}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={["auto", "auto"]}
            tickLine={false}
            axisLine={false}
            tickMargin={4}
            width="auto"
            tickFormatter={(v) => formatMeasure(toNumber(v), y, "axis", locale)}
          />
          <ZAxis
            type="number"
            dataKey="z"
            range={bubble ? BUBBLE_AREA : [DOT_AREA, DOT_AREA]}
          />
          <ChartTooltip
            cursor={false}
            isAnimationActive={false}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as Point | undefined
              if (!active || !p) return null
              const rows: [string, string][] = [
                [x.label ?? "x", formatMeasure(p.x, x, "full", locale)],
                [y.label ?? "y", formatMeasure(p.y, y, "full", locale)],
                ...(bubble && size
                  ? ([[size.label ?? "Size", formatMeasure(p.z, size, "full", locale)]] as [
                      string,
                      string,
                    ][])
                  : []),
              ]
              return (
                <div className="w-max max-w-[16rem] rounded-lg border bg-popover px-3 py-2 text-[12px] leading-[1.55] text-popover-foreground shadow-lg dark:shadow-none">
                  {(p.name || p.group) && (
                    <div className="flex items-center gap-2 pb-1">
                      {p.group !== undefined && groups.length > 1 && <Glyph slot={p.slot} color={groupColor(p.slot)} />}
                      <span className="font-medium">{p.name ?? p.group}</span>
                      {p.name && p.group !== undefined && (
                        <span className="text-muted-foreground">{groups[p.slot]}</span>
                      )}
                    </div>
                  )}
                  <div className="grid gap-0.5">
                    {rows.map(([label, value]) => (
                      <div key={label} className="flex items-baseline gap-3">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="ml-auto font-mono font-medium tabular-nums">
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            }}
          />
          {Array.from({ length: slotCount }, (_, slot) => (
            <Scatter
              // biome-ignore lint/suspicious/noArrayIndexKey: slots are fixed positions
              key={slot}
              name={`g${slot}`}
              data={points.filter((p) => p.slot === slot)}
              fill={`var(--color-g${slot})`}
              shape={<PointShape bubble={bubble} />}
              isAnimationActive={animate}
            />
          ))}
          {segment && (
            <ReferenceLine
              segment={segment}
              stroke="var(--muted-foreground)"
              strokeWidth={2}
              strokeDasharray="6 4"
              ifOverflow="hidden"
            />
          )}
        </ScatterChart>
      </ChartContainer>
    ),
    [config, points, slotCount, bubble, size, x, y, groups, groupColor, segment, animate, locale],
  )

  const showLegend = groups.length > 1 || bubble || fit !== null
  // Axis titles carry the unit, since the ticks are compact numbers.
  const axisTitle = (m: Partial<ScatterMeasure>) =>
    m.unit && m.format !== "currency" && m.format !== "percent"
      ? `${m.label} (${m.unit})`
      : m.label

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="scatter-plot"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Scatter plot"}
        className={cn(SERIES_VARS, className)}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && <SurfaceDescription>{description}</SurfaceDescription>}
          {showLegend && (
            <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1 pt-1">
              {groups.length > 1 &&
                groups.map((g, i) => (
                  <li key={g} className={cn("flex items-center gap-1.5", genuiType.meta)}>
                    <Glyph slot={i} color={groupColor(i)} />
                    {g}
                  </li>
                ))}
              {bubble && size?.label && (
                <li className={cn("flex items-center gap-1.5", genuiType.meta)}>
                  <svg aria-hidden viewBox="0 0 18 12" className="h-3 w-[18px] shrink-0">
                    <circle cx="3" cy="8" r="2.5" className="fill-muted-foreground" />
                    <circle cx="12" cy="6" r="5" className="fill-muted-foreground" />
                  </svg>
                  Size: {size.label}
                </li>
              )}
              {fit && (
                <li className={cn("flex items-center gap-1.5", genuiType.meta)}>
                  <svg aria-hidden viewBox="0 0 18 12" className="h-3 w-[18px] shrink-0">
                    <line
                      x1="1"
                      y1="6"
                      x2="17"
                      y2="6"
                      strokeWidth="2"
                      strokeDasharray="4 3"
                      className="stroke-muted-foreground"
                    />
                  </svg>
                  Trend: {describeCorrelation(fit.r).toLowerCase()} (r = {fit.r.toFixed(2)})
                </li>
              )}
            </ul>
          )}
        </SurfaceHeader>

        <div className={cn("border-t border-border py-3", surfaceInset)}>
          {canDraw ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className="flex flex-col gap-1"
            >
              {/* Axis titles in HTML: the y title above its axis, the x title
                  under the end of its axis, so neither is rotated. */}
              <span className={cn(genuiType.meta, "pl-1")}>{axisTitle(y)}</span>
              {chartNode}
              <span className={cn(genuiType.meta, "self-end pr-4")}>{axisTitle(x)}</span>
            </motion.div>
          ) : (
            <Skeleton className="h-72 w-full" />
          )}
        </div>

        {canDraw && (
          <>
            <table className="sr-only">
              <caption>{title ?? "Scatter plot data"}</caption>
              <thead>
                <tr>
                  {nameKey && <th scope="col">Name</th>}
                  {groups.length > 0 && <th scope="col">{group?.label ?? "Group"}</th>}
                  <th scope="col">{x.label}</th>
                  <th scope="col">{y.label}</th>
                  {bubble && <th scope="col">{size?.label}</th>}
                </tr>
              </thead>
              <tbody>
                {points.map((p, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat or be missing
                  <tr key={i}>
                    {nameKey && <th scope="row">{p.name}</th>}
                    {groups.length > 0 && <td>{p.group}</td>}
                    <td>{formatMeasure(p.x, x, "full", locale)}</td>
                    <td>{formatMeasure(p.y, y, "full", locale)}</td>
                    {bubble && <td>{formatMeasure(p.z, size, "full", locale)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
            {fit && (
              <p className="sr-only">
                {`Trend: ${describeCorrelation(fit.r).toLowerCase()} relationship, r = ${fit.r.toFixed(2)}.`}
              </p>
            )}
          </>
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
