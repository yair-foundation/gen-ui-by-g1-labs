"use client"

import {
  CheckIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Undo2Icon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import * as React from "react"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import {
  genuiMotion,
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
} from "@/components/genui/surface"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type {
  MechanismInput,
  MechanismPart,
  MechanismResult,
} from "./mechanism.schema"
import {
  AZIMUTH,
  buildScene,
  describeMotion,
  describePart,
  extremesOf,
  figureHeight,
  fitView,
  hasMotion,
  normalizeAngle,
  projectionFor,
  readyParts,
  type SceneItem,
  viewLabel,
} from "./mechanism-utils"

export type MechanismStatus = "streaming" | "ready" | "submitted"

export type MechanismProps = Partial<Omit<MechanismInput, "parts">> & {
  /** Parts may be partial while the tool call streams. */
  parts?: Partial<MechanismPart>[]
  /** Lifecycle, controlled by the host. */
  status?: MechanismStatus
  /** Called once when the user asks about a part (only when askable). */
  onResult?: (result: MechanismResult) => void
  /** A question from history. Restores the selection; never calls onResult. */
  result?: MechanismResult
  className?: string
}

/** The drawing's width; its height follows the object (figureHeight). */
const W = 640
/** One button press turns the view this far. */
const TURN_STEP = 45
/** Degrees of turn per pixel dragged. */
const DRAG_RATE = 0.6
/** Dash length plus gap for flow along a pipe, and its speed in px per second. */
const FLOW_DASH = "6 9"
const FLOW_PX_PER_SECOND = 30

const SHADE_LEVELS = [0, 1, 2, 3] as const

/** How much of a see-through shell's faces shows: enough to read as glass. */
const GHOST_OPACITY = 0.3

/**
 * Tones by facing, darkest (turned from the light) to lightest, then the
 * top face. Light mode adds ink to darken; dark mode adds light to brighten,
 * so the ramps run opposite ways (after Anatomy's two themes).
 */
// Ink in light: 17, 12, 8, 4 and 1.5% for the top. In dark: 5, 10, 15, 20 and
// 24%. The accent's sky: 42 to 8% in light, 22 to 52% in dark.

/** Translucent fills over the card, for extruded parts (boxes, gears). */
const SHADE_CLASS = [
  "fill-foreground/[0.17] dark:fill-foreground/[0.05]",
  "fill-foreground/[0.12] dark:fill-foreground/[0.10]",
  "fill-foreground/[0.08] dark:fill-foreground/[0.15]",
  "fill-foreground/[0.04] dark:fill-foreground/[0.20]",
]
const ACCENT_SHADE_CLASS = [
  "fill-sky-500/[0.42] dark:fill-sky-400/[0.22]",
  "fill-sky-500/[0.32] dark:fill-sky-400/[0.30]",
  "fill-sky-500/[0.24] dark:fill-sky-400/[0.38]",
  "fill-sky-500/[0.16] dark:fill-sky-400/[0.46]",
]
const TOP_CLASS = "fill-foreground/[0.015] dark:fill-foreground/[0.24]"
const ACCENT_TOP_CLASS = "fill-sky-500/[0.08] dark:fill-sky-400/[0.52]"

/**
 * Round parts' facets: the same tones mixed opaque into the card and stroked
 * in their own colour, so the many abutting facets show no seams. Index 4 is
 * a face that looks up. Dark mixes in sRGB, which matches the boxes' alpha
 * fills; OKLab would leave light-on-black faces far darker. Written out in
 * full so Tailwind finds every class.
 */
const FACET_CLASS = [
  "fill-[color-mix(in_oklab,var(--card),var(--foreground)_17%)] stroke-[color-mix(in_oklab,var(--card),var(--foreground)_17%)] dark:fill-[color-mix(in_srgb,var(--card),var(--foreground)_5%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--foreground)_5%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--foreground)_12%)] stroke-[color-mix(in_oklab,var(--card),var(--foreground)_12%)] dark:fill-[color-mix(in_srgb,var(--card),var(--foreground)_10%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--foreground)_10%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--foreground)_8%)] stroke-[color-mix(in_oklab,var(--card),var(--foreground)_8%)] dark:fill-[color-mix(in_srgb,var(--card),var(--foreground)_15%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--foreground)_15%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--foreground)_4%)] stroke-[color-mix(in_oklab,var(--card),var(--foreground)_4%)] dark:fill-[color-mix(in_srgb,var(--card),var(--foreground)_20%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--foreground)_20%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--foreground)_1.5%)] stroke-[color-mix(in_oklab,var(--card),var(--foreground)_1.5%)] dark:fill-[color-mix(in_srgb,var(--card),var(--foreground)_24%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--foreground)_24%)]",
]
const ACCENT_FACET_CLASS = [
  "fill-[color-mix(in_oklab,var(--card),var(--color-sky-500)_42%)] stroke-[color-mix(in_oklab,var(--card),var(--color-sky-500)_42%)] dark:fill-[color-mix(in_srgb,var(--card),var(--color-sky-400)_22%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--color-sky-400)_22%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--color-sky-500)_32%)] stroke-[color-mix(in_oklab,var(--card),var(--color-sky-500)_32%)] dark:fill-[color-mix(in_srgb,var(--card),var(--color-sky-400)_30%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--color-sky-400)_30%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--color-sky-500)_24%)] stroke-[color-mix(in_oklab,var(--card),var(--color-sky-500)_24%)] dark:fill-[color-mix(in_srgb,var(--card),var(--color-sky-400)_38%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--color-sky-400)_38%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--color-sky-500)_16%)] stroke-[color-mix(in_oklab,var(--card),var(--color-sky-500)_16%)] dark:fill-[color-mix(in_srgb,var(--card),var(--color-sky-400)_46%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--color-sky-400)_46%)]",
  "fill-[color-mix(in_oklab,var(--card),var(--color-sky-500)_8%)] stroke-[color-mix(in_oklab,var(--card),var(--color-sky-500)_8%)] dark:fill-[color-mix(in_srgb,var(--card),var(--color-sky-400)_52%)] dark:stroke-[color-mix(in_srgb,var(--card),var(--color-sky-400)_52%)]",
]

function Solid({
  item,
  accent,
  active,
}: {
  item: Extract<SceneItem, { kind: "solid" }>
  accent: boolean
  active: boolean
}) {
  const shades = accent ? ACCENT_SHADE_CLASS : SHADE_CLASS
  const edge = active
    ? "stroke-choice"
    : accent
      ? "stroke-sky-600 dark:stroke-sky-400"
      : "stroke-foreground/75"
  const facetClass = accent ? ACCENT_FACET_CLASS : FACET_CLASS
  // The faces: opaque for a solid, faint for a see-through shell (its fills
  // are grouped, so overlapping faces fade together, not one over another).
  const faces = (
    <>
      {item.facets?.map((f, i) => (
        <path
          // biome-ignore lint/suspicious/noArrayIndexKey: facets are rebuilt in painting order each frame
          key={i}
          d={f.d}
          strokeWidth={0.6}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className={facetClass[f.shade] ?? facetClass[2]}
        />
      ))}
      {!item.ghost && item.paths.fill && (
        <path d={item.paths.fill} className="fill-card" />
      )}
      {SHADE_LEVELS.map((level) =>
        item.paths.shades[level] ? (
          <path
            key={level}
            d={item.paths.shades[level]}
            className={shades[level]}
          />
        ) : null,
      )}
      {!item.topLast && item.paths.top && (
        <path
          d={item.paths.top}
          className={accent ? ACCENT_TOP_CLASS : TOP_CLASS}
        />
      )}
    </>
  )
  return (
    <>
      {item.ghost ? <g opacity={GHOST_OPACITY}>{faces}</g> : faces}
      {item.detail && (
        <path
          d={item.detail}
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          className={cn(
            "fill-none stroke-[0.7]",
            accent
              ? "stroke-sky-600/50 dark:stroke-sky-400/50"
              : "stroke-foreground/30",
          )}
        />
      )}
      {item.dots.map(([x, y], i) => (
        <circle
          // biome-ignore lint/suspicious/noArrayIndexKey: bolt heads have no identity beyond their place
          key={i}
          cx={x}
          cy={y}
          r={1.1}
          className="fill-foreground/55"
        />
      ))}
      {item.marks && !item.topLast && (
        <path
          d={item.marks}
          vectorEffect="non-scaling-stroke"
          className={cn("fill-none", edge, "stroke-[0.8] opacity-70")}
        />
      )}
      <path
        d={item.paths.crease}
        vectorEffect="non-scaling-stroke"
        className="fill-none stroke-foreground/25 stroke-[0.8]"
      />
      <path
        d={item.paths.outline}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={cn("fill-none", edge, active ? "stroke-2" : "stroke-1")}
      />
      {item.topLast && (
        <>
          <path d={item.paths.top} className="fill-card" />
          <path
            d={item.paths.top}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            className={cn(
              accent ? ACCENT_TOP_CLASS : TOP_CLASS,
              edge,
              active ? "stroke-2" : "stroke-1",
            )}
          />
          {item.marks && (
            <path
              d={item.marks}
              vectorEffect="non-scaling-stroke"
              className={cn("fill-none", edge, "stroke-[0.8] opacity-70")}
            />
          )}
        </>
      )}
    </>
  )
}

function Pipe({
  item,
  accent,
  active,
  t,
}: {
  item: Extract<SceneItem, { kind: "pipe" }>
  accent: boolean
  active: boolean
  t: number
}) {
  if (item.stream) {
    // Only the flow, in open space: dashes that move when the pipe flows.
    return (
      <>
        {/* A wide invisible stroke so the stream can be hovered and tapped. */}
        <path
          d={item.d}
          strokeWidth={Math.max(10, item.width)}
          strokeLinecap="round"
          className="fill-none stroke-transparent"
        />
        <path
          d={item.d}
          strokeWidth={Math.max(1.6, item.width * 0.5)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={FLOW_DASH}
          strokeDashoffset={-t * FLOW_PX_PER_SECOND * item.flow}
          className={cn(
            "fill-none",
            active ? "stroke-choice" : "stroke-sky-500 dark:stroke-sky-400",
          )}
        />
      </>
    )
  }
  return (
    <>
      {/* Outline, then the tube's body, then what flows inside it. */}
      <path
        d={item.d}
        strokeWidth={item.width + 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "fill-none",
          active
            ? "stroke-choice"
            : accent
              ? "stroke-sky-600 dark:stroke-sky-400"
              : "stroke-foreground/75",
        )}
      />
      <path
        d={item.d}
        strokeWidth={item.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="fill-none stroke-card"
      />
      <path
        d={item.d}
        strokeWidth={item.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(
          "fill-none",
          accent ? "stroke-sky-500/15" : "stroke-foreground/[0.05]",
        )}
      />
      {item.flow > 0 && (
        <path
          d={item.d}
          strokeWidth={Math.max(1.4, item.width * 0.45)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={FLOW_DASH}
          strokeDashoffset={-t * FLOW_PX_PER_SECOND * item.flow}
          className="fill-none stroke-sky-500 dark:stroke-sky-400"
        />
      )}
    </>
  )
}

export function Mechanism({
  title,
  caption,
  parts = [],
  askable = false,
  status: statusProp,
  onResult,
  result,
  className,
}: MechanismProps) {
  const [decision, setDecision] = React.useState<MechanismResult | null>(
    result ?? null,
  )
  const [activeId, setActiveId] = React.useState<string | null>(
    result?.partId ?? null,
  )
  const [hoverId, setHoverId] = React.useState<string | null>(null)
  const [azimuth, setAzimuth] = React.useState(AZIMUTH)
  const [playing, setPlaying] = React.useState(true)
  const [inView, setInView] = React.useState(true)
  const [t, setT] = React.useState(0)
  const [announcement, setAnnouncement] = React.useState("")
  const [listFocused, setListFocused] = React.useState(false)

  const figureRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef(new Map<string, HTMLDivElement>())
  const dragRef = React.useRef<{
    x: number
    azimuth: number
    moved: boolean
    id: string | null
  } | null>(null)
  const reduceMotion = useReducedMotion()
  const titleId = React.useId()
  const hintId = React.useId()

  const status: MechanismStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const ready = readyParts(parts)
  const shapesKey = JSON.stringify(ready.map((p) => [p.shape, p.motion]))
  // biome-ignore lint/correctness/useExhaustiveDependencies: shapesKey stands for the parts' geometry
  const { view, H } = React.useMemo(() => {
    const points = ready.flatMap(extremesOf)
    const height = figureHeight(points, W)
    return { view: fitView(points, W, height, 28), H: height }
  }, [shapesKey])
  const P = view ? projectionFor(view, azimuth, W, H) : null
  const scene = P ? buildScene(ready, P, t) : []
  const byId = new Map(ready.map((p) => [p.id, p]))
  const moving = hasMotion(ready) && !reduceMotion
  const animating = moving && playing && inView && !streaming
  const shownId = hoverId ?? activeId
  const shown = shownId ? (byId.get(shownId) ?? null) : null
  const active = activeId ? (byId.get(activeId) ?? null) : null
  const asked = decision ? (byId.get(decision.partId) ?? null) : null
  const turned = normalizeAngle(azimuth) !== AZIMUTH

  // Frame loop: only while something moves, it's on screen and not paused.
  React.useEffect(() => {
    if (!animating) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      // Cap the step so a background tab doesn't jump the motion.
      setT((prev) => prev + Math.min(0.1, (now - last) / 1000))
      last = now
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [animating])

  // Pause off screen.
  React.useEffect(() => {
    const el = figureRef.current
    if (!el || typeof IntersectionObserver === "undefined") return
    const observer = new IntersectionObserver(([entry]) =>
      setInView(entry?.isIntersecting ?? true),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const turnTo = (next: number) => {
    const a = normalizeAngle(next)
    setAzimuth(a)
    setAnnouncement(viewLabel(a))
  }

  const togglePlaying = () => {
    setPlaying((p) => !p)
    setAnnouncement(playing ? "Paused" : "Playing")
  }

  const partAt = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null
    return target.closest("[data-part]")?.getAttribute("data-part") ?? null
  }

  // Drag sideways to turn; a press without a drag inspects the part under it.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragRef.current = {
      x: e.clientX,
      azimuth,
      moved: false,
      id: partAt(e.target),
    }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) {
      if (e.pointerType === "mouse") setHoverId(partAt(e.target))
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    // Pixels in the drawing's own units, so the rate holds at any width.
    const dx = ((e.clientX - drag.x) * W) / Math.max(1, rect.width)
    if (!drag.moved && Math.abs(dx) < 4) return
    drag.moved = true
    setHoverId(null)
    setAzimuth(normalizeAngle(drag.azimuth - dx * DRAG_RATE))
  }
  const onPointerUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag) return
    if (drag.moved) {
      setAnnouncement(viewLabel(azimuth))
      return
    }
    setActiveId(drag.id && drag.id !== activeId ? drag.id : null)
  }

  /** Arrow keys move through the parts list; Home and End jump. */
  const onItemKeyDown = (e: React.KeyboardEvent, id: string) => {
    const i = ready.findIndex((p) => p.id === id)
    let next = i
    if (e.key === "ArrowDown" || e.key === "ArrowRight")
      next = Math.min(ready.length - 1, i + 1)
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft")
      next = Math.max(0, i - 1)
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = ready.length - 1
    else return
    e.preventDefault()
    const part = ready[next]
    if (!part) return
    setActiveId(part.id)
    itemRefs.current.get(part.id)?.focus()
  }

  const ask = () => {
    if (status !== "ready" || !active) return
    const next = { action: "explain", partId: active.id } as const
    setDecision(next)
    onResult?.(next)
  }

  const tabStop = activeId ?? ready[0]?.id
  const loading = streaming || !view
  const summary = [
    title,
    caption,
    `${ready.length} ${ready.length === 1 ? "part" : "parts"}`,
    moving ? "Moving parts are animated." : "",
  ]
    .filter(Boolean)
    .join(". ")

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="mechanism"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Mechanism"}
        className={className}
      >
        <SurfaceHeader className="flex-row items-start justify-between gap-3 pb-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            ) : (
              <Skeleton className="h-5 w-48" />
            )}
            {caption && (
              <p className={cn(genuiType.meta, "truncate")} title={caption}>
                {caption}
              </p>
            )}
          </div>
          <div className="-mr-1.5 flex shrink-0 items-center">
            {moving && (
              <IconTip label={playing ? "Pause" : "Play"}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={playing ? "Pause motion" : "Play motion"}
                  onClick={togglePlaying}
                >
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </Button>
              </IconTip>
            )}
            <IconTip label="Turn left">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Turn the view left"
                disabled={!view}
                onClick={() => turnTo(azimuth + TURN_STEP)}
              >
                <RotateCcwIcon />
              </Button>
            </IconTip>
            <IconTip label="Turn right">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Turn the view right"
                disabled={!view}
                onClick={() => turnTo(azimuth - TURN_STEP)}
              >
                <RotateCwIcon />
              </Button>
            </IconTip>
            <WhyDisabled
              reason={!turned ? "Already at the front view" : undefined}
            >
              <IconTip label="Front view">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Back to the front view"
                  disabled={!turned}
                  onClick={() => turnTo(AZIMUTH)}
                >
                  <Undo2Icon />
                </Button>
              </IconTip>
            </WhyDisabled>
          </div>
        </SurfaceHeader>

        {/* The parts for assistive tech and keyboard; the figure mirrors it. */}
        {ready.length > 0 && (
          <div className="sr-only">
            <p>{summary}</p>
            <p id={hintId}>
              Arrow keys move between parts and show each one on the figure.
            </p>
            <div
              role="listbox"
              aria-label={title ? `${title}: parts` : "Parts"}
              aria-describedby={hintId}
              onBlur={() => setListFocused(false)}
            >
              {ready.map((p) => (
                <div
                  key={p.id}
                  ref={(el) => {
                    if (el) itemRefs.current.set(p.id, el)
                    else itemRefs.current.delete(p.id)
                  }}
                  role="option"
                  tabIndex={p.id === tabStop ? 0 : -1}
                  aria-selected={p.id === activeId}
                  onKeyDown={(e) => onItemKeyDown(e, p.id)}
                  onFocus={() => {
                    setListFocused(true)
                    if (p.id !== activeId) setActiveId(p.id)
                  }}
                  onClick={() => setActiveId(p.id)}
                >
                  {describePart(p)}
                </div>
              ))}
            </div>
            <p aria-live="polite">{announcement}</p>
          </div>
        )}

        <div className="border-t border-border px-3 py-3">
          <div
            ref={figureRef}
            className={cn(
              "relative w-full touch-pan-y overflow-hidden rounded-[10px] border border-border bg-transparent select-none",
              view ? "cursor-grab active:cursor-grabbing" : "",
              listFocused && "ring-2 ring-ring/50",
            )}
            style={{ aspectRatio: `${W} / ${H}` }}
            onPointerDown={view ? onPointerDown : undefined}
            onPointerMove={view ? onPointerMove : undefined}
            onPointerUp={view ? onPointerUp : undefined}
            onPointerCancel={() => {
              dragRef.current = null
            }}
            onPointerLeave={() => setHoverId(null)}
          >
            {view && P ? (
              // Visual only; the list above carries every part.
              <svg
                aria-hidden
                viewBox={`0 0 ${W} ${H}`}
                className="absolute inset-0 block size-full"
              >
                {scene.map((item) => {
                  const part = byId.get(item.id)
                  const accent = Boolean(part?.accent)
                  const isActive = item.id === shownId
                  return (
                    <g key={item.id} data-part={item.id}>
                      {item.kind === "solid" ? (
                        <Solid item={item} accent={accent} active={isActive} />
                      ) : (
                        <Pipe
                          item={item}
                          accent={accent}
                          active={isActive}
                          t={t}
                        />
                      )}
                    </g>
                  )
                })}
              </svg>
            ) : (
              <Skeleton className="absolute inset-0 rounded-none" />
            )}
          </div>
        </div>

        <div className="flex items-start justify-between gap-3 border-t border-border px-3 py-3">
          <div aria-live="polite" className="flex min-w-0 flex-col gap-0.5">
            {shown ? (
              <motion.div
                key={shown.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className="flex min-w-0 flex-col gap-0.5"
              >
                <h4 className={genuiType.title}>{shown.label}</h4>
                {(shown.description || describeMotion(shown)) && (
                  <p className={cn(genuiType.body, "text-pretty")}>
                    {shown.description ?? `It ${describeMotion(shown)}.`}
                  </p>
                )}
              </motion.div>
            ) : (
              <p className={genuiType.meta}>
                {loading
                  ? "Drawing the machine…"
                  : "Hover or tap a part to see what it does. Drag to turn the view."}
              </p>
            )}
          </div>
          {askable && (
            <WhyDisabled
              reason={
                streaming
                  ? "Still loading…"
                  : decision
                    ? `Already asked about ${asked?.label ?? "a part"}`
                    : !active
                      ? "Tap a part first"
                      : undefined
              }
            >
              <Button
                size="sm"
                className="shrink-0"
                disabled={status !== "ready" || !active}
                onClick={ask}
              >
                {active ? `Ask about ${active.label}` : "Ask about a part"}
              </Button>
            </WhyDisabled>
          )}
        </div>

        {(streaming || askable) && (
          // Kept mounted (visually hidden while idle) so the question is
          // announced when it lands.
          <SurfaceFooter
            aria-live="polite"
            className={cn(
              !streaming && !(status === "submitted" && decision) && "sr-only",
            )}
          >
            {status === "submitted" && decision ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4" />
                {`Asked about ${asked?.label ?? "a part"}`}
              </p>
            ) : streaming ? (
              <p className={genuiType.meta}>
                <ShimmeringText
                  text="Building the machine…"
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
