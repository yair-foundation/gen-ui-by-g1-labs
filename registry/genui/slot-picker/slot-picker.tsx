"use client"

import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarCheckIcon,
  CalendarClockIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  PhoneIcon,
  UsersIcon,
  UtensilsIcon,
  WrenchIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
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

import {
  type SlotDay,
  type SlotKind,
  type SlotPickerInput,
  type SlotPickerResult,
  type TimeSlot,
  formatDay,
  formatSlotTime,
  formatTimeZone,
} from "./slot-picker.schema"

export type SlotPickerStatus =
  "streaming" | "ready" | "submitting" | "selected" | "cancelled"

type PartialDay = Partial<Omit<SlotDay, "slots">> & {
  slots?: Partial<TimeSlot>[]
}
type ReadySlot = TimeSlot & { id: string; start: string }
type ReadyDay = { date: string; slots: ReadySlot[] }

export type SlotPickerProps = Partial<Omit<SlotPickerInput, "days">> & {
  /** Days and slots may be partial while the tool call is still streaming. */
  days?: PartialDay[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host books the slot.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: SlotPickerStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: SlotPickerResult) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Renders the
   * chosen slot and never calls onResult.
   */
  result?: SlotPickerResult
  className?: string
}

const isOpen = (slot: Partial<TimeSlot>) => slot.available !== false

const KIND_ICON: Record<SlotKind, typeof PhoneIcon> = {
  call: PhoneIcon,
  table: UtensilsIcon,
  service: WrenchIcon,
  meeting: UsersIcon,
  other: CalendarClockIcon,
}

const KIND_TONE: Record<SlotKind, string> = {
  call: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  table:
    "bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400",
  service: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  meeting:
    "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
  other: "bg-muted text-muted-foreground",
}

function KindIcon({ kind }: { kind: SlotKind | undefined }) {
  const k = kind ?? "other"
  const Icon = KIND_ICON[k]
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
        KIND_TONE[k],
      )}
    >
      <Icon className="size-5" />
    </span>
  )
}

/** "New York time (GMT-4)" from "America/New_York". */
function zoneText(
  timeZone: string,
  date: string | undefined,
  locale: string,
) {
  if (timeZone === "UTC") return "UTC"
  const offset = /\(([^)]+)\)$/.exec(
    formatTimeZone(timeZone, date, locale),
  )?.[1]
  const city = (timeZone.split("/").pop() ?? timeZone).replace(/_/g, " ")
  return offset ? `${city} time (${offset})` : `${city} time`
}

/** Twelve months of dates from the first day, each with its data if any. */
function calendarDays(
  ready: ReadyDay[],
  streaming: boolean,
): { date: string; day?: ReadyDay }[] {
  const plain = ready.map((d) => ({ date: d.date, day: d }))
  if (streaming || ready.length === 0) return plain
  const byDate = new Map(ready.map((d) => [d.date.slice(0, 10), d]))
  const first = [...byDate.keys()].sort()[0]
  const start = Date.parse(`${first}T12:00:00Z`)
  if (!Number.isFinite(start)) return plain
  const end = new Date(start)
  end.setUTCFullYear(end.getUTCFullYear() + 1)
  const out: { date: string; day?: ReadyDay }[] = []
  for (let t = start; t < end.getTime(); t += 86_400_000) {
    const date = new Date(t).toISOString().slice(0, 10)
    out.push({ date, day: byDate.get(date) })
  }
  return out
}

export function SlotPicker({
  kind,
  title,
  description,
  timezone = "UTC",
  days = [],
  durationLabel,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: SlotPickerProps) {
  const locale = useGenUILocale()
  const [dayChoice, setDayChoice] = React.useState<string | null>(() =>
    result?.action === "select" ? result.date : null,
  )
  const [slotChoice, setSlotChoice] = React.useState<{
    id: string
    date: string
  } | null>(() =>
    result?.action === "select"
      ? { id: result.slotId, date: result.date }
      : null,
  )
  const [decision, setDecision] = React.useState<
    "selected" | "cancelled" | null
  >(() =>
    result ? (result.action === "select" ? "selected" : "cancelled") : null,
  )
  const baseId = React.useId()
  const titleId = `${baseId}-title`

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: SlotPickerStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready" && status !== "streaming"
  const done = status === "selected" || status === "cancelled"

  const ready: ReadyDay[] = days
    .filter(
      (d): d is PartialDay & { date: string } => typeof d.date === "string",
    )
    .map((d) => ({
      date: d.date,
      slots: (d.slots ?? []).filter(
        (s): s is ReadySlot =>
          typeof s.id === "string" && typeof s.start === "string",
      ),
    }))

  const currentDay =
    ready.find((d) => d.date === dayChoice) ??
    ready.find((d) => d.slots.some(isOpen)) ??
    ready[0]

  // The strip is a calendar: twelve months from the first day, with the
  // days that have no times in between (shown faded). While streaming, just
  // the days so far.
  const calendar = calendarDays(ready, streaming)

  const chosenDay = slotChoice && ready.find((d) => d.date === slotChoice.date)
  const chosenSlot = chosenDay?.slots.find((s) => s.id === slotChoice?.id)

  const slotText = (slot: ReadySlot) =>
    slot.label ?? formatSlotTime(slot.start, timezone, locale)
  const summary = (date: string, time: string) =>
    `${formatDay(date, "long", locale)} at ${time}`
  const zoneLabel = zoneText(timezone, ready[0]?.date, locale)
  const dayRow = React.useRef<HTMLDivElement>(null)
  const dayEdges = useScrollEdges(dayRow, ready.length + (streaming ? 0 : 1))
  const scrollDays = (direction: 1 | -1) => {
    const el = dayRow.current
    if (!el) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    el.scrollBy({
      left: direction * el.clientWidth * 0.8,
      behavior: reduce ? "auto" : "smooth",
    })
  }
  // The month (or months) of the days in view, following the scroll:
  // "October 2026", or "October – November 2026" across a month change.
  const [inView, setInView] = React.useState<[string, string] | null>(null)
  const monthOf = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
  const firstShown = inView?.[0] ?? calendar[0]?.date
  const lastShown = inView?.[1] ?? calendar[0]?.date
  const monthLabel = firstShown
    ? firstShown.slice(0, 7) === lastShown?.slice(0, 7) || !lastShown
      ? monthOf(firstShown)
      : `${new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${firstShown.slice(0, 10)}T12:00:00Z`))} – ${monthOf(lastShown)}`
    : ""

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-binds when the days change
  React.useEffect(() => {
    const row = dayRow.current
    if (!row) return
    const update = () => {
      const box = row.getBoundingClientRect()
      const shown = [...row.querySelectorAll<HTMLElement>("[data-date]")]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.right > box.left + 36 && r.left < box.right - 36
        })
        .map((el) => el.dataset.date ?? "")
      if (shown.length === 0) return
      const next: [string, string] = [shown[0], shown[shown.length - 1]]
      setInView((prev) =>
        prev && prev[0] === next[0] && prev[1] === next[1] ? prev : next,
      )
    }
    update()
    row.addEventListener("scroll", update, { passive: true })
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    resize?.observe(row)
    return () => {
      row.removeEventListener("scroll", update)
      resize?.disconnect()
    }
  }, [calendar.length])

  const confirm = () => {
    if (!slotChoice || !chosenSlot || streaming || locked) return
    setDecision("selected")
    onResult?.({
      action: "select",
      slotId: chosenSlot.id,
      date: slotChoice.date,
      start: chosenSlot.start,
      label: summary(slotChoice.date, slotText(chosenSlot)),
    })
  }

  const cancel = () => {
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  // One quiet line: what it is and how long; the zone gets its own clock.
  const metaLine = [description, durationLabel].filter(Boolean).join(" · ")

  // Selected or cancelled: a compact record for the chat history.
  if (done) {
    const time =
      result?.action === "select"
        ? chosenSlot
          ? slotText(chosenSlot)
          : formatSlotTime(result.start, timezone, locale)
        : chosenSlot
          ? slotText(chosenSlot)
          : null
    const date =
      result?.action === "select" ? result.date : (slotChoice?.date ?? "")
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="slot-picker"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader className="flex-row items-center gap-3 pb-3">
            <KindIcon kind={kind} />
            <SurfaceTitle id={titleId} className="min-w-0 flex-1">
              {title}
            </SurfaceTitle>
            <p
              aria-live="polite"
              className={cn(genuiType.meta, "flex shrink-0 items-center gap-1")}
            >
              {status === "selected" && time ? (
                <>
                  <CheckIcon aria-hidden className="size-3.5" />
                  Selected
                  <span className="sr-only">: {summary(date, time)}</span>
                </>
              ) : (
                <>
                  <XIcon aria-hidden className="size-3.5" />
                  Cancelled
                  <span className="sr-only">. No time was picked.</span>
                </>
              )}
            </p>
          </SurfaceHeader>
          {status === "selected" && time ? (
            <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
              <p className={genuiType.stat}>{time}</p>
              <p className={genuiType.body}>
                {formatDay(date, "long", locale)}
                {durationLabel && ` · ${durationLabel}`}
                {zoneLabel && (
                  <span className="text-muted-foreground"> · {zoneLabel}</span>
                )}
              </p>
            </div>
          ) : null}
        </Surface>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="slot-picker"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <KindIcon kind={kind} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            <SurfaceDescription className="flex flex-wrap items-center gap-x-1.5">
              {metaLine && <span>{metaLine}</span>}
              {metaLine && <span aria-hidden>·</span>}
              <span className="inline-flex items-center gap-1">
                <ClockIcon aria-hidden className="size-3.5" />
                {zoneLabel}
              </span>
            </SurfaceDescription>
          </div>
        </SurfaceHeader>

        {/* Days: a calendar strip (big date, weekday, tick). Scrolls sideways on
            narrow screens. One day is just a heading. */}
        {!streaming && ready.length === 1 ? null : (
          <fieldset className="min-w-0 border-t border-border">
            <legend className="sr-only">Day</legend>
            <div className="flex min-h-11 items-center justify-between gap-2 px-3 pt-2">
              <p
                aria-live="polite"
                className="text-[16px] leading-6 font-semibold whitespace-nowrap"
              >
                {monthLabel}
              </p>
              {(dayEdges.prev || dayEdges.next) && (
                <div className="flex items-center gap-1">
                  <WhyDisabled when={!dayEdges.prev} reason="First day">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Earlier days"
                      disabled={!dayEdges.prev}
                      onClick={() => scrollDays(-1)}
                      className="hover:bg-muted dark:hover:bg-white/10"
                    >
                      <ArrowLeftIcon aria-hidden />
                    </Button>
                  </WhyDisabled>
                  <WhyDisabled when={!dayEdges.next} reason="Last day">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Later days"
                      disabled={!dayEdges.next}
                      onClick={() => scrollDays(1)}
                      className="hover:bg-muted dark:hover:bg-white/10"
                    >
                      <ArrowRightIcon aria-hidden />
                    </Button>
                  </WhyDisabled>
                </div>
              )}
            </div>
            <div className="relative">
              <div
                ref={dayRow}
                className="flex snap-x snap-mandatory scroll-px-3 gap-1 overflow-x-auto overscroll-x-contain px-3 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                {calendar.map(({ date, day }) => {
                  const open = day ? day.slots.filter(isOpen).length : 0
                  const pressed = currentDay?.date === date
                  const loading = streaming && (day?.slots.length ?? 0) === 0
                  const full = !loading && open === 0
                  return (
                    <WhyDisabled
                      key={date}
                      when={full && !locked}
                      reason={day ? "Fully booked" : "No open times"}
                      className="flex min-w-[4.5rem] flex-1 shrink-0 snap-start"
                    >
                      <button
                        type="button"
                        data-date={date}
                        aria-pressed={pressed}
                        disabled={full || locked}
                        onClick={() => setDayChoice(date)}
                        className="group/day flex w-full min-w-[4.5rem] flex-1 shrink-0 snap-start flex-col items-center gap-1.5 rounded-[12px] py-2 text-center outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:hover:bg-transparent dark:hover:bg-white/5"
                      >
                        <span
                          className={cn(
                            "font-figure text-[36px] leading-none font-normal tracking-tight tabular-nums lining-nums transition-colors",
                            pressed
                              ? "text-foreground"
                              : full
                                ? "text-muted-foreground/25"
                                : "text-muted-foreground/55 group-hover/day:text-foreground/80",
                          )}
                        >
                          {date.slice(8, 10)}
                        </span>
                        <span
                          className={cn(
                            "text-[13px] leading-none lowercase",
                            pressed
                              ? "font-medium text-foreground"
                              : full
                                ? "text-muted-foreground/40"
                                : "text-muted-foreground",
                          )}
                        >
                          {formatDay(date, "weekday", locale)}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "mt-1 h-4 w-0.5 origin-top rounded-full transition-[scale,background-color]",
                            pressed
                              ? "bg-choice"
                              : full
                                ? "scale-y-75 bg-transparent"
                                : "scale-y-75 bg-muted-foreground/40",
                          )}
                        />
                        <span className="sr-only">
                          {`, ${formatDay(date, "date", locale)}`}
                          {loading
                            ? ", loading"
                            : !day
                              ? ", no open times"
                              : full
                                ? ", full"
                                : `, ${open} open`}
                        </span>
                      </button>
                    </WhyDisabled>
                  )
                })}
                {streaming &&
                  Array.from({ length: ready.length ? 1 : 4 }, (_, i) => (
                    <Skeleton
                      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                      key={i}
                      className="h-20 min-w-[4.5rem] flex-1 shrink-0 rounded-[12px]"
                    />
                  ))}
              </div>
              <ScrollFades edges={dayEdges} />
            </div>
          </fieldset>
        )}

        <AutoHeight className="@container">
          <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
            {!streaming && ready.length === 1 && currentDay && (
              <p
                className={cn(
                  genuiType.label,
                  "mb-1 flex items-center gap-1.5 text-foreground",
                )}
              >
                <CalendarIcon
                  aria-hidden
                  className="size-3.5 text-muted-foreground"
                />
                {formatDay(currentDay.date, "long", locale)}
              </p>
            )}
            {currentDay && currentDay.slots.length > 0 ? (
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className="sr-only">
                  Times on {formatDay(currentDay.date, "long", locale)}
                </legend>
                <p aria-hidden className={genuiType.label}>
                  Time
                </p>
                <div
                  className={cn(
                    "grid gap-2",
                    currentDay.slots.length <= 6
                      ? "grid-cols-3"
                      : "grid-cols-3 @md:grid-cols-4",
                  )}
                >
                  {currentDay.slots.map((slot) => {
                    const open = isOpen(slot)
                    const pressed =
                      slotChoice?.id === slot.id &&
                      slotChoice.date === currentDay.date
                    return (
                      <motion.div
                        key={slot.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={genuiMotion.fade}
                      >
                        <WhyDisabled
                          when={!open && !locked}
                          reason="Already taken"
                          className="flex w-full"
                        >
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-pressed={pressed}
                            disabled={!open || locked}
                            onClick={() =>
                              setSlotChoice({
                                id: slot.id,
                                date: currentDay.date,
                              })
                            }
                            className={cn(
                              "h-10 w-full rounded-[10px] text-[14px] tabular-nums",
                              pressed &&
                                "bg-accent ring-2 ring-choice ring-inset dark:bg-accent",
                              !open &&
                                "border-transparent bg-transparent text-muted-foreground disabled:opacity-40 dark:border-transparent dark:bg-transparent",
                            )}
                          >
                            {pressed && (
                              <CheckIcon aria-hidden className="size-4" />
                            )}
                            {slotText(slot)}
                            {!open && <span className="sr-only">, taken</span>}
                          </Button>
                        </WhyDisabled>
                      </motion.div>
                    )
                  })}
                </div>
              </fieldset>
            ) : streaming ? (
              <div aria-hidden className="grid grid-cols-3 gap-2">
                {Array.from({ length: 4 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                  <Skeleton key={i} className="h-10 rounded-[10px]" />
                ))}
              </div>
            ) : (
              <p className={cn(genuiType.body, "text-muted-foreground")}>
                No open times
              </p>
            )}
          </div>
        </AutoHeight>

        <SurfaceFooter className="justify-between gap-3">
          <p aria-live="polite" className={genuiType.meta}>
            {streaming ? (
              <ShimmeringText
                text="Checking availability…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : status === "submitting" ? (
              "Booking…"
            ) : chosenSlot && slotChoice ? (
              <span className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
                <CalendarCheckIcon
                  aria-hidden
                  className="size-4 shrink-0 text-muted-foreground"
                />
                {summary(slotChoice.date, slotText(chosenSlot))}
              </span>
            ) : null}
          </p>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={cancel}
              disabled={locked}
            >
              Cancel
            </Button>
            <WhyDisabled
              when={!chosenSlot || streaming || locked}
              reason={
                streaming
                  ? "Checking availability…"
                  : status === "submitting"
                    ? "Booking…"
                    : "Pick a time first"
              }
            >
              <Button
                size="sm"
                onClick={confirm}
                disabled={!chosenSlot || streaming || locked}
              >
                {status === "submitting"
                  ? "Booking…"
                  : (submitLabel ?? "Confirm")}
              </Button>
            </WhyDisabled>
          </div>
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
