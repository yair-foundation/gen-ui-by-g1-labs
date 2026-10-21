"use client"

import * as React from "react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  surfaceInset,
  genuiMotion,
} from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"
import { cn } from "@/lib/utils"
import { SERIES_BG, SERIES_VARS, seriesColor } from "@/components/genui/series-colors"

import type {
  ChartAnnotation,
  ChartAxis,
  ChartInput,
  ChartSeries,
} from "./chart.schema"

export type ChartProps = Partial<
  Omit<ChartInput, "x" | "series" | "data" | "annotations">
> & {
  /** Fields may be partial while the tool call streams. */
  x?: Partial<ChartAxis>
  series?: Partial<ChartSeries>[]
  /** Points arrive progressively while streaming. */
  data?: Record<string, string | number>[]
  annotations?: Partial<ChartAnnotation>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type ReadySeries = ChartSeries & { slot: string }
type Row = Record<string, string | number | null>

// Neutral palette steps picked per theme so the first series always has the
// most contrast against the background. Series keep their slot by position.
const LIGHT = ["--chart-5", "--chart-2", "--chart-1", "--chart-3"]
const DARK = ["--chart-1", "--chart-3", "--chart-2", "--chart-4"]
// Line dashes, so series are distinguishable without color.
const DASHES = [undefined, "6 3", "2 3", "8 3 2 3"]

const X_KEY = "__x"

// Defaults as shared constants: a fresh `[]` or `{}` on every render would
// change identity each time and defeat the memoized chart.
const NO_AXIS: Partial<ChartAxis> = {}
const NO_SERIES: Partial<ChartSeries>[] = []
const NO_ROWS: Record<string, string | number>[] = []
const NO_ANNOTATIONS: Partial<ChartAnnotation>[] = []

/** Vertical gap between the pieces of a stacked bar, in px. */
const STACK_GAP = 3

/** Parses ISO dates; date-only strings are read as local dates, not UTC. */
export function parseDate(value: string | number): Date | null {
  if (typeof value === "number") return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number)
    const date = new Date(y, m - 1, d)
    // Rejects rollovers such as 2026-02-31.
    return date.getMonth() === m - 1 && date.getDate() === d ? date : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatX(
  value: string | number | null | undefined,
  axis: Partial<ChartAxis>,
  style: "short" | "long",
  locale: string,
): string {
  if (value === null || value === undefined) return ""
  if (axis.format === "date") {
    const date = parseDate(value)
    if (date) {
      return new Intl.DateTimeFormat(
        locale,
        style === "short"
          ? { month: "short", day: "numeric" }
          : { month: "short", day: "numeric", year: "numeric" },
      ).format(date)
    }
  }
  return typeof value === "number"
    ? new Intl.NumberFormat(locale).format(value)
    : value
}

export function formatValue(
  value: number | null | undefined,
  series: Pick<ChartSeries, "format" | "currency"> | undefined,
  style: "axis" | "full",
  locale: string,
): string {
  if (value === null || value === undefined) return "No data"
  const compact: Intl.NumberFormatOptions =
    style === "axis" ? { notation: "compact", maximumFractionDigits: 1 } : {}
  if (series?.format === "currency" && series.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: series.currency,
        ...(style === "full" && Number.isInteger(value)
          ? { maximumFractionDigits: 0 }
          : {}),
        ...compact,
      }).format(value)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  if (series?.format === "percent") {
    return new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: style === "axis" ? 0 : 1,
    }).format(value / 100)
  }
  return new Intl.NumberFormat(locale, compact).format(value)
}

/** Numbers, or numeric strings, become numbers; anything else is a gap. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

type Rect = { x: number; y: number; width: number; height: number }
type Hover = { index: number; slot?: string }

/**
 * What a bar piece needs from the chart. Deliberately holds no hover state:
 * it stays the same object while the pointer moves, so hovering never
 * re-renders the (heavy) chart. The fade is done in CSS from the frame's
 * `data-hover` attribute instead.
 */
type PieceContext = {
  stacked: boolean
  onEnter: (index: number, slot: string) => void
  onLeave: () => void
  geometry: React.MutableRefObject<Map<string, Rect>>
  /** The slots at the bottom and top of each stack, which sit flush at the ends. */
  ends: { bottom: string | null; top: string | null }[]
}

/**
 * Shared through context rather than props: Recharts keeps a bar shape's props
 * in its own store, which freezes (and can't clone a Map inside) whatever it holds.
 */
const PieceContext = React.createContext<PieceContext | null>(null)

/**
 * One bar, or one piece of a stacked bar. Drawn by hand so the chart knows
 * where every piece sits (that is where the hover card is anchored) and so a
 * piece can be tagged with its series for the CSS fade.
 */
function BarPiece(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  fill?: string
  index?: number
  dataKey?: string
}) {
  const ctx = React.useContext(PieceContext)
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    fill,
    index = 0,
    dataKey,
  } = props
  if (!ctx || !dataKey || !(width > 0) || !(height > 0)) return null
  ctx.geometry.current.set(`${index}:${dataKey}`, { x, y, width, height })

  const { stacked } = ctx
  // Stacked pieces are rounded on every corner, plain bars only on top.
  // Between pieces there is a gap (the pieces shrink toward each other, but
  // stay flush at the bottom and top of the stack); the pointer area below
  // stays whole, so moving across the gap doesn't drop the highlight.
  const end = ctx.ends[index]
  const gap = Math.min(STACK_GAP / 2, height / 4)
  const inTop = stacked && end?.top !== dataKey ? gap : 0
  const inBottom = stacked && end?.bottom !== dataKey ? gap : 0
  const py = y + inTop
  const ph = Math.max(1, height - inTop - inBottom)
  const r = Math.min(4, width / 2, stacked ? ph / 2 : ph)
  const bb = stacked ? r : 0
  const d = `M${x + r} ${py}H${x + width - r}Q${x + width} ${py} ${x + width} ${py + r}V${py + ph - bb}${bb ? `Q${x + width} ${py + ph} ${x + width - bb} ${py + ph}H${x + bb}Q${x} ${py + ph} ${x} ${py + ph - bb}` : `V${py + ph}H${x}`}V${py + r}Q${x} ${py} ${x + r} ${py}Z`

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only drives the visual highlight; the chart is aria-hidden and its data is in the table beside it
    <g
      data-series={dataKey}
      onMouseEnter={stacked ? () => ctx.onEnter(index, dataKey) : undefined}
      onMouseLeave={stacked ? ctx.onLeave : undefined}
    >
      {stacked && (
        <rect x={x} y={y} width={width} height={height} fill="transparent" />
      )}
      <path d={d} fill={fill} />
    </g>
  )
}

/**
 * Hovering a piece lights up its series in every bar and fades the rest.
 * Plain classes keyed on the frame's data-hover, so the highlight needs no
 * React render. One line per series slot (the chart takes at most four).
 */
const FADE_OTHERS =
  "[&_[data-series]]:transition-opacity [&_[data-series]]:duration-100 data-[hover=s0]:[&_[data-series]:not([data-series=s0])]:opacity-[0.22] data-[hover=s1]:[&_[data-series]:not([data-series=s1])]:opacity-[0.22] data-[hover=s2]:[&_[data-series]:not([data-series=s2])]:opacity-[0.22] data-[hover=s3]:[&_[data-series]:not([data-series=s3])]:opacity-[0.22]"

export function Chart({
  title,
  description,
  type = "line",
  stacked: stackedProp = false,
  x = NO_AXIS,
  series = NO_SERIES,
  data = NO_ROWS,
  annotations = NO_ANNOTATIONS,
  summary,
  status: lifecycle = "ready",
  className,
}: ChartProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const reduceMotion = useReducedMotion()
  const titleId = React.useId()

  const readySeries = React.useMemo<ReadySeries[]>(
    () =>
      series
        .filter(
          (s): s is ChartSeries =>
            typeof s.key === "string" && typeof s.label === "string",
        )
        .slice(0, 4)
        .map((s, i) => ({ ...s, slot: `s${i}` })),
    [series],
  )

  const xKey = x.key
  // Rows re-keyed to slots, so arbitrary series keys never reach CSS names.
  const rows = React.useMemo<Row[]>(
    () =>
      xKey
        ? data
            .filter((d) => d && d[xKey] !== undefined)
            .map((d) => {
              const row: Row = { [X_KEY]: d[xKey] }
              for (const s of readySeries) row[s.slot] = toNumber(d[s.key])
              return row
            })
        : [],
    [data, xKey, readySeries],
  )

  // Two or more series get distinct categorical colours (identity also by
  // legend and, on lines, dashes); a single series keeps the one-hue tone.
  const multi = readySeries.length > 1
  const config = React.useMemo<ChartConfig>(
    () =>
      Object.fromEntries(
        readySeries.map((s, i) => [
          s.slot,
          readySeries.length > 1
            ? { label: s.label, color: seriesColor(i) }
            : {
                label: s.label,
                theme: { light: `var(${LIGHT[i]})`, dark: `var(${DARK[i]})` },
              },
        ]),
      ),
    [readySeries],
  )

  const visibleMarks = React.useMemo(() => {
    const xValues = new Set(rows.map((r) => r[X_KEY]))
    return annotations
      .filter(
        (a): a is ChartAnnotation =>
          a.x !== undefined && typeof a.label === "string" && !!a.label,
      )
      .filter((a) => xValues.has(a.x))
  }, [annotations, rows])

  const canDraw = readySeries.length > 0 && rows.length > 0
  const animate = !streaming && !reduceMotion

  // Bars: which bar (or stacked piece) the pointer is on, and where each was
  // drawn. The hover card anchors above the bar, so it stays put while the
  // pointer moves inside it instead of following the cursor.
  const stacked = type === "bar" && stackedProp && readySeries.length > 1
  const [hover, setHover] = React.useState<Hover | null>(null)
  const geometry = React.useRef(new Map<string, Rect>())
  const frameRef = React.useRef<HTMLDivElement>(null)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const clearTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(
    null,
  )
  React.useEffect(() => () => clearTimeout(clearTimer.current), [])

  // Setting the same hover again does nothing (and so renders nothing), so
  // moving the pointer inside one piece or bar group costs no render.
  const onEnter = React.useCallback((index: number, slot: string) => {
    clearTimeout(clearTimer.current)
    setHover((prev) =>
      prev?.index === index && prev.slot === slot ? prev : { index, slot },
    )
  }, [])
  // Side-by-side bars: the whole group is the hover target.
  const onGroup = React.useCallback((index: number | null) => {
    setHover((prev) =>
      index === null
        ? prev === null
          ? prev
          : null
        : prev?.index === index && prev.slot === undefined
          ? prev
          : { index },
    )
  }, [])
  // Moving between adjacent pieces leaves one and enters the next in the same
  // moment; clearing a beat late keeps the others from flashing back.
  const onLeave = React.useCallback(() => {
    clearTimeout(clearTimer.current)
    clearTimer.current = setTimeout(() => setHover(null), 40)
  }, [])

  const ends = React.useMemo(
    () =>
      rows.map((r) => {
        const present = readySeries.filter(
          (s) => (toNumber(r[s.slot]) ?? 0) > 0,
        )
        return {
          bottom: present[0]?.slot ?? null,
          top: present[present.length - 1]?.slot ?? null,
        }
      }),
    [rows, readySeries],
  )
  const pieceContext = React.useMemo<PieceContext>(
    () => ({ stacked, onEnter, onLeave, geometry, ends }),
    [stacked, onEnter, onLeave, ends],
  )

  // Where the card goes: above the hovered bar (the stack, or the bar group),
  // centred on it.
  const hoveredRow = hover ? rows[hover.index] : undefined
  const anchor = (() => {
    if (!hover || !hoveredRow || type !== "bar") return null
    const rects = readySeries
      .map((s) => geometry.current.get(`${hover.index}:${s.slot}`))
      .filter((r): r is Rect => !!r)
    if (rects.length === 0) return null
    const top = Math.min(...rects.map((r) => r.y))
    const left = Math.min(...rects.map((r) => r.x))
    const right = Math.max(...rects.map((r) => r.x + r.width))
    return { top, centre: (left + right) / 2 }
  })()

  const hoverKey = hover ? `${hover.index}:${hover.slot ?? ""}` : ""
  // Measure the card, then place it above the bar, centred on it. A tall bar
  // leaves little room inside the chart, so the card may rise over the
  // heading above (only while hovering); it never goes past the card's edge.
  // Sideways it stays inside the chart. Runs before paint, so it never flashes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: anchor derives from hoverKey and the drawn geometry
  React.useLayoutEffect(() => {
    const card = cardRef.current
    const frame = frameRef.current
    if (!card || !frame || !anchor) return
    const w = card.offsetWidth
    const h = card.offsetHeight
    const W = frame.clientWidth
    const surface = frame.closest("section")
    const room = surface
      ? frame.getBoundingClientRect().top - surface.getBoundingClientRect().top
      : 0
    const clamp = (n: number, lo: number, hi: number) =>
      Math.min(Math.max(n, lo), Math.max(lo, hi))
    const left = clamp(anchor.centre - w / 2, 4, W - w - 4)
    const top = Math.max(anchor.top - 8 - h, 4 - room)
    setPos((prev) =>
      prev?.left === left && prev?.top === top ? prev : { left, top },
    )
  }, [hoverKey, anchor?.top, anchor?.centre])

  // The chart is built once per data change, not per hover: hover state lives
  // outside it (the card and the CSS fade), so the pointer never re-renders
  // the chart.
  const first = readySeries[0]
  const chartNode = React.useMemo(() => {
    const grid = <CartesianGrid vertical={false} />
    const xAxis = (
      <XAxis
        dataKey={X_KEY}
        tickLine={false}
        axisLine={false}
        tickMargin={8}
        minTickGap={24}
        tickFormatter={(v) => formatX(v, x, "short", locale)}
      />
    )
    const yAxis = (
      <YAxis
        tickLine={false}
        axisLine={false}
        tickMargin={4}
        width="auto"
        tickFormatter={(v) => formatValue(toNumber(v), first, "axis", locale)}
      />
    )
    // Bars use the anchored card below. Lines and areas keep the chart tooltip,
    // pinned to one height and without its sliding animation, so it doesn't
    // chase the pointer.
    const tooltip =
      type === "bar" ? (
        stacked ? null : (
          <ChartTooltip
            cursor={{ fill: "var(--muted)", fillOpacity: 0.5 }}
            content={() => null}
          />
        )
      ) : (
        <ChartTooltip
          position={{ y: 0 }}
          isAnimationActive={false}
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) =>
                formatX(
                  (payload?.[0]?.payload as Row | undefined)?.[X_KEY],
                  x,
                  "long",
                  locale,
                )
              }
              formatter={(value, _name, item) => {
                const s = readySeries.find((r) => r.slot === item.dataKey)
                return (
                  <div className="flex w-full items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-muted-foreground">{s?.label}</span>
                    <span className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">
                      {formatValue(toNumber(value), s, "full", locale)}
                    </span>
                  </div>
                )
              }}
            />
          }
        />
      )
    const legend = null
    const references = visibleMarks.map((a) => (
      <ReferenceLine
        key={`${a.x}-${a.label}`}
        x={a.x}
        stroke="var(--muted-foreground)"
        strokeDasharray="3 3"
        label={{
          value: a.label,
          position: "insideTopLeft",
          fill: "var(--muted-foreground)",
          fontSize: 12,
        }}
      />
    ))

    const common = {
      data: rows,
      accessibilityLayer: false,
      margin: { top: 16, right: 8, bottom: 0, left: 0 },
    }

    const chart =
      type === "bar" ? (
        <BarChart
          {...common}
          barGap={2}
          onMouseMove={
            stacked
              ? undefined
              : (state) => {
                  const i = Number(state?.activeTooltipIndex)
                  onGroup(Number.isInteger(i) && i >= 0 ? i : null)
                }
          }
          onMouseLeave={stacked ? undefined : () => onGroup(null)}
        >
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {readySeries.map((s) => (
            <Bar
              key={s.slot}
              dataKey={s.slot}
              name={s.slot}
              fill={`var(--color-${s.slot})`}
              stackId={stacked ? "stack" : undefined}
              shape={<BarPiece />}
              isAnimationActive={animate}
            />
          ))}
          {references}
        </BarChart>
      ) : type === "area" ? (
        <AreaChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {readySeries.map((s) => (
            <Area
              key={s.slot}
              dataKey={s.slot}
              name={s.slot}
              type="monotone"
              stroke={`var(--color-${s.slot})`}
              strokeWidth={2}
              fill={`var(--color-${s.slot})`}
              fillOpacity={0.15}
              isAnimationActive={animate}
            />
          ))}
          {references}
        </AreaChart>
      ) : (
        <LineChart {...common}>
          {grid}
          {xAxis}
          {yAxis}
          {tooltip}
          {legend}
          {readySeries.map((s, i) => (
            <Line
              key={s.slot}
              dataKey={s.slot}
              name={s.slot}
              type="monotone"
              stroke={`var(--color-${s.slot})`}
              strokeWidth={2}
              strokeDasharray={DASHES[i]}
              dot={false}
              activeDot={{ r: 4 }}
              isAnimationActive={animate}
            />
          ))}
          {references}
        </LineChart>
      )

    return (
      <PieceContext.Provider value={pieceContext}>
        {/* The SVG is visual only; the table below carries the numbers. */}
        <ChartContainer
          aria-hidden
          config={config}
          className="aspect-auto h-60 w-full"
        >
          {chart}
        </ChartContainer>
      </PieceContext.Provider>
    )
  }, [
    type,
    stacked,
    rows,
    readySeries,
    first,
    x,
    visibleMarks,
    animate,
    config,
    pieceContext,
    onGroup,
    locale,
  ])

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="chart"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Chart"}
        className={cn(multi && SERIES_VARS, className)}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && (
            <SurfaceDescription>{description}</SurfaceDescription>
          )}
          {readySeries.length > 1 && (
            <ul aria-hidden className="flex flex-wrap gap-x-3 gap-y-1 pt-1">
              {readySeries.map((s, i) => (
                <li
                  key={s.slot}
                  className={cn("flex items-center gap-1.5", genuiType.meta)}
                >
                  <span className={cn("size-2.5 rounded-[3px]", SERIES_BG[i])} />
                  {s.label}
                </li>
              ))}
            </ul>
          )}
        </SurfaceHeader>

        <div className={cn("border-t border-border py-3", surfaceInset)}>
          {canDraw ? (
            <motion.div
              ref={frameRef}
              data-hover={stacked && hover?.slot ? hover.slot : undefined}
              className={cn("relative", FADE_OTHERS)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
            >
              {chartNode}
              {anchor && hoveredRow && (
                <motion.div
                  ref={cardRef}
                  aria-hidden
                  initial={{ opacity: 0 }}
                  animate={{ opacity: pos ? 1 : 0 }}
                  transition={{ duration: 0.12 }}
                  className="pointer-events-none absolute z-10 w-max max-w-[16rem] rounded-lg border bg-popover px-3 py-2 text-popover-foreground shadow-lg dark:shadow-none"
                  style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}
                >
                  <div className="text-[12px] leading-[1.55] tracking-[0.01em]">
                    {hover?.slot ? (
                      (() => {
                        const piece = readySeries.find(
                          (s) => s.slot === hover.slot,
                        )
                        const value = toNumber(hoveredRow[hover.slot])
                        const total = readySeries.reduce(
                          (sum, s) => sum + (toNumber(hoveredRow[s.slot]) ?? 0),
                          0,
                        )
                        return (
                          <>
                            <div className="flex items-baseline justify-between gap-4">
                              <span className="font-medium">
                                {formatX(hoveredRow[X_KEY], x, "long", locale)}
                              </span>
                              <span className="text-muted-foreground tabular-nums">
                                {formatValue(total, first, "full", locale)}{" "}
                                total
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                aria-hidden
                                className="size-2.5 shrink-0 rounded-[2px]"
                                style={{
                                  backgroundColor: `var(--color-${hover.slot})`,
                                }}
                              />
                              <span className="text-muted-foreground">
                                {piece?.label}
                              </span>
                              <span className="ml-auto pl-3 font-mono font-medium tabular-nums">
                                {formatValue(value, piece, "full", locale)}
                              </span>
                              {value !== null && total > 0 && (
                                <span className="w-9 text-right text-muted-foreground tabular-nums">
                                  {new Intl.NumberFormat(locale, {
                                    style: "percent",
                                    maximumFractionDigits: 0,
                                  }).format(value / total)}
                                </span>
                              )}
                            </div>
                          </>
                        )
                      })()
                    ) : (
                      <>
                        <div className="font-medium">
                          {formatX(hoveredRow[X_KEY], x, "long", locale)}
                        </div>
                        <div className="mt-1 grid gap-1">
                          {readySeries.map((s) => (
                            <div
                              key={s.slot}
                              className="flex items-center gap-2"
                            >
                              <span
                                aria-hidden
                                className="size-2.5 shrink-0 rounded-[2px]"
                                style={{
                                  backgroundColor: `var(--color-${s.slot})`,
                                }}
                              />
                              <span className="text-muted-foreground">
                                {s.label}
                              </span>
                              <span className="ml-auto pl-3 font-mono font-medium tabular-nums">
                                {formatValue(
                                  toNumber(hoveredRow[s.slot]),
                                  s,
                                  "full",
                                  locale,
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </motion.div>
              )}
            </motion.div>
          ) : (
            <Skeleton className="h-60 w-full" />
          )}
        </div>

        {canDraw && (
          <table className="sr-only">
            <caption>{title ?? "Chart data"}</caption>
            <thead>
              <tr>
                <th scope="col">{x.label ?? x.key}</th>
                {readySeries.map((s) => (
                  <th key={s.slot} scope="col">
                    {s.label}
                  </th>
                ))}
                {stacked && <th scope="col">Total</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: x values may repeat
                <tr key={i}>
                  <th scope="row">{formatX(r[X_KEY], x, "long", locale)}</th>
                  {readySeries.map((s) => (
                    <td key={s.slot}>
                      {formatValue(
                        r[s.slot] as number | null,
                        s,
                        "full",
                        locale,
                      )}
                    </td>
                  ))}
                  {stacked && (
                    <td>
                      {formatValue(
                        readySeries.reduce(
                          (sum, s) => sum + (toNumber(r[s.slot]) ?? 0),
                          0,
                        ),
                        first,
                        "full",
                        locale,
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {visibleMarks.length > 0 && (
          <ul className="sr-only">
            {visibleMarks.map((a) => (
              <li key={`${a.x}-${a.label}`}>
                {`Marked: ${a.label} at ${formatX(a.x, x, "long", locale)}`}
              </li>
            ))}
          </ul>
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
