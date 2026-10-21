"use client"

import * as React from "react"
import {
  BellIcon,
  CalendarClockIcon,
  CheckIcon,
  CircleXIcon,
  ClockIcon,
  DoorOpenIcon,
  GaugeIcon,
  LuggageIcon,
  type LucideIcon,
  MountainIcon,
  BuildingIcon,
  PlaneIcon,
  PlaneLandingIcon,
  PlaneTakeoffIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
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

import {
  IN_AIR,
  dayOffset,
  deriveProgress,
  effectiveTime,
  formatClock,
  formatDate,
  formatDuration,
  punctuality,
  referenceEnd,
  relativeText,
  resolveNow,
  safeUrl,
  stateDelay,
  timeChanged,
  toInstant,
  zoneLabel,
  delayMinutes,
  type EffectiveTime,
  type FlightState,
} from "./flight-status-utils"
import type {
  FlightStatusAirport,
  FlightStatusInput,
  FlightStatusResult,
  FlightStatusTimes,
} from "./flight-status.schema"
import { useGenUILocale } from "@/components/genui/locale"

export type FlightStatusStatus =
  "streaming" | "ready" | "submitting" | "watching"

export type FlightStatusProps = Partial<
  Omit<
    FlightStatusInput,
    "airline" | "from" | "to" | "times" | "updates" | "source" | "position"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  airline?: { name?: string; code?: string }
  from?: Partial<FlightStatusAirport>
  to?: Partial<FlightStatusAirport> & { baggageBelt?: string }
  times?: {
    depart?: Partial<FlightStatusTimes>
    arrive?: Partial<FlightStatusTimes>
  }
  position?: { altitudeFt?: number; groundSpeedKt?: number }
  updates?: { at?: string; text?: string }[]
  source?: { label?: string; url?: string }
  /**
   * The moment relative times are measured from ("Landed 12 min ago").
   * Defaults to the viewer's clock, read after mount and every 30 seconds.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host subscribes
   * the user. When omitted, the component tracks the watch action itself.
   */
  status?: FlightStatusStatus
  /** Called once when the user asks to be notified (only with `watch`). */
  onResult?: (result: FlightStatusResult) => void
  /** The watch action from history. Shows as done; never calls onResult. */
  result?: FlightStatusResult
  className?: string
}

const STATE: Record<
  FlightState,
  {
    label: string
    variant: "success" | "warning" | "info" | "destructive"
    Icon: typeof CheckIcon
  }
> = {
  scheduled: {
    label: "Scheduled",
    variant: "info",
    Icon: CalendarClockIcon,
  },
  boarding: { label: "Boarding", variant: "info", Icon: DoorOpenIcon },
  departed: { label: "Departed", variant: "info", Icon: PlaneTakeoffIcon },
  "en-route": { label: "En route", variant: "info", Icon: PlaneIcon },
  landed: { label: "Landed", variant: "success", Icon: PlaneLandingIcon },
  arrived: { label: "Arrived", variant: "success", Icon: CheckIcon },
  delayed: { label: "Delayed", variant: "warning", Icon: ClockIcon },
  cancelled: { label: "Cancelled", variant: "destructive", Icon: CircleXIcon },
  diverted: { label: "Diverted", variant: "warning", Icon: TriangleAlertIcon },
}

const CLASS_LABEL = {
  economy: "Economy",
  premium: "Premium economy",
  business: "Business",
  first: "First",
} as const

/**
 * The current time: the host's `now`, or the viewer's clock read after mount
 * (so server and client render the same markup) and refreshed every 30 s.
 */
function useNow(fixed: number | null) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (fixed !== null) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [fixed])
  return fixed ?? now
}

type Airport = { code: string; city: string; timeZone: string }

function isAirport(
  a: Partial<FlightStatusAirport> | undefined,
): a is Airport & Partial<FlightStatusAirport> {
  return (
    typeof a?.code === "string" &&
    typeof a.city === "string" &&
    typeof a.timeZone === "string"
  )
}

/** One end of the route: code, time (struck-through schedule when changed), punctuality. */
function TimeBlock({
  verb,
  airport,
  time: given,
  align,
  cancelled,
  dayMark,
}: {
  verb: "Departs" | "Arrives"
  airport: Airport
  time: EffectiveTime
  align: "start" | "end"
  cancelled: boolean
  dayMark?: number
}) {
  const locale = useGenUILocale()
  // A cancelled flight shows the time it was scheduled for, struck through.
  const time: EffectiveTime = cancelled
    ? { t: given.scheduled, kind: "scheduled", scheduled: given.scheduled }
    : given
  const changed = !cancelled && timeChanged(time)
  const p = cancelled ? null : punctuality(delayMinutes(time))
  const tz = airport.timeZone
  const past = cancelled
    ? `Was scheduled to ${verb === "Departs" ? "depart" : "arrive"}`
    : time.kind === "actual"
      ? verb === "Departs"
        ? "Departed"
        : "Arrived"
      : time.kind === "estimated"
        ? `${verb === "Departs" ? "Departs" : "Arrives"}, estimated`
        : verb
  const spoken = `${past} ${formatDate(time.t, tz, "long", locale)}, ${formatClock(time.t, tz)} ${zoneLabel(airport.city, time.t, tz)}${
    changed ? `, scheduled ${formatClock(time.scheduled, tz)}` : ""
  }`
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5",
        align === "end" && "items-end text-right",
      )}
    >
      <span aria-hidden className={cn(genuiType.label, "font-mono")}>
        {airport.code}
      </span>
      <span className="sr-only" suppressHydrationWarning>
        {spoken}
      </span>
      <span
        aria-hidden
        className={cn(
          "flex flex-wrap items-baseline gap-x-1.5",
          align === "end" && "justify-end",
        )}
      >
        {changed && (
          <s
            className={cn(genuiType.body, "tabular-nums text-muted-foreground")}
          >
            {formatClock(time.scheduled, tz)}
          </s>
        )}
        <span
          className={cn(
            genuiType.display,
            cancelled && "text-muted-foreground line-through",
          )}
        >
          {formatClock(time.t, tz)}
          {dayMark !== undefined && dayMark !== 0 && (
            <sup className="ml-0.5 text-[13px] font-medium">
              {dayMark > 0 ? `+${dayMark}` : dayMark}
            </sup>
          )}
        </span>
      </span>
      {p && (
        <span
          className={cn(genuiType.body, p.kind === "late" && "font-medium")}
        >
          {p.text}
        </span>
      )}
    </div>
  )
}

export function FlightStatus({
  flightNumber,
  airline,
  from,
  to,
  state,
  times,
  progress: progressProp,
  position,
  delayReason,
  divertedTo,
  seat,
  class: cabin,
  updates,
  asOf,
  source,
  watch,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: FlightStatusProps) {
  const locale = useGenUILocale()
  const [watching, setWatching] = React.useState(result !== undefined)
  const [announcement, setAnnouncement] = React.useState("")
  const titleId = React.useId()

  const status: FlightStatusStatus =
    watching && (statusProp === undefined || statusProp === "ready")
      ? "watching"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const now = useNow(resolveNow(nowProp))

  const origin = isAirport(from) ? from : null
  const dest = isAirport(to) ? to : null
  const depart = origin ? effectiveTime(times?.depart, origin.timeZone) : null
  const arrive = dest ? effectiveTime(times?.arrive, dest.timeZone) : null
  const cancelled = state === "cancelled"
  const inAir = state !== undefined && IN_AIR.includes(state)

  const delay = stateDelay(state, depart, arrive)
  const stateLabel = state
    ? state === "delayed" && delay !== null && delay > 0
      ? `Delayed ${formatDuration(delay)}`
      : state === "diverted" && divertedTo
        ? `Diverted to ${divertedTo.code}`
        : STATE[state].label
    : ""
  const progress = deriveProgress(state, depart, arrive, now, progressProp)
  const relative = relativeText(state, depart, arrive, now)
  const flightMinutes =
    depart && arrive && arrive.t > depart.t
      ? Math.round((arrive.t - depart.t) / 60_000)
      : null
  const marker =
    depart && arrive && origin && dest
      ? dayOffset(depart.t, origin.timeZone, arrive.t, dest.timeZone)
      : 0

  const ref = referenceEnd(state) === "from" ? origin : dest
  const asOfT = ref ? toInstant(asOf, ref.timeZone) : null
  const readyUpdates = (updates ?? []).filter(
    (u): u is { at: string; text: string } =>
      typeof u.at === "string" && typeof u.text === "string",
  )
  const href = safeUrl(source?.url)
  const title = flightNumber
    ? `${flightNumber}${airline?.name ? ` · ${airline.name}` : ""}`
    : ""

  // Announce state and newest-update changes from live re-renders, never the
  // first render.
  const heard = React.useRef<string | null>(null)
  const latest = readyUpdates[0]?.text ?? ""
  React.useEffect(() => {
    if (streaming || !stateLabel) return
    const key = `${stateLabel}|${latest}`
    if (heard.current === null) {
      heard.current = key
      return
    }
    if (heard.current === key) return
    const [prevLabel] = heard.current.split("|")
    heard.current = key
    setAnnouncement(
      prevLabel !== stateLabel
        ? `${flightNumber ?? "Flight"}: ${stateLabel}${latest ? `. ${latest}` : ""}`
        : `${flightNumber ?? "Flight"}: ${latest}`,
    )
  }, [streaming, stateLabel, latest, flightNumber])

  // Seat and class are the user's own; read to screen readers, not shown.
  const facts: {
    label: string
    spoken?: string
    value: string
    hidden?: boolean
    icon?: LucideIcon
  }[] = []
  if (origin?.terminal) {
    facts.push({
      icon: BuildingIcon,
      label: `${origin.code} terminal`,
      spoken: `Departure terminal, ${origin.city}`,
      value: origin.terminal,
    })
  }
  if (origin?.gate) {
    facts.push({
      icon: DoorOpenIcon,
      label: `${origin.code} gate`,
      spoken: `Departure gate, ${origin.city}`,
      value: origin.gate,
    })
  }
  if (dest?.terminal) {
    facts.push({
      icon: BuildingIcon,
      label: `${dest.code} terminal`,
      spoken: `Arrival terminal, ${dest.city}`,
      value: dest.terminal,
    })
  }
  if (dest?.gate) {
    facts.push({
      icon: DoorOpenIcon,
      label: `${dest.code} gate`,
      spoken: `Arrival gate, ${dest.city}`,
      value: dest.gate,
    })
  }
  if (to?.baggageBelt)
    facts.push({
      icon: LuggageIcon,
      label: "Baggage belt",
      value: to.baggageBelt,
    })
  if (seat) facts.push({ label: "Seat", value: seat, hidden: true })
  if (cabin)
    facts.push({ label: "Class", value: CLASS_LABEL[cabin], hidden: true })
  if (inAir && typeof position?.altitudeFt === "number") {
    facts.push({
      icon: MountainIcon,
      label: "Altitude",
      value: `${new Intl.NumberFormat(locale).format(Math.round(position.altitudeFt))} ft`,
    })
  }
  if (inAir && typeof position?.groundSpeedKt === "number") {
    facts.push({
      icon: GaugeIcon,
      label: "Ground speed",
      value: `${Math.round(position.groundSpeedKt)} kt`,
      spoken: "Ground speed, knots",
    })
  }

  const StateIcon = state ? STATE[state].Icon : null
  // En route and landed: the plane flies in from the origin to where it is,
  // with the bar filling behind it. Other states only move when progress changes.
  const flies = state === "en-route" || state === "landed"
  const routeTransition = flies
    ? { duration: 2.6, ease: [0.45, 0.05, 0.25, 1] as const }
    : { duration: 0.8, ease: "easeInOut" as const }
  const routeDate =
    depart && origin ? formatDate(depart.t, origin.timeZone, undefined, locale) : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="flight-status"
        data-status={status}
        data-state={state}
        aria-busy={busy}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Flight status"}
        className={className}
      >
        <SurfaceHeader className="flex-row items-start gap-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            {origin && dest ? (
              <p className={genuiType.meta} suppressHydrationWarning>
                {`${origin.city} to ${dest.city}`}
                {routeDate && ` · ${routeDate}`}
              </p>
            ) : (
              streaming && <Skeleton className="h-3 w-32" />
            )}
          </div>
          {state && StateIcon && (
            <Badge variant={STATE[state].variant} className="shrink-0">
              <StateIcon aria-hidden data-icon="inline-start" />
              {/* The delay length is shown under each time, so the badge keeps the plain state. */}
              {state === "delayed" ? (
                <>
                  {STATE.delayed.label}
                  <span className="sr-only">{stateLabel.slice(7)}</span>
                </>
              ) : (
                stateLabel
              )}
            </Badge>
          )}
        </SurfaceHeader>

        <div className="flex flex-col">
          {/* Departure and arrival times, then progress */}
          <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
            {origin && dest && depart && arrive ? (
              <div className="grid grid-cols-2 items-start gap-4">
                <TimeBlock
                  verb="Departs"
                  airport={origin}
                  time={depart}
                  align="start"
                  cancelled={cancelled}
                />
                <TimeBlock
                  verb="Arrives"
                  airport={dest}
                  time={arrive}
                  align="end"
                  cancelled={cancelled}
                  dayMark={marker}
                />
              </div>
            ) : (
              <div aria-hidden className="flex justify-between">
                <Skeleton className="h-12 w-24" />
                <Skeleton className="h-12 w-24" />
              </div>
            )}
            {origin && dest ? (
              <div
                role="img"
                aria-label={
                  cancelled
                    ? "Flight cancelled"
                    : progress === null
                      ? `${origin.code} to ${dest.code}`
                      : `${Math.round(progress * 100)}% of the way from ${origin.code} to ${dest.code}`
                }
                className="relative mx-10 flex h-12 items-center"
              >
                <div
                  className={cn(
                    "h-2 w-full overflow-hidden rounded-full",
                    cancelled
                      ? "border border-dashed border-muted-foreground/50"
                      : "border border-border bg-transparent",
                  )}
                >
                  {!cancelled && (
                    <motion.div
                      className={cn(
                        "h-full w-full origin-left rounded-full",
                        state === "delayed"
                          ? "bg-orange-500 dark:bg-orange-400"
                          : state === "landed" || state === "arrived"
                            ? "bg-emerald-500 dark:bg-emerald-400"
                            : state === "diverted"
                              ? "bg-red-500 dark:bg-red-400"
                              : state === undefined
                                ? "bg-choice"
                                : "bg-sky-500 dark:bg-sky-400",
                      )}
                      initial={flies ? { scaleX: 0 } : false}
                      animate={{ scaleX: progress ?? 0 }}
                      transition={routeTransition}
                    />
                  )}
                </div>
                <span className="absolute top-1/2 left-0 size-2.5 -translate-y-1/2 rounded-full bg-foreground" />
                <span className="absolute top-1/2 right-0 size-2.5 -translate-y-1/2 rounded-full border-2 border-foreground bg-card" />
                {!cancelled && progress !== null && (
                  // A full-width layer moved by a share of its own width: a
                  // transform, so reduced motion skips the animation.
                  <motion.div
                    className="pointer-events-none absolute inset-0"
                    initial={flies ? { x: "0%" } : false}
                    animate={{ x: `${progress * 100}%` }}
                    transition={routeTransition}
                  >
                    <motion.span
                      className="absolute top-1/2 left-0 flex -translate-x-1/2 -translate-y-1/2 rounded-full bg-card p-0.5"
                      initial={flies ? { opacity: 0 } : false}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.4, ease: "easeOut" }}
                    >
                      <PlaneIcon
                        className="size-14 rotate-45"
                        strokeWidth={0.9}
                      />
                    </motion.span>
                  </motion.div>
                )}
              </div>
            ) : (
              <Skeleton className="h-2 w-full rounded-full" />
            )}
            {relative && (
              <p className={cn(genuiType.body, "text-center tabular-nums")}>
                {relative}
              </p>
            )}
            {flightMinutes !== null && (
              <p className="sr-only">{`Flight time ${formatDuration(flightMinutes)}`}</p>
            )}
          </div>

          {state === "diverted" && divertedTo && (
            <div className="border-t border-border px-3 py-3">
              <div className="rounded-[10px] border border-border bg-transparent p-1">
                <p className="flex items-center gap-3 rounded-md bg-orange-500/10 px-3 py-3 text-[13px] dark:bg-orange-400/10">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500/15 dark:bg-orange-400/15">
                    <TriangleAlertIcon
                      aria-hidden
                      className="size-4 shrink-0 text-orange-500 dark:text-orange-400"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    {`Diverted to ${divertedTo.city} (${divertedTo.code})`}
                  </span>
                </p>
              </div>
            </div>
          )}
          {delayReason && <p className="sr-only">{`Reason: ${delayReason}`}</p>}

          {facts.length > 0 && (
            <dl className="flex flex-wrap gap-x-10 gap-y-3 border-t border-border px-3 py-3">
              {facts.map((f) => (
                <motion.div
                  key={f.label}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className={
                    f.hidden ? "sr-only" : "flex min-w-0 flex-col gap-1"
                  }
                >
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    {f.icon && (
                      <f.icon aria-hidden className="size-3.5 shrink-0" />
                    )}
                    {f.spoken ? (
                      <>
                        <span aria-hidden>{f.label}</span>
                        <span className="sr-only">{f.spoken}</span>
                      </>
                    ) : (
                      f.label
                    )}
                  </dt>
                  <dd
                    className={cn(
                      genuiType.body,
                      "font-medium break-words tabular-nums",
                    )}
                  >
                    {f.value}
                  </dd>
                </motion.div>
              ))}
            </dl>
          )}

          {readyUpdates.length > 0 && ref && (
            <section aria-labelledby={`${titleId}-updates`} className="sr-only">
              <h4 id={`${titleId}-updates`}>{`Updates, ${ref.city} time`}</h4>
              <ol>
                {readyUpdates.map((u, i) => {
                  const t = toInstant(u.at, ref.timeZone)
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: updates have no id; texts may repeat
                    <li key={`${u.at}-${i}`}>
                      {t !== null && `${formatClock(t, ref.timeZone)}: `}
                      {u.text}
                    </li>
                  )
                })}
              </ol>
            </section>
          )}
        </div>

        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>

        <SurfaceFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            className={cn(
              genuiType.meta,
              "flex min-w-0 flex-wrap items-center gap-x-1.5",
            )}
          >
            {streaming ? (
              <ShimmeringText
                text="Loading flight status…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : (
              <>
                {asOfT !== null && ref && (
                  <span>
                    {`Updated ${formatClock(asOfT, ref.timeZone)}`}
                    <span className="sr-only">{` ${ref.city} time`}</span>
                  </span>
                )}
                {source?.label && (
                  <>
                    {asOfT !== null && <span aria-hidden>·</span>}
                    {href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-6 items-center rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {source.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span>{source.label}</span>
                    )}
                  </>
                )}
              </>
            )}
          </p>
          {(watch || status === "watching") && (
            <div aria-live="polite" className="sm:shrink-0">
              {status === "watching" ? (
                <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                  <CheckIcon aria-hidden className="size-4" />
                  We'll tell you about changes
                </p>
              ) : (
                <Button
                  size="sm"
                  disabled={busy}
                  className="w-full sm:w-auto"
                  onClick={() => {
                    if (busy || watching) return
                    setWatching(true)
                    onResult?.({ action: "watch" })
                  }}
                >
                  <BellIcon aria-hidden />
                  Notify me of changes
                  {flightNumber && (
                    <span className="sr-only">{` to ${flightNumber}`}</span>
                  )}
                </Button>
              )}
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
