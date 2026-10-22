"use client"

import * as React from "react"
import {
  ArmchairIcon,
  ArrowLeftRightIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BadgeCheckIcon,
  CheckIcon,
  ChevronDownIcon,
  LuggageIcon,
  type LucideIcon,
  PlaneIcon,
  PlaneTakeoffIcon,
  TicketIcon,
  UsersIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { WhyDisabled } from "@/components/genui/hint"
import { Segmented } from "@/components/genui/segmented"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
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
import { RadioMark } from "@/components/genui/genui-motion"
import { useGenUILocale } from "@/components/genui/locale"

import {
  airlineMark,
  cheapestIds,
  dateRangeText,
  fastestIds,
  formatClock,
  formatDate,
  formatDuration,
  formatPrice,
  layoverText,
  legDayOffset,
  legMinutes,
  legTimes,
  offerMetaItems,
  type OfferMetaKind,
  pricesForText,
  safeUrl,
  sortOffers,
  spokenDuration,
  spokenLayovers,
  type OfferSort,
} from "./flight-offers-utils"
import type {
  FlightOffer,
  FlightOffersInput,
  FlightOffersResult,
  FlightSearch,
  OfferAirport,
  OfferLeg,
  OfferSegment,
} from "./flight-offers.schema"

export type FlightOffersStatus =
  "streaming" | "ready" | "submitting" | "selected"

type PartialSegment = Partial<Omit<OfferSegment, "from" | "to">> & {
  from?: Partial<OfferAirport>
  to?: Partial<OfferAirport>
}
type PartialOffer = Partial<Omit<FlightOffer, "airline" | "legs" | "bags">> & {
  airline?: { name?: string; code?: string; logo?: string; logoDark?: string }
  legs?: { segments?: PartialSegment[] }[]
  bags?: Partial<NonNullable<FlightOffer["bags"]>>
}
type ReadyOffer = FlightOffer

export type FlightOffersProps = Partial<
  Omit<FlightOffersInput, "search" | "offers" | "source">
> & {
  /** Everything may be partial while the tool call streams. */
  search?: Partial<Omit<FlightSearch, "passengers">> & {
    passengers?: Partial<FlightSearch["passengers"]>
  }
  offers?: PartialOffer[]
  source?: { label?: string; url?: string }
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host acts on
   * the choice. When omitted, the component tracks the user's choice itself.
   */
  status?: FlightOffersStatus
  /** Called once with the chosen offer (only when `selectable`). */
  onResult?: (result: FlightOffersResult) => void
  /**
   * Called when the user picks an offer, before they confirm. Not a
   * decision: keep the latest and add it to the user's next typed message
   * (`describeUIState`).
   */
  onDraft?: (draft: FlightOffersResult) => void
  /** A choice from history: read-only, chosen offer marked. Never calls onResult. */
  result?: FlightOffersResult
  className?: string
}

/** Offers shown before "Show more". */
const INITIAL_VISIBLE = 2

const SORT_LABEL: Record<OfferSort, string> = {
  price: "Price",
  duration: "Duration",
  departure: "Departure",
}

/** Times and prices: Halaska's stat size. */
const bigValue = cn(genuiType.stat, "leading-none")

const META_ICON: Record<OfferMetaKind, LucideIcon> = {
  fare: TicketIcon,
  bags: LuggageIcon,
  trip: ArrowLeftRightIcon,
  refundable: BadgeCheckIcon,
  seats: ArmchairIcon,
}

/** A logo may be http(s), a same-origin path, or an image data URL; anything else is not loaded. */
const safeLogoSrc = (src?: string) =>
  src &&
  (/^https?:\/\//i.test(src) ||
    /^\/(?!\/)/.test(src) ||
    /^data:image\//i.test(src))
    ? src
    : undefined

/** The airline's own icon when the data gives one, else its code on a tile. */
function AirlineTile({
  airline,
}: {
  airline: { name?: string; code?: string; logo?: string; logoDark?: string }
}) {
  const [failed, setFailed] = React.useState(false)
  const logo = safeLogoSrc(airline.logo)
  if (logo && !failed && /\.svg(\?|$)/i.test(logo)) {
    // A wordmark is wide, not square, and has no tile: it sits straight on the card. A light-lettered
    // version, when the data gives one, replaces it in dark mode.
    const dark = safeLogoSrc(airline.logoDark)
    const img = "h-auto max-h-5 w-auto max-w-32"
    return (
      <span aria-hidden className="flex h-11 shrink-0 items-center">
        {/* biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured */}
        <img
          src={logo}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={cn(img, dark && "dark:hidden")}
        />
        {dark && (
          // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
          <img
            src={dark}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={cn(img, "hidden dark:block")}
          />
        )}
      </span>
    )
  }
  if (logo && !failed) {
    return (
      // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
      <img
        src={logo}
        alt=""
        aria-hidden
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="size-11 shrink-0 rounded-[10px] object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-border bg-transparent text-[13px] font-semibold tracking-wide"
    >
      {airlineMark(airline)}
    </span>
  )
}

function isReadySegment(s: PartialSegment): s is OfferSegment {
  return (
    typeof s.flightNumber === "string" &&
    typeof s.departAt === "string" &&
    typeof s.arriveAt === "string" &&
    typeof s.from?.code === "string" &&
    typeof s.from.timeZone === "string" &&
    typeof s.to?.code === "string" &&
    typeof s.to.timeZone === "string"
  )
}

/** Shown once the airline, price and every flight (with valid times) arrived. */
function isReadyOffer(o: PartialOffer): o is ReadyOffer {
  return (
    typeof o.id === "string" &&
    typeof o.airline?.name === "string" &&
    typeof o.price === "number" &&
    Array.isArray(o.legs) &&
    o.legs.length > 0 &&
    o.legs.every(
      (l) =>
        Array.isArray(l.segments) &&
        l.segments.length > 0 &&
        l.segments.every(isReadySegment) &&
        legTimes(l as OfferLeg) !== null,
    )
  )
}

/** The dashed arc between the two airports, with a gap at its top for the plane. */
const ARC_W = 100
const ARC_H = 36
const arcPoint = (u: number) => {
  // A quadratic curve from (0,34) up to a peak at y=12 and back down to (100,34).
  const [x0, y0, x1, y1, x2, y2] = [0, 34, 50, -10, 100, 34]
  const m = 1 - u
  return [
    m * m * x0 + 2 * m * u * x1 + u * u * x2,
    m * m * y0 + 2 * m * u * y1 + u * u * y2,
  ] as const
}
const arcPath = (from: number, to: number) => {
  const steps = 18
  return Array.from({ length: steps + 1 }, (_, i) => {
    const [x, y] = arcPoint(from + ((to - from) * i) / steps)
    return `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(" ")
}
const ARC_LEFT = arcPath(0, 0.38)
const ARC_RIGHT = arcPath(0.62, 1)

function FlightArc() {
  // Each half fades out toward the plane: full colour at the airport end, clear at the plane end.
  const id = React.useId().replace(/[^a-zA-Z0-9_-]/g, "")
  const halves = [
    { d: ARC_LEFT, from: 0, to: 38, reverse: false },
    { d: ARC_RIGHT, from: 62, to: 100, reverse: true },
  ]
  return (
    <div className="relative h-9 w-full">
      <svg
        aria-hidden
        viewBox={`0 0 ${ARC_W} ${ARC_H}`}
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible text-sky-500 dark:text-sky-400"
      >
        <defs>
          {halves.map((h, i) => (
            <linearGradient
              key={h.d}
              id={`${id}-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={h.from}
              x2={h.to}
              y1={0}
              y2={0}
            >
              <stop
                offset="0"
                stopColor="currentColor"
                stopOpacity={h.reverse ? 0 : 1}
              />
              <stop
                offset="1"
                stopColor="currentColor"
                stopOpacity={h.reverse ? 1 : 0}
              />
            </linearGradient>
          ))}
        </defs>
        {halves.map((h, i) => (
          <path
            key={h.d}
            d={h.d}
            fill="none"
            stroke={`url(#${id}-${i})`}
            strokeWidth={1.5}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      <PlaneIcon
        aria-hidden
        strokeWidth={1.5}
        className="absolute top-[33%] left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 rotate-45"
      />
    </div>
  )
}

/**
 * One direction in two lines, like a booking row: the times at each end with
 * the arc and plane between them, then each airport's code and city under its
 * time, with the flight numbers, stops, duration and layover in the middle.
 */
function LegRow({
  leg,
  direction,
}: {
  leg: OfferLeg
  direction: "Outbound" | "Return" | "Flight"
}) {
  const locale = useGenUILocale()
  const first = leg.segments[0]
  const last = leg.segments[leg.segments.length - 1]
  const times = legTimes(leg)
  if (!first || !last || !times) return null
  const minutes = legMinutes(leg)
  const offset = legDayOffset(leg)
  const stops = layoverText(leg)
  const stopCount = leg.segments.length - 1
  const stopLabel =
    stopCount === 0
      ? "Non-stop"
      : stopCount === 1
        ? "1 stop"
        : `${stopCount} stops`
  // "1 stop · LCA 1h 05m" -> the part after the count: "LCA 1h 05m".
  const via = stops ? stops.split(" · ").slice(1).join(" · ") : ""
  const depart = formatClock(times.depart, first.from.timeZone)
  const arrive = formatClock(times.arrive, last.to.timeZone)
  const numbers = leg.segments.map((s) => s.flightNumber).join(", ")
  const operators = [
    ...new Set(
      leg.segments
        .map((s) => s.operatedBy)
        .filter((o): o is string => Boolean(o)),
    ),
  ]
  const spoken = [
    `${direction}, ${formatDate(times.depart, first.from.timeZone, "long", locale)}: departs ${first.from.code} ${depart}, arrives ${last.to.code} ${arrive}${
      offset === 1
        ? " the next day"
        : offset > 1
          ? ` ${offset} days later`
          : offset < 0
            ? " the previous day"
            : ""
    }`,
    minutes !== null ? spokenDuration(minutes) : null,
    spokenLayovers(leg),
    `${leg.segments.length > 1 ? "flights" : "flight"} ${numbers}`,
    operators.length > 0 ? `operated by ${operators.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <div className="flex flex-col gap-1.5">
      <p className="sr-only" suppressHydrationWarning>{`${spoken}.`}</p>
      {/* Times at each end with the arc between them, then one line of
          detail under them: each airport's code and city, and the flight
          numbers, stops, duration and layover in the middle. */}
      <div
        aria-hidden
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4"
      >
        <span className={bigValue}>{depart}</span>
        <FlightArc />
        <span className={cn(bigValue, "text-right")}>
          {arrive}
          {offset !== 0 && (
            <sup className="ml-0.5 text-[13px] font-medium tracking-normal">
              {offset > 0 ? `+${offset}` : offset}
            </sup>
          )}
        </span>
      </div>
      <div
        aria-hidden
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-4"
      >
        <span className="leading-5">
          <span className="text-[14px] font-medium">{first.from.code}</span>
          {first.from.city && (
            <span className={genuiType.meta}> · {first.from.city}</span>
          )}
        </span>
        <span className="text-center text-[13px] leading-5 tabular-nums">
          {numbers} · {stopLabel}
          {minutes !== null && ` · ${formatDuration(minutes)}`}
          {via && <span className="text-muted-foreground"> · via {via}</span>}
        </span>
        <span className="text-right leading-5">
          {last.to.city && (
            <span className={genuiType.meta}>{last.to.city} · </span>
          )}
          <span className="text-[14px] font-medium">{last.to.code}</span>
        </span>
      </div>
      {operators.length > 0 && (
        <p aria-hidden className={cn(genuiType.meta, "tabular-nums")}>
          Operated by {operators.join(", ")}
        </p>
      )}
    </div>
  )
}

function OfferBody({
  offer,
  rank,
  currency,
  badges,
  selected,
  selectable,
  ids,
}: {
  offer: ReadyOffer
  rank: number
  currency: string
  badges: string[]
  selected: boolean
  selectable: boolean
  ids: {
    rank: string
    name: string
    price: string
    badges: string
    details: string
  }
}) {
  const locale = useGenUILocale()
  const roundTrip = offer.legs.length > 1
  const meta = offerMetaItems(offer)
  return (
    <div className="flex flex-col gap-3">
      {/* The header band: the selection mark and the option's number, the airline (left), the
          badges and the price (right), above an edge-to-edge divider. */}
      <div className="-mx-3 flex items-center gap-3 border-b border-border px-3 pb-3">
        <span id={ids.rank} className="sr-only">{`Option ${rank}: `}</span>
        {selectable && <RadioMark checked={selected} />}
        <span
          aria-hidden
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-[13px] font-semibold tabular-nums text-foreground dark:bg-white/15 dark:text-white"
        >
          {rank}
        </span>
        <AirlineTile airline={offer.airline} />
        <span
          id={ids.name}
          className={cn(
            genuiType.title,
            "min-w-0 flex-1 text-left break-words",
          )}
        >
          {offer.airline.name}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          {badges.length > 0 && (
            <span id={ids.badges} className="flex gap-1">
              {badges.map((b) => (
                <Badge key={b} variant="info">
                  {b}
                </Badge>
              ))}
            </span>
          )}
          <span id={ids.price} className={bigValue}>
            {formatPrice(offer.price, currency, locale)}
            <span className="sr-only"> total</span>
          </span>
        </div>
      </div>

      {/* Each flight on its own row; a round trip stacks the two, outbound then return. */}
      <div
        id={ids.details}
        className="flex flex-col [&>*]:py-3 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0"
      >
        {offer.legs.map((leg, i) => (
          <LegRow
            // biome-ignore lint/suspicious/noArrayIndexKey: legs are positional (outbound, return)
            key={i}
            leg={leg}
            direction={roundTrip ? (i === 0 ? "Outbound" : "Return") : "Flight"}
          />
        ))}
      </div>

      {/* Below the flights, past an edge-to-edge divider: the fare details. */}
      <div className="-mx-3 border-t border-border px-3 pt-3">
        <ul
          className={cn(
            genuiType.meta,
            "flex min-w-0 flex-wrap gap-x-4 gap-y-1.5",
          )}
        >
          {meta.map((m) => {
            // A one-way trip points one way; a round trip points both ways.
            const Icon =
              m.kind === "trip" && offer.legs.length === 1
                ? ArrowRightIcon
                : META_ICON[m.kind]
            return (
              <li key={m.kind} className="inline-flex items-center gap-1.5">
                <Icon aria-hidden className="size-3.5 shrink-0" />
                {m.text}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

export function FlightOffers({
  search,
  currency = "USD",
  offers = [],
  sort,
  selectable = true,
  source,
  status: statusProp,
  onResult,
  onDraft,
  result,
  className,
}: FlightOffersProps) {
  const locale = useGenUILocale()
  const [choice, setChoice] = React.useState<string | null>(
    () => result?.offerId ?? null,
  )
  const [decided, setDecided] = React.useState(result !== undefined)
  const [userSort, setUserSort] = React.useState<OfferSort | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const listId = `${baseId}-list`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: FlightOffersStatus =
    decided && (statusProp === undefined || statusProp === "ready")
      ? "selected"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const canChoose = selectable && status === "ready"
  const showChoice = selectable || status === "selected"

  const ready = offers.filter(isReadyOffer)
  const activeSort = userSort ?? sort ?? null
  // While streaming, keep the agent's order so nothing jumps.
  const sorted =
    !streaming && activeSort ? sortOffers(ready, activeSort) : ready
  const visible = expanded
    ? sorted
    : sorted.filter((o, i) => i < INITIAL_VISIBLE || o.id === choice)
  const hiddenCount = sorted.length - visible.length
  const canCollapse = expanded && sorted.length > INITIAL_VISIBLE

  // Marks wait for the whole list, so they don't hop while offers stream.
  const cheapest = streaming ? [] : cheapestIds(ready)
  const fastest = streaming ? [] : fastestIds(ready)
  const chosen = ready.find((o) => o.id === choice)

  const from = search?.from
  const to = search?.to
  const dates = dateRangeText(search?.departDate, search?.returnDate, locale)
  const cabin =
    search?.cabin && search.cabin !== "economy"
      ? { premium: "Premium economy", business: "Business", first: "First" }[
          search.cabin
        ]
      : null
  const headerMeta = [dates, cabin].filter(Boolean).join(" · ")
  const passengers =
    typeof search?.passengers?.adults === "number"
      ? pricesForText({
          adults: search.passengers.adults,
          children: search.passengers.children,
          infants: search.passengers.infants,
        })
      : null
  const href = safeUrl(source?.url)

  const choose = (id: string) => {
    if (!canChoose) return
    setChoice(id)
    if (id !== choice) onDraft?.({ action: "select", offerId: id })
  }
  const submit = () => {
    if (!canChoose || !chosen) return
    setDecided(true)
    onResult?.({ action: "select", offerId: chosen.id })
  }

  const items = visible.map((offer) => {
    const rank = sorted.indexOf(offer) + 1
    const selected = showChoice && offer.id === choice
    const badges = [
      cheapest.includes(offer.id) && "Cheapest",
      fastest.includes(offer.id) && "Fastest",
    ].filter((b): b is string => Boolean(b))
    const key = `${baseId}-${offer.id}`
    const ids = {
      rank: `${key}-rank`,
      name: `${key}-name`,
      price: `${key}-price`,
      badges: `${key}-badges`,
      details: `${key}-details`,
    }
    const body = (
      <OfferBody
        offer={offer}
        rank={rank}
        currency={currency}
        badges={badges}
        selected={selected}
        selectable={showChoice}
        ids={ids}
      />
    )
    return (
      <motion.li
        key={offer.id}
        layout="position"
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={genuiMotion.fade}
        data-selected={selected || undefined}
      >
        {showChoice ? (
          <label
            className={cn(
              "block rounded-[10px] border border-border bg-transparent p-3 transition-[background-color,box-shadow] has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring/50",
              canChoose &&
                "cursor-pointer hover:border-foreground/25 hover:bg-muted/50 dark:hover:bg-white/5",
              // Selection reads from the violet edge and the filled radio, not a fill.
              selected &&
                "border-choice ring-1 ring-choice hover:border-choice hover:bg-transparent dark:hover:bg-transparent has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-choice",
            )}
          >
            <input
              type="radio"
              name={`${baseId}-offer`}
              value={offer.id}
              checked={selected}
              disabled={!canChoose}
              onChange={() => choose(offer.id)}
              aria-labelledby={[
                ids.rank,
                ids.name,
                ids.price,
                badges.length > 0 ? ids.badges : null,
              ]
                .filter(Boolean)
                .join(" ")}
              aria-describedby={ids.details}
              className="sr-only"
            />
            {body}
          </label>
        ) : (
          <div className="rounded-[10px] border border-border bg-transparent p-3">
            {body}
          </div>
        )}
      </motion.li>
    )
  })

  const list = (
    <ol id={listId} className="@container flex flex-col gap-2 px-3 pb-3">
      {items}
      {streaming && (
        <li aria-hidden>
          <div className="flex flex-col gap-4 rounded-[10px] border border-border bg-transparent p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="size-6 rounded-full" />
              <Skeleton className="size-10 rounded-lg" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ml-auto h-6 w-20" />
            </div>
            <Skeleton className="h-6 w-full" />
          </div>
        </li>
      )}
    </ol>
  )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="flight-offers"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        <SurfaceHeader className="flex-row flex-wrap items-start justify-between gap-x-4 gap-y-2 pb-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400"
          >
            <PlaneTakeoffIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SurfaceTitle id={titleId}>
              {from && to ? (
                <>
                  {from}
                  <span
                    aria-hidden
                    className="mx-2.5 inline-flex items-center align-middle text-sky-500 dark:text-sky-400"
                  >
                    <span className="size-1.5 rounded-full bg-current" />
                    <span className="h-0 w-9 border-t-[1.5px] border-dashed border-current" />
                    <span className="size-1.5 rounded-full bg-current" />
                  </span>
                  <span className="sr-only"> to </span>
                  {to}
                </>
              ) : streaming ? undefined : (
                "Flights"
              )}
            </SurfaceTitle>
            {headerMeta && <p className={genuiType.meta}>{headerMeta}</p>}
          </div>
          {ready.length > 1 && (
            <>
              {/* No option is pressed until the agent or the user sorts. */}
              <Segmented<OfferSort | "">
                label="Sort flights by"
                value={activeSort ?? ""}
                onChange={(key) => key && setUserSort(key)}
                disabled={streaming}
                fit
                options={(Object.keys(SORT_LABEL) as OfferSort[]).map(
                  (key) => ({ value: key, label: SORT_LABEL[key] }),
                )}
              />
              <span className="sr-only" aria-live="polite">
                {userSort
                  ? `Sorted by ${SORT_LABEL[userSort].toLowerCase()}`
                  : ""}
              </span>
            </>
          )}
        </SurfaceHeader>

        <AutoHeight>
          <div className="border-t border-border pt-3 pb-1">
            {showChoice ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="sr-only">Choose a flight</legend>
                {list}
              </fieldset>
            ) : (
              list
            )}
            {(hiddenCount > 0 || canCollapse) && (
              <div className="px-3 pt-2 pb-3">
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  aria-expanded={expanded}
                  aria-controls={listId}
                  onClick={() => setExpanded((v) => !v)}
                >
                  <ChevronDownIcon
                    aria-hidden
                    className={cn(
                      "transition-transform",
                      expanded && "rotate-180",
                    )}
                  />
                  {expanded ? "Show fewer" : `Show ${hiddenCount} more`}
                </Button>
              </div>
            )}
          </div>
        </AutoHeight>

        {(streaming || passengers || source?.label || showChoice) && (
          <SurfaceFooter className="justify-between gap-3">
            <p aria-live="polite" className={cn(genuiType.meta, "min-w-0")}>
              {streaming ? (
                <ShimmeringText
                  text="Loading flights…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "selected" ? (
                <span
                  className={cn(
                    genuiType.body,
                    "flex items-center gap-1.5 text-foreground",
                  )}
                >
                  <CheckIcon aria-hidden className="size-4" />
                  {chosen
                    ? `Selected ${chosen.airline.name} · ${formatPrice(chosen.price, currency, locale)}`
                    : "Flight selected"}
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  {passengers && (
                    <>
                      <UsersIcon aria-hidden className="size-3.5 shrink-0" />
                      <span>{passengers}</span>
                    </>
                  )}
                  {passengers && source?.label && <span aria-hidden>·</span>}
                  {source?.label &&
                    (href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-6 items-center gap-1 rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="sr-only">Source: </span>
                        {source.label}
                        <ArrowUpRightIcon aria-hidden className="size-3.5" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <>
                        <span className="sr-only">Source: </span>
                        {source.label}
                      </>
                    ))}
                </span>
              )}
            </p>
            {selectable && status !== "selected" && (
              <WhyDisabled
                reason={canChoose && !chosen && "Pick a flight first"}
                className="ml-auto inline-flex"
              >
                <Button
                  size="sm"
                  className="ml-auto"
                  onClick={submit}
                  disabled={!canChoose || !chosen}
                >
                  {status === "submitting" ? "Selecting…" : "Select flight"}
                  {chosen && (
                    <span className="sr-only">
                      {`: ${chosen.airline.name}, ${formatPrice(chosen.price, currency, locale)}`}
                    </span>
                  )}
                </Button>
              </WhyDisabled>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}

// The Renderer hands this component onDraft.
FlightOffers.genuiDraft = true
