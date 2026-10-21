"use client"

import * as React from "react"
import {
  CheckIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  ExternalLinkIcon,
  type LucideIcon,
  MaximizeIcon,
  MinusIcon,
  OctagonAlertIcon,
  PlusIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  surfaceInset,
  genuiMotion,
} from "@/components/genui/surface"

import {
  ancestorsOf,
  buildGraph,
  buildTree,
  canvasHeight,
  defaultCollapsed,
  ensureVisible,
  estimateTextWidth,
  fitView,
  initialView,
  type Graph,
  type GraphEdge,
  type GraphLayout,
  labelCandidates,
  type LayoutKind,
  layoutGraph,
  lerpLayout,
  NETWORK_MAX,
  neighborSet,
  type OutlineItem,
  type PositionedNode,
  pickLayout,
  placeLabels,
  routePath,
  safeUrl,
  treeOutline,
  truncateToWidth,
  type View,
  zoomAt,
} from "./relationship-explorer-utils"
import type {
  RelationshipEdge,
  RelationshipEdgeKind,
  RelationshipExplorerInput,
  RelationshipExplorerResult,
  RelationshipHealth,
  RelationshipNode,
} from "./relationship-explorer.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type RelationshipExplorerStatus = "streaming" | "ready" | "submitted"

export type RelationshipExplorerProps = Partial<
  Omit<RelationshipExplorerInput, "nodes" | "edges">
> & {
  /** Nodes and edges may be partial while the tool call streams. */
  nodes?: Partial<RelationshipNode>[]
  edges?: Partial<RelationshipEdge>[]
  /** Lifecycle, controlled by the host. */
  status?: RelationshipExplorerStatus
  /** Called once when the user chooses a node or asks about it (only when selectable). */
  onResult?: (result: RelationshipExplorerResult) => void
  /** A choice from history. Restores the selection and locks; never calls onResult. */
  result?: RelationshipExplorerResult
  className?: string
}

type ExplorerNode = Partial<RelationshipNode> & { id: string; label: string }
type KindKey = RelationshipEdgeKind | "link"

const NODE_W = 180
const NODE_H = 52
/** Tree levels shown before deeper subtrees start collapsed. */
const TREE_LEVELS = 3
const ZOOM = { minK: 0.2, maxK: 2 }
/** Cards narrower than this may lay a flow out top to bottom. */
const NARROW = 560
const LABEL_H = 18
const LABEL_MAX_W = 120
const DOTTED = "1 4"
const EMPTY_NODES: Partial<RelationshipNode>[] = []
const EMPTY_EDGES: Partial<RelationshipEdge>[] = []

const KIND_ORDER: KindKey[] = [
  "depends-on",
  "reports-to",
  "causes",
  "blocks",
  "related",
  "link",
]

const EDGE_STYLE: Record<
  KindKey,
  {
    legend: string
    /** Heading for outgoing links in the detail panel. */
    out: string
    /** Heading for incoming links. */
    in: string
    arrow: boolean
    dash?: string
    width: number
  }
> = {
  "depends-on": {
    legend: "Depends on",
    out: "Depends on",
    in: "Used by",
    arrow: true,
    width: 1.25,
  },
  "reports-to": {
    legend: "Reports to",
    out: "Reports to",
    in: "Direct reports",
    arrow: false,
    width: 1.25,
  },
  causes: {
    legend: "Causes",
    out: "Leads to",
    in: "Caused by",
    arrow: true,
    width: 1.75,
  },
  blocks: {
    legend: "Blocks",
    out: "Blocks",
    in: "Blocked by",
    arrow: true,
    dash: "6 4",
    width: 1.25,
  },
  related: {
    legend: "Related",
    out: "Related to",
    in: "Related to",
    arrow: false,
    dash: DOTTED,
    width: 1.5,
  },
  link: {
    legend: "Links to",
    out: "Links to",
    in: "Linked from",
    arrow: true,
    width: 1.25,
  },
}

const HEALTH: Record<
  RelationshipHealth,
  { label: string; Icon: LucideIcon; color: string }
> = {
  ok: { label: "OK", Icon: CircleCheckIcon, color: "var(--muted-foreground)" },
  warning: {
    label: "Warning",
    Icon: TriangleAlertIcon,
    color: "var(--foreground)",
  },
  critical: {
    label: "Critical",
    Icon: OctagonAlertIcon,
    color: "var(--destructive)",
  },
  unknown: {
    label: "Unknown",
    Icon: CircleHelpIcon,
    color: "var(--muted-foreground)",
  },
}

const LAYOUT_NOUN: Record<LayoutKind, string> = {
  tree: "tree",
  flow: "flow",
  network: "network",
}

const kindOf = (e: Pick<GraphEdge, "kind">): KindKey => e.kind ?? "link"

const boxOf = (n: PositionedNode) => ({
  x: n.x - n.w / 2,
  y: n.y - n.h / 2,
  w: n.w,
  h: n.h,
})

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`

function listNames(names: string[], max = 3) {
  if (names.length <= max) {
    return names.length > 1
      ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
      : (names[0] ?? "")
  }
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`
}

type NeighborGroup = {
  title: string
  items: { id: string; label: string; edgeLabel?: string }[]
}

/** Incoming and outgoing links of a node, grouped by what they mean. */
function neighborGroups(
  graph: Graph<ExplorerNode>,
  id: string,
): NeighborGroup[] {
  const groups = new Map<string, NeighborGroup>()
  const add = (title: string, otherId: string, edgeLabel?: string) => {
    const other = graph.byId.get(otherId)
    if (!other) return
    const group = groups.get(title) ?? { title, items: [] }
    if (!group.items.some((i) => i.id === otherId)) {
      group.items.push({ id: otherId, label: other.label, edgeLabel })
    }
    groups.set(title, group)
  }
  for (const kind of KIND_ORDER) {
    for (const e of graph.outgoing.get(id) ?? []) {
      if (kindOf(e) === kind) add(EDGE_STYLE[kind].out, e.to, e.label)
    }
  }
  for (const kind of KIND_ORDER) {
    for (const e of graph.incoming.get(id) ?? []) {
      if (kindOf(e) === kind) add(EDGE_STYLE[kind].in, e.from, e.label)
    }
  }
  return [...groups.values()]
}

function describeNode(node: ExplorerNode) {
  return [
    node.label,
    node.sublabel,
    node.kind,
    node.health ? HEALTH[node.health].label : undefined,
  ]
    .filter(Boolean)
    .join(", ")
}

function describeLinks(graph: Graph<ExplorerNode>, id: string) {
  return neighborGroups(graph, id)
    .map((g) => `${g.title} ${listNames(g.items.map((i) => i.label))}.`)
    .join(" ")
}

/** Positions the drawing animates through when the layout changes. */
function useLayoutTransition(target: GraphLayout, animate: boolean) {
  const [shown, setShown] = React.useState(target)
  const shownRef = React.useRef(target)
  React.useEffect(() => {
    const from = shownRef.current
    const same =
      from.nodes.size === target.nodes.size &&
      [...target.nodes].every(([id, n]) => {
        const p = from.nodes.get(id)
        return p && p.x === n.x && p.y === n.y
      }) &&
      from.edges.length === target.edges.length
    if (!animate || same) {
      shownRef.current = target
      setShown(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 240)
      const next = lerpLayout(from, target, 1 - (1 - t) ** 3)
      shownRef.current = next
      setShown(next)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, animate])
  return shown
}

function LegendLine({ kind, back }: { kind: KindKey; back?: boolean }) {
  const s = EDGE_STYLE[kind]
  return (
    <svg aria-hidden width={28} height={10} className="shrink-0">
      <path
        d={s.arrow ? "M1,5 H21" : "M1,5 H27"}
        stroke="currentColor"
        strokeWidth={s.width}
        strokeDasharray={back ? "3 3" : s.dash}
        strokeLinecap={s.dash === DOTTED ? "round" : undefined}
        fill="none"
      />
      {s.arrow && <path d="M20,1.5 L27,5 L20,8.5 Z" fill="currentColor" />}
    </svg>
  )
}

export function RelationshipExplorer({
  title,
  layout: layoutProp,
  nodes = EMPTY_NODES,
  edges = EMPTY_EDGES,
  rootId,
  focusId,
  direction: directionProp,
  selectable = false,
  status: statusProp,
  onResult,
  result,
  className,
}: RelationshipExplorerProps) {
  const [decision, setDecision] =
    React.useState<RelationshipExplorerResult | null>(result ?? null)
  // undefined: nothing picked yet, so focusId applies; null: cleared.
  const [picked, setPicked] = React.useState<string | null | undefined>(
    result?.nodeId,
  )
  const [toggles, setToggles] = React.useState<Record<string, boolean>>({})
  const [width, setWidth] = React.useState(0)
  // Set once the user pans or zooms; until then the view fits the graph.
  const [manualView, setManualView] = React.useState<View | null>(null)
  const [listFocused, setListFocused] = React.useState(false)
  const frameRef = React.useRef<HTMLDivElement>(null)
  const svgRef = React.useRef<SVGSVGElement>(null)
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const itemRefs = React.useRef(new Map<string, HTMLElement>())
  const viewRef = React.useRef<View>({ x: 0, y: 0, k: 1 })
  const revealRef = React.useRef<string | null>(null)
  const pointers = React.useRef(new Map<number, { x: number; y: number }>())
  const gesture = React.useRef<{
    start: { x: number; y: number }
    moved: boolean
    target: Element | null
  } | null>(null)
  const titleId = React.useId()
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const reduceMotion = useReducedMotion()

  // A host-provided "ready" (or nothing) yields to the user's choice.
  const status: RelationshipExplorerStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  // -------------------------------------------------------------------------
  // Graph and layout

  const graph = React.useMemo(
    () => buildGraph(nodes as ExplorerNode[], edges, { maxNodes: 60 }),
    [nodes, edges],
  )
  const requested: LayoutKind = layoutProp ?? "flow"
  const tooBig = requested === "network" && graph.nodes.length > NETWORK_MAX
  const kind: LayoutKind = tooBig ? "flow" : requested
  const nodeIds = React.useMemo(() => graph.nodes.map((n) => n.id), [graph])
  const tree = React.useMemo(
    () => (kind === "tree" ? buildTree(nodeIds, graph.edges, rootId) : null),
    [kind, nodeIds, graph.edges, rootId],
  )

  // Collapsed subtrees: deep levels by default, then the user's toggles.
  const collapsedKey = React.useMemo(() => {
    if (!tree) return ""
    const defaults = defaultCollapsed(
      tree,
      TREE_LEVELS,
      result?.nodeId ?? focusId,
    )
    const ids: string[] = []
    for (const [id, kids] of tree.children) {
      if (kids.length && (toggles[id] ?? defaults.has(id))) ids.push(id)
    }
    return ids.join("\u0000")
  }, [tree, toggles, focusId, result?.nodeId])
  const collapsed = React.useMemo(
    () => new Set(collapsedKey ? collapsedKey.split("\u0000") : []),
    [collapsedKey],
  )

  // Horizontal layouts widen the gap between levels to fit edge labels.
  const layerGap = React.useMemo(() => {
    if (kind === "network") return undefined
    let widest = 0
    for (const e of graph.edges) {
      if (!e.label) continue
      const text = truncateToWidth(e.label, LABEL_MAX_W, 10)
      widest = Math.max(widest, estimateTextWidth(text, 10) + 12)
    }
    return widest ? Math.max(72, widest + 32) : undefined
  }, [graph.edges, kind])

  // Before the first measure (and on the server), assume a typical width.
  const frameW = width || 640
  // Narrow cards try both directions for a flow and keep the one shown larger,
  // unless the agent set a direction.
  const autoDirection =
    directionProp === undefined && kind === "flow" && frameW < NARROW
  const { target, direction } = React.useMemo(() => {
    const make = (dir: "right" | "down") => ({
      direction: dir,
      layout: layoutGraph(nodeIds, graph.edges, {
        layout: kind,
        direction: dir,
        rootId,
        tree: tree ?? undefined,
        collapsed,
        nodeW: NODE_W,
        nodeH: NODE_H,
        layerGap: dir === "right" ? layerGap : undefined,
      }),
    })
    const chosen = autoDirection
      ? pickLayout(
          [make("right"), make("down")].map((c) => ({
            ...c,
            bounds: c.layout.bounds,
          })),
          frameW,
        )
      : make(directionProp ?? "right")
    return { target: chosen.layout, direction: chosen.direction }
  }, [
    nodeIds,
    graph.edges,
    kind,
    directionProp,
    autoDirection,
    frameW,
    rootId,
    tree,
    collapsed,
    layerGap,
  ])
  const shown = useLayoutTransition(target, !reduceMotion)
  const edgeByKey = React.useMemo(
    () => new Map(graph.edges.map((e) => [e.key, e])),
    [graph.edges],
  )

  const outline: OutlineItem[] | null = React.useMemo(
    () => (tree ? treeOutline(tree, collapsed) : null),
    [tree, collapsed],
  )
  const outlineById = React.useMemo(
    () => new Map((outline ?? []).map((o) => [o.id, o])),
    [outline],
  )

  const candidate = picked === undefined ? focusId : picked
  const selectedId = candidate && graph.byId.has(candidate) ? candidate : null
  const selected = selectedId ? graph.byId.get(selectedId) : undefined
  const neighbors = selectedId ? neighborSet(graph, selectedId) : null
  const listIds = target.order
  const activeId =
    selectedId && target.nodes.has(selectedId) ? selectedId : listIds[0]

  // -------------------------------------------------------------------------
  // Viewport

  React.useEffect(() => {
    const el = frameRef.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const height = canvasHeight(target.bounds, frameW, { max: 480, min: 250 })
  const hasNodes = graph.nodes.length > 0
  // The automatic view: the whole graph if it fits at a readable zoom, else a
  // readable zoom centred on the focus (or root, or first node). It follows
  // the stream and opened subtrees until the user pans or zooms.
  const anchorId = [result?.nodeId, focusId, rootId, target.order[0]].find(
    (id) => id !== undefined && target.nodes.has(id),
  )
  const anchorNode = anchorId ? target.nodes.get(anchorId) : undefined
  const view =
    manualView ??
    initialView(target.bounds, frameW, height, {
      anchor: anchorNode ? boxOf(anchorNode) : undefined,
    })
  React.useEffect(() => {
    viewRef.current = view
  })
  /** Pan and zoom start from the view on screen. */
  const moveView = (change: (v: View) => View) =>
    setManualView((v) => change(v ?? viewRef.current))

  const zoomBy = (factor: number) =>
    moveView((v) => zoomAt(v, factor, frameW / 2, height / 2, ZOOM))

  // Bring a node picked from the list or the detail panel into view.
  React.useEffect(() => {
    const id = revealRef.current
    const n = id ? target.nodes.get(id) : undefined
    if (!n || width <= 0) return
    revealRef.current = null
    const next = ensureVisible(view, boxOf(n), width, height)
    if (next !== view) setManualView(next)
  }, [target, view, width, height])

  // Ctrl/⌘ + wheel and trackpad pinch zoom; a plain wheel scrolls the page.
  React.useEffect(() => {
    const svg = svgRef.current
    if (!svg || !hasNodes) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      const factor = Math.min(2, Math.max(0.5, Math.exp(-e.deltaY * 0.004)))
      setManualView((v) =>
        zoomAt(
          v ?? viewRef.current,
          factor,
          e.clientX - rect.left,
          e.clientY - rect.top,
          ZOOM,
        ),
      )
    }
    svg.addEventListener("wheel", onWheel, { passive: false })
    return () => svg.removeEventListener("wheel", onWheel)
  }, [hasNodes])

  // -------------------------------------------------------------------------
  // Selection and collapsing

  const select = (id: string | null, reveal = false) => {
    setPicked(id)
    if (id && tree) {
      const hidden = ancestorsOf(tree, id).filter((a) => collapsed.has(a))
      if (hidden.length) {
        setToggles((prev) => ({
          ...prev,
          ...Object.fromEntries(hidden.map((a) => [a, false])),
        }))
      }
    }
    if (id && reveal) revealRef.current = id
  }

  const toggle = (id: string) => {
    const collapse = !collapsed.has(id)
    setToggles((prev) => ({ ...prev, [id]: collapse }))
    // Collapsing around the selection moves it to the collapsed node.
    if (collapse && selectedId && tree?.parent.has(selectedId)) {
      if (ancestorsOf(tree, selectedId).includes(id)) setPicked(id)
    }
  }

  const send = (
    action: RelationshipExplorerResult["action"],
    nodeId: string,
  ) => {
    if (locked) return
    const next: RelationshipExplorerResult = { action, nodeId }
    setDecision(next)
    onResult?.(next)
  }

  // -------------------------------------------------------------------------
  // Pointer: drag to pan, two fingers to pinch, tap to select.

  const local = (e: React.PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    return rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: 0, y: 0 }
  }

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    if (pointers.current.size === 1) {
      gesture.current = { start: p, moved: false, target: e.target as Element }
    } else if (gesture.current) {
      gesture.current.moved = true
    }
  }

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const p = local(e)
    const g = gesture.current
    if (pointers.current.size === 1) {
      if (g && !g.moved) {
        if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 4) return
        g.moved = true
      }
      moveView((v) => ({ ...v, x: v.x + p.x - prev.x, y: v.y + p.y - prev.y }))
    } else if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(
        ([id]) => id !== e.pointerId,
      )?.[1]
      if (other) {
        const before = Math.hypot(prev.x - other.x, prev.y - other.y)
        const after = Math.hypot(p.x - other.x, p.y - other.y)
        const mid = { x: (p.x + other.x) / 2, y: (p.y + other.y) / 2 }
        const midBefore = {
          x: (prev.x + other.x) / 2,
          y: (prev.y + other.y) / 2,
        }
        moveView((v) => {
          if (before < 1) return v
          const z = zoomAt(v, after / before, midBefore.x, midBefore.y, ZOOM)
          return {
            ...z,
            x: z.x + mid.x - midBefore.x,
            y: z.y + mid.y - midBefore.y,
          }
        })
      }
    }
    pointers.current.set(e.pointerId, p)
  }

  const endPointer = (e: React.PointerEvent<SVGSVGElement>, tap: boolean) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size > 0) return
    const g = gesture.current
    gesture.current = null
    if (!tap || !g || g.moved || !g.target) return
    const toggleId = g.target
      .closest("[data-toggle-id]")
      ?.getAttribute("data-toggle-id")
    if (toggleId) {
      toggle(toggleId)
      return
    }
    const nodeId = g.target
      .closest("[data-node-id]")
      ?.getAttribute("data-node-id")
    select(nodeId ?? null)
  }

  // -------------------------------------------------------------------------
  // Accessible list: a tree for trees, a listbox otherwise.

  const focusItem = (id: string | undefined) => {
    if (!id) return
    select(id, true)
    itemRefs.current.get(id)?.focus()
  }

  const onItemKeyDown = (e: React.KeyboardEvent, id: string) => {
    const i = listIds.indexOf(id)
    const item = outlineById.get(id)
    switch (e.key) {
      case "ArrowDown":
        focusItem(listIds[i + 1])
        break
      case "ArrowUp":
        focusItem(listIds[i - 1])
        break
      case "Home":
        focusItem(listIds[0])
        break
      case "End":
        focusItem(listIds[listIds.length - 1])
        break
      case "ArrowRight":
        if (!item?.hasChildren) return
        if (item.expanded) focusItem(listIds[i + 1])
        else toggle(id)
        break
      case "ArrowLeft":
        if (!item) return
        if (item.expanded) toggle(id)
        else focusItem(item.parentId)
        break
      case "Enter":
      case " ":
        if (item?.hasChildren) toggle(id)
        else select(id, true)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const itemProps = (id: string) => ({
    ref: (el: HTMLElement | null) => {
      if (el) itemRefs.current.set(id, el)
      else itemRefs.current.delete(id)
    },
    "aria-selected": id === selectedId,
    onKeyDown: (e: React.KeyboardEvent) => onItemKeyDown(e, id),
    onFocus: () => {
      setListFocused(true)
      if (id !== selectedId) select(id, true)
    },
    onClick: () => select(id, true),
  })

  const onListBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      setListFocused(false)
  }

  // -------------------------------------------------------------------------
  // Drawing

  const edgeLabels = (() => {
    const obstacles = [...shown.nodes.values()].map(boxOf)
    const items = shown.edges.flatMap((pe) => {
      const e = edgeByKey.get(pe.key)
      if (!e?.label) return []
      const text = truncateToWidth(e.label, LABEL_MAX_W, 10)
      return [
        {
          id: pe.key,
          text,
          full: e.label,
          candidates: labelCandidates(pe.route, LABEL_H),
          w: estimateTextWidth(text, 10) + 12,
          h: LABEL_H,
        },
      ]
    })
    const placed = placeLabels(items, obstacles)
    return items.flatMap((item) => {
      const box = placed.get(item.id)
      return box ? [{ ...item, box }] : []
    })
  })()

  const edgeTone = (pe: { from: string; to: string }) =>
    !selectedId
      ? "muted"
      : pe.from === selectedId || pe.to === selectedId
        ? "strong"
        : "dim"

  const kindsPresent = KIND_ORDER.filter((k) =>
    graph.edges.some((e) => kindOf(e) === k),
  )
  const healthPresent = (Object.keys(HEALTH) as RelationshipHealth[]).filter(
    (h) => graph.nodes.some((n) => n.health === h),
  )
  const url = safeUrl(selected?.url)
  const groups = selectedId ? neighborGroups(graph, selectedId) : []
  const unknownIds = streaming ? [] : graph.issues.unknownIds
  const summary = hasNodes
    ? `${title ? `${title}: ` : ""}${plural(graph.nodes.length, "node")} and ${plural(graph.edges.length, "link")}, drawn as a ${LAYOUT_NOUN[kind]}.`
    : ""

  // Data-integrity notes only. A loop is explained by its legend entry.
  const notes = [
    tooBig && `Over ${NETWORK_MAX} nodes, drawn as a flow.`,
    graph.issues.truncated > 0 &&
      `First 60 nodes shown; ${graph.issues.truncated} not drawn.`,
    unknownIds.length > 0 && `Unknown ids not drawn: ${unknownIds.join(", ")}.`,
  ].filter((n): n is string => typeof n === "string")

  const chosenLabel = decision
    ? (graph.byId.get(decision.nodeId)?.label ?? decision.nodeId)
    : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="relationship-explorer"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Relationships"}
        className={className}
      >
        {(title || streaming) && (
          <SurfaceHeader className="pb-3">
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          </SurfaceHeader>
        )}

        {/* The structure for assistive tech and keyboard; the canvas mirrors it. */}
        {hasNodes && (
          <div className="sr-only">
            <p>{summary}</p>
            {outline ? (
              <div
                role="tree"
                aria-label={title ? `${title}: nodes` : "Nodes"}
                onBlur={onListBlur}
              >
                {outline.map((o) => {
                  const node = graph.byId.get(o.id)
                  if (!node) return null
                  return (
                    <div
                      key={o.id}
                      role="treeitem"
                      aria-level={o.level}
                      aria-setsize={o.setSize}
                      aria-posinset={o.posInSet}
                      aria-expanded={o.hasChildren ? o.expanded : undefined}
                      tabIndex={o.id === activeId ? 0 : -1}
                      {...itemProps(o.id)}
                    >
                      {describeNode(node)}
                      {o.hiddenCount > 0 &&
                        `, ${plural(o.hiddenCount, "more")} inside`}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div
                role="listbox"
                aria-label={title ? `${title}: nodes` : "Nodes"}
                onBlur={onListBlur}
              >
                {listIds.map((id) => {
                  const node = graph.byId.get(id)
                  if (!node) return null
                  return (
                    <div
                      key={id}
                      role="option"
                      tabIndex={id === activeId ? 0 : -1}
                      {...itemProps(id)}
                    >
                      {`${describeNode(node)}. ${describeLinks(graph, id)}`}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div
          ref={frameRef}
          className="relative w-full border-t border-border bg-transparent"
          style={{ height }}
        >
          {!hasNodes ? (
            <div className={cn("absolute inset-0 py-3", surfaceInset)}>
              <Skeleton className="size-full rounded-[10px]" />
            </div>
          ) : (
            <>
              {/* Visual only; the list above carries every node and link. */}
              <svg
                ref={svgRef}
                aria-hidden
                width="100%"
                height={height}
                className="block cursor-grab touch-pan-y select-none active:cursor-grabbing"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={(e) => endPointer(e, true)}
                onPointerCancel={(e) => endPointer(e, false)}
              >
                <defs>
                  {(
                    [
                      ["muted", "var(--muted-foreground)", 0.7],
                      ["strong", "var(--foreground)", 1],
                      ["dim", "var(--muted-foreground)", 0.2],
                    ] as const
                  ).map(([tone, color, opacity]) => (
                    <marker
                      key={tone}
                      id={`${uid}-${tone}`}
                      viewBox="0 0 8 8"
                      refX={8}
                      refY={4}
                      markerWidth={8}
                      markerHeight={8}
                      markerUnits="userSpaceOnUse"
                      orient="auto"
                    >
                      <path
                        d="M0,0.5 L8,4 L0,7.5 Z"
                        fill={color}
                        fillOpacity={opacity}
                      />
                    </marker>
                  ))}
                </defs>
                <g
                  transform={`translate(${view.x},${view.y}) scale(${view.k})`}
                >
                  {shown.edges.map((pe) => {
                    const e = edgeByKey.get(pe.key)
                    if (!e) return null
                    const style = EDGE_STYLE[kindOf(e)]
                    const tone = edgeTone(pe)
                    return (
                      <path
                        key={pe.key}
                        d={routePath(pe.route)}
                        fill="none"
                        stroke={
                          tone === "strong"
                            ? "var(--foreground)"
                            : "var(--muted-foreground)"
                        }
                        strokeOpacity={
                          tone === "strong" ? 1 : tone === "dim" ? 0.2 : 0.7
                        }
                        strokeWidth={
                          e.strength !== undefined
                            ? 1 + e.strength * 2.5
                            : style.width
                        }
                        strokeDasharray={pe.reversed ? "3 3" : style.dash}
                        strokeLinecap={
                          style.dash === DOTTED ? "round" : undefined
                        }
                        markerEnd={
                          style.arrow ? `url(#${uid}-${tone})` : undefined
                        }
                        className="transition-[stroke-opacity] duration-200 motion-reduce:transition-none"
                      />
                    )
                  })}

                  {edgeLabels.map((l) => {
                    const e = edgeByKey.get(l.id)
                    const tone = e ? edgeTone(e) : "muted"
                    return (
                      <g
                        key={l.id}
                        opacity={tone === "dim" ? 0.3 : 1}
                        className="transition-opacity duration-200 motion-reduce:transition-none"
                      >
                        <title>{l.full}</title>
                        <rect
                          x={l.box.x}
                          y={l.box.y}
                          width={l.box.w}
                          height={l.box.h}
                          rx={l.box.h / 2}
                          fill="var(--card)"
                          stroke="var(--border)"
                        />
                        <text
                          x={l.box.x + l.box.w / 2}
                          y={l.box.y + l.box.h / 2 + 3.5}
                          textAnchor="middle"
                          fontSize={10}
                          fill={
                            tone === "strong"
                              ? "var(--foreground)"
                              : "var(--muted-foreground)"
                          }
                        >
                          {l.text}
                        </text>
                      </g>
                    )
                  })}

                  {[...shown.nodes.values()].map((n) => {
                    const node = graph.byId.get(n.id)
                    if (!node) return null
                    const isSelected = n.id === selectedId
                    const dim = neighbors !== null && !neighbors.has(n.id)
                    const health = node.health ? HEALTH[node.health] : null
                    const meta = [node.sublabel, node.kind]
                      .filter(Boolean)
                      .join(" · ")
                    const healthW = health
                      ? estimateTextWidth(health.label, 10) + 18
                      : 0
                    const o = outlineById.get(n.id)
                    const toggleText = o?.hasChildren
                      ? o.expanded
                        ? "−"
                        : `+${o.hiddenCount}`
                      : null
                    const toggleW = toggleText
                      ? Math.max(20, estimateTextWidth(toggleText, 10) + 12)
                      : 0
                    const toggleAt =
                      direction === "right"
                        ? { x: n.w, y: n.h / 2 }
                        : { x: n.w / 2, y: n.h }
                    return (
                      <g
                        key={n.id}
                        data-node-id={n.id}
                        transform={`translate(${n.x - n.w / 2},${n.y - n.h / 2})`}
                        opacity={dim ? 0.35 : 1}
                        className="cursor-pointer transition-opacity duration-200 motion-reduce:transition-none"
                      >
                        <motion.g
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={genuiMotion.fade}
                        >
                          <title>
                            {[node.label, meta, health?.label]
                              .filter(Boolean)
                              .join(" · ")}
                          </title>
                          {listFocused && n.id === activeId && (
                            <rect
                              x={-4}
                              y={-4}
                              width={n.w + 8}
                              height={n.h + 8}
                              rx={11}
                              fill="none"
                              stroke="var(--ring)"
                              strokeWidth={2}
                            />
                          )}
                          <rect
                            width={n.w}
                            height={n.h}
                            rx={8}
                            fill="var(--card)"
                            stroke={
                              isSelected
                                ? "var(--foreground)"
                                : node.health === "critical"
                                  ? "var(--destructive)"
                                  : "var(--border)"
                            }
                            strokeWidth={isSelected ? 2 : 1}
                          />
                          <text
                            x={12}
                            y={21}
                            fontSize={12}
                            fontWeight={600}
                            fill="var(--foreground)"
                          >
                            {truncateToWidth(node.label, n.w - 24, 12, true)}
                          </text>
                          {meta && (
                            <text
                              x={12}
                              y={38}
                              fontSize={10}
                              fill="var(--muted-foreground)"
                            >
                              {truncateToWidth(meta, n.w - 24 - healthW, 10)}
                            </text>
                          )}
                          {health && (
                            <g
                              transform={`translate(${n.w - 10 - healthW + 4},${28})`}
                            >
                              <health.Icon
                                x={0}
                                y={0}
                                width={12}
                                height={12}
                                color={health.color}
                              />
                              <text
                                x={15}
                                y={10}
                                fontSize={10}
                                fill={
                                  node.health === "critical"
                                    ? "var(--destructive)"
                                    : "var(--muted-foreground)"
                                }
                              >
                                {health.label}
                              </text>
                            </g>
                          )}
                          {toggleText && (
                            <g
                              data-toggle-id={n.id}
                              transform={`translate(${toggleAt.x},${toggleAt.y})`}
                            >
                              {/* Larger hit area than the pill. */}
                              <rect
                                x={-Math.max(14, toggleW / 2 + 4)}
                                y={-14}
                                width={Math.max(28, toggleW + 8)}
                                height={28}
                                fill="transparent"
                              />
                              <rect
                                x={-toggleW / 2}
                                y={-9}
                                width={toggleW}
                                height={18}
                                rx={9}
                                fill="var(--card)"
                                stroke="var(--border)"
                              />
                              <text
                                y={3.5}
                                textAnchor="middle"
                                fontSize={10}
                                fontWeight={600}
                                fill="var(--muted-foreground)"
                              >
                                {toggleText}
                              </text>
                            </g>
                          )}
                        </motion.g>
                      </g>
                    )
                  })}
                </g>
              </svg>

              <div className="absolute top-3 right-3 flex gap-1.5">
                <WhyDisabled
                  when={view.k <= ZOOM.minK + 0.001}
                  reason="Fully zoomed out"
                >
                  <IconTip label="Zoom out">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="Zoom out"
                      onClick={() => zoomBy(1 / 1.25)}
                      disabled={view.k <= ZOOM.minK + 0.001}
                    >
                      <MinusIcon />
                    </Button>
                  </IconTip>
                </WhyDisabled>
                <WhyDisabled
                  when={view.k >= ZOOM.maxK - 0.001}
                  reason="Fully zoomed in"
                >
                  <IconTip label="Zoom in">
                    <Button
                      size="icon-sm"
                      variant="outline"
                      aria-label="Zoom in"
                      onClick={() => zoomBy(1.25)}
                      disabled={view.k >= ZOOM.maxK - 0.001}
                    >
                      <PlusIcon />
                    </Button>
                  </IconTip>
                </WhyDisabled>
                <IconTip label="Fit to view">
                  <Button
                    size="icon-sm"
                    variant="outline"
                    aria-label="Fit to view"
                    onClick={() =>
                      setManualView(
                        fitView(target.bounds, frameW, height, {
                          minK: ZOOM.minK,
                        }),
                      )
                    }
                  >
                    <MaximizeIcon />
                  </Button>
                </IconTip>
              </div>
              {listFocused && (
                <p
                  aria-hidden
                  className="absolute bottom-3 left-3 rounded-full border bg-card px-3 py-1 text-[13px] leading-4 text-muted-foreground"
                >
                  {outline
                    ? "↑ ↓ to move, → ← to open or close"
                    : "↑ ↓ to move between nodes"}
                </p>
              )}
            </>
          )}
        </div>

        {selected && selectedId && (
          <motion.section
            key={selectedId}
            aria-label={`Details: ${selected.label}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={genuiMotion.fade}
            className="flex flex-col gap-2 border-t border-border px-3 py-2"
          >
            <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
              <div className="flex min-w-0 flex-col gap-0.5">
                <h4
                  ref={headingRef}
                  tabIndex={-1}
                  className={cn(genuiType.title, "outline-none")}
                >
                  {selected.label}
                </h4>
                {(selected.kind || selected.sublabel) && (
                  <p className={genuiType.meta}>
                    {[selected.sublabel, selected.kind]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
              </div>
              {selected.health && (
                <Badge
                  variant={
                    selected.health === "critical"
                      ? "destructive"
                      : selected.health === "warning"
                        ? "warning"
                        : "success"
                  }
                  className="mt-0.5"
                >
                  {React.createElement(HEALTH[selected.health].Icon, {
                    "aria-hidden": true,
                  })}
                  {HEALTH[selected.health].label}
                </Badge>
              )}
            </div>

            {selected.detail && (
              <p className={genuiType.body}>{selected.detail}</p>
            )}

            {groups.length > 0 && (
              <dl className="flex flex-col gap-2">
                {groups.map((g) => (
                  <div
                    key={g.title}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <dt className={cn(genuiType.label, "w-20 shrink-0")}>
                      {g.title}
                    </dt>
                    <dd className="min-w-0 flex-1">
                      <ul className="flex flex-wrap gap-2">
                        {g.items.map((item) => (
                          <li
                            key={item.id}
                            className="flex items-center gap-1.5"
                          >
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`${item.label} (${g.title.toLowerCase()})`}
                              onClick={() => {
                                select(item.id, true)
                                headingRef.current?.focus()
                              }}
                            >
                              {item.label}
                            </Button>
                            {item.edgeLabel && (
                              <span className="text-[13px] leading-4 text-muted-foreground">
                                {item.edgeLabel}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ))}
              </dl>
            )}

            {(url || (selectable && !locked)) && (
              <div className="flex flex-wrap gap-2">
                {url && (
                  <a
                    href={url.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Open
                    <ExternalLinkIcon aria-hidden />
                    <span className="sr-only">
                      {` ${selected.label} (opens in a new tab)`}
                    </span>
                  </a>
                )}
                {selectable && !locked && (
                  <>
                    <WhyDisabled className="inline-flex sm:ml-auto" when={streaming} reason="Still loading…">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="sm:ml-auto"
                        aria-label={`Explain ${selected.label}`}
                        disabled={streaming}
                        onClick={() => send("explain", selectedId)}
                      >
                        Explain this
                      </Button>
                    </WhyDisabled>
                    <WhyDisabled when={streaming} reason="Still loading…">
                      <Button
                        size="sm"
                        aria-label={`Choose ${selected.label}`}
                        disabled={streaming}
                        onClick={() => send("select", selectedId)}
                      >
                        Choose
                      </Button>
                    </WhyDisabled>
                  </>
                )}
              </div>
            )}
          </motion.section>
        )}

        {hasNodes && (
          <div
            className={cn(
              "flex flex-col gap-1.5 border-t border-border py-3",
              surfaceInset,
            )}
          >
            {(kindsPresent.length > 0 || healthPresent.length > 0) && (
              <ul
                aria-label="Legend"
                className="flex flex-wrap gap-x-3 gap-y-1.5 text-[13px] leading-4 text-muted-foreground"
              >
                {kindsPresent.map((k) => (
                  <li key={k} className="flex items-center gap-1.5">
                    <LegendLine kind={k} />
                    {EDGE_STYLE[k].legend}
                  </li>
                ))}
                {target.backEdges.length > 0 && (
                  <li className="flex items-center gap-1.5">
                    <LegendLine kind="link" back />
                    Loop, drawn backwards
                  </li>
                )}
                {healthPresent.map((h) => {
                  const { Icon, label } = HEALTH[h]
                  return (
                    <li key={h} className="flex items-center gap-1.5">
                      <Icon
                        aria-hidden
                        className={cn(
                          "size-3.5",
                          h === "critical" && "text-destructive",
                          h === "warning" && "text-foreground",
                        )}
                      />
                      {label}
                    </li>
                  )
                })}
              </ul>
            )}
            {notes.map((note) => (
              <p key={note} className={genuiType.meta}>
                {note}
              </p>
            ))}
          </div>
        )}

        {(streaming || selectable) && (
          // Kept mounted (visually hidden while idle) so the decision is
          // announced when it lands.
          <SurfaceFooter
            aria-live="polite"
            className={cn(
              !streaming && !(status === "submitted" && decision) && "sr-only",
            )}
          >
            {status === "submitted" && decision ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4" />
                {decision.action === "explain"
                  ? `Asked to explain ${chosenLabel}`
                  : `Chose ${chosenLabel}`}
              </p>
            ) : streaming ? (
              <p className={genuiType.meta}>
                <ShimmeringText
                  text="Mapping relationships…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </p>
            ) : null}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
