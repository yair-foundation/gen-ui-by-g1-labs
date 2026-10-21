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
  arcAngles,
  donutSlice,
  formatAmount,
  formatShare,
  type Part,
  rankParts,
  squarify,
  toNumber,
  waffleCounts,
} from "./composition-chart-utils"
import type { CompositionChartInput, CompositionValue } from "./composition-chart.schema"

export type CompositionChartProps = Partial<
  Omit<CompositionChartInput, "part" | "value" | "group" | "data">
> & {
  /** Fields may be partial while the tool call streams. */
  part?: { key?: string; label?: string }
  value?: Partial<CompositionValue>
  group?: { key?: string; label?: string }
  /** Rows arrive progressively while streaming. */
  data?: Record<string, string | number>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type Hover = { x: number; y: number; title: string; rows: [string, string][] }

// Shared defaults: a fresh `{}` or `[]` every render would defeat the memos.
const NO_PART: { key?: string; label?: string } = {}
const NO_VALUE: Partial<CompositionValue> = {}
const NO_ROWS: Record<string, string | number>[] = []

/** Parts with their own shade; the rest fold into "Other" (not in a treemap). */
const KEEP = 4
const MAX_GROUPS = 8

/*
 * Parts take the categorical colours in rank order (vermilion, cool blue,
 * cassis, sage, wasabi: validated as neighbours in both themes, see
 * series-colors); "Other" is a neutral grey and what's left of a total is
 * hollow. The legend lists every part with its amount, so colour is never
 * the only key. A treemap (many parts, labels inside the tiles) stays one
 * strong colour: the deep end of the chart ramp in light mode, the pale end
 * in dark, or the site's tone.
 */
const STRONG = "[--pc:var(--chart-5)] dark:[--pc:var(--chart-1)]"
// Five: four kept parts plus a fifth that isn't worth folding alone.
const SHADES = [
  "[--s:var(--series-1)]",
  "[--s:var(--series-2)]",
  "[--s:var(--series-3)]",
  "[--s:var(--series-4)]",
  "[--s:var(--series-5)]",
]
const OTHER_SHADE = "[--s:color-mix(in_oklab,var(--foreground)_28%,var(--card))]"
const shadeOf = (p: Part, i: number) => (p.other ? OTHER_SHADE : SHADES[Math.min(i, SHADES.length - 1)])

/** A swatch or mark filled with its part's shade, or hollow for a remainder. */
function fillClass(p: Part, i: number) {
  return p.remainder
    ? "border border-dashed border-muted-foreground/60 bg-transparent"
    : cn(shadeOf(p, i), "bg-[var(--s)]")
}

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

export function CompositionChart({
  title,
  description,
  type = "donut",
  part = NO_PART,
  value = NO_VALUE,
  group,
  total,
  remainderLabel,
  highlight,
  data = NO_ROWS,
  summary,
  status: lifecycle = "ready",
  className,
}: CompositionChartProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const titleId = React.useId()
  const [frameRef, width] = useWidth<HTMLDivElement>(560)
  const [hover, setHover] = React.useState<Hover | null>(null)
  const [active, setActive] = React.useState<number | null>(null)

  const partKey = part.key
  const valueKey = value.key
  const groupKey = type === "bar" ? group?.key : undefined

  // Amounts per part (all groups), and per group and part.
  const { totals, groups, cells } = React.useMemo(() => {
    const totals = new Map<string, number>()
    const cells = new Map<string, Map<string, number>>()
    const groups: string[] = []
    if (!partKey || !valueKey) return { totals, groups, cells }
    for (const row of data) {
      const label = row?.[partKey]
      const amount = toNumber(row?.[valueKey])
      if (label === undefined || amount === null) continue
      const p = String(label)
      totals.set(p, (totals.get(p) ?? 0) + amount)
      const g = groupKey && row[groupKey] !== undefined ? String(row[groupKey]) : ""
      if (!cells.has(g)) {
        cells.set(g, new Map())
        groups.push(g)
      }
      const m = cells.get(g)
      m?.set(p, (m.get(p) ?? 0) + amount)
    }
    return { totals, groups: groups.slice(0, MAX_GROUPS), cells }
  }, [data, partKey, valueKey, groupKey])

  const grouped = Boolean(groupKey) && groups.length > 1
  const { parts: ranked, partOf } = React.useMemo(
    () => rankParts(totals, type === "treemap" ? undefined : KEEP),
    [totals, type],
  )
  const sum = ranked.reduce((a, p) => a + p.total, 0)
  // What's left of a stated total, shown as a hollow part (one whole only).
  const remainder = !grouped && total && total > sum ? total - sum : 0
  const parts: Part[] = remainder
    ? [...ranked, { label: remainderLabel ?? "Remaining", total: remainder, remainder: true }]
    : ranked
  const whole = remainder ? (total ?? sum) : sum

  // Per group, the amount of each ranked part (folded parts go to Other).
  const groupRows = React.useMemo(
    () =>
      groups.map((g) => {
        const amounts = ranked.map(() => 0)
        for (const [p, v] of cells.get(g) ?? []) {
          const i = partOf(p)
          if (i >= 0) amounts[i] += Math.max(0, v)
        }
        return { name: g, amounts, sum: amounts.reduce((a, b) => a + b, 0) }
      }),
    [groups, cells, ranked, partOf],
  )

  const canDraw = sum > 0 && ranked.length > 0
  const fmt = (v: number) => formatAmount(v, value, locale)
  const highlighted = highlight ? parts.findIndex((p) => p.label === highlight) : -1

  const show = (e: React.PointerEvent, i: number, title: string, rows: [string, string][]) => {
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame) return
    setActive(i)
    setHover({ x: e.clientX - frame.left, y: e.clientY - frame.top, title, rows })
  }
  const hide = () => {
    setActive(null)
    setHover(null)
  }
  const partRows = (p: Part, of = whole): [string, string][] => [
    [value.label ?? "Amount", fmt(p.total)],
    ["Share", formatShare(p.total, of, locale)],
  ]
  const fade = (i: number) =>
    cn("transition-opacity duration-150", active !== null && active !== i && "opacity-30")

  // ---- the visual -------------------------------------------------------------

  let visual: React.ReactNode = null
  if (canDraw && type === "donut") {
    const size = 176
    const arcs = arcAngles(parts.map((p) => p.total))
    const focus = highlighted >= 0 ? parts[highlighted] : null
    visual = (
      <div className="relative mx-auto size-44 shrink-0">
        <svg aria-hidden viewBox={`0 0 ${size} ${size}`} className="size-full overflow-visible">
          {parts.map((p, i) => (
            <path
              key={p.label}
              d={donutSlice(size / 2, size / 2, 58, 86, arcs[i].start, arcs[i].end)}
              className={cn(
                fade(i),
                p.remainder
                  ? "fill-transparent stroke-muted-foreground/60 [stroke-dasharray:3_3]"
                  : cn(shadeOf(p, i), "fill-[var(--s)]"),
              )}
              onPointerMove={(e) => show(e, i, p.label, partRows(p))}
              onPointerLeave={hide}
            />
          ))}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className={genuiType.stat}>
            {focus ? formatShare(focus.total, whole, locale) : formatAmount(whole, { ...value, unit: undefined }, locale)}
          </span>
          <span className={cn(genuiType.meta, "max-w-24 truncate")}>
            {focus ? focus.label : "Total"}
          </span>
        </div>
      </div>
    )
  } else if (canDraw && type === "waffle") {
    const counts = waffleCounts(parts.map((p) => p.total))
    const owner = counts.flatMap((c, i) => Array.from({ length: c }, () => i))
    visual = (
      <div aria-hidden className="mx-auto grid w-44 shrink-0 grid-cols-10 gap-0.5">
        {owner.map((i, k) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: squares are positions
            key={k}
            className={cn("aspect-square rounded-[3px]", fillClass(parts[i], i), fade(i))}
            onPointerMove={(e) => show(e, i, parts[i].label, partRows(parts[i]))}
            onPointerLeave={hide}
          />
        ))}
      </div>
    )
  } else if (canDraw && type === "treemap") {
    const H = 240
    const rects = squarify(
      parts.map((p) => p.total),
      width,
      H,
    )
    visual = (
      <svg aria-hidden width={width} height={H} className="block">
        {rects.map((r) => {
          const p = parts[r.index]
          const fits = r.w > 64 && r.h > 38
          const chars = Math.max(3, Math.floor((r.w - 16) / 7.5))
          return (
            <g
              key={p.label}
              className={fade(r.index)}
              onPointerMove={(e) => show(e, r.index, p.label, partRows(p))}
              onPointerLeave={hide}
            >
              <rect
                x={r.x + 1}
                y={r.y + 1}
                width={Math.max(0, r.w - 2)}
                height={Math.max(0, r.h - 2)}
                rx={4}
                className={
                  p.remainder
                    ? "fill-transparent stroke-muted-foreground/60 [stroke-dasharray:3_3]"
                    : "fill-[var(--pc)]"
                }
              />
              {fits && (
                <>
                  <text x={r.x + 9} y={r.y + 20} fontSize={13} fontWeight={500} className={p.remainder ? "fill-foreground" : "fill-white dark:fill-[#141414]"}>
                    {p.label.length > chars ? `${p.label.slice(0, chars - 1)}…` : p.label}
                  </text>
                  <text x={r.x + 9} y={r.y + 36} fontSize={12} className={p.remainder ? "fill-muted-foreground" : "fill-white/75 dark:fill-[#141414]/70"}>
                    {formatShare(p.total, whole, locale)}
                  </text>
                </>
              )}
            </g>
          )
        })}
      </svg>
    )
  } else if (canDraw && type === "bar") {
    const rows = grouped
      ? groupRows
      : [{ name: "", amounts: parts.map((p) => p.total), sum: whole }]
    visual = (
      <div className="flex flex-col gap-3">
        {rows.map((row) => (
          <div
            key={row.name}
            className={cn(
              "grid items-center gap-x-3 gap-y-1",
              grouped ? "grid-cols-[minmax(0,7rem)_1fr_auto]" : "grid-cols-1",
            )}
          >
            {grouped && <span className="truncate text-[13px]">{row.name}</span>}
            <div aria-hidden className="flex h-5 w-full gap-0.5 overflow-hidden rounded-[5px]">
              {row.amounts.map((amount, i) =>
                amount > 0 ? (
                  <div
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positions
                    key={i}
                    className={cn("h-full min-w-0.5", fillClass(parts[i], i), fade(i))}
                    style={{ width: `${(amount / (row.sum || 1)) * 100}%` }}
                    onPointerMove={(e) =>
                      show(e, i, grouped ? `${parts[i].label} · ${row.name}` : parts[i].label, [
                        [value.label ?? "Amount", fmt(amount)],
                        [grouped ? `Share of ${row.name}` : "Share", formatShare(amount, row.sum, locale)],
                      ])
                    }
                    onPointerLeave={hide}
                  />
                ) : null,
              )}
            </div>
            {grouped && (
              <span className={cn(genuiType.value, "text-right")}>{formatAmount(row.sum, { ...value, unit: undefined }, locale)}</span>
            )}
          </div>
        ))}
      </div>
    )
  }

  // ---- the legend ---------------------------------------------------------------

  // One whole: every part with its amount and share (this is the data, not
  // just a key). Grouped bars: a compact key; the numbers are on hover and in
  // the table below.
  const legend = grouped ? (
    <ul aria-hidden className="flex flex-wrap gap-x-4 gap-y-1">
      {ranked.map((p, i) => (
        <li key={p.label} className={cn("flex items-center gap-1.5", genuiType.meta)}>
          <span className={cn("size-2.5 shrink-0 rounded-[3px]", fillClass(p, i))} />
          {p.label}
        </li>
      ))}
    </ul>
  ) : (
    <ul
      aria-label={part.label ? `${part.label} breakdown` : "Breakdown"}
      className={cn(
        "grid min-w-0 flex-1 gap-x-8",
        type === "bar" || type === "treemap" ? "@md:grid-cols-2" : "",
      )}
    >
      {parts.map((p, i) => (
        <li
          key={p.label}
          className={cn(
            "flex items-center gap-2 border-b border-border py-1.5 text-[13px] last:border-b-0",
            fade(i),
          )}
          onPointerEnter={() => setActive(i)}
          onPointerLeave={() => setActive(null)}
        >
          <span
            aria-hidden
            className={cn(
              "size-2.5 shrink-0 rounded-[3px]",
              type === "treemap" && !p.remainder
                ? "bg-[var(--pc)]"
                : fillClass(p, i),
            )}
          />
          <span className={cn("min-w-0 flex-1 truncate", i === highlighted && "font-semibold")}>
            {p.label}
          </span>
          <span className="text-muted-foreground tabular-nums">{fmt(p.total)}</span>
          <span className="w-10 text-right font-medium tabular-nums">{formatShare(p.total, whole, locale)}</span>
        </li>
      ))}
    </ul>
  )

  const showTotal = canDraw && !grouped && type !== "donut"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="composition-chart"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Composition"}
        className={cn("@container", STRONG, SERIES_VARS, className)}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && <SurfaceDescription>{description}</SurfaceDescription>}
        </SurfaceHeader>

        {showTotal && (
          <dl className={cn("flex flex-wrap gap-x-10 gap-y-3 border-t border-border py-3", surfaceInset)}>
            <div className="flex flex-col gap-0.5">
              <dt className={genuiType.label}>{remainder ? "Total" : (value.label ?? "Total")}</dt>
              <dd className={genuiType.stat}>{fmt(whole)}</dd>
            </div>
            {remainder > 0 && (
              <div className="flex flex-col gap-0.5">
                <dt className={genuiType.label}>{remainderLabel ?? "Remaining"}</dt>
                <dd className={genuiType.stat}>{fmt(remainder)}</dd>
              </div>
            )}
          </dl>
        )}

        <div className={cn("border-t border-border py-3", surfaceInset)}>
          <div ref={frameRef} className="relative">
            {canDraw ? (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className={cn(
                  "flex flex-col gap-4",
                  (type === "donut" || type === "waffle") && "@md:flex-row @md:items-center @md:gap-8",
                )}
              >
                {visual}
                {legend}
              </motion.div>
            ) : (
              <Skeleton className="h-44 w-full" />
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
                  {hover.rows.map(([label, v]) => (
                    <div key={label} className="flex items-baseline gap-3">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="ml-auto font-mono font-medium tabular-nums">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {canDraw && grouped && (
          <table className="sr-only">
            <caption>{title ?? "Composition"}</caption>
            <thead>
              <tr>
                <th scope="col">{group?.label ?? "Group"}</th>
                {ranked.map((p) => (
                  <th key={p.label} scope="col">
                    {p.label}
                  </th>
                ))}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {groupRows.map((row) => (
                <tr key={row.name}>
                  <th scope="row">{row.name}</th>
                  {row.amounts.map((amount, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positions
                    <td key={i}>{`${fmt(amount)} (${formatShare(amount, row.sum, locale)})`}</td>
                  ))}
                  <td>{fmt(row.sum)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {summary && (
          <p className={cn("border-t border-border py-3 text-muted-foreground", genuiType.body, surfaceInset)}>
            {summary}
          </p>
        )}
      </Surface>
    </MotionConfig>
  )
}
