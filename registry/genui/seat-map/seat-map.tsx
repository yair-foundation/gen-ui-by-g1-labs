"use client"

import * as React from "react"
import {
  AccessibilityIcon,
  BusFrontIcon,
  CheckIcon,
  ClapperboardIcon,
  DramaIcon,
  PlaneIcon,
  TicketIcon,
  TrainFrontIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  EyeOffIcon,
  MinusIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
import { CheckMark, RollingDigits } from "@/components/genui/genui-motion"
import { ScrollFade } from "@/components/genui/scroll-fade"

import {
  type ArcLayout,
  type Assignments,
  type LooseSection,
  type LooseZone,
  type MarkerKind,
  type Passenger,
  type ReadyRow,
  type ReadySeat,
  type ReadySection,
  type SeatState,
  announceCountPick,
  announcePassengerPick,
  arcCoords,
  arcLayout,
  areTogether,
  boxSides,
  columnKinds,
  columnLetters,
  describeSeat,
  directionForKey,
  formatPrice,
  groupZones,
  indexSeats,
  initialAssignments,
  initials,
  layoutOf,
  moveFocus,
  nextUnassigned,
  pickForCount,
  pickForPassenger,
  pluralize,
  priceTotal,
  readySections,
  readyZones,
  seatDetail,
  seatOf,
  seatSizeFor,
} from "./seat-map-utils"
import type {
  SeatMapDraft,
  SeatMapInput,
  SeatMapResult,
} from "./seat-map.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type SeatMapStatus =
  "streaming" | "ready" | "submitting" | "selected" | "dismissed"

type Kind = SeatMapInput["kind"]

export type SeatMapProps = Partial<
  Omit<SeatMapInput, "sections" | "passengers" | "current" | "zones">
> & {
  /** Sections, rows and seats may be partial while the tool call streams. */
  sections?: LooseSection[]
  zones?: LooseZone[]
  passengers?: Partial<Passenger>[]
  current?: Partial<{ passengerId: string; seatId: string }>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: SeatMapStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: SeatMapResult) => void
  /**
   * Called on every pick before the user confirms, with the seats selected so
   * far (possibly fewer than needed, or none). Not a decision: keep the
   * latest and add it to the user's next typed message (`describeUIState`).
   */
  onDraft?: (draft: SeatMapDraft) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Shows the
   * chosen seats on a read-only map and never calls onResult.
   */
  result?: SeatMapResult
  className?: string
}

const SECTION_NOUN: Record<Kind, string> = {
  plane: "Class",
  train: "Class",
  bus: "Section",
  cinema: "Section",
  theater: "Level",
  venue: "Section",
}

const FRONT_HINT: Record<Kind, string> = {
  plane: "The front of the plane is at the top.",
  cinema: "The screen is at the top.",
  theater: "The stage is at the top.",
  venue: "The stage is at the top.",
  train: "The front is at the top.",
  bus: "The front is at the top.",
}

/** Fill strength per zone level, dearest first. Zones are also named in each seat's label. */
const ZONE_FILLS = [
  "bg-foreground/25",
  "bg-foreground/15",
  "bg-foreground/10",
  "bg-foreground/5",
]

const MARKER_LABELS: Record<MarkerKind, string> = {
  exit: "Exit",
  "wing-start": "Wing",
  "wing-end": "Wing",
  galley: "Galley",
  lavatory: "Lavatory",
  screen: "Screen",
  table: "Table",
}

/**
 * Rows and cells of the ARIA grid. Focus lives on the seat buttons (a roving
 * tabindex), so the grid and its rows are deliberately not focusable, and the
 * cinema and cabin layouts need CSS grid rows, which a <table> can't do well.
 */
function GridPart({
  part,
  ...props
}: React.ComponentProps<"div"> & {
  part: "grid" | "row" | "gridcell" | "rowheader"
}) {
  return <div role={part} {...props} />
}

/**
 * Rounded shading across the fuselage, so the nose and cabin read as one
 * cylinder (after AeroLOPA-style seat maps).
 */
const FUSELAGE_SHADE =
  "linear-gradient(to right, color-mix(in oklab, var(--foreground) 7%, transparent), transparent 22%, transparent 78%, color-mix(in oklab, var(--foreground) 7%, transparent))"

/**
 * The nose seen from above: a long ogive that runs into the cabin walls,
 * the cockpit windshield as a V of angled panes, the radome seam and the
 * forward doors. Fixed aspect, so it scales with the cabin's width.
 */
function PlaneNose() {
  const shadeId = React.useId()
  const outline =
    "M0.5 180C0.5 140 10 95 30 60C48 28 78 2.5 100 2.5C122 2.5 152 28 170 60C190 95 199.5 140 199.5 180"
  // Left side, centre post outward along a curved band; the right mirrors it.
  const panes = [
    "M96.6 29.6L97.2 41.8L84 48L79.6 38.6Z",
    "M77.6 40.4L81.8 49.8L72.6 58.6L67 52.6Z",
    "M65.6 56.2L70.8 60.6L64.6 70.8L59.4 72Z",
  ]
  const frame =
    "M97.8 27.6L98.4 45L84.8 51.6L73.6 62.4L66.4 74.4L56.6 75L64.4 54.4L76.4 38Z"
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 180"
      className="block h-auto w-full overflow-visible [--glass-a:#2b2b2b] [--glass-b:#8c8c8c] dark:[--glass-a:#050505] dark:[--glass-b:#5a5a5a]"
    >
      <defs>
        <linearGradient id={shadeId} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="var(--foreground)" stopOpacity="0.07" />
          <stop offset="0.22" stopColor="var(--foreground)" stopOpacity="0" />
          <stop offset="0.78" stopColor="var(--foreground)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--foreground)" stopOpacity="0.07" />
        </linearGradient>
      </defs>
      <path d={`${outline}Z`} className="fill-muted/40" />
      <path d={`${outline}Z`} fill={`url(#${shadeId})`} />
      <path
        d={outline}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-border"
      />
      {/* Radome seam */}
      <path
        d="M78 12Q100 6 122 12"
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-border"
      />
      {/* Windshield: a soft frame, then three tinted panes each side of
          the centre post. Glass is dark in both themes, like real glass. */}
      <linearGradient id={`${shadeId}-glass`} x1="0" x2="0.7" y1="0" y2="1">
        <stop offset="0" stopColor="var(--glass-a)" />
        <stop offset="1" stopColor="var(--glass-b)" />
      </linearGradient>
      <g className="fill-foreground/[0.035]">
        <path d={frame} />
        <path d={frame} transform="matrix(-1 0 0 1 200 0)" />
      </g>
      <g
        fill={`url(#${shadeId}-glass)`}
        stroke={`url(#${shadeId}-glass)`}
        strokeWidth={0.5}
        strokeLinejoin="round"
      >
        {panes.map((d) => (
          <React.Fragment key={d}>
            <path d={d} />
            <path d={d} transform="matrix(-1 0 0 1 200 0)" />
          </React.Fragment>
        ))}
      </g>
      {/* Forward doors */}
      <g
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-border"
      >
        <rect x="4" y="140" width="5" height="22" rx="1.5" />
        <rect x="191" y="140" width="5" height="22" rx="1.5" />
      </g>
    </svg>
  )
}

type WingBox = {
  /** Distance from the top of the cabin to the wing's leading edge at the root. */
  top: number
  /** Root chord: the wing rows' height. */
  chord: number
  /** How far each wing reaches out from the wall. */
  span: number
}

/**
 * The wings seen from above, as on AeroLOPA-style maps: a curved root
 * fillet flaring out of the wall, a slightly swept leading edge running off
 * the side of the map, a straight trailing edge, light-to-dark shading and
 * faint panel and flap lines. Drawn as the left wing; the right mirrors it.
 */
function PlaneWings({ top, chord, span }: WingBox) {
  const shadeId = React.useId()
  const S = span
  const H = chord
  // Root fillet: tangent to the wall, curving out to a near-flat leading edge.
  const outline = `M${S} 0C${S} ${H * 0.13} ${S - S * 0.12} ${H * 0.21} ${S - S * 0.4} ${H * 0.24}L0 ${H * 0.3}V${H}H${S}Z`
  const lines = [
    `M${S} ${H * 0.44}L0 ${H * 0.56}`,
    `M${S} ${H * 0.7}L0 ${H * 0.76}`,
    `M${S} ${H * 0.84}H0`,
    `M${S} ${H * 0.92}H0`,
  ]
  const wing = (side: "left" | "right") => (
    <svg
      aria-hidden
      viewBox={`0 0 ${S} ${H}`}
      className={cn(
        "pointer-events-none absolute",
        side === "right" && "-scale-x-100",
      )}
      style={{ top, width: S, height: H, [side]: -S }}
    >
      <defs>
        <linearGradient id={`${shadeId}-${side}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0.2" stopColor="var(--foreground)" stopOpacity="0.02" />
          <stop offset="1" stopColor="var(--foreground)" stopOpacity="0.09" />
        </linearGradient>
      </defs>
      <path d={outline} className="fill-muted/40" />
      <path d={outline} fill={`url(#${shadeId}-${side})`} />
      <path
        d={`M${S} 0C${S} ${H * 0.13} ${S - S * 0.12} ${H * 0.21} ${S - S * 0.4} ${H * 0.24}L0 ${H * 0.3}M0 ${H}H${S}`}
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-border"
      />
      <g
        fill="none"
        vectorEffect="non-scaling-stroke"
        className="stroke-border/70"
      >
        {lines.map((d) => (
          <path key={d} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    </svg>
  )
  return (
    <>
      {wing("left")}
      {wing("right")}
    </>
  )
}

const KIND_ICON = {
  plane: PlaneIcon,
  cinema: ClapperboardIcon,
  theater: DramaIcon,
  train: TrainFrontIcon,
  bus: BusFrontIcon,
  venue: TicketIcon,
} as const

const KIND_TONE: Record<keyof typeof KIND_ICON, string> = {
  plane: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  cinema: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
  theater:
    "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  train:
    "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  bus: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
  venue:
    "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
}

/** The title's icon: what's being seated, in its tint. */
function KindIcon({ kind }: { kind: keyof typeof KIND_ICON }) {
  const Icon = KIND_ICON[kind] ?? TicketIcon
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
        KIND_TONE[kind] ?? KIND_TONE.venue,
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}

/** The kind's framing: a plane nose, a screen, a stage or a front label. */
function Frame({
  kind,
  stage = "front",
  wing,
  children,
}: {
  kind: Kind
  /** Where the wings meet the fuselage, measured after layout (planes only). */
  wing?: WingBox | null
  /** 'below' for circles and balconies: the stage is ahead and below. */
  stage?: "front" | "below"
  children: React.ReactNode
}) {
  if (kind === "plane") {
    return (
      <div>
        <PlaneNose />
        <div
          data-plane-body=""
          className="relative border-x border-b bg-transparent px-3 pt-1 pb-8"
          style={{
            borderRadius: "0 0 50% 50% / 0 0 2rem 2rem",
            backgroundImage: FUSELAGE_SHADE,
          }}
        >
          {wing && <PlaneWings {...wing} />}
          {children}
        </div>
      </div>
    )
  }
  if (kind === "train" || kind === "bus") {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <span
          aria-hidden
          className="flex items-center gap-1 text-[13px] text-muted-foreground"
        >
          <ChevronUpIcon className="size-3.5" />
          Front
        </span>
        <div
          className={cn(
            "border bg-transparent px-3 py-3",
            kind === "bus" ? "rounded-t-[1.75rem] rounded-b-xl" : "rounded-lg",
          )}
        >
          {children}
        </div>
      </div>
    )
  }
  if (kind === "cinema") {
    return (
      <div className="flex flex-col gap-4">
        <div aria-hidden className="flex flex-col items-center gap-1 px-6">
          <svg
            aria-hidden
            viewBox="0 0 200 16"
            preserveAspectRatio="none"
            className="h-3 w-full overflow-visible"
          >
            <path
              d="M2 14Q100-2 198 14"
              fill="none"
              strokeWidth={3}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className="stroke-foreground/80"
            />
          </svg>
          {/* The screen's light falling on the room. */}
          <span className="-mt-1 h-6 w-full bg-[radial-gradient(ellipse_at_top,var(--color-foreground)_0%,transparent_70%)] opacity-[0.12]" />
          <span className="-mt-5 text-[13px] font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Screen
          </span>
        </div>
        {children}
      </div>
    )
  }
  // Theater and venue: a stage at the front.
  if (stage === "below") {
    // A circle or balcony: the stage is out of view, ahead and below.
    return (
      <div className="flex flex-col gap-4">
        <div
          aria-hidden
          className="mx-6 flex h-8 items-center justify-center gap-1 rounded-md border border-dashed text-[13px] text-muted-foreground"
        >
          Stage
          <span className="text-muted-foreground/70">below</span>
        </div>
        {children}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <div
        aria-hidden
        className="mx-6 flex h-8 items-center justify-center border bg-transparent text-[13px] text-muted-foreground"
        style={{
          borderRadius:
            "0.375rem 0.375rem 50% 50% / 0.375rem 0.375rem 100% 100%",
        }}
      >
        Stage
      </div>
      {children}
    </div>
  )
}

function MarkerStrip({ kind }: { kind: MarkerKind }) {
  if (kind === "exit") {
    return (
      <div
        aria-hidden
        className="-mx-2 flex items-center justify-between py-1 text-[13px] font-medium text-muted-foreground"
      >
        <span className="flex items-center">
          <ChevronLeftIcon className="size-3" />
          Exit
        </span>
        <span className="flex items-center">
          Exit
          <ChevronRightIcon className="size-3" />
        </span>
      </div>
    )
  }
  return (
    <div
      aria-hidden
      className="flex items-center gap-2 py-1 text-[13px] text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border" />
      {MARKER_LABELS[kind]}
      <span className="h-px flex-1 bg-border" />
    </div>
  )
}

/** Indexes of rows that sit between the wing markers. */
function wingRows(section: ReadySection): Set<number> {
  const at = (label: string) => section.rows.findIndex((r) => r.label === label)
  const start = section.markers.find((m) => m.kind === "wing-start")
  const end = section.markers.find((m) => m.kind === "wing-end")
  const out = new Set<number>()
  if (!start && !end) return out
  const from = start ? at(start.afterRow) + 1 : 0
  const endAt = end ? at(end.afterRow) : -1
  const to = endAt >= 0 ? endAt : section.rows.length - 1
  for (let i = from; i <= to; i++) out.add(i)
  return out
}

function Swatch({ className, children }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-3.5 shrink-0 items-center justify-center rounded-[3px] border",
        className,
      )}
    >
      {children}
    </span>
  )
}

/** "Stalls F7, F8": a leading word every id shares is written once. */
function seatList(ids: string[]): string {
  const prefix = ids[0]?.match(/^(.+\s)\S+$/)?.[1]
  const shared =
    ids.length > 1 && !!prefix && ids.every((id) => id.startsWith(prefix))
  return ids
    .map((id, i) => (shared && i > 0 ? id.slice(prefix.length) : id))
    .join(", ")
}

/** The big seat value, or what to do when there's none yet. */
function SeatValue({
  value,
  placeholder = "Choose a seat",
}: {
  value?: string
  placeholder?: string
}) {
  if (!value)
    return (
      <span className="text-[14px] leading-8 text-muted-foreground">
        {placeholder}
      </span>
    )
  return <span className={cn(genuiType.stat, "break-words")}>{value}</span>
}

function SkeletonRows({ rows, seats }: { rows: number; seats: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-1">
      {Array.from({ length: rows }, (_, r) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
        <div key={r} className="flex items-center gap-1 pl-7">
          {Array.from({ length: seats }, (_, s) => (
            <Skeleton
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
              key={s}
              className={cn(
                "size-(--seat) rounded-md",
                s === Math.floor(seats / 2) && "ml-[calc(var(--seat)*0.6)]",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SeatMap({
  kind = "plane",
  layout: mapLayout,
  title,
  sections,
  zones,
  currency,
  passengers: passengersProp,
  count = 1,
  current: currentProp,
  legend = true,
  submitLabel,
  status: statusProp,
  onResult,
  onDraft,
  result,
  className,
}: SeatMapProps) {
  const locale = useGenUILocale()
  const restored = result?.action === "select" ? result.seats : null
  // Null until the user picks: until then, follow `current` as it streams in.
  const [assignments, setAssignments] = React.useState<Assignments | null>(
    () =>
      restored?.some((s) => s.passengerId)
        ? Object.fromEntries(
            restored
              .filter((s) => s.passengerId)
              .map((s) => [s.seatId, s.passengerId as string]),
          )
        : null,
  )
  const [picked, setPicked] = React.useState<string[] | null>(() =>
    restored ? restored.map((s) => s.seatId) : null,
  )
  const [activePassenger, setActivePassenger] = React.useState<string | null>(
    null,
  )
  const [decision, setDecision] = React.useState<
    "selected" | "dismissed" | null
  >(() =>
    result ? (result.action === "select" ? "selected" : "dismissed") : null,
  )
  const [sectionId, setSectionId] = React.useState<string | null>(null)
  const [focusId, setFocusId] = React.useState<string | null>(null)
  const [detailId, setDetailId] = React.useState<string | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  // The map's width, for sizing curved layouts to the card.
  const [mapEl, setMapEl] = React.useState<HTMLElement | null>(null)
  const [mapWidth, setMapWidth] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (!mapEl || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(([entry]) =>
      setMapWidth(entry.contentRect.width),
    )
    observer.observe(mapEl)
    return () => observer.disconnect()
  }, [mapEl])
  // Planes: where the wing rows sit, so the wings can be drawn as one shape.
  const [wingBox, setWingBox] = React.useState<WingBox | null>(null)
  React.useLayoutEffect(() => {
    const body = mapEl?.querySelector<HTMLElement>("[data-plane-body]")
    const rows = body
      ? Array.from(body.querySelectorAll<HTMLElement>("[data-wing-row]"))
      : []
    let next: WingBox | null = null
    if (mapEl && body && rows.length > 0) {
      // offsetTop ignores the rows' entrance transforms.
      const offset = (el: HTMLElement) => {
        let y = 0
        let node: HTMLElement | null = el
        while (node && node !== body) {
          y += node.offsetTop
          node = node.offsetParent as HTMLElement | null
        }
        return y
      }
      const last = rows[rows.length - 1]
      const rowHeight = rows[0].offsetHeight
      // The root fillet starts a couple of rows ahead of the wing rows and
      // the trailing edge ends a couple after, as on a real seat map.
      // When the wing already covers the first row shown (a cabin behind
      // the wing root), start the fillet there rather than up in the nose.
      const startsAtFirstRow = rows[0] === body.querySelector("[role=row]")
      const top = offset(rows[0]) - (startsAtFirstRow ? 0 : rowHeight * 2.5)
      const chord = offset(last) + last.offsetHeight + rowHeight * 2 - top
      // Out to the map's edge, where the wing is cropped.
      const span = Math.round((mapEl.clientWidth - body.offsetWidth) / 2)
      if (span >= 20) next = { top, chord, span }
    }
    setWingBox((prev) =>
      prev?.top === next?.top &&
      prev?.chord === next?.chord &&
      prev?.span === next?.span
        ? prev
        : next,
    )
  })
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const hintId = `${baseId}-hint`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: SeatMapStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"
  const done = status === "selected" || status === "dismissed"

  const zoneMap = React.useMemo(() => readyZones(zones), [zones])
  const ready = React.useMemo(
    () => readySections(sections, zoneMap),
    [sections, zoneMap],
  )
  const index = React.useMemo(() => indexSeats(ready), [ready])
  const zoneList = React.useMemo(
    () => groupZones(zoneMap, index),
    [zoneMap, index],
  )
  const zoneLevel = new Map(zoneList.map((z) => [z.id, z.level]))
  const passengers = (passengersProp ?? []).filter(
    (p): p is Passenger =>
      typeof p?.id === "string" && typeof p.name === "string",
  )
  const byPassenger = passengers.length > 0
  const current = (currentProp ?? []).filter(
    (c): c is { passengerId?: string; seatId: string } =>
      typeof c?.seatId === "string",
  )
  const held = new Set(current.map((c) => c.seatId))
  const goal = byPassenger ? passengers.length : Math.max(1, count)

  const assigned = assignments ?? initialAssignments(passengers, current)
  const chosen =
    picked ?? [...new Set(current.map((c) => c.seatId))].slice(0, goal)
  const activeId =
    activePassenger && passengers.some((p) => p.id === activePassenger)
      ? activePassenger
      : (nextUnassigned(passengers, assigned) ?? passengers[0]?.id)
  const passengerName = (id?: string) =>
    passengers.find((p) => p.id === id)?.name

  // Selected seats in map order (passengers mode: passenger order).
  const order = (id: string) => index.get(id)?.order ?? Number.MAX_VALUE
  const selectedIds = byPassenger
    ? passengers
        .map((p) => seatOf(assigned, p.id))
        .filter((s): s is string => !!s)
    : [...chosen].sort((a, b) => order(a) - order(b))
  const selectedSet = new Set(selectedIds)
  const doneCount = selectedIds.length
  const complete = doneCount === goal
  const canSubmit = !locked && complete
  const together = doneCount >= 2 ? areTogether(selectedIds, index) : null
  const total = priceTotal(selectedIds, index, held)
  const money = (n: number) => formatPrice(n, currency, locale)

  const stateOf = (seat: ReadySeat): SeatState =>
    held.has(seat.id) ? "available" : seat.state
  const contextOf = (seat: ReadySeat) => ({
    state: stateOf(seat),
    selected: selectedSet.has(seat.id),
    selectedFor:
      byPassenger && passengers.length > 1
        ? passengerName(assigned[seat.id])
        : undefined,
    current: held.has(seat.id),
    zoneLabel: seat.zone ? zoneMap.get(seat.zone)?.label : undefined,
    formatPrice: money,
  })
  // With zones, prices are ticket prices rather than extra charges.
  const priceWord = zoneList.length ? "total" : "extra"

  // The visible section: the user's choice, else where their seats are.
  const visible =
    ready.find((s) => s.id === sectionId) ??
    ready.find((s) => s.id === index.get(selectedIds[0] ?? "")?.sectionId) ??
    // While streaming, follow the section that's arriving.
    (streaming ? ready.at(-1) : ready[0])

  const layout = layoutOf(visible, mapLayout, kind)
  const arc: ArcLayout | null = React.useMemo(
    () =>
      visible && layout === "curved"
        ? arcLayout(visible.rows, { angle: visible.curve })
        : null,
    [visible, layout],
  )
  // Seats shrink to fit the card down to a 24px tap target, then scroll.
  // The map's inner padding is 1.5rem on each side.
  const seatPx = arc
    ? seatSizeFor(mapWidth === null ? null : mapWidth - 48, arc.width)
    : 0

  // Seats that can take focus; gaps and unavailable seats are skipped.
  const navGrid = (visible?.rows ?? []).map((r) =>
    r.cells.map((c) => (c && stateOf(c) === "available" ? c.id : null)),
  )
  // On curved rows, up and down go to the nearest seat by angle.
  const navCoords = arc ? arcCoords(arc) : undefined
  // A curved map wider than the card starts scrolled to its middle, in line
  // with the stage.
  const arcWidthPx = arc ? Math.round(arc.width * seatPx) : 0
  const visibleId = visible?.id
  React.useEffect(() => {
    if (!mapEl || !arcWidthPx || !visibleId) return
    mapEl.scrollLeft = (mapEl.scrollWidth - mapEl.clientWidth) / 2
  }, [mapEl, arcWidthPx, visibleId])
  const navIds = new Set(navGrid.flat().filter((id): id is string => !!id))
  const rovingId =
    (focusId && navIds.has(focusId) ? focusId : null) ??
    selectedIds.find((id) => navIds.has(id)) ??
    moveFocus(navGrid, "", "first")

  // A tall map opens on the seats, not on the empty nose or the front: the
  // current seat when there is one, else the first row, a third of the way down.
  const firstHeld = [...held][0]
  const scrolledFor = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!mapEl || !visibleId || streaming) return
    if (scrolledFor.current === visibleId) return
    if (mapEl.scrollHeight <= mapEl.clientHeight + 8) return
    const target =
      (firstHeld &&
        mapEl.querySelector<HTMLElement>(
          `[data-seat-id="${CSS.escape(firstHeld)}"]`,
        )) ||
      mapEl.querySelector<HTMLElement>("[data-seat-id]")
    if (!target) return
    scrolledFor.current = visibleId
    const top =
      target.getBoundingClientRect().top -
      mapEl.getBoundingClientRect().top +
      mapEl.scrollTop
    mapEl.scrollTop = Math.max(
      0,
      top - (firstHeld ? mapEl.clientHeight / 2 : mapEl.clientHeight / 4),
    )
  }, [mapEl, visibleId, streaming, firstHeld])

  // Seats as the result lists them: passenger order, or map order. Price only
  // for paid seats the user doesn't already hold.
  const seatsOf = (
    nextAssigned: Assignments,
    nextChosen: string[],
  ): SeatMapDraft["seats"] => {
    const withPrice = (seatId: string, passengerId?: string) => {
      const price = held.has(seatId) ? undefined : index.get(seatId)?.seat.price
      return {
        seatId,
        ...(passengerId ? { passengerId } : {}),
        ...(price !== undefined ? { price } : {}),
      }
    }
    if (byPassenger) {
      return passengers.flatMap((p) => {
        const seatId = seatOf(nextAssigned, p.id)
        return seatId ? [withPrice(seatId, p.id)] : []
      })
    }
    return [...nextChosen]
      .sort((a, b) => order(a) - order(b))
      .map((seatId) => withPrice(seatId))
  }

  const seatDomId = (id: string) => `${baseId}-seat-${index.get(id)?.order}`

  const choose = (seat: ReadySeat) => {
    setFocusId(seat.id)
    if (locked || stateOf(seat) !== "available") return
    if (byPassenger && activeId) {
      const pick = pickForPassenger(passengers, assigned, activeId, seat.id)
      setAssignments(pick.assignments)
      setActivePassenger(pick.activeId)
      setAnnouncement(announcePassengerPick(pick, passengers))
      onDraft?.({ action: "select", seats: seatsOf(pick.assignments, chosen) })
    } else {
      const pick = pickForCount(chosen, goal, seat.id)
      setPicked(pick.selected)
      setAnnouncement(announceCountPick(pick, goal))
      onDraft?.({ action: "select", seats: seatsOf(assigned, pick.selected) })
    }
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
    const next = moveFocus(navGrid, from, direction, navCoords)
    if (!next) return
    setFocusId(next)
    document.getElementById(seatDomId(next))?.focus()
  }

  const changeSection = (id: string) => {
    const section = ready.find((s) => s.id === id)
    if (!section) return
    setSectionId(id)
    setFocusId(null)
    const boxes = layoutOf(section, mapLayout, kind) === "boxes"
    setAnnouncement(
      `${section.label}. ${
        boxes
          ? pluralize(section.rows.length, "box", "boxes")
          : pluralize(section.rows.length, "row")
      }.`,
    )
  }

  const switchPassenger = (p: Passenger) => {
    setActivePassenger(p.id)
    const seat = seatOf(assigned, p.id)
    setAnnouncement(
      `Choosing a seat for ${p.name}.${seat ? ` Currently ${seat}.` : ""}`,
    )
  }

  const submit = () => {
    if (!canSubmit) return
    setDecision("selected")
    onResult?.({ action: "select", seats: seatsOf(assigned, chosen) })
  }

  const dismiss = () => {
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  const defaultTitle = goal > 1 ? "Choose seats" : "Choose a seat"
  const heading = title ?? (streaming ? undefined : defaultTitle)
  const heldList = [...held]
  const description = byPassenger
    ? passengers.length === 1
      ? `Seat for ${passengers[0].name}`
      : `${passengers.length} passengers, one seat each`
    : `Pick ${pluralize(goal, "seat")}`
  const heldText = heldList.length
    ? heldList.length === 1
      ? `Your current seat is ${heldList[0]}.`
      : `Your current seats are ${heldList.join(", ")}.`
    : ""

  // With several passengers, each one's seat is a toggle in the footer.
  const multi = passengers.length > 1
  const seatText = selectedIds.length ? seatList(selectedIds) : undefined
  const seatWord =
    selectedIds.length === 1 && held.has(selectedIds[0])
      ? "Current seat"
      : held.size > 0 && selectedIds.length > 0
        ? goal > 1
          ? "New seats"
          : "New seat"
        : goal > 1
          ? "Seats"
          : "Seat"
  // Changing seats: say what it replaces ("from 41F").
  const fromText =
    held.size > 0 &&
    selectedIds.length > 0 &&
    !selectedIds.every((id) => held.has(id))
      ? `from ${seatList(heldList)}`
      : null
  // One quiet line under the seats: progress and whether they're together.
  // Nothing picked yet: the placeholder says it, so the count waits.
  const progress = [
    complete || doneCount === 0
      ? null
      : `${doneCount} of ${goal} ${byPassenger ? "assigned" : "selected"}`,
    together === null ? null : together ? "Together" : "Not together",
  ]
    .filter(Boolean)
    .join(" · ")

  // Dismissed: a compact record for the chat history.
  if (status === "dismissed") {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="seat-map"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader>
            <SurfaceTitle id={titleId}>{heading}</SurfaceTitle>
          </SurfaceHeader>
          <SurfaceFooter aria-live="polite">
            <p
              className={cn(
                genuiType.body,
                "flex items-center gap-1.5 text-muted-foreground",
              )}
            >
              <XIcon aria-hidden className="size-4" />
              {held.size
                ? "Cancelled. Your seats weren't changed."
                : "Cancelled. No seats were chosen."}
            </p>
          </SurfaceFooter>
        </Surface>
      </MotionConfig>
    )
  }

  const kinds = visible ? columnKinds(visible.rows) : []
  const letters = kind === "plane" && visible ? columnLetters(visible.rows) : []
  const showLetters = letters.some(Boolean)
  const labelCol = "1.5rem"
  // Planes keep one fuselage width across cabins, like a real seat map: the
  // widest cabin sets it; narrower layouts get bigger seats (up to 1.6×,
  // e.g. business pods) and the aisles take up the rest.
  const units = (cols: ("seat" | "aisle")[]) =>
    cols.reduce((sum, k) => sum + (k === "aisle" ? 0.6 : 1), 0)
  const seatCols = kinds.filter((k) => k === "seat").length
  const aisleCols = kinds.length - seatCols
  const cabinUnits =
    kind === "plane" && layout === "grid"
      ? Math.max(0, ...ready.map((sec) => units(columnKinds(sec.rows))))
      : 0
  const seatScale =
    cabinUnits && seatCols
      ? Math.min(1.6, Math.max(1, (cabinUnits - aisleCols * 0.6) / seatCols))
      : 1
  const aisleUnits =
    cabinUnits && aisleCols
      ? Math.max(0.6, (cabinUnits - seatCols * seatScale) / aisleCols)
      : 0.6
  // Fewer columns also means fewer 4px grid gaps; the aisles absorb them.
  const cabinCols = cabinUnits
    ? Math.max(0, ...ready.map((sec) => columnKinds(sec.rows).length))
    : 0
  const aisleExtraPx =
    cabinUnits && aisleCols ? ((cabinCols - kinds.length) * 4) / aisleCols : 0
  const template = [
    labelCol,
    ...kinds.map((k) =>
      k === "aisle"
        ? `calc(var(--seat-base) * ${aisleUnits} + ${aisleExtraPx}px)`
        : "var(--seat)",
    ),
    // A matching column on the right keeps the seats centred under the front.
    labelCol,
  ].join(" ")
  const wings = visible ? wingRows(visible) : new Set<number>()
  const rowLabels = new Set(visible?.rows.map((r) => r.label))
  const leadMarkers = (visible?.markers ?? []).filter(
    (m) =>
      !rowLabels.has(m.afterRow) &&
      m.kind !== "wing-start" &&
      m.kind !== "wing-end" &&
      // The cinema framing already draws the screen.
      !(kind === "cinema" && m.kind === "screen"),
  )
  const markersAfter = (row: ReadyRow) =>
    (visible?.markers ?? []).filter(
      (m) =>
        m.afterRow === row.label &&
        m.kind !== "wing-start" &&
        m.kind !== "wing-end",
    )

  const detailSeat = detailId ? index.get(detailId)?.seat : undefined

  /** A seat button. `upright` turns its content back level on a curved row. */
  const renderSeat = (seat: ReadySeat, upright?: number) => {
    const ctx = contextOf(seat)
    const unavailable = ctx.state !== "available"
    const owner = passengerName(assigned[seat.id])
    const level = seat.zone ? zoneLevel.get(seat.zone) : undefined
    return (
      <button
        type="button"
        id={seatDomId(seat.id)}
        data-seat-id={seat.id}
        tabIndex={rovingId === seat.id ? 0 : -1}
        aria-label={describeSeat(seat, ctx)}
        aria-pressed={ctx.selected}
        aria-disabled={unavailable || locked || undefined}
        onClick={() => choose(seat)}
        onFocus={() => setDetailId(seat.id)}
        onBlur={() => setDetailId((d) => (d === seat.id ? null : d))}
        onPointerEnter={() => setDetailId(seat.id)}
        className={cn(
          "relative flex size-(--seat) items-center justify-center rounded-md border text-[13px] font-medium tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
          ctx.selected
            ? "border-transparent bg-accent text-foreground ring-2 ring-choice ring-inset"
            : unavailable
              ? "cursor-not-allowed border-transparent bg-muted/70 text-muted-foreground/70 dark:bg-white/[0.05]"
              : cn(
                  "border-input text-foreground hover:border-foreground/50",
                  level !== undefined
                    ? ZONE_FILLS[level]
                    : seat.price !== undefined && !ctx.current
                      ? "border-transparent bg-emerald-500/20 dark:border-transparent dark:bg-emerald-400/20"
                      : "bg-background",
                ),
          ctx.current && !ctx.selected && "border-dashed border-foreground/60",
          locked && !unavailable && "cursor-default",
        )}
      >
        <span
          aria-hidden
          className="flex"
          style={upright ? { transform: `rotate(${upright}deg)` } : undefined}
        >
          {ctx.selected ? (
            passengers.length > 1 && owner ? (
              initials(owner)
            ) : (
              <CheckMark className="size-3.5 text-choice" />
            )
          ) : ctx.state === "taken" ? null : ctx.state === "blocked" ? (
            <MinusIcon className="size-3" />
          ) : seat.features.includes("accessible") ? (
            <AccessibilityIcon className="size-3.5" />
          ) : seat.features.includes("restricted-view") ? (
            <EyeOffIcon className="size-3" />
          ) : (
            (seat.label ?? seat.id)
          )}
        </span>
      </button>
    )
  }

  const anyBlocked = ready.some((s) =>
    s.rows.some((r) =>
      r.cells.some((c) => c?.state === "blocked" && !held.has(c.id)),
    ),
  )
  // Zoned seats are explained by the zone entries instead.
  const prices = [...index.values()]
    .filter((i) => !i.seat.zone)
    .map((i) => i.seat.price)
    .filter((p): p is number => p !== undefined)
  const anyAccessible = [...index.values()].some((i) =>
    i.seat.features.includes("accessible"),
  )
  const anyRestricted = [...index.values()].some((i) =>
    i.seat.features.includes("restricted-view"),
  )
  const minPrice = prices.length ? Math.min(...prices) : 0
  const maxPrice = prices.length ? Math.max(...prices) : 0

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="seat-map"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={cn("@container", className)}
      >
        <SurfaceHeader className="flex-row flex-wrap items-center gap-x-3 gap-y-2 pb-3">
          <KindIcon kind={kind} />
          <SurfaceTitle id={titleId} className="min-w-0 flex-1">
            {heading}
          </SurfaceTitle>
          {/* Who and how many: the footer shows the same, so it's for screen readers. */}
          {(passengers.length > 0 || !streaming) && (
            <SurfaceDescription className="sr-only">
              {description}
              {heldText && `. ${heldText}`}
            </SurfaceDescription>
          )}
          {!done && ready.length > 1 && visible && (
            <Select
              value={visible.id}
              onValueChange={(v) => {
                if (typeof v === "string") changeSection(v)
              }}
              items={ready.map((s) => ({ value: s.id, label: s.label }))}
            >
              <SelectTrigger
                size="sm"
                aria-label={SECTION_NOUN[kind]}
                className="min-w-32"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ready.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </SurfaceHeader>

        <p id={hintId} className="sr-only">
          {visible?.stage === "below"
            ? "The stage is ahead of and below this level."
            : FRONT_HINT[kind]}{" "}
          {layout === "curved"
            ? "Rows curve around the stage. Left and right arrows follow the row; up and down move to the nearest seat in the next row."
            : layout === "boxes"
              ? "Each row is a box. Arrow keys move between available seats; up and down move between boxes."
              : "Arrow keys move between available seats."}{" "}
          Space or Enter picks one.
        </p>
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        {/*
          One quiet row above the map: the legend, or the hovered or focused
          seat's details in its place (the seat's name says the same). Both sit
          in one grid cell so the row keeps its height.
        */}
        <div className="grid px-3 pb-3 text-[13px] text-muted-foreground">
          {legend && index.size > 0 && (
            <ul
              aria-label="Legend"
              className={cn(
                "col-start-1 row-start-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1",
                detailSeat && "invisible",
              )}
            >
              <li className="flex items-center gap-1.5">
                <Swatch className="border-transparent bg-muted/70 dark:bg-white/[0.05]" />
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
              {held.size > 0 && (
                <li className="flex items-center gap-1.5">
                  <Swatch className="border-dashed border-foreground/60 bg-background" />
                  Current seat
                </li>
              )}
              {prices.length > 0 && (
                <li className="flex items-center gap-1.5 tabular-nums">
                  <Swatch className="border-transparent bg-emerald-500/20 dark:border-transparent dark:bg-emerald-400/20" />
                  {minPrice === maxPrice
                    ? money(minPrice)
                    : `${money(minPrice)}–${money(maxPrice)}`}{" "}
                  extra
                </li>
              )}
              {zoneList.map((z) => (
                <li
                  key={z.id}
                  className="flex items-center gap-1.5 tabular-nums"
                >
                  <Swatch className={cn("border-input", ZONE_FILLS[z.level])} />
                  {z.label} {money(z.price)}
                </li>
              ))}
              {anyRestricted && (
                <li className="flex items-center gap-1.5">
                  <Swatch className="border-input bg-background">
                    <EyeOffIcon className="size-2.5" />
                  </Swatch>
                  Restricted view
                </li>
              )}
              {anyAccessible && (
                <li className="flex items-center gap-1.5">
                  <Swatch className="border-input bg-background">
                    <AccessibilityIcon className="size-2.5" />
                  </Swatch>
                  Accessible
                </li>
              )}
            </ul>
          )}
          <p
            aria-hidden
            className="col-start-1 row-start-1 min-h-4 self-center text-center"
          >
            {detailSeat ? seatDetail(detailSeat, contextOf(detailSeat)) : null}
          </p>
        </div>

        <ScrollFade
          scrollRef={setMapEl}
          className="max-h-[26rem] border-t border-border [--seat-base:2rem] [--seat:var(--seat-base)] @max-sm:[--seat-base:1.75rem] @max-xs:[--seat-base:1.5rem]"
        >
          <section
            aria-label={visible ? `${visible.label} seat map` : "Seat map"}
            className="mx-auto w-max px-6 py-3"
          >
            <Frame kind={kind} stage={visible?.stage} wing={wingBox}>
              {visible && visible.rows.length > 0 ? (
                <GridPart
                  part="grid"
                  aria-label={`${visible.label} seats`}
                  aria-describedby={hintId}
                  aria-readonly={locked || undefined}
                  onKeyDown={onGridKeyDown}
                  onPointerLeave={() => setDetailId(null)}
                  className="flex flex-col gap-1"
                  style={
                    seatScale !== 1
                      ? ({
                          "--seat": `calc(var(--seat-base) * ${seatScale})`,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  {layout === "curved" && arc ? (
                    <div
                      className="relative"
                      style={
                        {
                          "--seat": `${seatPx}px`,
                          width: arc.width * seatPx,
                          height: arc.height * seatPx,
                        } as React.CSSProperties
                      }
                    >
                      {visible.rows.map((row, r) => {
                        const geo = arc.rows[r]
                        if (!geo) return null
                        const at = (p: { x: number; y: number }) => ({
                          left: p.x * seatPx,
                          top: p.y * seatPx,
                        })
                        return (
                          // Each row is a full-size layer; only its seats take pointer events.
                          <motion.div
                            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; labels may repeat
                            key={`${row.label}-${r}`}
                            role="row"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={genuiMotion.fade}
                            className="pointer-events-none absolute inset-0"
                          >
                            <GridPart
                              part="rowheader"
                              className="absolute flex size-(--seat) -translate-x-1/2 -translate-y-1/2 items-center justify-center text-[13px] tabular-nums text-muted-foreground"
                              style={at(geo.start)}
                            >
                              <span className="sr-only">Row </span>
                              {row.label}
                            </GridPart>
                            <span
                              aria-hidden
                              className="absolute flex size-(--seat) -translate-x-1/2 -translate-y-1/2 items-center justify-center text-[13px] tabular-nums text-muted-foreground"
                              style={at(geo.end)}
                            >
                              {row.label}
                            </span>
                            {row.cells.map((seat, col) => {
                              const p = geo.cells[col]
                              if (!seat || !p) return null
                              return (
                                <GridPart
                                  key={seat.id}
                                  part="gridcell"
                                  className="pointer-events-auto absolute"
                                  style={{
                                    ...at(p),
                                    // Seats turn to face the stage.
                                    transform: `translate(-50%, -50%) rotate(${-p.angle}deg)`,
                                  }}
                                >
                                  {renderSeat(seat, p.angle)}
                                </GridPart>
                              )
                            })}
                          </motion.div>
                        )
                      })}
                    </div>
                  ) : layout === "boxes" ? (
                    <div className="flex min-w-64 items-start justify-between gap-12">
                      {(() => {
                        const sides = boxSides(visible.rows)
                        return [sides.left, sides.right].map((rows, side) => (
                          <div
                            // biome-ignore lint/suspicious/noArrayIndexKey: the two sides are positional
                            key={side}
                            className="flex flex-col gap-3"
                          >
                            {rows.map((r) => {
                              const row = visible.rows[r]
                              const seatCount = row.cells.length
                              const cols =
                                seatCount <= 3
                                  ? seatCount
                                  : Math.ceil(seatCount / 2)
                              return (
                                <motion.div
                                  key={`${row.label}-${r}`}
                                  role="row"
                                  initial={{ opacity: 0, y: 4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  transition={{
                                    duration: 0.2,
                                    ease: "easeOut",
                                  }}
                                  className="flex flex-col items-center gap-1 rounded-md border border-dashed p-1.5"
                                >
                                  <GridPart
                                    part="rowheader"
                                    className="text-[13px] text-muted-foreground"
                                  >
                                    Box {row.label}
                                  </GridPart>
                                  <div
                                    className="grid gap-1"
                                    style={{
                                      gridTemplateColumns: `repeat(${cols}, var(--seat))`,
                                    }}
                                  >
                                    {row.cells.map((seat, col) =>
                                      seat ? (
                                        <GridPart key={seat.id} part="gridcell">
                                          {renderSeat(seat)}
                                        </GridPart>
                                      ) : (
                                        // biome-ignore lint/suspicious/noArrayIndexKey: gaps are positional
                                        <span key={`gap-${col}`} aria-hidden />
                                      ),
                                    )}
                                  </div>
                                </motion.div>
                              )
                            })}
                          </div>
                        ))
                      })()}
                    </div>
                  ) : (
                    <>
                      {showLetters && (
                        <div
                          aria-hidden
                          className="grid items-center gap-1 pb-0.5 text-center text-[13px] font-medium text-muted-foreground"
                          style={{ gridTemplateColumns: template }}
                        >
                          <span />
                          {letters.map((l, i) => (
                            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                            <span key={i}>{l}</span>
                          ))}
                        </div>
                      )}
                      {leadMarkers.map((m, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: markers are positional
                        <MarkerStrip key={`lead-${i}`} kind={m.kind} />
                      ))}
                      {visible.rows.map((row, r) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional; labels may repeat
                        <React.Fragment key={`${row.label}-${r}`}>
                          <motion.div
                            role="row"
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={genuiMotion.fade}
                            data-wing-row={wings.has(r) || undefined}
                            className="relative grid items-center gap-1"
                            style={{ gridTemplateColumns: template }}
                          >
                            <GridPart
                              part="rowheader"
                              className="text-center text-[13px] font-medium tabular-nums text-foreground/60"
                            >
                              <span className="sr-only">Row </span>
                              {row.label}
                            </GridPart>
                            {kinds.map((_, col) => {
                              const seat = row.cells[col]
                              if (!seat)
                                return (
                                  // biome-ignore lint/suspicious/noArrayIndexKey: gaps are positional
                                  <span key={`gap-${col}`} aria-hidden />
                                )
                              return (
                                <GridPart key={seat.id} part="gridcell">
                                  {renderSeat(seat)}
                                </GridPart>
                              )
                            })}
                            <span
                              aria-hidden
                              className="text-center text-[13px] font-medium tabular-nums text-foreground/60"
                            >
                              {kind === "plane" ? row.label : null}
                            </span>
                            {kind === "plane" && (
                              <>
                                {/* Cabin windows on the walls */}
                                <span
                                  aria-hidden
                                  className="absolute top-1/2 -left-[14.5px] h-3 w-[5px] -translate-y-1/2 rounded-full border bg-card"
                                />
                                <span
                                  aria-hidden
                                  className="absolute top-1/2 -right-[14.5px] h-3 w-[5px] -translate-y-1/2 rounded-full border bg-card"
                                />
                              </>
                            )}
                          </motion.div>
                          {markersAfter(row).map((m, i) => (
                            <MarkerStrip
                              // biome-ignore lint/suspicious/noArrayIndexKey: markers are positional
                              key={`${row.label}-m${i}`}
                              kind={m.kind}
                            />
                          ))}
                        </React.Fragment>
                      ))}
                    </>
                  )}
                  {streaming && <SkeletonRows rows={1} seats={6} />}
                </GridPart>
              ) : (
                <SkeletonRows rows={4} seats={6} />
              )}
            </Frame>
          </section>
        </ScrollFade>

        <SurfaceFooter className="items-center gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3">
              {multi ? (
                // biome-ignore lint/a11y/useSemanticElements: an inline group of toggle buttons; a fieldset's legend can't sit inline in the footer
                <div
                  role="group"
                  aria-label="Seat for"
                  className="-mx-3 flex flex-wrap items-end gap-1.5"
                >
                  {passengers.map((p) => {
                    const seat = seatOf(assigned, p.id)
                    const body = (
                      <>
                        <span className={genuiType.label}>{p.name}</span>
                        <SeatValue value={seat} />
                      </>
                    )
                    return done ? (
                      <div
                        key={p.id}
                        className="flex flex-col gap-1.5 px-3 py-2"
                      >
                        {body}
                      </div>
                    ) : (
                      <button
                        key={p.id}
                        type="button"
                        aria-pressed={p.id === activeId}
                        disabled={locked}
                        onClick={() => switchPassenger(p)}
                        className="flex flex-col items-start gap-1.5 rounded-lg px-3 py-2 text-left outline-none transition-colors border border-border hover:bg-muted dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none aria-pressed:bg-muted dark:aria-pressed:bg-accent aria-pressed:ring-2 aria-pressed:ring-choice aria-pressed:ring-inset"
                      >
                        {body}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex min-w-0 items-baseline gap-2.5">
                  <span className={genuiType.label}>{seatWord}</span>
                  <span className="flex items-baseline gap-2">
                    <SeatValue
                      value={seatText}
                      placeholder={
                        goal > 1 ? `Choose ${goal} seats` : "Choose a seat"
                      }
                    />
                    {fromText && (
                      <span className="text-[14px] text-muted-foreground">
                        {fromText}
                      </span>
                    )}
                  </span>
                </div>
              )}
              {total > 0 && (
                <div className="flex items-baseline gap-2.5">
                  <span className={genuiType.label}>
                    {priceWord === "total" ? "Total" : "Extra"}
                  </span>
                  <span className={genuiType.stat}>
                    <span className="sr-only">{money(total)}</span>
                    <RollingDigits text={money(total)} />
                  </span>
                </div>
              )}
            </div>
            {streaming ? (
              <p className={genuiType.meta}>
                <ShimmeringText
                  text="Loading seat map…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </p>
            ) : status === "selected" ? (
              <p className={cn(genuiType.meta, "flex items-center gap-1")}>
                <CheckIcon aria-hidden className="size-3.5" />
                {doneCount === 1 ? "Seat chosen" : "Seats chosen"}
              </p>
            ) : progress ? (
              <p className={genuiType.meta}>{progress}</p>
            ) : null}
          </div>
          {status !== "selected" && (
            <div className="ml-auto flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={dismiss}
                disabled={locked}
              >
                Cancel
              </Button>
              <WhyDisabled
                reason={
                  !locked &&
                  !complete &&
                  (goal > 1 ? "Pick all your seats first" : "Pick a seat first")
                }
              >
                <Button size="sm" onClick={submit} disabled={!canSubmit}>
                  {status === "submitting"
                    ? "Saving…"
                    : (submitLabel ??
                      (goal > 1 ? "Confirm seats" : "Confirm seat"))}
                </Button>
              </WhyDisabled>
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

// The Renderer hands this component onDraft.
SeatMap.genuiDraft = true
