"use client"

import * as React from "react"
import {
  CalendarIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardListIcon,
  CopyIcon,
  FileTextIcon,
  HashIcon,
  type LucideIcon,
  MapPinIcon,
  PhoneIcon,
  ShieldCheckIcon,
  StethoscopeIcon,
  VideoIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { CheckMark } from "@/components/genui/genui-motion"
import {
  FormField,
  formSelectClass,
  formTextareaClass,
} from "@/components/genui/form-field"

import {
  buildIcs,
  dayStrip,
  directionsUrl,
  earliestSlot,
  filterSlots,
  formatDate,
  formatSlot,
  formatSlotTime,
  icsFilename,
  insuranceText,
  isPlanAccepted,
  languagesText,
  opensBeforeText,
  parseDate,
  parseInstant,
  type StripDay,
  relativeDate,
  safeUrl,
  shortName,
  slotKey,
  telHref,
  timeZoneLabel,
  videoJoinWindow,
  wallClock,
} from "./doctor-appointment-utils"
import type {
  Appointment,
  AppointmentSlot,
  Clinic,
  DoctorAppointmentInput,
  DoctorAppointmentResult,
  Insurance,
  IntakeForm,
  Provider,
  VisitType,
} from "./doctor-appointment.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type DoctorAppointmentStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "booked"
  | "dismissed"
  | "done"
  | "cancel-requested"

type PartialProvider = Partial<Provider>
type ReadyProvider = PartialProvider & { id: string; name: string }
type ReadyVisit = Partial<VisitType> & { id: string; label: string }

export type DoctorAppointmentProps = Partial<
  Omit<
    DoctorAppointmentInput,
    | "clinic"
    | "providers"
    | "visitTypes"
    | "slots"
    | "insurance"
    | "forms"
    | "confirmation"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  clinic?: Partial<Clinic>
  providers?: PartialProvider[]
  visitTypes?: Partial<VisitType>[]
  slots?: Partial<AppointmentSlot>[]
  insurance?: Partial<Insurance>
  forms?: Partial<IntakeForm>[]
  confirmation?: Partial<Appointment>
  /**
   * The moment "In 3 days" and the video window are measured from. Defaults
   * to the viewer's clock, read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's decision itself.
   */
  status?: DoctorAppointmentStatus
  /**
   * Select mode: called once with book or dismiss. Book is a handoff: open
   * your booking flow. Confirmation mode: called once per action;
   * cancel-appointment only after the user confirms it.
   */
  onResult?: (result: DoctorAppointmentResult) => void
  /**
   * Results from history (the tool call's stored output, or several). Renders
   * the finished state and never calls onResult.
   */
  result?: DoctorAppointmentResult | DoctorAppointmentResult[]
  className?: string
}

type SelectDecision = Extract<
  DoctorAppointmentResult,
  { action: "book" | "dismiss" }
>
type BookDecision = Extract<DoctorAppointmentResult, { action: "book" }>
type ConfirmationAction =
  | "reschedule"
  | "add-to-calendar"
  | "cancel-appointment"

const SELECT_ACTIONS = new Set(["book", "dismiss"])
const ANY = "__any__"
const NO_PLAN = "__none__"
const NOTE_MAX = 300
/** Show the character count only when the note gets close to the limit. */
const NOTE_COUNT_FROM = NOTE_MAX - 50
const EMERGENCY_LINE = "Emergency? Call your local emergency number."

const BOOKING_STATE: Record<
  Appointment["bookingState"],
  { label: string; variant: "success" | "warning" | "destructive" }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  pending: { label: "Pending", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const CONFIRMATION_DONE: Record<ConfirmationAction, string> = {
  reschedule: "Asked to reschedule",
  "add-to-calendar": "Added to calendar",
  "cancel-appointment": "Cancellation requested",
}

const chipClass =
  "relative flex cursor-pointer border border-border bg-transparent transition-colors hover:bg-accent dark:hover:bg-white/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:bg-muted dark:has-[:disabled]:hover:bg-transparent"
const chipOn =
  "bg-background ring-2 ring-choice hover:bg-background dark:border-transparent dark:bg-accent dark:hover:bg-accent"
const linkClass =
  "inline-flex min-h-6 items-center gap-1 rounded-sm text-[13px] text-muted-foreground underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
const toggleClass = cn(
  genuiType.meta,
  "-mx-2.5 inline-flex min-h-8 items-center gap-1 self-start rounded-full px-2.5 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
)
const fade = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

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

/**
 * Whether the viewer's clock is on a different UTC offset than the clinic's
 * (read after mount, so server and client render the same markup). Times are
 * only labelled with their zone when it would change how they read.
 */
function useOtherZone(label: string | null, at: number | null) {
  const [other, setOther] = React.useState(false)
  React.useEffect(() => {
    const theirs = label ? (/\((GMT[^)]*)\)/.exec(label)?.[1] ?? null) : null
    const mine = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "shortOffset",
    })
      .formatToParts(at ?? Date.now())
      .find((p) => p.type === "timeZoneName")?.value
    // No offset in the label: say the zone, to be safe.
    setOther(
      Boolean(label) &&
        (!theirs || (mine === "GMT" ? "GMT+0" : mine) !== theirs),
    )
  }, [label, at])
  return other
}

function toResults(
  result: DoctorAppointmentProps["result"],
): DoctorAppointmentResult[] {
  if (result === undefined) return []
  return Array.isArray(result) ? result : [result]
}

/** A host-provided "ready" (or nothing) yields to the user's decision. */
function resolveStatus(
  local: DoctorAppointmentStatus | null,
  statusProp: DoctorAppointmentStatus | undefined,
): DoctorAppointmentStatus {
  return local && (statusProp === undefined || statusProp === "ready")
    ? local
    : (statusProp ?? "ready")
}

function readyProviders(providers: PartialProvider[]): ReadyProvider[] {
  return providers.filter(
    (p): p is ReadyProvider =>
      typeof p.id === "string" && typeof p.name === "string",
  )
}

function readyVisits(visitTypes: Partial<VisitType>[]): ReadyVisit[] {
  return visitTypes.filter(
    (v): v is ReadyVisit =>
      typeof v.id === "string" && typeof v.label === "string",
  )
}

function visitText(v: ReadyVisit) {
  return typeof v.durationMin === "number"
    ? `${v.label} · ${v.durationMin} min`
    : v.label
}

/** The provider's details, for the provider menu. */
function providerMeta(p: ReadyProvider) {
  return [
    p.specialty,
    p.gender,
    languagesText(p.languages),
    p.acceptingNew === false ? "Not accepting new patients" : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/**
 * "Tue 9:40 AM" when every day in the strip falls within a week (the weekday
 * is unambiguous), otherwise "Tue Oct 13 9:40 AM".
 */
function shortSlot(
  start: string,
  tz: string | undefined,
  strip: StripDay[],
  locale: string,
) {
  const w = wallClock(start, tz)
  if (!w) return start
  const first = parseDate(strip[0]?.date)
  const last = parseDate(strip[strip.length - 1]?.date)
  const withinWeek =
    first !== null && last !== null && last - first < 7 * 86_400_000
  return `${formatDate(w.date, withinWeek ? "weekday" : "short", locale)} ${formatSlotTime(start, tz, locale)}`
}

function downloadFile(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement("a")
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

// ---------------------------------------------------------------------------
// Shared pieces

function ExternalLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={className ?? linkClass}
    >
      {children}
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

function Header({
  clinic,
  fallback,
  streaming,
  titleId,
  showAddress,
}: {
  clinic?: Partial<Clinic>
  fallback: string
  streaming: boolean
  titleId: string
  showAddress: boolean
}) {
  return (
    <SurfaceHeader className="pb-3">
      <SurfaceTitle id={titleId}>
        {clinic?.name ?? (streaming ? undefined : fallback)}
      </SurfaceTitle>
      {showAddress && clinic?.address && (
        <p className={genuiType.meta}>{clinic.address}</p>
      )}
    </SurfaceHeader>
  )
}

/** The static safety line. Always shown; never replaced by the agent. */
function EmergencyLine() {
  return (
    <p className={cn(genuiType.meta, "border-t border-border px-3 py-3")}>
      {EMERGENCY_LINE}
    </p>
  )
}

function Row({
  label,
  icon: Icon,
  children,
}: {
  label: string
  icon: LucideIcon
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 py-2.5">
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className="font-medium">{children}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entry

export function DoctorAppointment(props: DoctorAppointmentProps) {
  if (props.mode === "confirmation") return <ConfirmationView {...props} />
  return <SelectView {...props} />
}

// ---------------------------------------------------------------------------
// Select mode

function SelectView({
  clinic,
  providers = [],
  visitTypes = [],
  slots = [],
  insurance,
  reasons,
  status: statusProp,
  onResult,
  result,
  className,
}: DoctorAppointmentProps) {
  const locale = useGenUILocale()
  const restored = toResults(result).find((r) =>
    SELECT_ACTIONS.has(r.action),
  ) as SelectDecision | undefined
  const bookedInit = restored?.action === "book" ? restored : null

  const [decision, setDecision] = React.useState<SelectDecision | null>(
    restored ?? null,
  )
  const [providerChoice, setProviderChoice] = React.useState<string | null>(
    bookedInit?.providerId ?? null,
  )
  const [visitChoice, setVisitChoice] = React.useState<string | null>(
    bookedInit?.visitTypeId ?? null,
  )
  const [dayChoice, setDayChoice] = React.useState<string | null>(null)
  const [slotChoice, setSlotChoice] = React.useState<{
    providerId: string
    start: string
  } | null>(() =>
    bookedInit
      ? { providerId: bookedInit.providerId, start: bookedInit.start }
      : null,
  )
  // undefined: not touched yet, so the agent's `insurance.selected` applies.
  const [planChoice, setPlanChoice] = React.useState<string | null | undefined>(
    bookedInit ? (bookedInit.insurance ?? null) : undefined,
  )
  const [reason, setReason] = React.useState<string | null>(
    bookedInit?.reason ?? null,
  )
  const [note, setNote] = React.useState(bookedInit?.note ?? "")
  const [extrasOpen, setExtrasOpen] = React.useState(false)
  const uid = React.useId()
  const titleId = `${uid}-title`

  const local: DoctorAppointmentStatus | null = decision
    ? decision.action === "book"
      ? "booked"
      : "dismissed"
    : null
  const status = resolveStatus(local, statusProp)
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const locked = status !== "ready" && status !== "streaming"

  const tz = clinic?.timeZone
  const people = readyProviders(providers)
  const visits = readyVisits(visitTypes)
  const order = people.map((p) => p.id)
  const providerIds = new Set(order)
  const visitIds = new Set(visits.map((v) => v.id))
  // Only complete slots for known providers and visit types.
  const ready = slots.filter(
    (s): s is AppointmentSlot =>
      typeof s.providerId === "string" &&
      typeof s.visitTypeId === "string" &&
      typeof s.start === "string" &&
      parseInstant(s.start) !== null &&
      providerIds.has(s.providerId) &&
      visitIds.has(s.visitTypeId),
  )

  const providerValue =
    providerChoice &&
    (providerChoice === ANY || providerIds.has(providerChoice))
      ? providerChoice
      : people.length === 1 && !streaming
        ? people[0].id
        : ANY
  const providerFilter = providerValue === ANY ? null : providerValue
  const visitTypeId =
    visitChoice && visitIds.has(visitChoice)
      ? visitChoice
      : (visits[0]?.id ?? null)
  const visit = visits.find((v) => v.id === visitTypeId)
  const filter = { providerId: providerFilter, visitTypeId }

  const strip = dayStrip(ready, filter, tz)
  const currentDay =
    strip.find((d) => d.date === dayChoice && d.count > 0) ??
    strip.find((d) => d.count > 0) ??
    strip[0]
  const daySlots = currentDay
    ? filterSlots(ready, { ...filter, date: currentDay.date }, tz, order)
    : []
  const chosen = slotChoice
    ? daySlots.find(
        (s) =>
          s.providerId === slotChoice.providerId &&
          s.start === slotChoice.start,
      )
    : undefined
  const chosenProvider = chosen
    ? people.find((p) => p.id === chosen.providerId)
    : undefined
  const chosenWall = chosen ? wallClock(chosen.start, tz) : null
  const earliest = earliestSlot(ready, filter, null, order)
  const earliestProvider = earliest
    ? people.find((p) => p.id === earliest.providerId)
    : undefined
  const zoneAt = daySlots[0]?.start ?? ready[0]?.start
  const zone = timeZoneLabel(tz, zoneAt)
  const showZone = useOtherZone(zone, parseInstant(zoneAt))

  const accepted = insurance?.accepted?.filter(Boolean) ?? []
  const plan =
    planChoice === undefined ? (insurance?.selected ?? null) : planChoice
  const planState = insuranceText(accepted, plan)
  // One quiet line: the copay when covered, else what not being covered means.
  const planNote =
    planState.kind === "accepted"
      ? insurance?.coverageNote
      : "You may pay out of pocket."
  const planItems = [
    ...(plan && !isPlanAccepted(accepted, plan)
      ? [{ value: plan, label: `${plan} (not listed)` }]
      : []),
    ...accepted.map((a) => ({ value: a, label: a })),
    { value: NO_PLAN, label: "Not listed, or no insurance" },
  ]
  const reasonOptions = reasons?.filter(Boolean) ?? []
  const providerItems = [
    ...(people.length > 1 || streaming
      ? [{ value: ANY, label: "Any provider" }]
      : []),
    ...people.map((p) => ({ value: p.id, label: p.name })),
  ]

  const canBook = !busy && !locked && !!chosen && !!visitTypeId

  const pickSlot = (s: AppointmentSlot) => {
    const w = wallClock(s.start, tz)
    if (w) setDayChoice(w.date)
    setSlotChoice({ providerId: s.providerId, start: s.start })
  }
  const book = () => {
    if (!canBook || !chosen || !visitTypeId) return
    const r: BookDecision = {
      action: "book",
      providerId: chosen.providerId,
      visitTypeId,
      start: chosen.start,
      ...(plan ? { insurance: plan } : {}),
      ...(reason ? { reason } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    }
    setDecision(r)
    onResult?.(r)
  }
  const dismiss = () => {
    if (busy || locked) return
    const r: SelectDecision = { action: "dismiss" }
    setDecision(r)
    onResult?.(r)
  }

  const booked = decision?.action === "book" ? decision : null
  const bookedProvider = booked
    ? people.find((p) => p.id === booked.providerId)
    : undefined
  const bookedVisit = booked
    ? visits.find((v) => v.id === booked.visitTypeId)
    : undefined
  const finished = status === "booked" || status === "dismissed"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="doctor-appointment"
        data-status={status}
        data-mode="select"
        aria-busy={busy}
        aria-labelledby={clinic?.name || !streaming ? titleId : undefined}
        aria-label={
          clinic?.name || !streaming ? undefined : "Appointment booking"
        }
        className={className}
      >
        <Header
          clinic={clinic}
          fallback="Book an appointment"
          streaming={streaming}
          titleId={titleId}
          showAddress
        />

        <AutoHeight>
          <div className="flex flex-col">
            {booked ? (
              // What went to the booking flow. Reason and note stay out of it.
              <dl className="flex flex-col divide-y divide-border border-t border-border px-3 text-[13px]">
                <Row label="Provider" icon={StethoscopeIcon}>
                  {bookedProvider?.name ?? booked.providerId}
                </Row>
                <Row label="Visit" icon={ClipboardListIcon}>
                  {bookedVisit ? visitText(bookedVisit) : booked.visitTypeId}
                </Row>
                <Row label="When" icon={CalendarIcon}>
                  <span className="font-medium" suppressHydrationWarning>
                    {formatSlot(booked.start, tz, locale)}
                  </span>
                </Row>
                {booked.insurance && (
                  <Row label="Insurance" icon={ShieldCheckIcon}>
                    {booked.insurance}
                  </Row>
                )}
              </dl>
            ) : finished ? null : (
              <>
                {/* Filters: provider, visit type, and a jump to the earliest time. */}
                <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-3">
                  {providerItems.length > 1 ? (
                    <Select
                      value={providerValue}
                      onValueChange={(v) => {
                        if (typeof v === "string") setProviderChoice(v)
                      }}
                      items={providerItems}
                      disabled={locked}
                    >
                      <SelectTrigger
                        aria-label="Provider"
                        className="max-w-full"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false} align="start">
                        {providerItems.map((item) => {
                          const p = people.find((x) => x.id === item.value)
                          const meta = p ? providerMeta(p) : ""
                          return (
                            <SelectItem key={item.value} value={item.value}>
                              <span className="flex min-w-0 flex-col whitespace-normal">
                                <span>{item.label}</span>
                                {meta && (
                                  <span className={genuiType.meta}>{meta}</span>
                                )}
                              </span>
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  ) : people[0] ? (
                    <span className="text-[13px] font-medium">
                      {people[0].name}
                      {providerMeta(people[0]) && (
                        <span className="sr-only">{`, ${providerMeta(people[0])}`}</span>
                      )}
                    </span>
                  ) : (
                    streaming && <Skeleton className="h-8 w-40" />
                  )}

                  {visits.length > 0 ? (
                    <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
                      <legend className="sr-only">Visit type</legend>
                      {visits.map((v) => {
                        const on = visitTypeId === v.id
                        return (
                          <label
                            key={v.id}
                            className={cn(
                              chipClass,
                              "h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px]",
                              on && chipOn,
                            )}
                          >
                            <input
                              type="radio"
                              name={`${uid}-visit`}
                              value={v.id}
                              checked={on}
                              disabled={locked}
                              onChange={() => setVisitChoice(v.id)}
                              className="sr-only"
                            />
                            {v.label}
                            {typeof v.durationMin === "number" && (
                              <span className={genuiType.meta}>
                                {`${v.durationMin} min`}
                              </span>
                            )}
                          </label>
                        )
                      })}
                    </fieldset>
                  ) : (
                    streaming && <Skeleton className="h-8 w-40" />
                  )}

                  {earliest && earliestProvider && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={locked || busy}
                      onClick={() => pickSlot(earliest)}
                      className="sm:ml-auto"
                    >
                      <span suppressHydrationWarning>
                        {`Earliest: ${shortSlot(earliest.start, tz, strip, locale)}${providerFilter === null ? ` with ${shortName(earliestProvider.name)}` : ""}`}
                      </span>
                    </Button>
                  )}
                </div>

                {/* Day and time */}
                <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
                  <fieldset className="m-0 min-w-0 border-0 p-0">
                    <legend className="sr-only">Day</legend>
                    <FadeRow wrapperClassName="-mx-3 -my-1" className="flex gap-2 px-3 py-1 [scrollbar-width:thin]">
                      {strip.map((day) => {
                        const on =
                          currentDay?.date === day.date && day.count > 0
                        return (
                          <motion.label
                            key={day.date}
                            {...fade}
                            className={cn(
                              chipClass,
                              "min-w-16 shrink-0 flex-col items-center gap-0.5 rounded-[10px] px-3 py-2.5 text-center",
                              on && chipOn,
                            )}
                          >
                            <input
                              type="radio"
                              name={`${uid}-day`}
                              value={day.date}
                              checked={on}
                              disabled={day.count === 0 || locked}
                              onChange={() => setDayChoice(day.date)}
                              className="sr-only"
                            />
                            <span
                              className={genuiType.label}
                              suppressHydrationWarning
                            >
                              {formatDate(day.date, "weekday", locale)}
                            </span>
                            <span
                              className={cn(
                                "text-[13px] font-medium whitespace-nowrap",
                                day.count === 0 && "line-through",
                              )}
                              suppressHydrationWarning
                            >
                              {formatDate(day.date, "day", locale)}
                            </span>
                            {day.count === 0 && (
                              <span className="sr-only">No times</span>
                            )}
                          </motion.label>
                        )
                      })}
                      {streaming &&
                        Array.from({ length: strip.length ? 1 : 4 }, (_, i) => (
                          <Skeleton
                            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                            key={i}
                            className="h-14 w-16 shrink-0 rounded-[10px]"
                          />
                        ))}
                    </FadeRow>
                  </fieldset>

                  {currentDay && daySlots.length > 0 ? (
                    <fieldset className="m-0 min-w-0 border-0 p-0">
                      <legend className="sr-only" suppressHydrationWarning>
                        {`Times on ${formatDate(currentDay.date, "long", locale)}${zone ? `, ${zone}` : ""}`}
                      </legend>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {daySlots.map((s) => {
                          const on =
                            chosen?.providerId === s.providerId &&
                            chosen.start === s.start
                          const who =
                            providerFilter === null
                              ? people.find((p) => p.id === s.providerId)
                              : undefined
                          return (
                            <motion.label
                              key={slotKey(s)}
                              {...fade}
                              className={cn(
                                chipClass,
                                "min-h-10 flex-col items-center justify-center rounded-lg px-2 py-1.5 text-center",
                                on && chipOn,
                              )}
                            >
                              <input
                                type="radio"
                                name={`${uid}-time`}
                                value={slotKey(s)}
                                checked={on}
                                disabled={locked}
                                onChange={() => pickSlot(s)}
                                className="sr-only"
                              />
                              <span
                                className="text-[13px] font-medium tabular-nums"
                                suppressHydrationWarning
                              >
                                {formatSlotTime(s.start, tz, locale)}
                              </span>
                              {who && (
                                <span className={genuiType.meta}>
                                  {shortName(who.name)}
                                </span>
                              )}
                            </motion.label>
                          )
                        })}
                      </div>
                    </fieldset>
                  ) : streaming ? (
                    <div
                      aria-hidden
                      className="grid grid-cols-3 gap-2 sm:grid-cols-4"
                    >
                      {Array.from({ length: 4 }, (_, i) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                        <Skeleton key={i} className="h-11 rounded-lg" />
                      ))}
                    </div>
                  ) : (
                    <p className={genuiType.meta}>
                      {ready.length > 0 ? "No times match" : "No open times"}
                    </p>
                  )}
                  {showZone && zone && (
                    <p className={genuiType.meta} suppressHydrationWarning>
                      {`Times in ${zone}`}
                    </p>
                  )}
                </div>

                {/* Insurance */}
                {insurance?.accepted && (
                  <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
                    {/* A plan is always chosen ("Not listed" at least), so the label sits up. */}
                    <FormField
                      htmlFor={`${uid}-plan-trigger`}
                      labelId={`${uid}-plan`}
                      label="Insurance"
                      filled
                    >
                      <Select
                        value={plan ?? NO_PLAN}
                        onValueChange={(v) =>
                          setPlanChoice(
                            typeof v === "string" && v !== NO_PLAN ? v : null,
                          )
                        }
                        items={planItems}
                        disabled={locked}
                      >
                        <SelectTrigger
                          id={`${uid}-plan-trigger`}
                          aria-labelledby={`${uid}-plan`}
                          aria-describedby={`${uid}-plan-note`}
                          className={formSelectClass}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {planItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4">
                      {planState.kind !== "none" && (
                        <span
                          aria-hidden
                          className="inline-flex items-center gap-1 text-[13px] font-medium"
                        >
                          {planState.kind === "accepted" ? (
                            <>
                              <CheckMark className="size-4 shrink-0" />
                              Accepted
                            </>
                          ) : (
                            "Not listed"
                          )}
                        </span>
                      )}
                      <div id={`${uid}-plan-note`}>
                        <p aria-live="polite" className="sr-only">
                          {planState.text}
                        </p>
                        {planNote && (
                          <p
                            // Already in the announced sentence, unless it's the copay.
                            aria-hidden={
                              planState.kind !== "accepted" || undefined
                            }
                            className={genuiType.meta}
                          >
                            {planNote}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Reason and note: optional health details, folded away. */}
                <section
                  aria-labelledby={`${uid}-extras-toggle`}
                  className="flex flex-col gap-3 border-t border-border px-3 py-3"
                >
                  <button
                    id={`${uid}-extras-toggle`}
                    type="button"
                    aria-expanded={extrasOpen}
                    aria-controls={`${uid}-extras`}
                    onClick={() => setExtrasOpen((v) => !v)}
                    className={toggleClass}
                  >
                    {reason || note.trim()
                      ? reasonOptions.length > 0
                        ? "Edit reason or note"
                        : "Edit note"
                      : reasonOptions.length > 0
                        ? "Add a reason or note"
                        : "Add a note"}
                    <ChevronDownIcon
                      aria-hidden
                      className={cn(
                        "size-3.5 transition-transform",
                        extrasOpen && "rotate-180",
                      )}
                    />
                  </button>
                  <div
                    id={`${uid}-extras`}
                    hidden={!extrasOpen}
                    className="flex flex-col gap-3"
                  >
                    <p id={`${uid}-privacy`} className="sr-only">
                      Optional. Sent to the clinic with the booking request
                      only, and never shown in the summary.
                    </p>
                    {reasonOptions.length > 0 && (
                      <fieldset
                        aria-describedby={`${uid}-privacy`}
                        className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
                      >
                        <legend className={cn(genuiType.label, "mb-1.5")}>
                          Reason
                        </legend>
                        <div className="flex flex-wrap gap-2">
                          {reasonOptions.map((r) => {
                            const on = reason === r
                            return (
                              <button
                                key={r}
                                type="button"
                                aria-pressed={on}
                                disabled={locked}
                                onClick={() => setReason(on ? null : r)}
                                className={cn(
                                  "inline-flex h-8 items-center rounded-full border border-border bg-transparent px-3.5 text-[13px] transition-colors outline-none hover:bg-foreground/10 dark:hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
                                  on && chipOn,
                                )}
                              >
                                {r}
                              </button>
                            )
                          })}
                        </div>
                      </fieldset>
                    )}
                    <FormField
                      htmlFor={`${uid}-note`}
                      label="Note for the clinic"
                      pinned
                    >
                      <Textarea
                        id={`${uid}-note`}
                        value={note}
                        maxLength={NOTE_MAX}
                        disabled={locked}
                        aria-describedby={`${uid}-note-count ${uid}-privacy`}
                        onChange={(e) =>
                          setNote(e.target.value.slice(0, NOTE_MAX))
                        }
                        className={formTextareaClass}
                      />
                      {/* The counter sits in the box's top right, level with the label. */}
                      <span
                        id={`${uid}-note-count`}
                        className={cn(
                          "pointer-events-none absolute top-2 right-4 text-[12px] leading-4 tabular-nums text-muted-foreground",
                          note.length < NOTE_COUNT_FROM && "sr-only",
                        )}
                      >
                        <span aria-hidden className="inline-flex">
                          <SlidingNumber
                            number={note.length}
                            initiallyStable
                          />
                          {`/${NOTE_MAX}`}
                        </span>
                        <span className="sr-only">{`${NOTE_MAX - note.length} characters left`}</span>
                      </span>
                    </FormField>
                  </div>
                </section>

                {/* The chosen time: the answer, big. */}
                <div aria-live="polite">
                  {chosen && chosenWall && (
                    <motion.div
                      {...fade}
                      className="flex flex-col gap-1.5 border-t border-border px-3 py-3"
                    >
                      <span className={genuiType.stat} suppressHydrationWarning>
                        {formatSlotTime(chosen.start, tz, locale)}
                      </span>
                      <span className={genuiType.meta} suppressHydrationWarning>
                        {[
                          formatDate(chosenWall.date, "short", locale),
                          chosenProvider
                            ? shortName(chosenProvider.name)
                            : null,
                          visit ? visitText(visit) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </motion.div>
                  )}
                </div>
              </>
            )}

            <EmergencyLine />
          </div>
        </AutoHeight>

        <SurfaceFooter aria-live="polite">
          {streaming ? (
            <ShimmeringText
              text="Checking availability…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px]"
            />
          ) : status === "booked" ? (
            <p className="flex items-center gap-1.5 text-[13px]">
              <CheckIcon aria-hidden className="size-4 shrink-0" />
              Sent. Not booked until the clinic confirms.
            </p>
          ) : status === "dismissed" ? (
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <XIcon aria-hidden className="size-4 shrink-0" />
              Nothing was booked.
            </p>
          ) : (
            <>
              <p className={cn(genuiType.meta, "min-w-0")}>
                {status === "submitting"
                  ? "Sending…"
                  : chosen
                    ? null
                    : "Pick a time"}
              </p>
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
                  when={!busy && !locked && !canBook}
                  reason={
                    !chosen ? "Pick a time first" : "Pick a visit type first"
                  }
                >
                  <Button size="sm" disabled={!canBook} onClick={book}>
                    {status === "submitting" ? "Sending…" : "Book appointment"}
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
  clinic,
  providers = [],
  visitTypes = [],
  forms = [],
  confirmation,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: DoctorAppointmentProps) {
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
  const [tick, setTick] = React.useState<number | null>(null)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelButton = React.useRef<HTMLButtonElement>(null)
  const refocusCancel = React.useRef(false)
  const uid = React.useId()
  const titleId = `${uid}-title`

  const local: DoctorAppointmentStatus | null = done.has("cancel-appointment")
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
  const now = fixedNow ?? tick ?? mountedNow

  const c = confirmation ?? {}
  const tz = clinic?.timeZone
  const provider = readyProviders(providers).find((p) => p.id === c.providerId)
  const visit = readyVisits(visitTypes).find((v) => v.id === c.visitTypeId)
  const bookingState = c.bookingState
  const cancelled = bookingState === "cancelled"
  const wall = wallClock(c.start, tz)
  const zone = c.start ? timeZoneLabel(tz, c.start) : null
  const showZone = useOtherZone(zone, parseInstant(c.start))
  const relative =
    !streaming && !cancelled ? relativeDate(c.start, tz, now) : null
  const video = safeUrl(c.videoUrl)
  const join = videoJoinWindow(
    c.start,
    {
      durationMin: visit?.durationMin,
      opensMinutesBefore: c.checkInOpensMinutesBefore,
    },
    now,
  )
  const location = c.location ?? (video ? undefined : clinic?.address)
  const tel = telHref(clinic?.phone)
  const readyForms = forms
    .map((f) => ({ label: f.label, href: safeUrl(f.url) }))
    .filter((f): f is { label: string; href: string } =>
      Boolean(f.label && f.href),
    )

  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )
  // Return focus to "Cancel appointment" when the confirm step closes.
  React.useEffect(() => {
    if (!confirmingCancel && refocusCancel.current) {
      refocusCancel.current = false
      cancelButton.current?.focus()
    }
  }, [confirmingCancel])
  // Turn the video link on when its window opens (live clock only).
  const opensAt = join.state === "before" ? join.opensAt : null
  React.useEffect(() => {
    if (fixedNow !== null || opensAt === null) return
    const delay = opensAt - Date.now()
    if (delay > 86_400_000) return
    const t = window.setTimeout(
      () => setTick(Date.now()),
      Math.max(0, delay) + 50,
    )
    return () => window.clearTimeout(t)
  }, [fixedNow, opensAt])

  const fire = (action: ConfirmationAction) => {
    if (busy || locked || done.has(action)) return
    setDone((prev) => new Set(prev).add(action))
    onResult?.({ action })
  }
  const addToCalendar = () => {
    if (busy || locked || !c.start) return
    // Provider and clinic only: calendars are often shared, so no specialty or reason.
    const ics = buildIcs({
      uid: `${c.number ?? c.start}@genui-doctor-appointment`,
      title: [
        `Appointment with ${provider?.name ?? "your provider"}`,
        clinic?.name,
      ]
        .filter(Boolean)
        .join(", "),
      start: c.start,
      durationMin: visit?.durationMin,
      location: location ?? (video ? "Video visit" : undefined),
      description: [
        visit ? `${visit.label} visit.` : null,
        c.number ? `Confirmation ${c.number}.` : null,
        clinic?.phone ? `Clinic: ${clinic.phone}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      url: video ?? undefined,
      stamp: Date.now(),
    })
    if (!ics) return
    downloadFile(icsFilename(c.start, tz), ics, "text/calendar;charset=utf-8")
    fire("add-to-calendar")
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

  const calendarUsed = done.has("add-to-calendar")
  const lead: ConfirmationAction | null = cancelled ? null : "reschedule"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="doctor-appointment"
        data-status={status}
        data-mode="confirmation"
        aria-busy={busy}
        aria-labelledby={clinic?.name || !streaming ? titleId : undefined}
        aria-label={clinic?.name || !streaming ? undefined : "Appointment"}
        className={className}
      >
        <Header
          clinic={clinic}
          fallback="Your appointment"
          streaming={streaming}
          titleId={titleId}
          showAddress={false}
        />

        <AutoHeight>
          <div className="flex flex-col">
            {/* When: the answer, big. */}
            <div className="flex items-start justify-between gap-3 border-t border-border px-3 py-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                {wall && c.start ? (
                  <>
                    <p className="text-[13px]" suppressHydrationWarning>
                      <span className="font-medium">
                        {formatDate(wall.date, "long", locale)}
                      </span>
                      {(relative || (showZone && zone)) && (
                        <span className="text-muted-foreground">
                          {` · ${[
                            relative,
                            showZone && zone
                              ? zone.replace(/^clinic/, "Clinic")
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}`}
                        </span>
                      )}
                    </p>
                    <span
                      className={cn(
                        genuiType.stat,
                        cancelled && "text-muted-foreground line-through",
                      )}
                      suppressHydrationWarning
                    >
                      {formatSlotTime(c.start, tz, locale)}
                    </span>
                    {zone && <span className="sr-only">{zone}</span>}
                  </>
                ) : (
                  <>
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-8 w-28" />
                  </>
                )}
                {provider || visit ? (
                  <p className={genuiType.body}>
                    {[provider?.name, visit ? visitText(visit) : null]
                      .filter(Boolean)
                      .join(" · ")}
                    {provider?.specialty && (
                      <span className="sr-only">{`, ${provider.specialty}`}</span>
                    )}
                  </p>
                ) : (
                  streaming && <Skeleton className="h-4 w-48" />
                )}
              </div>
              {bookingState && (
                <Badge
                  variant={BOOKING_STATE[bookingState].variant}
                  className="shrink-0"
                >
                  {BOOKING_STATE[bookingState].label}
                </Badge>
              )}
            </div>

            {video && !cancelled && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-3 py-3">
                {join.state === "open" ? (
                  <ExternalLink
                    href={video}
                    className={buttonVariants({ size: "sm" })}
                  >
                    <VideoIcon aria-hidden />
                    Join video visit
                  </ExternalLink>
                ) : (
                  <Button
                    size="sm"
                    disabled
                    aria-describedby={`${uid}-join-note`}
                  >
                    <VideoIcon aria-hidden />
                    Join video visit
                  </Button>
                )}
                {join.state !== "open" && (
                  <span
                    id={`${uid}-join-note`}
                    className={genuiType.meta}
                    suppressHydrationWarning
                  >
                    {join.state === "ended"
                      ? "This visit has ended"
                      : typeof c.checkInOpensMinutesBefore === "number"
                        ? opensBeforeText(c.checkInOpensMinutesBefore)
                        : "Opens at the visit time"}
                  </span>
                )}
              </div>
            )}

            <dl className="grid gap-x-10 gap-y-3 border-t border-border px-3 py-3 sm:grid-cols-2">
              {location && (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <MapPinIcon aria-hidden className="size-3.5 shrink-0" />
                    Location
                  </dt>
                  <dd className="flex flex-col items-start gap-0.5">
                    <address className={cn(genuiType.body, "not-italic")}>
                      {location}
                    </address>
                    <ExternalLink href={directionsUrl(location)}>
                      Directions
                    </ExternalLink>
                  </dd>
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt
                  className={cn(genuiType.label, "flex items-center gap-1.5")}
                >
                  <HashIcon aria-hidden className="size-3.5 shrink-0" />
                  Confirmation
                </dt>
                <dd>
                  {c.number ? (
                    <span className="-my-1 flex items-center gap-1">
                      <span className="font-mono text-[13px] break-all">
                        {c.number}
                      </span>
                      <IconTip
                        label={copied ? "Copied" : "Copy confirmation number"}
                      >
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Copy confirmation number ${c.number}`}
                          onClick={copy}
                        >
                          {copied ? <CheckIcon /> : <CopyIcon />}
                        </Button>
                      </IconTip>
                    </span>
                  ) : (
                    <Skeleton className="mt-1 h-4 w-24" />
                  )}
                </dd>
              </div>
              {readyForms.length > 0 && !cancelled && (
                <div className="flex min-w-0 flex-col gap-0.5 sm:col-span-2">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <FileTextIcon aria-hidden className="size-3.5 shrink-0" />
                    Forms
                  </dt>
                  <dd>
                    <ul className="flex flex-wrap gap-x-4">
                      {readyForms.map((f) => (
                        <motion.li key={f.href} {...fade}>
                          <ExternalLink href={f.href}>{f.label}</ExternalLink>
                        </motion.li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
            </dl>

            <EmergencyLine />
          </div>
        </AutoHeight>

        <SurfaceFooter className="flex-col items-stretch gap-2">
          <div
            aria-live="polite"
            className={cn("flex flex-col gap-1", done.size === 0 && "sr-only")}
          >
            {copied && <p className="sr-only">Confirmation number copied</p>}
            {[...done].map((a) => (
              <p key={a} className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {CONFIRMATION_DONE[a]}
              </p>
            ))}
          </div>

          {confirmingCancel && !locked ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px]">Cancel this appointment?</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" autoFocus onClick={keep}>
                  Keep appointment
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingCancel(false)
                    fire("cancel-appointment")
                  }}
                >
                  Cancel appointment
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                {streaming ? (
                  <ShimmeringText
                    text="Loading appointment…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                    className="text-[13px]"
                  />
                ) : status === "submitting" ? (
                  <p className={genuiType.meta}>Sending…</p>
                ) : null}
              </div>
              {(lead || tel) && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {!cancelled && (
                    <WhyDisabled
                      reason={
                        !busy && !locked && !c.start
                          ? "No start time yet"
                          : undefined
                      }
                    >
                      <IconTip label="Add to calendar">
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label={`Add to calendar${calendarUsed ? " (done)" : ""}`}
                          // The calendar file can be saved again; the others send once.
                          disabled={busy || locked || !c.start}
                          onClick={addToCalendar}
                        >
                          {calendarUsed ? <CheckIcon /> : <CalendarPlusIcon />}
                        </Button>
                      </IconTip>
                    </WhyDisabled>
                  )}
                  {tel && (
                    <IconTip label="Call clinic">
                      <a
                        href={tel}
                        aria-label={`Call ${clinic?.name ?? "the clinic"}, ${clinic?.phone}`}
                        className={cn(
                          buttonVariants({
                            variant: "outline",
                            size: "icon-sm",
                          }),
                          busy && "pointer-events-none opacity-50",
                        )}
                      >
                        <PhoneIcon aria-hidden />
                      </a>
                    </IconTip>
                  )}
                  {!cancelled && (
                    <Button
                      ref={cancelButton}
                      size="sm"
                      variant={lead ? "secondary" : "default"}
                      disabled={
                        busy ||
                        locked ||
                        done.has("cancel-appointment") ||
                        !c.start
                      }
                      onClick={() => setConfirmingCancel(true)}
                    >
                      {done.has("cancel-appointment") && (
                        <CheckIcon aria-hidden />
                      )}
                      Cancel appointment
                      {done.has("cancel-appointment") && (
                        <span className="sr-only"> (done)</span>
                      )}
                    </Button>
                  )}
                  {lead && (
                    <Button
                      size="sm"
                      disabled={busy || locked || done.has(lead) || !c.start}
                      onClick={() => fire(lead)}
                    >
                      {done.has(lead) && <CheckIcon aria-hidden />}
                      Reschedule
                      {done.has(lead) && (
                        <span className="sr-only"> (done)</span>
                      )}
                    </Button>
                  )}
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

/** A horizontal scroller wrapped with edge fades. */
function FadeRow({
  as: Tag = "div",
  wrapperClassName,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "ref"> & {
  as?: React.ElementType
  wrapperClassName?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(ref)
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Tag ref={ref} className={cn("overflow-x-auto", className)} {...props}>
        {children}
      </Tag>
      <ScrollFades edges={edges} />
    </div>
  )
}
