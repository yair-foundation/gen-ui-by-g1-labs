"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  CheckIcon,
  MessageSquareIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"

import type {
  CalendarEvent,
  CalendarInput,
  CalendarProposal,
  CalendarResult,
  CalendarTodo,
  CalendarView,
} from "./calendar.schema"
import {
  type Interval,
  applyProposals,
  compareIntervals,
  dayKeyOf,
  dayRange,
  diffDays,
  eventInterval,
  findConflicts,
  firstDayOfWeek,
  formatDay,
  formatDuration,
  formatHour,
  formatRangeLabel,
  formatTime,
  formatTimeShort,
  formatWeekdayAt,
  isBusy,
  layoutColumns,
  monthGrid,
  normalizeDayKey,
  parseInstant,
  safeTimeZone,
  segmentOnDay,
  startOfMonth,
} from "./calendar-utils"

export type CalendarStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "applied"
  | "revised"
  | "dismissed"

type ReadyEvent = CalendarEvent & {
  id: string
  title: string
  start: string
  end: string
}
type ReadyProposal = CalendarProposal & {
  id: string
  title: string
  start: string
  end: string
}

export type CalendarProps = Partial<
  Omit<CalendarInput, "range" | "events" | "proposals" | "todos" | "workingHours">
> & {
  range?: Partial<CalendarInput["range"]>
  /** Events, to-dos and proposals may be partial while the tool call streams. */
  events?: Partial<CalendarEvent>[]
  todos?: Partial<CalendarTodo>[]
  proposals?: Partial<CalendarProposal>[]
  workingHours?: Partial<NonNullable<CalendarInput["workingHours"]>>
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host writes the changes.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: CalendarStatus
  /** Called once with the user's decision. Only used when there are proposals. */
  onResult?: (result: CalendarResult) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Renders the
   * decided schedule and never calls onResult.
   */
  result?: CalendarResult
  className?: string
}

/* ------------------------------------------------------------------------ */
/* Items: what the views draw                                               */
/* ------------------------------------------------------------------------ */

type ItemState =
  | "event"
  | "proposed"
  | "moving"
  | "cancelling"
  | "added"
  | "moved"

type Item = {
  /** Unique across events and proposals. */
  key: string
  title: string
  iv: Interval
  state: ItemState
  busy: boolean
  /** Titles of busy events a proposal overlaps. */
  conflicts: string[]
}

const VIEWS: CalendarView[] = ["week", "day", "month", "today"]

/** What a block's state means, said in words: the sr text never relies on the look. */
const STATE_TEXT: Partial<Record<ItemState, string>> = {
  proposed: "proposed",
  moving: "proposed to move from here",
  cancelling: "proposed to cancel",
  added: "added",
  moved: "moved",
}

/**
 * The schedule's look (D71): every event a soft neutral block; a change (a
 * proposal, or one just applied) the solid foreground block; the slot a move
 * leaves and an event being cancelled a dashed outline; a free event hollow.
 */
const BUSY_FILL = "bg-foreground/[0.09] dark:bg-foreground/[0.2]"
const CHANGED_FILL = "bg-foreground text-background"
const DASHED = "border border-dashed border-foreground/45"
const FREE = "border border-border text-muted-foreground"

const isChanged = (item: Item) =>
  item.state === "proposed" || item.state === "added" || item.state === "moved"
const isStruck = (item: Item) =>
  item.state === "moving" || item.state === "cancelling"

function itemTone(item: Item) {
  if (isChanged(item)) return CHANGED_FILL
  if (isStruck(item)) return cn(DASHED, "text-muted-foreground")
  return item.busy ? BUSY_FILL : FREE
}

/**
 * Times and days on the schedule: 'MON 12', '9A', '9:30 AM', '15 MIN'.
 * The `schedule-label` role in the design foundations.
 */
const SCHEDULE_LABEL =
  "font-mono text-[13px] uppercase leading-none tracking-[0.06em] tabular-nums"

const isReadyEvent = (e: Partial<CalendarEvent>): e is ReadyEvent =>
  typeof e.id === "string" &&
  typeof e.title === "string" &&
  typeof e.start === "string" &&
  typeof e.end === "string"

const isReadyProposal = (p: Partial<CalendarProposal>): p is ReadyProposal =>
  typeof p.id === "string" &&
  typeof p.title === "string" &&
  typeof p.start === "string" &&
  typeof p.end === "string" &&
  (p.kind === "create" ||
    ((p.kind === "move" || p.kind === "cancel") &&
      typeof p.eventId === "string"))

const isReadyTodo = (t: Partial<CalendarTodo>): t is CalendarTodo =>
  typeof t.id === "string" && typeof t.title === "string"

function parseHHmm(value: string | undefined): number | null {
  const m = value ? /^(\d{1,2}):(\d{2})$/.exec(value) : null
  if (!m) return null
  const min = Number(m[1]) * 60 + Number(m[2])
  return min >= 0 && min <= 1440 ? min : null
}

function joinTitles(titles: string[]) {
  if (titles.length <= 1) return titles[0] ?? ""
  if (titles.length === 2) return `${titles[0]} and ${titles[1]}`
  return `${titles[0]} and ${titles.length - 1} more`
}

/** Whether an item touches a day. */
const onDay = (item: Item, day: string) =>
  diffDays(item.iv.startKey, day) >= 0 && diffDays(day, item.iv.endKey) > 0

/* ------------------------------------------------------------------------ */
/* Component                                                                */
/* ------------------------------------------------------------------------ */

export function Calendar({
  title,
  timezone,
  view: viewProp,
  range,
  events = [],
  todos = [],
  proposals = [],
  workingHours,
  now,
  status: statusProp,
  onResult,
  result,
  className,
}: CalendarProps) {
  const locale = useGenUILocale()
  const tz = safeTimeZone(timezone)
  const baseId = React.useId()
  const titleId = `${baseId}-title`

  /* Decision state, restored from `result`. */
  const [declined, setDeclined] = React.useState<Set<string>>(
    () => new Set(result?.action === "apply" ? result.declined : []),
  )
  const [decision, setDecision] = React.useState<
    "applied" | "revised" | "dismissed" | null
  >(() =>
    result
      ? (
          { apply: "applied", revise: "revised", dismiss: "dismissed" } as const
        )[result.action]
      : null,
  )
  const [revising, setRevising] = React.useState(false)
  const [feedback, setFeedback] = React.useState(
    result?.action === "revise" ? result.feedback : "",
  )

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: CalendarStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  // The viewer's clock, for today and what's on now.
  const [clock, setClock] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (now) return
    setClock(Date.now())
    const timer = window.setInterval(() => setClock(Date.now()), 60000)
    return () => window.clearInterval(timer)
  }, [now])
  const nowT = (now ? parseInstant(now, tz) : null) ?? clock
  const todayKey = nowT === null ? null : dayKeyOf(nowT, tz)

  /* Data. */
  const readyEvents = events.filter(isReadyEvent)
  const readyProposals = proposals.filter(isReadyProposal)
  const readyTodos = todos.filter(isReadyTodo)
  const hasProposals = readyProposals.length > 0
  const isAccepted = (id: string) => !declined.has(id)
  const acceptedIds = readyProposals
    .filter((p) => isAccepted(p.id))
    .map((p) => p.id)

  const items: Item[] = (() => {
    const out: Item[] = []
    if (status === "applied") {
      // Decided: the resulting schedule, with what changed marked.
      for (const e of applyProposals(readyEvents, readyProposals, acceptedIds)) {
        const iv = eventInterval(e, tz)
        if (!iv) continue
        out.push({
          key: e.change === "added" ? `p:${e.id}` : `e:${e.id}`,
          title: e.title,
          iv,
          state: e.change ?? "event",
          busy: isBusy(e),
          conflicts: [],
        })
      }
      return out.sort((a, b) => compareIntervals(a.iv, b.iv))
    }

    // Reviewing: accepted proposals drawn over the real schedule.
    const showAll = status === "revised" || status === "dismissed"
    const active = readyProposals.filter((p) => showAll || isAccepted(p.id))
    const conflicts = findConflicts(
      readyEvents,
      readyProposals,
      tz,
      active.map((p) => p.id),
    )
    const byEvent = new Map(
      active.filter((p) => p.kind !== "create").map((p) => [p.eventId, p]),
    )
    for (const e of readyEvents) {
      const iv = eventInterval(e, tz)
      if (!iv) continue
      const p = byEvent.get(e.id)
      out.push({
        key: `e:${e.id}`,
        title: e.title,
        iv,
        state: p ? (p.kind === "move" ? "moving" : "cancelling") : "event",
        busy: isBusy(e),
        conflicts: [],
      })
    }
    for (const p of active) {
      if (p.kind === "cancel") continue
      const iv = eventInterval(p, tz)
      if (!iv) continue
      const original =
        p.kind === "move"
          ? readyEvents.find((e) => e.id === p.eventId)
          : undefined
      out.push({
        key: `p:${p.id}`,
        title: original?.title ?? p.title,
        iv,
        state: "proposed",
        busy: true,
        conflicts: (conflicts.get(p.id) ?? []).map((c) => c.title),
      })
    }
    return out.sort((a, b) => compareIntervals(a.iv, b.iv))
  })()

  /* The period shown. */
  const view: CalendarView = VIEWS.includes(viewProp as CalendarView)
    ? (viewProp as CalendarView)
    : "week"
  const rangeStart =
    normalizeDayKey(range?.start) ??
    // Without a range, wait while streaming; then fall back to the events.
    (streaming ? null : items[0]?.iv.startKey || todayKey || null)
  const gridDays =
    view === "day" || view === "today"
      ? 1
      : Math.min(7, Math.max(1, Math.round(range?.days ?? 7)))
  const days = rangeStart ? dayRange(rangeStart, gridDays) : []
  const monthStart = rangeStart ? startOfMonth(rangeStart) : null
  const periodLabel = !rangeStart
    ? null
    : view === "month"
      ? formatDay(rangeStart, "month", locale)
      : formatRangeLabel(rangeStart, gridDays, locale)

  /* Labels. */
  const timeText = (t: number) => formatTime(t, tz, locale)
  const shortAt = (t: number) =>
    `${formatWeekdayAt(t, tz, "short", locale)} ${timeText(t)}`
  const itemLabel = (item: Item) => {
    const { iv } = item
    const when = iv.allDay
      ? "all day"
      : iv.end <= iv.start
        ? timeText(iv.start)
        : dayKeyOf(iv.start, tz) === dayKeyOf(iv.end - 1, tz)
          ? `${timeText(iv.start)} to ${timeText(iv.end)}`
          : `${shortAt(iv.start)} to ${shortAt(iv.end)}`
    const parts = [item.title, when]
    if (STATE_TEXT[item.state]) parts.push(STATE_TEXT[item.state] as string)
    if (!item.busy && item.state === "event" && !iv.allDay) parts.push("free")
    if (item.conflicts.length) {
      parts.push(`conflicts with ${joinTitles(item.conflicts)}`)
    }
    return parts.join(", ")
  }

  const summaryOf = (p: ReadyProposal) => {
    const start = parseInstant(p.start, tz)
    const end = parseInstant(p.end, tz)
    const original = readyEvents.find((e) => e.id === p.eventId)
    const name = original?.title ?? p.title
    if (start === null) return { verb: p.kind, name, when: "" }
    const span = `${shortAt(start)}${end !== null && end > start ? `–${timeText(end)}` : ""}`
    if (p.kind === "move") {
      const from = original ? parseInstant(original.start, tz) : null
      return {
        verb: "Move",
        name,
        when:
          from !== null
            ? `${shortAt(from)} to ${shortAt(start)}`
            : `to ${shortAt(start)}`,
      }
    }
    return { verb: p.kind === "create" ? "Add" : "Cancel", name, when: span }
  }

  /* Results. */
  const apply = () => {
    if (locked) return
    setDecision("applied")
    onResult?.({
      action: "apply",
      accepted: acceptedIds,
      declined: readyProposals
        .filter((p) => !isAccepted(p.id))
        .map((p) => p.id),
    })
  }
  const requestChanges = () => {
    const text = feedback.trim()
    if (!text || locked) return
    setRevising(false)
    setDecision("revised")
    onResult?.({ action: "revise", feedback: text })
  }
  const dismiss = () => {
    if (locked) return
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  const skeleton = streaming && readyEvents.length === 0
  let body: React.ReactNode
  if (!rangeStart) {
    body = (
      <div className="px-3 pb-3">
        <Skeleton className="h-72 w-full rounded-[10px]" />
      </div>
    )
  } else if (view === "today") {
    body = (
      <TodayList
        day={rangeStart}
        items={items}
        todos={readyTodos}
        tz={tz}
        todayKey={todayKey}
        nowT={nowT}
        itemLabel={itemLabel}
        skeleton={skeleton}
      />
    )
  } else if (view === "month" && monthStart) {
    body = (
      <MonthGrid
        month={monthStart}
        items={items}
        todayKey={todayKey}
        timeText={(t) => formatTimeShort(t, tz, locale)}
        itemLabel={itemLabel}
        skeleton={skeleton}
      />
    )
  } else {
    body = (
      <TimeGrid
        days={days}
        items={items}
        tz={tz}
        todayKey={todayKey}
        workingHours={workingHours}
        timeText={timeText}
        itemLabel={itemLabel}
        skeleton={skeleton}
      />
    )
  }

  const multiple = readyProposals.length > 1
  const acceptedCount = acceptedIds.length
  const declinedCount = readyProposals.length - acceptedCount
  const showFooter = hasProposals || (result !== undefined && !streaming)
  const zone = `Times in ${tz.replace(/_/g, " ")}.`

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="calendar"
        data-status={status}
        data-view={view}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={cn("@container", className)}
      >
        {view === "today" ? (
          // The list carries its own date line; the title is for screen readers.
          <h3 id={titleId} className="sr-only">
            {title ?? periodLabel ?? "Today"}. {zone}
          </h3>
        ) : (
          <SurfaceHeader className="pb-2">
            <SurfaceTitle id={titleId}>
              {title ?? periodLabel}
              {title && periodLabel && (
                <span className="sr-only">, {periodLabel}</span>
              )}
              <span className="sr-only">. {zone}</span>
            </SurfaceTitle>
            {streaming && (
              <ShimmeringText
                text="Loading your calendar…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
                className="text-[13px]"
              />
            )}
          </SurfaceHeader>
        )}

        <AutoHeight>
          {body}

          {hasProposals && (
            <section
              aria-labelledby={`${baseId}-proposals`}
              className="flex flex-col gap-1 border-t border-border py-2"
            >
              <h4
                id={`${baseId}-proposals`}
                className={cn(genuiType.label, "px-3 pt-1")}
              >
                {multiple ? "Proposed changes" : "Proposed change"}
              </h4>
              <ul className="flex flex-col">
                {readyProposals.map((p) => {
                  const s = summaryOf(p)
                  const accepted = isAccepted(p.id)
                  const conflictTitles =
                    items.find((i) => i.key === `p:${p.id}`)?.conflicts ?? []
                  const text = `${s.verb} ${s.name}`
                  const meta = [s.when, p.reason].filter(Boolean).join(" · ")
                  const choosable = multiple && status !== "applied"
                  const Row = choosable ? "label" : "div"
                  return (
                    <motion.li
                      key={p.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                    >
                      <Row
                        className={cn(
                          "flex items-start gap-3 px-3 py-1.5",
                          choosable && !locked && "cursor-pointer",
                        )}
                      >
                        {choosable && (
                          <Checkbox
                            nativeButton
                            size="sm"
                            aria-label={`Include: ${text}`}
                            checked={accepted}
                            disabled={locked}
                            onCheckedChange={(checked) =>
                              setDeclined((prev) => {
                                const next = new Set(prev)
                                if (checked) next.delete(p.id)
                                else next.add(p.id)
                                return next
                              })
                            }
                            // Larger tap area than the 18px box, without changing its look.
                            className="relative mt-px after:absolute after:-inset-2"
                          />
                        )}
                        <span
                          className={cn(
                            "flex min-w-0 flex-1 flex-col gap-0.5",
                            !accepted && "text-muted-foreground",
                          )}
                        >
                          <span
                            className={cn(
                              "text-[13px] font-semibold",
                              !accepted &&
                                "line-through decoration-muted-foreground/60",
                            )}
                          >
                            {text}
                          </span>
                          {meta && (
                            <span className={cn(genuiType.meta, "tabular-nums")}>
                              {meta}
                            </span>
                          )}
                          {accepted && conflictTitles.length > 0 && (
                            <span className="flex items-start gap-1.5 text-[13px]">
                              <AlertTriangleIcon
                                aria-hidden
                                className="mt-[3px] size-3.5 shrink-0"
                              />
                              Conflicts with {joinTitles(conflictTitles)}
                            </span>
                          )}
                        </span>
                        {status === "applied" && (
                          <span className={cn(genuiType.meta, "shrink-0")}>
                            {accepted ? "Accepted" : "Declined"}
                          </span>
                        )}
                      </Row>
                    </motion.li>
                  )
                })}
              </ul>
            </section>
          )}
        </AutoHeight>

        {showFooter && (
          <SurfaceFooter
            aria-live="polite"
            className="flex-col items-stretch gap-3 @md:flex-row @md:items-center @md:justify-between"
          >
            {status === "applied" ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                Applied {acceptedCount}{" "}
                {acceptedCount === 1 ? "change" : "changes"}
                {declinedCount > 0 && `, declined ${declinedCount}`}
              </p>
            ) : status === "dismissed" ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <XIcon aria-hidden className="size-4 shrink-0" />
                Dismissed. Nothing changed.
              </p>
            ) : status === "revised" ? (
              <p className="flex items-start gap-1.5 text-[13px] text-muted-foreground">
                <MessageSquareIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0"
                />
                <span>
                  Changes requested
                  {feedback && (
                    <span className="text-foreground">: “{feedback}”</span>
                  )}
                </span>
              </p>
            ) : revising ? (
              <div className="flex w-full flex-col gap-2">
                <Textarea
                  autoFocus
                  aria-label="What should change?"
                  placeholder="What should change?"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                      requestChanges()
                    if (e.key === "Escape") setRevising(false)
                  }}
                  className="min-h-16"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setRevising(false)}
                  >
                    Cancel
                  </Button>
                  <WhyDisabled
                    when={!feedback.trim()}
                    reason="Write what should change"
                  >
                    <Button
                      size="sm"
                      onClick={requestChanges}
                      disabled={!feedback.trim()}
                    >
                      Send request
                    </Button>
                  </WhyDisabled>
                </div>
              </div>
            ) : (
              <>
                <p className={genuiType.meta}>
                  {streaming ? (
                    <ShimmeringText
                      text="Preparing changes…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : status === "submitting" ? (
                    "Applying…"
                  ) : (
                    <span className="sr-only">
                      {`${acceptedCount} of ${readyProposals.length} accepted. Nothing is written until you apply.`}
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2 @md:shrink-0">
                  <IconTip label="Request changes">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Request changes"
                      onClick={() => setRevising(true)}
                      disabled={locked}
                    >
                      <MessageSquareIcon />
                    </Button>
                  </IconTip>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={dismiss}
                    disabled={locked}
                    className="flex-1 @md:flex-none"
                  >
                    Dismiss
                  </Button>
                  <WhyDisabled
                    when={!locked && acceptedCount === 0}
                    reason="Accept at least one change"
                    className="flex-1 @md:flex-none"
                  >
                    <Button
                      size="sm"
                      onClick={apply}
                      disabled={locked || acceptedCount === 0}
                      className="flex-1 @md:flex-none"
                    >
                      {status === "submitting"
                        ? "Applying…"
                        : multiple
                          ? `Apply ${acceptedCount} ${acceptedCount === 1 ? "change" : "changes"}`
                          : "Apply"}
                    </Button>
                  </WhyDisabled>
                </div>
              </>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}

/* ------------------------------------------------------------------------ */
/* Views                                                                    */
/* ------------------------------------------------------------------------ */

const fadeIn = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
}

/* Week and day ------------------------------------------------------------ */

function TimeGrid({
  days,
  items,
  tz,
  todayKey,
  workingHours,
  timeText,
  itemLabel,
  skeleton,
}: {
  days: string[]
  items: Item[]
  tz: string
  todayKey: string | null
  workingHours?: { start?: string; end?: string }
  timeText: (t: number) => string
  itemLabel: (item: Item) => string
  skeleton: boolean
}) {
  const locale = useGenUILocale()
  const workStart = parseHHmm(workingHours?.start) ?? 9 * 60
  const workEndRaw = parseHHmm(workingHours?.end) ?? 17 * 60
  const workEnd = workEndRaw > workStart ? workEndRaw : 17 * 60

  const columns = days.map((day) => {
    const allDay = items.filter((i) => i.iv.allDay && onDay(i, day))
    const timed = items.flatMap((item) => {
      if (item.iv.allDay) return []
      const seg = segmentOnDay(item.iv, day, tz)
      return seg ? [{ item, ...seg }] : []
    })
    const layout = layoutColumns(
      timed.map((s) => ({ key: s.item.key, startMin: s.startMin, endMin: s.endMin })),
    )
    return { day, allDay, timed, layout }
  })

  // Working hours, grown to fit every event.
  let gridStart = Math.floor(workStart / 60) * 60
  let gridEnd = Math.ceil(workEnd / 60) * 60
  for (const c of columns) {
    for (const s of c.timed) {
      gridStart = Math.min(gridStart, Math.floor(s.startMin / 60) * 60)
      gridEnd = Math.max(gridEnd, Math.ceil(s.endMin / 60) * 60)
    }
  }
  const hours = Math.max(1, (gridEnd - gridStart) / 60)
  // A long day gets shorter hours, so the card never needs an inner scroll.
  const hourPx = hours > 12 ? 28 : 44
  const height = hours * hourPx
  /** Every hour line, top to bottom, as hours of the day. */
  const hourLines = Array.from({ length: hours + 1 }, (_, i) => gridStart / 60 + i)
  const y = (min: number) => ((min - gridStart) / 60) * hourPx
  const hasAllDay = columns.some((c) => c.allDay.length > 0)
  const many = days.length > 1

  return (
    <ScrollFade
      label={many ? "Week schedule" : "Day schedule"}
      viewportClassName="overflow-x-auto overscroll-x-contain px-3 pt-2 pb-4"
    >
      <div
        className="grid gap-x-1.5"
        style={{
          gridTemplateColumns: `2.25rem repeat(${days.length}, minmax(${many ? "4.5rem" : "0"}, 1fr))`,
        }}
      >
        {columns.map(({ day }, index) => (
          <div
            key={day}
            aria-hidden
            className={cn(
              SCHEDULE_LABEL,
              "truncate px-0.5 pb-3",
              day === todayKey ? "text-foreground" : "text-muted-foreground",
            )}
            style={{ gridColumn: index + 2, gridRow: 1 }}
          >
            {formatDay(day, "weekday", locale)} {formatDay(day, "day", locale)}
          </div>
        ))}

        {hasAllDay &&
          columns.map(({ day, allDay }, index) => (
            <div
              key={day}
              aria-hidden
              className="flex min-w-0 flex-col gap-1 pb-2"
              style={{ gridColumn: index + 2, gridRow: 2 }}
            >
              {allDay.map((item) => (
                <motion.span
                  key={item.key}
                  {...fadeIn}
                  className={cn(
                    "flex h-6 min-w-0 items-center rounded-full px-2.5 text-[13px]",
                    itemTone(item),
                  )}
                >
                  <span className={cn("truncate", isStruck(item) && "line-through")}>
                    {item.title}
                  </span>
                </motion.span>
              ))}
            </div>
          ))}

        {/* Hour labels and lines: decoration only. */}
        <div
          aria-hidden
          className="relative"
          style={{ gridColumn: 1, gridRow: 3, height }}
        >
          {hourLines.slice(0, -1).map((hour) => (
            <span
              key={hour}
              className={cn(
                SCHEDULE_LABEL,
                "absolute left-0 -translate-y-1/2 text-muted-foreground",
              )}
              style={{ top: y(hour * 60) }}
            >
              {formatHour(hour, locale)}
            </span>
          ))}
        </div>
        <div
          aria-hidden
          className="pointer-events-none relative"
          style={{ gridColumn: "2 / -1", gridRow: 3, height }}
        >
          {hourLines.map((hour) => (
            <div
              key={hour}
              className="absolute inset-x-0 border-t border-border/70"
              style={{ top: y(hour * 60) }}
            />
          ))}
        </div>

        {columns.map(({ day, allDay, timed, layout }, index) => (
          <div
            key={day}
            className="relative min-w-0"
            style={{ gridColumn: index + 2, gridRow: 3, height }}
          >
            <h4 className="sr-only">
              {formatDay(day, "long", locale)}
              {day === todayKey && ", today"}
            </h4>
            {allDay.length + timed.length === 0 && !skeleton && (
              <p className="sr-only">Nothing scheduled</p>
            )}
            {allDay.map((item) => (
              <p key={item.key} className="sr-only">
                {itemLabel(item)}
              </p>
            ))}
            {timed.map(({ item, startMin, endMin }) => {
              const pos = layout.get(item.key) ?? { col: 0, cols: 1 }
              const h = Math.max(((endMin - startMin) / 60) * hourPx - 4, 6)
              const changed = isChanged(item)
              const showText = h >= 18 && item.state !== "moving"
              return (
                <motion.div
                  key={item.key}
                  {...fadeIn}
                  className={cn(
                    "absolute overflow-hidden rounded-[8px]",
                    itemTone(item),
                  )}
                  style={{
                    top: y(startMin) + 2,
                    height: h,
                    left: `calc(${(pos.col / pos.cols) * 100}% + ${pos.col ? 2 : 0}px)`,
                    width: `calc(${100 / pos.cols}% - ${pos.cols > 1 ? 2 : 0}px)`,
                    zIndex: changed ? 2 : 1,
                  }}
                >
                  {showText && (
                    <span
                      aria-hidden
                      className={cn(
                        "flex min-w-0 flex-wrap items-baseline gap-x-2 px-2 text-[13px] leading-[18px]",
                        h >= 28 ? "py-1.5" : "py-px",
                        changed && "font-semibold",
                      )}
                    >
                      <span
                        className={cn(
                          "min-w-0 truncate",
                          item.state === "cancelling" && "line-through",
                        )}
                      >
                        {item.title}
                      </span>
                      {changed && (
                        <span
                          className={cn(
                            SCHEDULE_LABEL,
                            "shrink-0 font-normal text-background/70",
                          )}
                        >
                          {timeText(item.iv.start)}
                        </span>
                      )}
                    </span>
                  )}
                  <span className="sr-only">{itemLabel(item)}</span>
                </motion.div>
              )
            })}
            {skeleton && index % 2 === 0 && (
              <Skeleton
                className="absolute inset-x-0 rounded-[8px]"
                style={{ top: hourPx * (1 + (index % 3)), height: hourPx }}
              />
            )}
          </div>
        ))}
      </div>
    </ScrollFade>
  )
}

/* Month ------------------------------------------------------------------- */

/** Events a day cell shows before the rest fold into "+N more". */
const MONTH_SHOWS = 3

function MonthGrid({
  month,
  items,
  todayKey,
  timeText,
  itemLabel,
  skeleton,
}: {
  month: string
  items: Item[]
  todayKey: string | null
  timeText: (t: number) => string
  itemLabel: (item: Item) => string
  skeleton: boolean
}) {
  const locale = useGenUILocale()
  const firstDay = React.useMemo(() => firstDayOfWeek(locale), [locale])
  const weeks = monthGrid(month, firstDay)
  const ym = month.slice(0, 7)
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set())

  return (
    <ScrollFade
      label="Month"
      viewportClassName="overflow-x-auto overscroll-x-contain px-3 pt-1 pb-3"
    >
      <div className="grid min-w-[34rem] grid-cols-7 gap-1.5">
        {weeks[0].map((day) => (
          <div
            key={day}
            aria-hidden
            className={cn(SCHEDULE_LABEL, "px-1.5 pb-1.5 text-muted-foreground")}
          >
            {formatDay(day, "weekday", locale)}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const inMonth = day.startsWith(ym)
          const isToday = day === todayKey
          const dayItems = inMonth ? items.filter((i) => onDay(i, day)) : []
          const open = expanded.has(day)
          const shown =
            open || dayItems.length <= MONTH_SHOWS
              ? dayItems
              : dayItems.slice(0, MONTH_SHOWS)
          const hidden = dayItems.length - shown.length
          return (
            <div
              key={day}
              aria-hidden={inMonth ? undefined : true}
              className={cn(
                "flex min-h-[6.75rem] min-w-0 flex-col gap-1 rounded-[10px] p-1.5",
                inMonth
                  ? "bg-foreground/[0.035] dark:bg-foreground/[0.07]"
                  : "bg-foreground/[0.015] dark:bg-foreground/[0.03]",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex h-6 min-w-6 items-center self-start rounded-full px-1.5 text-[13px] tabular-nums",
                  !inMonth && "text-muted-foreground/60",
                  isToday && "bg-foreground font-medium text-background",
                )}
              >
                {formatDay(day, "day", locale)}
              </span>
              {inMonth && (
                <h4 className="sr-only">
                  {formatDay(day, "long", locale)}
                  {isToday && ", today"}
                </h4>
              )}
              {hidden > 0 && (
                <button
                  type="button"
                  aria-expanded={false}
                  aria-label={`Show ${hidden} more on ${formatDay(day, "long", locale)}`}
                  onClick={() => setExpanded((prev) => new Set(prev).add(day))}
                  className="relative self-start rounded-sm px-1.5 text-[13px] text-muted-foreground outline-none after:absolute after:-inset-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  +{hidden} more
                </button>
              )}
              <ul className="mt-auto flex min-w-0 flex-col gap-1">
                {shown.map((item) => (
                  <motion.li
                    key={item.key}
                    {...fadeIn}
                    className={cn(
                      "flex h-[22px] min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 text-[13px]",
                      itemTone(item),
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        isChanged(item) && "font-semibold",
                        isStruck(item) && "line-through",
                      )}
                    >
                      {item.title}
                    </span>
                    {!item.iv.allDay && item.iv.startKey === day && (
                      <span
                        aria-hidden
                        className={cn(
                          SCHEDULE_LABEL,
                          "shrink-0",
                          isChanged(item)
                            ? "text-background/70"
                            : "text-muted-foreground",
                        )}
                      >
                        {timeText(item.iv.start)}
                      </span>
                    )}
                    <span className="sr-only">{itemLabel(item)}</span>
                  </motion.li>
                ))}
              </ul>
              {skeleton && inMonth && Number(day.slice(8, 10)) % 4 === 1 && (
                <Skeleton className="mt-auto h-[22px] w-full rounded-[6px]" />
              )}
            </div>
          )
        })}
      </div>
    </ScrollFade>
  )
}

/* Today ------------------------------------------------------------------- */

function TodayList({
  day,
  items,
  todos,
  tz,
  todayKey,
  nowT,
  itemLabel,
  skeleton,
}: {
  day: string
  items: Item[]
  todos: CalendarTodo[]
  tz: string
  todayKey: string | null
  nowT: number | null
  itemLabel: (item: Item) => string
  skeleton: boolean
}) {
  const locale = useGenUILocale()
  const isToday = day === todayKey
  const dayItems = items.filter((i) => onDay(i, day))
  const eventCount = dayItems.filter((i) => i.state !== "proposed").length
  const counts = [
    `${eventCount} ${eventCount === 1 ? "event" : "events"}`,
    todos.length > 0 && `${todos.length} ${todos.length === 1 ? "to-do" : "to-dos"}`,
  ]
    .filter(Boolean)
    .join(" · ")

  // Narrow cards put the time and duration on one line and the title, in
  // full, under them; from @sm the three sit in one row.
  const row =
    "grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[10px] px-3 py-2.5 @sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]"
  const titleCell =
    "col-span-2 row-start-2 min-w-0 @sm:col-span-1 @sm:col-start-2 @sm:row-start-1"

  return (
    <div className="flex flex-col gap-4 px-3 pt-3 pb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p aria-hidden className={cn(SCHEDULE_LABEL, "text-muted-foreground")}>
          {isToday && "Today · "}
          {formatDay(day, "date", locale)}
        </p>
        {!skeleton && <p className={genuiType.body}>{counts}</p>}
      </div>

      <ol className="flex flex-col gap-1.5">
        {dayItems.map((item) => {
          const { iv } = item
          const seg = iv.allDay ? null : segmentOnDay(iv, day, tz)
          const starts = iv.startKey === day
          const when = iv.allDay
            ? "All day"
            : starts
              ? formatTime(iv.start, tz, locale)
              : `Until ${formatTime(iv.end, tz, locale)}`
          const live =
            isToday &&
            nowT !== null &&
            !isStruck(item) &&
            item.state !== "proposed"
          const isNow = live && iv.start <= nowT && nowT < iv.end
          const past = live && iv.end > iv.start && iv.end <= nowT
          const changed = isChanged(item)
          const aside = isNow
            ? "Now"
            : seg
              ? formatDuration(seg.endMin - seg.startMin, locale)
              : null
          return (
            <motion.li
              key={item.key}
              {...fadeIn}
              className={cn(
                row,
                changed
                  ? CHANGED_FILL
                  : isStruck(item)
                    ? cn(DASHED, "text-muted-foreground")
                    : item.busy || iv.allDay
                      ? "border border-border bg-foreground/[0.03] dark:bg-foreground/[0.06]"
                      : FREE,
                past && "opacity-60",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  SCHEDULE_LABEL,
                  "truncate",
                  changed ? "text-background/70" : "text-muted-foreground",
                )}
              >
                {when}
              </span>
              <span
                aria-hidden
                className={cn(
                  genuiType.title,
                  titleCell,
                  "break-words leading-snug @sm:truncate",
                  isStruck(item) && "line-through decoration-muted-foreground/70",
                )}
              >
                {item.title}
              </span>
              <span
                aria-hidden
                className={cn(
                  SCHEDULE_LABEL,
                  "col-start-2 row-start-1 shrink-0 @sm:col-start-3",
                  isNow
                    ? "text-foreground"
                    : changed
                      ? "text-background/70"
                      : "text-muted-foreground",
                )}
              >
                {aside}
              </span>
              <span className="sr-only">
                {itemLabel(item)}
                {isNow && ", happening now"}
                {past && ", over"}
              </span>
            </motion.li>
          )
        })}

        {todos.map((todo) => (
          <motion.li
            key={`t:${todo.id}`}
            {...fadeIn}
            className={cn(row, "border border-border")}
          >
            <span aria-hidden className={cn(SCHEDULE_LABEL, "text-muted-foreground")}>
              To do
            </span>
            <span className={cn(titleCell, "flex items-center gap-2.5 @sm:col-span-2")}>
              {/* A status mark, not a control: ticking a task belongs to the To-do List. */}
              <span
                aria-hidden
                className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-muted-foreground"
              >
                {todo.done && <CheckIcon className="size-3" strokeWidth={3} />}
              </span>
              <span
                className={cn(
                  genuiType.title,
                  "min-w-0 break-words leading-snug @sm:truncate",
                  todo.done && "text-muted-foreground line-through",
                )}
              >
                <span className="sr-only">{todo.done ? "Done: " : "To do: "}</span>
                {todo.title}
              </span>
            </span>
          </motion.li>
        ))}

        {skeleton && (
          <li aria-hidden className="flex flex-col gap-1.5">
            <Skeleton className="h-12 w-full rounded-[10px]" />
            <Skeleton className="h-12 w-full rounded-[10px]" />
            <Skeleton className="h-12 w-full rounded-[10px]" />
          </li>
        )}
        {!skeleton && dayItems.length === 0 && todos.length === 0 && (
          <li className={cn(row, "border border-border", genuiType.meta)}>
            <span className="col-span-full">Nothing scheduled</span>
          </li>
        )}
      </ol>
    </div>
  )
}
