/**
 * Relationship Explorer: pure graph helpers. No React, no DOM, no imports, so
 * every layout is deterministic and testable in Node.
 *
 * Coordinates: layouts return node centres in world units (pixels at zoom 1).
 * A view `{ x, y, k }` maps world to screen as `screen = world * k + (x, y)`.
 */

export type EdgeKind =
  | "depends-on"
  | "reports-to"
  | "causes"
  | "related"
  | "blocks"
export type LayoutKind = "tree" | "flow" | "network"
export type Direction = "down" | "right"

export type Point = { x: number; y: number }
/** Top-left corner plus size. */
export type Box = { x: number; y: number; w: number; h: number }

// ---------------------------------------------------------------------------
// Graph building and validation

export type RawNode = { id?: string; label?: string }
export type RawEdge = {
  from?: string
  to?: string
  label?: string
  kind?: EdgeKind
  strength?: number
}

export type ReadyNode<N extends RawNode> = N & { id: string; label: string }

export type GraphEdge = {
  /** Stable while streaming: edges are only ever appended. */
  key: string
  from: string
  to: string
  label?: string
  kind?: EdgeKind
  strength?: number
}

export type GraphIssues = {
  /** Ids that edges point to but no node has. */
  unknownIds: string[]
  /** Node ids that appeared more than once (the first wins). */
  duplicateIds: string[]
  /** Edges from a node to itself (dropped). */
  selfLoops: number
  /** Valid nodes past the limit (dropped). */
  truncated: number
}

export type Graph<N extends RawNode> = {
  nodes: ReadyNode<N>[]
  byId: Map<string, ReadyNode<N>>
  edges: GraphEdge[]
  outgoing: Map<string, GraphEdge[]>
  incoming: Map<string, GraphEdge[]>
  issues: GraphIssues
}

export function buildGraph<N extends RawNode>(
  rawNodes: readonly N[],
  rawEdges: readonly RawEdge[],
  { maxNodes = 60 }: { maxNodes?: number } = {},
): Graph<N> {
  const nodes: ReadyNode<N>[] = []
  const byId = new Map<string, ReadyNode<N>>()
  const duplicateIds = new Set<string>()
  const dropped = new Set<string>()
  let truncated = 0

  for (const n of rawNodes) {
    if (!n || typeof n.id !== "string" || n.id === "") continue
    if (typeof n.label !== "string") continue
    if (byId.has(n.id)) {
      duplicateIds.add(n.id)
      continue
    }
    if (nodes.length >= maxNodes) {
      if (!dropped.has(n.id)) truncated++
      dropped.add(n.id)
      continue
    }
    const ready = n as ReadyNode<N>
    nodes.push(ready)
    byId.set(n.id, ready)
  }

  const edges: GraphEdge[] = []
  const unknownIds = new Set<string>()
  const seen = new Set<string>()
  const outgoing = new Map<string, GraphEdge[]>()
  const incoming = new Map<string, GraphEdge[]>()
  for (const n of nodes) {
    outgoing.set(n.id, [])
    incoming.set(n.id, [])
  }
  let selfLoops = 0

  rawEdges.forEach((e, index) => {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") return
    let unknown = false
    for (const id of [e.from, e.to]) {
      // Nodes dropped by the limit aren't "unknown"; they were truncated.
      if (!byId.has(id) && !dropped.has(id)) {
        unknownIds.add(id)
        unknown = true
      }
    }
    if (unknown || !byId.has(e.from) || !byId.has(e.to)) return
    if (e.from === e.to) {
      selfLoops++
      return
    }
    const dedupe = `${e.from}\u0000${e.to}\u0000${e.kind ?? ""}`
    if (seen.has(dedupe)) return
    seen.add(dedupe)
    const edge: GraphEdge = {
      key: `e${index}`,
      from: e.from,
      to: e.to,
      label: typeof e.label === "string" && e.label ? e.label : undefined,
      kind: e.kind,
      strength:
        typeof e.strength === "number" && Number.isFinite(e.strength)
          ? Math.min(1, Math.max(0, e.strength))
          : undefined,
    }
    edges.push(edge)
    outgoing.get(e.from)?.push(edge)
    incoming.get(e.to)?.push(edge)
  })

  return {
    nodes,
    byId,
    edges,
    outgoing,
    incoming,
    issues: {
      unknownIds: [...unknownIds],
      duplicateIds: [...duplicateIds],
      selfLoops,
      truncated,
    },
  }
}

/** The node itself plus every node one edge away, in either direction. */
export function neighborSet(
  graph: Pick<Graph<RawNode>, "outgoing" | "incoming">,
  id: string,
): Set<string> {
  const set = new Set<string>([id])
  for (const e of graph.outgoing.get(id) ?? []) set.add(e.to)
  for (const e of graph.incoming.get(id) ?? []) set.add(e.from)
  return set
}

// ---------------------------------------------------------------------------
// Cycles

type Arc = { from: string; to: string }

/**
 * Edges that close a cycle in a depth-first search (back edges), by index.
 * The search starts from `startIds`, then nodes nothing points to, then the
 * rest, so the result is deterministic. Reversing these makes the graph a DAG.
 */
export function findBackEdges(
  nodeIds: readonly string[],
  edges: readonly Arc[],
  startIds: readonly string[] = [],
): Set<number> {
  const out = new Map<string, number[]>()
  const hasIncoming = new Set<string>()
  for (const id of nodeIds) out.set(id, [])
  edges.forEach((e, i) => {
    out.get(e.from)?.push(i)
    hasIncoming.add(e.to)
  })
  const state = new Map<string, 1 | 2>() // 1: on the stack, 2: done
  const back = new Set<number>()

  const visit = (root: string) => {
    if (state.has(root) || !out.has(root)) return
    // Iterative DFS: [node, index of the next outgoing edge].
    const stack: [string, number][] = [[root, 0]]
    state.set(root, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [id, next] = top
      const list = out.get(id) ?? []
      if (next >= list.length) {
        state.set(id, 2)
        stack.pop()
        continue
      }
      top[1] = next + 1
      const ei = list[next]
      const to = edges[ei].to
      const s = state.get(to)
      if (s === 1) back.add(ei)
      else if (s === undefined && out.has(to)) {
        state.set(to, 1)
        stack.push([to, 0])
      }
    }
  }

  for (const id of startIds) visit(id)
  for (const id of nodeIds) if (!hasIncoming.has(id)) visit(id)
  for (const id of nodeIds) visit(id)
  return back
}

export function hasCycle(
  nodeIds: readonly string[],
  edges: readonly Arc[],
): boolean {
  return findBackEdges(nodeIds, edges).size > 0
}

// ---------------------------------------------------------------------------
// Tree

export type TreeStructure = {
  /** Tree roots in display order: `rootId` first, then parentless nodes. */
  roots: string[]
  children: Map<string, string[]>
  parent: Map<string, string>
  depth: Map<string, number>
  /** Keys of the edges that form the tree; the rest are cross links. */
  treeEdges: Set<string>
}

/**
 * `from` is the parent, except for "reports-to", where `from` reports to `to`.
 */
export function parentChild(edge: Pick<GraphEdge, "from" | "to" | "kind">) {
  return edge.kind === "reports-to"
    ? { parent: edge.to, child: edge.from }
    : { parent: edge.from, child: edge.to }
}

/**
 * A spanning forest by breadth-first search: each node keeps the first parent
 * that reaches it. Nodes in a cycle with no way in become extra roots.
 */
export function buildTree(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  rootId?: string,
): TreeStructure {
  const ids = new Set(nodeIds)
  const candidates = new Map<string, { child: string; key: string }[]>()
  const hasParent = new Set<string>()
  for (const e of edges) {
    const { parent, child } = parentChild(e)
    if (!ids.has(parent) || !ids.has(child)) continue
    const list = candidates.get(parent) ?? []
    list.push({ child, key: e.key })
    candidates.set(parent, list)
    hasParent.add(child)
  }

  const roots: string[] = []
  const children = new Map<string, string[]>()
  const parent = new Map<string, string>()
  const depth = new Map<string, number>()
  const treeEdges = new Set<string>()

  const grow = (root: string) => {
    if (depth.has(root)) return
    roots.push(root)
    depth.set(root, 0)
    children.set(root, [])
    const queue = [root]
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i]
      for (const { child, key } of candidates.get(id) ?? []) {
        if (depth.has(child)) continue
        depth.set(child, (depth.get(id) ?? 0) + 1)
        parent.set(child, id)
        children.set(child, [])
        children.get(id)?.push(child)
        treeEdges.add(key)
        queue.push(child)
      }
    }
  }

  if (rootId && ids.has(rootId)) grow(rootId)
  for (const id of nodeIds) if (!hasParent.has(id)) grow(id)
  for (const id of nodeIds) grow(id)
  return { roots, children, parent, depth, treeEdges }
}

/** Number of nodes below `id`. */
export function descendantCount(tree: TreeStructure, id: string): number {
  let count = 0
  const stack = [...(tree.children.get(id) ?? [])]
  while (stack.length) {
    const next = stack.pop() as string
    count++
    stack.push(...(tree.children.get(next) ?? []))
  }
  return count
}

export function ancestorsOf(tree: TreeStructure, id: string): string[] {
  const out: string[] = []
  let p = tree.parent.get(id)
  while (p !== undefined && !out.includes(p)) {
    out.push(p)
    p = tree.parent.get(p)
  }
  return out
}

/**
 * Nodes collapsed by default: everything with children at `levels - 1` or
 * deeper, so `levels` levels show. Ancestors of `keepOpen` stay expanded.
 */
export function defaultCollapsed(
  tree: TreeStructure,
  levels: number,
  keepOpen?: string,
): Set<string> {
  const open = new Set(keepOpen ? ancestorsOf(tree, keepOpen) : [])
  const out = new Set<string>()
  for (const [id, kids] of tree.children) {
    if (kids.length && (tree.depth.get(id) ?? 0) >= levels - 1 && !open.has(id))
      out.add(id)
  }
  return out
}

export type OutlineItem = {
  id: string
  /** 1-based, for aria-level. */
  level: number
  setSize: number
  posInSet: number
  parentId?: string
  hasChildren: boolean
  expanded: boolean
  /** Descendants hidden by collapsing (0 when expanded). */
  hiddenCount: number
}

/** The visible tree in reading order (pre-order), for the accessible tree. */
export function treeOutline(
  tree: TreeStructure,
  collapsed: ReadonlySet<string>,
): OutlineItem[] {
  const out: OutlineItem[] = []
  const walk = (ids: string[], level: number, parentId?: string) => {
    ids.forEach((id, i) => {
      const kids = tree.children.get(id) ?? []
      const expanded = kids.length > 0 && !collapsed.has(id)
      out.push({
        id,
        level,
        setSize: ids.length,
        posInSet: i + 1,
        parentId,
        hasChildren: kids.length > 0,
        expanded,
        hiddenCount: kids.length && !expanded ? descendantCount(tree, id) : 0,
      })
      if (expanded) walk(kids, level + 1, id)
    })
  }
  walk(tree.roots, 1)
  return out
}

/**
 * Tidy tree, Reingold–Tilford style (simplified): each subtree is laid out on
 * its own, siblings are pushed apart until their contours clear by `gap` at
 * every depth, and parents are centred over their first and last child.
 * Returns the breadth coordinate (centre) and depth (level) of each visible
 * node. Separate trees sit side by side, `rootGap` apart.
 */
export function tidyTree(
  tree: TreeStructure,
  collapsed: ReadonlySet<string>,
  {
    size,
    gap,
    rootGap = gap * 2,
  }: { size: number; gap: number; rootGap?: number },
): Map<string, { b: number; level: number }> {
  type Sub = {
    id: string
    kids: Sub[]
    offset: number
    left: number[]
    right: number[]
  }

  const merge = (subs: Sub[], spacing: number) => {
    const offsets = [0]
    const left = [...subs[0].left]
    const right = [...subs[0].right]
    for (let i = 1; i < subs.length; i++) {
      const s = subs[i]
      let shift = Number.NEGATIVE_INFINITY
      const shared = Math.min(right.length, s.left.length)
      for (let d = 0; d < shared; d++) {
        shift = Math.max(shift, right[d] - s.left[d] + spacing)
      }
      offsets.push(shift)
      for (let d = 0; d < s.right.length; d++) {
        if (d < right.length) right[d] = s.right[d] + shift
        else right.push(s.right[d] + shift)
        if (d >= left.length) left.push(s.left[d] + shift)
      }
    }
    const centre = (offsets[0] + offsets[offsets.length - 1]) / 2
    subs.forEach((s, i) => {
      s.offset = offsets[i] - centre
    })
    return {
      left: left.map((v) => v - centre),
      right: right.map((v) => v - centre),
    }
  }

  const layout = (id: string, guard: Set<string>): Sub => {
    guard.add(id)
    const kids = collapsed.has(id)
      ? []
      : (tree.children.get(id) ?? [])
          .filter((k) => !guard.has(k))
          .map((k) => layout(k, guard))
    if (kids.length === 0) {
      return { id, kids, offset: 0, left: [-size / 2], right: [size / 2] }
    }
    const { left, right } = merge(kids, gap)
    return {
      id,
      kids,
      offset: 0,
      left: [-size / 2, ...left],
      right: [size / 2, ...right],
    }
  }

  const out = new Map<string, { b: number; level: number }>()
  if (tree.roots.length === 0) return out
  const guard = new Set<string>()
  const roots = tree.roots.map((r) => layout(r, guard))
  merge(roots, rootGap)
  const place = (s: Sub, b: number, level: number) => {
    out.set(s.id, { b, level })
    for (const k of s.kids) place(k, b + k.offset, level + 1)
  }
  for (const r of roots) place(r, r.offset, 0)
  // Shift so the left-most edge sits at 0.
  let min = Number.POSITIVE_INFINITY
  for (const p of out.values()) min = Math.min(min, p.b - size / 2)
  for (const p of out.values()) p.b -= min
  return out
}

// ---------------------------------------------------------------------------
// Layered (Sugiyama-lite) layout

export type Segment = { from: string; to: string }

/** Longest path from the sources: each node sits one layer after its deepest parent. */
export function assignLayers(
  nodeIds: readonly string[],
  dagEdges: readonly Arc[],
): Map<string, number> {
  const indeg = new Map<string, number>()
  const out = new Map<string, string[]>()
  for (const id of nodeIds) {
    indeg.set(id, 0)
    out.set(id, [])
  }
  for (const e of dagEdges) {
    if (!out.has(e.from) || !indeg.has(e.to)) continue
    out.get(e.from)?.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }
  const layer = new Map<string, number>()
  const queue = nodeIds.filter((id) => indeg.get(id) === 0)
  for (const id of queue) layer.set(id, 0)
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i]
    for (const to of out.get(id) ?? []) {
      layer.set(to, Math.max(layer.get(to) ?? 0, (layer.get(id) ?? 0) + 1))
      const left = (indeg.get(to) ?? 0) - 1
      indeg.set(to, left)
      if (left === 0) queue.push(to)
    }
  }
  // Only reachable if the input still had a cycle; keep such nodes visible.
  for (const id of nodeIds) if (!layer.has(id)) layer.set(id, 0)
  return layer
}

/** Edge crossings between adjacent layers, for the given order. */
export function countCrossings(
  layers: readonly (readonly string[])[],
  segments: readonly Segment[],
): number {
  const pos = new Map<string, number>()
  const layerOf = new Map<string, number>()
  layers.forEach((l, li) => {
    l.forEach((id, i) => {
      pos.set(id, i)
      layerOf.set(id, li)
    })
  })
  const byLayer = new Map<number, [number, number][]>()
  for (const s of segments) {
    const lf = layerOf.get(s.from)
    const lt = layerOf.get(s.to)
    if (lf === undefined || lt === undefined || lt !== lf + 1) continue
    const list = byLayer.get(lf) ?? []
    list.push([pos.get(s.from) ?? 0, pos.get(s.to) ?? 0])
    byLayer.set(lf, list)
  }
  let crossings = 0
  for (const list of byLayer.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [a1, b1] = list[i]
        const [a2, b2] = list[j]
        if ((a1 - a2) * (b1 - b2) < 0) crossings++
      }
    }
  }
  return crossings
}

/**
 * Barycenter ordering: alternating down and up sweeps reorder each layer by
 * the mean position of its neighbours in the previous layer. Keeps the best
 * order seen, so the result never has more crossings than the input.
 */
export function orderLayers(
  layers: readonly (readonly string[])[],
  segments: readonly Segment[],
  sweeps = 4,
): string[][] {
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const s of segments) {
    preds.set(s.to, [...(preds.get(s.to) ?? []), s.from])
    succs.set(s.from, [...(succs.get(s.from) ?? []), s.to])
  }
  let current = layers.map((l) => [...l])
  let best = current.map((l) => [...l])
  let bestCount = countCrossings(best, segments)

  const reorder = (
    layer: string[],
    ref: string[],
    nbs: Map<string, string[]>,
  ) => {
    const refPos = new Map(ref.map((id, i) => [id, i]))
    const keyed = layer.map((id, i) => {
      const list = (nbs.get(id) ?? []).filter((n) => refPos.has(n))
      const bary = list.length
        ? list.reduce((sum, n) => sum + (refPos.get(n) ?? 0), 0) / list.length
        : // No neighbours there: keep the current slot, scaled to the ref layer.
          (i * Math.max(ref.length - 1, 0)) / Math.max(layer.length - 1, 1)
      return { id, bary, i }
    })
    keyed.sort((a, b) => a.bary - b.bary || a.i - b.i)
    return keyed.map((k) => k.id)
  }

  for (let sweep = 0; sweep < sweeps && bestCount > 0; sweep++) {
    current = current.map((l) => [...l])
    if (sweep % 2 === 0) {
      for (let i = 1; i < current.length; i++)
        current[i] = reorder(current[i], current[i - 1], preds)
    } else {
      for (let i = current.length - 2; i >= 0; i--)
        current[i] = reorder(current[i], current[i + 1], succs)
    }
    const count = countCrossings(current, segments)
    if (count < bestCount) {
      bestCount = count
      best = current.map((l) => [...l])
    }
  }
  return best
}

/**
 * Breadth positions within layers: each layer is pulled toward the mean of
 * its neighbours, then packed in order with at least `gap` between items.
 * Forward and backward packing are averaged, which keeps the order and the
 * spacing (both satisfy the same linear constraints).
 */
export function assignBreadth(
  layers: readonly (readonly string[])[],
  segments: readonly Segment[],
  sizeOf: (id: string) => number,
  gap: number,
  iterations = 8,
): Map<string, number> {
  const pos = new Map<string, number>()
  for (const layer of layers) {
    let cursor = 0
    const placed = layer.map((id) => {
      const p = cursor + sizeOf(id) / 2
      cursor += sizeOf(id) + gap
      return p
    })
    const centre = (cursor - gap) / 2
    layer.forEach((id, i) => {
      pos.set(id, placed[i] - centre)
    })
  }
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const s of segments) {
    preds.set(s.to, [...(preds.get(s.to) ?? []), s.from])
    succs.set(s.from, [...(succs.get(s.from) ?? []), s.to])
  }
  const mean = (ids: string[]) =>
    ids.reduce((sum, id) => sum + (pos.get(id) ?? 0), 0) / ids.length

  const pack = (layer: readonly string[], desired: number[]) => {
    const n = layer.length
    const sep = (i: number) =>
      (sizeOf(layer[i]) + sizeOf(layer[i + 1])) / 2 + gap
    const f = [...desired]
    for (let i = 1; i < n; i++)
      f[i] = Math.max(desired[i], f[i - 1] + sep(i - 1))
    const b = [...desired]
    for (let i = n - 2; i >= 0; i--)
      b[i] = Math.min(desired[i], b[i + 1] - sep(i))
    layer.forEach((id, i) => {
      pos.set(id, (f[i] + b[i]) / 2)
    })
  }

  for (let it = 0; it < iterations; it++) {
    const mode = it === iterations - 1 ? "both" : it % 2 === 0 ? "down" : "up"
    const order =
      mode === "up"
        ? layers.map((_, i) => layers.length - 1 - i)
        : layers.map((_, i) => i)
    for (const li of order) {
      const layer = layers[li]
      const desired = layer.map((id) => {
        const nbs =
          mode === "down"
            ? (preds.get(id) ?? [])
            : mode === "up"
              ? (succs.get(id) ?? [])
              : [...(preds.get(id) ?? []), ...(succs.get(id) ?? [])]
        return nbs.length ? mean(nbs) : (pos.get(id) ?? 0)
      })
      pack(layer, desired)
    }
  }
  return pos
}

export type LayeredResult = {
  /** Layers in order, including dummy ids for long edges. */
  layers: string[][]
  layerOf: Map<string, number>
  /** Breadth coordinate (centre) of every node and dummy. */
  breadth: Map<string, number>
  /** Per edge key: the chain of ids from `from` to `to` (dummies between). */
  chains: Map<string, string[]>
  /** Keys of edges reversed to break cycles. */
  reversed: Set<string>
  crossings: number
  /** Crossings before barycenter ordering, for comparison. */
  initialCrossings: number
}

export const isDummy = (id: string) => id.startsWith("\u0000")

export function layeredLayout(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  {
    startIds = [],
    sweeps = 4,
    size,
    dummySize = 8,
    gap,
  }: {
    startIds?: readonly string[]
    sweeps?: number
    size: number
    dummySize?: number
    gap: number
  },
): LayeredResult {
  const back = findBackEdges(nodeIds, edges, startIds)
  const reversed = new Set<string>()
  const dag = edges.map((e, i) => {
    if (!back.has(i)) return { key: e.key, from: e.from, to: e.to }
    reversed.add(e.key)
    return { key: e.key, from: e.to, to: e.from }
  })
  const layerOf = assignLayers(nodeIds, dag)

  // Long edges become chains through one dummy per skipped layer.
  const chains = new Map<string, string[]>()
  const segments: Segment[] = []
  for (const e of dag) {
    const lf = layerOf.get(e.from) ?? 0
    const lt = layerOf.get(e.to) ?? 0
    const chain = [e.from]
    for (let l = lf + 1; l < lt; l++) {
      const d = `\u0000${e.key}:${l}`
      layerOf.set(d, l)
      chain.push(d)
    }
    chain.push(e.to)
    for (let i = 0; i < chain.length - 1; i++)
      segments.push({ from: chain[i], to: chain[i + 1] })
    chains.set(e.key, reversed.has(e.key) ? [...chain].reverse() : chain)
  }

  // Initial order: sources in input order, then each layer by its first parent.
  const count = Math.max(0, ...[...layerOf.values()].map((l) => l + 1))
  const initial: string[][] = Array.from({ length: count }, () => [])
  const inputIndex = new Map(nodeIds.map((id, i) => [id, i]))
  const allIds = [...layerOf.keys()]
  const firstParent = new Map<string, number>()
  for (let l = 0; l < count; l++) {
    const ids = allIds.filter((id) => layerOf.get(id) === l)
    ids.sort((a, b) => {
      const pa = firstParent.get(a) ?? Number.POSITIVE_INFINITY
      const pb = firstParent.get(b) ?? Number.POSITIVE_INFINITY
      if (pa !== pb) return pa - pb
      return (inputIndex.get(a) ?? 1e9) - (inputIndex.get(b) ?? 1e9)
    })
    initial[l] = ids
    ids.forEach((id, i) => {
      for (const s of segments) {
        if (s.from === id && !firstParent.has(s.to)) firstParent.set(s.to, i)
      }
    })
  }

  const initialCrossings = countCrossings(initial, segments)
  const layers = orderLayers(initial, segments, sweeps)
  const breadth = assignBreadth(
    layers,
    segments,
    (id) => (isDummy(id) ? dummySize : size),
    gap,
  )
  let min = Number.POSITIVE_INFINITY
  for (const [id, b] of breadth) {
    min = Math.min(min, b - (isDummy(id) ? dummySize : size) / 2)
  }
  for (const [id, b] of breadth) breadth.set(id, b - min)

  return {
    layers,
    layerOf,
    breadth,
    chains,
    reversed,
    crossings: countCrossings(layers, segments),
    initialCrossings,
  }
}

// ---------------------------------------------------------------------------
// Force layout

/** Small, fast, seeded PRNG (mulberry32). Returns numbers in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a, for a seed that depends only on the data. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Fruchterman–Reingold with a fixed number of iterations and a seeded start,
 * so the same graph always lands in the same place. Positions are in units of
 * the ideal edge length; see `fitNetwork` to scale them to pixels.
 */
export function forceLayout(
  nodeIds: readonly string[],
  edges: readonly (Arc & { strength?: number })[],
  { iterations = 300, seed }: { iterations?: number; seed?: number } = {},
): Map<string, Point> {
  const n = nodeIds.length
  const out = new Map<string, Point>()
  if (n === 0) return out
  const rand = mulberry32(seed ?? hashString(nodeIds.join("|")))
  const index = new Map(nodeIds.map((id, i) => [id, i]))
  const xs = new Float64Array(n)
  const ys = new Float64Array(n)
  const radius = Math.sqrt(n) * 0.6
  for (let i = 0; i < n; i++) {
    const angle = (2 * Math.PI * i) / n + (rand() - 0.5) * 0.5
    const r = radius * (0.7 + rand() * 0.6)
    xs[i] = Math.cos(angle) * r
    ys[i] = Math.sin(angle) * r
  }
  const links = edges.flatMap((e) => {
    const a = index.get(e.from)
    const b = index.get(e.to)
    return a === undefined || b === undefined || a === b
      ? []
      : [{ a, b, w: 0.5 + (e.strength ?? 0.5) }]
  })
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const k = 1
  for (let it = 0; it < iterations; it++) {
    dx.fill(0)
    dy.fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = xs[i] - xs[j]
        let vy = ys[i] - ys[j]
        let d = Math.hypot(vx, vy)
        if (d < 1e-6) {
          // Coincident: nudge apart along a fixed direction.
          vx = 1e-3 * (i - j)
          vy = 1e-3
          d = Math.hypot(vx, vy)
        }
        const f = (k * k) / d
        dx[i] += (vx / d) * f
        dy[i] += (vy / d) * f
        dx[j] -= (vx / d) * f
        dy[j] -= (vy / d) * f
      }
    }
    for (const { a, b, w } of links) {
      const vx = xs[a] - xs[b]
      const vy = ys[a] - ys[b]
      const d = Math.max(Math.hypot(vx, vy), 1e-6)
      const f = ((d * d) / k) * w
      dx[a] -= (vx / d) * f
      dy[a] -= (vy / d) * f
      dx[b] += (vx / d) * f
      dy[b] += (vy / d) * f
    }
    // Gravity keeps disconnected parts from drifting off.
    for (let i = 0; i < n; i++) {
      dx[i] -= xs[i] * 0.08
      dy[i] -= ys[i] * 0.08
    }
    const temp = Math.max(0.01, 0.6 * Math.sqrt(n) * (1 - it / iterations))
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(dx[i], dy[i])
      if (d < 1e-9) continue
      const step = Math.min(d, temp)
      xs[i] += (dx[i] / d) * step
      ys[i] += (dy[i] / d) * step
    }
  }
  nodeIds.forEach((id, i) => {
    out.set(id, { x: xs[i], y: ys[i] })
  })
  return out
}

/**
 * Turns force positions into pixels: rotates the long axis horizontal (cards
 * are wider than tall), scales to `spacing` per ideal edge, then pushes apart
 * any boxes that still overlap.
 */
export function fitNetwork(
  positions: Map<string, Point>,
  {
    w,
    h,
    spacing,
    gap,
  }: { w: number; h: number; spacing: number; gap: number },
): Map<string, Point> {
  const ids = [...positions.keys()]
  const pts = ids.map((id) => positions.get(id) as Point)
  const n = pts.length
  if (n === 0) return new Map()
  const cx = pts.reduce((s, p) => s + p.x, 0) / n
  const cy = pts.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of pts) {
    sxx += (p.x - cx) ** 2
    syy += (p.y - cy) ** 2
    sxy += (p.x - cx) * (p.y - cy)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const cos = Math.cos(-angle)
  const sin = Math.sin(-angle)
  const xs = pts.map((p) => ((p.x - cx) * cos - (p.y - cy) * sin) * spacing)
  const ys = pts.map((p) => ((p.x - cx) * sin + (p.y - cy) * cos) * spacing)

  // Overlap removal: push each overlapping pair apart along the shallower axis.
  for (let pass = 0; pass < 200; pass++) {
    let moved = false
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const ox = w + gap - Math.abs(xs[i] - xs[j])
        const oy = h + gap - Math.abs(ys[i] - ys[j])
        if (ox <= 0 || oy <= 0) continue
        moved = true
        if (ox / (w + gap) < oy / (h + gap)) {
          const s = xs[i] < xs[j] || (xs[i] === xs[j] && i < j) ? -1 : 1
          xs[i] += (s * ox) / 2 + s * 0.01
          xs[j] -= (s * ox) / 2 + s * 0.01
        } else {
          const s = ys[i] < ys[j] || (ys[i] === ys[j] && i < j) ? -1 : 1
          ys[i] += (s * oy) / 2 + s * 0.01
          ys[j] -= (s * oy) / 2 + s * 0.01
        }
      }
    }
    if (!moved) break
  }
  const out = new Map<string, Point>()
  ids.forEach((id, i) => {
    out.set(id, { x: xs[i], y: ys[i] })
  })
  return out
}

// ---------------------------------------------------------------------------
// Geometry, routes and labels

export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return (
    a.x < b.x + b.w + gap &&
    b.x < a.x + a.w + gap &&
    a.y < b.y + b.h + gap &&
    b.y < a.y + a.h + gap
  )
}

function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

export function boundsOf(boxes: readonly Box[]): Box {
  if (boxes.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  let x0 = Number.POSITIVE_INFINITY
  let y0 = Number.POSITIVE_INFINITY
  let x1 = Number.NEGATIVE_INFINITY
  let y1 = Number.NEGATIVE_INFINITY
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.w)
    y1 = Math.max(y1, b.y + b.h)
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}

/** The point on a centred box's border in the direction of `toward`. */
export function rectAnchor(
  centre: Point,
  w: number,
  h: number,
  toward: Point,
): Point {
  const vx = toward.x - centre.x
  const vy = toward.y - centre.y
  if (vx === 0 && vy === 0) return centre
  const sx = vx === 0 ? Number.POSITIVE_INFINITY : w / 2 / Math.abs(vx)
  const sy = vy === 0 ? Number.POSITIVE_INFINITY : h / 2 / Math.abs(vy)
  const s = Math.min(sx, sy)
  return { x: centre.x + vx * s, y: centre.y + vy * s }
}

export type CubicSegment = { c1: Point; c2: Point; to: Point }
export type Route = { start: Point; segments: CubicSegment[] }

/** Smooth curve through the points, with tangents along the flow axis. */
export function routeThrough(points: readonly Point[], axis: "x" | "y"): Route {
  const segments: CubicSegment[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const p = points[i]
    const q = points[i + 1]
    if (axis === "x") {
      const d = (q.x - p.x) / 2
      segments.push({
        c1: { x: p.x + d, y: p.y },
        c2: { x: q.x - d, y: q.y },
        to: q,
      })
    } else {
      const d = (q.y - p.y) / 2
      segments.push({
        c1: { x: p.x, y: p.y + d },
        c2: { x: q.x, y: q.y - d },
        to: q,
      })
    }
  }
  return { start: points[0] ?? { x: 0, y: 0 }, segments }
}

/** A straight route, as one cubic so it can be interpolated like the others. */
export function straightRoute(a: Point, b: Point): Route {
  const lerp = (t: number) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  })
  return { start: a, segments: [{ c1: lerp(1 / 3), c2: lerp(2 / 3), to: b }] }
}

/** Shifts every control point, bowing the curve to one side. */
export function bendRoute(route: Route, dx: number, dy: number): Route {
  const move = (p: Point) => ({ x: p.x + dx, y: p.y + dy })
  return {
    start: route.start,
    segments: route.segments.map((s) => ({
      ...s,
      c1: move(s.c1),
      c2: move(s.c2),
    })),
  }
}

export function reverseRoute(route: Route): Route {
  const pts: Point[] = [route.start, ...route.segments.map((s) => s.to)]
  const segments: CubicSegment[] = []
  for (let i = route.segments.length - 1; i >= 0; i--) {
    const s = route.segments[i]
    segments.push({ c1: s.c2, c2: s.c1, to: pts[i] })
  }
  return { start: pts[pts.length - 1], segments }
}

const r1 = (v: number) => Math.round(v * 10) / 10

export function routePath(route: Route): string {
  return [
    `M${r1(route.start.x)},${r1(route.start.y)}`,
    ...route.segments.map(
      (s) =>
        `C${r1(s.c1.x)},${r1(s.c1.y)} ${r1(s.c2.x)},${r1(s.c2.y)} ${r1(s.to.x)},${r1(s.to.y)}`,
    ),
  ].join(" ")
}

/** A point at `t` (0–1) along the route, spread evenly over its segments. */
export function pointOnRoute(route: Route, t: number): Point {
  const n = route.segments.length
  if (n === 0) return route.start
  const scaled = Math.min(Math.max(t, 0), 1) * n
  const i = Math.min(Math.floor(scaled), n - 1)
  const u = scaled - i
  const p0 = i === 0 ? route.start : route.segments[i - 1].to
  const { c1, c2, to } = route.segments[i]
  const m = 1 - u
  return {
    x:
      m * m * m * p0.x +
      3 * m * m * u * c1.x +
      3 * m * u * u * c2.x +
      u * u * u * to.x,
    y:
      m * m * m * p0.y +
      3 * m * m * u * c1.y +
      3 * m * u * u * c2.y +
      u * u * u * to.y,
  }
}

export function lerpRoute(a: Route, b: Route, t: number): Route {
  if (a.segments.length !== b.segments.length) return b
  const l = (p: Point, q: Point) => ({
    x: p.x + (q.x - p.x) * t,
    y: p.y + (q.y - p.y) * t,
  })
  return {
    start: l(a.start, b.start),
    segments: b.segments.map((s, i) => ({
      c1: l(a.segments[i].c1, s.c1),
      c2: l(a.segments[i].c2, s.c2),
      to: l(a.segments[i].to, s.to),
    })),
  }
}

/** Rough text width in pixels; good enough to truncate SVG text. */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  bold = false,
): number {
  let units = 0
  for (const ch of text) {
    if (/[ilj.,:;'|!]/.test(ch)) units += 0.3
    else if (/[mwMW@]/.test(ch)) units += 0.85
    else if (/[A-Z0-9]/.test(ch)) units += 0.64
    else if (ch === " ") units += 0.3
    else units += 0.54
  }
  return units * fontSize * (bold ? 1.06 : 1)
}

/** Cuts text to fit `maxWidth`, ending with an ellipsis when cut. */
export function truncateToWidth(
  text: string,
  maxWidth: number,
  fontSize: number,
  bold = false,
): string {
  if (estimateTextWidth(text, fontSize, bold) <= maxWidth) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const candidate = `${chars.slice(0, mid).join("").trimEnd()}…`
    if (estimateTextWidth(candidate, fontSize, bold) <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo === 0 ? "…" : `${chars.slice(0, lo).join("").trimEnd()}…`
}

/** Where an edge label may go: along the curve, then nudged off it. */
export function labelCandidates(route: Route, h: number): Point[] {
  const out: Point[] = []
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const p = pointOnRoute(route, t)
    out.push(p, { x: p.x, y: p.y - h - 2 }, { x: p.x, y: p.y + h + 2 })
  }
  return out
}

/**
 * Greedy label placement, in order: each label takes its first candidate
 * (a centre point) that clears the obstacles and the labels placed so far,
 * else the one with the least overlap.
 */
export function placeLabels(
  items: readonly {
    id: string
    candidates: readonly Point[]
    w: number
    h: number
  }[],
  obstacles: readonly Box[],
  gap = 2,
): Map<string, Box> {
  const placed: Box[] = []
  const out = new Map<string, Box>()
  for (const item of items) {
    let best: Box | null = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const c of item.candidates) {
      const box = {
        x: c.x - item.w / 2,
        y: c.y - item.h / 2,
        w: item.w,
        h: item.h,
      }
      const grown = {
        x: box.x - gap,
        y: box.y - gap,
        w: box.w + gap * 2,
        h: box.h + gap * 2,
      }
      let score = 0
      for (const o of obstacles) score += overlapArea(grown, o)
      for (const o of placed) score += overlapArea(grown, o)
      if (score === 0) {
        best = box
        break
      }
      if (score < bestScore) {
        bestScore = score
        best = box
      }
    }
    if (best) {
      placed.push(best)
      out.set(item.id, best)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Full layout

export type PositionedNode = {
  id: string
  x: number
  y: number
  w: number
  h: number
}
export type PositionedEdge = {
  key: string
  from: string
  to: string
  route: Route
  /** Drawn against the flow to break a cycle. */
  reversed: boolean
}
export type GraphLayout = {
  nodes: Map<string, PositionedNode>
  edges: PositionedEdge[]
  bounds: Box
  /** Keys of edges reversed to break cycles (flow only). */
  backEdges: string[]
  /** Visible node ids in reading order. */
  order: string[]
}

export const NETWORK_MAX = 40

export function layoutGraph(
  nodeIds: readonly string[],
  edges: readonly GraphEdge[],
  {
    layout,
    direction,
    rootId,
    tree,
    collapsed = new Set(),
    nodeW,
    nodeH,
    layerGap,
  }: {
    layout: LayoutKind
    direction: Direction
    rootId?: string
    tree?: TreeStructure
    collapsed?: ReadonlySet<string>
    nodeW: number
    nodeH: number
    /** Space between levels; widen it to fit edge labels. */
    layerGap?: number
  },
): GraphLayout {
  const nodes = new Map<string, PositionedNode>()
  const out: PositionedEdge[] = []
  const horizontal = direction === "right"
  const axis = horizontal ? "x" : "y"
  // Breadth runs across the flow, depth along it.
  const bSize = horizontal ? nodeH : nodeW
  const dSize = horizontal ? nodeW : nodeH
  const bGap = horizontal ? 16 : 24
  const dGap = layerGap ?? (horizontal ? 72 : 64)
  const toXY = (b: number, level: number): Point =>
    horizontal
      ? { x: level * (dSize + dGap) + dSize / 2, y: b }
      : { x: b, y: level * (dSize + dGap) + dSize / 2 }
  // Exit and entry points on the trailing and leading sides.
  const exit = (n: PositionedNode): Point =>
    horizontal ? { x: n.x + n.w / 2, y: n.y } : { x: n.x, y: n.y + n.h / 2 }
  const entry = (n: PositionedNode): Point =>
    horizontal ? { x: n.x - n.w / 2, y: n.y } : { x: n.x, y: n.y - n.h / 2 }
  const straight = (e: GraphEdge) => {
    const a = nodes.get(e.from)
    const b = nodes.get(e.to)
    if (!a || !b) return null
    return straightRoute(rectAnchor(a, a.w, a.h, b), rectAnchor(b, b.w, b.h, a))
  }
  let order: string[] = []
  let backEdges: string[] = []

  if (layout === "tree") {
    const t = tree ?? buildTree(nodeIds, edges, rootId)
    const placed = tidyTree(t, collapsed, { size: bSize, gap: bGap })
    order = treeOutline(t, collapsed).map((o) => o.id)
    for (const id of order) {
      const p = placed.get(id)
      if (!p) continue
      nodes.set(id, { id, ...toXY(p.b, p.level), w: nodeW, h: nodeH })
    }
    for (const e of edges) {
      if (!nodes.has(e.from) || !nodes.has(e.to)) continue
      if (t.treeEdges.has(e.key)) {
        const { parent, child } = parentChild(e)
        const p = nodes.get(parent) as PositionedNode
        const c = nodes.get(child) as PositionedNode
        const route = routeThrough([exit(p), entry(c)], axis)
        out.push({
          key: e.key,
          from: e.from,
          to: e.to,
          route: parent === e.from ? route : reverseRoute(route),
          reversed: false,
        })
      } else {
        const route = straight(e)
        if (route)
          out.push({
            key: e.key,
            from: e.from,
            to: e.to,
            route,
            reversed: false,
          })
      }
    }
  } else if (layout === "flow") {
    const result = layeredLayout(nodeIds, edges, {
      startIds: rootId ? [rootId] : [],
      size: bSize,
      gap: bGap,
    })
    backEdges = [...result.reversed]
    order = result.layers.flat().filter((id) => !isDummy(id))
    const pointOf = (id: string) =>
      toXY(result.breadth.get(id) ?? 0, result.layerOf.get(id) ?? 0)
    for (const id of order)
      nodes.set(id, { id, ...pointOf(id), w: nodeW, h: nodeH })
    for (const e of edges) {
      const reversed = result.reversed.has(e.key)
      // Chains run with the flow; reversed edges are drawn back against it.
      const chain = result.chains.get(e.key) ?? [e.from, e.to]
      const flowChain = reversed ? [...chain].reverse() : chain
      const first = nodes.get(flowChain[0])
      const last = nodes.get(flowChain[flowChain.length - 1])
      if (!first || !last) continue
      const pts = [
        exit(first),
        ...flowChain.slice(1, -1).map(pointOf),
        entry(last),
      ]
      const route = routeThrough(pts, axis)
      out.push({
        key: e.key,
        from: e.from,
        to: e.to,
        // Bent aside, so it never hides under a forward edge between the same nodes.
        route: reversed
          ? reverseRoute(
              bendRoute(route, horizontal ? 0 : 28, horizontal ? 28 : 0),
            )
          : route,
        reversed,
      })
    }
  } else {
    const ids = nodeIds.slice(0, NETWORK_MAX)
    const raw = forceLayout(ids, edges)
    const fitted = fitNetwork(raw, {
      w: nodeW,
      h: nodeH,
      spacing: nodeW + 56,
      gap: 24,
    })
    order = [...ids]
    for (const id of ids) {
      const p = fitted.get(id)
      if (p) nodes.set(id, { id, x: p.x, y: p.y, w: nodeW, h: nodeH })
    }
    for (const e of edges) {
      const route = straight(e)
      if (route)
        out.push({ key: e.key, from: e.from, to: e.to, route, reversed: false })
    }
  }

  const bounds = boundsOf(
    [...nodes.values()].map((n) => ({
      x: n.x - n.w / 2,
      y: n.y - n.h / 2,
      w: n.w,
      h: n.h,
    })),
  )
  return { nodes, edges: out, bounds, backEdges, order }
}

/** Interpolates node positions and edge routes, for layout transitions. */
export function lerpLayout(
  a: GraphLayout,
  b: GraphLayout,
  t: number,
): GraphLayout {
  if (t >= 1) return b
  const nodes = new Map<string, PositionedNode>()
  for (const [id, n] of b.nodes) {
    const p = a.nodes.get(id)
    nodes.set(
      id,
      p ? { ...n, x: p.x + (n.x - p.x) * t, y: p.y + (n.y - p.y) * t } : n,
    )
  }
  const prev = new Map(a.edges.map((e) => [e.key, e]))
  const edges = b.edges.map((e) => {
    const p = prev.get(e.key)
    return p ? { ...e, route: lerpRoute(p.route, e.route, t) } : e
  })
  return { ...b, nodes, edges }
}

// ---------------------------------------------------------------------------
// View: fit and zoom

export type View = { x: number; y: number; k: number }
export type ZoomLimits = { minK: number; maxK: number }

export const clampK = (k: number, { minK, maxK }: ZoomLimits) =>
  Math.min(maxK, Math.max(minK, k))

/** Centres `bounds` in the viewport at the largest zoom that fits (≤ maxK). */
export function fitView(
  bounds: Box,
  width: number,
  height: number,
  {
    pad = 24,
    minK = 0.2,
    maxK = 1,
  }: { pad?: number } & Partial<ZoomLimits> = {},
): View {
  const availW = Math.max(width - pad * 2, 1)
  const availH = Math.max(height - pad * 2, 1)
  const k = clampK(
    Math.min(
      bounds.w > 0 ? availW / bounds.w : maxK,
      bounds.h > 0 ? availH / bounds.h : maxK,
    ),
    { minK, maxK },
  )
  return {
    k,
    x: width / 2 - (bounds.x + bounds.w / 2) * k,
    y: height / 2 - (bounds.y + bounds.h / 2) * k,
  }
}

/** Zooms by `factor` keeping the screen point (px, py) fixed. */
export function zoomAt(
  view: View,
  factor: number,
  px: number,
  py: number,
  limits: ZoomLimits,
): View {
  const k = clampK(view.k * factor, limits)
  const f = k / view.k
  return { k, x: px - (px - view.x) * f, y: py - (py - view.y) * f }
}

/** Pans the least amount needed to bring a world box into the viewport. */
export function ensureVisible(
  view: View,
  box: Box,
  width: number,
  height: number,
  pad = 16,
): View {
  const x0 = box.x * view.k + view.x
  const y0 = box.y * view.k + view.y
  const x1 = x0 + box.w * view.k
  const y1 = y0 + box.h * view.k
  let dx = 0
  let dy = 0
  if (x1 - x0 > width - pad * 2) dx = width / 2 - (x0 + x1) / 2
  else if (x0 < pad) dx = pad - x0
  else if (x1 > width - pad) dx = width - pad - x1
  if (y1 - y0 > height - pad * 2) dy = height / 2 - (y0 + y1) / 2
  else if (y0 < pad) dy = pad - y0
  else if (y1 > height - pad) dy = height - pad - y1
  return dx === 0 && dy === 0
    ? view
    : { ...view, x: view.x + dx, y: view.y + dy }
}

/** The smallest zoom the automatic view uses, so node text stays readable. */
export const AUTO_MIN_K = 0.75

/** The zoom that fits `bounds` in the viewport (≤ maxK, no lower bound). */
export function fitScale(
  bounds: Box,
  width: number,
  height: number,
  { pad = 24, maxK = 1 }: { pad?: number; maxK?: number } = {},
): number {
  const sx = bounds.w > 0 ? Math.max(width - pad * 2, 1) / bounds.w : maxK
  const sy = bounds.h > 0 ? Math.max(height - pad * 2, 1) / bounds.h : maxK
  return Math.min(maxK, sx, sy)
}

/**
 * Canvas height: the content's height at the zoom it will be shown at (the
 * width-fitting zoom, kept between AUTO_MIN_K and 1), clamped to min–max.
 */
export function canvasHeight(
  bounds: Box,
  width: number,
  {
    min = 280,
    max = 520,
    pad = 24,
    minK = AUTO_MIN_K,
  }: { min?: number; max?: number; pad?: number; minK?: number } = {},
): number {
  if (width <= 0 || bounds.w <= 0) return min
  const k = Math.min(1, Math.max(minK, (width - pad * 2) / bounds.w))
  return Math.round(Math.min(max, Math.max(min, bounds.h * k + pad * 2)))
}

/**
 * The automatic view: the whole graph when it fits at `minK` or more;
 * otherwise `minK`, centred on `anchor` (the focus or first node) and slid
 * back so the graph's edges don't leave empty space in the viewport.
 */
export function initialView(
  bounds: Box,
  width: number,
  height: number,
  {
    anchor,
    pad = 24,
    minK = AUTO_MIN_K,
    maxK = 1,
  }: { anchor?: Box; pad?: number; minK?: number; maxK?: number } = {},
): View {
  const k = fitScale(bounds, width, height, { pad, maxK })
  if (k >= minK) return fitView(bounds, width, height, { pad, minK, maxK })
  const target = anchor ?? bounds
  const axis = (
    start: number,
    size: number,
    aStart: number,
    aSize: number,
    view: number,
  ) => {
    if (size * minK <= view - pad * 2) {
      // This axis fits: centre the whole graph along it.
      return view / 2 - (start + size / 2) * minK
    }
    const centred = view / 2 - (aStart + aSize / 2) * minK
    const hi = pad - start * minK // left/top edge at the padding
    const lo = view - pad - (start + size) * minK // right/bottom edge at the padding
    return Math.min(hi, Math.max(lo, centred))
  }
  return {
    k: minK,
    x: axis(bounds.x, bounds.w, target.x, target.w, width),
    y: axis(bounds.y, bounds.h, target.y, target.h, height),
  }
}

/**
 * Of several candidate layouts, the one shown largest in a viewport this wide
 * (ties go to the first).
 */
export function pickLayout<T extends { bounds: Box }>(
  candidates: readonly T[],
  width: number,
): T {
  let best = candidates[0]
  let bestK = Number.NEGATIVE_INFINITY
  for (const c of candidates) {
    const k = fitScale(c.bounds, width, canvasHeight(c.bounds, width))
    if (k > bestK + 1e-9) {
      best = c
      bestK = k
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// Links

/** Only http(s) URLs from agent data. */
export function safeUrl(url: unknown): URL | null {
  if (typeof url !== "string") return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}
