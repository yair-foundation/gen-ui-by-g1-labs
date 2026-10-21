"use client"

import * as React from "react"
import {
  AccessibilityIcon,
  ArrowUpRightIcon,
  CalendarIcon,
  CalendarPlusIcon,
  CheckIcon,
  ExternalLinkIcon,
  GraduationCapIcon,
  MusicIcon,
  PartyPopperIcon,
  PresentationIcon,
  ShirtIcon,
  Share2Icon,
  TagIcon,
  TrophyIcon,
  UserCheckIcon,
  UsersIcon,
  VideoIcon,
  type LucideIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button, buttonVariants } from "@/components/ui/button"
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
  RSVP_DONE,
  RSVP_LABEL,
  agendaTimeText,
  buildIcs,
  capacityText,
  dateRangeText,
  deadlineInfo,
  directionsUrl,
  icsFilename,
  parseBold,
  priceText,
  relativeText,
  resolveNow,
  resolveWhen,
  safeImageSrc,
  safeTimeZone,
  safeUrl,
  viewerTimeText,
  zoneCity,
  type RsvpChoice,
} from "./event-details-utils"
import type {
  AgendaItem,
  EventDetailsInput,
  EventDetailsResult,
  EventKind,
  EventPerson,
  RsvpState,
} from "./event-details.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type EventDetailsStatus =
  "streaming" | "ready" | "submitting" | "responded"

type OnceAction = "add-to-calendar" | "get-tickets" | "share"

export type EventDetailsProps = Partial<
  Omit<
    EventDetailsInput,
    | "venue"
    | "agenda"
    | "people"
    | "price"
    | "capacity"
    | "accessibility"
    | "rsvp"
    | "image"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  venue?: {
    name?: string
    address?: string
    online?: { platform?: string; url?: string }
  }
  agenda?: Partial<AgendaItem>[]
  people?: Partial<EventPerson>[]
  price?: "free" | { amount?: number; currency?: string }
  capacity?: { going?: number; max?: number }
  accessibility?: string[]
  rsvp?: { state?: RsvpState; deadline?: string }
  image?: { src?: string; alt?: string }
  /**
   * Locale for dates, times and prices. Defaults to the host's locale
   * (GenUILocaleProvider, else "en-US") so server and client render the same
   * text; pass the viewer's locale when you know it.
   */
  locale?: string
  /**
   * The moment relative text is measured from ("in 7 days"). Defaults to the
   * viewer's clock, read after mount.
   */
  now?: Date | string | number
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's RSVP itself.
   */
  status?: EventDetailsStatus
  /**
   * Called per action: 'rsvp' each time the user answers (again after
   * Change), the others once each. Every action is a handoff.
   */
  onResult?: (result: EventDetailsResult) => void
  /** Actions from history (one or several). Restores the RSVP; never calls onResult. */
  result?: EventDetailsResult | EventDetailsResult[]
  className?: string
}

const PEOPLE_HEADING: Partial<Record<EventKind, string>> = {
  concert: "Lineup",
  conference: "Speakers",
  meetup: "Speakers",
  webinar: "Speakers",
  class: "Instructors",
}

/** Title icon per kind: a tinted box. */
const KIND_ICONS: Record<EventKind, { icon: LucideIcon; tone: string }> = {
  conference: {
    icon: PresentationIcon,
    tone: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  },
  concert: {
    icon: MusicIcon,
    tone: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
  },
  meetup: {
    icon: UsersIcon,
    tone: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  },
  webinar: {
    icon: VideoIcon,
    tone: "bg-teal-500/15 text-teal-600 dark:bg-teal-400/15 dark:text-teal-400",
  },
  party: {
    icon: PartyPopperIcon,
    tone: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  },
  sports: {
    icon: TrophyIcon,
    tone: "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
  },
  class: {
    icon: GraduationCapIcon,
    tone: "bg-cyan-500/15 text-cyan-600 dark:bg-cyan-400/15 dark:text-cyan-400",
  },
  other: {
    icon: CalendarIcon,
    tone: "bg-muted text-muted-foreground dark:bg-white/10",
  },
}

const RSVP_CHOICES: RsvpChoice[] = ["going", "maybe", "not-going"]

/**
 * The current time and the viewer's timezone, read after mount (so server
 * and client render the same markup). The clock refreshes every minute.
 */
function useClock(fixed: number | null) {
  const [now, setNow] = React.useState<number | null>(null)
  const [viewerZone, setViewerZone] = React.useState<string | undefined>()
  React.useEffect(() => {
    setViewerZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
    if (fixed !== null) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [fixed])
  return { now: fixed ?? now, viewerZone }
}

/** A short-lived message in the footer's live region. */
function useAnnouncement() {
  const [message, setMessage] = React.useState("")
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  React.useEffect(() => () => clearTimeout(timer.current), [])
  const announce = React.useCallback((text: string) => {
    setMessage(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(""), 3000)
  }, [])
  return [message, announce] as const
}

function downloadFile(filename: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement("a")
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

const linkClass =
  "inline-flex min-h-6 items-center rounded-sm underline underline-offset-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"

/** The component knows what each of its own facts is. */
const FACT_ICONS: Record<string, LucideIcon> = {
  Price: TagIcon,
  Capacity: UsersIcon,
  "Dress code": ShirtIcon,
  Age: UserCheckIcon,
  Accessibility: AccessibilityIcon,
}

function Fact({
  label,
  wide,
  children,
}: {
  label: string
  wide?: boolean
  children: React.ReactNode
}) {
  const Icon = FACT_ICONS[label]
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className={cn("flex min-w-0 flex-col gap-0.5", wide && "col-span-full")}
    >
      <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
        {label}
      </dt>
      <dd className={cn(genuiType.body, "font-medium break-words")}>
        {children}
      </dd>
    </motion.div>
  )
}

export function EventDetails({
  title,
  kind,
  start,
  end,
  timeZone,
  allDay,
  venue,
  description,
  agenda = [],
  people = [],
  price,
  capacity,
  dressCode,
  ageLimit,
  accessibility = [],
  rsvp,
  url,
  image,
  locale: localeProp,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: EventDetailsProps) {
  const hostLocale = useGenUILocale()
  const locale = localeProp ?? hostLocale
  const kindInfo = kind ? KIND_ICONS[kind] : undefined
  const history =
    result === undefined ? [] : Array.isArray(result) ? result : [result]
  const [answer, setAnswer] = React.useState<RsvpChoice | null>(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      const r = history[i]
      if (r.action === "rsvp") return r.state
    }
    return null
  })
  const [editing, setEditing] = React.useState(false)
  const [done, setDone] = React.useState<Set<OnceAction>>(
    () =>
      new Set(history.flatMap((r) => (r.action === "rsvp" ? [] : [r.action]))),
  )
  const [message, announce] = useAnnouncement()
  const choiceRefs = React.useRef(new Map<RsvpChoice, HTMLButtonElement>())
  const changeRef = React.useRef<HTMLButtonElement>(null)
  const ids = React.useId()
  const { now, viewerZone } = useClock(resolveNow(nowProp))

  // A host-provided "ready" (or nothing) yields to the user's RSVP.
  const status: EventDetailsStatus =
    answer && !editing && (statusProp === undefined || statusProp === "ready")
      ? "responded"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"

  /* Data ------------------------------------------------------------- */
  const tz = safeTimeZone(timeZone)
  // While streaming, wait for a complete timezone so times don't jump.
  const zoneReady = !streaming || (timeZone !== undefined && tz === timeZone)
  const when = zoneReady ? resolveWhen({ start, end, timeZone, allDay }) : null
  const dateLine = when ? dateRangeText(when, tz, locale, now) : null
  const subline = when
    ? [
        when.allDay ? null : `${zoneCity(tz)} time`,
        when.allDay ? null : viewerTimeText(when.start, tz, viewerZone, locale),
        relativeText(when, tz, now),
      ].filter(Boolean)
    : []

  const online = venue?.online?.platform ? venue.online : undefined
  const joinHref = safeUrl(online?.url)
  const physical = venue?.name && !(online && !venue.address) ? venue : null
  const directions = physical ? directionsUrl(physical) : null
  const location = [venue?.name, venue?.address].filter(Boolean).join(", ")

  const readyPrice =
    price === "free"
      ? "free"
      : typeof price?.amount === "number" &&
          typeof price.currency === "string" &&
          price.currency.length === 3
        ? { amount: price.amount, currency: price.currency }
        : null
  const facts: { label: string; value: string; wide?: boolean }[] = []
  if (readyPrice) {
    facts.push({ label: "Price", value: priceText(readyPrice, locale) })
  }
  if (typeof capacity?.going === "number") {
    facts.push({
      label: "Capacity",
      value: capacityText({ going: capacity.going, max: capacity.max }, locale),
    })
  }
  if (dressCode) facts.push({ label: "Dress code", value: dressCode })
  if (ageLimit) facts.push({ label: "Age", value: ageLimit })
  const access = accessibility.filter(
    (a): a is string => typeof a === "string" && a.trim() !== "",
  )
  if (access.length > 0) {
    facts.push({
      label: "Accessibility",
      value: access.join(" · "),
      wide: true,
    })
  }

  const readyAgenda = agenda.filter(
    (a): a is AgendaItem =>
      typeof a.time === "string" && typeof a.title === "string",
  )
  const readyPeople = people.filter(
    (p): p is EventPerson => typeof p.name === "string",
  )
  const peopleHeading = (kind && PEOPLE_HEADING[kind]) ?? "People"
  const imageSrc = safeImageSrc(image?.src)
  const ticketsHref = safeUrl(url)
  const ticketsLabel = price === "free" ? "Register" : "Get tickets"

  /* RSVP ------------------------------------------------------------- */
  const given =
    rsvp?.state && rsvp.state !== "none" ? (rsvp.state as RsvpChoice) : null
  const current = answer ?? given
  const locked = current !== null && !editing
  const deadline = deadlineInfo(rsvp?.deadline, tz, locale)
  const closed = deadline !== null && now !== null && now >= deadline.at
  const name = title ?? "this event"

  const choose = (choice: RsvpChoice) => {
    if (busy) return
    setAnswer(choice)
    setEditing(false)
    onResult?.({ action: "rsvp", state: choice })
    requestAnimationFrame(() => changeRef.current?.focus())
  }

  const reopen = () => {
    setEditing(true)
    requestAnimationFrame(() =>
      choiceRefs.current.get(current ?? "going")?.focus(),
    )
  }

  const cancelEdit = () => {
    setEditing(false)
    requestAnimationFrame(() => changeRef.current?.focus())
  }

  /* Other actions ---------------------------------------------------- */
  const report = (action: OnceAction) => {
    if (done.has(action)) return
    setDone((prev) => new Set(prev).add(action))
    onResult?.({ action })
  }

  const addToCalendar = () => {
    if (!when || !title || busy) return
    const filename = icsFilename(title)
    downloadFile(
      filename,
      buildIcs({
        title,
        when,
        location:
          online && !venue?.address ? (joinHref ?? online.platform) : location,
        description,
        url: url ?? online?.url,
        stamp: Date.now(),
      }),
      "text/calendar;charset=utf-8",
    )
    announce(`Saved ${filename}. Open it to add the event to your calendar.`)
    report("add-to-calendar")
  }

  const share = async () => {
    if (!title || busy) return
    report("share")
    const text = [title, dateLine, location].filter(Boolean).join("\n")
    const link = ticketsHref ?? undefined
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, text, url: link })
        return
      }
      await navigator.clipboard.writeText(link ? `${text}\n${link}` : text)
      announce("Event details copied")
    } catch (error) {
      if ((error as Error)?.name !== "AbortError") announce("Couldn't share")
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="event-details"
        data-status={status}
        data-kind={kind}
        aria-busy={busy}
        aria-label={title ? `Event: ${title}` : "Event"}
        className={cn("@container", className)}
      >
        {imageSrc && (
          // biome-ignore lint/performance/noImgElement: registry components can't assume next/image
          <img
            src={imageSrc}
            alt={image?.alt ?? ""}
            loading="lazy"
            className="h-24 w-full bg-muted object-cover"
          />
        )}

        <SurfaceHeader
          className={cn("pb-3", kindInfo && "flex-row items-center gap-3")}
        >
          {kindInfo && (
            <span
              aria-hidden
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
                kindInfo.tone,
              )}
            >
              <kindInfo.icon className="size-5" />
            </span>
          )}
          <SurfaceTitle className="min-w-0 break-words">{title}</SurfaceTitle>
        </SurfaceHeader>

        {/* When (the focal line) and where */}
        <div className="grid items-start gap-3 border-t border-border px-3 py-3 @xl:grid-cols-2 @xl:gap-x-10">
          {when && dateLine ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <time
                dateTime={
                  when.allDay
                    ? when.startDate
                    : new Date(when.start).toISOString()
                }
                className={cn(genuiType.stat, "leading-tight text-balance")}
              >
                {dateLine}
              </time>
              {subline.length > 0 && (
                <span className={genuiType.meta}>{subline.join(" · ")}</span>
              )}
            </div>
          ) : (
            <Skeleton className="h-7 w-56" />
          )}

          {physical?.name && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className="flex min-w-0 flex-col gap-0.5"
            >
              <span className={cn(genuiType.body, "font-medium")}>
                {physical.name}
              </span>
              {(physical.address || (directions && !streaming)) && (
                <span className={genuiType.meta}>
                  {physical.address}
                  {physical.address && directions && !streaming && (
                    <span aria-hidden> · </span>
                  )}
                  {directions && !streaming && (
                    <a
                      href={directions}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className={linkClass}
                    >
                      Directions
                      <ArrowUpRightIcon
                        aria-hidden
                        className="ml-0.5 size-3.5"
                      />
                      <span className="sr-only">
                        {` to ${physical.name} (opens in a new tab)`}
                      </span>
                    </a>
                  )}
                </span>
              )}
            </motion.div>
          )}

          {online && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className="flex min-w-0 flex-col gap-0.5"
            >
              <span className={cn(genuiType.body, "font-medium")}>
                Online on {online.platform}
              </span>
              {joinHref && !streaming ? (
                <a
                  href={joinHref}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={cn(linkClass, genuiType.meta, "w-fit")}
                >
                  Join link
                  <ArrowUpRightIcon aria-hidden className="ml-0.5 size-3.5" />
                  <span className="sr-only">
                    {` for ${name} on ${online.platform} (opens in a new tab)`}
                  </span>
                </a>
              ) : (
                !streaming && (
                  <span className={genuiType.meta}>Link shared later</span>
                )
              )}
            </motion.div>
          )}
        </div>

        {facts.length > 0 && (
          <dl className="grid grid-cols-2 gap-x-10 gap-y-4 border-t border-border px-3 py-3 sm:grid-cols-3">
            {facts.map((f) => (
              <Fact key={f.label} label={f.label} wide={f.wide}>
                {f.value}
              </Fact>
            ))}
          </dl>
        )}

        {description && (
          <p
            className={cn(
              genuiType.body,
              "border-t border-border px-3 py-3 whitespace-pre-line text-pretty",
            )}
          >
            {parseBold(description).map((s, i) =>
              s.bold ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and re-derived from the text
                <strong key={i} className="font-semibold">
                  {s.text}
                </strong>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional and re-derived from the text
                <React.Fragment key={i}>{s.text}</React.Fragment>
              ),
            )}
          </p>
        )}

        {readyAgenda.length > 0 && (
          <section
            aria-labelledby={`${ids}-agenda`}
            className="flex flex-col gap-2 border-t border-border px-3 py-3"
          >
            <h4 id={`${ids}-agenda`} className={genuiType.label}>
              Agenda
            </h4>
            <ol className="flex flex-col">
              {readyAgenda.map((a, i) => (
                <motion.li
                  // biome-ignore lint/suspicious/noArrayIndexKey: agenda items may repeat and only append while streaming
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="group grid grid-cols-[4.5rem_1fr] gap-3"
                >
                  <span className={cn(genuiType.meta, "pt-px tabular-nums")}>
                    {agendaTimeText(a.time, tz, locale)}
                  </span>
                  {/* Compact timeline: a rule with a dot per item. */}
                  <div className="relative flex min-w-0 flex-col gap-0.5 border-l pb-2 pl-3 group-last:border-transparent group-last:pb-0">
                    <span
                      aria-hidden
                      className="absolute top-1.5 -left-[4.5px] size-2 rounded-full bg-foreground"
                    />
                    <span className={genuiType.body}>{a.title}</span>
                    {a.speaker && (
                      <span className={genuiType.meta}>{a.speaker}</span>
                    )}
                  </div>
                </motion.li>
              ))}
            </ol>
          </section>
        )}

        {readyPeople.length > 0 && (
          <section
            aria-labelledby={`${ids}-people`}
            className="flex flex-col gap-2 border-t border-border px-3 py-3"
          >
            <h4 id={`${ids}-people`} className={genuiType.label}>
              {peopleHeading}
            </h4>
            <ul className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {readyPeople.map((p, i) => (
                <motion.li
                  // biome-ignore lint/suspicious/noArrayIndexKey: names may repeat; people only append while streaming
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex min-w-0 flex-col"
                >
                  <span className={cn(genuiType.body, "font-medium")}>
                    {p.name}
                  </span>
                  {p.role && <span className={genuiType.meta}>{p.role}</span>}
                </motion.li>
              ))}
            </ul>
          </section>
        )}

        {streaming && readyAgenda.length === 0 && readyPeople.length === 0 && (
          <div
            aria-hidden
            className="flex flex-col gap-2 border-t border-border px-3 py-3"
          >
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        <SurfaceFooter className="flex-row flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {rsvp && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              {locked && current ? (
                <>
                  <p
                    className={cn(genuiType.body, "flex items-center gap-1.5")}
                  >
                    <CheckIcon aria-hidden className="size-4 shrink-0" />
                    {RSVP_DONE[current]}
                  </p>
                  {!closed && (
                    <WhyDisabled when={busy} reason="Saving…">
                      <Button
                        ref={changeRef}
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={reopen}
                      >
                        Change
                        <span className="sr-only"> RSVP to {name}</span>
                      </Button>
                    </WhyDisabled>
                  )}
                </>
              ) : closed ? (
                <p className={cn(genuiType.body, "text-muted-foreground")}>
                  RSVPs closed {deadline?.label}
                </p>
              ) : (
                <>
                  <span aria-hidden className={genuiType.label}>
                    RSVP
                  </span>
                  <fieldset
                    aria-label={`RSVP to ${name}`}
                    className="m-0 inline-flex min-w-0 gap-1 rounded-full border border-border bg-transparent p-1"
                  >
                    {RSVP_CHOICES.map((c) => (
                      <WhyDisabled key={c} when={busy} reason="Saving…">
                        <Button
                          ref={(el) => {
                            if (el) choiceRefs.current.set(c, el)
                            else choiceRefs.current.delete(c)
                          }}
                          size="sm"
                          variant="ghost"
                          aria-pressed={current === c}
                          disabled={busy}
                          onClick={() => choose(c)}
                          className={cn(
                            "h-8",
                            current === c &&
                              "bg-accent hover:bg-accent",
                          )}
                        >
                          {RSVP_LABEL[c]}
                        </Button>
                      </WhyDisabled>
                    ))}
                  </fieldset>
                  {editing && (
                    <Button size="sm" variant="secondary" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  )}
                </>
              )}
              {deadline && !closed && (
                <span className={genuiType.meta}>RSVP by {deadline.label}</span>
              )}
            </div>
          )}

          <div className="flex flex-auto flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p aria-live="polite" className={cn(genuiType.meta, "min-w-0")}>
              {streaming ? (
                <ShimmeringText
                  text="Loading event…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "submitting" ? (
                "Sending…"
              ) : (
                message
              )}
            </p>
            <div className="flex flex-wrap gap-2 sm:shrink-0 sm:justify-end">
              {ticketsHref &&
                (busy ? (
                  <WhyDisabled
                    className="flex flex-1 sm:flex-none"
                    reason="Wait until your reply is saved"
                  >
                    <Button size="sm" disabled className="flex-1 sm:flex-none">
                      {ticketsLabel}
                    </Button>
                  </WhyDisabled>
                ) : (
                  <a
                    href={ticketsHref}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    onClick={() => report("get-tickets")}
                    className={cn(
                      buttonVariants({ size: "sm" }),
                      "flex-1 sm:flex-none",
                    )}
                  >
                    {ticketsLabel}
                    <ExternalLinkIcon aria-hidden />
                    <span className="sr-only">
                      {` for ${name} (opens in a new tab)`}
                    </span>
                  </a>
                ))}
              <WhyDisabled
                className="flex flex-1 sm:flex-none"
                when={busy || !when || !title}
                reason="Needs a date and title"
              >
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || !when || !title}
                  onClick={addToCalendar}
                  className="flex-1 sm:flex-none"
                >
                  {done.has("add-to-calendar") ? (
                    <CheckIcon aria-hidden />
                  ) : (
                    <CalendarPlusIcon aria-hidden />
                  )}
                  Add to calendar
                </Button>
              </WhyDisabled>
              <WhyDisabled when={busy || !title} reason="Needs a title">
                <IconTip label="Share">
                  <Button
                    size="icon-sm"
                    variant="secondary"
                    disabled={busy || !title}
                    onClick={share}
                  >
                    <Share2Icon aria-hidden />
                    <span className="sr-only">Share {name}</span>
                  </Button>
                </IconTip>
              </WhyDisabled>
            </div>
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
