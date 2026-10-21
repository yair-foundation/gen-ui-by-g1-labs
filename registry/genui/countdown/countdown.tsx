"use client"

import * as React from "react"
import {
  CalendarIcon,
  CalendarPlusIcon,
  CheckIcon,
  CircleIcon,
  ExternalLinkIcon,
  Share2Icon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  genuiMotion,
} from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"

import {
  buildIcs,
  businessDaysBetween,
  type CountdownState,
  countdownState,
  dayKey,
  daysBetween,
  formatShortDate,
  formatTargetDate,
  formatUnit,
  icsFilename,
  isAtSettled,
  isValidTimeZone,
  MINUTE,
  milestoneDate,
  type Precision,
  readout,
  relativeDays,
  resolveTarget,
  SECOND,
  safeUrl,
  spokenReadout,
  type Target,
  unitWord,
  viewerTimeZone,
  waitProgress,
} from "./countdown-utils"
import type {
  CountdownEvent,
  CountdownInput,
  CountdownMilestone,
  CountdownResult,
} from "./countdown.schema"
import { WhyDisabled } from "@/components/genui/hint"

export type CountdownStatus = "streaming" | "ready"

export type CountdownProps = Partial<
  Omit<CountdownInput, "events" | "milestones">
> & {
  /** Events may be partial while the tool call streams. */
  events?: Partial<CountdownEvent>[]
  milestones?: Partial<CountdownMilestone>[]
  /** Lifecycle, controlled by the host. */
  status?: CountdownStatus
  /** Called when the user adds the event to a calendar or shares it. For analytics; nothing locks. */
  onResult?: (result: CountdownResult) => void
  /**
   * A fixed current time (epoch ms), for tests. Omit it: the countdown then
   * reads the viewer's clock after mount and keeps ticking.
   */
  now?: number
  className?: string
}

type ResolvedEvent = {
  id: string
  label: string
  note?: string
  url: string | null
  target: Target
  since: number | null
  /** The event named a valid zone, so timed dates show it. */
  zoned: boolean
}

const PRECISIONS: Precision[] = ["days", "hours", "minutes", "seconds"]

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Screen readers get minutes at most, so the readout doesn't change every second. */
function spokenState(state: CountdownState): CountdownState {
  return state.precision === "seconds"
    ? { ...state, precision: "minutes" }
    : state
}

/** The sentence a screen reader hears, also the share text's source. */
function describe(
  event: ResolvedEvent,
  state: CountdownState,
  locale: string,
): { short: string; full: string; date: string } {
  const date = formatTargetDate(event.target, {
    showZone: event.zoned,
    locale,
  })
  const label = event.label
  if (state.phase === "upcoming") {
    const short = `${spokenReadout(readout(spokenState(state)))} until ${label}`
    return { short, full: `${short}, on ${date}`, date }
  }
  if (state.phase === "today") {
    const short = `${capitalize(label)} is today`
    return { short, full: `${short}, ${date}`, date }
  }
  const short = `${capitalize(label)} was ${relativeDays(state.calendarDays)}`
  return { short, full: `${short}, on ${date}`, date }
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

export function Countdown({
  events = [],
  precision: precisionProp,
  countBusinessDays = false,
  milestones,
  status: statusProp,
  onResult,
  now: fixedNow,
  className,
}: CountdownProps) {
  const locale = useGenUILocale()
  const status: CountdownStatus = statusProp ?? "ready"
  const streaming = status === "streaming"

  // Null until mounted (unless `now` is given), so server and client render
  // the same markup; the countdown itself appears after mount.
  const [clock, setClock] = React.useState<number | null>(fixedNow ?? null)
  const [zone, setZone] = React.useState<string | null>(
    fixedNow !== undefined ? viewerTimeZone() : null,
  )
  const [copied, setCopied] = React.useState(false)
  const [arrival, setArrival] = React.useState("")
  const copiedTimer = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    setZone(viewerTimeZone())
    setClock(fixedNow ?? Date.now())
  }, [fixedNow])

  React.useEffect(() => () => window.clearTimeout(copiedTimer.current), [])

  const precision = PRECISIONS.includes(precisionProp as Precision)
    ? precisionProp
    : undefined
  const topLevelAfter =
    precisionProp !== undefined ||
    milestones !== undefined ||
    countBusinessDays !== false

  const resolved: (ResolvedEvent | null)[] = events.map((e, i) => {
    if (!zone || typeof e.id !== "string" || typeof e.label !== "string") {
      return null
    }
    const somethingAfter =
      i < events.length - 1 ||
      e.timeZone !== undefined ||
      e.since !== undefined ||
      e.note !== undefined ||
      e.url !== undefined ||
      topLevelAfter
    if (!isAtSettled(e.at, streaming, somethingAfter)) return null
    const target = resolveTarget(e.at, e.timeZone, zone)
    if (!target) return null
    const since = e.since
      ? (resolveTarget(e.since, e.timeZone, zone)?.instant ?? null)
      : null
    return {
      id: e.id,
      label: e.label,
      note: e.note,
      url: safeUrl(e.url),
      target,
      since,
      zoned: isValidTimeZone(e.timeZone),
    }
  })

  const hero = resolved[0] ?? null
  const heroLabel = events[0]?.label
  const heroState =
    hero && clock !== null
      ? countdownState(hero.target, clock, precision)
      : null
  const heroText = hero && heroState ? describe(hero, heroState, locale) : null
  const today =
    hero && clock !== null ? dayKey(clock, hero.target.timeZone) : ""

  // Ticking: wake exactly when the shown value changes (each second at
  // seconds precision, else each minute, which also catches midnight).
  const heroInstant = hero?.target.instant ?? null
  const perSecond =
    heroState?.phase === "upcoming" && heroState.precision === "seconds"
  React.useEffect(() => {
    if (fixedNow !== undefined || clock === null || heroInstant === null) return
    const step = perSecond ? SECOND : MINUTE
    const remaining = heroInstant - clock
    const delay =
      remaining > 0 ? Math.min(MINUTE, (remaining % step) + 20) : MINUTE
    const id = window.setTimeout(() => setClock(Date.now()), delay)
    return () => window.clearTimeout(id)
  }, [clock, fixedNow, heroInstant, perSecond])

  // Timeouts are throttled in background tabs: catch up when shown again.
  React.useEffect(() => {
    if (fixedNow !== undefined) return
    const onVisibility = () => {
      if (!document.hidden) setClock(Date.now())
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [fixedNow])

  // Announce once when the day arrives while the countdown is on screen.
  const phase = heroState?.phase
  const prevPhase = React.useRef(phase)
  React.useEffect(() => {
    if (prevPhase.current === "upcoming" && phase === "today" && heroLabel) {
      setArrival(`${capitalize(heroLabel)} is today`)
    }
    prevPhase.current = phase
  }, [phase, heroLabel])

  // Sections --------------------------------------------------------------
  const progress =
    hero && heroState && hero.since !== null && clock !== null
      ? waitProgress(hero.since, clock, hero.target.instant)
      : null
  const percent =
    progress === null
      ? null
      : heroState?.phase === "upcoming"
        ? Math.min(99, Math.floor(progress * 100))
        : 100

  const workingDays =
    countBusinessDays && hero && heroState?.phase === "upcoming"
      ? businessDaysBetween(today, hero.target.date)
      : null

  const steps =
    hero && heroState
      ? (milestones ?? [])
          .filter(
            (m): m is CountdownMilestone =>
              typeof m.label === "string" &&
              m.label !== "" &&
              typeof m.daysBefore === "number" &&
              Number.isFinite(m.daysBefore),
          )
          .map((m) => {
            const date = milestoneDate(hero.target.date, m.daysBefore)
            return { ...m, date, diff: daysBetween(today, date) }
          })
          .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
      : []

  const others =
    clock !== null
      ? resolved
          .slice(1)
          .filter((e): e is ResolvedEvent => e !== null)
          .map((e) => ({ event: e, state: countdownState(e.target, clock) }))
          .sort((a, b) => {
            const pa = a.state.phase === "past"
            const pb = b.state.phase === "past"
            if (pa !== pb) return pa ? 1 : -1
            return pa
              ? b.event.target.instant - a.event.target.instant
              : a.event.target.instant - b.event.target.instant
          })
      : []

  // Actions ----------------------------------------------------------------
  const actionable = !streaming && hero !== null && heroText !== null

  const addToCalendar = () => {
    if (!hero) return
    downloadFile(
      icsFilename(hero.label),
      buildIcs({
        uid: `${hero.id}-${hero.target.instant}@genui-countdown`,
        title: capitalize(hero.label),
        description: hero.note,
        url: hero.url ?? undefined,
        target: hero.target,
        stamp: Date.now(),
      }),
      "text/calendar;charset=utf-8",
    )
    onResult?.({ action: "add-to-calendar", eventId: hero.id })
  }

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
  }

  const share = async () => {
    if (!hero || !heroText) return
    const text = heroText.short
    try {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ text })
        } catch (error) {
          // The user closed the share sheet: nothing happened.
          if (error instanceof DOMException && error.name === "AbortError") {
            return
          }
          await copy(text)
        }
      } else {
        await copy(text)
      }
      onResult?.({ action: "share", eventId: hero.id })
    } catch {
      // Clipboard blocked: nothing to report.
    }
  }

  const label = hero?.label ?? heroLabel
  const r = heroState?.phase === "upcoming" ? readout(heroState) : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="countdown"
        data-status={status}
        data-phase={phase}
        aria-busy={streaming}
        aria-label={label ? `Countdown to ${label}` : "Countdown"}
        className={className}
      >
        {/* Hero */}
        <div className="flex flex-col gap-1 px-3 py-3">
          {hero && heroState && heroText ? (
            <>
              <h3 className="sr-only">{heroText.full}</h3>
              {/* The live value is visual only; the sentence above is the accessible readout. */}
              <div aria-hidden className="flex flex-col gap-1">
                {heroState.phase === "upcoming" && r ? (
                  <>
                    <p className="flex items-baseline gap-2">
                      <span className="font-figure lining-nums text-[44px] leading-[1.2] font-normal tracking-tight tabular-nums">
                        <SlidingNumber number={r.lead.value} initiallyStable />
                      </span>
                      <span className="text-[16px] font-medium">
                        {unitWord(r.lead)}
                      </span>
                    </p>
                    {r.rest.length > 0 && (
                      <p className="text-[13px] tabular-nums text-muted-foreground">
                        and {r.rest.map(formatUnit).join(" ")}
                      </p>
                    )}
                    <p className={cn("mt-1", genuiType.body)}>
                      until {hero.label}
                    </p>
                  </>
                ) : heroState.phase === "today" ? (
                  <>
                    <p className="font-figure lining-nums text-[44px] leading-[1.2] font-normal tracking-tight">
                      Today
                    </p>
                    <p className={cn("mt-1", genuiType.body)}>
                      {capitalize(hero.label)}
                    </p>
                  </>
                ) : (
                  <p className="text-[16px] font-medium text-muted-foreground">
                    {heroText.short}
                  </p>
                )}
              </div>
              <p className={genuiType.meta}>
                <span aria-hidden>
                  <CalendarIcon className="mr-1 -mt-0.5 inline size-3.5 shrink-0 align-middle" />
                  {heroText.date}
                </span>
                {workingDays !== null && (
                  <>
                    {" · "}
                    <span className="tabular-nums">{workingDays}</span> working{" "}
                    {workingDays === 1 ? "day" : "days"} left
                  </>
                )}
                {hero.note && <span className="sr-only">. {hero.note}</span>}
                {hero.url && (
                  <>
                    {" · "}
                    <a
                      href={hero.url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex min-h-6 items-center gap-1 rounded-sm underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      {new URL(hero.url).hostname}
                      <ExternalLinkIcon aria-hidden className="size-3" />
                      <span className="sr-only">(opens in a new tab)</span>
                    </a>
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <Skeleton className="h-12 w-40" />
              {label ? (
                <p className={cn("mt-1", genuiType.body)}>until {label}</p>
              ) : (
                <Skeleton className="mt-1 h-4 w-32" />
              )}
              <Skeleton className="h-4 w-52" />
            </>
          )}
        </div>

        {/* Progress since the wait began */}
        {hero && percent !== null && hero.since !== null && (
          <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
            <div
              aria-hidden
              className="h-1.5 overflow-hidden rounded-full bg-muted dark:bg-white/10"
            >
              <motion.div
                className={cn(
                  "h-full rounded-full",
                  percent >= 100
                    ? "bg-emerald-500 dark:bg-emerald-400"
                    : "bg-choice",
                )}
                initial={false}
                animate={{ width: `${percent}%` }}
                transition={genuiMotion.gentle}
              />
            </div>
            <p className={cn(genuiType.meta, "tabular-nums")}>
              {percent >= 100
                ? "The wait is over"
                : `${percent}% of the wait is over`}
              <span className="sr-only">
                , started{" "}
                {formatShortDate(
                  dayKey(hero.since, hero.target.timeZone),
                  today,
                  { locale },
                )}
              </span>
            </p>
          </div>
        )}

        {/* Milestones before the first event */}
        {hero && steps.length > 0 && (
          <section className="flex flex-col border-t border-border py-2">
            <h4 className="sr-only">Before {hero.label}</h4>
            <ul className="flex flex-col">
              {steps.map((m) => {
                const passed = m.diff < 0
                return (
                  <motion.li
                    key={`${m.daysBefore}:${m.label}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    className="flex items-start gap-3 px-3 py-2 text-[13px]"
                  >
                    {passed ? (
                      <CheckIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    ) : (
                      <CircleIcon
                        aria-hidden
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      {passed && <span className="sr-only">Past: </span>}
                      {m.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-right tabular-nums",
                        genuiType.meta,
                      )}
                    >
                      {formatShortDate(m.date, today, { locale })} · {relativeDays(m.diff)}
                    </span>
                  </motion.li>
                )
              })}
            </ul>
          </section>
        )}

        {/* Other events, soonest first */}
        {others.length > 0 && (
          <section className="border-t border-border py-2">
            <h4 className="sr-only">Other dates</h4>
            <ul className="flex flex-col">
              {others.map(({ event, state }) => (
                <motion.li
                  key={event.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex items-baseline gap-3 px-3 py-2.5"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={genuiType.body}>
                      {capitalize(event.label)}
                    </span>
                    <span className={genuiType.meta}>
                      {formatShortDate(event.target.date, today, { locale })}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-right text-[13px] font-medium tabular-nums",
                      state.phase === "past" && "text-muted-foreground",
                    )}
                  >
                    {capitalize(
                      relativeDays(
                        state.phase === "today" ? 0 : state.calendarDays,
                      ),
                    )}
                  </span>
                </motion.li>
              ))}
            </ul>
          </section>
        )}

        <SurfaceFooter className="justify-between">
          <p
            aria-live="polite"
            className="min-w-0 text-[13px] text-muted-foreground"
          >
            {streaming ? (
              <ShimmeringText
                text="Loading countdown…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : (
              <span className="sr-only">{copied ? "Copied" : ""}</span>
            )}
          </p>
          <div className="ml-auto flex flex-wrap gap-2">
            <WhyDisabled
              when={!actionable}
              reason="Waiting for the countdown to load"
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={!actionable}
                onClick={addToCalendar}
                aria-label={
                  label ? `Add to calendar: ${label}` : "Add to calendar"
                }
              >
                <CalendarPlusIcon aria-hidden />
                Add to calendar
              </Button>
            </WhyDisabled>
            <WhyDisabled
              when={!actionable}
              reason="Waiting for the countdown to load"
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={!actionable}
                onClick={share}
                aria-label={label ? `Share countdown: ${label}` : "Share"}
              >
                {copied ? (
                  <CheckIcon aria-hidden />
                ) : (
                  <Share2Icon aria-hidden />
                )}
                {copied ? "Copied" : "Share"}
              </Button>
            </WhyDisabled>
          </div>
        </SurfaceFooter>

        {/* Announced once when the day arrives. */}
        <p aria-live="polite" className="sr-only">
          {arrival}
        </p>
      </Surface>
    </MotionConfig>
  )
}
