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
import { cn } from "@/lib/utils"
import { useGenUILocale } from "@/components/genui/locale"

import {
  bandPath,
  type FlowInput,
  formatAmount,
  layoutSankey,
  spreadLabels,
  toNumber,
  traceFrom,
} from "./sankey-diagram-utils"
import type { SankeyDiagramInput, SankeyValue } from "./sankey-diagram.schema"

export type SankeyDiagramProps = Partial<Omit<SankeyDiagramInput, "value" | "data">> & {
  /** Fields may be partial while the tool call streams. */
  value?: Partial<SankeyValue>
  /** Flows arrive progressively while streaming. */
  data?: Record<string, string | number>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type Hover = { x: number; y: number; title: string; rows: [string, string][] }
type Focus = { node: number } | { link: number } | null

// Shared defaults: a fresh `{}` or `[]` every render would defeat the memos.
const NO_VALUE: Partial<SankeyValue> = {}
const NO_ROWS: Record<string, string | number>[] = []

/** One strong colour for nodes and bands: deep in light mode, pale in dark (or the site's tone). */
const STRONG = "[--pc:var(--chart-5)] dark:[--pc:var(--chart-1)]"
const NODE_W = 10
/** Room for a two-line label (name, then amount). */
const LABEL_GAP = 32
/** Rough width of a 13px label character, for reserving label room. */
const CHAR_W = 7.2

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

const share = (part: number, whole: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    whole > 0 ? part / whole : 0,
  )

export function SankeyDiagram({
  title,
  description,
  source: sourceKey,
  target: targetKey,
  value = NO_VALUE,
  highlight,
  data = NO_ROWS,
  summary,
  status: lifecycle = "ready",
  className,
}: SankeyDiagramProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const titleId = React.useId()
  const [frameRef, width] = useWidth<HTMLDivElement>(560)
  const [hover, setHover] = React.useState<Hover | null>(null)
  const [focus, setFocus] = React.useState<Focus>(null)

  const valueKey = value.key
  const flows = React.useMemo<FlowInput[]>(() => {
    if (!sourceKey || !targetKey || !valueKey) return []
    return data.flatMap((row) => {
      const s = row?.[sourceKey]
      const t = row?.[targetKey]
      const v = toNumber(row?.[valueKey])
      return s === undefined || t === undefined || v === null
        ? []
        : [{ source: String(s), target: String(t), value: v }]
    })
  }, [data, sourceKey, targetKey, valueKey])

  const fmt = (v: number) => formatAmount(v, value, "full", locale)
  const short = (v: number) => formatAmount(v, value, "compact", locale)

  // A first pass to learn the columns, then room for the outer labels.
  const draft = React.useMemo(() => layoutSankey(flows, 100, 100), [flows])
  const labelRoom = (column: number) =>
    Math.min(
      width * 0.3,
      8 +
        CHAR_W *
          Math.max(
            0,
            ...draft.nodes
              .filter((n) => n.column === column)
              .map((n) => Math.max(n.name.length, short(n.value).length)),
          ),
    )
  const padL = draft.columns > 1 ? labelRoom(0) : 0
  const padR = draft.columns > 1 ? labelRoom(draft.columns - 1) : 0
  const tallest = Math.max(
    1,
    ...Array.from({ length: draft.columns }, (_, c) => draft.nodes.filter((n) => n.column === c).length),
  )
  const height = Math.min(520, Math.max(220, tallest * (LABEL_GAP + 8)))
  const plotW = Math.max(80, width - padL - padR)

  const layout = React.useMemo(
    () => layoutSankey(flows, plotW, height - 8),
    [flows, plotW, height],
  )
  const { nodes, links } = layout
  const stageGap = layout.columns > 1 ? plotW / (layout.columns - 1) : plotW
  // Label centres per stage, spread so two-line labels never overlap.
  const labelY = React.useMemo(() => {
    const y = new Map<number, number>()
    for (let c = 0; c < layout.columns; c++) {
      const col = nodes
        .map((n, i) => ({ i, cy: (n.y0 + n.y1) / 2 }))
        .filter(({ i }) => nodes[i].column === c)
        .sort((a, b) => a.cy - b.cy)
      const spread = spreadLabels(
        col.map((d) => d.cy),
        LABEL_GAP,
        LABEL_GAP / 2,
        height - 8 - LABEL_GAP / 2,
      )
      col.forEach((d, k) => {
        y.set(d.i, spread[k])
      })
    }
    return y
  }, [nodes, layout.columns, height])
  const loops = layout.dropped.filter((f) => f.value > 0 && f.source !== f.target).length

  // What's lit: the hovered link, the hovered node's whole path, or the highlight's.
  const highlightIndex = highlight ? nodes.findIndex((n) => n.name === highlight) : -1
  const lit = React.useMemo(() => {
    if (focus && "link" in focus) return { nodes: new Set<number>(), links: new Set([focus.link]) }
    const start = focus && "node" in focus ? focus.node : highlightIndex
    return start >= 0 ? traceFrom(start, links) : null
  }, [focus, highlightIndex, links])

  const total = nodes.filter((n) => n.in === 0).reduce((a, n) => a + n.out, 0)
  const canDraw = links.length > 0

  const show = (e: React.PointerEvent, next: Focus, title: string, rows: [string, string][]) => {
    const frame = frameRef.current?.getBoundingClientRect()
    if (!frame) return
    setFocus(next)
    setHover({ x: e.clientX - frame.left, y: e.clientY - frame.top, title, rows })
  }
  const hide = () => {
    setFocus(null)
    setHover(null)
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="sankey-diagram"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Sankey diagram"}
        className={cn(STRONG, className)}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {description && <SurfaceDescription>{description}</SurfaceDescription>}
        </SurfaceHeader>

        {canDraw && total > 0 && (
          <dl className={cn("flex flex-wrap gap-x-10 gap-y-3 border-t border-border py-3", surfaceInset)}>
            <div className="flex flex-col gap-0.5">
              <dt className={genuiType.label}>{value.label ?? "Total"}</dt>
              <dd className={genuiType.stat}>{fmt(total)}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className={genuiType.label}>Stages</dt>
              <dd className={genuiType.stat}>{layout.columns}</dd>
            </div>
          </dl>
        )}

        <div className={cn("border-t border-border py-3", surfaceInset)}>
          <div ref={frameRef} className="relative">
            {canDraw ? (
              <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={genuiMotion.fade}>
                {/* The SVG is visual only; the table below carries the flows. */}
                <svg aria-hidden width={width} height={height} className="block overflow-visible">
                  <g transform={`translate(${padL} 4)`}>
                    {links.map((l, i) => {
                      const s = nodes[l.source]
                      const t = nodes[l.target]
                      const on = lit ? lit.links.has(i) : true
                      return (
                        <path
                          // biome-ignore lint/suspicious/noArrayIndexKey: links are positions
                          key={i}
                          d={bandPath(s.x1, l.sy, t.x0, l.ty)}
                          fill="none"
                          stroke="var(--pc)"
                          strokeWidth={l.width}
                          strokeOpacity={lit ? (on ? 0.55 : 0.07) : 0.28}
                          className="transition-[stroke-opacity] duration-150"
                          onPointerMove={(e) =>
                            show(e, { link: i }, `${s.name} → ${t.name}`, [
                              [value.label ?? "Amount", fmt(l.value)],
                              [`Share of ${s.name}`, share(l.value, s.out, locale)],
                            ])
                          }
                          onPointerLeave={hide}
                        />
                      )
                    })}
                    {nodes.map((n, i) => {
                      const on = lit ? lit.nodes.has(i) || (focus !== null && "link" in focus && (links[focus.link].source === i || links[focus.link].target === i)) : true
                      // Labels sit outside the first stage (left of it) and right
                      // of every other node, so outer labels never cover bands.
                      const first = n.column === 0 && layout.columns > 1
                      const x = first ? n.x0 - 8 : n.x1 + 8
                      const anchor = first ? "end" : "start"
                      const cy = labelY.get(i) ?? (n.y0 + n.y1) / 2
                      // A middle stage's label only gets the room up to the next
                      // stage: shortened to fit, or left to the hover card.
                      const middle = !first && n.column < layout.columns - 1
                      const room = middle ? Math.floor((stageGap - NODE_W - 16) / CHAR_W) : Number.POSITIVE_INFINITY
                      // Under 6 characters of room, a stage's middle labels all go
                      // (rather than some fitting and some not).
                      const name = room < 6 ? "" : n.name.length <= room ? n.name : `${n.name.slice(0, room - 1)}…`
                      return (
                        <g
                          key={n.name}
                          className={cn("transition-opacity duration-150", !on && "opacity-30")}
                          onPointerMove={(e) =>
                            show(e, { node: i }, n.name, [
                              ...(n.in > 0 ? ([["In", fmt(n.in)]] as [string, string][]) : []),
                              ...(n.out > 0 ? ([["Out", fmt(n.out)]] as [string, string][]) : []),
                              ...(total > 0 ? ([["Share of total", share(n.value, total, locale)]] as [string, string][]) : []),
                            ])
                          }
                          onPointerLeave={hide}
                        >
                          <rect
                            x={n.x0}
                            y={n.y0}
                            width={NODE_W}
                            height={Math.max(2, n.y1 - n.y0)}
                            rx={2}
                            fill="var(--pc)"
                          />
                          <text
                            x={x}
                            y={cy - 7}
                            textAnchor={anchor}
                            dominantBaseline="central"
                            fontSize={13}
                            fontWeight={i === highlightIndex ? 600 : 500}
                            fill="var(--foreground)"
                            stroke="var(--card)"
                            strokeWidth={3}
                            paintOrder="stroke"
                          >
                            {name}
                          </text>
                          <text
                            x={x}
                            y={cy + 9}
                            textAnchor={anchor}
                            dominantBaseline="central"
                            fontSize={12}
                            fill="var(--muted-foreground)"
                            stroke="var(--card)"
                            strokeWidth={3}
                            paintOrder="stroke"
                          >
                            {name ? short(n.value) : ""}
                          </text>
                        </g>
                      )
                    })}
                  </g>
                </svg>
              </motion.div>
            ) : (
              <Skeleton className="h-56 w-full" />
            )}

            {hover && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-10 w-max max-w-[16rem] rounded-lg border bg-popover px-3 py-2 text-[12px] leading-[1.55] text-popover-foreground shadow-lg dark:shadow-none"
                style={{
                  left: Math.min(Math.max(4, hover.x + 12), Math.max(4, width - 220)),
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
          {loops > 0 && (
            <p className={cn(genuiType.meta, "pt-2")}>
              {loops === 1 ? "1 flow loops back and isn't shown." : `${loops} flows loop back and aren't shown.`}
            </p>
          )}
        </div>

        {canDraw && (
          <table className="sr-only">
            <caption>{title ?? "Flows"}</caption>
            <thead>
              <tr>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">{value.label ?? "Amount"}</th>
                <th scope="col">Share of from</th>
              </tr>
            </thead>
            <tbody>
              {links.map((l, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: links are positions
                <tr key={i}>
                  <td>{nodes[l.source].name}</td>
                  <td>{nodes[l.target].name}</td>
                  <td>{fmt(l.value)}</td>
                  <td>{share(l.value, nodes[l.source].out, locale)}</td>
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
