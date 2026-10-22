"use client"

import * as React from "react"
import {
  CalendarPlusIcon,
  CarIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  ExternalLinkIcon,
  FlagIcon,
  MapPinIcon,
  MinusIcon,
  PlusIcon,
  UserIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/genui/date-picker"
import {
  FormField,
  FormFieldGroup,
  formDateClass,
  formInputClass,
} from "@/components/genui/form-field"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { CheckMark, RadioMark } from "@/components/genui/genui-motion"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import {
  activeFilterCount,
  bagsText,
  cancellationText,
  categoriesOf,
  countLabel,
  currencyDigits,
  daysLabel,
  directionsUrl,
  type Extra,
  filterOffers,
  formatDeadline,
  formatLocalDateTime,
  formatMoney,
  formatMoneyCompact,
  freeCancellationRelative,
  fuelPolicyText,
  hasFreeCancellation,
  type InsuranceOption,
  insuranceCost,
  isOneWay,
  maxQuantity,
  mileageText,
  modelText,
  NO_FILTERS,
  type OfferFilters,
  type OfferSort,
  pickupTypeText,
  type RentalPrice,
  type RentalTotals,
  rentalDays,
  rentalTotals,
  resolveNow,
  safeTimeZone,
  seatOptions,
  sortOffers,
  toInstant,
  toLocalInputValue,
  toOffsetISO,
  type YoungDriverFee,
} from "./car-rental-utils"
import type {
  CarRentalDraft,
  CarRentalExtra,
  CarRentalFilterPreset,
  CarRentalInput,
  CarRentalInsurance,
  CarRentalOffer,
  CarRentalReservation,
  CarRentalResult,
  CarRentalTripPoint,
} from "./car-rental.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { ScrollFade } from "@/components/genui/scroll-fade"

export type CarRentalStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "reserved"
  | "change-requested"
  | "dismissed"
  | "cancel-requested"
  | "done"

type PartialOffer = Partial<
  Omit<
    CarRentalOffer,
    | "bags"
    | "mileage"
    | "rating"
    | "price"
    | "deposit"
    | "insurance"
    | "extras"
    | "youngDriverFee"
  >
> & {
  bags?: Partial<CarRentalOffer["bags"]>
  mileage?: Partial<CarRentalOffer["mileage"]>
  rating?: Partial<NonNullable<CarRentalOffer["rating"]>>
  price?: Partial<CarRentalOffer["price"]>
  deposit?: Partial<NonNullable<CarRentalOffer["deposit"]>>
  insurance?: Partial<CarRentalInsurance>[]
  extras?: Partial<CarRentalExtra>[]
  youngDriverFee?: Partial<NonNullable<CarRentalOffer["youngDriverFee"]>>
}
type ReadyOffer = PartialOffer & {
  id: string
  category: string
  model: string
}

export type CarRentalProps = Partial<
  Omit<
    CarRentalInput,
    | "pickup"
    | "dropoff"
    | "driver"
    | "offers"
    | "defaultFilters"
    | "confirmation"
    | "source"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  pickup?: Partial<CarRentalTripPoint>
  dropoff?: Partial<CarRentalTripPoint>
  driver?: { age?: number }
  offers?: PartialOffer[]
  defaultFilters?: CarRentalFilterPreset
  confirmation?: Partial<Omit<CarRentalReservation, "extras">> & {
    extras?: { id?: string; quantity?: number }[]
  }
  source?: { label?: string; url?: string }
  /**
   * The moment cancellation deadlines are compared with ("Free cancellation
   * for 2 more days"). Defaults to the viewer's clock, read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's decision itself.
   */
  status?: CarRentalStatus
  /**
   * Select mode: called once with reserve, change-trip or dismiss. Reserve is
   * a handoff: open your booking flow. Confirmation mode: called once per
   * action; cancel-rental only after the user confirms it.
   */
  onResult?: (result: CarRentalResult) => void
  /**
   * Called when the user's selection changes before they confirm, with the
   * result Reserve (or the trip editor's Update) would send now. Not a
   * decision: keep the latest and add it to the user's next typed message
   * (`describeUIState`).
   */
  onDraft?: (draft: CarRentalDraft) => void
  /**
   * Results from history (the tool call's stored output, or several). Renders
   * the finished state and never calls onResult.
   */
  result?: CarRentalResult | CarRentalResult[]
  className?: string
}

type SelectDecision = Extract<
  CarRentalResult,
  { action: "reserve" | "change-trip" | "dismiss" }
>
type ConfirmationAction = "manage" | "add-to-calendar" | "cancel-rental"

type TripDraft = {
  pickupLocation: string
  pickupAt: string
  sameReturn: boolean
  dropoffLocation: string
  dropoffAt: string
  driverAge: string
}

const SELECT_ACTIONS = new Set(["reserve", "change-trip", "dismiss"])

const BOOKING_STATE: Record<
  CarRentalReservation["bookingState"],
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const CONFIRMATION_DONE: Record<ConfirmationAction, string> = {
  manage: "Opening rental management",
  "add-to-calendar": "Added to calendar",
  "cancel-rental": "Cancellation requested",
}

// Values name themselves ("Any transmission", "5+ seats"), so the filter row
// needs no visible labels; each trigger still has an accessible name.
const TRANSMISSION_ITEMS = [
  { value: "any", label: "Any transmission" },
  { value: "automatic", label: "Automatic" },
  { value: "manual", label: "Manual" },
]

const SORT_LABEL: Record<OfferSort, string> = {
  price: "Lowest price",
  rating: "Best rated",
}

const FUEL_LABEL: Record<CarRentalOffer["fuel"], string> = {
  petrol: "Petrol",
  diesel: "Diesel",
  hybrid: "Hybrid",
  electric: "Electric",
}

function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
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

function readyPoint(
  p: Partial<CarRentalTripPoint> | undefined,
): CarRentalTripPoint | null {
  return typeof p?.location === "string" &&
    typeof p.at === "string" &&
    typeof p.timeZone === "string"
    ? { location: p.location, at: p.at, timeZone: p.timeZone }
    : null
}

/** Only the cover options that have fully streamed in. */
function readyInsurance(offer: PartialOffer | undefined): InsuranceOption[] {
  return (offer?.insurance ?? []).filter(
    (i): i is InsuranceOption =>
      typeof i.id === "string" &&
      typeof i.label === "string" &&
      typeof i.included === "boolean" &&
      typeof i.excess === "number",
  )
}

function readyExtras(offer: PartialOffer | undefined): Extra[] {
  return (offer?.extras ?? []).filter(
    (e): e is Extra => typeof e.id === "string" && typeof e.label === "string",
  )
}

function readyFee(offer: PartialOffer | undefined): YoungDriverFee | undefined {
  const f = offer?.youngDriverFee
  return typeof f?.underAge === "number" && typeof f.perDay === "number"
    ? { underAge: f.underAge, perDay: f.perDay, payAtDesk: f.payAtDesk }
    : undefined
}

function readyPrice(offer: PartialOffer | undefined): RentalPrice | null {
  const p = offer?.price
  return typeof p?.total === "number"
    ? {
        total: p.total,
        perDay: p.perDay,
        payNow: p.payNow,
        payAtDesk: p.payAtDesk,
      }
    : null
}

function presetFilters(preset?: CarRentalFilterPreset): Partial<OfferFilters> {
  const out: Partial<OfferFilters> = {}
  if (!preset) return out
  if (preset.transmission) out.transmission = preset.transmission
  if (typeof preset.minSeats === "number") out.minSeats = preset.minSeats
  if (preset.categories) out.categories = preset.categories
  if (typeof preset.unlimitedMileage === "boolean") {
    out.unlimitedMileage = preset.unlimitedMileage
  }
  if (typeof preset.freeCancellation === "boolean") {
    out.freeCancellation = preset.freeCancellation
  }
  return out
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

function Rating({
  rating,
}: {
  rating: Partial<NonNullable<CarRentalOffer["rating"]>>
}) {
  const locale = useGenUILocale()
  if (typeof rating.score !== "number") return null
  const score = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 1,
  }).format(rating.score)
  const outOf = typeof rating.outOf === "number" ? rating.outOf : null
  const count =
    typeof rating.count === "number"
      ? `${new Intl.NumberFormat(locale).format(rating.count)} ${rating.count === 1 ? "review" : "reviews"}`
      : null
  return (
    <>
      <span aria-hidden>{outOf ? `${score}/${outOf}` : score}</span>
      <span className="sr-only">
        {`rated ${score}${outOf ? ` out of ${outOf}` : ""}${count ? `, from ${count}` : ""}`}
      </span>
    </>
  )
}

/**
 * The specs that drive the choice: seats, bags and transmission, plus the EV
 * range and a mileage cap when they apply. The rest sits in the details.
 */
function keySpecs(offer: PartialOffer, locale: string): string {
  const km = (n: number) => new Intl.NumberFormat(locale).format(n)
  return [
    typeof offer.seats === "number" ? `${offer.seats} seats` : null,
    offer.bags ? bagsText(offer.bags) : null,
    offer.transmission === "automatic"
      ? "Automatic"
      : offer.transmission === "manual"
        ? "Manual"
        : null,
    offer.fuel === "electric"
      ? typeof offer.rangeKm === "number"
        ? `Electric, ${km(offer.rangeKm)} km range`
        : "Electric"
      : null,
    offer.mileage?.unlimited === false
      ? typeof offer.mileage.includedKm === "number"
        ? `${km(offer.mileage.includedKm)} km limit`
        : "Limited km"
      : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Fuel (electric is already in the key specs), A/C and doors. */
function otherSpecs(offer: PartialOffer): string {
  return [
    offer.fuel && offer.fuel !== "electric" ? FUEL_LABEL[offer.fuel] : null,
    offer.airCon === true ? "A/C" : null,
    typeof offer.doors === "number" ? `${offer.doors} doors` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** The one disclosure per card: price details, policies and the source. */
function DetailsToggle({
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
    <Button
      size="sm"
      variant="secondary"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="-mr-2 shrink-0 text-muted-foreground"
    >
      {children}
      <ChevronDownIcon
        aria-hidden
        className={cn(
          "transition-transform motion-reduce:transition-none",
          open && "rotate-180",
        )}
      />
    </Button>
  )
}

function QuantityStepper({
  label,
  value,
  max,
  disabled,
  onChange,
}: {
  label: string
  value: number
  max: number
  disabled: boolean
  onChange: (value: number) => void
}) {
  return (
    <fieldset
      aria-label={`${label} quantity`}
      className="m-0 flex shrink-0 items-center gap-1.5 border-0 p-0"
    >
      <IconTip label={`Remove ${label}`}>
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={`Remove ${label}`}
          disabled={disabled || value <= 0}
          onClick={() => onChange(value - 1)}
        >
          <MinusIcon />
        </Button>
      </IconTip>
      <span
        aria-live="polite"
        className="min-w-6 text-center text-[13px] tabular-nums"
      >
        <span className="sr-only">{value}</span>
        <SlidingNumber aria-hidden number={value} initiallyStable />
      </span>
      <IconTip label={`Add ${label}`}>
        <Button
          size="icon-sm"
          variant="secondary"
          aria-label={`Add ${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
        >
          <PlusIcon />
        </Button>
      </IconTip>
    </fieldset>
  )
}

function SummaryRow({
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

/**
 * The line items behind the total, inside the details disclosure. The total
 * is shown above it, so it isn't repeated here. With `nowLabel`, a split
 * between paid now and due at the desk is listed too.
 */
function PriceBreakdown({
  totals,
  currency,
  driverAge,
  nowLabel,
}: {
  totals: RentalTotals
  currency?: string
  driverAge?: number
  nowLabel?: string
}) {
  const locale = useGenUILocale()
  const money = (n: number) => formatMoney(n, currency, locale)
  const split = !!nowLabel && totals.payNow > 0 && totals.payAtDesk > 0
  // Name the desk items only when something is also paid now.
  const label = (text: string, atDesk: boolean) =>
    atDesk && totals.payNow > 0 ? `Due at desk: ${text}` : text
  const days = daysLabel(totals.days)

  return (
    <dl className={cn("flex flex-col gap-1.5", genuiType.body)}>
      <SummaryRow
        label={
          totals.base.perDay !== null
            ? `Car rental, ${days} (${money(totals.base.perDay)} a day)`
            : `Car rental, ${days}`
        }
      >
        {money(totals.base.amount)}
      </SummaryRow>
      {totals.insurance && (
        <SummaryRow
          label={label(
            `${totals.insurance.label}, ${days}`,
            totals.insurance.atDesk,
          )}
        >
          {money(totals.insurance.amount)}
        </SummaryRow>
      )}
      {totals.extras.map((e) => (
        <SummaryRow
          key={e.id}
          label={label(
            e.quantity > 1 ? `${e.label} × ${e.quantity}` : e.label,
            e.atDesk,
          )}
        >
          {money(e.amount)}
        </SummaryRow>
      ))}
      {totals.youngDriver && (
        <SummaryRow
          label={label(
            typeof driverAge === "number"
              ? `Young driver fee (age ${driverAge}), ${days}`
              : `Young driver fee, ${days}`,
            totals.youngDriver.atDesk,
          )}
        >
          {money(totals.youngDriver.amount)}
        </SummaryRow>
      )}
      {split && (
        <>
          <SummaryRow label={nowLabel}>{money(totals.payNow)}</SummaryRow>
          <SummaryRow label="Due at desk">{money(totals.payAtDesk)}</SummaryRow>
        </>
      )}
    </dl>
  )
}

/** "€46.20 now, €184.80 at the desk", "Paid at the desk", or null. */
function splitText(
  payNow: number,
  payAtDesk: number,
  currency: string | undefined,
  nowWord: string,
  locale: string,
): string | null {
  if (payAtDesk <= 0) return null
  if (payNow <= 0) return "Paid at the desk"
  return `${formatMoney(payNow, currency, locale)} ${nowWord}, ${formatMoney(payAtDesk, currency, locale)} at the desk`
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
          className="inline-flex min-h-6 items-center gap-1 rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {source.label}
          <ExternalLinkIcon aria-hidden className="size-3" />
          <span className="sr-only">(opens in a new tab)</span>
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
      className="inline-flex min-h-6 w-fit items-center gap-1 rounded-sm text-[13px] leading-4 text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {children}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

function OfferSkeleton() {
  return (
    <li aria-hidden className="flex gap-3 px-3 py-3">
      <Skeleton className="mt-0.5 size-4 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className="h-4 w-16" />
    </li>
  )
}

/** "€300 held on a credit card at pick-up." plus the card rule. */
function depositText(
  deposit: PartialOffer["deposit"],
  currency: string | undefined,
  locale: string,
): { text: string; note: string | null } | null {
  if (typeof deposit?.amount !== "number") return null
  const amount = formatMoneyCompact(deposit.amount, currency, locale)
  if (deposit.card === "credit-only") {
    return {
      text: `${amount} held on a credit card at pick-up`,
      note: "Credit card only. Debit cards aren't accepted.",
    }
  }
  if (deposit.card === "credit-or-debit") {
    return {
      text: `${amount} held on a credit or debit card at pick-up`,
      note: null,
    }
  }
  return { text: `${amount} deposit held at pick-up`, note: null }
}

/** "Unlimited km · Fuel: full to full · Shuttle from Terminal 1, every 15 min". */
function policyLine(
  offer: PartialOffer,
  currency: string | undefined,
  locale: string,
) {
  return [
    offer.mileage ? mileageText(offer.mileage, currency, locale) : null,
    fuelPolicyText(offer.fuelPolicy),
    offer.pickupNote ?? pickupTypeText(offer.pickupType),
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * Sends the selection to the host each time it changes (D70). A component of
 * its own so the effect can live below the confirmation-mode return.
 */
function ReportDraft({
  draft,
  onDraft,
}: {
  draft: CarRentalDraft | null
  onDraft: (draft: CarRentalDraft) => void
}) {
  const key = draft ? JSON.stringify(draft) : null
  const onDraftRef = React.useRef(onDraft)
  onDraftRef.current = onDraft
  React.useEffect(() => {
    if (key) onDraftRef.current(JSON.parse(key))
  }, [key])
  return null
}

export function CarRental({
  mode,
  pickup,
  dropoff,
  driver,
  offers = [],
  currency,
  filters: filtersProp,
  defaultFilters,
  confirmation,
  source,
  now: nowProp,
  status: statusProp,
  onResult,
  onDraft,
  result,
  className,
}: CarRentalProps) {
  const locale = useGenUILocale()
  const restoredResults: CarRentalResult[] =
    result === undefined ? [] : Array.isArray(result) ? result : [result]

  const [decision, setDecision] = React.useState<SelectDecision | null>(
    () =>
      (restoredResults.find((r) => SELECT_ACTIONS.has(r.action)) as
        | SelectDecision
        | undefined) ?? null,
  )
  const [pickedOffer, setPickedOffer] = React.useState<string | undefined>(
    () => (decision?.action === "reserve" ? decision.offerId : undefined),
  )
  const [pickedCover, setPickedCover] = React.useState<Record<string, string>>(
    () =>
      decision?.action === "reserve"
        ? { [decision.offerId]: decision.insuranceId }
        : {},
  )
  const [pickedExtras, setPickedExtras] = React.useState<
    Record<string, Record<string, number>>
  >(() =>
    decision?.action === "reserve"
      ? {
          [decision.offerId]: Object.fromEntries(
            decision.extras.map((e) => [e.id, e.quantity]),
          ),
        }
      : {},
  )
  const [filterEdits, setFilterEdits] = React.useState<Partial<OfferFilters>>(
    {},
  )
  const [sortEdit, setSortEdit] = React.useState<OfferSort | null>(null)
  const [tripDraft, setTripDraft] = React.useState<TripDraft | null>(null)
  const [done, setDone] = React.useState<Set<ConfirmationAction>>(
    () =>
      new Set(
        restoredResults
          .map((r) => r.action)
          .filter((a): a is ConfirmationAction => !SELECT_ACTIONS.has(a)),
      ),
  )
  const [confirmingCancel, setConfirmingCancel] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)
  // null: open the extra filters only when one of them is preset.
  const [moreFilters, setMoreFilters] = React.useState<boolean | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [touched, setTouched] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelButton = React.useRef<HTMLButtonElement>(null)
  const refocusCancel = React.useRef(false)
  const changeTripButton = React.useRef<HTMLButtonElement>(null)
  const refocusChangeTrip = React.useRef(false)
  const uid = React.useId()

  const local: CarRentalStatus | null = decision
    ? decision.action === "reserve"
      ? "reserved"
      : decision.action === "change-trip"
        ? "change-requested"
        : "dismissed"
    : done.has("cancel-rental")
      ? "cancel-requested"
      : done.size > 0
        ? "done"
        : null
  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: CarRentalStatus =
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
  // Return focus to "Cancel rental" when the confirm step closes.
  React.useEffect(() => {
    if (!confirmingCancel && refocusCancel.current) {
      refocusCancel.current = false
      cancelButton.current?.focus()
    }
  }, [confirmingCancel])
  // Return focus to "Change trip" when the editor closes without sending.
  React.useEffect(() => {
    if (!tripDraft && refocusChangeTrip.current) {
      refocusChangeTrip.current = false
      changeTripButton.current?.focus()
    }
  }, [tripDraft])

  const digits = currencyDigits(currency)
  const money = (n: number) => formatMoney(n, currency, locale)

  const from = readyPoint(pickup)
  const to = readyPoint(dropoff)
  const pickupZone = safeTimeZone(pickup?.timeZone)
  const dropoffZone = safeTimeZone(dropoff?.timeZone)
  const pickupT = toInstant(pickup?.at, pickupZone)
  const dropoffT = toInstant(dropoff?.at, dropoffZone)
  const days = from && to ? rentalDays(from, to) : null
  const oneWay = isOneWay(pickup?.location, dropoff?.location)
  const driverAge = driver?.age

  const readyOffers: ReadyOffer[] = offers.filter(
    (o): o is ReadyOffer =>
      typeof o.id === "string" &&
      typeof o.category === "string" &&
      typeof o.model === "string",
  )

  const totalsFor = (
    offer: ReadyOffer,
    cover: InsuranceOption | undefined,
    extras: { extra: Extra; quantity: number }[],
  ): RentalTotals | null => {
    if (streaming) return null
    const price = readyPrice(offer)
    if (!price || !cover) return null
    return rentalTotals({
      price,
      days,
      insurance: cover,
      extras,
      youngDriverFee: readyFee(offer),
      driverAge,
      digits,
    })
  }

  // -------------------------------------------------------------------------
  // Header

  const tripTimes =
    pickupT !== null && dropoffT !== null
      ? `${formatLocalDateTime(pickupT, pickupZone, locale)} – ${formatLocalDateTime(dropoffT, dropoffZone, locale)}`
      : null

  const openTripEditor = () => {
    if (busy || locked) return
    setTripDraft({
      pickupLocation: pickup?.location ?? "",
      pickupAt: pickupT !== null ? toLocalInputValue(pickupT, pickupZone) : "",
      sameReturn: !oneWay,
      dropoffLocation: dropoff?.location ?? "",
      dropoffAt:
        dropoffT !== null ? toLocalInputValue(dropoffT, dropoffZone) : "",
      driverAge: typeof driverAge === "number" ? String(driverAge) : "",
    })
  }
  const closeTripEditor = () => {
    refocusChangeTrip.current = true
    setTripDraft(null)
  }

  const canChangeTrip =
    !isConfirmation && !!from && !!to && !locked && !busy && !decision

  // The route, one meta line with the dates (select mode), and an aside: the
  // "Change trip" button or the booking state.
  const renderHeader = (aside: React.ReactNode, showTimes: boolean) => (
    <SurfaceHeader className="pb-3">
      <div className="flex items-start justify-between gap-3">
        <SurfaceTitle className="min-w-0">
          {pickup?.location && dropoff?.location && oneWay ? (
            <>
              {pickup.location} <span aria-hidden>→</span>
              <span className="sr-only">to</span> {dropoff.location}
            </>
          ) : (
            pickup?.location
          )}
        </SurfaceTitle>
        {aside}
      </div>
      {showTimes &&
        (tripTimes ? (
          <p className={genuiType.meta} suppressHydrationWarning>
            {tripTimes}
            <span className="sr-only"> (local times)</span>
            {days !== null && ` · ${daysLabel(days)}`}
            {oneWay && " · One-way"}
          </p>
        ) : (
          streaming && <Skeleton className="mt-1 h-4 w-72 max-w-full" />
        ))}
    </SurfaceHeader>
  )

  // -------------------------------------------------------------------------
  // Confirmation mode

  if (isConfirmation) {
    const booked = readyOffers.find((o) => o.id === confirmation?.offerId)
    const covers = readyInsurance(booked)
    const cover =
      covers.find((c) => c.id === confirmation?.insuranceId) ?? covers[0]
    const extrasList = readyExtras(booked)
    const chosenExtras = (confirmation?.extras ?? []).flatMap((e) => {
      const extra = extrasList.find((x) => x.id === e.id)
      return extra && typeof e.quantity === "number" && e.quantity > 0
        ? [{ extra, quantity: e.quantity }]
        : []
    })
    const totals = booked ? totalsFor(booked, cover, chosenExtras) : null
    const bookingState = confirmation?.bookingState
    const cancelled = bookingState === "cancelled"
    const freeNow = booked ? hasFreeCancellation(booked, now) : false
    const relative =
      booked?.freeCancelUntil && !cancelled
        ? freeCancellationRelative(booked.freeCancelUntil, now)
        : null
    const terms = booked
      ? cancellationText(booked.freeCancelUntil, pickup?.timeZone, now, locale)
      : null
    const freeUntil = formatDeadline(booked?.freeCancelUntil, pickupZone, locale)
    const confirmText = !booked?.freeCancelUntil
      ? "Cancel this rental? Check the supplier's cancellation terms."
      : !freeNow
        ? "Cancel this rental? Free cancellation has ended."
        : freeUntil
          ? `Cancel this rental? Free until ${freeUntil}.`
          : "Cancel this rental? It's free to cancel."
    const deposit = depositText(booked?.deposit, currency, locale)
    const directions = pickup?.location ? directionsUrl(pickup.location) : null
    const pickupHow = booked
      ? (booked.pickupNote ?? pickupTypeText(booked.pickupType))
      : null

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
    const keepRental = () => {
      refocusCancel.current = true
      setConfirmingCancel(false)
    }

    const calendarDone = done.has("add-to-calendar")
    const manageDone = done.has("manage")
    const actionsOff = busy || locked
    const hasDetails = !!totals || !!cover || !!deposit || !!source?.label
    const showFooter =
      !cancelled || streaming || status === "submitting" || done.size > 0

    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="car-rental"
          data-status={status}
          data-mode="confirmation"
          aria-busy={busy}
          aria-label={
            booked?.supplier
              ? `Car rental with ${booked.supplier}`
              : "Car rental"
          }
          className={className}
        >
          {renderHeader(
            bookingState && (
              <Badge
                variant={BOOKING_STATE[bookingState].variant}
                className="shrink-0"
              >
                {BOOKING_STATE[bookingState].label}
              </Badge>
            ),
            false,
          )}

          <AutoHeight>
            <div className="flex flex-col">
              {/* The number to give at the desk: the focal point. */}
              <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
                <span className={genuiType.label}>Confirmation number</span>
                {confirmation?.number ? (
                  <span className="flex items-center gap-1">
                    <span className={cn(genuiType.stat, "break-all")}>
                      {confirmation.number}
                    </span>
                    <IconTip
                      label={`Copy confirmation number ${confirmation.number}`}
                    >
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Copy confirmation number ${confirmation.number}`}
                        onClick={copy}
                      >
                        {copied ? <CheckIcon /> : <CopyIcon />}
                      </Button>
                    </IconTip>
                  </span>
                ) : (
                  <Skeleton className="h-8 w-48" />
                )}
              </div>

              <dl className="grid gap-x-10 gap-y-4 border-t border-border px-3 py-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <CarIcon aria-hidden className="size-3.5 shrink-0" />
                    Car
                  </dt>
                  <dd className={cn("flex flex-col gap-0.5", genuiType.body)}>
                    {booked ? (
                      <>
                        <span>
                          <span className="font-medium">{booked.category}</span>
                          {` · ${modelText(booked.model, booked.orSimilar)}`}
                        </span>
                        {booked.supplier && (
                          <span className={genuiType.meta}>
                            {booked.supplier}
                          </span>
                        )}
                      </>
                    ) : (
                      <Skeleton className="h-4 w-40" />
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <UserIcon aria-hidden className="size-3.5 shrink-0" />
                    Driver
                  </dt>
                  <dd className={genuiType.body}>
                    {confirmation?.driverName ? (
                      confirmation.driverName
                    ) : (
                      <Skeleton className="h-4 w-28" />
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <MapPinIcon aria-hidden className="size-3.5 shrink-0" />
                    Pick-up
                  </dt>
                  <dd className={cn("flex flex-col gap-0.5", genuiType.body)}>
                    {pickupT !== null ? (
                      <span suppressHydrationWarning>
                        {formatLocalDateTime(pickupT, pickupZone, locale)}
                        <span className="sr-only"> local time</span>
                      </span>
                    ) : (
                      <Skeleton className="h-4 w-40" />
                    )}
                    {pickupHow && (
                      <span className={genuiType.meta}>{pickupHow}</span>
                    )}
                    {directions && (
                      <ExternalLink href={directions}>Directions</ExternalLink>
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-1">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <FlagIcon aria-hidden className="size-3.5 shrink-0" />
                    Drop-off
                  </dt>
                  <dd className={genuiType.body}>
                    {dropoffT !== null ? (
                      <span suppressHydrationWarning>
                        {formatLocalDateTime(dropoffT, dropoffZone, locale)}
                        <span className="sr-only"> local time</span>
                      </span>
                    ) : (
                      <Skeleton className="h-4 w-40" />
                    )}
                  </dd>
                </div>
              </dl>

              {totals || terms || hasDetails ? (
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {totals && (
                        <p
                          className={cn(
                            genuiType.body,
                            "font-semibold tabular-nums",
                          )}
                        >
                          <span className="sr-only">Total: </span>
                          {money(totals.total)}
                        </p>
                      )}
                      {terms && !cancelled && (
                        <p className={genuiType.meta} suppressHydrationWarning>
                          {terms}
                        </p>
                      )}
                    </div>
                    {hasDetails && (
                      <DetailsToggle
                        open={detailsOpen}
                        controls={`${uid}-details`}
                        onToggle={() => setDetailsOpen((o) => !o)}
                      >
                        Details
                      </DetailsToggle>
                    )}
                  </div>
                  <div
                    id={`${uid}-details`}
                    hidden={!detailsOpen}
                    className={cn(
                      "flex flex-col gap-3",
                      !detailsOpen && "hidden",
                    )}
                  >
                    {totals && (
                      <PriceBreakdown
                        totals={totals}
                        currency={currency}
                        driverAge={driverAge}
                        nowLabel={
                          bookingState === "pending" ? "To be charged" : "Paid"
                        }
                      />
                    )}
                    <ul className={cn("flex flex-col gap-1", genuiType.body)}>
                      {cover && (
                        <li>
                          {`${cover.label} cover, ${formatMoneyCompact(cover.excess, currency, locale)} excess`}
                        </li>
                      )}
                      {deposit && (
                        <li>
                          {`Deposit: ${deposit.text}.`}
                          {deposit.note && (
                            <span className="font-medium"> {deposit.note}</span>
                          )}
                        </li>
                      )}
                      {relative && relative !== terms && (
                        <li suppressHydrationWarning>{relative}</li>
                      )}
                    </ul>
                    <SourceNote prefix="Booked via" source={source} />
                  </div>
                </div>
              ) : (
                streaming && (
                  <div
                    aria-hidden
                    className="flex flex-col gap-2 border-t border-border px-3 py-3"
                  >
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                )
              )}
            </div>
          </AutoHeight>

          {showFooter && (
            <SurfaceFooter className="flex-col items-stretch gap-3">
              <div
                aria-live="polite"
                className={cn(
                  "flex flex-col gap-1",
                  done.size === 0 && "sr-only",
                )}
              >
                {copied && (
                  <p className="sr-only">Confirmation number copied</p>
                )}
                {[...done].map((a) => (
                  <p key={a} className="flex items-center gap-1.5 text-[13px]">
                    <CheckIcon aria-hidden className="size-4 shrink-0" />
                    {CONFIRMATION_DONE[a]}
                  </p>
                ))}
              </div>

              {confirmingCancel && !locked ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="text-[13px]" suppressHydrationWarning>
                    {confirmText}
                  </p>
                  <div className="flex gap-2 sm:shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      autoFocus
                      onClick={keepRental}
                      className="flex-1 sm:flex-none"
                    >
                      Keep rental
                    </Button>
                    <WhyDisabled className="flex flex-1 sm:flex-none" when={busy} reason="Cancelling…">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => {
                          setConfirmingCancel(false)
                          fire("cancel-rental")
                        }}
                        className="flex-1 sm:flex-none"
                      >
                        Cancel rental
                      </Button>
                    </WhyDisabled>
                  </div>
                </div>
              ) : (
                (streaming || status === "submitting" || !cancelled) && (
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      {streaming ? (
                        <ShimmeringText
                          text="Loading rental…"
                          color="var(--muted-foreground)"
                          shimmeringColor="var(--foreground)"
                          className="text-[13px] leading-4"
                        />
                      ) : (
                        status === "submitting" && (
                          <p className={genuiType.meta}>Sending…</p>
                        )
                      )}
                    </div>
                    {!cancelled && (
                      // Primary, one secondary, and the calendar as a labelled icon.
                      <div className="flex gap-2 sm:shrink-0 sm:justify-end">
                        <WhyDisabled
                          when={actionsOff || calendarDone}
                          reason={
                            calendarDone
                              ? "Already added"
                              : "Not available right now"
                          }
                        >
                          <IconTip
                            label={
                              calendarDone
                                ? "Add to calendar (done)"
                                : "Add to calendar"
                            }
                          >
                            <Button
                              size="icon-sm"
                              variant="secondary"
                              aria-label={
                                calendarDone
                                  ? "Add to calendar (done)"
                                  : "Add to calendar"
                              }
                              disabled={actionsOff || calendarDone}
                              onClick={() => fire("add-to-calendar")}
                            >
                              {calendarDone ? (
                                <CheckIcon aria-hidden />
                              ) : (
                                <CalendarPlusIcon aria-hidden />
                              )}
                            </Button>
                          </IconTip>
                        </WhyDisabled>
                        <WhyDisabled
                          className="flex flex-1 sm:flex-none"
                          when={actionsOff || done.has("cancel-rental")}
                          reason="Not available right now"
                        >
                          <Button
                            ref={cancelButton}
                            size="sm"
                            variant="secondary"
                            disabled={actionsOff || done.has("cancel-rental")}
                            onClick={() => setConfirmingCancel(true)}
                            className="flex-1 sm:flex-none"
                          >
                            {done.has("cancel-rental") && (
                              <CheckIcon aria-hidden />
                            )}
                            Cancel rental
                            {done.has("cancel-rental") && (
                              <span className="sr-only"> (done)</span>
                            )}
                          </Button>
                        </WhyDisabled>
                        <WhyDisabled
                          className="flex flex-1 sm:flex-none"
                          when={actionsOff || manageDone}
                          reason="Not available right now"
                        >
                          <Button
                            size="sm"
                            disabled={actionsOff || manageDone}
                            onClick={() => fire("manage")}
                            className="flex-1 sm:flex-none"
                          >
                            {manageDone && <CheckIcon aria-hidden />}
                            Manage
                            {manageDone && (
                              <span className="sr-only"> (done)</span>
                            )}
                          </Button>
                        </WhyDisabled>
                      </div>
                    )}
                  </div>
                )
              )}
            </SurfaceFooter>
          )}
        </Surface>
      </MotionConfig>
    )
  }

  // -------------------------------------------------------------------------
  // Select mode

  const showFilters = filtersProp ?? offers.length >= 4
  const activeFilters: OfferFilters = showFilters
    ? { ...NO_FILTERS, ...presetFilters(defaultFilters), ...filterEdits }
    : NO_FILTERS
  const sort: OfferSort = showFilters
    ? (sortEdit ?? defaultFilters?.sort ?? "price")
    : "price"
  const visible = showFilters
    ? sortOffers(filterOffers(readyOffers, activeFilters, now), sort)
    : readyOffers
  const categories = categoriesOf(readyOffers)
  const seats = [
    ...new Set([
      ...seatOptions(readyOffers),
      ...(activeFilters.minSeats > 0 ? [activeFilters.minSeats] : []),
    ]),
  ].sort((a, b) => a - b)
  const seatItems = [
    { value: "0", label: "Any seats" },
    ...seats.map((n) => ({ value: String(n), label: `${n}+ seats` })),
  ]
  const rated = readyOffers.some((o) => typeof o.rating?.score === "number")
  const sortKeys: OfferSort[] = rated ? ["price", "rating"] : ["price"]
  const sortItems = sortKeys.map((s) => ({ value: s, label: SORT_LABEL[s] }))

  const reserved = decision?.action === "reserve" ? decision : null
  const offer = reserved
    ? readyOffers.find((o) => o.id === reserved.offerId)
    : (visible.find((o) => o.id === pickedOffer) ??
      (locked ? readyOffers.find((o) => o.id === pickedOffer) : undefined) ??
      visible[0])

  const covers = readyInsurance(offer)
  const cover = offer
    ? (covers.find((c) => c.id === pickedCover[offer.id]) ?? covers[0])
    : undefined
  const extrasList = readyExtras(offer)
  const quantities = offer ? (pickedExtras[offer.id] ?? {}) : {}
  const chosenExtras = extrasList.map((extra) => ({
    extra,
    quantity: Math.min(maxQuantity(extra), quantities[extra.id] ?? 0),
  }))
  const totals = offer ? totalsFor(offer, cover, chosenExtras) : null
  const fee = readyFee(offer)

  const canReserve =
    !busy &&
    !locked &&
    !!offer &&
    !!cover &&
    !!totals &&
    typeof currency === "string"

  const updateFilters = (patch: Partial<OfferFilters>) => {
    if (busy || locked) return
    setFilterEdits((prev) => ({ ...prev, ...patch }))
  }
  const clearFilters = () => updateFilters({ ...NO_FILTERS })
  const toggleCategory = (c: string) => {
    const on = activeFilters.categories.some(
      (x) => x.toLowerCase() === c.toLowerCase(),
    )
    updateFilters({
      categories: on
        ? activeFilters.categories.filter(
            (x) => x.toLowerCase() !== c.toLowerCase(),
          )
        : [...activeFilters.categories, c],
    })
  }
  const setQuantity = (offerId: string, extraId: string, value: number) => {
    if (busy || locked) return
    setPickedExtras((prev) => ({
      ...prev,
      [offerId]: { ...prev[offerId], [extraId]: Math.max(0, value) },
    }))
    setTouched(true)
  }

  const reserveResult = (): CarRentalDraft | null =>
    canReserve && offer && cover && totals && currency
      ? {
          action: "reserve",
          offerId: offer.id,
          insuranceId: cover.id,
          extras: totals.extras.map((e) => ({
            id: e.id,
            quantity: e.quantity,
          })),
          total: {
            amount: totals.total,
            payNow: totals.payNow,
            payAtDesk: totals.payAtDesk,
            currency,
          },
        }
      : null
  const reserve = () => {
    const r = reserveResult()
    if (!r) return
    setDecision(r)
    onResult?.(r)
  }
  const dismiss = () => {
    if (busy || locked) return
    const r: SelectDecision = { action: "dismiss" }
    setDecision(r)
    onResult?.(r)
  }

  // Trip editor
  const draftFrom = tripDraft ? toInstant(tripDraft.pickupAt, pickupZone) : null
  const draftTo = tripDraft ? toInstant(tripDraft.dropoffAt, dropoffZone) : null
  const draftReturn = tripDraft
    ? tripDraft.sameReturn
      ? tripDraft.pickupLocation
      : tripDraft.dropoffLocation
    : ""
  const draftAge = tripDraft?.driverAge.trim()
    ? Number(tripDraft.driverAge)
    : null
  const draftIssue = !tripDraft
    ? null
    : !tripDraft.pickupLocation.trim() || !draftReturn.trim()
      ? "Enter the pick-up and drop-off locations."
      : draftFrom === null || draftTo === null
        ? "Enter the pick-up and drop-off times."
        : draftTo <= draftFrom
          ? "Drop-off must be after pick-up."
          : draftAge !== null &&
              (!Number.isInteger(draftAge) || draftAge < 18 || draftAge > 99)
            ? "Enter a driver age between 18 and 99."
            : null
  const draftChanged =
    !!tripDraft &&
    (tripDraft.pickupLocation.trim() !== (pickup?.location ?? "") ||
      draftReturn.trim() !== (dropoff?.location ?? "") ||
      draftFrom !== pickupT ||
      draftTo !== dropoffT ||
      (draftAge ?? undefined) !== driverAge)
  const updateDraft = (patch: Partial<TripDraft>) =>
    setTripDraft((d) => (d ? { ...d, ...patch } : d))

  const tripChange = (): CarRentalDraft | null =>
    busy ||
    locked ||
    !tripDraft ||
    draftIssue ||
    !draftChanged ||
    draftFrom === null ||
    draftTo === null
      ? null
      : {
          action: "change-trip",
          pickup: {
            location: tripDraft.pickupLocation.trim(),
            at: toOffsetISO(draftFrom, pickupZone),
            timeZone: pickup?.timeZone ?? pickupZone,
          },
          dropoff: {
            location: draftReturn.trim(),
            at: toOffsetISO(draftTo, dropoffZone),
            timeZone: dropoff?.timeZone ?? dropoffZone,
          },
          ...(draftAge !== null ? { driverAge: draftAge } : {}),
        }
  const changeTrip = () => {
    const r = tripChange()
    if (!r) return
    setTripDraft(null)
    setDecision(r)
    onResult?.(r)
  }

  // What the user would send if they confirmed now (D70): a valid trip
  // change while the editor holds one, else the reserve for the picked offer
  // once they've touched something.
  const draftResult =
    tripChange() ?? (touched && !busy && !locked ? reserveResult() : null)

  const changeSummary = (
    r: Extract<SelectDecision, { action: "change-trip" }>,
  ) => {
    const a = toInstant(r.pickup.at, safeTimeZone(r.pickup.timeZone))
    const b = toInstant(r.dropoff.at, safeTimeZone(r.dropoff.timeZone))
    return [
      isOneWay(r.pickup.location, r.dropoff.location)
        ? `${r.pickup.location} → ${r.dropoff.location}`
        : r.pickup.location,
      a !== null && b !== null
        ? `${formatLocalDateTime(a, safeTimeZone(r.pickup.timeZone), locale)} – ${formatLocalDateTime(b, safeTimeZone(r.dropoff.timeZone), locale)}`
        : null,
      typeof r.driverAge === "number" ? `driver aged ${r.driverAge}` : null,
    ]
      .filter(Boolean)
      .join(", ")
  }

  // The empty list already says when no car matches the filters.
  const hint = streaming
    ? null
    : days === null && from && to
      ? "Check the pick-up and drop-off times"
      : cover && offer && readyPrice(offer) && !totals
        ? "This cover has no price. Choose another."
        : null

  const announcement = touched && totals ? `Total ${money(totals.total)}` : ""

  // Transmission, seats and sort stay in one row; category, mileage and
  // cancellation open from "More filters" (already open when one is preset).
  const extraFilterCount =
    (activeFilters.categories.length > 0 ? 1 : 0) +
    (activeFilters.unlimitedMileage ? 1 : 0) +
    (activeFilters.freeCancellation ? 1 : 0)
  const moreOpen = moreFilters ?? extraFilterCount > 0

  const filterBar = showFilters && !reserved && readyOffers.length > 0 && (
    <fieldset
      disabled={locked || busy}
      className="m-0 flex min-w-0 flex-col gap-3 border-0 border-t border-border px-3 py-3"
    >
      <legend className="sr-only">Filter and sort cars</legend>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={activeFilters.transmission}
          onValueChange={(v) =>
            (v === "any" || v === "automatic" || v === "manual") &&
            updateFilters({ transmission: v })
          }
          items={TRANSMISSION_ITEMS}
          disabled={locked || busy}
        >
          <SelectTrigger size="sm" aria-label="Transmission">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TRANSMISSION_ITEMS.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(activeFilters.minSeats)}
          onValueChange={(v) =>
            typeof v === "string" && updateFilters({ minSeats: Number(v) })
          }
          items={seatItems}
          disabled={locked || busy}
        >
          <SelectTrigger size="sm" aria-label="Seats">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {seatItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={sort}
          onValueChange={(v) =>
            (v === "price" || v === "rating") && setSortEdit(v)
          }
          items={sortItems}
          disabled={locked || busy}
        >
          <SelectTrigger size="sm" aria-label="Sort by">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortItems.map((i) => (
              <SelectItem key={i.value} value={i.value}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          variant="secondary"
          aria-expanded={moreOpen}
          aria-controls={`${uid}-more`}
          onClick={() => setMoreFilters(!moreOpen)}
        >
          More filters
          {extraFilterCount > 0 && (
            <span className="tabular-nums">({extraFilterCount})</span>
          )}
          <ChevronDownIcon
            aria-hidden
            className={cn(
              "transition-transform motion-reduce:transition-none",
              moreOpen && "rotate-180",
            )}
          />
        </Button>
        {activeFilterCount(activeFilters) > 0 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={clearFilters}
            className="ml-auto"
          >
            Clear filters
          </Button>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {countLabel(visible.length, readyOffers.length)}
      </p>
      <div
        id={`${uid}-more`}
        hidden={!moreOpen}
        className={cn(
          "flex flex-wrap items-center gap-x-4 gap-y-2",
          !moreOpen && "hidden",
        )}
      >
        {categories.length > 1 && (
          <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0">
            <legend className="sr-only">Category</legend>
            {categories.map((c) => {
              const on = activeFilters.categories.some(
                (x) => x.toLowerCase() === c.toLowerCase(),
              )
              return (
                <Button
                  key={c}
                  size="sm"
                  variant={on ? "default" : "secondary"}
                  aria-pressed={on}
                  onClick={() => toggleCategory(c)}
                  className={cn(
                    "h-8",
                    !on &&
                      "border-border bg-transparent hover:bg-muted dark:hover:bg-white/5",
                  )}
                >
                  {on && <CheckMark />}
                  {c}
                </Button>
              )
            })}
          </fieldset>
        )}
        <div className="grid w-full grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-2">
          {(
            [
              ["unlimitedMileage", "Unlimited mileage"],
              ["freeCancellation", "Free cancellation"],
            ] as const
          ).map(([key, label]) => (
            // One label around the box and its text: the whole row toggles.
            <label
              key={key}
              htmlFor={`${uid}-${key}`}
              className={cn(
                "flex items-center gap-2 rounded-[10px] border border-border px-3 py-3 transition-colors",
                locked || busy
                  ? "cursor-default"
                  : "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
                activeFilters[key] &&
                  "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
              )}
            >
              <Checkbox
                nativeButton
                size="sm"
                id={`${uid}-${key}`}
                aria-labelledby={`${uid}-${key}-label`}
                checked={activeFilters[key]}
                disabled={locked || busy}
                onCheckedChange={(on) =>
                  updateFilters(
                    key === "unlimitedMileage"
                      ? { unlimitedMileage: Boolean(on) }
                      : { freeCancellation: Boolean(on) },
                  )
                }
                // Larger tap area than the 18px box, without changing its look.
                className="relative after:absolute after:-inset-2"
              />
              <span id={`${uid}-${key}-label`} className="text-[13px]">
                {label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  )

  const tripEditor = tripDraft && !locked && (
    <div id={`${uid}-trip`} className="flex flex-col">
      {/* Trip details: one form field per row. */}
      <FormFieldGroup className="border-t border-border px-3 py-3">
        <FormField
          htmlFor={`${uid}-pickup-location`}
          label="Pick-up location"
          filled={tripDraft.pickupLocation !== ""}
        >
          <Input
            id={`${uid}-pickup-location`}
            value={tripDraft.pickupLocation}
            autoFocus
            onChange={(e) => updateDraft({ pickupLocation: e.target.value })}
            className={formInputClass}
          />
        </FormField>
        <FormField htmlFor={`${uid}-pickup-at`} label="Pick-up, local time" pinned>
          <DatePicker
            id={`${uid}-pickup-at`}
            type="datetime-local"
            value={tripDraft.pickupAt}
            onValueChange={(v) => updateDraft({ pickupAt: v })}
            className={formDateClass}
          />
        </FormField>
        <div>
          <label
            htmlFor={`${uid}-same-return`}
            className="-mx-2 -my-1 flex w-fit cursor-pointer items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-muted"
          >
            <Checkbox
              nativeButton
              size="sm"
              id={`${uid}-same-return`}
              aria-labelledby={`${uid}-same-return-label`}
              checked={tripDraft.sameReturn}
              onCheckedChange={(on) =>
                updateDraft({
                  sameReturn: Boolean(on),
                  dropoffLocation: on
                    ? tripDraft.dropoffLocation
                    : tripDraft.dropoffLocation || tripDraft.pickupLocation,
                })
              }
              className="relative after:absolute after:-inset-2"
            />
            <span id={`${uid}-same-return-label`} className="text-[13px]">
              Return to the same location
            </span>
          </label>
        </div>
        {!tripDraft.sameReturn && (
          <FormField
            htmlFor={`${uid}-dropoff-location`}
            label="Drop-off location"
            filled={tripDraft.dropoffLocation !== ""}
          >
            <Input
              id={`${uid}-dropoff-location`}
              value={tripDraft.dropoffLocation}
              onChange={(e) => updateDraft({ dropoffLocation: e.target.value })}
              className={formInputClass}
            />
          </FormField>
        )}
        <FormField
          htmlFor={`${uid}-dropoff-at`}
          label="Drop-off, local time"
          pinned
        >
          <DatePicker
            id={`${uid}-dropoff-at`}
            type="datetime-local"
            value={tripDraft.dropoffAt}
            min={
              tripDraft.pickupAt ? tripDraft.pickupAt.slice(0, 10) : undefined
            }
            onValueChange={(v) => updateDraft({ dropoffAt: v })}
            className={formDateClass}
          />
        </FormField>
        <FormField
          htmlFor={`${uid}-driver-age`}
          label="Driver age (optional)"
          filled={tripDraft.driverAge !== ""}
        >
          <Input
            id={`${uid}-driver-age`}
            type="number"
            inputMode="numeric"
            min={18}
            max={99}
            value={tripDraft.driverAge}
            onChange={(e) => updateDraft({ driverAge: e.target.value })}
            className={formInputClass}
          />
        </FormField>
      </FormFieldGroup>
      <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
        {draftIssue && (
          <p role="alert" className={genuiType.meta}>
            {draftIssue}
          </p>
        )}
        <p id={`${uid}-trip-note`} className="sr-only">
          Prices change with the trip, so the agent checks them again.
        </p>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={closeTripEditor}>
            Cancel
          </Button>
          <WhyDisabled
            when={busy || !!draftIssue || !draftChanged}
            reason="Change the trip first"
          >
            <Button
              size="sm"
              aria-describedby={`${uid}-trip-note`}
              disabled={busy || !!draftIssue || !draftChanged}
              onClick={changeTrip}
            >
              Check prices
            </Button>
          </WhyDisabled>
        </div>
      </div>
    </div>
  )

  // Everything secondary about the selected offer, behind one disclosure.
  const offerDeposit = offer ? depositText(offer.deposit, currency, locale) : null
  const offerTerms = offer
    ? cancellationText(offer.freeCancelUntil, pickup?.timeZone, now, locale)
    : null
  const detailLines = offer
    ? [
        offer.orSimilar === false ? "Guaranteed model" : null,
        otherSpecs(offer) || null,
        policyLine(offer, currency, locale) || null,
        offerTerms,
        offerDeposit ? `Deposit: ${offerDeposit.text}.` : null,
        fee
          ? `Drivers under ${fee.underAge} pay ${money(fee.perDay)} a day.`
          : null,
      ].filter((l): l is string => !!l)
    : []
  const split = totals
    ? splitText(totals.payNow, totals.payAtDesk, currency, "now", locale)
    : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="car-rental"
        data-status={status}
        data-mode="select"
        aria-busy={busy}
        aria-label="Rent a car"
        className={className}
      >
        {onDraft && <ReportDraft draft={draftResult} onDraft={onDraft} />}
        {renderHeader(
          canChangeTrip && (
            <Button
              ref={changeTripButton}
              size="sm"
              variant="secondary"
              aria-expanded={tripDraft !== null}
              aria-controls={`${uid}-trip`}
              onClick={() => (tripDraft ? closeTripEditor() : openTripEditor())}
              className="-mr-2 shrink-0"
            >
              Change trip
            </Button>
          ),
          true,
        )}

        <AutoHeight>
          <div className="flex flex-col">
            {tripEditor}

            {reserved ? (
              // The decision, read-only: what went to the booking flow.
              <dl className="flex flex-col gap-3 border-t border-border px-3 py-3">
                <div className="flex flex-col gap-0.5">
                  <dt className="sr-only">Car</dt>
                  <dd className={genuiType.body}>
                    {offer ? (
                      <>
                        <span className="font-medium">{offer.category}</span>
                        {` · ${modelText(offer.model, offer.orSimilar)}`}
                      </>
                    ) : (
                      reserved.offerId
                    )}
                  </dd>
                  <dt className="sr-only">Supplier, cover and extras</dt>
                  <dd className={genuiType.meta}>
                    {[
                      offer?.supplier,
                      cover?.label ?? reserved.insuranceId,
                      ...reserved.extras.map((e) => {
                        const label =
                          extrasList.find((x) => x.id === e.id)?.label ?? e.id
                        return e.quantity > 1
                          ? `${label} × ${e.quantity}`
                          : label
                      }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </dd>
                </div>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <dt className="sr-only">Total</dt>
                  <dd className={genuiType.stat}>
                    {formatMoney(
                      reserved.total.amount,
                      reserved.total.currency,
                      locale,
                    )}
                  </dd>
                  {reserved.total.payAtDesk > 0 && (
                    <dd className={genuiType.meta}>
                      {reserved.total.payNow > 0
                        ? `${formatMoney(reserved.total.payAtDesk, reserved.total.currency, locale)} due at the desk`
                        : "Paid at the desk"}
                    </dd>
                  )}
                </div>
              </dl>
            ) : (
              <>
                {filterBar}

                <fieldset
                  disabled={locked || busy}
                  className="m-0 min-w-0 border-0 border-t border-border p-0"
                >
                  <legend className="sr-only">Car</legend>
                  {readyOffers.length > 0 && visible.length === 0 ? (
                    <div className="flex flex-col items-start gap-2 px-3 py-3">
                      <p className={genuiType.body}>No matching cars</p>
                      <Button size="sm" onClick={clearFilters}>
                        Clear filters
                      </Button>
                    </div>
                  ) : (
                    <ScrollFade
                      className="max-h-72"
                      viewportClassName="overflow-y-auto pb-5"
                    >
                      <ul className="divide-y">
                        {visible.map((o) => {
                          const checked = o.id === offer?.id
                          const nameId = `${uid}-${o.id}-name`
                          const priceId = `${uid}-${o.id}-price`
                          const detailsId = `${uid}-${o.id}-details`
                          const price = readyPrice(o)
                          const specs = keySpecs(o, locale)
                          const showPrice = !!price && !streaming
                          return (
                            <motion.li
                              key={o.id}
                              data-slot="car-rental-offer"
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              transition={genuiMotion.fade}
                            >
                              <label
                                className={cn(
                                  "flex gap-3 px-3 py-3 transition-colors",
                                  !locked &&
                                    "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
                                  checked && "bg-accent",
                                )}
                              >
                                <input
                                  type="radio"
                                  name={`${uid}-offer`}
                                  value={o.id}
                                  checked={checked}
                                  aria-labelledby={nameId}
                                  aria-describedby={
                                    [
                                      showPrice ? priceId : null,
                                      specs ? detailsId : null,
                                    ]
                                      .filter(Boolean)
                                      .join(" ") || undefined
                                  }
                                  onChange={() => {
                                    setPickedOffer(o.id)
                                    setTouched(true)
                                  }}
                                  className="peer sr-only"
                                />
                                <RadioMark
                                  checked={checked}
                                  className="-mt-0.5 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
                                />
                                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                  <div className="flex items-baseline justify-between gap-3">
                                    <span
                                      id={nameId}
                                      className={cn("min-w-0", genuiType.body)}
                                    >
                                      <span className="font-medium">
                                        {o.category}
                                      </span>
                                      {` · ${modelText(o.model, o.orSimilar)}`}
                                    </span>
                                    {showPrice && price ? (
                                      <span
                                        id={priceId}
                                        className={cn(
                                          genuiType.body,
                                          "shrink-0 font-semibold tabular-nums",
                                        )}
                                      >
                                        {money(price.total)}
                                        <span className="sr-only"> total</span>
                                      </span>
                                    ) : (
                                      streaming && (
                                        <Skeleton className="h-4 w-16 shrink-0" />
                                      )
                                    )}
                                  </div>
                                  {specs && (
                                    <span
                                      id={detailsId}
                                      className={genuiType.meta}
                                    >
                                      {specs}
                                    </span>
                                  )}
                                </div>
                              </label>

                              {checked && !streaming && (
                                <OfferOptions
                                  uid={uid}
                                  offer={o}
                                  covers={covers}
                                  cover={cover}
                                  chosenExtras={chosenExtras}
                                  days={days}
                                  digits={digits}
                                  currency={currency}
                                  meta={
                                    <OfferMeta
                                      offer={o}
                                      free={hasFreeCancellation(o, now)}
                                    />
                                  }
                                  disabled={locked || busy}
                                  onCover={(id) => {
                                    setPickedCover((prev) => ({
                                      ...prev,
                                      [o.id]: id,
                                    }))
                                    setTouched(true)
                                  }}
                                  onQuantity={(id, q) => setQuantity(o.id, id, q)}
                                />
                              )}
                            </motion.li>
                          )
                        })}
                        {streaming && <OfferSkeleton />}
                      </ul>
                    </ScrollFade>
                  )}
                </fieldset>
              </>
            )}

            {/* The total for the selected offer and options: the focal point. */}
            {totals && !reserved && status !== "dismissed" ? (
              <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                <div className="flex items-end justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span className={genuiType.stat}>
                      <span className="sr-only">Total: </span>
                      <AnimatedMoney
                        amount={totals.total}
                        currency={currency}
                      />
                    </span>
                    {split && <span className={genuiType.meta}>{split}</span>}
                  </div>
                  <DetailsToggle
                    open={detailsOpen}
                    controls={`${uid}-details`}
                    onToggle={() => setDetailsOpen((o) => !o)}
                  >
                    Price details
                  </DetailsToggle>
                </div>
                <div
                  id={`${uid}-details`}
                  hidden={!detailsOpen}
                  className={cn(
                    "flex flex-col gap-3",
                    !detailsOpen && "hidden",
                  )}
                >
                  <PriceBreakdown
                    totals={totals}
                    currency={currency}
                    driverAge={driverAge}
                  />
                  {detailLines.length > 0 && (
                    <ul className={cn("flex flex-col gap-1", genuiType.body)}>
                      {detailLines.map((line) => (
                        <li key={line} suppressHydrationWarning>
                          {line}
                        </li>
                      ))}
                    </ul>
                  )}
                  <SourceNote prefix="Prices from" source={source} />
                </div>
              </div>
            ) : (
              streaming &&
              readyOffers.length > 0 && (
                <div
                  aria-hidden
                  className="flex flex-col gap-2 border-t border-border px-3 py-3"
                >
                  <Skeleton className="h-8 w-32" />
                  <Skeleton className="h-3 w-48" />
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
              text="Loading cars and prices…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px] leading-4"
            />
          ) : status === "reserved" ? (
            <p className="flex items-center gap-1.5 text-[13px]">
              <CheckIcon aria-hidden className="size-4" />
              Sent to booking. Not booked until you confirm there.
            </p>
          ) : status === "change-requested" ? (
            <p
              className="flex items-start gap-1.5 text-[13px] text-muted-foreground"
              suppressHydrationWarning
            >
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Asked for new prices
                {decision?.action === "change-trip" && (
                  <span className="text-foreground">
                    : {changeSummary(decision)}
                  </span>
                )}
              </span>
            </p>
          ) : status === "dismissed" ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <XIcon aria-hidden className="size-4" />
              Cancelled. Nothing was booked.
            </p>
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
                  reason="Pick a car and cover first"
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

/** One quiet line for the selected offer: supplier, rating, and the two terms that change a decision. */
function OfferMeta({ offer, free }: { offer: ReadyOffer; free: boolean }) {
  const parts: React.ReactNode[] = []
  if (offer.supplier) parts.push(offer.supplier)
  if (typeof offer.rating?.score === "number") {
    parts.push(<Rating rating={offer.rating} />)
  }
  if (free) parts.push("Free cancellation")
  if (offer.deposit?.card === "credit-only") parts.push("Credit card only")
  if (parts.length === 0) return null
  return (
    <p className={genuiType.meta}>
      {parts.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered list
        <React.Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </React.Fragment>
      ))}
    </p>
  )
}

/** Cover and extras for the selected offer. */
function OfferOptions({
  uid,
  offer,
  covers,
  cover,
  chosenExtras,
  days,
  digits,
  currency,
  meta,
  disabled,
  onCover,
  onQuantity,
}: {
  uid: string
  offer: ReadyOffer
  covers: InsuranceOption[]
  cover: InsuranceOption | undefined
  chosenExtras: { extra: Extra; quantity: number }[]
  days: number | null
  digits: number
  currency: string | undefined
  meta: React.ReactNode
  disabled: boolean
  onCover: (id: string) => void
  onQuantity: (id: string, quantity: number) => void
}) {
  const locale = useGenUILocale()
  const money = (n: number) => formatMoney(n, currency, locale)

  return (
    <div className="flex flex-col gap-4 px-3 pb-3 pl-12">
      {meta}
      <div className="@container">
        <div className="grid gap-4 @lg:grid-cols-2 @lg:items-start">
          {covers.length > 0 && (
            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className={cn("mb-2", genuiType.label)}>Cover</legend>
              {covers.map((c) => {
                const cost = days ? insuranceCost(c, days, digits) : null
                const priced = c.included || cost !== null
                const on = c.id === cover?.id
                return (
                  <label
                    key={c.id}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-[10px] px-3 py-3 transition-colors",
                      priced &&
                        !disabled &&
                        "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
                      !priced && "cursor-not-allowed opacity-60",
                      on &&
                        "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                    )}
                  >
                    <input
                      type="radio"
                      name={`${uid}-${offer.id}-cover`}
                      value={c.id}
                      checked={on}
                      disabled={!priced}
                      onChange={() => onCover(c.id)}
                      className="peer sr-only"
                    />
                    <RadioMark
                      checked={on}
                      className="peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50"
                    />
                    <span
                      className={cn(
                        "flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5",
                        genuiType.body,
                      )}
                    >
                      <span className="min-w-0">
                        <span className="font-medium">{c.label}</span>
                        {` · ${formatMoneyCompact(c.excess, currency, locale)} excess`}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {c.included ? (
                          "Included"
                        ) : cost !== null ? (
                          `+${money(cost)}`
                        ) : (
                          <span className={genuiType.meta}>No price</span>
                        )}
                      </span>
                    </span>
                  </label>
                )
              })}
            </fieldset>
          )}

          {chosenExtras.length > 0 && (
            <fieldset className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0">
              <legend className={cn("mb-2", genuiType.label)}>Extras</legend>
              <ul className="flex flex-col gap-2">
                {chosenExtras.map(({ extra, quantity }) => {
                  const priced =
                    typeof extra.priceTotal === "number" ||
                    typeof extra.pricePerDay === "number"
                  const unit =
                    typeof extra.priceTotal === "number"
                      ? `${money(extra.priceTotal)} per rental`
                      : typeof extra.pricePerDay === "number"
                        ? `${money(extra.pricePerDay)} / day`
                        : "No price"
                  return (
                    <li
                      key={extra.id}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className={cn("min-w-0", genuiType.body)}>
                        {extra.label}
                        <span className="text-muted-foreground tabular-nums">
                          {` · ${unit}`}
                        </span>
                      </span>
                      <QuantityStepper
                        label={extra.label}
                        value={quantity}
                        max={priced ? maxQuantity(extra) : 0}
                        disabled={disabled || !priced}
                        onChange={(q) => onQuantity(extra.id, q)}
                      />
                    </li>
                  )
                })}
              </ul>
            </fieldset>
          )}
        </div>
      </div>
    </div>
  )
}

// The Renderer hands this component onDraft.
CarRental.genuiDraft = true
