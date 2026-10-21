"use client"

import * as React from "react"
import { LogoTile } from "@/components/genui/logo-tile"
import { Segmented } from "@/components/genui/segmented"
import {
  ActivityIcon,
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  BanknoteIcon,
  BarChart3Icon,
  BuildingIcon,
  CalendarIcon,
  ChevronsUpDownIcon,
  ClockIcon,
  CoinsIcon,
  DollarSignIcon,
  GaugeIcon,
  HashIcon,
  type LucideIcon,
  PercentIcon,
  ScaleIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  WalletIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import {
  Bar,
  type BarShapeProps,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import {
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  StockCandle,
  StockQuoteInput,
  StockRangeKey,
  StockSource,
  StockStat,
  StockStatIcon,
} from "./stock-quote.schema"
import {
  type CandleLike,
  type Direction,
  RANGE_LABELS,
  defaultView,
  direction,
  formatAsOf,
  formatMoney,
  formatPercent,
  formatPointLabel,
  formatTick,
  formatVolume,
  highOf,
  isOhlc,
  isPoint,
  lowOf,
  ohlcExtents,
  rangeChange,
  safeUrl,
  sortRanges,
  tickIndices,
  yDomain,
} from "./stock-quote-utils"
import { RollingDigits } from "@/components/genui/genui-motion"
import { useGenUILocale } from "@/components/genui/locale"

export type StockQuoteProps = Partial<
  Omit<StockQuoteInput, "ranges" | "stats" | "source">
> & {
  /** Ranges and candles may be partial while the tool call streams. */
  ranges?: { key?: StockRangeKey; candles?: Partial<StockCandle>[] }[]
  stats?: Partial<StockStat>[]
  source?: Partial<StockSource>
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type View = "candles" | "line"

type Row = CandleLike & {
  i: number
  /** [low, high]: the bar spans the wick; the shape draws the body. */
  span: [number, number]
  up: boolean
}

const MARKET_STATE: Record<
  NonNullable<StockQuoteProps["marketState"]>,
  string
> = {
  open: "Market open",
  closed: "Market closed",
  pre: "Pre-market",
  post: "After hours",
}

// Up/down colors as local tokens. Each passes 4.5:1 for text and 3:1 for
// marks on the card: light #ffffff (green 6.16, red 6.47) and dark #2a2a2a
// (green 8.24, red 5.19).
const COLOR_TOKENS =
  "[--stock-up:var(--up,#15703a)] [--stock-down:var(--down,#b91c1c)] dark:[--stock-up:var(--up,#4ade80)] dark:[--stock-down:var(--down,#f87171)]"

/** A change as a tinted badge: green up arrow, red down arrow, outline when flat. */
function DeltaBadge({ dir, children }: { dir: Direction; children: string }) {
  const Icon =
    dir === "up" ? ArrowUpRightIcon : dir === "down" ? ArrowDownRightIcon : null
  return (
    <Badge
      variant={
        dir === "up" ? "success" : dir === "down" ? "destructive" : "outline"
      }
      className="shrink-0"
    >
      {Icon && <Icon aria-hidden />}
      {children}
      <span className="sr-only">
        {dir === "up"
          ? " increase"
          : dir === "down"
            ? " decrease"
            : " unchanged"}
      </span>
    </Badge>
  )
}

const chartConfig: ChartConfig = { c: { label: "Price" } }

const STAT_ICONS: Record<StockStatIcon, LucideIcon> = {
  "trending-up": TrendingUpIcon,
  "trending-down": TrendingDownIcon,
  "chevrons-up-down": ChevronsUpDownIcon,
  "bar-chart": BarChart3Icon,
  percent: PercentIcon,
  "dollar-sign": DollarSignIcon,
  wallet: WalletIcon,
  coins: CoinsIcon,
  banknote: BanknoteIcon,
  building: BuildingIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  scale: ScaleIcon,
  gauge: GaugeIcon,
  hash: HashIcon,
  activity: ActivityIcon,
}

/** Wick plus body. Up candles are hollow, down candles filled, so color isn't the only cue. */
function Candle(props: BarShapeProps) {
  const { x, y, width, height } = props
  const row = props.payload as Row | undefined
  if (!row || ![x, y, width, height].every(Number.isFinite)) return <g />
  const hi = highOf(row)
  const lo = lowOf(row)
  const yOf = (v: number) =>
    hi === lo ? y : y + ((hi - v) / (hi - lo)) * height
  const open = row.o ?? row.c
  const top = yOf(Math.max(open, row.c))
  const bodyHeight = Math.max(1, yOf(Math.min(open, row.c)) - top)
  const color = row.up ? "var(--stock-up)" : "var(--stock-down)"
  const hollow = row.up && width >= 4
  const cx = x + width / 2
  return (
    <g>
      <line x1={cx} x2={cx} y1={y} y2={y + height} stroke={color} />
      <rect
        x={x + (hollow ? 0.5 : 0)}
        y={top}
        width={Math.max(1, width - (hollow ? 1 : 0))}
        height={bodyHeight}
        fill={hollow ? "var(--surface-bg)" : color}
        stroke={color}
        strokeWidth={hollow ? 1 : 0}
      />
    </g>
  )
}

/** The pill marking the period high (above) or low (below). */
function calloutShape(
  label: string,
  place: "above" | "below",
  align: "start" | "middle" | "end",
) {
  return function Callout({ cx = 0, cy = 0 }: { cx?: number; cy?: number }) {
    const h = 20
    const w = label.length * 7.2 + 14
    const left =
      align === "start" ? cx - 10 : align === "end" ? cx - w + 10 : cx - w / 2
    const top = place === "above" ? cy - h - 6 : cy + 6
    return (
      <g>
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
    )
  }
}

export function StockQuote({
  symbol,
  name,
  exchange,
  logo,
  currency = "USD",
  timezone,
  price,
  change,
  changePercent,
  asOf,
  delayed,
  marketState,
  defaultRange,
  previousClose,
  ranges = [],
  stats = [],
  source,
  status: lifecycle = "ready",
  className,
}: StockQuoteProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const reduceMotion = useReducedMotion()
  const titleId = React.useId()
  const hintId = React.useId()
  const opts = { locale, timeZone: timezone }

  const available = sortRanges(ranges)
  const [rangeChoice, setRangeChoice] = React.useState<StockRangeKey | null>(
    null,
  )
  const [viewChoice, setViewChoice] = React.useState<View | null>(null)
  const [kbIndex, setKbIndex] = React.useState<number | null>(null)

  const has = (k: StockRangeKey | null | undefined) =>
    !!k && available.some((r) => r.key === k)
  const rangeKey: StockRangeKey | undefined = has(rangeChoice)
    ? (rangeChoice as StockRangeKey)
    : has(defaultRange)
      ? defaultRange
      : available[0]?.key
  const active = available.find((r) => r.key === rangeKey)
  const points: CandleLike[] = (active?.candles ?? []).filter(isPoint)

  const canCandles = points.filter(isOhlc).length >= 2
  const view: View =
    viewChoice === "line" || (viewChoice === "candles" && !canCandles)
      ? "line"
      : viewChoice === "candles"
        ? "candles"
        : defaultView(points)

  // In line view the extents come from closes, which is what's drawn.
  const drawn: CandleLike[] =
    view === "line" ? points.map((p) => ({ t: p.t, c: p.c, v: p.v })) : points
  const rows: Row[] = drawn.map((p, i) => ({
    ...p,
    i,
    span: [lowOf(p), highOf(p)],
    up: p.c >= (p.o ?? p.c),
  }))
  const ext = ohlcExtents(drawn)
  const domain = yDomain(drawn, previousClose)
  const ticks = rangeKey ? tickIndices(drawn, rangeKey, timezone) : []
  const canDraw =
    !!rangeKey && (rows.length >= 2 || (!streaming && rows.length === 1))
  const animate = !streaming && !reduceMotion
  const rangeMove = rangeChange(points)
  const rangeDir = direction(rangeMove?.change)

  const dir = direction(change)
  const money = (v: number, o?: { signed?: boolean; compact?: boolean }) =>
    formatMoney(v, currency, { ...o, locale })
  const label = (t: string) =>
    rangeKey ? formatPointLabel(t, rangeKey, opts) : t

  const describe = (r: Row) => {
    const parts =
      view === "candles" && isOhlc(r)
        ? [
            `open ${money(r.o as number)}`,
            `high ${money(r.h as number)}`,
            `low ${money(r.l as number)}`,
            `close ${money(r.c)}`,
          ]
        : [money(r.c)]
    if (typeof r.v === "number") parts.push(`volume ${formatVolume(r.v, locale)}`)
    return `${label(r.t)}: ${parts.join(", ")}`
  }

  const selectRange = (k: StockRangeKey) => {
    setRangeChoice(k)
    setKbIndex(null)
  }
  const selectView = (v: View) => {
    setViewChoice(v)
    setKbIndex(null)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!rows.length) return
    const last = rows.length - 1
    const current = kbIndex ?? last
    let next: number | null = current
    if (e.key === "ArrowLeft") next = Math.max(0, current - 1)
    else if (e.key === "ArrowRight") next = Math.min(last, current + 1)
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = last
    else if (e.key === "Escape") next = null
    else return
    e.preventDefault()
    setKbIndex(next)
  }
  const activeRow = kbIndex !== null ? rows[kbIndex] : undefined
  const highRow = ext ? rows[ext.highIndex] : undefined
  const lowRow = ext ? rows[ext.lowIndex] : undefined
  const align = (i: number) => {
    const f = rows.length > 1 ? i / (rows.length - 1) : 0.5
    return f < 0.15 ? "start" : f > 0.85 ? "end" : "middle"
  }

  const tooltip = (
    <ChartTooltip
      cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
      defaultIndex={kbIndex ?? undefined}
      active={kbIndex !== null ? true : undefined}
      isAnimationActive={false}
      content={({ active: shown, payload }: TooltipContentProps) => {
        const r = payload?.[0]?.payload as Row | undefined
        if (!shown || !r) return null
        const line = (k: string, v: string) => (
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{k}</span>
            <span className="font-mono font-medium tabular-nums text-foreground">
              {v}
            </span>
          </div>
        )
        return (
          <div className="grid min-w-36 gap-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-[13px] shadow-xl dark:shadow-none">
            <div className="font-medium">{label(r.t)}</div>
            {view === "candles" && isOhlc(r) ? (
              <>
                {line("Open", money(r.o as number))}
                {line("High", money(r.h as number))}
                {line("Low", money(r.l as number))}
                {line("Close", money(r.c))}
              </>
            ) : (
              line("Price", money(r.c))
            )}
            {typeof r.v === "number" && line("Volume", formatVolume(r.v, locale))}
            {typeof previousClose === "number" &&
              line("Prev close", money(previousClose))}
          </div>
        )
      }}
    />
  )

  const statRows = stats.filter(
    (s): s is StockStat =>
      typeof s.label === "string" && typeof s.value === "string",
  )
  const sourceUrl = safeUrl(source?.url)
  // One quiet line: market state, time, source, delay.
  const meta: { key: string; node: React.ReactNode }[] = []
  if (marketState)
    meta.push({ key: "state", node: <span>{MARKET_STATE[marketState]}</span> })
  if (asOf)
    meta.push({ key: "asOf", node: <span>{formatAsOf(asOf, opts)}</span> })
  if (source?.label)
    meta.push({
      key: "source",
      node: sourceUrl ? (
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
      ),
    })
  if (delayed) meta.push({ key: "delayed", node: <span>Delayed</span> })

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="stock-quote"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={name ? titleId : undefined}
        aria-label={name ? undefined : "Stock quote"}
        className={cn(COLOR_TOKENS, className)}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <LogoTile src={logo?.url} darkSrc={logo?.darkUrl} tone="muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SurfaceTitle id={titleId} className="truncate">
              {name}
            </SurfaceTitle>
            {symbol ? (
              <p className={cn(genuiType.meta, "truncate")}>
                {exchange ? `${symbol} · ${exchange}` : symbol}
              </p>
            ) : (
              <Skeleton className="h-3 w-24" />
            )}
          </div>
          {available.length > 0 && (
            <Segmented
              label="Chart type"
              value={view}
              onChange={selectView}
              fit
              options={[
                { value: "line", label: "Line" },
                {
                  value: "candles",
                  label: "Candles",
                  disabled: !canCandles,
                  disabledReason: "No candle data for this range",
                },
              ]}
            />
          )}
        </SurfaceHeader>

        <div className="flex flex-col">
          {(typeof price === "number" || streaming) && (
            <div className="border-t border-border px-3 py-3">
              {typeof price === "number" ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex flex-nowrap items-baseline gap-x-3"
                >
                  <span className={cn(genuiType.display, "shrink-0")}>
                    <span className="sr-only">{money(price)}</span>
                    <RollingDigits text={money(price)} />
                  </span>
                  {typeof change === "number" &&
                    typeof changePercent === "number" && (
                      <span
                        className={cn(
                          genuiType.body,
                          "inline-flex min-w-0 flex-nowrap items-center gap-2 tabular-nums",
                        )}
                      >
                        <DeltaBadge dir={dir}>
                          {`${money(Math.abs(change))} (${formatPercent(Math.abs(changePercent), { signed: false, locale })})`}
                        </DeltaBadge>
                        <span className="min-w-0 truncate text-muted-foreground">
                          today
                        </span>
                      </span>
                    )}
                </motion.div>
              ) : (
                streaming && <Skeleton className="h-10 w-48" />
              )}
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
            {available.length > 0 && (
              <div className="flex flex-col gap-3">
                {available.length > 1 ? (
                  <Segmented
                    label="Chart range"
                    value={rangeKey as StockRangeKey}
                    onChange={selectRange}
                    options={available.map((r) => ({
                      value: r.key,
                      label: r.key,
                    }))}
                  />
                ) : (
                  <span className={genuiType.label}>{rangeKey}</span>
                )}
                {rangeKey && rangeMove && !streaming && (
                  <p className="flex items-center gap-2">
                    <span className="sr-only">{`${RANGE_LABELS[rangeKey]}: `}</span>
                    <DeltaBadge dir={rangeDir}>
                      {formatPercent(Math.abs(rangeMove.percent), {
                        signed: false,
                        locale,
                      })}
                    </DeltaBadge>
                    <span className="sr-only">{`(${money(rangeMove.change, { signed: true })})`}</span>
                  </p>
                )}
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
                  aria-label={`${symbol ?? "Price"} chart, ${RANGE_LABELS[rangeKey as StockRangeKey].toLowerCase()}`}
                  aria-describedby={hintId}
                  onKeyDown={onKeyDown}
                  onFocus={(e) => {
                    if (
                      e.currentTarget.matches(":focus-visible") &&
                      kbIndex === null
                    )
                      setKbIndex(rows.length - 1)
                  }}
                  onBlur={() => setKbIndex(null)}
                  className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {/* The SVG is visual only; the table below carries the numbers. */}
                  <ChartContainer
                    aria-hidden
                    config={chartConfig}
                    className="aspect-auto h-60 w-full"
                  >
                    <ComposedChart
                      data={rows}
                      accessibilityLayer={false}
                      barCategoryGap="25%"
                      margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="i"
                        ticks={ticks}
                        interval="preserveStart"
                        minTickGap={16}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        tickFormatter={(i: number) =>
                          rows[i] && rangeKey
                            ? formatTick(rows[i].t, rangeKey, opts)
                            : ""
                        }
                      />
                      <YAxis
                        orientation="right"
                        domain={domain}
                        tickCount={4}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={4}
                        width="auto"
                        tickFormatter={(v: number) =>
                          money(v, { compact: true })
                        }
                      />
                      {typeof previousClose === "number" && (
                        <ReferenceLine
                          y={previousClose}
                          stroke="var(--muted-foreground)"
                          strokeDasharray="4 4"
                        />
                      )}
                      {tooltip}
                      {view === "candles" ? (
                        <Bar
                          dataKey="span"
                          shape={Candle}
                          isAnimationActive={animate}
                        />
                      ) : (
                        <Line
                          dataKey="c"
                          type="linear"
                          stroke="var(--foreground)"
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3, fill: "var(--foreground)" }}
                          isAnimationActive={animate}
                        />
                      )}
                      {!streaming && highRow && ext && (
                        <ReferenceDot
                          x={highRow.i}
                          y={ext.max}
                          r={0}
                          shape={calloutShape(
                            money(ext.max),
                            "above",
                            align(highRow.i),
                          )}
                        />
                      )}
                      {!streaming && lowRow && ext && ext.min !== ext.max && (
                        <ReferenceDot
                          x={lowRow.i}
                          y={ext.min}
                          r={0}
                          shape={calloutShape(
                            money(ext.min),
                            "below",
                            align(lowRow.i),
                          )}
                        />
                      )}
                    </ComposedChart>
                  </ChartContainer>
                </figure>
                <p
                  id={hintId}
                  className={cn(
                    genuiType.meta,
                    "mt-1 flex items-center gap-1.5",
                  )}
                >
                  {typeof previousClose === "number" && (
                    <span className="inline-flex items-center gap-1.5">
                      <svg
                        aria-hidden
                        width="16"
                        height="2"
                        className="shrink-0"
                      >
                        <line
                          x1="0"
                          x2="16"
                          y1="1"
                          y2="1"
                          stroke="currentColor"
                          strokeDasharray="4 3"
                        />
                      </svg>
                      {`Prev close ${money(previousClose)}`}
                    </span>
                  )}
                  {ext && highRow && lowRow && (
                    <span className="sr-only">
                      {`Period high ${money(ext.max)} on ${label(highRow.t)}. Period low ${money(ext.min)} on ${label(lowRow.t)}.`}
                    </span>
                  )}
                  <span className="sr-only">
                    Use the left and right arrow keys to move between points.
                  </span>
                </p>
              </motion.div>
            ) : (
              (streaming || available.length > 0) && (
                <Skeleton className="h-60 w-full rounded-lg" />
              )
            )}

            <div aria-live="polite" className="sr-only">
              {activeRow ? describe(activeRow) : ""}
            </div>

            {canDraw && rangeKey && (
              <table className="sr-only">
                <caption>{`${symbol ?? "Price"} prices, ${RANGE_LABELS[rangeKey].toLowerCase()}`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    {view === "candles" ? (
                      <>
                        <th scope="col">Open</th>
                        <th scope="col">High</th>
                        <th scope="col">Low</th>
                        <th scope="col">Close</th>
                      </>
                    ) : (
                      <th scope="col">Price</th>
                    )}
                    <th scope="col">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.i}>
                      <th scope="row">{label(r.t)}</th>
                      {view === "candles" ? (
                        <>
                          <td>{money(r.o ?? r.c)}</td>
                          <td>{money(highOf(r))}</td>
                          <td>{money(lowOf(r))}</td>
                          <td>{money(r.c)}</td>
                        </>
                      ) : (
                        <td>{money(r.c)}</td>
                      )}
                      <td>
                        {typeof r.v === "number" ? formatVolume(r.v, locale) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {(statRows.length > 0 || (streaming && available.length > 0)) && (
            <dl className="grid grid-cols-2 gap-x-10 gap-y-3 border-t border-border px-3 py-3 sm:grid-cols-4">
              {statRows.map((s) => (
                <motion.div
                  key={s.label}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex min-w-0 flex-col gap-1"
                >
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    {s.icon && STAT_ICONS[s.icon] && <StatIcon name={s.icon} />}
                    {s.label}
                  </dt>
                  <dd
                    className={cn(genuiType.body, "font-medium tabular-nums")}
                  >
                    {s.value}
                  </dd>
                </motion.div>
              ))}
              {streaming && statRows.length === 0 && (
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-3 w-12" />
                  <Skeleton className="h-4 w-20" />
                </div>
              )}
            </dl>
          )}

          {(asOf || source?.label) && (
            <p
              className={cn(
                genuiType.meta,
                "flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-border px-3 py-3",
              )}
            >
              {meta.map((part, i) => (
                <React.Fragment key={part.key}>
                  {i > 0 && <span aria-hidden>·</span>}
                  {part.node}
                </React.Fragment>
              ))}
              <span className="basis-full sm:ml-auto sm:basis-auto">
                Not investment advice.
              </span>
            </p>
          )}
        </div>
      </Surface>
    </MotionConfig>
  )
}

function StatIcon({ name }: { name: StockStatIcon }) {
  const Icon = STAT_ICONS[name]
  return <Icon aria-hidden className="size-3.5 shrink-0" />
}
