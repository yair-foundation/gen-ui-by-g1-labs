"use client"

import * as React from "react"
import {
  CalendarPlusIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  HashIcon,
  MapPinIcon,
  PhoneIcon,
  StarIcon,
  UserIcon,
  WalletIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
  type ConfirmationAction,
  type StripDay,
  type TriageAnswers,
  type VisitWindow as UtilWindow,
  addressSummary,
  answerText,
  buildDayStrip,
  cleanAnswers,
  defaultActions,
  etaParts,
  findWindow,
  formatDate,
  formatMoney,
  formatRange,
  formatRating,
  formatTimeZone,
  pricingLines,
  summaryLine,
  unitText,
  validateTriage,
  windowFeeText,
} from "./service-visit-utils"
import type {
  ServiceVisitInput,
  ServiceVisitResult,
  TriageQuestion,
  VisitAddress,
  VisitConfirmation,
  VisitPricing,
  VisitProvider,
  VisitService,
  VisitTechnician,
  VisitWindow,
} from "./service-visit.schema"
import {
  FormField,
  FormFieldGroup,
  formInputClass,
  formPrimaryClass,
  formSelectClass,
  formTextareaClass,
} from "@/components/genui/form-field"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type ServiceVisitStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "requested"
  | "dismissed"
  | "cancel-requested"
  | "done"

type PartialDay = { date?: string; slots?: Partial<VisitWindow>[] }

export type ServiceVisitProps = Partial<
  Omit<
    ServiceVisitInput,
    | "provider"
    | "service"
    | "issue"
    | "address"
    | "windows"
    | "pricing"
    | "photos"
    | "confirmation"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  provider?: Partial<Omit<VisitProvider, "rating">> & {
    rating?: Partial<NonNullable<VisitProvider["rating"]>>
  }
  service?: Partial<VisitService>
  issue?: { summary?: string; questions?: Partial<TriageQuestion>[] }
  address?: Partial<VisitAddress>
  windows?: PartialDay[]
  pricing?: Partial<Omit<VisitPricing, "estimate">> & {
    estimate?: Partial<NonNullable<VisitPricing["estimate"]>>
  }
  photos?: { allowed?: boolean; max?: number }
  confirmation?: Partial<Omit<VisitConfirmation, "technician">> & {
    technician?: Partial<VisitTechnician>
  }
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's decision itself.
   */
  status?: ServiceVisitStatus
  /**
   * Host-provided. Receives the attached photos on request, before onResult.
   * File objects can't go to the agent: upload them to the provider here. The
   * result only carries `photoCount`.
   */
  onFiles?: (files: File[]) => void
  /**
   * Select mode: called once with request or dismiss. Request is a handoff:
   * send it to the provider. Confirmation mode: called once per action;
   * cancel-visit only after the user confirms it.
   */
  onResult?: (result: ServiceVisitResult) => void
  /**
   * Results from history (the tool call's stored output, or several). Renders
   * the finished state and never calls onResult.
   */
  result?: ServiceVisitResult | ServiceVisitResult[]
  className?: string
}

type RequestDecision = Extract<ServiceVisitResult, { action: "request" }>
type SelectDecision = Extract<
  ServiceVisitResult,
  { action: "request" | "dismiss" }
>
type ReadyQuestion = TriageQuestion

const SELECT_ACTIONS = new Set(["request", "dismiss"])
const SUMMARY_MAX = 500
const NOTES_MAX = 300
const PHOTO_MAX_DEFAULT = 4
const PHOTO_MAX_MB = 10

const BOOKING_STATE: Record<
  VisitConfirmation["bookingState"],
  {
    label: string
    variant: "success" | "warning" | "info" | "destructive" | "outline"
  }
> = {
  confirmed: { label: "Confirmed", variant: "success" },
  "technician-assigned": { label: "Technician assigned", variant: "info" },
  pending: { label: "Pending", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
}

const ACTION_LABEL: Record<ConfirmationAction, string> = {
  reschedule: "Reschedule",
  "add-to-calendar": "Add to calendar",
  "contact-provider": "Contact provider",
  "cancel-visit": "Cancel visit",
}

const ACTION_DONE: Record<ConfirmationAction, string> = {
  reschedule: "Asked to reschedule",
  "add-to-calendar": "Added to calendar",
  "contact-provider": "Asked to contact the provider",
  "cancel-visit": "Cancellation requested",
}

const chipClass =
  "relative flex cursor-pointer flex-col rounded-lg border border-border bg-transparent transition-colors hover:bg-accent dark:hover:bg-white/5 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:bg-muted dark:has-[:disabled]:hover:bg-transparent"
const chipOn = "ring-2 ring-choice ring-inset dark:bg-accent"
/** A radio button card: two or more options share a line, so each is boxed. */
const radioCardClass =
  "flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border border-border px-3 py-3 text-[13px] transition-colors hover:bg-muted dark:hover:bg-white/5 has-[:checked]:ring-2 has-[:checked]:ring-choice has-[:checked]:ring-inset dark:has-[:checked]:bg-accent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:disabled]:hover:bg-transparent"
const toggleClass = cn(
  genuiType.meta,
  "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
)
const fadeIn = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: "easeOut" as const },
}

function toResults(result: ServiceVisitProps["result"]): ServiceVisitResult[] {
  if (result === undefined) return []
  return Array.isArray(result) ? result : [result]
}

/** A host-provided "ready" (or nothing) yields to the user's decision. */
function resolveStatus(
  local: ServiceVisitStatus | null,
  statusProp: ServiceVisitStatus | undefined,
): ServiceVisitStatus {
  return local && (statusProp === undefined || statusProp === "ready")
    ? local
    : (statusProp ?? "ready")
}

/** Pricing with only the fields that have fully streamed. */
function readyPricing(pricing: ServiceVisitProps["pricing"]) {
  if (!pricing?.currency) return undefined
  const { estimate, ...rest } = pricing
  return {
    ...rest,
    currency: pricing.currency,
    estimate:
      typeof estimate?.low === "number" && typeof estimate?.high === "number"
        ? { low: estimate.low, high: estimate.high }
        : undefined,
  }
}

/**
 * The one price to lead with (the estimate, else the call-out fee, else the
 * hourly rate) and the rest of the price lines for the breakdown.
 */
function priceSummary(pricing: ServiceVisitProps["pricing"], locale: string) {
  const p = readyPricing(pricing)
  if (!p) return null
  const lines = pricingLines(p, { locale })
  if (lines.length === 0) return null
  const m = (n: number) => formatMoney(n, p.currency, locale)
  let lead: { label: string; amount: string; line: string | null } | null = null
  if (p.estimate) {
    const low = Math.min(p.estimate.low, p.estimate.high)
    const high = Math.max(p.estimate.low, p.estimate.high)
    lead = {
      label: "Estimate",
      amount: low === high ? m(low) : `${m(low)}–${m(high)}`,
      line: pricingLines(
        { currency: p.currency, estimate: p.estimate },
        { locale },
      )[0],
    }
  } else if (typeof p.callOutFee === "number" && p.callOutFee > 0) {
    lead = {
      label: "Call-out fee",
      amount: m(p.callOutFee),
      line: pricingLines(
        { currency: p.currency, callOutFee: p.callOutFee },
        { locale },
      )[0],
    }
  } else if (typeof p.hourlyRate === "number") {
    lead = {
      label: "Hourly rate",
      amount: `${m(p.hourlyRate)}/h`,
      line: pricingLines(
        { currency: p.currency, hourlyRate: p.hourlyRate },
        { locale },
      )[0],
    }
  }
  return {
    lead,
    rest: lines.filter((l) => l !== lead?.line),
    currency: p.currency,
  }
}

function readyQuestions(
  questions: Partial<TriageQuestion>[] | undefined,
): ReadyQuestion[] {
  return (questions ?? [])
    .filter(
      (q): q is ReadyQuestion =>
        typeof q.id === "string" &&
        typeof q.label === "string" &&
        (q.type === "select" || q.type === "text" || q.type === "boolean"),
    )
    .slice(0, 4)
}

/** The last day the stream has a date for, still waiting for its windows. */
function pendingDate(windows: PartialDay[], streaming: boolean) {
  if (!streaming) return null
  const last = [...windows].reverse().find((d) => typeof d.date === "string")
  return last && !last.slots?.length ? (last.date ?? null) : null
}

/** The UTC offset inside a zone label ("Europe/Amsterdam (GMT+2)"). */
function labelOffset(label: string | null) {
  return label ? (/\((GMT[^)]*)\)/.exec(label)?.[1] ?? null) : null
}

/**
 * Whether the viewer's clock is on a different UTC offset than the zone label
 * (read after mount, so server and client render the same markup). Times are
 * only labelled with their zone when it would change how they read.
 */
function useOtherZone(label: string | null, at: string | undefined) {
  const [other, setOther] = React.useState(false)
  React.useEffect(() => {
    const theirs = labelOffset(label)
    const noon = at ? Date.parse(`${at}T12:00:00Z`) : Number.NaN
    const mine = new Intl.DateTimeFormat("en-US", {
      timeZoneName: "shortOffset",
    })
      .formatToParts(Number.isNaN(noon) ? Date.now() : noon)
      .find((p) => p.type === "timeZoneName")?.value
    // No offset in the label: say the zone, to be safe.
    setOther(
      Boolean(label) &&
        (!theirs || (mine === "GMT" ? "GMT+0" : mine) !== theirs),
    )
  }, [label, at])
  return other
}

// ---------------------------------------------------------------------------
// Shared pieces

function RequiredMark() {
  return (
    <span aria-hidden className="text-muted-foreground">
      {" "}
      *
    </span>
  )
}

function Header({
  provider,
  service,
  streaming,
  titleId,
  showRating,
}: {
  provider: NonNullable<ServiceVisitProps["provider"]>
  service?: ServiceVisitProps["service"]
  streaming: boolean
  titleId: string
  showRating: boolean
}) {
  const locale = useGenUILocale()
  const rating = provider.rating
  const score = showRating ? formatRating(rating?.score, locale) : null
  const count =
    typeof rating?.count === "number"
      ? new Intl.NumberFormat(locale).format(rating.count)
      : null
  const outOf = typeof rating?.outOf === "number" ? rating.outOf : null
  const serviceLabel = service?.description || service?.type
  const trust = [
    provider.licensed && "Licensed.",
    provider.insured && "Insured.",
  ].filter(Boolean)

  return (
    <SurfaceHeader className="pb-3">
      <SurfaceTitle id={titleId}>{provider.name}</SurfaceTitle>
      {serviceLabel || score ? (
        <p
          className={cn(
            genuiType.meta,
            "flex flex-wrap items-center gap-x-1.5",
          )}
        >
          {serviceLabel && (
            <span>
              {service?.description && service.type && (
                <span className="sr-only">{`${service.type}: `}</span>
              )}
              {serviceLabel}
            </span>
          )}
          {serviceLabel && score && <span aria-hidden>·</span>}
          {score && (
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <StarIcon aria-hidden className="size-3" />
              <span aria-hidden>{count ? `${score} (${count})` : score}</span>
              <span className="sr-only">
                {`Rated ${score}${outOf ? ` out of ${outOf}` : ""}${count ? `, from ${count} reviews` : ""}.`}
              </span>
            </span>
          )}
          {showRating && trust.length > 0 && (
            <span className="sr-only">{trust.join(" ")}</span>
          )}
        </p>
      ) : (
        streaming && <Skeleton className="h-4 w-36" />
      )}
    </SurfaceHeader>
  )
}

function Section({
  id,
  title,
  aside,
  hideTitle,
  children,
}: {
  id: string
  title: string
  aside?: React.ReactNode
  /** When a form field inside carries the same name, the heading is read, not shown. */
  hideTitle?: boolean
  children: React.ReactNode
}) {
  return (
    <motion.section
      {...fadeIn}
      aria-labelledby={id}
      className="flex flex-col gap-2 border-t border-border px-3 py-3"
    >
      {hideTitle ? (
        <h4 id={id} className="sr-only">
          {title}
        </h4>
      ) : (
        <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3">
          <h4 id={id} className={genuiType.label}>
            {title}
          </h4>
          {aside}
        </div>
      )}
      {children}
    </motion.section>
  )
}

function Disclosure({
  open,
  onToggle,
  controls,
  disabled,
  children,
}: {
  open: boolean
  onToggle: () => void
  controls: string
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      disabled={disabled}
      onClick={onToggle}
      className={toggleClass}
    >
      {children}
      <ChevronDownIcon
        aria-hidden
        className={cn("size-3.5 transition-transform", open && "rotate-180")}
      />
    </button>
  )
}

function PriceLines({ id, lines }: { id: string; lines: string[] }) {
  return (
    <ul
      id={id}
      aria-label="Price breakdown"
      className={cn(genuiType.body, "flex flex-col gap-0.5")}
    >
      {lines.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  )
}

/** Select mode: the price to expect, big, with the rest one tap away. */
function PriceBlock({
  pricing,
  window,
}: {
  pricing: ServiceVisitProps["pricing"]
  window?: UtilWindow
}) {
  const locale = useGenUILocale()
  const [open, setOpen] = React.useState(false)
  const listId = React.useId()
  const price = priceSummary(pricing, locale)
  if (!price) return null
  const fee = window ? windowFeeText(window, price.currency, locale) : null
  const meta = [fee, "Paid on site"].filter(Boolean).join(" · ")

  if (!price.lead) {
    // Nothing to add up (e.g. "No call-out fee"): the lines are the price.
    return (
      <motion.div
        {...fadeIn}
        className="flex flex-col gap-1 border-t border-border px-3 py-3"
      >
        <span className={genuiType.label}>Price</span>
        <span className={genuiType.body}>{price.rest[0]}</span>
        {price.rest.length > 1 && (
          <span className={genuiType.meta}>
            {price.rest.slice(1).join(" · ")}
          </span>
        )}
      </motion.div>
    )
  }

  return (
    <motion.div
      {...fadeIn}
      className="flex flex-col gap-1.5 border-t border-border px-3 py-3"
    >
      <span className={genuiType.label}>{price.lead.label}</span>
      <span className={genuiType.stat}>{price.lead.amount}</span>
      <div className="flex flex-wrap items-center justify-between gap-x-3">
        <span className={genuiType.meta}>{meta}</span>
        {price.rest.length > 0 && (
          <Disclosure
            open={open}
            onToggle={() => setOpen((v) => !v)}
            controls={listId}
          >
            Price details
          </Disclosure>
        )}
      </div>
      {price.rest.length > 0 && (
        <div hidden={!open}>
          <PriceLines id={listId} lines={price.rest} />
        </div>
      )}
    </motion.div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-medium break-words">{children}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Entry

export function ServiceVisit(props: ServiceVisitProps) {
  if (props.mode === "confirmation") return <ConfirmationView {...props} />
  return <SelectView {...props} />
}

// ---------------------------------------------------------------------------
// Select mode

type Photo = { key: string; file: File; url: string }

function SelectView({
  provider = {},
  service,
  issue,
  address,
  windows = [],
  timeZone,
  pricing,
  photos,
  contactPreference,
  status: statusProp,
  onFiles,
  onResult,
  result,
  className,
}: ServiceVisitProps) {
  const locale = useGenUILocale()
  const restored = toResults(result).find((r) =>
    SELECT_ACTIONS.has(r.action),
  ) as SelectDecision | undefined

  const [decision, setDecision] = React.useState<SelectDecision | null>(
    restored ?? null,
  )
  const [summary, setSummary] = React.useState<string | null>(null)
  const [answers, setAnswers] = React.useState<TriageAnswers>({})
  const [dayChoice, setDayChoice] = React.useState<string | null>(null)
  const [windowChoice, setWindowChoice] = React.useState<{
    date: string
    id: string
  } | null>(null)
  const [unit, setUnit] = React.useState("")
  const [floor, setFloor] = React.useState("")
  const [gateCode, setGateCode] = React.useState("")
  const [showGate, setShowGate] = React.useState(false)
  const [accessNotes, setAccessNotes] = React.useState<string | null>(null)
  const [contact, setContact] = React.useState<"call" | "text" | null>(null)
  const [notes, setNotes] = React.useState("")
  const [photoList, setPhotoList] = React.useState<Photo[]>([])
  const [photoMessage, setPhotoMessage] = React.useState("")
  const [attempted, setAttempted] = React.useState(false)
  const [detailsOpen, setDetailsOpen] = React.useState(false)

  const urls = React.useRef(new Set<string>())
  const fileInput = React.useRef<HTMLInputElement>(null)
  const addButton = React.useRef<HTMLButtonElement>(null)
  const counter = React.useRef(0)
  const uid = React.useId()
  const titleId = `${uid}-title`
  const ids = {
    issue: `${uid}-issue`,
    summary: `${uid}-summary`,
    summaryError: `${uid}-summary-error`,
    when: `${uid}-when`,
    where: `${uid}-where`,
    details: `${uid}-details`,
    photos: `${uid}-photos`,
    photosHint: `${uid}-photos-hint`,
    contact: `${uid}-contact`,
    notes: `${uid}-notes`,
    gate: `${uid}-gate`,
    gateHint: `${uid}-gate-hint`,
    question: (id: string) => `${uid}-q-${id}`,
    questionLabel: (id: string) => `${uid}-q-${id}-label`,
    questionError: (id: string) => `${uid}-q-${id}-error`,
  }

  // Release every preview when the component goes away.
  React.useEffect(() => {
    const created = urls.current
    return () => {
      for (const url of created) URL.revokeObjectURL(url)
      created.clear()
    }
  }, [])

  const local: ServiceVisitStatus | null = decision
    ? decision.action === "request"
      ? "requested"
      : "dismissed"
    : null
  const status = resolveStatus(local, statusProp)
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const locked = status !== "ready" && status !== "streaming"
  // Inputs stay usable while streaming; only a decision or submit locks them.
  const disabled = locked

  const strip = buildDayStrip(windows)
  const pending = pendingDate(windows, streaming)
  const isPending = (d: StripDay) => d.full && d.date === pending
  const currentDay =
    strip.find((d) => d.date === dayChoice && !d.full) ??
    strip.find((d) => !d.full) ??
    strip[0]
  const chosen =
    windowChoice && currentDay && windowChoice.date === currentDay.date
      ? currentDay.slots.find((s) => s.id === windowChoice.id)
      : undefined

  const questions = readyQuestions(issue?.questions)
  const summaryText = summary ?? issue?.summary ?? ""
  const notesValue = accessNotes ?? address?.accessNotes ?? ""
  const triageErrors = validateTriage(questions, answers)
  const summaryError = summaryText.trim() ? null : "Describe the problem."
  const showErrors = attempted
  const photoMax = Math.max(1, Math.min(10, photos?.max ?? PHOTO_MAX_DEFAULT))
  const photosOn = photos?.allowed === true
  const zone = timeZone ? formatTimeZone(timeZone, strip[0]?.date) : null
  const showZone = useOtherZone(zone, strip[0]?.date)
  const street = addressSummary(address)
  const providerName = provider.name
  const hasDetails = Boolean(
    unit.trim() ||
      floor.trim() ||
      gateCode.trim() ||
      notesValue.trim() ||
      photoList.length ||
      contact ||
      notes.trim(),
  )

  const canRequest = !busy && !locked && !!chosen && !!currentDay

  const pickDay = (date: string) => {
    setDayChoice(date)
    setWindowChoice(null)
  }

  const addPhotos = (list: FileList) => {
    if (disabled) return
    const room = photoMax - photoList.length
    const files = Array.from(list)
    const images = files.filter(
      (f) =>
        f.type.startsWith("image/") && f.size <= PHOTO_MAX_MB * 1024 * 1024,
    )
    const rejected = files.length - images.length
    const kept = images.slice(0, Math.max(0, room))
    const overflow = images.length - kept.length
    const added: Photo[] = kept.map((file) => {
      counter.current += 1
      const url = URL.createObjectURL(file)
      urls.current.add(url)
      return { key: `photo-${counter.current}`, file, url }
    })
    setPhotoList((prev) => [...prev, ...added])
    setPhotoMessage(
      [
        added.length
          ? `${added.length} ${added.length === 1 ? "photo" : "photos"} added.`
          : null,
        rejected
          ? `${rejected} skipped: only images up to ${PHOTO_MAX_MB} MB.`
          : null,
        overflow ? `${overflow} skipped: up to ${photoMax} photos.` : null,
      ]
        .filter(Boolean)
        .join(" "),
    )
  }

  const removePhoto = (photo: Photo) => {
    URL.revokeObjectURL(photo.url)
    urls.current.delete(photo.url)
    setPhotoList((prev) => prev.filter((p) => p.key !== photo.key))
    setPhotoMessage(`${photo.file.name} removed.`)
    addButton.current?.focus()
  }

  const request = () => {
    if (!canRequest || !chosen || !currentDay) return
    setAttempted(true)
    if (summaryError) {
      document.getElementById(ids.summary)?.focus()
      return
    }
    const firstInvalid = questions.find((q) => triageErrors[q.id])
    if (firstInvalid) {
      document.getElementById(ids.question(firstInvalid.id))?.focus()
      return
    }
    const trimmed = {
      unit: unit.trim(),
      floor: floor.trim(),
      gateCode: gateCode.trim(),
      accessNotes: notesValue.trim(),
    }
    const r: RequestDecision = {
      action: "request",
      windowId: chosen.id,
      date: currentDay.date,
      summary: summaryText.trim(),
      answers: cleanAnswers(questions, answers),
      address: {
        ...(trimmed.unit ? { unit: trimmed.unit } : {}),
        ...(trimmed.floor ? { floor: trimmed.floor } : {}),
        ...(trimmed.gateCode ? { gateCode: trimmed.gateCode } : {}),
        ...(trimmed.accessNotes ? { accessNotes: trimmed.accessNotes } : {}),
      },
      photoCount: photosOn ? photoList.length : 0,
      ...(contactPreference && contact ? { contact } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    }
    if (photosOn && photoList.length > 0)
      onFiles?.(photoList.map((p) => p.file))
    setDecision(r)
    onResult?.(r)
  }

  const dismiss = () => {
    if (busy || locked) return
    const r: SelectDecision = { action: "dismiss" }
    setDecision(r)
    onResult?.(r)
  }

  const requested = decision?.action === "request" ? decision : null
  const finished = status === "requested" || status === "dismissed"
  const requestedWindow = requested
    ? findWindow(strip, requested.windowId)
    : null

  const questionControl = (q: ReadyQuestion) => {
    const error = showErrors ? triageErrors[q.id] : undefined
    const errorId = ids.questionError(q.id)
    const common = {
      "aria-invalid": error ? true : undefined,
      "aria-describedby": error ? errorId : undefined,
      "aria-required": q.required || undefined,
    }
    const value = answers[q.id]
    const set = (v: string | boolean) =>
      setAnswers((prev) => ({ ...prev, [q.id]: v }))
    const errorText = error && (
      <p id={errorId} className="text-[13px] text-destructive">
        {error}
      </p>
    )

    if (q.type === "boolean") {
      return (
        <motion.fieldset
          key={q.id}
          {...fadeIn}
          className="m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0"
          aria-describedby={error ? errorId : undefined}
        >
          <legend className={cn(genuiType.label, "mb-2")}>
            {q.label}
            {q.required && <RequiredMark />}
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {[true, false].map((v, i) => (
              <label key={String(v)} className={radioCardClass}>
                <input
                  type="radio"
                  // The first option takes focus on a failed request.
                  id={i === 0 ? ids.question(q.id) : undefined}
                  name={`${uid}-q-${q.id}`}
                  checked={value === v}
                  disabled={disabled}
                  onChange={() => set(v)}
                  aria-invalid={error ? true : undefined}
                  className="sr-only"
                />
                <RadioMark checked={value === v} />
                {v ? "Yes" : "No"}
              </label>
            ))}
          </div>
          {errorText}
        </motion.fieldset>
      )
    }

    if (q.type === "select") {
      const options = q.options?.filter(Boolean) ?? []
      return (
        <motion.div key={q.id} {...fadeIn}>
          <FormField
            htmlFor={ids.question(q.id)}
            labelId={ids.questionLabel(q.id)}
            label={q.label}
            required={q.required}
            filled={typeof value === "string" && value !== ""}
            error={error}
            errorId={errorId}
          >
          {options.length === 0 ? (
            <Skeleton className="h-14 w-full rounded-[24px]" />
          ) : (
            <Select
              value={typeof value === "string" && value ? value : null}
              onValueChange={(v) => set(typeof v === "string" ? v : "")}
              items={options.map((o) => ({ value: o, label: o }))}
              disabled={disabled}
            >
              <SelectTrigger
                {...common}
                id={ids.question(q.id)}
                aria-labelledby={ids.questionLabel(q.id)}
                className={formSelectClass}
              >
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o} value={o}>
                    {o}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          </FormField>
        </motion.div>
      )
    }

    return (
      <motion.div key={q.id} {...fadeIn}>
        <FormField
          htmlFor={ids.question(q.id)}
          label={q.label}
          required={q.required}
          filled={typeof value === "string" && value !== ""}
          error={error}
          errorId={errorId}
        >
          <Input
            {...common}
            id={ids.question(q.id)}
            value={typeof value === "string" ? value : ""}
            maxLength={120}
            disabled={disabled}
            onChange={(e) => set(e.target.value)}
            className={formInputClass}
          />
        </FormField>
      </motion.div>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="service-visit"
        data-status={status}
        data-mode="select"
        aria-busy={busy}
        aria-labelledby={providerName ? titleId : undefined}
        aria-label={providerName ? undefined : "Service visit"}
        className={cn("@container", className)}
      >
        <Header
          provider={provider}
          service={service}
          streaming={streaming}
          titleId={titleId}
          showRating
        />

        <AutoHeight>
          {requested ? (
            // The request, read-only: what went to the provider.
            <dl className="flex flex-col divide-y divide-border border-t border-border px-3 text-[13px]">
              <Row label="When">
                <span className="font-medium" suppressHydrationWarning>
                  {requestedWindow
                    ? summaryLine(
                        requestedWindow.date,
                        requestedWindow.slot,
                        locale,
                      )
                    : formatDate(requested.date, "short", locale)}
                </span>
              </Row>
              <Row label="Issue">{requested.summary}</Row>
              {questions.map((q) => {
                const a = answerText(requested.answers[q.id])
                return a ? (
                  <Row key={q.id} label={q.label}>
                    {a}
                  </Row>
                ) : null
              })}
              {street && (
                <Row label="Address">
                  {[
                    street,
                    unitText(requested.address.unit, requested.address.floor),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Row>
              )}
              {requested.address.gateCode && (
                <Row label="Gate code">Added (hidden)</Row>
              )}
              {requested.address.accessNotes && (
                <Row label="Access">{requested.address.accessNotes}</Row>
              )}
              {requested.photoCount > 0 && (
                <Row label="Photos">
                  {`${requested.photoCount} ${requested.photoCount === 1 ? "photo" : "photos"}`}
                </Row>
              )}
              {requested.contact && (
                <Row label="Contact">
                  {requested.contact === "call" ? "Call" : "Text"}
                </Row>
              )}
              {requested.notes && <Row label="Notes">{requested.notes}</Row>}
            </dl>
          ) : finished ? null : (
            <div className="flex flex-col @lg:grid @lg:grid-cols-2 @lg:*:min-w-0">
              {/* When: the decision the prompt is about, first. */}
              <Section
                id={ids.when}
                title="Arrival window"
                aside={
                  showZone &&
                  zone && (
                    <span className={genuiType.meta} suppressHydrationWarning>
                      {zone}
                    </span>
                  )
                }
              >
                <fieldset className="m-0 min-w-0 border-0 p-0">
                  <legend className="sr-only">Day</legend>
                  {/* Days: scrolls sideways on narrow screens. */}
                  <FadeRow
                    wrapperClassName="-mx-3 @lg:mr-0"
                    className="flex gap-2 px-3 pb-0.5 [scrollbar-width:thin] @lg:pr-0"
                  >
                    {strip.map((day) => {
                      const wait = isPending(day)
                      const on = currentDay?.date === day.date && !day.full
                      return (
                        <motion.label
                          key={day.date}
                          {...fadeIn}
                          className={cn(
                            chipClass,
                            "min-w-16 shrink-0 items-center gap-0.5 rounded-[10px] px-3.5 py-2.5 text-center",
                            on && chipOn,
                          )}
                        >
                          <input
                            type="radio"
                            name={`${uid}-day`}
                            value={day.date}
                            checked={on}
                            disabled={day.full || disabled}
                            onChange={() => pickDay(day.date)}
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
                              day.full && !wait && "line-through",
                            )}
                            suppressHydrationWarning
                          >
                            {formatDate(day.date, "day", locale)}
                          </span>
                          {day.full && !wait && (
                            <span className="sr-only">Full</span>
                          )}
                        </motion.label>
                      )
                    })}
                    {streaming &&
                      Array.from({ length: strip.length ? 1 : 4 }, (_, i) => (
                        <Skeleton
                          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                          key={i}
                          className="h-15 w-16 shrink-0 rounded-[10px]"
                        />
                      ))}
                  </FadeRow>
                </fieldset>

                {currentDay && !currentDay.full ? (
                  <fieldset className="m-0 min-w-0 border-0 p-0">
                    <legend className="sr-only" suppressHydrationWarning>
                      {`Arrival windows on ${formatDate(currentDay.date, "long", locale)}${zone ? `, ${zone} time` : ""}. The technician arrives within the window.`}
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {currentDay.slots.map((slot) => {
                        const on = chosen?.id === slot.id
                        const fee = windowFeeText(
                          slot,
                          pricing?.currency,
                          locale,
                        )
                        return (
                          <motion.label
                            key={slot.id}
                            {...fadeIn}
                            className={cn(
                              chipClass,
                              "min-h-12 justify-center gap-0.5 px-3.5 py-2.5",
                              on && chipOn,
                            )}
                          >
                            <input
                              type="radio"
                              name={`${uid}-window`}
                              value={slot.id}
                              checked={on}
                              disabled={disabled}
                              onChange={() =>
                                setWindowChoice({
                                  date: currentDay.date,
                                  id: slot.id,
                                })
                              }
                              className="sr-only"
                            />
                            <span
                              className="text-[13px] font-medium tabular-nums"
                              suppressHydrationWarning
                            >
                              {formatRange(slot.start, slot.end, locale)}
                            </span>
                            {fee && (
                              <span className={genuiType.meta}>{fee}</span>
                            )}
                          </motion.label>
                        )
                      })}
                    </div>
                  </fieldset>
                ) : streaming && (!currentDay || isPending(currentDay)) ? (
                  <div aria-hidden className="grid gap-2 sm:grid-cols-2">
                    {Array.from({ length: 2 }, (_, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                      <Skeleton key={i} className="h-12 rounded-lg" />
                    ))}
                  </div>
                ) : (
                  !streaming && (
                    <p className={genuiType.meta}>No open windows</p>
                  )
                )}
              </Section>

              {/* The problem and the provider's triage questions. */}
              <Section id={ids.issue} title="Problem" hideTitle>
                <FormFieldGroup>
                <FormField
                  htmlFor={ids.summary}
                  label="Problem"
                  required
                  pinned
                  error={showErrors && summaryError ? summaryError : undefined}
                  errorId={ids.summaryError}
                >
                  <Textarea
                    id={ids.summary}
                    aria-invalid={showErrors && summaryError ? true : undefined}
                    aria-describedby={
                      showErrors && summaryError ? ids.summaryError : undefined
                    }
                    aria-required
                    value={summaryText}
                    maxLength={SUMMARY_MAX}
                    disabled={disabled || (streaming && !issue)}
                    placeholder="e.g. Water pools under the dishwasher"
                    onChange={(e) =>
                      setSummary(e.target.value.slice(0, SUMMARY_MAX))
                    }
                    className={formTextareaClass}
                  />
                </FormField>
                {questions.length > 0 && questions.map(questionControl)}
                </FormFieldGroup>
                {streaming && !issue?.questions && (
                  <Skeleton className="h-8 w-48" />
                )}
              </Section>

              {/* Address, with access details, photos and notes folded away. */}
              {street || !streaming ? (
                <motion.section
                  {...fadeIn}
                  aria-labelledby={ids.where}
                  className={cn(
                    "flex flex-col gap-3 border-t border-border px-3 py-3",
                    detailsOpen && "@lg:col-span-2",
                  )}
                >
                  <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
                    {street ? (
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <h4 id={ids.where} className={genuiType.label}>
                          Address
                        </h4>
                        <p className={genuiType.body}>{street}</p>
                      </div>
                    ) : (
                      <h4 id={ids.where} className="sr-only">
                        Details for the technician
                      </h4>
                    )}
                    <Disclosure
                      open={detailsOpen}
                      onToggle={() => setDetailsOpen((v) => !v)}
                      controls={ids.details}
                    >
                      {hasDetails ? "Edit details" : "Add details"}
                      <span className="sr-only">
                        {`: ${[
                          street && "apartment, gate code and access notes",
                          photosOn && "photos",
                          contactPreference && "how to reach you",
                          "notes",
                        ]
                          .filter(Boolean)
                          .join(", ")}`}
                      </span>
                    </Disclosure>
                  </div>

                  <div id={ids.details} hidden={!detailsOpen}>
                  <FormFieldGroup>
                    {street && (
                      <>
                        <FormField
                          htmlFor={`${uid}-unit`}
                          label="Apt or unit"
                          filled={unit !== ""}
                        >
                          <Input
                            id={`${uid}-unit`}
                            value={unit}
                            maxLength={20}
                            autoComplete="address-line2"
                            disabled={disabled}
                            onChange={(e) => setUnit(e.target.value)}
                            className={formInputClass}
                          />
                        </FormField>
                        <FormField
                          htmlFor={`${uid}-floor`}
                          label="Floor"
                          filled={floor !== ""}
                        >
                          <Input
                            id={`${uid}-floor`}
                            value={floor}
                            maxLength={10}
                            inputMode="numeric"
                            disabled={disabled}
                            onChange={(e) => setFloor(e.target.value)}
                            className={formInputClass}
                          />
                        </FormField>
                        <FormField
                          htmlFor={ids.gate}
                          label="Gate or door code"
                          filled={gateCode !== ""}
                        >
                          <Input
                            id={ids.gate}
                            type={showGate ? "text" : "password"}
                            value={gateCode}
                            maxLength={20}
                            autoComplete="off"
                            spellCheck={false}
                            disabled={disabled}
                            aria-describedby={ids.gateHint}
                            onChange={(e) => setGateCode(e.target.value)}
                            className={cn(formInputClass, "pr-20")}
                          />
                          {/* Show or hide sits inside the box, at its right edge. */}
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-controls={ids.gate}
                            aria-label={
                              showGate ? "Hide gate code" : "Show gate code"
                            }
                            disabled={disabled}
                            onClick={() => setShowGate((v) => !v)}
                            className="absolute inset-y-0 right-2 my-auto rounded-[16px]"
                          >
                            {showGate ? "Hide" : "Show"}
                          </Button>
                          <span id={ids.gateHint} className="sr-only">
                            Only the provider sees the gate code.
                          </span>
                        </FormField>
                        <FormField
                          htmlFor={`${uid}-access`}
                          label="Access notes"
                          pinned
                        >
                          <Textarea
                            id={`${uid}-access`}
                            value={notesValue}
                            maxLength={NOTES_MAX}
                            disabled={disabled}
                            placeholder="Parking, buzzer, pets"
                            onChange={(e) =>
                              setAccessNotes(e.target.value.slice(0, NOTES_MAX))
                            }
                            className={formTextareaClass}
                          />
                        </FormField>
                      </>
                    )}

                    {photosOn && (
                      <section
                        aria-labelledby={ids.photos}
                        className="flex flex-col gap-2"
                      >
                        <h5 id={ids.photos} className={genuiType.label}>
                          Photos
                        </h5>
                        <input
                          ref={fileInput}
                          type="file"
                          hidden
                          tabIndex={-1}
                          aria-hidden
                          accept="image/*"
                          multiple
                          onChange={(e) => {
                            if (e.target.files) addPhotos(e.target.files)
                            // Allow picking the same file again after removing it.
                            e.target.value = ""
                          }}
                        />
                        {photoList.length > 0 && (
                          <ul className="flex flex-wrap gap-2">
                            {photoList.map((p) => (
                              <motion.li
                                key={p.key}
                                {...fadeIn}
                                className="relative size-20 overflow-hidden rounded-lg border border-border bg-transparent"
                              >
                                {/* biome-ignore lint/performance/noImgElement: local object-URL preview; next/image can't optimize it */}
                                <img
                                  src={p.url}
                                  alt={`Photo: ${p.file.name}`}
                                  className="size-full object-cover"
                                />
                                <IconTip label={`Remove photo ${p.file.name}`}>
                                  <Button
                                    size="icon-sm"
                                    variant="secondary"
                                    aria-label={`Remove photo ${p.file.name}`}
                                    disabled={disabled}
                                    onClick={() => removePhoto(p)}
                                    className="absolute top-1 right-1"
                                  >
                                    <XIcon />
                                  </Button>
                                </IconTip>
                              </motion.li>
                            ))}
                          </ul>
                        )}
                        <div>
                          <WhyDisabled
                            when={!disabled && photoList.length >= photoMax}
                            reason="Photo limit reached"
                          >
                            <Button
                              ref={addButton}
                              size="sm"
                              variant="secondary"
                              aria-describedby={ids.photosHint}
                              disabled={
                                disabled || photoList.length >= photoMax
                              }
                              onClick={() => fileInput.current?.click()}
                            >
                              Add photos
                            </Button>
                          </WhyDisabled>
                          <span id={ids.photosHint} className="sr-only">
                            {`${photoList.length} of ${photoMax} added. Images up to ${PHOTO_MAX_MB} MB each.`}
                          </span>
                        </div>
                        <p aria-live="polite" className={genuiType.meta}>
                          {photoMessage}
                        </p>
                      </section>
                    )}

                    {contactPreference && (
                      <fieldset className="m-0 grid min-w-0 grid-cols-2 gap-2 border-0 p-0">
                        <legend className={cn(genuiType.label, "mb-2")}>
                          Reach me by
                        </legend>
                        {(["call", "text"] as const).map((c) => (
                          <label key={c} className={radioCardClass}>
                            <input
                              type="radio"
                              name={`${uid}-contact`}
                              value={c}
                              checked={contact === c}
                              disabled={disabled}
                              onChange={() => setContact(c)}
                              className="sr-only"
                            />
                            <RadioMark checked={contact === c} />
                            {c === "call" ? "Call" : "Text"}
                          </label>
                        ))}
                      </fieldset>
                    )}

                    <FormField
                      htmlFor={ids.notes}
                      label="Notes for the technician"
                      pinned
                    >
                      <Textarea
                        id={ids.notes}
                        value={notes}
                        maxLength={NOTES_MAX}
                        disabled={disabled}
                        placeholder="e.g. The shut-off valve is under the sink"
                        onChange={(e) =>
                          setNotes(e.target.value.slice(0, NOTES_MAX))
                        }
                        className={formTextareaClass}
                      />
                    </FormField>
                  </FormFieldGroup>
                  </div>
                </motion.section>
              ) : (
                <div
                  aria-hidden
                  className="flex flex-col gap-1.5 border-t border-border px-3 py-3"
                >
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-4 w-40" />
                </div>
              )}

              <PriceBlock pricing={pricing} window={chosen} />
            </div>
          )}
        </AutoHeight>

        <SurfaceFooter
          aria-live="polite"
          className={cn(status === "dismissed" && "border-t-0")}
        >
          {streaming ? (
            <ShimmeringText
              text="Checking availability…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
              className="text-[13px]"
            />
          ) : status === "requested" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4 shrink-0" />
              {`Requested. Not booked until ${providerName || "the provider"} confirms.`}
            </p>
          ) : status === "dismissed" ? (
            <p
              className={cn(
                genuiType.body,
                "flex items-center gap-1.5 text-muted-foreground",
              )}
            >
              <XIcon aria-hidden className="size-4 shrink-0" />
              No visit requested.
            </p>
          ) : (
            <div className="flex w-full flex-col gap-2">
              <p className="min-w-0">
                {status === "submitting" ? (
                  <span className={genuiType.meta}>Sending…</span>
                ) : chosen && currentDay ? (
                  <span
                    className="text-[13px] font-medium tabular-nums"
                    suppressHydrationWarning
                  >
                    {summaryLine(currentDay.date, chosen, locale)}
                  </span>
                ) : (
                  <span className={genuiType.meta}>Pick a window</span>
                )}
              </p>
              {/* A form's one primary action spans the card; Cancel is a quiet text button. */}
              <WhyDisabled
                when={!busy && !locked && !canRequest}
                reason="Pick a window first"
                className="w-full"
              >
                <Button
                  disabled={!canRequest}
                  onClick={request}
                  className={formPrimaryClass}
                >
                  {status === "submitting" ? "Sending…" : "Request visit"}
                </Button>
              </WhyDisabled>
              <Button
                variant="ghost"
                onClick={dismiss}
                disabled={busy}
                className="h-11 w-full rounded-[24px] text-muted-foreground"
              >
                Cancel
              </Button>
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

// ---------------------------------------------------------------------------
// Confirmation mode

function ConfirmationView({
  provider = {},
  service,
  address,
  windows = [],
  timeZone,
  pricing,
  confirmation,
  status: statusProp,
  onResult,
  result,
  className,
}: ServiceVisitProps) {
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
  const [priceOpen, setPriceOpen] = React.useState(false)
  const copyTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelButton = React.useRef<HTMLButtonElement>(null)
  const refocusCancel = React.useRef(false)
  const uid = React.useId()
  const titleId = `${uid}-title`
  const priceId = `${uid}-price`

  const local: ServiceVisitStatus | null = done.has("cancel-visit")
    ? "cancel-requested"
    : done.size > 0
      ? "done"
      : null
  const status = resolveStatus(local, statusProp)
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"
  const locked = status !== "ready" && status !== "done"

  React.useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )
  // Return focus to "Cancel visit" when the confirm step closes.
  React.useEffect(() => {
    if (!confirmingCancel && refocusCancel.current) {
      refocusCancel.current = false
      cancelButton.current?.focus()
    }
  }, [confirmingCancel])

  const c = confirmation ?? {}
  const bookingState = c.bookingState
  const cancelled = bookingState === "cancelled"
  const strip = buildDayStrip(windows)
  const booked = findWindow(strip, c.windowId)
  const eta =
    !cancelled && c.eta
      ? etaParts(c.eta, timeZone, { date: booked?.date, locale })
      : null
  const street = addressSummary(address)
  const tech = c.technician
  const techRating = formatRating(tech?.rating, locale)
  const actions = bookingState ? defaultActions(bookingState) : []
  const zone = timeZone ? formatTimeZone(timeZone, booked?.date) : null
  const showZone = useOtherZone(zone, booked?.date)
  const price = cancelled ? null : priceSummary(pricing, locale)
  const priceLines = price
    ? price.lead
      ? price.rest
      : price.rest.slice(1)
    : []

  // The first action leads; Cancel visit keeps its words; the rest are icons.
  const iconActions = actions.filter((a, i) => i > 0 && a !== "cancel-visit")
  const textActions = actions.filter((a) => !iconActions.includes(a))

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

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="service-visit"
        data-status={status}
        data-mode="confirmation"
        aria-busy={busy}
        aria-label={
          provider.name ? `Visit from ${provider.name}` : "Service visit"
        }
        className={className}
      >
        <Header
          provider={provider}
          service={service}
          streaming={streaming}
          titleId={titleId}
          showRating={false}
        />

        <AutoHeight>
          <div className="flex flex-col">
            {/* When they arrive: the answer, big. */}
            <div className="flex items-start justify-between gap-3 border-t border-border px-3 py-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                {booked ? (
                  <>
                    <span className={genuiType.label}>
                      {eta
                        ? eta.weekday
                          ? `Arriving ${eta.weekday} around`
                          : "Arriving around"
                        : "Arrival window"}
                    </span>
                    <span
                      className={cn(
                        genuiType.stat,
                        cancelled && "text-muted-foreground line-through",
                      )}
                      suppressHydrationWarning
                    >
                      {eta
                        ? eta.clock
                        : formatRange(
                            booked.slot.start,
                            booked.slot.end,
                            locale,
                          )}
                    </span>
                    <span className={genuiType.meta} suppressHydrationWarning>
                      {[
                        eta
                          ? summaryLine(booked.date, booked.slot, locale)
                          : formatDate(booked.date, "short", locale),
                        showZone ? zone : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </>
                ) : streaming ? (
                  <>
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-3 w-32" />
                  </>
                ) : (
                  <span className={genuiType.meta}>No arrival window set</span>
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

            <div className="border-t border-border px-3 py-3">
              <dl className="grid grid-cols-2 gap-x-10 gap-y-3">
                {tech?.name && !cancelled && (
                  <motion.div
                    {...fadeIn}
                    className="flex min-w-0 flex-col gap-0.5"
                  >
                    <dt
                      className={cn(
                        genuiType.label,
                        "flex items-center gap-1.5",
                      )}
                    >
                      <UserIcon aria-hidden className="size-3.5 shrink-0" />
                      Technician
                    </dt>
                    <dd className={genuiType.body}>
                      {tech.name}
                      {techRating && (
                        <span className="sr-only">{`, rated ${techRating} out of 5`}</span>
                      )}
                    </dd>
                  </motion.div>
                )}
                {street && (
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <dt
                      className={cn(
                        genuiType.label,
                        "flex items-center gap-1.5",
                      )}
                    >
                      <MapPinIcon aria-hidden className="size-3.5 shrink-0" />
                      Address
                    </dt>
                    <dd className={cn(genuiType.body, "break-words")}>
                      {street}
                    </dd>
                  </div>
                )}
                {price && (
                  <motion.div
                    {...fadeIn}
                    className="flex min-w-0 flex-col gap-0.5"
                  >
                    <dt
                      className={cn(
                        genuiType.label,
                        "flex items-center gap-1.5",
                      )}
                    >
                      <WalletIcon aria-hidden className="size-3.5 shrink-0" />
                      {price.lead?.label ?? "Price"}
                    </dt>
                    <dd className="flex flex-wrap items-center gap-x-2">
                      <span className={cn(genuiType.body, "tabular-nums")}>
                        {price.lead?.amount ?? price.rest[0]}
                      </span>
                      {priceLines.length > 0 && (
                        <Disclosure
                          open={priceOpen}
                          onToggle={() => setPriceOpen((v) => !v)}
                          controls={priceId}
                        >
                          Details
                          <span className="sr-only"> of the price</span>
                        </Disclosure>
                      )}
                    </dd>
                  </motion.div>
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt
                    className={cn(genuiType.label, "flex items-center gap-1.5")}
                  >
                    <HashIcon aria-hidden className="size-3.5 shrink-0" />
                    Reference
                  </dt>
                  <dd>
                    {c.number ? (
                      <span className="-my-1 flex items-center gap-1">
                        <span className="font-mono text-[13px] break-all">
                          {c.number}
                        </span>
                        <IconTip
                          label={copied ? "Copied" : "Copy booking reference"}
                        >
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Copy booking reference ${c.number}`}
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
              </dl>

              {priceLines.length > 0 && (
                <div hidden={!priceOpen} className="mt-3">
                  <PriceLines
                    id={priceId}
                    lines={[...priceLines, "Paid on site"]}
                  />
                </div>
              )}
            </div>
          </div>
        </AutoHeight>

        <SurfaceFooter className="flex-col items-stretch gap-2">
          <div
            aria-live="polite"
            className={cn("flex flex-col gap-1", done.size === 0 && "sr-only")}
          >
            {copied && <p className="sr-only">Booking reference copied</p>}
            {[...done].map((a) => (
              <p
                key={a}
                className={cn(genuiType.body, "flex items-center gap-1.5")}
              >
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {a === "contact-provider" && provider.name
                  ? `Asked to contact ${provider.name}`
                  : ACTION_DONE[a]}
              </p>
            ))}
          </div>

          {confirmingCancel && !locked ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={genuiType.body}>Cancel this visit?</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" autoFocus onClick={keep}>
                  Keep visit
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingCancel(false)
                    fire("cancel-visit")
                  }}
                >
                  Cancel visit
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                {streaming ? (
                  <ShimmeringText
                    text="Loading visit…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                    className="text-[13px]"
                  />
                ) : status === "submitting" ? (
                  <p className={genuiType.meta}>Sending…</p>
                ) : null}
              </div>
              {actions.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {iconActions.map((a) => {
                    const used = done.has(a)
                    return (
                      <IconTip key={a} label={ACTION_LABEL[a]}>
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label={`${ACTION_LABEL[a]}${used ? " (done)" : ""}`}
                          disabled={busy || locked || used}
                          onClick={() => fire(a)}
                        >
                          {used ? (
                            <CheckIcon />
                          ) : a === "add-to-calendar" ? (
                            <CalendarPlusIcon />
                          ) : (
                            <PhoneIcon />
                          )}
                        </Button>
                      </IconTip>
                    )
                  })}
                  {[...textActions].reverse().map((a) => {
                    const used = done.has(a)
                    const lead = a === actions[0]
                    return (
                      <WhyDisabled key={a} when={used} reason="Already done">
                        <Button
                          ref={a === "cancel-visit" ? cancelButton : undefined}
                          size="sm"
                          variant={
                            used ? "secondary" : lead ? "default" : "ghost"
                          }
                          disabled={busy || locked || used}
                          onClick={() =>
                            a === "cancel-visit"
                              ? setConfirmingCancel(true)
                              : fire(a)
                          }
                        >
                          {used && <CheckIcon aria-hidden />}
                          {ACTION_LABEL[a]}
                          {used && <span className="sr-only"> (done)</span>}
                        </Button>
                      </WhyDisabled>
                    )
                  })}
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
