"use client"

import * as React from "react"
import {
  BedDoubleIcon,
  CalendarPlusIcon,
  CalendarXIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  MinusIcon,
  PlusIcon,
  StarIcon,
  TicketIcon,
  WalletIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/genui/date-picker"
import {
  FormField,
  FormFieldGroup,
  formDateClass,
} from "@/components/genui/form-field"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { RadioMark } from "@/components/genui/genui-motion"
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
  addDays,
  cancellationTerms,
  checkDates,
  currencyDigits,
  type DateIssue,
  directionsUrl,
  formatMoney,
  formatStayDate,
  freeCancellationRelative,
  guestSummary,
  isFreeToCancel,
  nightsBetween,
  nightsLabel,
  type PricedRate,
  partyFits,
  partySize,
  type RateTotals,
  rateTotals,
  sameDates,
  sameParty,
  type StayPricing,
  stayPricing,
  staySummary,
} from "./hotel-booking-utils"
import type {
  Hotel,
  HotelBookingDraft,
  HotelBookingInput,
  HotelBookingResult,
  HotelBookingStay,
  HotelRate,
  HotelReservation,
  HotelRoom,
  HotelStay,
} from "./hotel-booking.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type HotelBookingStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "reserved"
  | "change-requested"
  | "dismissed"
  | "cancel-requested"
  | "done"

type PartialRate = Partial<Omit<HotelRate, "nightly" | "taxes" | "fees">> & {
  nightly?: Partial<HotelRate["nightly"][number]>[]
  taxes?: Partial<NonNullable<HotelRate["taxes"]>[number]>[]
  fees?: Partial<NonNullable<HotelRate["fees"]>[number]>[]
}
type PartialRoom = Partial<Omit<HotelRoom, "rates">> & {
  rates?: PartialRate[]
}
type ReadyRate = PartialRate & { id: string; label: string }
type ReadyRoom = Omit<PartialRoom, "rates"> & {
  id: string
  name: string
  maxGuests: number
  rates: ReadyRate[]
}

export type HotelBookingProps = Partial<
  Omit<
    HotelBookingInput,
    "hotel" | "stay" | "availability" | "rooms" | "confirmation" | "source"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  hotel?: Partial<Hotel>
  stay?: Partial<HotelStay>
  availability?: {
    minDate?: string
    maxDate?: string
    unavailable?: string[]
  }
  rooms?: PartialRoom[]
  confirmation?: Partial<HotelReservation>
  source?: { label?: string; url?: string }
  /**
   * The moment cancellation deadlines are compared with ("Free cancellation
   * for 6 more days"). Defaults to the viewer's clock, read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's decision itself.
   */
  status?: HotelBookingStatus
  /**
   * Select mode: called once with reserve, change-stay or dismiss. Reserve is
   * a handoff: open your booking flow. Confirmation mode: called once per
   * action; cancel-booking only after the user confirms it.
   */
  onResult?: (result: HotelBookingResult) => void
  /**
   * Called when the user's selection changes before they confirm, with the
   * result Reserve (or Check availability) would send now. Not a decision:
   * keep the latest and add it to the user's next typed message
   * (`describeUIState`).
   */
  onDraft?: (draft: HotelBookingDraft) => void
  /**
   * Results from history (the tool call's stored output, or several). Renders
   * the finished state and never calls onResult.
   */
  result?: HotelBookingResult | HotelBookingResult[]
  className?: string
}

type SelectDecision = Extract<
  HotelBookingResult,
  { action: "reserve" | "change-stay" | "dismiss" }
>
type ConfirmationAction = "manage" | "add-to-calendar" | "cancel-booking"

const SELECT_ACTIONS = new Set(["reserve", "change-stay", "dismiss"])
const LOW_STOCK = 3

const BOOKING_STATE: Record<
  HotelReservation["bookingState"],
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const CONFIRMATION_DONE: Record<ConfirmationAction, string> = {
  manage: "Opening booking management",
  "add-to-calendar": "Added to calendar",
  "cancel-booking": "Cancellation requested",
}

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

/** "Oct 17" in the hotel's time zone, for short cancellation copy. */
function deadlineDay(
  iso: string | undefined,
  timeZone: string | undefined,
  locale: string,
) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  try {
    return new Intl.DateTimeFormat(locale, { ...opts, timeZone }).format(t)
  } catch {
    return new Intl.DateTimeFormat(locale, opts).format(t)
  }
}

/** "Oct 15 – Oct 18", the stay at a glance. */
function shortRange(checkIn: string, checkOut: string, locale: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }
  const a = formatStayDate(checkIn, locale, opts)
  const b = formatStayDate(checkOut, locale, opts)
  return a && b ? `${a} – ${b}` : null
}

/** Only the fields that have fully streamed in, or null if pricing is incomplete. */
function toPricedRate(rate: PartialRate): PricedRate | null {
  if (!rate.payment || !rate.nightly) return null
  return {
    payment: rate.payment,
    nightly: rate.nightly.filter(
      (n): n is { date: string; amount: number } =>
        typeof n.date === "string" && typeof n.amount === "number",
    ),
    taxes: (rate.taxes ?? []).filter(
      (c): c is { label: string; amount: number; perNight?: boolean } =>
        typeof c.label === "string" && typeof c.amount === "number",
    ),
    fees: (rate.fees ?? []).filter(
      (
        c,
      ): c is {
        label: string
        amount: number
        perNight?: boolean
        payAtHotel?: boolean
      } => typeof c.label === "string" && typeof c.amount === "number",
    ),
  }
}

/** A money amount whose digits roll when it changes. */
function AnimatedMoney({
  amount,
  currency,
}: {
  amount: number
  currency?: string
}) {
  const locale = useGenUILocale()
  let format: Intl.NumberFormat
  try {
    format = new Intl.NumberFormat(locale, { style: "currency", currency })
  } catch {
    format = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }
  const parts = format.formatToParts(amount)
  const isNum = (t: string) =>
    t === "integer" || t === "group" || t === "decimal" || t === "fraction"
  const first = parts.findIndex((p) => isNum(p.type))
  const last =
    parts.length - 1 - [...parts].reverse().findIndex((p) => isNum(p.type))
  const text = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join("")
  const fraction = parts.find((p) => p.type === "fraction")?.value.length ?? 0

  return (
    <span className="tabular-nums">
      <span className="sr-only">{formatMoney(amount, currency, locale)}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {text(parts.slice(0, first))}
        <SlidingNumber
          number={Math.abs(amount)}
          decimalPlaces={fraction}
          decimalSeparator={
            parts.find((p) => p.type === "decimal")?.value ?? "."
          }
          thousandSeparator={parts.find((p) => p.type === "group")?.value}
          initiallyStable
        />
        {text(parts.slice(last + 1))}
      </span>
    </span>
  )
}

/** http(s) or a same-origin path with a single leading "/"; else null. */
function safeImageSrc(src?: string) {
  const value = src?.trim()
  if (value && /^\/(?![/\\])/.test(value)) return value
  return safeUrl(value)
}

function HotelImage({ image }: { image?: Partial<Hotel["image"]> }) {
  const src = safeImageSrc(image?.src)
  const [failed, setFailed] = React.useState<string | null>(null)
  if (!src || failed === src) return null
  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={image?.alt ?? ""}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(src)}
      className="h-24 w-full bg-muted object-cover"
    />
  )
}

function Stars({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center">
      <span aria-hidden className="inline-flex gap-px text-foreground/70">
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: identical, positional icons
          <StarIcon key={i} className="size-3 fill-current" />
        ))}
      </span>
      <span className="sr-only">{`${count}-star hotel`}</span>
    </span>
  )
}

/** "8.9 Excellent · Lisbon": one quiet line under the hotel name. */
function HotelMeta({
  rating,
  place,
}: {
  rating?: Partial<NonNullable<Hotel["rating"]>>
  place?: string
}) {
  const locale = useGenUILocale()
  const hasScore = typeof rating?.score === "number"
  if (!hasScore && !place) return null
  const score = hasScore
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
        rating?.score ?? 0,
      )
    : null
  const count =
    typeof rating?.count === "number"
      ? `${new Intl.NumberFormat(locale).format(rating.count)} ${rating.count === 1 ? "review" : "reviews"}`
      : null
  return (
    <p className={cn(genuiType.meta, "tabular-nums")}>
      {score && (
        <>
          <span aria-hidden>
            {[score, rating?.label].filter(Boolean).join(" ")}
          </span>
          <span className="sr-only">
            {`Rated ${score}${typeof rating?.outOf === "number" ? ` out of ${rating.outOf}` : ""}`}
            {rating?.label && `, ${rating.label}`}
            {count && `, from ${count}`}
            {place && ". "}
          </span>
          {place && <span aria-hidden> · </span>}
        </>
      )}
      {place}
    </p>
  )
}

function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  noun,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  disabled: boolean
  noun: string
  onChange: (value: number) => void
}) {
  const id = React.useId()
  return (
    <fieldset
      aria-labelledby={id}
      className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
    >
      <span id={id} className={genuiType.label}>
        {label}
      </span>
      <div className="flex w-full items-center justify-between gap-1">
        <IconTip label={`Remove ${noun}`}>
          <Button
            size="icon-sm"
            variant="secondary"
            aria-label={`Remove ${noun}`}
            disabled={disabled || value <= min}
            onClick={() => onChange(value - 1)}
          >
            <MinusIcon />
          </Button>
        </IconTip>
        <span
          aria-live="polite"
          className="inline-flex min-w-7 flex-1 justify-center text-2xl font-normal tabular-nums"
        >
          <span className="sr-only">{value}</span>
          <span aria-hidden>
            <SlidingNumber number={value} initiallyStable />
          </span>
        </span>
        <IconTip label={`Add ${noun}`}>
          <Button
            size="icon-sm"
            variant="secondary"
            aria-label={`Add ${noun}`}
            disabled={disabled || value >= max}
            onClick={() => onChange(value + 1)}
          >
            <PlusIcon />
          </Button>
        </IconTip>
      </div>
    </fieldset>
  )
}

function dateIssueText(issue: DateIssue, locale: string) {
  if (issue.kind === "order") return "Check-out must be after check-in."
  if (issue.kind === "range") {
    return `Choose dates between ${formatStayDate(issue.minDate, locale) ?? issue.minDate} and ${formatStayDate(issue.maxDate, locale) ?? issue.maxDate}.`
  }
  return `Not available on the night of ${issue.dates
    .map((d) => formatStayDate(d, locale) ?? d)
    .join(", ")}.`
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
      className={cn(
        genuiType.meta,
        "inline-flex min-h-6 items-center gap-1 self-start rounded-sm text-left tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      {children}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "size-3.5 shrink-0 transition-transform",
          open && "rotate-180",
        )}
      />
    </button>
  )
}

function PriceRow({
  label,
  children,
}: {
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd className="text-right whitespace-nowrap tabular-nums">{children}</dd>
    </div>
  )
}

/** Each night (or nights × average past a week), then every tax and fee. */
function PriceRows({
  totals,
  currency,
  payment,
}: {
  totals: RateTotals
  currency?: string
  payment: "now" | "at-hotel"
}) {
  const locale = useGenUILocale()
  const money = (n: number) => formatMoney(n, currency, locale)
  const count = totals.nights.length
  return (
    <dl
      aria-label="Price breakdown"
      className={cn(genuiType.body, "flex flex-col gap-1")}
    >
      {count <= 7 ? (
        totals.nights.map((n) => (
          <PriceRow
            key={n.date}
            label={
              <span suppressHydrationWarning>
                {formatStayDate(n.date, locale)}
              </span>
            }
          >
            {money(n.amount)}
          </PriceRow>
        ))
      ) : (
        <PriceRow
          label={`${nightsLabel(count)}, ${money(totals.average)} average`}
        >
          {money(totals.room)}
        </PriceRow>
      )}
      {[...totals.taxes, ...totals.fees].map((c, i) => (
        <PriceRow
          // biome-ignore lint/suspicious/noArrayIndexKey: labels may repeat
          key={i}
          label={
            c.atHotel && payment === "now"
              ? `${c.label}, due at hotel`
              : c.label
          }
        >
          {money(c.amount)}
        </PriceRow>
      ))}
    </dl>
  )
}

/** "€734.58 now · €32 at the hotel", "paid at the hotel", or null when it's all paid up front. */
function paySplit(
  totals: RateTotals,
  currency: string | undefined,
  nowWord: string,
  locale: string,
) {
  if (totals.payNow === 0) return "paid at the hotel"
  if (totals.payAtHotel > 0) {
    return `${formatMoney(totals.payNow, currency, locale)} ${nowWord} · ${formatMoney(totals.payAtHotel, currency, locale)} at the hotel`
  }
  return null
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
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={linkClass}
        >
          {source.label}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        source.label
      )}
    </p>
  )
}

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

function RoomSkeleton() {
  return (
    <li aria-hidden className="flex gap-3 px-3 py-3">
      <Skeleton className="mt-0.5 size-4 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="h-3 w-32 max-w-full" />
      </div>
      <Skeleton className="h-4 w-16" />
    </li>
  )
}

export function HotelBooking({
  mode,
  hotel = {},
  stay,
  availability,
  rooms = [],
  currency,
  confirmation,
  source,
  now: nowProp,
  status: statusProp,
  onResult,
  onDraft,
  result,
  className,
}: HotelBookingProps) {
  const locale = useGenUILocale()
  const restoredResults: HotelBookingResult[] =
    result === undefined ? [] : Array.isArray(result) ? result : [result]

  const [decision, setDecision] = React.useState<SelectDecision | null>(
    () =>
      (restoredResults.find((r) => SELECT_ACTIONS.has(r.action)) as
        | SelectDecision
        | undefined) ?? null,
  )
  const [draft, setDraft] = React.useState<Partial<HotelBookingStay> | null>(
    () => (decision && "stay" in decision ? decision.stay : null),
  )
  const [pickedRoom, setPickedRoom] = React.useState<string | undefined>(() =>
    decision?.action === "reserve" ? decision.roomId : undefined,
  )
  const [pickedRates, setPickedRates] = React.useState<Record<string, string>>(
    () =>
      decision?.action === "reserve"
        ? { [decision.roomId]: decision.rateId }
        : {},
  )
  const [done, setDone] = React.useState<Set<ConfirmationAction>>(
    () =>
      new Set(
        restoredResults
          .map((r) => r.action)
          .filter((a): a is ConfirmationAction => !SELECT_ACTIONS.has(a)),
      ),
  )
  const [confirmingCancel, setConfirmingCancel] = React.useState(false)
  const [copied, setCopied] = React.useState(false)
  const [touched, setTouched] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelButton = React.useRef<HTMLButtonElement>(null)
  const refocusCancel = React.useRef(false)
  const uid = React.useId()
  const detailsId = `${uid}-details`

  const local: HotelBookingStatus | null = decision
    ? decision.action === "reserve"
      ? "reserved"
      : decision.action === "change-stay"
        ? "change-requested"
        : "dismissed"
    : done.has("cancel-booking")
      ? "cancel-requested"
      : done.size > 0
        ? "done"
        : null
  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: HotelBookingStatus =
    local && (statusProp === undefined || statusProp === "ready")
      ? local
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const isConfirmation = mode === "confirmation"
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
  // Return focus to "Cancel booking" when the confirm step closes.
  React.useEffect(() => {
    if (!confirmingCancel && refocusCancel.current) {
      refocusCancel.current = false
      cancelButton.current?.focus()
    }
  }, [confirmingCancel])

  const digits = currencyDigits(currency)
  const money = (n: number) => formatMoney(n, currency, locale)

  const quoted: HotelBookingStay | null =
    typeof stay?.checkIn === "string" &&
    typeof stay.checkOut === "string" &&
    typeof stay.adults === "number"
      ? {
          checkIn: stay.checkIn,
          checkOut: stay.checkOut,
          adults: stay.adults,
          children: stay.children ?? 0,
          rooms: stay.rooms ?? 1,
        }
      : null
  const current: HotelBookingStay | null = quoted
    ? { ...quoted, ...draft }
    : null

  const readyRooms: ReadyRoom[] = rooms
    .filter(
      (r): r is PartialRoom & { id: string; name: string; maxGuests: number } =>
        typeof r.id === "string" &&
        typeof r.name === "string" &&
        typeof r.maxGuests === "number",
    )
    .map((r) => ({
      ...r,
      rates: (r.rates ?? []).filter(
        (rate): rate is ReadyRate =>
          typeof rate.id === "string" && typeof rate.label === "string",
      ),
    }))

  const pricingFor = (rate: ReadyRate): StayPricing | null => {
    if (streaming || !quoted || !current) return null
    const priced = toPricedRate(rate)
    return priced ? stayPricing(priced, current, quoted, digits) : null
  }

  /** The full terms: "Free cancellation until Oct 17, 23:59 hotel time". */
  const terms = (rate: ReadyRate) =>
    typeof rate.refundable === "boolean"
      ? cancellationTerms(
          {
            refundable: rate.refundable,
            freeCancelUntil: rate.freeCancelUntil,
          },
          hotel.timeZone,
          locale,
        )
      : null
  /** The short terms for an option: "Free cancellation until Oct 17". */
  const shortTerms = (rate: ReadyRate) => {
    if (typeof rate.refundable !== "boolean") return null
    if (!rate.refundable) return "Non-refundable"
    const day = deadlineDay(rate.freeCancelUntil, hotel.timeZone, locale)
    return day ? `Free cancellation until ${day}` : "Free cancellation"
  }

  const header = (place: string | undefined) => (
    <>
      <HotelImage image={hotel.image} />
      <SurfaceHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <SurfaceTitle>{hotel.name}</SurfaceTitle>
          {typeof hotel.stars === "number" && hotel.stars >= 1 && (
            <Stars count={Math.min(5, Math.round(hotel.stars))} />
          )}
        </div>
        {hotel.rating || place ? (
          <HotelMeta rating={hotel.rating} place={place} />
        ) : (
          streaming && <Skeleton className="h-3 w-48" />
        )}
      </SurfaceHeader>
    </>
  )

  // -------------------------------------------------------------------------
  // Select-mode state, worked out before the confirmation return so the
  // draft effect below runs on every render, as hooks must.

  const party = current ?? { adults: 1, children: 0, rooms: 1 }
  const roomCount = party.rooms ?? 1
  const size = partySize(party)
  const selectable = (r: ReadyRoom) =>
    partyFits(r, party) && r.remaining !== 0 && r.rates.length > 0
  const room =
    readyRooms.find((r) => r.id === pickedRoom && (locked || selectable(r))) ??
    readyRooms.find(selectable)
  const rate =
    room?.rates.find((r) => r.id === pickedRates[room.id]) ?? room?.rates[0]
  const pricing = rate ? pricingFor(rate) : null
  const totals = pricing?.kind === "priced" ? pricing.totals : null

  const datesChanged = !!current && !!quoted && !sameDates(current, quoted)
  const partyChanged = !!current && !!quoted && !sameParty(current, quoted)
  const dateIssue =
    current && datesChanged ? checkDates(current, availability) : null
  const recheck =
    !streaming &&
    !!current &&
    (datesChanged || partyChanged) &&
    !dateIssue &&
    (pricing?.kind === "recheck" || !room)

  const capacity = Math.max(0, ...readyRooms.map((r) => r.maxGuests))
  const maxGuests = capacity > 0 ? capacity * roomCount : 10
  const canEditDates =
    typeof availability?.minDate === "string" &&
    typeof availability.maxDate === "string"

  const canReserve =
    !busy &&
    !locked &&
    !!room &&
    !!rate &&
    !!totals &&
    !!current &&
    !dateIssue &&
    typeof currency === "string"

  // What the user would send if they confirmed now: reserve when the picked
  // room and rate are priced, change-stay when new dates or guests need a
  // new quote. Reported once they touch something (D70).
  const draftResult: SelectDecision | null =
    isConfirmation || !touched || locked || busy || !current
      ? null
      : recheck
        ? { action: "change-stay", stay: current }
        : canReserve && room && rate && totals && currency
          ? {
              action: "reserve",
              roomId: room.id,
              rateId: rate.id,
              stay: current,
              total: {
                amount: totals.total,
                payNow: totals.payNow,
                payAtHotel: totals.payAtHotel,
                currency,
              },
            }
          : null
  const draftKey = draftResult ? JSON.stringify(draftResult) : null
  const onDraftRef = React.useRef(onDraft)
  onDraftRef.current = onDraft
  React.useEffect(() => {
    if (draftKey) onDraftRef.current?.(JSON.parse(draftKey))
  }, [draftKey])

  // -------------------------------------------------------------------------
  // Confirmation mode

  if (isConfirmation) {
    const bookedRoom = readyRooms.find((r) => r.id === confirmation?.roomId)
    const bookedRate = bookedRoom?.rates.find(
      (r) => r.id === confirmation?.rateId,
    )
    const priced = bookedRate && !streaming ? toPricedRate(bookedRate) : null
    const totals = priced && quoted ? rateTotals(priced, quoted, digits) : null
    const bookingState = confirmation?.bookingState
    const cancelled = bookingState === "cancelled"
    const freeNow = bookedRate
      ? isFreeToCancel(
          {
            refundable: bookedRate.refundable ?? false,
            freeCancelUntil: bookedRate.freeCancelUntil,
          },
          now,
        )
      : false
    const relative =
      bookedRate?.refundable && !cancelled
        ? freeCancellationRelative(bookedRate.freeCancelUntil, now)
        : null
    const freeUntilDay = deadlineDay(
      bookedRate?.freeCancelUntil,
      hotel.timeZone,
      locale,
    )
    const confirmText = !bookedRate?.refundable
      ? "Cancel this booking? This rate is non-refundable."
      : !freeNow
        ? "Cancel this booking? Free cancellation has ended."
        : freeUntilDay
          ? `Cancel this booking? Free until ${freeUntilDay}.`
          : "Cancel this booking? It's free to cancel."
    const nights = quoted ? nightsBetween(quoted.checkIn, quoted.checkOut) : 0
    const range = quoted
      ? shortRange(quoted.checkIn, quoted.checkOut, locale)
      : null
    const directions = hotel.address
      ? directionsUrl(hotel.address, hotel.city)
      : null
    const website = safeUrl(hotel.url)
    const tel = hotel.phone?.replace(/[^\d+]/g, "")
    const times = [
      hotel.checkInFrom && `Check-in from ${hotel.checkInFrom}`,
      hotel.checkOutUntil && `check-out until ${hotel.checkOutUntil}`,
    ].filter(Boolean)
    const split =
      totals && bookedRate?.payment
        ? paySplit(
            totals,
            currency,
            bookingState === "pending" ? "to be charged" : "paid",
            locale,
          )
        : null
    const fullTerms = bookedRate ? terms(bookedRate) : null

    const fire = (action: ConfirmationAction) => {
      if (busy || locked || done.has(action)) return
      setDone((prev) => new Set(prev).add(action))
      onResult?.({ action })
    }
    const copy = async () => {
      if (!confirmation?.number) return
      try {
        await navigator.clipboard.writeText(confirmation.number)
        setCopied(true)
        if (copyTimer.current) clearTimeout(copyTimer.current)
        copyTimer.current = setTimeout(() => setCopied(false), 1500)
      } catch {
        setCopied(false)
      }
    }
    const keepBooking = () => {
      refocusCancel.current = true
      setConfirmingCancel(false)
    }
    const actionDisabled = (a: ConfirmationAction) =>
      busy || locked || done.has(a)

    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="hotel-booking"
          data-status={status}
          data-mode="confirmation"
          aria-busy={busy}
          aria-label={hotel.name ? `Booking at ${hotel.name}` : "Hotel booking"}
          className={cn("@container", className)}
        >
          {header(hotel.city ?? hotel.address)}

          <AutoHeight>
            <div className="flex flex-col">
              {/* The stay: the answer to "show my booking". */}
              <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {range ? (
                    <p className={genuiType.stat} suppressHydrationWarning>
                      {range}
                    </p>
                  ) : (
                    <Skeleton className="h-8 w-48" />
                  )}
                  {bookingState && (
                    <Badge variant={BOOKING_STATE[bookingState].variant}>
                      {BOOKING_STATE[bookingState].label}
                    </Badge>
                  )}
                </div>
                {quoted && (
                  <p className={genuiType.meta}>
                    {nightsLabel(nights)} · {guestSummary(quoted)}
                  </p>
                )}
              </div>

              <dl className="grid grid-cols-2 gap-x-10 gap-y-3 border-t border-border px-3 py-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <TicketIcon aria-hidden className="size-3.5 shrink-0" />
                    Confirmation
                  </dt>
                  <dd className="flex items-center gap-1">
                    {confirmation?.number ? (
                      <>
                        <span className="font-mono text-[13px] font-medium break-all">
                          {confirmation.number}
                        </span>
                        <IconTip
                          label={`Copy confirmation number ${confirmation.number}`}
                        >
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            aria-label={`Copy confirmation number ${confirmation.number}`}
                            onClick={copy}
                            className="relative after:absolute after:-inset-1"
                          >
                            {copied ? <CheckIcon /> : <CopyIcon />}
                          </Button>
                        </IconTip>
                      </>
                    ) : (
                      <Skeleton className="h-4 w-28" />
                    )}
                  </dd>
                </div>
                {(totals || streaming) && (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt
                      className={cn(
                        genuiType.label,
                        "flex items-center gap-1.5",
                      )}
                    >
                      <WalletIcon aria-hidden className="size-3.5 shrink-0" />
                      Total
                    </dt>
                    <dd
                      className={cn(genuiType.body, "font-medium tabular-nums")}
                    >
                      {totals ? (
                        money(totals.total)
                      ) : (
                        <Skeleton className="h-4 w-20" />
                      )}
                    </dd>
                  </div>
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <BedDoubleIcon aria-hidden className="size-3.5 shrink-0" />
                    Room
                  </dt>
                  <dd className={genuiType.body}>
                    {bookedRoom ? (
                      [bookedRoom.name, bookedRate?.label]
                        .filter(Boolean)
                        .join(" · ")
                    ) : (
                      <Skeleton className="h-4 w-32" />
                    )}
                  </dd>
                </div>
                {bookedRate &&
                  typeof bookedRate.refundable === "boolean" &&
                  !cancelled && (
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <dt
                        className={cn(
                          genuiType.label,
                          "flex items-center gap-1.5",
                        )}
                      >
                        <CalendarXIcon
                          aria-hidden
                          className="size-3.5 shrink-0"
                        />
                        Cancellation
                      </dt>
                      <dd className={genuiType.body} suppressHydrationWarning>
                        {relative ?? shortTerms(bookedRate)}
                      </dd>
                    </div>
                  )}
              </dl>

              {!streaming && (
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <DisclosureButton
                    open={detailsOpen}
                    controls={detailsId}
                    onToggle={() => setDetailsOpen((o) => !o)}
                  >
                    Booking details
                  </DisclosureButton>
                  <div
                    id={detailsId}
                    hidden={!detailsOpen}
                    className="flex flex-col gap-4"
                  >
                    {(confirmation?.guestName || times.length > 0) && (
                      <div className="flex flex-col gap-0.5">
                        {confirmation?.guestName && (
                          <p className={genuiType.body}>
                            <span className="sr-only">Guest: </span>
                            {confirmation.guestName}
                          </p>
                        )}
                        {times.length > 0 && (
                          <p className={genuiType.meta}>
                            {`${times.join(", ")}, hotel time`}
                          </p>
                        )}
                      </div>
                    )}
                    {totals && bookedRate?.payment && (
                      <div className="flex flex-col gap-1">
                        <PriceRows
                          totals={totals}
                          currency={currency}
                          payment={bookedRate.payment}
                        />
                        {split && (
                          <p
                            className={cn(
                              genuiType.meta,
                              "first-letter:uppercase",
                            )}
                          >
                            {split}
                          </p>
                        )}
                      </div>
                    )}
                    {fullTerms && (
                      <p className={genuiType.meta} suppressHydrationWarning>
                        {fullTerms}
                      </p>
                    )}
                    {hotel.address && (
                      <div className="flex flex-col gap-0.5">
                        <address className={cn(genuiType.body, "not-italic")}>
                          {[hotel.address, hotel.city]
                            .filter(Boolean)
                            .join(", ")}
                        </address>
                        <div
                          className={cn(
                            genuiType.meta,
                            "flex flex-wrap gap-x-4",
                          )}
                        >
                          {directions && (
                            <ExternalLink href={directions}>
                              Directions
                            </ExternalLink>
                          )}
                          {website && (
                            <ExternalLink href={website}>Website</ExternalLink>
                          )}
                          {hotel.phone && tel && (
                            <a href={`tel:${tel}`} className={linkClass}>
                              {hotel.phone}
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
                !done.has("cancel-booking") && "sr-only",
                genuiType.body,
              )}
            >
              {copied && <p>Confirmation number copied</p>}
              {[...done].map((a) => (
                <p
                  key={a}
                  className={cn(
                    "flex items-center gap-1.5",
                    a !== "cancel-booking" && "sr-only",
                  )}
                >
                  <CheckIcon aria-hidden className="size-4 shrink-0" />
                  {CONFIRMATION_DONE[a]}
                </p>
              ))}
            </div>

            {confirmingCancel && !locked ? (
              <div className="flex flex-col gap-2 @md:flex-row @md:items-center @md:justify-between">
                <p className={genuiType.body} suppressHydrationWarning>
                  {confirmText}
                </p>
                <div className="flex gap-2 @md:shrink-0">
                  <Button
                    size="sm"
                    variant="secondary"
                    autoFocus
                    onClick={keepBooking}
                    className="flex-1 @md:flex-none"
                  >
                    Keep booking
                  </Button>
                  <WhyDisabled className="flex flex-1 @md:flex-none" when={busy} reason="Cancelling…">
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onClick={() => {
                        setConfirmingCancel(false)
                        fire("cancel-booking")
                      }}
                      className="flex-1 @md:flex-none"
                    >
                      Cancel booking
                    </Button>
                  </WhyDisabled>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                {streaming ? (
                  <ShimmeringText
                    text="Loading booking…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                    className="text-[13px] leading-4"
                  />
                ) : (
                  status === "submitting" && (
                    <p className={genuiType.meta}>Sending…</p>
                  )
                )}
                {!cancelled && (
                  <div className="ml-auto flex gap-2">
                    <WhyDisabled
                      when={actionDisabled("cancel-booking")}
                      reason="Not available right now"
                    >
                      <Button
                        ref={cancelButton}
                        size="sm"
                        variant="secondary"
                        disabled={actionDisabled("cancel-booking")}
                        onClick={() => setConfirmingCancel(true)}
                      >
                        Cancel booking
                        {done.has("cancel-booking") && (
                          <span className="sr-only"> (done)</span>
                        )}
                      </Button>
                    </WhyDisabled>
                    <WhyDisabled
                      when={actionDisabled("add-to-calendar")}
                      reason={
                        done.has("add-to-calendar")
                          ? "Already added"
                          : "Not available right now"
                      }
                    >
                      <IconTip
                        label={
                          done.has("add-to-calendar")
                            ? "Add to calendar (done)"
                            : "Add to calendar"
                        }
                      >
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label={
                            done.has("add-to-calendar")
                              ? "Add to calendar (done)"
                              : "Add to calendar"
                          }
                          disabled={actionDisabled("add-to-calendar")}
                          onClick={() => fire("add-to-calendar")}
                        >
                          {done.has("add-to-calendar") ? (
                            <CheckIcon aria-hidden />
                          ) : (
                            <CalendarPlusIcon aria-hidden />
                          )}
                        </Button>
                      </IconTip>
                    </WhyDisabled>
                    <WhyDisabled
                      when={actionDisabled("manage")}
                      reason="Not available right now"
                    >
                      <Button
                        size="sm"
                        disabled={actionDisabled("manage")}
                        onClick={() => fire("manage")}
                      >
                        {done.has("manage") && <CheckIcon aria-hidden />}
                        Manage
                        {done.has("manage") && (
                          <span className="sr-only"> (done)</span>
                        )}
                      </Button>
                    </WhyDisabled>
                  </div>
                )}
              </div>
            )}
          </SurfaceFooter>
        </Surface>
      </MotionConfig>
    )
  }

  // -------------------------------------------------------------------------
  // Select mode

  const updateDraft = (patch: Partial<HotelBookingStay>) => {
    if (locked || busy || !current) return
    setDraft({ ...current, ...patch })
    setTouched(true)
  }
  const setCheckIn = (value: string) => {
    if (!value || !current) return
    const length = Math.max(1, nightsBetween(current.checkIn, current.checkOut))
    let checkOut = current.checkOut
    if (nightsBetween(value, checkOut) < 1) {
      checkOut = addDays(value, length) ?? checkOut
      const max = availability?.maxDate
      if (max && checkOut > max) checkOut = max
    }
    updateDraft({ checkIn: value, checkOut })
  }

  const reserve = () => {
    if (!canReserve || !room || !rate || !totals || !current || !currency) {
      return
    }
    const r: SelectDecision = {
      action: "reserve",
      roomId: room.id,
      rateId: rate.id,
      stay: current,
      total: {
        amount: totals.total,
        payNow: totals.payNow,
        payAtHotel: totals.payAtHotel,
        currency,
      },
    }
    setDecision(r)
    onResult?.(r)
  }
  const changeStay = () => {
    if (busy || locked || !current || dateIssue) return
    const r: SelectDecision = { action: "change-stay", stay: current }
    setDecision(r)
    onResult?.(r)
  }
  const dismiss = () => {
    if (busy || locked) return
    const r: SelectDecision = { action: "dismiss" }
    setDecision(r)
    onResult?.(r)
  }

  const recheckText =
    pricing?.kind === "recheck" && pricing.reason === "guests" && quoted
      ? `Prices are for ${guestSummary(quoted)}.`
      : !room && partyChanged
        ? `No room fits ${guestSummary(party)}.`
        : "Not priced for these dates."

  // Date issues and rechecks already speak in the body.
  const hint =
    streaming || dateIssue || recheck || room
      ? null
      : `No room fits ${size} ${size === 1 ? "guest" : "guests"}`

  const announcement = touched && totals ? `Total ${money(totals.total)}` : ""

  const reserved = decision?.action === "reserve" ? decision : null
  const split = totals ? paySplit(totals, currency, "now", locale) : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="hotel-booking"
        data-status={status}
        data-mode="select"
        aria-busy={busy}
        aria-label={hotel.name ? `Book ${hotel.name}` : "Hotel booking"}
        className={cn("@container", className)}
      >
        {header(hotel.city ?? hotel.address)}

        <AutoHeight>
          <div className="flex flex-col">
            {reserved ? (
              // The decision, read-only: what went to the booking flow.
              <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
                <p className={cn(genuiType.body, "font-medium")}>
                  {room?.name ?? reserved.roomId}
                  {rate && ` · ${rate.label}`}
                </p>
                <p className={genuiType.stat}>
                  <span className="sr-only">Total </span>
                  {formatMoney(
                    reserved.total.amount,
                    reserved.total.currency,
                    locale,
                  )}
                </p>
                <p className={genuiType.meta} suppressHydrationWarning>
                  {[
                    staySummary(reserved.stay, locale),
                    reserved.total.payAtHotel > 0 &&
                      reserved.total.payNow > 0 &&
                      `${formatMoney(reserved.total.payAtHotel, reserved.total.currency, locale)} at the hotel`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            ) : (
              <>
                {/* Stay controls: one row. */}
                {current ? (
                  <div className="flex flex-col">
                    {/* Dates are form fields: one per row, above the guest steppers. */}
                    {canEditDates && (
                      <FormFieldGroup className="border-t border-border px-3 py-3">
                        <FormField
                          htmlFor={`${uid}-check-in`}
                          label="Check-in"
                          pinned
                        >
                          <DatePicker
                            id={`${uid}-check-in`}
                            type="date"
                            className={formDateClass}
                            value={current.checkIn}
                            min={availability?.minDate}
                            max={
                              availability?.maxDate
                                ? (addDays(availability.maxDate, -1) ??
                                  undefined)
                                : undefined
                            }
                            disabled={locked || busy}
                            onValueChange={(v) => setCheckIn(v)}
                          />
                        </FormField>
                        <FormField
                          htmlFor={`${uid}-check-out`}
                          label="Check-out"
                          pinned
                        >
                          <DatePicker
                            id={`${uid}-check-out`}
                            type="date"
                            className={formDateClass}
                            value={current.checkOut}
                            min={
                              addDays(current.checkIn, 1) ??
                              availability?.minDate
                            }
                            max={availability?.maxDate}
                            disabled={locked || busy}
                            onValueChange={(v) =>
                              v && updateDraft({ checkOut: v })
                            }
                          />
                        </FormField>
                      </FormFieldGroup>
                    )}
                    <div
                      className={cn(
                        "grid grid-cols-2",
                        !canEditDates && "@xl:grid-cols-4",
                      )}
                    >
                      {!canEditDates && (
                        <p
                          className={cn(
                            genuiType.body,
                            "col-span-2 self-center border-t border-border px-3 py-3",
                          )}
                          suppressHydrationWarning
                        >
                          {shortRange(
                            current.checkIn,
                            current.checkOut,
                            locale,
                          )}
                          <span className="text-muted-foreground">
                            {` · ${nightsLabel(nightsBetween(current.checkIn, current.checkOut))}`}
                          </span>
                        </p>
                      )}
                      <div
                        className={cn(
                          "min-w-0 border-t border-border px-3 py-3",
                          !canEditDates && "@xl:border-l",
                        )}
                      >
                        <Stepper
                          label="Adults"
                          noun="an adult"
                          value={current.adults}
                          min={1}
                          max={Math.max(1, maxGuests - current.children)}
                          disabled={locked || busy}
                          onChange={(adults) => updateDraft({ adults })}
                        />
                      </div>
                      <div className="min-w-0 border-t border-l border-border px-3 py-3">
                        <Stepper
                          label="Children"
                          noun="a child"
                          value={current.children}
                          min={0}
                          max={Math.max(0, maxGuests - current.adults)}
                          disabled={locked || busy}
                          onChange={(children) => updateDraft({ children })}
                        />
                      </div>
                    </div>
                    {(dateIssue || recheck) && (
                      <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                        {dateIssue && (
                          <p
                            role="alert"
                            className={genuiType.body}
                            suppressHydrationWarning
                          >
                            {dateIssueText(dateIssue, locale)}
                          </p>
                        )}
                        {recheck && (
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className={genuiType.body}>{recheckText}</p>
                            <WhyDisabled
                              when={busy || locked}
                              reason="Sending…"
                            >
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={changeStay}
                                disabled={busy || locked}
                              >
                                Check availability
                              </Button>
                            </WhyDisabled>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  streaming && (
                    <div className="border-t border-border px-3 py-3">
                      <Skeleton className="h-10 w-full rounded-lg" />
                    </div>
                  )
                )}

                {/* Rooms */}
                <fieldset
                  disabled={locked || busy}
                  className="m-0 min-w-0 border-0 border-t border-border px-3 py-2"
                >
                  <legend className="sr-only">Room</legend>
                  <ul className="-mx-3 flex flex-col gap-1">
                    {readyRooms.map((r) => {
                      const fits = partyFits(r, party)
                      const soldOut = r.remaining === 0
                      const enabled = selectable(r)
                      const checked = r.id === room?.id
                      const nameId = `${uid}-${r.id}-name`
                      const factsId = `${uid}-${r.id}-facts`
                      const stateId = `${uid}-${r.id}-state`
                      const prices = r.rates
                        .map(pricingFor)
                        .flatMap((p) =>
                          p?.kind === "priced" ? [p.totals] : [],
                        )
                      const from =
                        prices.length > 0
                          ? Math.min(...prices.map((p) => p.total))
                          : null
                      const state = soldOut
                        ? "Sold out"
                        : !fits
                          ? "Too small"
                          : null
                      const facts = [
                        r.bed,
                        `Fits ${r.maxGuests}${roomCount > 1 ? " per room" : ""}`,
                        enabled &&
                          typeof r.remaining === "number" &&
                          r.remaining <= LOW_STOCK &&
                          `${r.remaining} left`,
                      ].filter(Boolean)
                      const extras = [
                        typeof r.sizeM2 === "number" ? `${r.sizeM2} m²` : null,
                        ...(r.amenities ?? []),
                      ].filter(Boolean)
                      return (
                        <motion.li
                          key={r.id}
                          data-slot="hotel-booking-room"
                          data-disabled={!enabled || undefined}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={genuiMotion.fade}
                        >
                          <label
                            className={cn(
                              "flex gap-3 rounded-lg px-3 py-2 transition-colors",
                              enabled &&
                                !locked &&
                                "cursor-pointer hover:bg-muted dark:hover:bg-white/5 has-disabled:cursor-default has-disabled:hover:bg-transparent",
                              !enabled && "cursor-not-allowed",
                              checked &&
                                "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                            )}
                          >
                            <input
                              type="radio"
                              name={`${uid}-room`}
                              value={r.id}
                              checked={checked}
                              disabled={!enabled}
                              aria-labelledby={nameId}
                              aria-describedby={
                                state ? `${factsId} ${stateId}` : factsId
                              }
                              onChange={() => {
                                setPickedRoom(r.id)
                                setTouched(true)
                              }}
                              className="peer sr-only"
                            />
                            <RadioMark
                              checked={checked}
                              className="peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-disabled:opacity-60"
                            />
                            <div
                              className={cn(
                                "flex min-w-0 flex-1 flex-col gap-0.5",
                                !enabled && "opacity-60",
                              )}
                            >
                              <div className="flex items-baseline justify-between gap-3">
                                <span id={nameId} className={genuiType.title}>
                                  {r.name}
                                </span>
                                {state ? (
                                  <span
                                    id={stateId}
                                    className={cn(genuiType.body, "shrink-0")}
                                  >
                                    {state}
                                  </span>
                                ) : checked ? null : from !== null ? (
                                  <span
                                    className={cn(
                                      genuiType.meta,
                                      "shrink-0 tabular-nums",
                                    )}
                                  >
                                    from{" "}
                                    <span className="text-[13px] font-semibold text-foreground">
                                      {money(from)}
                                    </span>
                                  </span>
                                ) : (
                                  streaming && (
                                    <Skeleton className="h-4 w-14 shrink-0" />
                                  )
                                )}
                              </div>
                              <span id={factsId} className={genuiType.meta}>
                                {facts.join(" · ")}
                                {extras.length > 0 && (
                                  <span className="sr-only">
                                    {`. ${extras.join(", ")}`}
                                  </span>
                                )}
                              </span>
                            </div>
                          </label>

                          {checked && r.rates.length > 0 && (
                            <fieldset className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-2 border-0 px-3 pt-1 pb-3 pl-12">
                              <legend className="sr-only">
                                {`Rates for ${r.name}`}
                              </legend>
                              {r.rates.map((rt) => {
                                const p = pricingFor(rt)
                                const t = p?.kind === "priced" ? p.totals : null
                                const on = rt.id === rate?.id
                                const rtTerms = shortTerms(rt)
                                const facts = [
                                  // Skip "Non-refundable" when it's the label too.
                                  rtTerms?.toLowerCase() ===
                                  rt.label.toLowerCase()
                                    ? null
                                    : rtTerms,
                                  rt.breakfast === true
                                    ? "Breakfast included"
                                    : null,
                                  rt.payment === "at-hotel"
                                    ? "Pay at the hotel"
                                    : null,
                                ].filter(Boolean)
                                return (
                                  <label
                                    key={rt.id}
                                    className={cn(
                                      "flex gap-3 rounded-[10px] border border-border px-3 py-2 transition-colors",
                                      !locked &&
                                        "cursor-pointer hover:bg-muted dark:hover:bg-white/5 has-disabled:cursor-default has-disabled:hover:bg-transparent",
                                      on &&
                                        "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                                    )}
                                  >
                                    <input
                                      type="radio"
                                      name={`${uid}-${r.id}-rate`}
                                      value={rt.id}
                                      checked={on}
                                      onChange={() => {
                                        setPickedRates((prev) => ({
                                          ...prev,
                                          [r.id]: rt.id,
                                        }))
                                        setTouched(true)
                                      }}
                                      className="peer sr-only"
                                    />
                                    <RadioMark
                                      checked={on}
                                      className="-mt-0.5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
                                    />
                                    <div className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                                      <div className="flex min-w-0 flex-col gap-0.5">
                                        <span
                                          className={cn(
                                            genuiType.body,
                                            "font-medium",
                                          )}
                                        >
                                          {rt.label}
                                        </span>
                                        {facts.length > 0 && (
                                          <span
                                            className={genuiType.meta}
                                            suppressHydrationWarning
                                          >
                                            {facts.join(" · ")}
                                          </span>
                                        )}
                                      </div>
                                      {t ? (
                                        <span
                                          className={cn(
                                            genuiType.body,
                                            "shrink-0 font-semibold tabular-nums",
                                          )}
                                        >
                                          {money(t.total)}
                                          <span className="sr-only">
                                            {" "}
                                            total
                                          </span>
                                        </span>
                                      ) : p?.kind === "recheck" ? (
                                        <span
                                          className={cn(
                                            genuiType.meta,
                                            "shrink-0",
                                          )}
                                        >
                                          Not priced
                                        </span>
                                      ) : (
                                        <Skeleton className="h-4 w-20 shrink-0" />
                                      )}
                                    </div>
                                  </label>
                                )
                              })}
                            </fieldset>
                          )}
                        </motion.li>
                      )
                    })}
                    {streaming && <RoomSkeleton />}
                  </ul>
                </fieldset>
              </>
            )}

            {/* The total for the chosen rate, with one disclosure for the rest. */}
            {totals && rate?.payment && !reserved && status !== "dismissed" ? (
              <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
                <p className={genuiType.stat}>
                  <span className="sr-only">Total </span>
                  <AnimatedMoney amount={totals.total} currency={currency} />
                </p>
                <DisclosureButton
                  open={detailsOpen}
                  controls={detailsId}
                  onToggle={() => setDetailsOpen((o) => !o)}
                >
                  {`Total for ${nightsLabel(totals.nights.length)}${split ? ` · ${split}` : ""}`}
                  <span className="sr-only">, price details</span>
                </DisclosureButton>
                <div
                  id={detailsId}
                  hidden={!detailsOpen}
                  className="flex flex-col gap-2 pt-1"
                >
                  <PriceRows
                    totals={totals}
                    currency={currency}
                    payment={rate.payment}
                  />
                  {terms(rate) && (
                    <p className={genuiType.meta} suppressHydrationWarning>
                      {terms(rate)}
                    </p>
                  )}
                  <SourceNote prefix="Prices from" source={source} />
                </div>
              </div>
            ) : (
              streaming &&
              readyRooms.length > 0 && (
                <div
                  aria-hidden
                  className="flex flex-col gap-1.5 border-t border-border px-3 py-3"
                >
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
              )
            )}
          </div>
        </AutoHeight>

        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>

        <SurfaceFooter aria-live="polite">
          {streaming ? (
            <ShimmeringText
              text="Loading rooms and rates…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px] leading-4"
            />
          ) : status === "reserved" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4" />
              Sent to booking. Confirm there to book.
            </p>
          ) : status === "change-requested" ? (
            <p
              className={cn(genuiType.body, "flex items-start gap-1.5")}
              suppressHydrationWarning
            >
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Asked for prices
                {decision?.action === "change-stay" &&
                  staySummary(decision.stay, locale) && (
                    <span className="text-muted-foreground">
                      : {staySummary(decision.stay, locale)}
                    </span>
                  )}
              </span>
            </p>
          ) : status === "dismissed" ? (
            <p className={genuiType.meta}>Cancelled. Nothing was booked.</p>
          ) : (
            <>
              {hint && <span className={genuiType.meta}>{hint}</span>}
              <div className="ml-auto flex gap-2">
                <WhyDisabled when={busy} reason="Sending…">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={dismiss}
                    disabled={busy}
                  >
                    Cancel
                  </Button>
                </WhyDisabled>
                <WhyDisabled
                  when={!canReserve}
                  reason="Pick a room and rate first"
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

// The Renderer hands this component onDraft.
HotelBooking.genuiDraft = true
