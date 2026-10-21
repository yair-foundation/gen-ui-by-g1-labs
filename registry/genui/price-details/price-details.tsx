"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  ArrowDownIcon,
  ArrowDownRightIcon,
  CheckIcon,
  MinusIcon,
  ThumbsUpIcon,
  TrendingUpIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  type TooltipContentProps,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { Segmented } from "@/components/genui/segmented"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import {
  FormField,
  formExampleClass,
  formInputClass,
} from "@/components/genui/form-field"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  type DatedPoint,
  type HistoryRange,
  type PriceAction,
  RANGE_DAYS,
  cleanHistory,
  currencyDigits,
  describeMismatch,
  formatAsOf,
  formatDay,
  formatMoney,
  formatUnitPrice,
  historyExtents,
  historySpanDays,
  historySummary,
  isDeduction,
  pointsInRange,
  rangeOptions,
  rankOffers,
  reconcileBreakdown,
  resolveActions,
  safeImageSrc,
  safeUrl,
  savings,
  validateWatchTarget,
} from "./price-details-utils"
import type {
  BreakdownRow,
  HistoryPoint,
  PriceDetailsInput,
  PriceDetailsResult,
  PriceOffer,
} from "./price-details.schema"

export type PriceDetailsStatus = "streaming" | "ready" | "submitting" | "done"

type Verdict = NonNullable<PriceDetailsInput["deal"]>["verdict"]
type Condition = NonNullable<PriceOffer["condition"]>

export type PriceDetailsProps = Partial<
  Omit<
    PriceDetailsInput,
    | "item"
    | "price"
    | "deal"
    | "breakdown"
    | "history"
    | "offers"
    | "source"
    | "actions"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  item?: {
    name?: string
    variant?: string
    image?: { src?: string; alt?: string }
    url?: string
  }
  price?: {
    current?: number
    was?: number
    unit?: { amount?: number; per?: string }
    memberPrice?: { amount?: number; label?: string }
  }
  deal?: { verdict?: Verdict; reason?: string }
  breakdown?: Partial<BreakdownRow>[]
  history?: Partial<HistoryPoint>[]
  offers?: Partial<PriceOffer>[]
  source?: { label?: string; url?: string }
  actions?: PriceAction[]
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's actions itself.
   */
  status?: PriceDetailsStatus
  /**
   * Called once per action (once per seller for 'open-offer'). Each action
   * locks after use; the others stay available.
   */
  onResult?: (result: PriceDetailsResult) => void
  /**
   * Actions from history (the tool call's stored output, or several). They
   * show as done and never call onResult again.
   */
  result?: PriceDetailsResult | PriceDetailsResult[]
  className?: string
}

const VERDICT: Record<
  Verdict,
  { label: string; Icon: typeof ThumbsUpIcon; tone: string }
> = {
  good: {
    label: "Good price",
    Icon: ThumbsUpIcon,
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  fair: { label: "Fair price", Icon: MinusIcon, tone: "" },
  high: {
    label: "High price",
    Icon: TrendingUpIcon,
    tone: "text-orange-700 dark:text-orange-400",
  },
}

const CONDITION: Record<Condition, string> = {
  new: "New",
  refurbished: "Refurbished",
  used: "Used",
}

const RANGE_LABEL: Record<HistoryRange, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "1y": "1 year",
}

const linkClass =
  "inline-flex min-h-6 items-center gap-1 rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"

const chartConfig: ChartConfig = { price: { label: "Price" } }

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

type Row = DatedPoint & { i: number }

type ReadyRow = BreakdownRow
type ReadyOffer = PriceOffer

const keyOf = (r: PriceDetailsResult) =>
  r.action === "open-offer" ? `open-offer:${r.seller}` : r.action

/** The current time, read once after mount so server and client match. */
function useMountedNow() {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => setNow(Date.now()), [])
  return now
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

/** A deduction shown as a negative amount, read as "minus". */
function Negative({ text }: { text: string }) {
  return (
    <>
      <span aria-hidden>−{text}</span>
      <span className="sr-only">minus {text}</span>
    </>
  )
}

function Thumbnail({ src, alt }: { src: string | null; alt?: string }) {
  const [failed, setFailed] = React.useState<string | null>(null)
  if (!src || failed === src) return null
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={alt ?? ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className="size-12 shrink-0 rounded-lg bg-muted object-cover"
    />
  )
}

function Section({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  const id = React.useId()
  return (
    <section aria-labelledby={id} className={cn("flex flex-col", className)}>
      <h4 id={id} className="sr-only">
        {title}
      </h4>
      {children}
    </section>
  )
}

export function PriceDetails({
  item,
  currency,
  price,
  deal,
  breakdown,
  total,
  history,
  offers,
  asOf,
  source,
  actions,
  status: statusProp,
  onResult,
  result,
  className,
}: PriceDetailsProps) {
  const locale = useGenUILocale()
  const [done, setDone] = React.useState<Map<string, PriceDetailsResult>>(
    () =>
      new Map(
        (result === undefined
          ? []
          : Array.isArray(result)
            ? result
            : [result]
        ).map((r) => [keyOf(r), r]),
      ),
  )
  const [watching, setWatching] = React.useState(false)
  const [targetText, setTargetText] = React.useState("")
  const [targetError, setTargetError] = React.useState<string | null>(null)
  const [rangeChoice, setRangeChoice] = React.useState<HistoryRange>("90d")
  const watchButton = React.useRef<HTMLButtonElement>(null)
  const refocusWatch = React.useRef(false)
  const titleId = React.useId()
  const inputId = React.useId()
  const errorId = React.useId()
  const hintId = React.useId()
  const reduceMotion = useReducedMotion()
  const now = useMountedNow()

  // A host-provided "ready" (or nothing) yields to the user's actions.
  const status: PriceDetailsStatus =
    done.size > 0 && (statusProp === undefined || statusProp === "ready")
      ? "done"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"

  const digits = currencyDigits(currency)
  const money = (n: number) => formatMoney(n, currency, { trim: true, locale })
  const exact = (n: number) => formatMoney(n, currency, { locale })

  // Header
  const current = price?.current
  const hasCurrent = typeof current === "number"
  const saving = savings(current, price?.was, digits)
  const unitText = formatUnitPrice(price?.unit, currency, locale)
  const member =
    typeof price?.memberPrice?.amount === "number" && price.memberPrice.label
      ? { amount: price.memberPrice.amount, label: price.memberPrice.label }
      : null
  const verdict = deal?.verdict ? VERDICT[deal.verdict] : null
  const itemUrl = safeUrl(item?.url)
  const name = item?.name

  // Breakdown
  const rows = (breakdown ?? []).filter(
    (r): r is ReadyRow =>
      typeof r.label === "string" &&
      typeof r.amount === "number" &&
      typeof r.kind === "string",
  )
  const check = rows.length > 0 ? reconcileBreakdown(rows, total, digits) : null
  const mismatch =
    check && !streaming ? describeMismatch(check, currency, locale) : null
  const hasShipping = rows.some((r) => r.kind === "shipping")
  const totalKnown = typeof total === "number" || !streaming
  const breakdownMode =
    breakdown !== undefined && (rows.length > 0 || streaming)
  const totalLabel = hasShipping ? "Delivered total" : "Total"
  const heroTotal =
    totalKnown && check ? check.total : typeof total === "number" ? total : null

  // History
  const allPoints = cleanHistory(history)
  const ranges = rangeOptions(allPoints)
  const range: HistoryRange | null = ranges.length > 0 ? rangeChoice : null
  const points = range ? pointsInRange(allPoints, RANGE_DAYS[range]) : allPoints
  const chartRows: Row[] = points.map((p, i) => ({ ...p, i }))
  const ext = historyExtents(points)
  // The price alert's example amount: the lowest price seen, when below now.
  const watchExample =
    ext && hasCurrent && ext.min.price < current ? `e.g. ${ext.min.price}` : null
  const canDraw = chartRows.length >= 2
  const spansYears =
    canDraw &&
    new Date(points[0].ms).getUTCFullYear() !==
      new Date(points[points.length - 1].ms).getUTCFullYear()
  const day = (t: string) => formatDay(t, { year: spansYears, locale })
  const domain: [number, number] | null = ext
    ? (() => {
        const span =
          ext.max.price - ext.min.price || Math.abs(ext.max.price) * 0.02 || 1
        return [
          Math.max(0, ext.min.price - span * 0.3),
          ext.max.price + span * 0.3,
        ]
      })()
    : null
  const summary =
    ext && canDraw
      ? historySummary(ext, current, currency, {
          digits,
          year: spansYears,
          locale,
        })
      : null
  const shownDays = historySpanDays(points)
  const align = (i: number) => {
    const f = chartRows.length > 1 ? i / (chartRows.length - 1) : 0.5
    return f < 0.15 ? "start" : f > 0.85 ? "end" : "middle"
  }
  const animate = !streaming && !reduceMotion

  // Offers
  const readyOffers = (offers ?? []).filter(
    (o): o is ReadyOffer =>
      typeof o.seller === "string" && typeof o.price === "number",
  )
  const ranked = rankOffers(readyOffers, digits)

  // Actions
  const list = resolveActions(actions)
  const canOpenOffers = list.includes("open-offer")
  const footerActions = list.filter(
    (a): a is "watch-price" | "add-to-cart" => a !== "open-offer",
  )
  const sourceUrl = safeUrl(source?.url)

  // Return focus to "Watch price" when the target box closes without saving.
  React.useEffect(() => {
    if (!watching && refocusWatch.current) {
      refocusWatch.current = false
      watchButton.current?.focus()
    }
  }, [watching])

  const fire = (r: PriceDetailsResult) => {
    if (busy || done.has(keyOf(r))) return
    setDone((prev) => new Map(prev).set(keyOf(r), r))
    onResult?.(r)
  }
  const cancelWatch = () => {
    refocusWatch.current = true
    setWatching(false)
    setTargetError(null)
  }
  const submitWatch = (e: React.FormEvent) => {
    e.preventDefault()
    const v = validateWatchTarget(targetText, current, currency, locale)
    if (!v.ok) {
      setTargetError(v.error)
      return
    }
    setWatching(false)
    setTargetError(null)
    fire({ action: "watch-price", target: v.target })
  }

  const confirmation = (r: PriceDetailsResult) => {
    switch (r.action) {
      case "watch-price":
        return `Watching for under ${money(r.target)}`
      case "add-to-cart":
        return "Sent to your cart"
      case "open-offer":
        return `Opened ${r.seller}'s offer`
    }
  }

  const tooltip = (
    <ChartTooltip
      cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
      isAnimationActive={false}
      content={({ active, payload }: TooltipContentProps) => {
        const r = payload?.[0]?.payload as Row | undefined
        if (!active || !r) return null
        return (
          <div className="grid min-w-28 gap-1 rounded-lg border border-border/50 bg-background px-3 py-2 text-[13px] leading-4 shadow-xl dark:shadow-none">
            <div className="font-medium">
              {formatDay(r.date, { year: true, locale })}
            </div>
            <div className="font-mono font-medium tabular-nums text-foreground">
              {exact(r.price)}
            </div>
          </div>
        )
      }}
    />
  )

  const historySection = history !== undefined && (canDraw || streaming) && (
    <Section title="Price history" className="border-t border-border px-3 py-3">
      <div className="flex flex-col gap-3">
        {ranges.length > 0 && (
          <Segmented
            label="History range"
            value={rangeChoice}
            onChange={setRangeChoice}
            options={ranges.map((r) => ({
              value: r,
              label: (
                <>
                  {r}
                  <span className="sr-only">{`, last ${RANGE_LABEL[r]}`}</span>
                </>
              ),
            }))}
          />
        )}
        {canDraw && domain && ext ? (
          <motion.div {...enter} className="flex flex-col gap-2">
            <figure
              aria-label={`Price history, ${shownDays} days`}
              className="m-0"
            >
              {/* The SVG is visual only; the table below carries the numbers. */}
              <ChartContainer
                aria-hidden
                config={chartConfig}
                className="aspect-auto h-32 w-full"
              >
                <LineChart
                  data={chartRows}
                  accessibilityLayer={false}
                  margin={{ top: 4, right: 0, bottom: 0, left: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="i"
                    type="number"
                    domain={[0, chartRows.length - 1]}
                    tickCount={5}
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={24}
                    tickFormatter={(i: number) =>
                      chartRows[i] ? formatDay(chartRows[i].date, { locale }) : ""
                    }
                  />
                  <YAxis
                    orientation="right"
                    domain={domain}
                    tickCount={3}
                    tickLine={false}
                    axisLine={false}
                    tickMargin={4}
                    width="auto"
                    tickFormatter={(v: number) =>
                      formatMoney(Math.round(v), currency, { trim: true, locale })
                    }
                  />
                  {tooltip}
                  <Line
                    dataKey="price"
                    type="stepAfter"
                    stroke="var(--foreground)"
                    strokeWidth={1.5}
                    dot={false}
                    activeDot={{ r: 3, fill: "var(--foreground)" }}
                    isAnimationActive={animate}
                  />
                  {!streaming && ext.min.price !== ext.max.price && (
                    <ReferenceDot
                      x={ext.max.index}
                      y={ext.max.price}
                      r={0}
                      shape={calloutShape(
                        money(ext.max.price),
                        "above",
                        align(ext.max.index),
                      )}
                    />
                  )}
                  {!streaming && ext.min.price !== ext.max.price && (
                    <ReferenceDot
                      x={ext.min.index}
                      y={ext.min.price}
                      r={0}
                      shape={calloutShape(
                        money(ext.min.price),
                        "below",
                        align(ext.min.index),
                      )}
                    />
                  )}
                  {/* The latest point: today's price. */}
                  <ReferenceDot
                    x={ext.last.index}
                    y={ext.last.price}
                    r={4}
                    fill="var(--foreground)"
                    stroke="var(--surface-bg)"
                    strokeWidth={2}
                  />
                </LineChart>
              </ChartContainer>
            </figure>
            {summary && <p className="sr-only">{summary}</p>}
            <table className="sr-only">
              <caption>{`Price history, ${shownDays} days`}</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Price</th>
                </tr>
              </thead>
              <tbody>
                {chartRows.map((r) => (
                  <tr key={r.i}>
                    <th scope="row">{day(r.date)}</th>
                    <td>{exact(r.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        ) : (
          <Skeleton className="h-32 w-full" />
        )}
      </div>
    </Section>
  )

  const breakdownSection = breakdown !== undefined &&
    (rows.length > 0 || streaming) && (
      <Section
        title="Cost breakdown"
        className="border-t border-border px-3 py-3"
      >
        <dl className={cn(genuiType.body, "flex flex-col gap-1.5")}>
          {rows.map((r, i) => (
            <motion.div
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no id and only append while streaming
              key={i}
              {...enter}
              data-slot="price-details-row"
              data-kind={r.kind}
              className="flex items-baseline justify-between gap-4"
            >
              <dt className="min-w-0">
                {r.label}
                {r.note && <span className="sr-only">{`, ${r.note}`}</span>}
              </dt>
              <dd className="text-right whitespace-nowrap tabular-nums">
                {isDeduction(r.kind) ? (
                  <Negative text={exact(Math.abs(r.amount))} />
                ) : r.kind === "shipping" && r.amount === 0 ? (
                  "Free"
                ) : (
                  exact(r.amount)
                )}
              </dd>
            </motion.div>
          ))}
          {streaming && typeof total !== "number" && (
            <div aria-hidden className="flex justify-between gap-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
          )}
          {(rows.length > 0 || typeof total === "number") && (
            // The total is the large number at the top; this row repeats it for screen readers.
            <div className="sr-only">
              <dt>{hasShipping ? "Delivered total" : "Total"}</dt>
              <dd className="text-right tabular-nums">
                {totalKnown && check ? (
                  exact(check.total)
                ) : typeof total === "number" ? (
                  exact(total)
                ) : (
                  <Skeleton className="h-4 w-20" />
                )}
              </dd>
            </div>
          )}
        </dl>
        {mismatch && (
          <div className="mt-2 rounded-[10px] border border-border bg-transparent p-1">
            <p
              data-slot="price-details-warning"
              className="flex items-center gap-3 rounded-md bg-orange-500/10 px-3 py-3 text-[13px] dark:bg-orange-400/10"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500/15 dark:bg-orange-400/15">
                <AlertTriangleIcon
                  aria-hidden
                  className="size-4 shrink-0 text-orange-500 dark:text-orange-400"
                />
              </span>
              <span className="min-w-0 flex-1">{mismatch}</span>
            </p>
          </div>
        )}
      </Section>
    )

  const offersSection = offers !== undefined &&
    (ranked.length > 0 || streaming) && (
      <Section title="Other offers" className="border-t border-border">
        <ol className="flex flex-col divide-y divide-border">
          {ranked.map(({ offer, total: delivered, lowest }) => {
            const url = safeUrl(offer.url)
            const opened = done.has(`open-offer:${offer.seller}`)
            const shippingText =
              typeof offer.shipping === "number"
                ? offer.shipping === 0
                  ? "Free shipping"
                  : `+${exact(offer.shipping)} shipping`
                : typeof offer.total === "number"
                  ? "Total as quoted"
                  : "Shipping not listed"
            // One quiet line: condition (only when not new), shipping, arrival.
            const meta = [
              offer.condition && offer.condition !== "new"
                ? CONDITION[offer.condition]
                : null,
              shippingText,
              offer.delivery ? `Arrives ${offer.delivery}` : null,
            ].filter((m): m is string => Boolean(m))
            return (
              <motion.li
                key={offer.seller}
                layout="position"
                {...enter}
                data-slot="price-details-offer"
                className="flex items-center gap-3 px-3 py-3"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        genuiType.body,
                        "font-semibold break-words",
                      )}
                    >
                      {offer.seller}
                    </span>
                    {lowest && !streaming && (
                      <Badge variant="success">
                        <ArrowDownIcon aria-hidden data-icon="inline-start" />
                        Lowest total
                      </Badge>
                    )}
                  </div>
                  <p className={cn(genuiType.meta, "tabular-nums")}>
                    {offer.condition === "new" && (
                      <span className="sr-only">New, </span>
                    )}
                    {meta.join(" · ")}
                    <span className="sr-only">{`. Price ${exact(offer.price)}`}</span>
                    {offer.rating && (
                      <span className="sr-only">
                        {`. Rated ${offer.rating.score} out of ${offer.rating.outOf}`}
                      </span>
                    )}
                  </p>
                </div>
                <span
                  className={cn(
                    genuiType.body,
                    "shrink-0 font-medium tabular-nums",
                  )}
                >
                  {exact(delivered)}
                </span>
                {canOpenOffers &&
                  (url && !busy ? (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      onClick={() =>
                        fire({ action: "open-offer", seller: offer.seller })
                      }
                      className={cn(
                        buttonVariants({ variant: "secondary", size: "sm" }),
                        "shrink-0 focus-visible:ring-2",
                      )}
                    >
                      {opened && <CheckIcon aria-hidden />}
                      View
                      <span className="sr-only">
                        {` ${offer.seller}'s offer (opens in a new tab)`}
                      </span>
                    </a>
                  ) : (
                    <WhyDisabled
                      when={busy || opened}
                      reason={opened ? "Already opened" : "One moment…"}
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || opened}
                        onClick={() =>
                          fire({ action: "open-offer", seller: offer.seller })
                        }
                        className="shrink-0"
                      >
                        {opened && <CheckIcon aria-hidden />}
                        View
                        <span className="sr-only">{` ${offer.seller}'s offer`}</span>
                      </Button>
                    </WhyDisabled>
                  ))}
              </motion.li>
            )
          })}
          {streaming && (
            <li aria-hidden className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
            </li>
          )}
        </ol>
      </Section>
    )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="price-details"
        data-status={status}
        aria-busy={busy}
        aria-labelledby={name ? titleId : undefined}
        aria-label={name ? undefined : "Price details"}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <Thumbnail
            src={safeImageSrc(item?.image?.src)}
            alt={item?.image?.alt}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SurfaceTitle id={titleId} className="break-words">
              {name &&
                (itemUrl ? (
                  <a
                    href={itemUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="rounded-sm underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    {name}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  name
                ))}
            </SurfaceTitle>
            {item?.variant ? (
              <p className={cn(genuiType.meta, "break-words")}>
                {item.variant}
              </p>
            ) : (
              streaming && !name && <Skeleton className="h-3 w-24" />
            )}
          </div>
        </SurfaceHeader>

        <div className="flex flex-col">
          <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
            {breakdownMode ? (
              // A cost breakdown answers "what will it cost": the total leads.
              <motion.div
                {...enter}
                className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1"
              >
                {heroTotal !== null ? (
                  <span className={genuiType.display}>
                    <span className="sr-only">{`${totalLabel}: `}</span>
                    {exact(heroTotal)}
                  </span>
                ) : (
                  <Skeleton className="h-10 w-40" />
                )}
                <span aria-hidden className={genuiType.meta}>
                  {totalLabel}
                </span>
              </motion.div>
            ) : hasCurrent ? (
              <motion.div
                {...enter}
                className="flex flex-nowrap items-center gap-x-2.5"
              >
                <span className={cn(genuiType.display, "shrink-0")}>
                  <span className="sr-only">Price now: </span>
                  {money(current)}
                </span>
                {saving && typeof price?.was === "number" && (
                  <>
                    <s
                      className={cn(
                        genuiType.body,
                        "min-w-0 truncate tabular-nums text-muted-foreground",
                      )}
                    >
                      <span className="sr-only">was </span>
                      {money(price.was)}
                    </s>
                    <Badge variant="success" className="shrink-0 tabular-nums">
                      <ArrowDownRightIcon aria-hidden />
                      <span className="sr-only">Save </span>
                      {money(saving.amount)} ({saving.percent}%)
                      <span className="sr-only"> decrease</span>
                    </Badge>
                  </>
                )}
              </motion.div>
            ) : (
              <Skeleton className="h-10 w-40" />
            )}
            {(unitText || member) && !breakdownMode && (
              <p className={cn(genuiType.meta, "tabular-nums")}>
                {member && `${member.label} ${money(member.amount)}`}
                {member && unitText && " · "}
                {unitText}
              </p>
            )}
            {verdict && (
              <motion.p
                {...enter}
                data-slot="price-details-verdict"
                data-verdict={deal?.verdict}
                className={cn(genuiType.body, "flex items-start gap-1.5")}
              >
                <verdict.Icon
                  aria-hidden
                  className={cn("mt-0.5 size-4 shrink-0", verdict.tone)}
                />
                <span>
                  <span className={cn("font-semibold", verdict.tone)}>
                    {verdict.label}
                  </span>
                  {deal?.reason && (
                    <>
                      <span aria-hidden>{" · "}</span>
                      <span className="sr-only">: </span>
                      {deal.reason}
                    </>
                  )}
                </span>
              </motion.p>
            )}
          </div>

          {breakdownSection}
          {historySection}
          {offersSection}
        </div>

        <SurfaceFooter className="flex-col items-stretch gap-3">
          <div
            aria-live="polite"
            className={cn("flex flex-col gap-1", done.size === 0 && "sr-only")}
          >
            {[...done.entries()].map(([key, r]) => (
              <p
                key={key}
                className={cn(genuiType.body, "flex items-start gap-1.5")}
              >
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {confirmation(r)}
              </p>
            ))}
          </div>

          {watching ? (
            <form
              noValidate
              onSubmit={submitWatch}
              onKeyDown={(e) => {
                if (e.key === "Escape") cancelWatch()
              }}
              className="flex flex-col gap-2"
            >
              {/* The field takes the full row so its label fits inside the box;
                  the actions sit under it. An example amount stays visible. */}
              <FormField
                htmlFor={inputId}
                label={
                  <>
                    Tell me when it drops below
                    {currency && (
                      <span className="sr-only">{` (${currency})`}</span>
                    )}
                  </>
                }
                filled={targetText !== ""}
                pinned={watchExample !== null}
                error={
                  targetError ? (
                    <span role="alert">{targetError}</span>
                  ) : undefined
                }
                errorId={errorId}
              >
                <Input
                  id={inputId}
                  autoFocus
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={watchExample ?? "Amount"}
                  value={targetText}
                  onChange={(e) => {
                    setTargetText(e.target.value)
                    if (targetError) setTargetError(null)
                  }}
                  aria-invalid={targetError ? true : undefined}
                  aria-describedby={targetError ? errorId : hintId}
                  className={cn(
                    formInputClass,
                    "tabular-nums",
                    watchExample !== null && formExampleClass,
                  )}
                />
              </FormField>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={cancelWatch}
                >
                  Cancel
                </Button>
                <WhyDisabled when={busy} reason="One moment…">
                  <Button type="submit" size="sm" disabled={busy}>
                    Watch price
                  </Button>
                </WhyDisabled>
              </div>
              {!targetError && hasCurrent && (
                <p id={hintId} className="sr-only">
                  {`Now ${money(current)}${
                    ext && ext.min.price < current
                      ? ` · lowest ${money(ext.min.price)} on ${day(ext.min.date)}`
                      : ""
                  }`}
                </p>
              )}
            </form>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p
                className={cn(
                  genuiType.meta,
                  "flex min-w-0 flex-wrap items-center gap-x-1.5",
                )}
              >
                {streaming ? (
                  <ShimmeringText
                    text="Loading prices…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                ) : status === "submitting" ? (
                  "Sending…"
                ) : (
                  <>
                    {asOf && (
                      <span suppressHydrationWarning>
                        {formatAsOf(asOf, now, locale)}
                      </span>
                    )}
                    {asOf && source?.label && <span aria-hidden>·</span>}
                    {source?.label &&
                      (sourceUrl ? (
                        <a
                          href={sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className={linkClass}
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
              {footerActions.length > 0 && (
                <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
                  {footerActions.map((a, i) => {
                    const used = done.has(a)
                    return (
                      <WhyDisabled
                        key={a}
                        when={
                          busy || used || (a === "watch-price" && !hasCurrent)
                        }
                        reason={
                          used
                            ? "Already done"
                            : busy
                              ? "One moment…"
                              : "No current price to watch"
                        }
                      >
                        <Button
                          ref={a === "watch-price" ? watchButton : undefined}
                          size="sm"
                          variant={i === 0 && !used ? "default" : "secondary"}
                          disabled={
                            busy || used || (a === "watch-price" && !hasCurrent)
                          }
                          onClick={() =>
                            a === "watch-price"
                              ? setWatching(true)
                              : fire({ action: a })
                          }
                          className="flex-1 sm:flex-none"
                        >
                          {used && <CheckIcon aria-hidden />}
                          {a === "watch-price"
                            ? used
                              ? "Watching"
                              : "Watch price"
                            : "Add to cart"}
                          {name && (
                            <span className="sr-only">
                              , {name}
                              {used ? " (done)" : ""}
                            </span>
                          )}
                        </Button>
                      </WhyDisabled>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
