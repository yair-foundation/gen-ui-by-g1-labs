"use client"

import * as React from "react"
import {
  ArmchairIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  CopyIcon,
  MinusIcon,
  PlusIcon,
  StarIcon,
  UsersIcon,
  UtensilsIcon,
} from "lucide-react"
import { MotionConfig } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
} from "@/components/genui/surface"
import { RadioMark } from "@/components/genui/genui-motion"
import {
  FormField,
  formSelectClass,
  formTextareaClass,
} from "@/components/genui/form-field"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"

import {
  areaLabel,
  areasIn,
  depositText,
  depositTotal,
  directionsUrl,
  durationText,
  filterByArea,
  formatDate,
  formatMoney,
  formatTime,
  formatTimeZone,
  groupByMeal,
  guestsLabel,
  parseTime,
  priceLevelText,
  relativeDay,
  waitlistPosition,
} from "./restaurant-reservation-utils"
import type {
  Reservation,
  ReservationParty,
  ReservationPolicies,
  ReservationRequests,
  ReservationSlot,
  Restaurant,
  RestaurantReservationInput,
  RestaurantReservationResult,
  SeatingArea,
} from "./restaurant-reservation.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { LogoTile } from "@/components/genui/logo-tile"

export type RestaurantReservationStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "reserved"
  | "change-requested"
  | "dismissed"
  | "cancel-requested"
  | "done"

type PartialSlot = Partial<ReservationSlot>
type PartialDay = { date?: string; slots?: PartialSlot[] }
type PartialPolicies = Partial<Omit<ReservationPolicies, "deposit">> & {
  deposit?: Partial<NonNullable<ReservationPolicies["deposit"]>>
}
type ReadyDay = { date: string; slots: ReservationSlot[]; pending: boolean }

export type RestaurantReservationProps = Partial<
  Omit<
    RestaurantReservationInput,
    | "restaurant"
    | "party"
    | "days"
    | "policies"
    | "requests"
    | "confirmation"
    | "source"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  restaurant?: Partial<Omit<Restaurant, "rating">> & {
    rating?: Partial<NonNullable<Restaurant["rating"]>>
  }
  party?: Partial<ReservationParty>
  days?: PartialDay[]
  policies?: PartialPolicies
  requests?: Partial<ReservationRequests>
  confirmation?: Partial<Reservation>
  source?: { label?: string; url?: string }
  /**
   * The moment "In 2 days" is measured from. Defaults to the viewer's clock,
   * read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's decision itself.
   */
  status?: RestaurantReservationStatus
  /**
   * Select mode: called once with reserve, change-party or dismiss. Reserve
   * is a handoff: open your booking flow. Confirmation mode: called once per
   * action; cancel-reservation only after the user confirms it.
   */
  onResult?: (result: RestaurantReservationResult) => void
  /**
   * Results from history (the tool call's stored output, or several). Renders
   * the finished state and never calls onResult.
   */
  result?: RestaurantReservationResult | RestaurantReservationResult[]
  className?: string
}

type SelectDecision = Extract<
  RestaurantReservationResult,
  { action: "reserve" | "change-party" | "dismiss" }
>
type ConfirmationAction = "modify" | "add-to-calendar" | "cancel-reservation"

const SELECT_ACTIONS = new Set(["reserve", "change-party", "dismiss"])
const AREAS = new Set<string>([
  "indoor",
  "outdoor",
  "bar",
  "counter",
  "private",
])
const NO_OCCASION = "__none__"
const NOTE_MAX = 200

const BOOKING_STATE: Record<
  Reservation["bookingState"],
  { label: string; variant: "success" | "warning" | "destructive" | "outline" }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  waitlist: { label: "On the waitlist", variant: "outline" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const CONFIRMATION_DONE: Record<ConfirmationAction, string> = {
  modify: "Asked to change the reservation",
  "add-to-calendar": "Added to calendar",
  "cancel-reservation": "Cancellation requested",
}

const chipClass =
  "relative flex cursor-pointer flex-col items-center justify-center rounded-lg border border-border bg-transparent text-center transition-colors hover:bg-accent dark:hover:bg-white/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:bg-muted dark:has-[:disabled]:hover:bg-transparent"
/** Button card for a radio or checkbox option that shares a line with others. */
const optionCardClass =
  "flex min-h-10 cursor-pointer items-center gap-2.5 rounded-[10px] border border-border px-3 py-3 text-[13px] leading-5 transition-colors hover:bg-muted dark:hover:bg-white/5 has-focus-visible:ring-2 has-focus-visible:ring-ring/50 has-disabled:cursor-default has-disabled:hover:bg-transparent dark:has-disabled:hover:bg-transparent"
const chipOn = "ring-2 ring-choice ring-inset dark:bg-accent"
const linkClass =
  "inline-flex min-h-6 items-center rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"

function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

/** A host `now` (Date, ISO string or epoch ms) as epoch ms, or null. */
function resolveNow(now: Date | string | number | undefined): number | null {
  if (now === undefined) return null
  const t = typeof now === "string" ? Date.parse(now) : new Date(now).getTime()
  return Number.isFinite(t) ? t : null
}

/**
 * The current time, read once after mount (so server and client render the
 * same markup). Skipped when the host passes `now`.
 */
function useMountedNow(active: boolean) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (active) setNow(Date.now())
  }, [active])
  return now
}

function toResults(
  result: RestaurantReservationProps["result"],
): RestaurantReservationResult[] {
  if (result === undefined) return []
  return Array.isArray(result) ? result : [result]
}

/** A host-provided "ready" (or nothing) yields to the user's decision. */
function resolveStatus(
  local: RestaurantReservationStatus | null,
  statusProp: RestaurantReservationStatus | undefined,
): RestaurantReservationStatus {
  return local && (statusProp === undefined || statusProp === "ready")
    ? local
    : (statusProp ?? "ready")
}

function isArea(a: unknown): a is SeatingArea {
  return typeof a === "string" && AREAS.has(a)
}

/** Days with their fully streamed slots; invalid times are dropped. */
function readyDays(days: PartialDay[], streaming: boolean): ReadyDay[] {
  return days
    .filter(
      (d): d is PartialDay & { date: string } => typeof d.date === "string",
    )
    .map((d, i, all) => ({
      date: d.date,
      // While streaming, the last day's slots may still be arriving.
      pending: streaming && i === all.length - 1 && !d.slots?.length,
      slots: (d.slots ?? [])
        .filter(
          (s): s is PartialSlot & { time: string } =>
            typeof s.time === "string" && parseTime(s.time) !== null,
        )
        .map((s) => ({
          time: s.time,
          areas: s.areas?.filter(isArea),
          note: s.note,
        })),
    }))
}

/** The policies as plain sentences, for the disclosure. */
function policyLines(
  policies: PartialPolicies | undefined,
  size: number,
  currency: string | undefined,
  locale: string,
): string[] {
  if (!policies) return []
  const deposit = policies.deposit
  return [
    policies.cancellation,
    typeof deposit?.amount === "number"
      ? depositText(
          {
            amount: deposit.amount,
            perPerson: deposit.perPerson,
            refundableUntil: deposit.refundableUntil,
          },
          size,
          currency,
          locale,
        )
      : null,
    policies.dressCode ? `Dress code: ${policies.dressCode}.` : null,
    typeof policies.maxDurationMinutes === "number"
      ? `Tables are held for ${durationText(policies.maxDurationMinutes)}.`
      : null,
  ].filter((l): l is string => Boolean(l))
}

// ---------------------------------------------------------------------------
// Shared pieces

function ExternalLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={linkClass}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function SourceNote({
  prefix,
  source,
}: {
  prefix: string
  source?: { label?: string; url?: string }
}) {
  if (!source?.label) return null
  const href = safeUrl(source.url)
  return (
    <p className={genuiType.meta}>
      {prefix}{" "}
      {href ? (
        <ExternalLink href={href}>{source.label}</ExternalLink>
      ) : (
        source.label
      )}
    </p>
  )
}

/** The one disclosure per card: secondary detail stays a click away. */
function DisclosureButton({
  open,
  controls,
  onToggle,
  children,
}: {
  open: boolean
  controls: string
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="-mx-3 -my-3 flex min-h-12 items-center gap-2 px-3 py-3 text-left text-[14px] font-medium outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset dark:hover:bg-white/[0.03]"
    >
      <ClipboardListIcon
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex-1">{children}</span>
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-4 shrink-0 text-muted-foreground transition-transform",
          open && "rotate-180",
        )}
      />
    </button>
  )
}

function Header({
  restaurant,
  currency,
  streaming,
  titleId,
}: {
  restaurant: NonNullable<RestaurantReservationProps["restaurant"]>
  currency?: string
  streaming: boolean
  titleId: string
}) {
  const locale = useGenUILocale()
  const price =
    typeof restaurant.priceLevel === "number"
      ? priceLevelText(restaurant.priceLevel, currency)
      : null
  const rating = restaurant.rating
  const score =
    typeof rating?.score === "number"
      ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
          rating.score,
        )
      : null
  const count =
    typeof rating?.count === "number"
      ? `${new Intl.NumberFormat(locale).format(rating.count)} ${rating.count === 1 ? "review" : "reviews"}`
      : null
  // One quiet line: "Portuguese · €€€ · Bairro Alto · 4.6/5".
  const meta: React.ReactNode[] = [
    restaurant.cuisine,
    price && (
      <>
        <span aria-hidden>{price.symbols}</span>
        <span className="sr-only">{price.label}</span>
      </>
    ),
    restaurant.neighborhood,
    score && (
      <>
        <span aria-hidden className="inline-flex items-center gap-1">
          <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
          <span className="font-medium text-foreground">{score}</span>
        </span>
        <span className="sr-only">
          {`Rated ${score}${typeof rating?.outOf === "number" ? ` out of ${rating.outOf}` : ""}${count ? `, from ${count}` : ""}`}
        </span>
      </>
    ),
  ].filter(Boolean)

  return (
    <SurfaceHeader className="flex-row items-center gap-3 pb-3">
      <LogoTile
        src={restaurant.logo?.url}
        darkSrc={restaurant.logo?.darkUrl}
        size={48}
        // Restaurant logos are detailed wordmarks; 6px of padding keeps them legible at 48px.
        className="p-1.5"
        fallback={<RestaurantIcon />}
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <SurfaceTitle id={titleId}>{restaurant.name}</SurfaceTitle>
        {meta.length > 0 ? (
          <p
            className={cn(
              genuiType.meta,
              "flex flex-wrap items-center tabular-nums",
            )}
          >
            {meta.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed, positional parts
              <React.Fragment key={i}>
                {i > 0 && (
                  <span aria-hidden className="px-1">
                    ·
                  </span>
                )}
                {m}
              </React.Fragment>
            ))}
          </p>
        ) : (
          streaming && <Skeleton className="h-3 w-48" />
        )}
      </div>
    </SurfaceHeader>
  )
}

/** The fork-and-knife icon, when the restaurant has no logo or it fails to load. */
function RestaurantIcon() {
  return (
    <span
      aria-hidden
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
    >
      <UtensilsIcon className="size-5" />
    </span>
  )
}

function Stepper({
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  value: number
  min: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  const id = React.useId()
  return (
    <fieldset
      aria-labelledby={id}
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
    >
      <span
        id={id}
        className={cn(genuiType.label, "inline-flex items-center gap-1.5")}
      >
        <UsersIcon aria-hidden className="size-3.5 shrink-0" />
        Party size
      </span>
      <div className="flex h-8 items-center gap-1">
        <WhyDisabled reason={!disabled && value <= min && "Minimum party size"}>
          <IconTip label="Remove a guest">
            <Button
              size="icon-sm"
              variant="secondary"
              aria-label="Remove a guest"
              disabled={disabled || value <= min}
              onClick={() => onChange(value - 1)}
            >
              <MinusIcon />
            </Button>
          </IconTip>
        </WhyDisabled>
        <span aria-live="polite" className="min-w-16 text-center tabular-nums">
          <span className="sr-only">{guestsLabel(value)}</span>
          <span
            aria-hidden
            className="inline-flex items-baseline justify-center"
          >
            <span className="font-figure text-[24px] leading-none font-normal">
              <SlidingNumber number={value} initiallyStable />
            </span>
            <span className="ml-1.5 text-[13px] text-muted-foreground">
              {value === 1 ? "guest" : "guests"}
            </span>
          </span>
        </span>
        <WhyDisabled reason={!disabled && value >= max && "Maximum party size"}>
          <IconTip label="Add a guest">
            <Button
              size="icon-sm"
              variant="secondary"
              aria-label="Add a guest"
              disabled={disabled || value >= max}
              onClick={() => onChange(value + 1)}
            >
              <PlusIcon />
            </Button>
          </IconTip>
        </WhyDisabled>
      </div>
    </fieldset>
  )
}

/**
 * The day picker: a calendar strip (month line with arrows; a serif date,
 * the weekday and a tick per day). Full days fade and say why.
 */
function DayStrip({
  days,
  current,
  streaming,
  locked,
  name,
  onPick,
}: {
  days: ReadyDay[]
  current: string | undefined
  streaming: boolean
  locked: boolean
  name: string
  onPick: (date: string) => void
}) {
  const locale = useGenUILocale()
  const row = React.useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(row, days.length)
  const [inView, setInView] = React.useState<[string, string] | null>(null)
  const dayKey = days.map((d) => d.date).join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-binds when the days change
  React.useEffect(() => {
    const el = row.current
    if (!el) return
    const update = () => {
      const box = el.getBoundingClientRect()
      const shown = [...el.querySelectorAll<HTMLElement>("[data-date]")]
        .filter((d) => {
          const r = d.getBoundingClientRect()
          return r.right > box.left + 36 && r.left < box.right - 36
        })
        .map((d) => d.dataset.date ?? "")
      if (!shown.length) return
      const next: [string, string] = [shown[0], shown[shown.length - 1]]
      setInView((v) => (v && v[0] === next[0] && v[1] === next[1] ? v : next))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    return () => el.removeEventListener("scroll", update)
  }, [dayKey])

  const first = inView?.[0] ?? days[0]?.date
  const last = inView?.[1] ?? first
  const month = (date: string, year: boolean) =>
    new Intl.DateTimeFormat(locale, {
      month: "long",
      ...(year ? { year: "numeric" } : {}),
      timeZone: "UTC",
    }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
  const monthLabel = first
    ? last && last.slice(0, 7) !== first.slice(0, 7)
      ? `${month(first, false)} – ${month(last, true)}`
      : month(first, true)
    : ""
  const scroll = (direction: 1 | -1) => {
    const el = row.current
    if (!el) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollBy({
      left: direction * el.clientWidth * 0.8,
      behavior: reduce ? "auto" : "smooth",
    })
  }

  return (
    <fieldset className="m-0 min-w-0 border-0 border-t border-border p-0">
      <legend className="sr-only">Day</legend>
      <div className="flex min-h-11 items-center justify-between gap-2 px-3 pt-2">
        <p
          aria-hidden
          className="text-[16px] leading-6 font-semibold whitespace-nowrap"
          suppressHydrationWarning
        >
          {monthLabel}
        </p>
        {(edges.prev || edges.next) && (
          <div className="flex items-center gap-1">
            <WhyDisabled when={!edges.prev} reason="First day">
              <IconTip label="Earlier days">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Earlier days"
                  disabled={!edges.prev}
                  onClick={() => scroll(-1)}
                  className="hover:bg-muted dark:hover:bg-white/10"
                >
                  <ArrowLeftIcon aria-hidden />
                </Button>
              </IconTip>
            </WhyDisabled>
            <WhyDisabled when={!edges.next} reason="Last day">
              <IconTip label="Later days">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Later days"
                  disabled={!edges.next}
                  onClick={() => scroll(1)}
                  className="hover:bg-muted dark:hover:bg-white/10"
                >
                  <ArrowRightIcon aria-hidden />
                </Button>
              </IconTip>
            </WhyDisabled>
          </div>
        )}
      </div>
      <div className="relative">
        <div
          ref={row}
          className="flex snap-x snap-mandatory scroll-px-3 gap-1 overflow-x-auto overscroll-x-contain px-3 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {days.map((day) => {
            const full = !day.pending && day.slots.length === 0
            const on = current === day.date && !full
            const label = (
              <label
                key={day.date}
                data-date={day.date}
                className={cn(
                  "group/day flex min-w-[4.5rem] flex-1 shrink-0 snap-start flex-col items-center gap-1.5 rounded-[12px] py-2 text-center transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50",
                  full || locked
                    ? "cursor-not-allowed"
                    : "cursor-pointer hover:bg-muted/60 dark:hover:bg-white/5",
                )}
              >
                <input
                  type="radio"
                  name={name}
                  value={day.date}
                  checked={on}
                  disabled={full || day.pending || locked}
                  onChange={() => onPick(day.date)}
                  className="sr-only"
                />
                <span
                  className={cn(
                    "font-figure text-[36px] leading-none font-normal tracking-tight tabular-nums lining-nums transition-colors",
                    on
                      ? "text-foreground"
                      : full
                        ? "text-muted-foreground/25"
                        : "text-muted-foreground/55 group-hover/day:text-foreground/80",
                  )}
                >
                  {day.date.slice(8, 10)}
                </span>
                <span
                  className={cn(
                    "text-[13px] leading-none lowercase",
                    on
                      ? "font-medium text-foreground"
                      : full
                        ? "text-muted-foreground/40"
                        : "text-muted-foreground",
                  )}
                  suppressHydrationWarning
                >
                  {formatDate(day.date, "weekday", locale)}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 h-4 w-0.5 origin-top rounded-full transition-[scale,background-color]",
                    on
                      ? "bg-choice"
                      : full
                        ? "scale-y-75 bg-transparent"
                        : "scale-y-75 bg-muted-foreground/40",
                  )}
                />
                <span className="sr-only" suppressHydrationWarning>
                  {`, ${formatDate(day.date, "day", locale)}${full ? ", fully booked" : ""}`}
                </span>
              </label>
            )
            return full ? (
              <IconTip key={day.date} label="Fully booked">
                {label}
              </IconTip>
            ) : (
              label
            )
          })}
          {streaming &&
            Array.from({ length: days.length ? 1 : 4 }, (_, i) => (
              <Skeleton
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                key={i}
                className="h-20 min-w-[4.5rem] flex-1 shrink-0 rounded-[12px]"
              />
            ))}
        </div>
        <ScrollFades edges={edges} />
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Entry

export function RestaurantReservation(props: RestaurantReservationProps) {
  if (props.mode === "confirmation") return <ConfirmationView {...props} />
  return <SelectView {...props} />
}

// ---------------------------------------------------------------------------
// Select mode

function SelectView({
  restaurant = {},
  party,
  days = [],
  defaultDate,
  policies,
  currency,
  requests,
  source,
  status: statusProp,
  onResult,
  result,
  className,
}: RestaurantReservationProps) {
  const locale = useGenUILocale()
  const restored = toResults(result).find((r) =>
    SELECT_ACTIONS.has(r.action),
  ) as SelectDecision | undefined
  const reservedInit = restored?.action === "reserve" ? restored : null

  const [decision, setDecision] = React.useState<SelectDecision | null>(
    restored ?? null,
  )
  const [size, setSize] = React.useState<number | null>(() =>
    restored && "size" in restored ? restored.size : null,
  )
  const [dayChoice, setDayChoice] = React.useState<string | null>(
    reservedInit?.date ?? null,
  )
  const [slotChoice, setSlotChoice] = React.useState<{
    date: string
    time: string
  } | null>(() =>
    reservedInit ? { date: reservedInit.date, time: reservedInit.time } : null,
  )
  const [areaFilter, setAreaFilter] = React.useState<SeatingArea | null>(null)
  // null: not chosen yet; "none": the user picked "No preference".
  const [seatArea, setSeatArea] = React.useState<SeatingArea | "none" | null>(
    reservedInit ? (reservedInit.area ?? "none") : null,
  )
  const [occasion, setOccasion] = React.useState<string | null>(
    reservedInit?.occasion ?? null,
  )
  const [dietary, setDietary] = React.useState<string[]>(
    reservedInit?.dietary ?? [],
  )
  const [note, setNote] = React.useState(reservedInit?.note ?? "")
  const [moreOpen, setMoreOpen] = React.useState(false)
  const uid = React.useId()
  const titleId = `${uid}-title`
  const moreId = `${uid}-more`

  const local: RestaurantReservationStatus | null = decision
    ? decision.action === "reserve"
      ? "reserved"
      : decision.action === "change-party"
        ? "change-requested"
        : "dismissed"
    : null
  const status = resolveStatus(local, statusProp)
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const locked = status !== "ready" && status !== "streaming"

  const quotedSize = party?.size
  const minSize = party?.min ?? 1
  const maxSize = Math.max(minSize, party?.max ?? 20)
  const currentSize = size ?? quotedSize ?? 2
  const sizeChanged =
    typeof quotedSize === "number" && currentSize !== quotedSize

  const ready = readyDays(days, streaming)
  const allAreas = areasIn(ready.flatMap((d) => d.slots))
  const hasSlots = (d: ReadyDay) => d.slots.length > 0
  const currentDay =
    ready.find((d) => d.date === dayChoice && hasSlots(d)) ??
    ready.find((d) => d.date === defaultDate && hasSlots(d)) ??
    ready.find(hasSlots) ??
    ready[0]
  const visible = currentDay ? filterByArea(currentDay.slots, areaFilter) : []
  const meals = groupByMeal(visible)
  const chosen =
    slotChoice && currentDay && slotChoice.date === currentDay.date
      ? visible.find((s) => s.time === slotChoice.time)
      : undefined
  const chosenAreas = chosen?.areas ?? []
  const area: SeatingArea | undefined =
    seatArea === "none"
      ? undefined
      : seatArea && chosenAreas.includes(seatArea)
        ? seatArea
        : areaFilter && chosenAreas.includes(areaFilter)
          ? areaFilter
          : chosenAreas.length === 1
            ? chosenAreas[0]
            : undefined

  const canReserve =
    !busy && !locked && !!chosen && !!currentDay && !sizeChanged
  const occasions = requests?.occasions?.filter(Boolean) ?? []
  const dietaryOptions = requests?.dietary?.filter(Boolean) ?? []
  const hasRequests =
    occasions.length > 0 || dietaryOptions.length > 0 || !!requests?.allowNote
  const policyText = policyLines(policies, currentSize, currency, locale)
  const moreLabel = hasRequests
    ? policyText.length > 0
      ? "Requests and policies"
      : "Requests"
    : "Policies"
  const deposit = policies?.deposit
  const depositLine =
    typeof deposit?.amount === "number"
      ? `${formatMoney(
          depositTotal(
            { amount: deposit.amount, perPerson: deposit.perPerson },
            currentSize,
            currency,
          ),
          currency,
          locale,
        )} deposit${deposit.refundableUntil ? `, refundable until ${deposit.refundableUntil}` : ""}`
      : null

  const pickDay = (date: string) => {
    setDayChoice(date)
    setSlotChoice(null)
    setSeatArea(null)
  }
  const reserve = () => {
    if (!canReserve || !chosen || !currentDay) return
    const r: SelectDecision = {
      action: "reserve",
      date: currentDay.date,
      time: chosen.time,
      size: currentSize,
      ...(area ? { area } : {}),
      ...(occasion ? { occasion } : {}),
      ...(dietary.length > 0 ? { dietary } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    setDecision(r)
    onResult?.(r)
  }
  const changeParty = () => {
    if (busy || locked || !sizeChanged) return
    const r: SelectDecision = { action: "change-party", size: currentSize }
    setDecision(r)
    onResult?.(r)
  }
  const dismiss = () => {
    if (busy || locked) return
    const r: SelectDecision = { action: "dismiss" }
    setDecision(r)
    onResult?.(r)
  }

  const reserved = decision?.action === "reserve" ? decision : null
  const zone = restaurant.timeZone
    ? formatTimeZone(restaurant.timeZone, ready[0]?.date)
    : null
  const finished =
    status === "reserved" ||
    status === "change-requested" ||
    status === "dismissed"
  // Areas on each time only help while the filter shows every area.
  const showAreas = !areaFilter && allAreas.length > 1

  const slotChip = (slot: ReservationSlot, day: string) => {
    const on = chosen?.time === slot.time
    const areas = slot.areas?.length
      ? slot.areas.map(areaLabel).join(" · ")
      : null
    const chip = (
      <label
        key={slot.time}
        className={cn(
          chipClass,
          "h-9 min-w-20 flex-row gap-1 rounded-full px-3.5",
          on && chipOn,
        )}
      >
        <input
          type="radio"
          name={`${uid}-time`}
          value={slot.time}
          checked={on}
          disabled={locked}
          onChange={() => {
            setSlotChoice({ date: day, time: slot.time })
            setSeatArea(null)
          }}
          className="sr-only"
        />
        {on && <CheckIcon aria-hidden className="size-3.5" />}
        <span
          className="text-[13px] font-medium tabular-nums"
          suppressHydrationWarning
        >
          {formatTime(slot.time, locale)}
        </span>
        {areas && <span className="sr-only">{`, ${areas}`}</span>}
        {slot.note && <span className="sr-only">{`, ${slot.note}`}</span>}
      </label>
    )
    // Where each time can seat you: a tooltip, while the filter shows them all.
    return showAreas && areas ? (
      <IconTip key={slot.time} label={areas}>
        {chip}
      </IconTip>
    ) : (
      chip
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="restaurant-reservation"
        data-status={status}
        data-mode="select"
        aria-busy={busy}
        aria-labelledby={restaurant.name ? titleId : undefined}
        aria-label={restaurant.name ? undefined : "Table reservation"}
        className={className}
      >
        <Header
          restaurant={restaurant}
          currency={currency}
          streaming={streaming}
          titleId={titleId}
        />

        <AutoHeight>
          {reserved ? (
            // The decision, read-only: what went to the booking flow.
            <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
              <p className={genuiType.stat} suppressHydrationWarning>
                {formatTime(reserved.time, locale)}
              </p>
              <p className={genuiType.body} suppressHydrationWarning>
                {[
                  formatDate(reserved.date, "short", locale),
                  guestsLabel(reserved.size),
                  reserved.area ? areaLabel(reserved.area) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {(reserved.occasion ||
                (reserved.dietary && reserved.dietary.length > 0) ||
                reserved.note) && (
                <p className={genuiType.meta}>
                  {[
                    reserved.occasion,
                    reserved.dietary?.join(", "),
                    reserved.note,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          ) : finished ? null : (
            <div className="flex flex-col">
              {/* Party and seating: one row of filters. */}
              <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-t border-border px-3 py-3">
                {typeof quotedSize === "number" ? (
                  <Stepper
                    value={currentSize}
                    min={minSize}
                    max={maxSize}
                    disabled={locked || busy}
                    onChange={(n) => setSize(n)}
                  />
                ) : (
                  streaming && <Skeleton className="h-11 w-36" />
                )}
                {allAreas.length > 0 && !sizeChanged && (
                  <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                    <legend className="sr-only">Seating</legend>
                    <span
                      aria-hidden
                      className={cn(
                        genuiType.label,
                        "inline-flex items-center gap-1.5",
                      )}
                    >
                      <ArmchairIcon aria-hidden className="size-3.5 shrink-0" />
                      Seating
                    </span>
                    <div className="flex h-8 flex-wrap items-center gap-2">
                      {[null, ...allAreas].map((a) => {
                        const on = areaFilter === a
                        return (
                          <label
                            key={a ?? "any"}
                            className={cn(
                              chipClass,
                              "min-h-8 rounded-full px-3.5 text-[13px]",
                              on && chipOn,
                            )}
                          >
                            <input
                              type="radio"
                              name={`${uid}-area-filter`}
                              value={a ?? "any"}
                              checked={on}
                              disabled={locked}
                              onChange={() => setAreaFilter(a)}
                              className="sr-only"
                            />
                            {a ? areaLabel(a) : "Any"}
                          </label>
                        )
                      })}
                    </div>
                  </fieldset>
                )}
              </div>

              {sizeChanged ? (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3">
                  <p className={genuiType.body}>
                    {`Availability is for ${guestsLabel(quotedSize)}.`}
                  </p>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={changeParty}
                    disabled={busy || locked}
                  >
                    {`Check for ${currentSize}`}
                  </Button>
                </div>
              ) : (
                <>
                  <DayStrip
                    days={ready}
                    current={currentDay?.date}
                    streaming={streaming}
                    locked={locked}
                    name={`${uid}-day`}
                    onPick={pickDay}
                  />
                  <div className="flex flex-col gap-5 border-t border-border px-3 py-3">
                    {currentDay && visible.length > 0 ? (
                      <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
                        <legend className="sr-only" suppressHydrationWarning>
                          {`Times on ${formatDate(currentDay.date, "long", locale)}${zone ? `, ${zone}` : ""}`}
                        </legend>
                        {(["lunch", "dinner"] as const).map((meal) =>
                          meals[meal].length > 0 ? (
                            <fieldset
                              key={meal}
                              className="m-0 min-w-0 border-0 p-0"
                            >
                              <legend
                                className={cn(genuiType.label, "mb-2 p-0")}
                              >
                                {meal === "lunch" ? "Lunch" : "Dinner"}
                              </legend>
                              <div className="flex flex-wrap gap-2">
                                {meals[meal].map((s) =>
                                  slotChip(s, currentDay.date),
                                )}
                              </div>
                            </fieldset>
                          ) : null,
                        )}
                      </fieldset>
                    ) : streaming && (!currentDay || currentDay.pending) ? (
                      <div aria-hidden className="flex flex-wrap gap-2">
                        {Array.from({ length: 4 }, (_, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                          <Skeleton key={i} className="h-9 w-20 rounded-full" />
                        ))}
                      </div>
                    ) : currentDay &&
                      currentDay.slots.length > 0 &&
                      areaFilter ? (
                      <p className={genuiType.body}>
                        {`No ${areaLabel(areaFilter).toLowerCase()} tables this day`}
                      </p>
                    ) : (
                      !streaming && (
                        <p className={genuiType.body}>No open tables</p>
                      )
                    )}
                  </div>

                  {/* The chosen time: the answer, big. */}
                  {chosen && currentDay && (
                    <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
                      <p className={genuiType.stat} suppressHydrationWarning>
                        {formatTime(chosen.time, locale)}
                      </p>
                      <p className={genuiType.body} suppressHydrationWarning>
                        {[
                          formatDate(currentDay.date, "short", locale),
                          guestsLabel(currentSize),
                          area ? areaLabel(area) : null,
                          chosen.note,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {depositLine && (
                        <p className={genuiType.meta}>{depositLine}</p>
                      )}
                      {chosenAreas.length > 1 && (
                        <fieldset className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2 border-0 p-0 pt-1.5">
                          <legend className="sr-only" suppressHydrationWarning>
                            {`Seating at ${formatTime(chosen.time, locale)}`}
                          </legend>
                          {[undefined, ...chosenAreas].map((a) => (
                            <label
                              key={a ?? "none"}
                              className={cn(
                                optionCardClass,
                                area === a &&
                                  "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                              )}
                            >
                              <input
                                type="radio"
                                name={`${uid}-seat`}
                                value={a ?? "none"}
                                checked={area === a}
                                disabled={locked}
                                onChange={() => setSeatArea(a ?? "none")}
                                className="peer sr-only"
                              />
                              <RadioMark
                                checked={area === a}
                                className="peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
                              />
                              {a ? areaLabel(a) : "No preference"}
                            </label>
                          ))}
                        </fieldset>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Requests, policies and source: one disclosure. */}
              {hasRequests || policyText.length > 0 ? (
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <DisclosureButton
                    open={moreOpen}
                    controls={moreId}
                    onToggle={() => setMoreOpen((o) => !o)}
                  >
                    {moreLabel}
                  </DisclosureButton>
                  <div
                    id={moreId}
                    hidden={!moreOpen}
                    className="flex flex-col gap-4"
                  >
                    {occasions.length > 0 && (
                      // An occasion is always chosen ("None" at least), so the label sits up.
                      <FormField
                        htmlFor={`${uid}-occasion-trigger`}
                        labelId={`${uid}-occasion`}
                        label="Occasion"
                        filled
                      >
                        <Select
                          value={occasion ?? NO_OCCASION}
                          onValueChange={(v) =>
                            setOccasion(
                              typeof v === "string" && v !== NO_OCCASION
                                ? v
                                : null,
                            )
                          }
                          items={[
                            { value: NO_OCCASION, label: "None" },
                            ...occasions.map((o) => ({ value: o, label: o })),
                          ]}
                          disabled={locked}
                        >
                          <SelectTrigger
                            id={`${uid}-occasion-trigger`}
                            aria-labelledby={`${uid}-occasion`}
                            className={formSelectClass}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={NO_OCCASION}>None</SelectItem>
                            {occasions.map((o) => (
                              <SelectItem key={o} value={o}>
                                {o}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormField>
                    )}
                    {dietaryOptions.length > 0 && (
                      <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                        <legend className={cn(genuiType.label, "mb-2 p-0")}>
                          Dietary needs
                        </legend>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,9rem),1fr))] gap-2">
                          {dietaryOptions.map((d, i) => (
                            // The label wraps the box and its text: either
                            // toggles it, and the text names it.
                            // biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside is the control (a button with role checkbox)
                            <label
                              key={d}
                              className={cn(
                                optionCardClass,
                                dietary.includes(d) &&
                                  "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                              )}
                            >
                              <Checkbox
                                nativeButton
                                size="sm"
                                id={`${uid}-diet-${i}`}
                                checked={dietary.includes(d)}
                                disabled={locked}
                                onCheckedChange={(on) =>
                                  setDietary((prev) =>
                                    on
                                      ? [...prev.filter((x) => x !== d), d]
                                      : prev.filter((x) => x !== d),
                                  )
                                }
                                // Larger tap area than the 18px box, without changing its look.
                                className="relative after:absolute after:-inset-2"
                              />
                              <span>{d}</span>
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    {requests?.allowNote && (
                      <FormField
                        htmlFor={`${uid}-note`}
                        label="Note for the restaurant"
                        pinned
                      >
                        <Textarea
                          id={`${uid}-note`}
                          value={note}
                          maxLength={NOTE_MAX}
                          disabled={locked}
                          aria-describedby={`${uid}-note-count`}
                          onChange={(e) =>
                            setNote(e.target.value.slice(0, NOTE_MAX))
                          }
                          className={formTextareaClass}
                        />
                        <span id={`${uid}-note-count`} className="sr-only">
                          {`${NOTE_MAX - note.length} characters left`}
                        </span>
                      </FormField>
                    )}
                    {policyText.length > 0 && (
                      <ul className={cn(genuiType.body, "flex flex-col gap-1")}>
                        {policyText.map((l) => (
                          <li key={l}>{l}</li>
                        ))}
                      </ul>
                    )}
                    <SourceNote prefix="Availability from" source={source} />
                  </div>
                </div>
              ) : (
                <div className="border-t border-border px-3 py-3">
                  <SourceNote prefix="Availability from" source={source} />
                </div>
              )}
            </div>
          )}
        </AutoHeight>

        <SurfaceFooter aria-live="polite">
          {streaming ? (
            <ShimmeringText
              text="Checking availability…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px]"
            />
          ) : status === "reserved" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4 shrink-0" />
              Sent to booking. Confirm there to book.
            </p>
          ) : status === "change-requested" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4 shrink-0" />
              {`Asked for tables for ${guestsLabel(
                decision && "size" in decision ? decision.size : currentSize,
              )}`}
            </p>
          ) : status === "dismissed" ? (
            <p className={genuiType.meta}>Cancelled. Nothing was booked.</p>
          ) : (
            <>
              {status === "submitting" ? (
                <p className={genuiType.meta}>Sending…</p>
              ) : (
                !chosen &&
                !sizeChanged && <p className={genuiType.meta}>Pick a time</p>
              )}
              <div className="ml-auto flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={dismiss}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <WhyDisabled
                  reason={
                    !canReserve &&
                    !busy &&
                    !chosen &&
                    !sizeChanged &&
                    "Pick a time first"
                  }
                >
                  <Button size="sm" disabled={!canReserve} onClick={reserve}>
                    {status === "submitting" ? "Sending…" : "Reserve"}
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

// ---------------------------------------------------------------------------
// Confirmation mode

function ConfirmationView({
  restaurant = {},
  policies,
  currency,
  confirmation,
  source,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: RestaurantReservationProps) {
  const locale = useGenUILocale()
  const [done, setDone] = React.useState<Set<ConfirmationAction>>(
    () =>
      new Set(
        toResults(result)
          .map((r) => r.action)
          .filter((a): a is ConfirmationAction => !SELECT_ACTIONS.has(a)),
      ),
  )
  const [confirmingCancel, setConfirmingCancel] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelButton = React.useRef<HTMLButtonElement>(null)
  const refocusCancel = React.useRef(false)
  const uid = React.useId()
  const titleId = `${uid}-title`
  const detailsId = `${uid}-details`

  const local: RestaurantReservationStatus | null = done.has(
    "cancel-reservation",
  )
    ? "cancel-requested"
    : done.size > 0
      ? "done"
      : null
  const status = resolveStatus(local, statusProp)
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const locked = status !== "ready" && status !== "done"

  const fixedNow = resolveNow(nowProp)
  const mountedNow = useMountedNow(fixedNow === null)
  const now = fixedNow ?? mountedNow

  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )
  // Return focus to "Cancel reservation" when the confirm step closes.
  React.useEffect(() => {
    if (!confirmingCancel && refocusCancel.current) {
      refocusCancel.current = false
      cancelButton.current?.focus()
    }
  }, [confirmingCancel])

  const c = confirmation ?? {}
  const bookingState = c.bookingState
  const cancelled = bookingState === "cancelled"
  const waitlist = bookingState === "waitlist"
  const position = waitlist ? waitlistPosition(c.notes) : null
  const relative =
    !streaming && !cancelled
      ? relativeDay(c.date, c.time, restaurant.timeZone, now)
      : null
  const zone =
    restaurant.timeZone && formatTimeZone(restaurant.timeZone, c.date)
  const directions = restaurant.address
    ? directionsUrl(restaurant.address)
    : null
  const website = safeUrl(restaurant.url)
  const tel = restaurant.phone?.replace(/[^\d+]/g, "")
  const cancelLabel = waitlist ? "Leave waitlist" : "Cancel reservation"
  const policyText =
    typeof c.size === "number" ? policyLines(policies, c.size, currency, locale) : []
  const quiet = position !== null ? `Position ${position}` : ""

  const fire = (action: ConfirmationAction) => {
    if (busy || locked || done.has(action)) return
    setDone((prev) => new Set(prev).add(action))
    onResult?.({ action })
  }
  const copy = async () => {
    if (!c.number) return
    try {
      await navigator.clipboard.writeText(c.number)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }
  const keep = () => {
    refocusCancel.current = true
    setConfirmingCancel(false)
  }
  const actionDisabled = (a: ConfirmationAction) =>
    busy || locked || done.has(a)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="restaurant-reservation"
        data-status={status}
        data-mode="confirmation"
        aria-busy={busy}
        aria-label={
          restaurant.name
            ? `Reservation at ${restaurant.name}`
            : "Table reservation"
        }
        className={cn("@container", className)}
      >
        <Header
          restaurant={restaurant}
          currency={currency}
          streaming={streaming}
          titleId={titleId}
        />

        <AutoHeight>
          <div className="flex flex-col">
            <div className="flex flex-wrap gap-x-6 border-t border-border">
              {/* When: the answer to "show my reservation". */}
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-3 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {c.time ? (
                    <p className={genuiType.stat} suppressHydrationWarning>
                      {formatTime(c.time, locale)}
                      {zone && (
                        <span className="sr-only">{`, restaurant time, ${zone}`}</span>
                      )}
                    </p>
                  ) : (
                    <Skeleton className="h-8 w-28" />
                  )}
                  {bookingState && (
                    <Badge variant={BOOKING_STATE[bookingState].variant}>
                      {BOOKING_STATE[bookingState].label}
                    </Badge>
                  )}
                </div>
                {c.date ? (
                  <p className={genuiType.body} suppressHydrationWarning>
                    {[
                      formatDate(c.date, "long", locale),
                      typeof c.size === "number" ? guestsLabel(c.size) : null,
                      c.area ? areaLabel(c.area) : null,
                      relative,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : (
                  <Skeleton className="h-4 w-48" />
                )}
                {quiet && (
                  <p className={cn(genuiType.meta, "tabular-nums")}>{quiet}</p>
                )}
                {/* The reference, on its own quiet line with a copy button. */}
                <p className="flex items-center gap-2 pt-1">
                  <span className={genuiType.label}>Confirmation</span>
                  {c.number ? (
                    <>
                      <span className="font-mono text-[13px] font-medium break-all">
                        {c.number}
                      </span>
                      <IconTip label={`Copy confirmation number ${c.number}`}>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Copy confirmation number ${c.number}`}
                          onClick={copy}
                          className="relative after:absolute after:-inset-1 hover:bg-muted dark:hover:bg-white/10"
                        >
                          {copied ? <CheckIcon /> : <CopyIcon />}
                        </Button>
                      </IconTip>
                    </>
                  ) : (
                    <Skeleton className="h-4 w-28" />
                  )}
                </p>
              </div>
            </div>

            {!streaming && (
              <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                <DisclosureButton
                  open={detailsOpen}
                  controls={detailsId}
                  onToggle={() => setDetailsOpen((o) => !o)}
                >
                  Reservation details
                </DisclosureButton>
                <div
                  id={detailsId}
                  hidden={!detailsOpen}
                  className="flex flex-col gap-4"
                >
                  {(c.guestName || c.notes) && (
                    <div className="flex flex-col gap-0.5">
                      {c.guestName && (
                        <p className={genuiType.body}>
                          <span className="sr-only">Guest: </span>
                          {c.guestName}
                        </p>
                      )}
                      {c.notes && (
                        <p className={genuiType.meta}>
                          <span className="sr-only">Notes: </span>
                          {c.notes}
                        </p>
                      )}
                    </div>
                  )}
                  {policyText.length > 0 && (
                    <ul className={cn(genuiType.body, "flex flex-col gap-1")}>
                      {policyText.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  )}
                  {restaurant.address && (
                    <div className="flex flex-col gap-0.5">
                      <address className={cn(genuiType.body, "not-italic")}>
                        {restaurant.address}
                      </address>
                      <div
                        className={cn(genuiType.meta, "flex flex-wrap gap-x-4")}
                      >
                        {directions && (
                          <ExternalLink href={directions}>
                            Directions
                          </ExternalLink>
                        )}
                        {website && (
                          <ExternalLink href={website}>Website</ExternalLink>
                        )}
                        {restaurant.phone && tel && (
                          <a
                            href={`tel:${tel}`}
                            aria-label={`Call ${restaurant.name ?? "the restaurant"}, ${restaurant.phone}`}
                            className={linkClass}
                          >
                            {restaurant.phone}
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  <SourceNote prefix="Booked via" source={source} />
                </div>
              </div>
            )}
          </div>
        </AutoHeight>

        <SurfaceFooter className="flex-col items-stretch gap-3">
          <div
            aria-live="polite"
            className={cn(
              !done.has("cancel-reservation") && "sr-only",
              genuiType.body,
            )}
          >
            {copied && <p>Confirmation number copied</p>}
            {[...done].map((a) => (
              <p
                key={a}
                className={cn(
                  "flex items-center gap-1.5",
                  a !== "cancel-reservation" && "sr-only",
                )}
              >
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {CONFIRMATION_DONE[a]}
              </p>
            ))}
          </div>

          {confirmingCancel && !locked ? (
            <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-between">
              <div className="flex flex-col gap-0.5">
                <p className={genuiType.body}>
                  {waitlist
                    ? "Leave the waitlist? You'll lose your place."
                    : "Cancel this reservation? This can't be undone."}
                </p>
                {!waitlist && policies?.cancellation && (
                  <p className={genuiType.meta}>{policies.cancellation}</p>
                )}
              </div>
              <div className="flex gap-2 @md:shrink-0">
                <Button
                  size="sm"
                  variant="secondary"
                  autoFocus
                  onClick={keep}
                  className="flex-1 @md:flex-none"
                >
                  {waitlist ? "Stay on waitlist" : "Keep reservation"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingCancel(false)
                    fire("cancel-reservation")
                  }}
                  className="flex-1 @md:flex-none"
                >
                  {cancelLabel}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {streaming ? (
                <ShimmeringText
                  text="Loading reservation…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                  className="text-[13px]"
                />
              ) : (
                status === "submitting" && (
                  <p className={genuiType.meta}>Sending…</p>
                )
              )}
              {!cancelled && (
                <div className="flex w-full flex-wrap items-center gap-2">
                  <Button
                    ref={cancelButton}
                    size="sm"
                    variant="ghost"
                    disabled={actionDisabled("cancel-reservation")}
                    className="mr-auto text-destructive hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/15"
                    onClick={() => setConfirmingCancel(true)}
                  >
                    {cancelLabel}
                    {done.has("cancel-reservation") && (
                      <span className="sr-only"> (done)</span>
                    )}
                  </Button>
                  {!waitlist && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={actionDisabled("add-to-calendar")}
                      onClick={() => fire("add-to-calendar")}
                    >
                      {done.has("add-to-calendar") ? (
                        <CheckIcon aria-hidden />
                      ) : (
                        <CalendarPlusIcon aria-hidden />
                      )}
                      {done.has("add-to-calendar")
                        ? "Added to calendar"
                        : "Add to calendar"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={actionDisabled("modify")}
                    onClick={() => fire("modify")}
                  >
                    {done.has("modify") && <CheckIcon aria-hidden />}
                    Modify
                    {done.has("modify") && (
                      <span className="sr-only"> (done)</span>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

/** Which sides of a horizontal scroller have more content past the edge. */
function useScrollEdges(
  ref: React.RefObject<HTMLElement | null>,
  dep?: unknown,
) {
  const [edges, setEdges] = React.useState({ prev: false, next: false })
  // biome-ignore lint/correctness/useExhaustiveDependencies: dep re-measures when the content changes
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const prev = el.scrollLeft > 4
      const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
      setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    resize?.observe(el)
    const mutation = new MutationObserver(update)
    mutation.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", update)
      resize?.disconnect()
      mutation.disconnect()
    }
  }, [ref, dep])
  return edges
}

/** Edge fades that say the row goes on; each shows only on its side. */
function ScrollFades({ edges }: { edges: { prev: boolean; next: boolean } }) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-14 bg-linear-to-r from-card to-transparent transition-opacity duration-200",
          edges.prev ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-14 bg-linear-to-l from-card to-transparent transition-opacity duration-200",
          edges.next ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  )
}
