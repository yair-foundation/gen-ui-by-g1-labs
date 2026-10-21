"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { CheckIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
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
  ALL,
  canvasBox,
  type DiagramPart as DrawablePart,
  explodeAmount,
  groupParts,
  inflateBox,
  labelPlacement,
  labelPoint,
  normalizeParts,
  normalizeSystems,
  normalizeViewBox,
  offsetAt,
  partTone,
  resolveFilter,
  type Shape,
  STROKE,
  toPercent,
} from "./part-diagram-utils"
import type {
  DiagramPart,
  DiagramSystem,
  PartDiagramInput,
  PartDiagramResult,
  PartShape,
} from "./part-diagram.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type PartDiagramStatus = "streaming" | "ready" | "submitted"

export type PartDiagramProps = Partial<
  Omit<PartDiagramInput, "systems" | "parts">
> & {
  /** Systems and parts may be partial while the tool call streams. */
  systems?: Partial<DiagramSystem>[]
  parts?: (Partial<Omit<DiagramPart, "shapes">> & {
    shapes?: Partial<PartShape>[]
  })[]
  /** Lifecycle, controlled by the host. */
  status?: PartDiagramStatus
  /** Called once when the user asks about a part or system (only when askable). */
  onResult?: (result: PartDiagramResult) => void
  /** A question from history. Restores the selection; never calls onResult. */
  result?: PartDiagramResult
  className?: string
}

/** Parts glide to the slider's position; reduced motion jumps straight there. */
const GLIDE = genuiMotion.glide
const DIM_OPACITY = 0.2
const LINE_OPACITY = 0.8
/** Invisible stroke around every shape, so thin lines are easy to point at. */
const HIT_WIDTH = 14

function ShapeEl({ shape, hit = false }: { shape: Shape; hit?: boolean }) {
  const paint = {
    vectorEffect: "non-scaling-stroke" as const,
    stroke: hit ? "transparent" : undefined,
    strokeWidth: hit ? HIT_WIDTH : (shape.strokeWidth ?? STROKE.default),
    fill: shape.fill ? (hit ? "transparent" : "currentColor") : "none",
    fillOpacity: shape.fill && !hit ? 0.14 : undefined,
  }
  switch (shape.type) {
    case "circle":
      return <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...paint} />
    case "rect":
      return (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.width}
          height={shape.height}
          rx={shape.rx}
          {...paint}
        />
      )
    case "line":
      return (
        <line
          x1={shape.x1}
          y1={shape.y1}
          x2={shape.x2}
          y2={shape.y2}
          {...paint}
        />
      )
    case "polyline":
      return (
        <polyline
          points={shape.points.map(([x, y]) => `${x},${y}`).join(" ")}
          {...paint}
        />
      )
    case "path":
      // `d` was checked against strict path syntax in sanitizeShape.
      return <path d={shape.d} {...paint} />
  }
}

export function PartDiagram({
  title,
  viewBox: viewBoxProp,
  systems: systemsProp,
  parts: partsProp,
  overview,
  askable = false,
  status: statusProp,
  onResult,
  result,
  className,
}: PartDiagramProps) {
  const [decision, setDecision] = React.useState<PartDiagramResult | null>(
    result ?? null,
  )
  // Opens part-way exploded, so the structure shows at once; slide left to assemble.
  const [explode, setExplode] = React.useState(55)
  const [filter, setFilter] = React.useState<string>(
    result && "systemId" in result ? result.systemId : ALL,
  )
  // The part shown with its label: picked by tap or from the list.
  const [activeId, setActiveId] = React.useState<string | null>(
    result && "partId" in result ? result.partId : null,
  )
  const [hoverId, setHoverId] = React.useState<string | null>(null)
  const [listFocused, setListFocused] = React.useState(false)
  const itemRefs = React.useRef(new Map<string, HTMLElement>())
  const titleId = React.useId()
  const hintId = React.useId()
  const sliderLabelId = React.useId()
  const radioName = React.useId()

  // A host-provided "ready" (or nothing) yields to the user's question.
  const status: PartDiagramStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const vbWidth = viewBoxProp?.width
  const vbHeight = viewBoxProp?.height
  const viewBox = React.useMemo(
    () => normalizeViewBox({ width: vbWidth, height: vbHeight }),
    [vbWidth, vbHeight],
  )
  const systems = React.useMemo(
    () => normalizeSystems(systemsProp),
    [systemsProp],
  )
  const parts = React.useMemo(
    () => normalizeParts(partsProp, viewBox),
    [partsProp, viewBox],
  )
  const box = React.useMemo(
    () => canvasBox(viewBox, parts, { minAspect: 0.4, maxAspect: 0.45 }),
    [viewBox, parts],
  )
  const groups = React.useMemo(
    () => groupParts(parts, systems),
    [parts, systems],
  )
  const order = React.useMemo(
    () => groups.flatMap((g) => g.parts.map((p) => p.id)),
    [groups],
  )
  const drawable = parts.length >= 2

  const current = resolveFilter(filter, systems)
  const selectedSystem = systems.find((s) => s.id === current)
  const t = explodeAmount(explode)
  const activePart = parts.find((p) => p.id === activeId)
  const shownId = hoverId ?? activePart?.id ?? null
  const shownPart = parts.find((p) => p.id === shownId)
  const tabStop =
    activePart && order.includes(activePart.id) ? activePart.id : order[0]

  const heading = selectedSystem ? selectedSystem.label : overview?.heading
  const body = selectedSystem ? selectedSystem.summary : overview?.summary

  const askTarget: PartDiagramResult | null = activePart
    ? { action: "explain", partId: activePart.id }
    : selectedSystem
      ? { action: "explain", systemId: selectedSystem.id }
      : null
  const askName = activePart?.label ?? selectedSystem?.label
  const showAsk = askable && !decision && askTarget !== null

  const chooseFilter = (id: string) => {
    setFilter(id)
    if (activePart && id !== ALL && activePart.system !== id) setActiveId(null)
  }

  const ask = () => {
    if (!askTarget || decision || streaming) return
    setDecision(askTarget)
    onResult?.(askTarget)
  }

  // -------------------------------------------------------------------------
  // Pointer: hover shows a label, a tap pins it (or clears it on empty space).

  const partAt = (target: EventTarget | null) =>
    (target as Element | null)
      ?.closest("[data-part-id]")
      ?.getAttribute("data-part-id") ?? null

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "touch") return
    const id = partAt(e.target)
    setHoverId((prev) => (prev === id ? prev : id))
  }

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return
    const id = partAt(e.target)
    setActiveId((prev) => (id && prev !== id ? id : null))
  }

  // -------------------------------------------------------------------------
  // Accessible list: the keyboard path to every part.

  const focusPart = (id: string | undefined) => {
    if (!id) return
    setActiveId(id)
    itemRefs.current.get(id)?.focus()
  }

  const onItemKeyDown = (e: React.KeyboardEvent, id: string) => {
    const i = order.indexOf(id)
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        focusPart(order[i + 1])
        break
      case "ArrowUp":
      case "ArrowLeft":
        focusPart(order[i - 1])
        break
      case "Home":
        focusPart(order[0])
        break
      case "End":
        focusPart(order[order.length - 1])
        break
      case "Escape":
        setActiveId(null)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const onListBlur = (e: React.FocusEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null))
      setListFocused(false)
  }

  const summary = drawable
    ? `${title ? `${title}: ` : ""}${parts.length} parts in ${systems.length} systems.`
    : ""

  const decisionName = decision
    ? "partId" in decision
      ? (parts.find((p) => p.id === decision.partId)?.label ?? decision.partId)
      : (systems.find((s) => s.id === decision.systemId)?.label ??
        decision.systemId)
    : null

  // -------------------------------------------------------------------------
  // Label pill over the canvas, in HTML so it stays text-sized at any width.

  const pill = (() => {
    if (!shownPart) return null
    const pct = toPercent(labelPoint(shownPart, t), box)
    const { align, side } = labelPlacement(pct)
    const tx =
      align === "start"
        ? "-8px"
        : align === "end"
          ? "calc(-100% + 8px)"
          : "-50%"
    const ty = side === "above" ? "calc(-100% - 8px)" : "8px"
    return (
      <span
        aria-hidden
        className="pointer-events-none absolute z-10 rounded-full border bg-background px-2 py-0.5 text-[13px] leading-4 font-medium whitespace-nowrap text-foreground shadow-xs dark:shadow-none"
        style={{
          left: `${pct.x}%`,
          top: `${pct.y}%`,
          transform: `translate(${tx}, ${ty})`,
        }}
      >
        {shownPart.label}
      </span>
    )
  })()

  const drawPart = (p: DrawablePart) => {
    const o = offsetAt(p.explode, t)
    const tone = partTone(p, current, shownId)
    const ring = listFocused && p.id === activePart?.id
    const ringBox = ring ? inflateBox(p.bbox, 4) : null
    return (
      <motion.g
        key={p.id}
        data-part-id={p.id}
        initial={{ opacity: 0, x: o.x, y: o.y }}
        animate={{ opacity: tone === "dim" ? DIM_OPACITY : 1, x: o.x, y: o.y }}
        transition={{
          x: GLIDE,
          y: GLIDE,
          opacity: genuiMotion.fade,
        }}
        className="cursor-pointer"
      >
        <g
          stroke="currentColor"
          strokeOpacity={tone === "active" ? 1 : LINE_OPACITY}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {p.shapes.map((s, i) => (
            // Shapes have no ids; their order is stable for a part.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional shapes
            <ShapeEl key={i} shape={s} />
          ))}
        </g>
        <g pointerEvents="visiblePainted">
          {p.shapes.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: positional shapes
            <ShapeEl key={i} shape={s} hit />
          ))}
        </g>
        {ringBox && (
          <rect
            x={ringBox.x}
            y={ringBox.y}
            width={ringBox.w}
            height={ringBox.h}
            rx={4}
            fill="none"
            stroke="var(--ring)"
            strokeWidth={2}
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </motion.g>
    )
  }

  const chips = [{ id: ALL, label: "All" }, ...systems]

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="part-diagram"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Part diagram"}
        className={className}
      >
        {(title || streaming) && (
          <SurfaceHeader className="pb-3">
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          </SurfaceHeader>
        )}

        {/* The parts for assistive tech and keyboard; the canvas mirrors it. */}
        {drawable && (
          <div className="sr-only">
            <p>{summary}</p>
            <p id={hintId}>
              Arrow keys move between parts and show each one on the drawing.
            </p>
            <div
              role="listbox"
              aria-label={title ? `${title}: parts` : "Parts"}
              aria-describedby={hintId}
              onBlur={onListBlur}
            >
              {groups.map((g) => (
                // A listbox groups options with role="group"; a fieldset isn't allowed there.
                // biome-ignore lint/a11y/useSemanticElements: ARIA listbox grouping
                <div key={g.id || "other"} role="group" aria-label={g.label}>
                  {g.parts.map((p) => (
                    <div
                      key={p.id}
                      ref={(el) => {
                        if (el) itemRefs.current.set(p.id, el)
                        else itemRefs.current.delete(p.id)
                      }}
                      role="option"
                      tabIndex={p.id === tabStop ? 0 : -1}
                      aria-selected={p.id === activePart?.id}
                      onKeyDown={(e) => onItemKeyDown(e, p.id)}
                      onFocus={() => {
                        setListFocused(true)
                        if (p.id !== activeId) setActiveId(p.id)
                      }}
                      onClick={() => setActiveId(p.id)}
                    >
                      {`${p.label}, ${g.label}`}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          className={cn(
            "px-3 py-3",
            (title || streaming) && "border-t border-border",
          )}
        >
          {drawable ? (
            <div
              className="relative w-full overflow-hidden rounded-[10px] border border-border bg-transparent"
              style={{ aspectRatio: `${box.w} / ${box.h}` }}
            >
              {/* Visual only; the list above carries every part. */}
              <svg
                aria-hidden
                viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
                preserveAspectRatio="xMidYMid meet"
                className="absolute inset-0 block size-full text-foreground select-none"
                onPointerMove={onPointerMove}
                onPointerLeave={() => setHoverId(null)}
                onPointerUp={onPointerUp}
              >
                {parts.map(drawPart)}
              </svg>
              {pill}
            </div>
          ) : (
            <Skeleton
              className="w-full rounded-[10px]"
              style={{ aspectRatio: `${box.w} / ${box.h}` }}
            />
          )}
        </div>

        {/* Label above, slider with its live value to the right (Halaska UI layout). */}
        <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
          <span id={sliderLabelId} className={genuiType.label}>
            Explode view
          </span>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2">
            <SliderPrimitive.Root
              value={explode}
              min={0}
              max={100}
              step={1}
              largeStep={10}
              disabled={!drawable}
              aria-labelledby={sliderLabelId}
              onValueChange={(v) => setExplode(Array.isArray(v) ? v[0] : v)}
              thumbAlignment="edge"
            >
              <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1 select-none data-disabled:opacity-50">
                <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
                  <SliderPrimitive.Indicator className="h-full bg-choice" />
                </SliderPrimitive.Track>
                <SliderPrimitive.Thumb
                  getAriaLabel={() => "Explode view"}
                  getAriaValueText={(_, v) =>
                    v <= 0
                      ? "Assembled"
                      : v >= 100
                        ? "Fully exploded"
                        : `${v}% exploded`
                  }
                  className="relative block h-6 w-3 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
                />
              </SliderPrimitive.Control>
            </SliderPrimitive.Root>
            <span
              aria-hidden
              className={cn(
                genuiType.value,
                "inline-flex min-w-10 justify-end",
              )}
            >
              <SlidingNumber number={explode} initiallyStable />%
            </span>
            <div
              aria-hidden
              className={cn(genuiType.meta, "flex justify-between gap-3")}
            >
              <span>Assembled</span>
              <span>Exploded</span>
            </div>
          </div>
        </div>

        <fieldset className="min-w-0 border-t border-border px-3 py-3">
          <legend className="sr-only">Highlight a system</legend>
          <div className="flex flex-wrap gap-2">
            {systems.length === 0 && streaming
              ? [0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-20 rounded-full" />
                ))
              : chips.map((s) => {
                  const checked = current === s.id
                  return (
                    <label
                      key={s.id}
                      className={cn(
                        "relative inline-flex h-8 cursor-pointer items-center rounded-full border border-border bg-transparent px-3.5 text-[13px] whitespace-nowrap transition-colors select-none",
                        "has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
                        checked
                          ? "ring-2 ring-choice ring-inset dark:bg-accent"
                          : "hover:bg-accent",
                      )}
                    >
                      <input
                        type="radio"
                        name={radioName}
                        value={s.id}
                        checked={checked}
                        onChange={() => chooseFilter(s.id)}
                        className="sr-only"
                      />
                      {s.label}
                    </label>
                  )
                })}
          </div>
        </fieldset>

        {heading || showAsk ? (
          <div className="flex items-start justify-between gap-3 border-t border-border px-3 py-3">
            <div aria-live="polite" className="flex min-w-0 flex-col gap-1">
              {heading && (
                <motion.h4
                  key={heading}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className={genuiType.title}
                >
                  {heading}
                </motion.h4>
              )}
              {body && (
                <p className={cn(genuiType.body, "text-pretty")}>{body}</p>
              )}
            </div>
            {showAsk && (
              <WhyDisabled when={streaming} reason="Still loading…">
                <IconTip label={`Ask about ${askName}`}>
                  <Button
                    size="sm"
                    className="-mr-2 shrink-0"
                    aria-label={`Ask about ${askName}`}
                    disabled={streaming}
                    onClick={ask}
                  >
                    {activePart
                      ? `Ask about ${activePart.label}`
                      : "Ask about this"}
                  </Button>
                </IconTip>
              </WhyDisabled>
            )}
          </div>
        ) : null}

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
                {`Asked about ${decisionName}`}
              </p>
            ) : streaming ? (
              <p className={genuiType.meta}>
                <ShimmeringText
                  text="Drawing parts…"
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
