"use client"

import * as React from "react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import {
  AccessibilityIcon,
  CheckIcon,
  ChevronLeftIcon,
  MinusIcon,
  PlusIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  type Buckets,
  type FocalKind,
  type LooseSection,
  type ReadySeat,
  type ReadySection,
  type Ring,
  type SeatState,
  TIER_LABELS,
  VIEW,
  announceCountPick,
  areTogether,
  bucketLabels,
  bucketOf,
  bucketStrength,
  columnKinds,
  describeSeat,
  describeSection,
  directionForKey,
  floorArea,
  floorRect,
  focalRect,
  formatEventStart,
  formatPrice,
  indexSeats,
  matchSection,
  moveFocus,
  orderSections,
  pickForCount,
  pluralize,
  priceRange,
  priceSliderRange,
  priceTotal,
  quantize,
  readySections,
  ringTrackPath,
  seatChips,
  seatDetail,
  seatPrice,
  sectionTip,
  sectorLabelPoint,
  sectorPath,
  stageRect,
} from "./venue-map-utils"
import type { VenueMapInput, VenueMapResult } from "./venue-map.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { Segmented } from "@/components/genui/segmented"

export type VenueMapStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "selected"
  | "best-available"
  | "section-requested"
  | "dismissed"

type Decision = Exclude<VenueMapStatus, "streaming" | "ready" | "submitting">
type ColorBy = "price" | "availability"

export type VenueMapProps = Partial<
  Omit<VenueMapInput, "venue" | "event" | "focal" | "sections">
> & {
  venue?: Partial<VenueMapInput["venue"]>
  event?: Partial<NonNullable<VenueMapInput["event"]>>
  focal?: Partial<VenueMapInput["focal"]>
  /** Sections, rows and seats may be partial while the tool call streams. */
  sections?: LooseSection[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: VenueMapStatus
  /**
   * Called with the user's decision. 'open-section' is a request for a
   * section's rows and may come more than once; the others come once.
   */
  onResult?: (result: VenueMapResult) => void
  /** A decision from history. Restores it read-only; never calls onResult. */
  result?: VenueMapResult
  className?: string
}

const FOCAL_LABEL: Record<FocalKind, string> = {
  pitch: "Pitch",
  court: "Court",
  stage: "Stage",
  rink: "Rink",
}

const DECISION_OF: Record<VenueMapResult["action"], Decision> = {
  select: "selected",
  "best-available": "best-available",
  "open-section": "section-requested",
  dismiss: "dismissed",
}

/** The strong ink mixed into the neutral base: one hue, light to strong. */
const mix = (strength: number) =>
  `color-mix(in srgb, var(--venue-ink) ${strength}%, var(--muted))`

const pct = (n: number, of: number) => `${(n / of) * 100}%`

const NO_ROWS: NonNullable<ReadySection["rows"]> = []

// ---------------------------------------------------------------------------
// Drawing

const LINE = {
  fill: "none",
  stroke: "var(--foreground)",
  strokeOpacity: 0.25,
  strokeWidth: 0.75,
} as const

/** The pitch, court, rink or stage, with simple line markings. */
function Focal({
  kind,
  label,
  showLabel,
}: {
  kind?: FocalKind
  label?: string
  showLabel: boolean
}) {
  const f = focalRect()
  const cx = f.x + f.w / 2
  const cy = f.y + f.h / 2
  if (!kind) {
    return (
      <rect
        x={f.x}
        y={f.y}
        width={f.w}
        height={f.h}
        rx={4}
        className="animate-pulse fill-muted motion-reduce:animate-none"
      />
    )
  }
  const text = label ?? FOCAL_LABEL[kind]
  if (kind === "stage") {
    const s = stageRect()
    const floor = floorArea("stage")
    return (
      <g>
        <rect
          x={floor.x}
          y={floor.y}
          width={floor.w}
          height={floor.h}
          rx={3}
          {...LINE}
          strokeDasharray="3 3"
        />
        <rect
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={3}
          fill="var(--muted)"
          stroke="var(--foreground)"
          strokeOpacity={0.35}
          strokeWidth={0.75}
        />
        <text
          x={s.x + s.w / 2}
          y={s.y + s.h / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={9}
          fill="var(--muted-foreground)"
        >
          {text}
        </text>
      </g>
    )
  }
  const markings =
    kind === "pitch" ? (
      <>
        <line x1={cx} y1={f.y} x2={cx} y2={f.y + f.h} {...LINE} />
        <circle cx={cx} cy={cy} r={f.h * 0.16} {...LINE} />
        {[0, 1].map((side) => {
          const box = f.w * 0.15
          const goal = f.w * 0.055
          const x0 = side === 0 ? f.x : f.x + f.w - box
          const g0 = side === 0 ? f.x : f.x + f.w - goal
          return (
            <g key={side}>
              <rect
                x={x0}
                y={cy - f.h * 0.3}
                width={box}
                height={f.h * 0.6}
                {...LINE}
              />
              <rect
                x={g0}
                y={cy - f.h * 0.14}
                width={goal}
                height={f.h * 0.28}
                {...LINE}
              />
            </g>
          )
        })}
      </>
    ) : kind === "court" ? (
      <>
        <line x1={cx} y1={f.y} x2={cx} y2={f.y + f.h} {...LINE} />
        <circle cx={cx} cy={cy} r={f.h * 0.13} {...LINE} />
        {[0, 1].map((side) => {
          const key = f.w * 0.19
          const r = f.h * 0.4
          const edge = side === 0 ? f.x : f.x + f.w
          return (
            <g key={side}>
              <rect
                x={side === 0 ? f.x : f.x + f.w - key}
                y={cy - f.h * 0.15}
                width={key}
                height={f.h * 0.3}
                {...LINE}
              />
              <path
                d={`M${edge} ${cy - r}A${r} ${r} 0 0 ${side === 0 ? 1 : 0} ${edge} ${cy + r}`}
                {...LINE}
              />
            </g>
          )
        })}
      </>
    ) : (
      <>
        <line x1={cx} y1={f.y} x2={cx} y2={f.y + f.h} {...LINE} />
        <line
          x1={cx - f.w * 0.17}
          y1={f.y}
          x2={cx - f.w * 0.17}
          y2={f.y + f.h}
          {...LINE}
        />
        <line
          x1={cx + f.w * 0.17}
          y1={f.y}
          x2={cx + f.w * 0.17}
          y2={f.y + f.h}
          {...LINE}
        />
        <circle cx={cx} cy={cy} r={f.h * 0.13} {...LINE} />
      </>
    )
  return (
    <g>
      <rect
        x={f.x}
        y={f.y}
        width={f.w}
        height={f.h}
        rx={kind === "rink" ? f.h * 0.22 : 2}
        fill="var(--muted)"
        fillOpacity={0.6}
        stroke="var(--foreground)"
        strokeOpacity={0.35}
        strokeWidth={0.75}
      />
      {markings}
      {showLabel && (
        <text
          x={cx}
          y={f.y + f.h - 7}
          textAnchor="middle"
          fontSize={8}
          fill="var(--muted-foreground)"
        >
          {text}
        </text>
      )}
    </g>
  )
}

/** A section's outline and label anchor in viewBox units. */
function shapeOf(s: ReadySection, focal?: FocalKind) {
  if (s.position.kind === "ring") {
    const [x, y] = sectorLabelPoint(s.position)
    return { d: sectorPath(s.position), x, y }
  }
  const r = floorRect(s.position, floorArea(focal))
  return {
    d: `M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z`,
    x: r.x + r.w / 2,
    y: r.y + r.h / 2,
  }
}

function Swatch({ className, style, children }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
        className,
      )}
      style={style}
    >
      {children}
    </span>
  )
}

function GridPart({
  part,
  ...props
}: React.ComponentProps<"div"> & {
  part: "grid" | "row" | "gridcell" | "rowheader"
}) {
  return <div role={part} {...props} />
}

/**
 * A formatted whole amount ("$1,240") whose digits roll as it changes; the
 * currency sign and separators stay put. Falls back to plain text for
 * fractions or digits other than 0–9. Visual only: pair it with sr-only text.
 */
function RollingAmount({ text, amount }: { text: string; amount: number }) {
  const first = text.search(/\d/)
  const last = text.length - 1 - [...text].reverse().join("").search(/\d/)
  if (first < 0 || !Number.isInteger(amount)) return <>{text}</>
  const separator = text.slice(first, last + 1).replace(/\d/g, "")[0]
  return (
    <span className="inline-flex items-baseline">
      {text.slice(0, first)}
      <SlidingNumber
        number={amount}
        thousandSeparator={separator}
        initiallyStable
      />
      {text.slice(last + 1)}
    </span>
  )
}

function SkeletonRows({ rows, seats }: { rows: number; seats: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
        <div key={r} className="flex items-center gap-1 pl-7">
          {Array.from({ length: seats }, (_, s) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
            <Skeleton key={s} className="size-(--seat) rounded-md" />
          ))}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function VenueMap({
  venue,
  event,
  focal,
  sections,
  currency,
  count = 2,
  together: wantTogether = true,
  maxPrice: maxPriceProp,
  colorBy: colorByProp = "price",
  initialSection,
  status: statusProp,
  onResult,
  result,
  className,
}: VenueMapProps) {
  const locale = useGenUILocale()
  const restoredSelect = result?.action === "select" ? result : null
  const [decision, setDecision] = React.useState<Decision | null>(() =>
    result ? DECISION_OF[result.action] : null,
  )
  // Undefined: follow `initialSection` (it may stream in).
  const [openState, setOpenState] = React.useState<string | null | undefined>(
    () =>
      restoredSelect
        ? restoredSelect.sectionId
        : result?.action === "open-section"
          ? null
          : undefined,
  )
  const [picked, setPicked] = React.useState<{
    sectionId: string
    ids: string[]
  } | null>(() =>
    restoredSelect
      ? {
          sectionId: restoredSelect.sectionId,
          ids: restoredSelect.seats.map((s) => s.seatId),
        }
      : null,
  )
  const [countLocal, setCountLocal] = React.useState<number | null>(() =>
    result?.action === "best-available"
      ? result.count
      : restoredSelect
        ? restoredSelect.seats.length
        : null,
  )
  const [maxLocal, setMaxLocal] = React.useState<number | null>(() =>
    result?.action === "best-available" ? (result.maxPrice ?? null) : null,
  )
  const [accessibleOnly, setAccessibleOnly] = React.useState(
    () => result?.action === "best-available" && result.accessible === true,
  )
  const [colorLocal, setColorLocal] = React.useState<ColorBy | null>(null)
  const [activeId, setActiveId] = React.useState<string | null>(() =>
    result?.action === "open-section" ? result.sectionId : null,
  )
  const [hoverId, setHoverId] = React.useState<string | null>(null)
  const [listFocused, setListFocused] = React.useState(false)
  const [focusSeat, setFocusSeat] = React.useState<string | null>(null)
  const [detailSeat, setDetailSeat] = React.useState<string | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const requested = React.useRef(new Set<string>())
  const pendingFocus = React.useRef<"section" | "list" | null>(null)
  const listRef = React.useRef<HTMLDivElement>(null)
  const sectionHeadingRef = React.useRef<HTMLHeadingElement>(null)

  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const mapHintId = `${baseId}-map-hint`
  const gridHintId = `${baseId}-grid-hint`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: VenueMapStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"
  const done =
    status === "selected" ||
    status === "best-available" ||
    status === "section-requested" ||
    status === "dismissed"

  const money = (n: number) => formatPrice(n, currency, locale)
  const ready = React.useMemo(() => readyAndOrdered(sections), [sections])
  const focalKind = focal?.kind
  const goal = Math.min(10, Math.max(1, countLocal ?? count))

  // Filters.
  const range = priceSliderRange(ready)
  const sliderValue = range
    ? Math.min(
        range.max,
        Math.max(range.min, maxLocal ?? maxPriceProp ?? range.max),
      )
    : 0
  // At the top of the slider there's no limit.
  const limit = range && sliderValue < range.max ? sliderValue : undefined
  const filters = { maxPrice: limit, accessibleOnly }
  const anyAccessible = ready.some((s) => s.accessible)
  const colorBy: ColorBy = colorLocal ?? colorByProp

  const priceBuckets = quantize(
    ready.flatMap((s) => (s.price && s.available > 0 ? [s.price.from] : [])),
    4,
    false,
  )
  const availBuckets = quantize(
    ready.flatMap((s) => (s.available > 0 ? [s.available] : [])),
    4,
  )
  const buckets: Buckets | null =
    colorBy === "price" ? priceBuckets : availBuckets
  const shadeValue = (s: ReadySection) =>
    colorBy === "price" ? s.price?.from : s.available

  const byId = new Map(ready.map((s) => [s.id, s]))
  const openId = openState === undefined ? (initialSection ?? null) : openState
  const open = openId ? byId.get(openId) : undefined
  // A finished record without the section's rows falls back to the map.
  const showSection = !!open && !(done && !open.rows?.length)

  // Seat step.
  const rows = open?.rows ?? NO_ROWS
  const index = React.useMemo(() => indexSeats(rows), [rows])
  const chosen =
    picked && open && picked.sectionId === open.id
      ? picked.ids.filter((id) => index.has(id) || done)
      : []
  const order = (id: string) => index.get(id)?.order ?? Number.MAX_VALUE
  const selectedIds = [...chosen].sort((a, b) => order(a) - order(b))
  const selectedSet = new Set(selectedIds)
  const complete = selectedIds.length === goal
  const canSubmit = !locked && showSection && complete
  const isTogether =
    selectedIds.length >= 2 ? areTogether(selectedIds, index) : null
  const totals = open
    ? priceTotal(selectedIds, index, open)
    : { total: 0, complete: true }
  const chips = open ? seatChips(open.label, selectedIds, index) : []
  const seatLabel = (id: string) => {
    const info = index.get(id)
    return info
      ? `Row ${info.rowLabel} seat ${info.seat.label ?? info.seat.id}`
      : id
  }

  // Focus moves with the step: to the section heading, or back to the list.
  React.useEffect(() => {
    if (pendingFocus.current === "section" && showSection) {
      sectionHeadingRef.current?.focus()
    } else if (pendingFocus.current === "list" && !showSection) {
      listRef.current?.focus()
    }
    pendingFocus.current = null
  })

  const openSection = (id: string, viaKeyboard = false) => {
    const s = byId.get(id)
    if (!s || locked) return
    if (s.available <= 0) {
      setAnnouncement(`Section ${s.label} is sold out.`)
      return
    }
    setOpenState(id)
    setActiveId(id)
    setHoverId(null)
    setFocusSeat(null)
    if (picked && picked.sectionId !== id) setPicked(null)
    if (viaKeyboard) pendingFocus.current = "section"
    if (s.rows) {
      setAnnouncement(
        `Section ${s.label}. ${pluralize(s.rows.length, "row")}. Pick ${pluralize(goal, "seat")}.`,
      )
    } else {
      setAnnouncement(`Loading seats for section ${s.label}.`)
      if (!requested.current.has(id)) {
        requested.current.add(id)
        onResult?.({ action: "open-section", sectionId: id })
      }
    }
  }

  const backToMap = () => {
    pendingFocus.current = "list"
    setOpenState(null)
    setAnnouncement("Back to the map.")
  }

  const changeCount = (n: number) => {
    const next = Math.min(10, Math.max(1, n))
    setCountLocal(next)
    setPicked((p) => (p ? { ...p, ids: p.ids.slice(-next) } : p))
    setAnnouncement(pluralize(next, "ticket"))
  }

  const bestAvailable = () => {
    if (locked) return
    setDecision("best-available")
    setAnnouncement(`Asked for the best ${pluralize(goal, "seat")}.`)
    onResult?.({
      action: "best-available",
      count: goal,
      together: wantTogether,
      ...(limit !== undefined ? { maxPrice: limit } : {}),
      ...(accessibleOnly ? { accessible: true as const } : {}),
    })
  }

  const submit = () => {
    if (!canSubmit || !open) return
    setDecision("selected")
    setAnnouncement(`Seats chosen: ${chips.map((c) => c.text).join(", ")}.`)
    onResult?.({
      action: "select",
      sectionId: open.id,
      seats: selectedIds.map((seatId) => {
        const info = index.get(seatId)
        const price = info ? seatPrice(info.seat, open) : undefined
        return { seatId, ...(price !== undefined ? { price } : {}) }
      }),
    })
  }

  const dismiss = () => {
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  // ---- Seat grid helpers
  const stateOf = (seat: ReadySeat): SeatState => seat.state
  const navGrid = rows.map((r) =>
    r.cells.map((c) => (c && stateOf(c) === "available" ? c.id : null)),
  )
  const navIds = new Set(navGrid.flat().filter((id): id is string => !!id))
  const rovingId =
    (focusSeat && navIds.has(focusSeat) ? focusSeat : null) ??
    selectedIds.find((id) => navIds.has(id)) ??
    moveFocus(navGrid, "", "first")
  const seatDomId = (id: string) => `${baseId}-seat-${index.get(id)?.order}`
  const contextOf = (seat: ReadySeat) => ({
    state: stateOf(seat),
    selected: selectedSet.has(seat.id),
    price: open ? seatPrice(seat, open) : undefined,
    formatPrice: money,
  })

  const choose = (seat: ReadySeat) => {
    setFocusSeat(seat.id)
    if (locked || !open || stateOf(seat) !== "available") return
    const pick = pickForCount(selectedIds, goal, seat.id)
    setPicked({ sectionId: open.id, ids: pick.selected })
    setAnnouncement(announceCountPick(pick, goal, seatLabel))
  }

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey) return
    const direction = directionForKey(e.key, e.ctrlKey || e.metaKey)
    if (!direction) return
    const target = (e.target as HTMLElement)
      .closest("[data-seat-id]")
      ?.getAttribute("data-seat-id")
    const from = target && navIds.has(target) ? target : rovingId
    if (!from) return
    e.preventDefault()
    const next = moveFocus(navGrid, from, direction)
    if (!next) return
    setFocusSeat(next)
    document.getElementById(seatDomId(next))?.focus()
  }

  // ---- Section list (keyboard) helpers
  const groups: { tier: ReadySection["tier"]; items: ReadySection[] }[] = []
  for (const s of ready) {
    const g = groups.find((x) => x.tier === s.tier)
    if (g) g.items.push(s)
    else groups.push({ tier: s.tier, items: [s] })
  }
  const navOrder = groups.flatMap((g) => g.items)
  const active =
    (activeId ? byId.get(activeId) : undefined) ??
    navOrder.find((s) => s.available > 0) ??
    navOrder[0]
  const optionId = (id: string) =>
    `${baseId}-section-${navOrder.findIndex((s) => s.id === id)}`

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (!navOrder.length || !active) return
    const i = navOrder.indexOf(active)
    let next: number | null = null
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        next = Math.min(navOrder.length - 1, i + 1)
        break
      case "ArrowUp":
      case "ArrowLeft":
        next = Math.max(0, i - 1)
        break
      case "Home":
        next = 0
        break
      case "End":
        next = navOrder.length - 1
        break
      case "Enter":
      case " ":
        e.preventDefault()
        openSection(active.id, true)
        return
      default:
        return
    }
    e.preventDefault()
    setActiveId(navOrder[next].id)
  }

  // ---- Map: tooltip target, fills
  const tipId = hoverId ?? (listFocused ? (active?.id ?? null) : null)
  const tipSection = tipId ? byId.get(tipId) : undefined
  const tipShape = tipSection ? shapeOf(tipSection, focalKind) : null

  const fillOf = (s: ReadySection) => {
    if (s.available <= 0) return "var(--muted)"
    const v = shadeValue(s)
    if (!buckets || v === undefined) return mix(12)
    return mix(bucketStrength(bucketOf(v, buckets), buckets.count))
  }
  const strengthOf = (s: ReadySection) => {
    const v = shadeValue(s)
    if (s.available <= 0 || !buckets || v === undefined) return 0
    return bucketStrength(bucketOf(v, buckets), buckets.count)
  }
  const ringsInUse = new Set<Ring>(
    ready.flatMap((s) => (s.position.kind === "ring" ? [s.position.ring] : [])),
  )
  const hasFloorSections = ready.some((s) => s.position.kind === "floor")
  const anySoldOut = ready.some((s) => s.available <= 0)
  const anyDimmed = ready.some((s) => {
    const m = matchSection(s, filters)
    return !m.soldOut && m.dimmed
  })

  const title = event?.title ?? venue?.name
  const when = event?.start ? formatEventStart(event.start, locale) : null
  const subtitle = [event?.title ? venue?.name : null, when]
    .filter(Boolean)
    .join(" · ")

  // Dismissed: a compact record for the chat history.
  if (status === "dismissed") {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="venue-map"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader className="pb-3">
            <SurfaceTitle id={titleId}>{title ?? "Choose seats"}</SurfaceTitle>
            {subtitle && <SurfaceDescription>{subtitle}</SurfaceDescription>}
          </SurfaceHeader>
          <SurfaceFooter aria-live="polite">
            <p className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <XIcon aria-hidden className="size-4" />
              Cancelled. No seats were chosen.
            </p>
          </SurfaceFooter>
        </Surface>
      </MotionConfig>
    )
  }

  const kinds = columnKinds(rows)
  const template = [
    "1.5rem",
    ...kinds.map((k) =>
      k === "aisle" ? "calc(var(--seat) * 0.6)" : "var(--seat)",
    ),
    "1.5rem",
  ].join(" ")
  const detail = detailSeat ? index.get(detailSeat) : undefined
  const anyBlocked = rows.some((r) =>
    r.cells.some((c) => c?.state === "blocked"),
  )
  const anyWheelchair = rows.some((r) =>
    r.cells.some((c) => c?.features.includes("accessible")),
  )
  const seatPrices = rows.flatMap((r) =>
    r.cells.flatMap((c) =>
      c && open ? [seatPrice(c, open)].filter((p) => p !== undefined) : [],
    ),
  ) as number[]
  const perSeat = seatPrices.length
    ? Math.min(...seatPrices) === Math.max(...seatPrices)
      ? money(seatPrices[0])
      : `${money(Math.min(...seatPrices))}–${money(Math.max(...seatPrices))}`
    : priceRange(open?.price, money)
  const focalName = focal?.label ?? (focalKind ? FOCAL_LABEL[focalKind] : null)

  // The footer's seats, e.g. "Row F · 7, 8": the section is in the heading.
  const sectionPrefix = open ? `${open.label} · ` : ""
  const seatText = chips.length
    ? chips
        .map((c) =>
          c.text.startsWith(sectionPrefix)
            ? c.text.slice(sectionPrefix.length)
            : c.text,
        )
        .join(" / ")
    : selectedIds.length
      ? selectedIds.join(", ")
      : undefined
  const seatsReady = showSection && !!open?.rows?.length
  // One quiet line under the seats: progress, together, unknown prices.
  const progress = seatsReady
    ? [
        complete ? null : `${selectedIds.length} of ${goal} selected`,
        isTogether === null
          ? null
          : isTogether
            ? "Together"
            : wantTogether
              ? "Not together"
              : null,
        selectedIds.length > 0 && !totals.complete ? "Total at checkout" : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="venue-map"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={cn(
          "@container [--venue-ink:var(--chart-5)] dark:[--venue-ink:var(--chart-1)]",
          className,
        )}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {subtitle && <SurfaceDescription>{subtitle}</SurfaceDescription>}
        </SurfaceHeader>

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {showSection && open ? (
          // ------------------------------------------------------------ Seats
          <motion.div
            key={`section-${open.id}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={genuiMotion.fade}
          >
            <div className="flex min-w-0 items-center gap-2 border-t border-border px-3 py-3">
              {!done && (
                <IconTip label="Back to map">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="-ml-1.5"
                    aria-label="Back to map"
                    onClick={backToMap}
                  >
                    <ChevronLeftIcon aria-hidden />
                  </Button>
                </IconTip>
              )}
              <h4
                ref={sectionHeadingRef}
                tabIndex={-1}
                className={cn(
                  genuiType.body,
                  "shrink-0 font-semibold outline-none",
                )}
              >
                Section {open.label}
                <span className="sr-only">, {TIER_LABELS[open.tier]}</span>
              </h4>
              <p
                className={cn(genuiType.meta, "min-w-0 truncate tabular-nums")}
              >
                {[open.view, perSeat ? `${perSeat} each` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>

            {open.rows?.length ? (
              <>
                <p id={gridHintId} className="sr-only">
                  {`Row ${open.rows[0].label} is nearest the ${(focalName ?? "front").toLowerCase()}. Arrow keys move between available seats; Space or Enter picks one.`}
                </p>
                <section
                  aria-label={`Section ${open.label} seat map`}
                  className="overflow-x-auto overscroll-x-contain border-t border-border [--seat:1.75rem] @max-sm:[--seat:1.5rem]"
                >
                  <div className="mx-auto flex w-max flex-col gap-3 px-6 py-3">
                    {focalName && (
                      <div
                        aria-hidden
                        className="mx-6 flex h-6 items-center justify-center rounded-md border bg-transparent text-[13px] leading-4 text-muted-foreground"
                      >
                        {focalName}
                      </div>
                    )}
                    <GridPart
                      part="grid"
                      aria-label={`Section ${open.label} seats`}
                      aria-describedby={gridHintId}
                      aria-readonly={locked || undefined}
                      onKeyDown={onGridKeyDown}
                      onPointerLeave={() => setDetailSeat(null)}
                      className="flex flex-col gap-1"
                    >
                      {open.rows.map((row, r) => (
                        <motion.div
                          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; labels may repeat
                          key={`${row.label}-${r}`}
                          role="row"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={genuiMotion.fade}
                          className="grid items-center gap-1"
                          style={{ gridTemplateColumns: template }}
                        >
                          <GridPart
                            part="rowheader"
                            className="text-center text-[13px] leading-4 tabular-nums text-muted-foreground"
                          >
                            <span className="sr-only">Row </span>
                            {row.label}
                          </GridPart>
                          {kinds.map((_, col) => {
                            const seat = row.cells[col]
                            // biome-ignore lint/suspicious/noArrayIndexKey: gaps are positional
                            if (!seat) return <span key={col} aria-hidden />
                            const ctx = contextOf(seat)
                            const unavailable = ctx.state !== "available"
                            return (
                              <GridPart key={seat.id} part="gridcell">
                                <button
                                  type="button"
                                  id={seatDomId(seat.id)}
                                  data-seat-id={seat.id}
                                  tabIndex={rovingId === seat.id ? 0 : -1}
                                  aria-label={describeSeat(
                                    seat,
                                    row.label,
                                    ctx,
                                  )}
                                  aria-pressed={ctx.selected}
                                  aria-disabled={
                                    unavailable || locked || undefined
                                  }
                                  onClick={() => choose(seat)}
                                  onFocus={() => setDetailSeat(seat.id)}
                                  onBlur={() =>
                                    setDetailSeat((d) =>
                                      d === seat.id ? null : d,
                                    )
                                  }
                                  onPointerEnter={() => setDetailSeat(seat.id)}
                                  className={cn(
                                    "relative flex size-(--seat) items-center justify-center rounded-md border text-[0.625rem] font-medium tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                                    ctx.selected
                                      ? "border-transparent bg-accent text-foreground ring-2 ring-choice ring-inset"
                                      : unavailable
                                        ? "cursor-not-allowed border-transparent bg-muted text-muted-foreground/70"
                                        : "border-input bg-background text-foreground hover:border-foreground/50",
                                    locked && !unavailable && "cursor-default",
                                  )}
                                >
                                  <span aria-hidden className="flex">
                                    {ctx.selected ? (
                                      <CheckIcon className="size-3.5" />
                                    ) : ctx.state === "taken" ? (
                                      <XIcon className="size-3" />
                                    ) : ctx.state === "blocked" ? (
                                      <MinusIcon className="size-3" />
                                    ) : seat.features.includes("accessible") ? (
                                      <AccessibilityIcon className="size-3.5" />
                                    ) : (
                                      (seat.label ?? seat.id)
                                    )}
                                  </span>
                                </button>
                              </GridPart>
                            )
                          })}
                          <span
                            aria-hidden
                            className="text-center text-[13px] leading-4 tabular-nums text-muted-foreground"
                          >
                            {row.label}
                          </span>
                        </motion.div>
                      ))}
                    </GridPart>
                  </div>
                </section>
                {/*
                  One quiet row under the seats: the legend, or the hovered or
                  focused seat's details in its place (its name says the same).
                  Both sit in one grid cell so the row keeps its height.
                */}
                <div className="grid border-t border-border px-3 py-3 text-[13px] leading-4 text-muted-foreground">
                  <ul
                    aria-label="Legend"
                    className={cn(
                      "col-start-1 row-start-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1",
                      detail && "invisible",
                    )}
                  >
                    <li className="flex items-center gap-1.5">
                      <Swatch className="border-transparent bg-muted">
                        <XIcon className="size-2.5" />
                      </Swatch>
                      Taken
                    </li>
                    {anyBlocked && (
                      <li className="flex items-center gap-1.5">
                        <Swatch className="border-transparent bg-muted">
                          <MinusIcon className="size-2.5" />
                        </Swatch>
                        Unavailable
                      </li>
                    )}
                    {anyWheelchair && (
                      <li className="flex items-center gap-1.5">
                        <Swatch className="border-input bg-background">
                          <AccessibilityIcon className="size-2.5" />
                        </Swatch>
                        Wheelchair space
                      </li>
                    )}
                  </ul>
                  <p
                    aria-hidden
                    className="col-start-1 row-start-1 min-h-4 self-center text-center"
                  >
                    {detail
                      ? seatDetail(
                          detail.seat,
                          detail.rowLabel,
                          contextOf(detail.seat),
                        )
                      : null}
                  </p>
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3 border-t border-border px-3 py-3 [--seat:1.5rem]">
                <p className="text-[13px] leading-5 text-muted-foreground">
                  <ShimmeringText
                    text={`Loading seats for section ${open.label}…`}
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                </p>
                <SkeletonRows rows={4} seats={10} />
              </div>
            )}
          </motion.div>
        ) : (
          // -------------------------------------------------------- Overview
          <>
            {!done && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-border px-3 py-3">
                {/* biome-ignore lint/a11y/useSemanticElements: an inline stepper; a fieldset's legend can't sit inline in the toolbar */}
                <div
                  role="group"
                  aria-label="Tickets"
                  className="flex items-center gap-1.5"
                >
                  <span aria-hidden className={genuiType.label}>
                    Tickets
                  </span>
                  <WhyDisabled when={locked || goal <= 1} reason="Minimum is 1">
                    <IconTip label="Fewer tickets">
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Fewer tickets"
                        aria-describedby={`${baseId}-count`}
                        disabled={locked || goal <= 1}
                        onClick={() => changeCount(goal - 1)}
                      >
                        <MinusIcon aria-hidden />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                  <span
                    id={`${baseId}-count`}
                    className="flex min-w-8 justify-center text-[24px] leading-none font-normal tabular-nums"
                  >
                    <span className="sr-only">{goal}</span>
                    <span aria-hidden className="inline-flex justify-center">
                      <SlidingNumber number={goal} initiallyStable />
                    </span>
                  </span>
                  <WhyDisabled
                    when={locked || goal >= 10}
                    reason="Maximum is 10"
                  >
                    <IconTip label="More tickets">
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="More tickets"
                        aria-describedby={`${baseId}-count`}
                        disabled={locked || goal >= 10}
                        onClick={() => changeCount(goal + 1)}
                      >
                        <PlusIcon aria-hidden />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                </div>

                {range && (
                  <div className="flex min-w-48 flex-1 items-center gap-3 @max-sm:basis-full">
                    <SliderPrimitive.Root
                      value={[sliderValue]}
                      min={range.min}
                      max={range.max}
                      step={range.step}
                      disabled={locked}
                      onValueChange={(v) =>
                        setMaxLocal(Array.isArray(v) ? v[0] : v)
                      }
                      thumbAlignment="edge"
                      className="min-w-0 flex-1"
                    >
                      <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1.5 select-none data-disabled:opacity-50">
                        <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
                          <SliderPrimitive.Indicator className="h-full bg-choice" />
                        </SliderPrimitive.Track>
                        <SliderPrimitive.Thumb
                          getAriaLabel={() => "Max price per ticket"}
                          getAriaValueText={() =>
                            limit === undefined
                              ? "Any price"
                              : `Up to ${money(limit)}`
                          }
                          className="relative block h-6 w-3 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
                        />
                      </SliderPrimitive.Control>
                    </SliderPrimitive.Root>
                    <span
                      aria-hidden
                      className={cn(genuiType.value, "min-w-20 text-right")}
                    >
                      {limit === undefined ? (
                        "Any price"
                      ) : (
                        <>
                          Up to{" "}
                          <RollingAmount text={money(limit)} amount={limit} />
                        </>
                      )}
                    </span>
                  </div>
                )}

                {anyAccessible && (
                  <div className="flex items-center gap-2">
                    <Switch
                      nativeButton
                      id={`${baseId}-accessible`}
                      checked={accessibleOnly}
                      disabled={locked}
                      onCheckedChange={(on: boolean) =>
                        setAccessibleOnly(Boolean(on))
                      }
                      className="relative after:absolute after:-inset-1.5"
                    />
                    <label
                      htmlFor={`${baseId}-accessible`}
                      className={genuiType.label}
                    >
                      Accessible only
                    </label>
                  </div>
                )}
              </div>
            )}

            <p id={mapHintId} className="sr-only">
              {`Sections in order: ${hasFloorSections ? "floor first, then " : ""}each tier clockwise from the top${focalKind === "stage" ? ", where the stage is" : ""}. Arrow keys move between sections; Enter opens one.`}
            </p>

            <div className="border-t border-border px-3 py-3">
              <div
                className={cn(
                  "relative mx-auto w-full max-w-[25rem] rounded-[10px]",
                  listFocused && "ring-2 ring-ring/50",
                )}
                style={{ aspectRatio: `${VIEW.width} / ${VIEW.height}` }}
              >
                {/* Visual only; the section list below carries every value. */}
                <svg
                  aria-hidden
                  viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
                  className="absolute inset-0 size-full select-none"
                  onPointerMove={(e) => {
                    const id = (e.target as Element)
                      .closest?.("[data-section-id]")
                      ?.getAttribute("data-section-id")
                    setHoverId(id ?? null)
                  }}
                  onPointerLeave={() => setHoverId(null)}
                  onClick={(e) => {
                    const id = (e.target as Element)
                      .closest?.("[data-section-id]")
                      ?.getAttribute("data-section-id")
                    if (id) openSection(id)
                  }}
                >
                  {streaming &&
                    ([1, 2, 3] as const)
                      .filter((r) => ringsInUse.size === 0 || ringsInUse.has(r))
                      .map((r) => (
                        <path
                          key={`track-${r}`}
                          d={ringTrackPath(r)}
                          fillRule="evenodd"
                          className="animate-pulse fill-muted opacity-60 motion-reduce:animate-none"
                        />
                      ))}
                  <Focal
                    kind={focalKind}
                    label={focal?.label}
                    showLabel={!(hasFloorSections && focalKind !== "stage")}
                  />
                  {ready.map((s) => {
                    const shape = shapeOf(s, focalKind)
                    const m = matchSection(s, filters)
                    const soldOut = m.soldOut
                    const strong = strengthOf(s) >= 60
                    const ink = soldOut
                      ? "var(--muted-foreground)"
                      : strong
                        ? "var(--card)"
                        : "var(--foreground)"
                    const clickable = !locked && !soldOut
                    return (
                      <motion.g
                        key={s.id}
                        data-section-id={s.id}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: m.dimmed ? 0.35 : 1 }}
                        transition={{ duration: 0.2 }}
                        className={clickable ? "cursor-pointer" : undefined}
                      >
                        <path
                          d={shape.d}
                          style={{ fill: fillOf(s) }}
                          stroke="var(--card)"
                          strokeWidth={0.5}
                          className="transition-[fill] duration-300 motion-reduce:transition-none"
                        />
                        <text
                          x={shape.x}
                          y={s.accessible ? shape.y - 3 : shape.y}
                          textAnchor="middle"
                          dominantBaseline="central"
                          fontSize={s.label.length > 4 ? 7 : 8}
                          fontWeight={500}
                          fill={ink}
                          pointerEvents="none"
                          className="tabular-nums"
                        >
                          {s.label}
                        </text>
                        {s.accessible && (
                          <AccessibilityIcon
                            x={shape.x - 3.5}
                            y={shape.y + 1.5}
                            width={7}
                            height={7}
                            strokeWidth={2.5}
                            color={ink}
                            pointerEvents="none"
                          />
                        )}
                      </motion.g>
                    )
                  })}
                  {tipSection && tipShape && (
                    <path
                      d={tipShape.d}
                      fill="none"
                      stroke="var(--foreground)"
                      strokeWidth={1.75}
                      strokeLinejoin="round"
                      pointerEvents="none"
                    />
                  )}
                </svg>

                {tipSection && tipShape && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute z-10 w-max max-w-60 rounded-lg border bg-popover px-2.5 py-1 text-[13px] leading-4 text-popover-foreground shadow-sm dark:shadow-none"
                    style={{
                      left: `clamp(6rem, ${pct(tipShape.x, VIEW.width)}, calc(100% - 6rem))`,
                      top: pct(tipShape.y, VIEW.height),
                      transform:
                        tipShape.y < VIEW.height * 0.2
                          ? "translate(-50%, 14px)"
                          : "translate(-50%, calc(-100% - 12px))",
                    }}
                  >
                    {sectionTip(
                      tipSection,
                      matchSection(tipSection, filters),
                      money,
                    )}
                  </div>
                )}

                {navOrder.length > 0 && (
                  <div
                    ref={listRef}
                    role="listbox"
                    tabIndex={0}
                    aria-label={`Sections${venue?.name ? ` at ${venue.name}` : ""}`}
                    aria-describedby={mapHintId}
                    aria-activedescendant={
                      active ? optionId(active.id) : undefined
                    }
                    onKeyDown={onListKeyDown}
                    onFocus={() => setListFocused(true)}
                    onBlur={() => setListFocused(false)}
                    className="sr-only"
                  >
                    {groups.map((g) => (
                      // biome-ignore lint/a11y/useSemanticElements: an option group inside a listbox
                      <div
                        key={g.tier}
                        role="group"
                        aria-label={TIER_LABELS[g.tier]}
                      >
                        {g.items.map((s) => {
                          const m = matchSection(s, filters)
                          return (
                            // biome-ignore lint/a11y/useFocusableInteractive: options take focus through aria-activedescendant on the listbox
                            // biome-ignore lint/a11y/useKeyWithClickEvents: the listbox handles the keys
                            <div
                              key={s.id}
                              id={optionId(s.id)}
                              role="option"
                              aria-selected={active?.id === s.id}
                              aria-disabled={m.soldOut || locked || undefined}
                              onClick={() => openSection(s.id)}
                            >
                              {describeSection(s, m, money)}
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {(!done || buckets || anySoldOut || anyAccessible) && (
              <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-border px-3 py-3 text-[13px] leading-4 text-muted-foreground">
                {!done && (
                  <Segmented
                    label="Shade sections by"
                    value={colorBy}
                    onChange={setColorLocal}
                    className="w-full flex-none"
                    options={[
                      { value: "price", label: "Price" },
                      { value: "availability", label: "Seats left" },
                    ]}
                  />
                )}
                {(buckets || anySoldOut || anyAccessible) && (
                  <ul
                    aria-label="Legend"
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums"
                  >
                    {buckets && (
                      <li className="flex items-center gap-1.5">
                        {/* One ramp, light to strong, with its two ends. */}
                        <span className="sr-only">
                          {`${colorBy === "price" ? "Price from" : "Seats left"}, light to strong: ${bucketLabels(
                            buckets,
                            (n) => (colorBy === "price" ? money(n) : String(n)),
                          ).join(", ")}`}
                        </span>
                        <span aria-hidden>
                          {colorBy === "price"
                            ? money(buckets.bounds[0])
                            : buckets.bounds[0]}
                        </span>
                        <span aria-hidden className="flex">
                          {buckets.bounds.slice(0, -1).map((b, i) => (
                            <span
                              key={b}
                              className="h-2.5 w-4 first:rounded-l-sm last:rounded-r-sm"
                              style={{
                                background: mix(
                                  bucketStrength(i, buckets.count),
                                ),
                              }}
                            />
                          ))}
                        </span>
                        <span aria-hidden>
                          {colorBy === "price"
                            ? money(buckets.bounds[buckets.count])
                            : `${buckets.bounds[buckets.count]} left`}
                        </span>
                      </li>
                    )}
                    {anySoldOut && (
                      <li className="flex items-center gap-1.5">
                        <Swatch className="bg-muted" />
                        Sold out
                      </li>
                    )}
                    {anyDimmed && (
                      <li className="flex items-center gap-1.5">
                        <Swatch
                          className="border-transparent opacity-35"
                          style={{ background: mix(60) }}
                        />
                        {accessibleOnly && limit !== undefined
                          ? "Filtered out"
                          : accessibleOnly
                            ? "Not accessible"
                            : "Over max price"}
                      </li>
                    )}
                    {anyAccessible && (
                      <li className="flex items-center gap-1.5">
                        <AccessibilityIcon aria-hidden className="size-3.5" />
                        Accessible
                      </li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        <SurfaceFooter className="items-end gap-x-6 gap-y-3">
          {status === "best-available" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4" />
              {`Asked for the best ${pluralize(goal, "seat")}${wantTogether && goal > 1 ? " together" : ""}${limit !== undefined ? `, up to ${money(limit)} each` : ""}${accessibleOnly ? ", accessible" : ""}.`}
            </p>
          ) : status === "section-requested" ? (
            <p className={cn(genuiType.body, "text-muted-foreground")}>
              {`Asked for seats in section ${
                (result?.action === "open-section"
                  ? byId.get(result.sectionId)?.label
                  : null) ??
                (result?.action === "open-section" ? result.sectionId : "")
              }.`}
            </p>
          ) : (
            <>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                {seatsReady || (status === "selected" && seatText) ? (
                  <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className={genuiType.label}>
                        {goal > 1 ? "Seats" : "Seat"}
                      </span>
                      <span className={cn(genuiType.stat, "break-words")}>
                        {seatText ?? (
                          <>
                            <span aria-hidden className="text-muted-foreground">
                              —
                            </span>
                            <span className="sr-only">None yet</span>
                          </>
                        )}
                      </span>
                    </div>
                    {selectedIds.length > 0 && totals.complete && (
                      <div className="flex flex-col gap-1.5">
                        <span className={genuiType.label}>Total</span>
                        <span className={genuiType.stat}>
                          <span className="sr-only">{money(totals.total)}</span>
                          <span aria-hidden>
                            <RollingAmount
                              text={money(totals.total)}
                              amount={totals.total}
                            />
                          </span>
                        </span>
                      </div>
                    )}
                  </div>
                ) : null}
                {streaming ? (
                  <p className={genuiType.meta}>
                    <ShimmeringText
                      text="Loading the venue…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  </p>
                ) : status === "selected" ? (
                  <p className={cn(genuiType.meta, "flex items-center gap-1")}>
                    <CheckIcon aria-hidden className="size-3.5" />
                    {selectedIds.length === 1 ? "Seat chosen" : "Seats chosen"}
                  </p>
                ) : progress ? (
                  <p className={genuiType.meta}>{progress}</p>
                ) : null}
              </div>
              {status !== "selected" && (
                <div className="ml-auto flex gap-2">
                  <WhyDisabled when={locked} reason="Already sent">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={dismiss}
                      disabled={locked}
                    >
                      Cancel
                    </Button>
                  </WhyDisabled>
                  {showSection ? (
                    <WhyDisabled when={!canSubmit} reason="Choose seats first">
                      <Button size="sm" onClick={submit} disabled={!canSubmit}>
                        {status === "submitting"
                          ? "Saving…"
                          : goal > 1
                            ? "Choose seats"
                            : "Choose seat"}
                      </Button>
                    </WhyDisabled>
                  ) : (
                    <WhyDisabled
                      when={locked || ready.length === 0}
                      reason="No seats available"
                    >
                      <Button
                        size="sm"
                        disabled={locked || ready.length === 0}
                        onClick={bestAvailable}
                      >
                        Best available
                      </Button>
                    </WhyDisabled>
                  )}
                </div>
              )}
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

/** Ready sections in keyboard order. */
function readyAndOrdered(sections: LooseSection[] | undefined) {
  return orderSections(readySections(sections))
}
