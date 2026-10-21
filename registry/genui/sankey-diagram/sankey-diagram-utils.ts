/* Pure helpers for the Sankey diagram, shared by the component and its tests. */

import { DEFAULT_LOCALE } from "@/components/genui/locale"
import type { SankeyValue } from "./sankey-diagram.schema"

/** Numbers, or numeric strings, become numbers; anything else is missing. */
export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** An amount in the value's format: compact for node labels, in full elsewhere. */
export function formatAmount(
  value: number,
  measure: Partial<Pick<SankeyValue, "format" | "currency" | "unit">> | undefined,
  style: "compact" | "full" = "full",
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(value)) return "No data"
  const compact: Intl.NumberFormatOptions =
    style === "compact"
      ? // The minimum too: engines disagree on it for compact currency (Node 22 "$6.0K", Chrome "$6K").
        { notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
      : {}
  if (measure?.format === "currency" && measure.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: measure.currency,
        maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
        ...compact,
      }).format(value)
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  if (measure?.format === "percent") {
    return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(
      value / 100,
    )
  }
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: 2, ...compact }).format(value)
  return measure?.unit && style === "full" ? `${text} ${measure.unit}` : text
}

export type FlowInput = { source: string; target: string; value: number }

export type SankeyNode = {
  name: string
  column: number
  /** Total flowing in and out; the node is as tall as the larger. */
  in: number
  out: number
  value: number
  x0: number
  x1: number
  y0: number
  y1: number
}

export type SankeyLink = {
  source: number
  target: number
  value: number
  /** Band thickness in px. */
  width: number
  /** Centre of the band where it leaves the source and reaches the target. */
  sy: number
  ty: number
}

export type SankeyLayout = {
  nodes: SankeyNode[]
  links: SankeyLink[]
  columns: number
  /** Flows left out because they would close a loop, or were empty or self-links. */
  dropped: FlowInput[]
}

/**
 * Merges duplicate flows, drops empty ones and self-links, and drops any flow
 * that would close a loop (a Sankey reads left to right, so it can't show
 * one). Flows are kept in first-seen order.
 */
export function cleanFlows(flows: readonly FlowInput[]): { kept: FlowInput[]; dropped: FlowInput[] } {
  const merged = new Map<string, FlowInput>()
  const dropped: FlowInput[] = []
  for (const f of flows) {
    if (!(f.value > 0) || f.source === f.target) {
      dropped.push(f)
      continue
    }
    const key = `${f.source}\u0000${f.target}`
    const prev = merged.get(key)
    if (prev) prev.value += f.value
    else merged.set(key, { ...f })
  }
  const kept: FlowInput[] = []
  const next = new Map<string, Set<string>>()
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>()
    const stack = [from]
    while (stack.length) {
      const n = stack.pop() as string
      if (n === to) return true
      if (seen.has(n)) continue
      seen.add(n)
      for (const m of next.get(n) ?? []) stack.push(m)
    }
    return false
  }
  for (const f of merged.values()) {
    // Adding source → target closes a loop when target already reaches source.
    if (reaches(f.target, f.source)) {
      dropped.push(f)
      continue
    }
    kept.push(f)
    if (!next.has(f.source)) next.set(f.source, new Set())
    next.get(f.source)?.add(f.target)
  }
  return { kept, dropped }
}

/**
 * Lays out a Sankey diagram in a `width` × `height` box. Columns come from
 * the longest path from a source; nodes with nothing flowing out sit in the
 * last column. Within a column, nodes are ordered by where their flows come
 * from and go to (a few sweeps of barycentre ordering) to cut crossings.
 */
export function layoutSankey(
  flows: readonly FlowInput[],
  width: number,
  height: number,
  { nodeWidth = 10, nodePad = 14 }: { nodeWidth?: number; nodePad?: number } = {},
): SankeyLayout {
  const { kept, dropped } = cleanFlows(flows)
  const names: string[] = []
  const index = new Map<string, number>()
  const add = (name: string) => {
    if (!index.has(name)) {
      index.set(name, names.length)
      names.push(name)
    }
    return index.get(name) as number
  }
  const links = kept.map((f) => ({ source: add(f.source), target: add(f.target), value: f.value }))
  const n = names.length
  if (n === 0) return { nodes: [], links: [], columns: 0, dropped }

  const ins = new Array<number>(n).fill(0)
  const outs = new Array<number>(n).fill(0)
  const outgoing: number[][] = names.map(() => [])
  const incoming: number[][] = names.map(() => [])
  links.forEach((l, i) => {
    outs[l.source] += l.value
    ins[l.target] += l.value
    outgoing[l.source].push(i)
    incoming[l.target].push(i)
  })

  // Longest path from any source, in topological order (the graph has no loops).
  const depth = new Array<number>(n).fill(0)
  const indegree = incoming.map((l) => l.length)
  const queue = names.map((_, i) => i).filter((i) => indegree[i] === 0)
  while (queue.length) {
    const u = queue.shift() as number
    for (const li of outgoing[u]) {
      const v = links[li].target
      depth[v] = Math.max(depth[v], depth[u] + 1)
      if (--indegree[v] === 0) queue.push(v)
    }
  }
  const last = Math.max(...depth)
  const column = depth.map((d, i) => (outgoing[i].length === 0 ? last : d))
  const columns = last + 1

  const value = names.map((_, i) => Math.max(ins[i], outs[i]))
  const byColumn: number[][] = Array.from({ length: columns }, () => [])
  for (let i = 0; i < n; i++) byColumn[column[i]].push(i)

  // One vertical scale for every column, set by the fullest one.
  const ky = Math.min(
    ...byColumn.map((col) => {
      const total = col.reduce((a, i) => a + value[i], 0)
      return total > 0 ? (height - (col.length - 1) * nodePad) / total : Number.POSITIVE_INFINITY
    }),
  )
  const scale = Number.isFinite(ky) && ky > 0 ? ky : 1

  const y0 = new Array<number>(n).fill(0)
  const place = () => {
    for (const col of byColumn) {
      const used = col.reduce((a, i) => a + Math.max(1, value[i] * scale), 0) + (col.length - 1) * nodePad
      let y = (height - used) / 2
      for (const i of col) {
        y0[i] = y
        y += Math.max(1, value[i] * scale) + nodePad
      }
    }
  }
  const centre = (i: number) => y0[i] + Math.max(1, value[i] * scale) / 2
  const weighted = (i: number, ends: number[], other: (li: number) => number) => {
    let w = 0
    let s = 0
    for (const li of ends) {
      w += links[li].value
      s += centre(other(li)) * links[li].value
    }
    return w > 0 ? s / w : centre(i)
  }
  place()
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let c = 1; c < columns; c++) {
      const key = new Map(byColumn[c].map((i) => [i, weighted(i, incoming[i], (li) => links[li].source)]))
      byColumn[c].sort((a, b) => (key.get(a) ?? 0) - (key.get(b) ?? 0))
    }
    place()
    for (let c = columns - 2; c >= 0; c--) {
      const key = new Map(byColumn[c].map((i) => [i, weighted(i, outgoing[i], (li) => links[li].target)]))
      byColumn[c].sort((a, b) => (key.get(a) ?? 0) - (key.get(b) ?? 0))
    }
    place()
  }

  const step = columns > 1 ? (width - nodeWidth) / (columns - 1) : 0
  const nodes: SankeyNode[] = names.map((name, i) => {
    const x0 = columns > 1 ? column[i] * step : (width - nodeWidth) / 2
    return {
      name,
      column: column[i],
      in: ins[i],
      out: outs[i],
      value: value[i],
      x0,
      x1: x0 + nodeWidth,
      y0: y0[i],
      y1: y0[i] + Math.max(1, value[i] * scale),
    }
  })

  // Bands stack down each node's side in the order of the node at the far end.
  const sy = new Array<number>(links.length).fill(0)
  const ty = new Array<number>(links.length).fill(0)
  for (let i = 0; i < n; i++) {
    let y = nodes[i].y0
    for (const li of [...outgoing[i]].sort((a, b) => nodes[links[a].target].y0 - nodes[links[b].target].y0)) {
      const w = links[li].value * scale
      sy[li] = y + w / 2
      y += w
    }
    y = nodes[i].y0
    for (const li of [...incoming[i]].sort((a, b) => nodes[links[a].source].y0 - nodes[links[b].source].y0)) {
      const w = links[li].value * scale
      ty[li] = y + w / 2
      y += w
    }
  }

  return {
    nodes,
    links: links.map((l, i) => ({ ...l, width: Math.max(1, l.value * scale), sy: sy[i], ty: ty[i] })),
    columns,
    dropped,
  }
}

/** A horizontal S-curve from (x0, y0) to (x1, y1), drawn as a stroke of the band's width. */
export function bandPath(x0: number, y0: number, x1: number, y1: number): string {
  const mx = (x0 + x1) / 2
  return `M${x0} ${y0}C${mx} ${y0} ${mx} ${y1} ${x1} ${y1}`
}

/** Every node and link connected to `start`, upstream and downstream. */
export function traceFrom(
  start: number,
  links: readonly { source: number; target: number }[],
): { nodes: Set<number>; links: Set<number> } {
  const nodes = new Set([start])
  const used = new Set<number>()
  const walk = (dir: "down" | "up") => {
    const stack = [start]
    const seen = new Set<number>()
    while (stack.length) {
      const u = stack.pop() as number
      if (seen.has(u)) continue
      seen.add(u)
      links.forEach((l, i) => {
        const [from, to] = dir === "down" ? [l.source, l.target] : [l.target, l.source]
        if (from === u) {
          used.add(i)
          nodes.add(to)
          stack.push(to)
        }
      })
    }
  }
  walk("down")
  walk("up")
  return { nodes, links: used }
}

/**
 * Label centres for one stage, moved apart so neighbours are at least `gap`
 * px apart and all stay within [lo, hi]. Each label stays as close to its
 * node as it can: labels are pushed down where they collide, then back up
 * from the bottom edge. Input order is top to bottom.
 */
export function spreadLabels(ys: readonly number[], gap: number, lo: number, hi: number): number[] {
  const out = [...ys]
  for (let i = 0; i < out.length; i++) {
    out[i] = Math.max(out[i], lo, i > 0 ? out[i - 1] + gap : lo)
  }
  for (let i = out.length - 1; i >= 0; i--) {
    out[i] = Math.min(out[i], hi, i < out.length - 1 ? out[i + 1] - gap : hi)
  }
  return out
}
