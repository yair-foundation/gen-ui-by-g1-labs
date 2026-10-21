"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  XIcon,
} from "lucide-react"
import { Popover } from "@base-ui/react/popover"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
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

import type {
  CalendarEvent,
  CalendarInput,
  CalendarProposal,
  CalendarResult,
  CalendarSource,
  CalendarView,
} from "./calendar.schema"
import {
  type Interval,
  addDays,
  addMonths,
  agendaBlockHeight,
  anyInDays,
  applyProposals,
  compareIntervals,
  dayKeyOf,
  dayRange,
  daysInMonth,
  diffDays,
  eventInterval,
  findConflicts,
  firstDayOfWeek,
  formatDay,
  formatHour,
  formatRangeLabel,
  formatTime,
  formatTimeRange,
  formatTimeZoneLabel,
  formatWeekdayAt,
  isBusy,
  layoutColumns,
  minutesOfDay,
  monthGrid,
  normalizeDayKey,
  nowAndNext,
  parseInstant,
  safeTimeZone,
  segmentOnDay,
  startOfMonth,
  startOfWeek,
} from "./calendar-utils"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"
import { Segmented } from "@/components/genui/segmented"

/** Explains a disabled button. Disabled controls swallow pointer events, so the span takes the hover. */
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
  Omit<
    CalendarInput,
    "range" | "events" | "proposals" | "calendars" | "workingHours"
  >
> & {
  range?: Partial<CalendarInput["range"]>
  /** Events and proposals may be partial while the tool call streams. */
  events?: Partial<CalendarEvent>[]
  proposals?: Partial<CalendarProposal>[]
  calendars?: Partial<CalendarSource>[]
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
  calendar?: { label: string; index: number }
  location?: string
  attendees?: number
  url?: string
  busy: boolean
  reason?: string
  /** On the original of a proposed move: where it goes. */
  movedTo?: number
  /** On a proposed or applied move: where it was. */
  movedFrom?: number
  /** Titles of busy events a proposal overlaps. */
  conflicts: string[]
}

const VIEW_LABELS: Record<CalendarView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  agenda: "Agenda",
  today: "Today",
}
const VIEW_ORDER: CalendarView[] = ["day", "week", "month", "agenda"]
const HOUR_PX = 40
const MONTH_COLLAPSE_OVER = 5
const MONTH_COLLAPSED_SHOWS = 3

/**
 * Calendar colours: solid fills with their own text colour, after Google
 * Calendar's dark theme (slate blue, teal, gold, green, and grey for the
 * default). Light mode uses deeper fills with white text. Put on the root:
 * `--cal-n` is the fill, `--cal-fg-n` the text on it. Past the fourth calendar
 * (and for events with no calendar) the grey (4) is used.
 */
const CAL_VARS =
  "[--cal-0:#5560a8] [--cal-fg-0:#ffffff] [--cal-1:#3e8e7e] [--cal-fg-1:#ffffff] [--cal-2:#9a7400] [--cal-fg-2:#ffffff] [--cal-3:#3d8a5c] [--cal-fg-3:#ffffff] [--cal-4:#6c6f74] [--cal-fg-4:#ffffff] dark:[--cal-0:#4a5588] dark:[--cal-fg-0:#e6e9f8] dark:[--cal-1:#5a9a8e] dark:[--cal-fg-1:#0a1f1b] dark:[--cal-2:#e9c45b] dark:[--cal-fg-2:#2a2100] dark:[--cal-3:#6db38a] dark:[--cal-fg-3:#0d2416] dark:[--cal-4:#505256] dark:[--cal-fg-4:#ececec]"

const CAL_COLORS = 4
const calSlot = (index: number | undefined) =>
  index !== undefined && index < CAL_COLORS ? index : CAL_COLORS

/** A calendar's colour, for its marker in the legend and in plain rows. */
const calColor = (index: number) => `var(--cal-${calSlot(index)})`

/** Shapes back the colour up, so a calendar is never told apart by colour alone. */
const MARKERS = [
  "rounded-full bg-current",
  "rounded-full border-2 border-current",
  "rounded-[2px] bg-current",
  "rounded-[2px] border-2 border-current",
  "rotate-45 rounded-[1px] bg-current",
  "rotate-45 rounded-[1px] border-2 border-current",
]

/** `onFill`: the marker sits on its calendar's own fill, so it takes the text colour instead. */
function Marker({ index, onFill = false }: { index: number; onFill?: boolean }) {
  return (
    <span
      aria-hidden
      style={onFill ? undefined : { color: calColor(index) }}
      className={cn(
        "inline-block size-2 shrink-0",
        MARKERS[index % MARKERS.length],
      )}
    />
  )
}

/** Sets the event's fill and text colour from its calendar (grey when it has none). */
const calStyle = (item: Item): React.CSSProperties => {
  const slot = calSlot(item.calendar?.index)
  return {
    "--cal": `var(--cal-${slot})`,
    "--cal-fg": `var(--cal-fg-${slot})`,
  } as React.CSSProperties
}

/** Events that are drawn as a solid fill: real, busy ones. Free, proposed and struck ones stay outlined. */
const isFilled = (item: Item) =>
  item.state !== "proposed" && !struck(item) && item.busy

/** Solid fill with its own text colour; muted text inside follows it. */
const CAL_FILL =
  "bg-[var(--cal)] text-[color:var(--cal-fg)] [--foreground:var(--cal-fg)] [--muted-foreground:color-mix(in_oklab,var(--cal-fg)_72%,transparent)] hover:brightness-110"

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

function safeHref(url: string | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

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

/* ------------------------------------------------------------------------ */
/* Component                                                                */
/* ------------------------------------------------------------------------ */

export function Calendar({
  title,
  timezone,
  view: viewProp,
  range,
  events = [],
  calendars = [],
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
  const detailsId = `${baseId}-details`
  const rootRef = React.useRef<HTMLElement>(null)

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

  /* Local view state. */
  const [userView, setUserView] = React.useState<CalendarView | null>(null)
  const [userAnchor, setUserAnchor] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [expandedDays, setExpandedDays] = React.useState<Set<string>>(
    () => new Set(),
  )
  const [announcement, setAnnouncement] = React.useState("")
  const [narrow, setNarrow] = React.useState(false)
  const [clock, setClock] = React.useState<number | null>(null)
  const firstDay = React.useMemo(() => firstDayOfWeek(locale), [locale])

  // Narrow containers get the agenda instead of the week grid: below ~600px
  // seven day columns get too thin for an event title.
  React.useEffect(() => {
    const el = rootRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const mq = window.matchMedia("(max-width: 639px)")
    const update = () =>
      setNarrow(mq.matches || el.getBoundingClientRect().width < 600)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    mq.addEventListener("change", update)
    return () => {
      observer.disconnect()
      mq.removeEventListener("change", update)
    }
  }, [])

  // The viewer's clock, for "today" and the current-time line.
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
  const hasProposals = readyProposals.length > 0
  const isAccepted = (id: string) => !declined.has(id)
  const acceptedIds = readyProposals
    .filter((p) => isAccepted(p.id))
    .map((p) => p.id)

  const calendarIndex = React.useMemo(() => {
    const list: { id?: string; label: string }[] = calendars
      .filter((c): c is CalendarSource => !!c.id && !!c.label)
      .map((c) => ({ id: c.id, label: c.label }))
    for (const e of events) {
      if (
        e.calendar &&
        !list.some((c) => c.id === e.calendar || c.label === e.calendar)
      ) {
        list.push({ label: e.calendar })
      }
    }
    return list
  }, [calendars, events])

  const resolveCalendar = (name: string | undefined) => {
    if (!name) return undefined
    const index = calendarIndex.findIndex(
      (c) => c.id === name || c.label === name,
    )
    return index === -1
      ? undefined
      : { label: calendarIndex[index].label, index }
  }

  const items: Item[] = (() => {
    const out: Item[] = []
    const base = (e: ReadyEvent) => ({
      title: e.title,
      calendar: resolveCalendar(e.calendar),
      location: e.location,
      attendees: e.attendees,
      url: e.url,
      busy: isBusy(e),
      conflicts: [] as string[],
    })

    if (status === "applied") {
      // Decided: the resulting schedule, with what changed labelled.
      for (const e of applyProposals(
        readyEvents,
        readyProposals,
        acceptedIds,
      )) {
        const iv = eventInterval(e, tz)
        if (!iv) continue
        out.push({
          ...base(e),
          key: e.change === "added" ? `p:${e.id}` : `e:${e.id}`,
          iv,
          state: e.change ?? "event",
          movedFrom: e.previous
            ? (parseInstant(e.previous.start, tz) ?? undefined)
            : undefined,
          reason: readyProposals.find((p) => p.id === e.proposalId)?.reason,
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
        ...base(e),
        key: `e:${e.id}`,
        iv,
        state: p ? (p.kind === "move" ? "moving" : "cancelling") : "event",
        movedTo:
          p?.kind === "move"
            ? (parseInstant(p.start, tz) ?? undefined)
            : undefined,
        reason: p?.kind === "cancel" ? p.reason : undefined,
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
        ...(original
          ? base(original)
          : {
              title: p.title,
              busy: true,
              conflicts: [],
            }),
        title: original?.title ?? p.title,
        key: `p:${p.id}`,
        iv,
        state: "proposed",
        movedFrom: original
          ? (parseInstant(original.start, tz) ?? undefined)
          : undefined,
        reason: p.reason,
        conflicts: (conflicts.get(p.id) ?? []).map((c) => c.title),
      })
    }
    return out.sort((a, b) => compareIntervals(a.iv, b.iv))
  })()
  const intervals = items.map((i) => i.iv)

  /* Range, views and the visible period. */
  const rangeStart =
    normalizeDayKey(range?.start) ??
    // Without a range, wait while streaming; then fall back to the events.
    (streaming ? null : items[0]?.iv.startKey || todayKey || null)
  const initialView: CalendarView = viewProp ?? "week"
  const spanDays = rangeStart
    ? (range?.days ??
      (initialView === "day" || initialView === "today"
        ? 1
        : initialView === "month"
          ? daysInMonth(rangeStart) - Number(rangeStart.slice(8, 10)) + 1
          : 7))
    : 7

  const options = VIEW_ORDER.filter(
    (v) =>
      v === initialView ||
      v === "agenda" ||
      (v === "day" && spanDays <= 7) ||
      (v === "week" && spanDays > 1) ||
      (v === "month" && spanDays >= 14),
  ).filter((v) => !(narrow && v === "week"))
  const chosenView = userView ?? initialView
  const view: CalendarView =
    narrow && chosenView === "week" ? "agenda" : chosenView

  const anchorFor = (v: CalendarView, focus: string): string => {
    if (!rangeStart) return focus
    if (v === "month") return startOfMonth(focus)
    if (v === "week") {
      if (spanDays > 7) return startOfWeek(focus, firstDay)
      return addDays(
        rangeStart,
        Math.floor(diffDays(rangeStart, focus) / 7) * 7,
      )
    }
    return focus
  }
  const defaultAnchor = (v: CalendarView) =>
    rangeStart
      ? v === "month"
        ? startOfMonth(rangeStart)
        : v === "week" && spanDays > 7
          ? startOfWeek(rangeStart, firstDay)
          : rangeStart
      : null
  const anchor = userAnchor ?? defaultAnchor(view)

  /** The days a period covers (for months: the month itself, not the grid). */
  const periodDays = (v: CalendarView, a: string): [string, number] =>
    v === "day" || v === "today"
      ? [a, 1]
      : v === "week"
        ? [a, spanDays > 7 ? 7 : spanDays]
        : v === "month"
          ? [a, daysInMonth(a)]
          : [rangeStart ?? a, spanDays]
  const step = (v: CalendarView, a: string, dir: 1 | -1) =>
    v === "month"
      ? addMonths(a, dir)
      : addDays(a, v === "day" || v === "today" ? dir : 7 * dir)
  const hasItems = (v: CalendarView, a: string) =>
    anyInDays(intervals, ...periodDays(v, a))
  const periodLabel = (v: CalendarView, a: string) =>
    v === "month"
      ? formatDay(a, "month", locale)
      : formatRangeLabel(...periodDays(v, a), locale)

  const prevAnchor = anchor && view !== "agenda" ? step(view, anchor, -1) : null
  const nextAnchor = anchor && view !== "agenda" ? step(view, anchor, 1) : null
  const todayAnchor =
    todayKey && view !== "agenda" ? anchorFor(view, todayKey) : null
  const canPrev = !!prevAnchor && hasItems(view, prevAnchor)
  const canNext = !!nextAnchor && hasItems(view, nextAnchor)
  const canToday =
    !!todayAnchor && todayAnchor !== anchor && hasItems(view, todayAnchor)
  const unit = view === "day" ? "day" : view === "week" ? "week" : "month"

  const rangeLabel = anchor ? periodLabel(view, anchor) : null
  const visibleDays: string[] = !anchor
    ? []
    : view === "month"
      ? monthGrid(anchor, firstDay).flat()
      : view === "agenda"
        ? []
        : dayRange(...periodDays(view, anchor))

  const announce = (v: CalendarView, a: string | null) => {
    if (!a) return
    setAnnouncement(`${VIEW_LABELS[v]} view, ${periodLabel(v, a)}`)
  }
  const goTo = (a: string | null) => {
    if (!a) return
    setUserAnchor(a)
    setSelected(null)
    announce(view, a)
  }
  const switchView = (v: CalendarView) => {
    const sel = items.find((i) => i.key === selected)
    const focus =
      sel?.iv.startKey ||
      (todayKey && visibleDays.includes(todayKey) ? todayKey : null) ||
      (anchor && view === "month" && rangeStart?.startsWith(anchor.slice(0, 7))
        ? rangeStart
        : anchor) ||
      rangeStart
    const a = focus ? (v === "agenda" ? rangeStart : anchorFor(v, focus)) : null
    setUserView(v)
    setUserAnchor(a)
    announce(v, a)
  }

  /* Labels. */
  const timeText = (t: number) => formatTime(t, tz, locale)
  const whenText = (iv: Interval, long = false) => {
    if (iv.allDay) {
      const last = addDays(iv.endKey, -1)
      const style = long ? "long" : "weekday-long"
      return last === iv.startKey
        ? `${formatDay(iv.startKey, style, locale)}, all day`
        : `${formatDay(iv.startKey, style, locale)} to ${formatDay(last, style, locale)}, all day`
    }
    const day = (t: number) =>
      long
        ? formatDay(dayKeyOf(t, tz), "long", locale)
        : formatWeekdayAt(t, tz, "long", locale)
    const sameDay = dayKeyOf(iv.start, tz) === dayKeyOf(iv.end, tz)
    return sameDay
      ? `${day(iv.start)} ${timeText(iv.start)} to ${timeText(iv.end)}`
      : `${day(iv.start)} ${timeText(iv.start)} to ${day(iv.end)} ${timeText(iv.end)}`
  }
  const shortAt = (t: number) => `${formatWeekdayAt(t, tz, "short", locale)} ${timeText(t)}`
  const itemLabel = (item: Item) => {
    const parts = [item.title, whenText(item.iv)]
    if (item.calendar) parts.push(`${item.calendar.label} calendar`)
    if (item.state === "proposed") {
      parts.push(
        item.movedFrom !== undefined
          ? `proposed move from ${formatWeekdayAt(item.movedFrom, tz, "long", locale)} ${timeText(item.movedFrom)}`
          : "proposed",
      )
    }
    if (item.state === "moving" && item.movedTo !== undefined) {
      parts.push(
        `proposed to move to ${formatWeekdayAt(item.movedTo, tz, "long", locale)} ${timeText(item.movedTo)}`,
      )
    }
    if (item.state === "cancelling") parts.push("proposed to cancel")
    if (item.state === "added") parts.push("added")
    if (item.state === "moved") parts.push("moved")
    if (!item.busy && item.state === "event") parts.push("free")
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

  /* Selection and details. */
  const activeKey = selected
  const activeItem = items.find((i) => i.key === activeKey) ?? null
  // The card keeps its last event while it animates out.
  const lastActive = React.useRef<Item | null>(null)
  if (activeItem) lastActive.current = activeItem
  const cardItem = activeItem ?? lastActive.current
  // Switching from one event to another slides the card; the first open does not.
  const [glide, setGlide] = React.useState(false)
  const prevActive = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (activeKey === null) setGlide(false)
    else if (prevActive.current !== null && prevActive.current !== activeKey)
      setGlide(true)
    prevActive.current = activeKey
  }, [activeKey])
  const focusItem = (key: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-cal-key="${CSS.escape(key)}"]`,
    )
    el?.focus()
  }
  const closeDetails = () => {
    const key = selected
    setSelected(null)
    if (key) requestAnimationFrame(() => focusItem(key))
  }
  const toggleItem = (key: string) =>
    setSelected((prev) => (prev === key ? null : key))

  const itemButtonProps = (item: Item) => ({
    type: "button" as const,
    "data-cal-key": item.key,
    "aria-label": itemLabel(item),
    "aria-expanded": selected === item.key,
    "aria-controls": selected === item.key ? detailsId : undefined,
    "aria-haspopup": "dialog" as const,
    onClick: () => toggleItem(item.key),
    onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === "Escape" && selected === item.key) setSelected(null)
    },
  })

  /* Results. */
  const apply = () => {
    if (locked) return
    setDecision("applied")
    setSelected(null)
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

  /* Shared bits for the views. */
  // The card follows the event that was clicked last: a new element re-anchors it.
  const cardAnchor = cardItem
    ? (rootRef.current?.querySelector<HTMLElement>(
        `[data-cal-key="${CSS.escape(cardItem.key)}"]`,
      ) ?? null)
    : null
  const detailsCard = (
    <Popover.Root
      open={activeItem !== null}
      onOpenChange={(open, eventDetails) => {
        if (open) return
        // A press on an event button is handled by the button (it toggles).
        const target = eventDetails.event?.target
        if (target instanceof Element && target.closest("[data-cal-key]")) return
        setSelected(null)
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={cardAnchor}
          side="top"
          align="center"
          sideOffset={12}
          collisionPadding={8}
          className={cn(
            "isolate z-50 outline-none",
            glide &&
              "transition-transform duration-200 ease-out motion-reduce:transition-none",
          )}
        >
          <Popover.Popup
            id={detailsId}
            aria-label={cardItem ? `Details: ${cardItem.title}` : undefined}
            // Opened by a click, so focus moves into it; Esc returns to the event.
            className="w-72 max-w-[calc(100vw-1rem)] origin-(--transform-origin) rounded-[10px] bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none transition-[opacity,transform] duration-150 ease-out data-[ending-style]:translate-y-1 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:translate-y-1 data-[starting-style]:scale-95 data-[starting-style]:opacity-0 motion-reduce:transition-none dark:shadow-none"
          >
            {cardItem && (
              <Details
                item={cardItem}
                when={whenText(cardItem.iv, true)}
                shortAt={shortAt}
                onClose={closeDetails}
              />
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )

  const zoneLabel = formatTimeZoneLabel(
    tz,
    view === "agenda" || visibleDays.length === 0
      ? dayRange(rangeStart ?? todayKey ?? "2000-01-01", spanDays)
      : visibleDays,
    locale,
  )
  const legend = calendarIndex.length > 1 ? calendarIndex : []
  // Just the offset on screen ("GMT-4"); the full zone is its tooltip and sr text.
  const zoneShort = zoneLabel.match(/\(([^)]+)\)/)?.[1] ?? zoneLabel
  const showNav = view !== "agenda" && (canPrev || canNext || canToday)
  const showSkeleton = streaming && readyEvents.length === 0

  let body: React.ReactNode
  if (view === "today") {
    body = (
      <TodayCard
        day={anchor}
        items={items}
        tz={tz}
        todayKey={todayKey}
        nowT={nowT}
        selected={selected}
        itemButtonProps={itemButtonProps}
        shortAt={shortAt}
        skeleton={streaming && readyEvents.length === 0}
        zoneLabel={zoneLabel}
      />
    )
  } else if (!anchor && view !== "agenda") {
    body = (
      <div className="px-3 py-3">
        <Skeleton className="h-72 w-full rounded-[10px]" />
      </div>
    )
  } else if (view === "month" && anchor) {
    body = (
      <MonthView
        anchor={anchor}
        firstDay={firstDay}
        items={items}
        todayKey={todayKey}
        selected={selected}
        expandedDays={expandedDays}
        onExpand={(day) => setExpandedDays((prev) => new Set(prev).add(day))}
        itemButtonProps={itemButtonProps}
        timeText={timeText}
        skeleton={showSkeleton}
      />
    )
  } else if (view === "agenda") {
    body = (
      <AgendaView
        items={items}
        rangeStart={rangeStart}
        spanDays={spanDays}
        todayKey={todayKey}
        selected={selected}
        itemButtonProps={itemButtonProps}
        timeText={timeText}
        shortAt={shortAt}
        skeleton={showSkeleton}
        heightClass="max-h-96"
      />
    )
  } else {
    body = (
      <TimeGrid
        days={visibleDays}
        items={items}
        tz={tz}
        todayKey={todayKey}
        nowT={nowT}
        workingHours={workingHours}
        selected={selected}
        itemButtonProps={itemButtonProps}
        timeText={timeText}
        skeleton={showSkeleton}
        dayView={view === "day"}
        heightClass={hasProposals ? "max-h-[21rem]" : "max-h-[25rem]"}
      />
    )
  }

  const acceptedCount = acceptedIds.length
  const declinedCount = readyProposals.length - acceptedCount
  const showFooter = hasProposals || (result !== undefined && !streaming)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        ref={rootRef}
        data-slot="calendar"
        data-status={status}
        data-view={view}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={cn("@container", CAL_VARS, className)}
      >
        {view === "today" ? (
          // The compact card is its own header: the date is the big number.
          <h3 id={titleId} className="sr-only">
            {title ?? rangeLabel ?? "Today"}
          </h3>
        ) : (
          <SurfaceHeader className="gap-2 border-b border-border pb-3">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <SurfaceTitle id={titleId}>{title ?? rangeLabel}</SurfaceTitle>
                {streaming ? (
                  <ShimmeringText
                    text="Loading your calendar…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                    className="text-[13px]"
                  />
                ) : (
                  <div
                    className={cn(
                      genuiType.meta,
                      "flex flex-wrap items-center gap-x-3 gap-y-0.5",
                    )}
                  >
                    <p>
                      {title && rangeLabel && <>{rangeLabel} · </>}
                      <span title={zoneLabel}>
                        <span className="sr-only">Times in {zoneLabel}</span>
                        <span aria-hidden>{zoneShort}</span>
                      </span>
                    </p>
                    {/* The markers can't be read without it, so the legend stays, beside the zone. */}
                    {legend.length > 0 && (
                      <ul
                        aria-label="Calendars"
                        className="flex flex-wrap gap-x-3"
                      >
                        {legend.map((c, i) => (
                          <li
                            key={c.id ?? c.label}
                            className="flex items-center gap-1.5"
                          >
                            <Marker index={i} />
                            {c.label}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Compact in the title row, like the other header switches: a row
                    of its own made the card 54px taller. */}
                {options.length > 1 && (
                  <Segmented
                    label="View"
                    value={view}
                    options={options.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
                    onChange={(v) => v !== view && switchView(v)}
                    fit
                  />
                )}
                {showNav && (
                  <div className="flex items-center gap-1">
                    <WhyDisabled when={!canToday} reason="Already showing today">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canToday}
                        onClick={() => goTo(todayAnchor)}
                      >
                        Today
                      </Button>
                    </WhyDisabled>
                    <WhyDisabled
                      reason={!canPrev ? "Nothing earlier" : undefined}
                    >
                      <IconTip label={`Previous ${unit}`}>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Previous ${unit}`}
                          disabled={!canPrev}
                          onClick={() => goTo(prevAnchor)}
                        >
                          <ChevronLeftIcon />
                        </Button>
                      </IconTip>
                    </WhyDisabled>
                    <WhyDisabled
                      reason={!canNext ? "Nothing later" : undefined}
                    >
                      <IconTip label={`Next ${unit}`}>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Next ${unit}`}
                          disabled={!canNext}
                          onClick={() => goTo(nextAnchor)}
                        >
                          <ChevronRightIcon />
                        </Button>
                      </IconTip>
                    </WhyDisabled>
                  </div>
                )}
              </div>
            </div>
            <p aria-live="polite" className="sr-only">
              {announcement}
            </p>
          </SurfaceHeader>
        )}

        <AutoHeight>
          {body}
          {detailsCard}

          {hasProposals && (
            <section
              aria-labelledby={`${baseId}-proposals`}
              className="flex flex-col gap-1 border-t border-border py-2"
            >
              <h4
                id={`${baseId}-proposals`}
                className={cn(genuiType.label, "px-3")}
              >
                Proposed changes
              </h4>
              <ul className="flex flex-col">
                {readyProposals.map((p) => {
                  const s = summaryOf(p)
                  const accepted = isAccepted(p.id)
                  const conflictTitles =
                    items.find((i) => i.key === `p:${p.id}`)?.conflicts ?? []
                  const text = `${s.verb} ${s.name}`
                  return (
                    <motion.li
                      key={p.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className="flex flex-col gap-2 px-3 py-1.5 @md:flex-row @md:items-center @md:gap-4"
                    >
                      <div
                        className={cn(
                          "flex min-w-0 flex-1 flex-col gap-1",
                          !accepted && "text-muted-foreground",
                        )}
                      >
                        <p className="text-[13px]">
                          <span
                            className={cn(
                              "font-semibold",
                              !accepted &&
                                "line-through decoration-muted-foreground/60",
                            )}
                          >
                            {text}
                          </span>
                          {s.when && (
                            <span className="text-muted-foreground tabular-nums">
                              {" "}
                              · {s.when}
                            </span>
                          )}
                        </p>
                        {/* The reason lives in the event's details, one click away. */}
                        {p.reason && (
                          <span className="sr-only">{p.reason}</span>
                        )}
                        {accepted && conflictTitles.length > 0 && (
                          <p className="flex items-start gap-1.5 text-[13px]">
                            <AlertTriangleIcon
                              aria-hidden
                              className="mt-px size-3.5 shrink-0"
                            />
                            Conflicts with {joinTitles(conflictTitles)}
                          </p>
                        )}
                      </div>
                      {status === "applied" ? (
                        <span className="text-[13px] text-muted-foreground @md:pt-0.5">
                          {accepted ? "Accepted" : "Declined"}
                        </span>
                      ) : (
                        <fieldset className="inline-flex shrink-0 self-start rounded-full border border-border bg-transparent p-1 @md:self-auto">
                          <legend className="sr-only">{`${text} ${s.when}`}</legend>
                          {(["accept", "decline"] as const).map((choice) => {
                            const pressed =
                              choice === "accept" ? accepted : !accepted
                            return (
                              <button
                                key={choice}
                                type="button"
                                aria-pressed={pressed}
                                aria-label={`${choice === "accept" ? "Accept" : "Decline"}: ${text}`}
                                disabled={locked}
                                onClick={() =>
                                  setDeclined((prev) => {
                                    const next = new Set(prev)
                                    if (choice === "accept") next.delete(p.id)
                                    else next.add(p.id)
                                    return next
                                  })
                                }
                                className={cn(
                                  "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium text-muted-foreground transition-colors outline-none after:absolute after:inset-x-0 after:-inset-y-1.5",
                                  "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                                  "disabled:pointer-events-none disabled:opacity-60",
                                  "aria-pressed:bg-accent aria-pressed:text-foreground",
                                )}
                              >
                                {choice === "accept" ? (
                                  <CheckIcon aria-hidden className="size-3.5" />
                                ) : (
                                  <XIcon aria-hidden className="size-3.5" />
                                )}
                                {choice === "accept" ? "Accept" : "Decline"}
                              </button>
                            )
                          })}
                        </fieldset>
                      )}
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
                Approved {acceptedCount}{" "}
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
                  <WhyDisabled when={!feedback.trim()} reason="Write what should change">
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
                        : `Apply ${acceptedCount} ${acceptedCount === 1 ? "change" : "changes"}`}
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
/* Pieces                                                                   */
/* ------------------------------------------------------------------------ */

type ItemButtonProps = (item: Item) => {
  type: "button"
  "data-cal-key": string
  "aria-label": string
  "aria-expanded": boolean
  "aria-controls": string | undefined
  "aria-haspopup": "dialog"
  onClick: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void
}

const struck = (item: Item) =>
  item.state === "moving" || item.state === "cancelling"

/** Visual treatment per state. Text labels carry the meaning; style backs it up. */
function itemClasses(item: Item, selected: boolean) {
  return cn(
    "rounded-[10px] border text-left outline-none transition-colors",
    "focus-visible:ring-2 focus-visible:ring-ring/50",
    item.state === "proposed"
      ? "border-dashed border-foreground/50 bg-transparent hover:bg-foreground/5"
      : struck(item)
        ? "border-transparent bg-transparent text-muted-foreground opacity-70 hover:opacity-100"
        : item.busy
          ? `border-transparent ${CAL_FILL}`
          : "border-border bg-transparent hover:bg-foreground/5",
    selected && "ring-2 ring-ring",
  )
}

/** One-word state tag for blocks too short for the full notes. */
const COMPACT_TAGS: Partial<Record<ItemState, string>> = {
  proposed: "Proposed",
  cancelling: "Cancel",
  added: "Added",
  moved: "Moved",
}

function ItemTitle({
  item,
  className,
  compact = false,
  wrap = false,
  onFill = false,
}: {
  item: Item
  className?: string
  /** Short block: show the state as a tag after the title. */
  compact?: boolean
  /** A narrow (overlapping) block: two title lines, no calendar marker (it is in the details). */
  wrap?: boolean
  /** The title sits on its calendar's own fill. */
  onFill?: boolean
}) {
  const tag = compact ? COMPACT_TAGS[item.state] : undefined
  return (
    <span
      className={cn(
        "flex min-w-0 gap-1.5 font-medium",
        wrap ? "items-start" : "items-center",
        className,
      )}
    >
      {item.calendar && !wrap && (
        <Marker index={item.calendar.index} onFill={onFill} />
      )}
      {item.conflicts.length > 0 && (
        <AlertTriangleIcon
          aria-hidden
          className={cn("size-3 shrink-0", wrap && "mt-[3px]")}
        />
      )}
      <span
        className={cn(
          wrap ? "line-clamp-2 break-words" : "truncate",
          struck(item) && "line-through decoration-muted-foreground/70",
        )}
      >
        {item.title}
      </span>
      {compact && item.state === "proposed" && item.movedFrom !== undefined && (
        <ArrowRightIcon aria-hidden className="size-3 shrink-0" />
      )}
      {tag && (
        <span className="shrink-0 font-normal text-muted-foreground">
          {tag}
        </span>
      )}
    </span>
  )
}

/** The short text labels under a title: Proposed, Moved to…, Conflicts with… */
function ItemNotes({ item }: { item: Item }) {
  // One note per block, the one that matters most: a conflict, then the state.
  // The full set is in the button's label and the details panel.
  const note: React.ReactNode = item.conflicts.length ? (
    <span className="text-foreground">
      Conflicts with {joinTitles(item.conflicts)}
    </span>
  ) : item.state === "proposed" ? (
    item.movedFrom !== undefined ? (
      <span className="flex items-center gap-1">
        <ArrowRightIcon aria-hidden className="size-3 shrink-0" />
        Moved here
      </span>
    ) : (
      <span>Proposed</span>
    )
  ) : item.state === "cancelling" ? (
    <span>Cancel proposed</span>
  ) : item.state === "added" ? (
    <span>Added</span>
  ) : item.state === "moved" ? (
    <span>Moved</span>
  ) : null
  if (!note) return null
  return (
    <span className="flex min-w-0 flex-col text-[13px] leading-tight text-muted-foreground [&>span]:truncate">
      {note}
    </span>
  )
}

function Details({
  item,
  when,
  shortAt,
  onClose,
}: {
  item: Item
  when: string
  shortAt: (t: number) => string
  onClose: () => void
}) {
  const href = safeHref(item.url)
  const stateText: Partial<Record<ItemState, string>> = {
    proposed: "Proposed",
    moving: "Move proposed",
    cancelling: "Cancel proposed",
    added: "Added",
    moved: "Moved",
  }
  const rows: [string, React.ReactNode][] = []
  if (item.calendar) rows.push(["Calendar", item.calendar.label])
  if (item.location) rows.push(["Location", item.location])
  if (item.attendees !== undefined) {
    rows.push([
      "Attendees",
      `${item.attendees} ${item.attendees === 1 ? "person" : "people"}`,
    ])
  }
  if (!item.busy && item.state === "event") rows.push(["Shown as", "Free"])
  if (item.state === "proposed" && item.movedFrom !== undefined) {
    rows.push(["Currently", shortAt(item.movedFrom)])
  }
  if (item.state === "moving" && item.movedTo !== undefined) {
    rows.push(["Moving to", shortAt(item.movedTo)])
  }
  if (item.state === "moved" && item.movedFrom !== undefined) {
    rows.push(["Was", shortAt(item.movedFrom)])
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-[13px] font-semibold">
            {item.title}
            {stateText[item.state] && (
              <span className="font-normal text-muted-foreground">
                {" "}
                · {stateText[item.state]}
              </span>
            )}
          </p>
          <p className={genuiType.meta}>{when}</p>
        </div>
        <IconTip label="Close details">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close details"
            onClick={onClose}
            className="-mt-1.5 -mr-1.5"
          >
            <XIcon />
          </Button>
        </IconTip>
      </div>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          {rows.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      )}
      {item.reason && <p className="text-[13px]">{item.reason}</p>}
      {item.conflicts.length > 0 && (
        <p className="flex items-start gap-1.5 text-[13px]">
          <AlertTriangleIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          Conflicts with {joinTitles(item.conflicts)}
        </p>
      )}
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="inline-flex w-fit items-center gap-1 rounded-sm text-[13px] font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Open
          <ExternalLinkIcon aria-hidden className="size-3" />
          <span className="sr-only"> {item.title} (opens in a new tab)</span>
        </a>
      )}
    </div>
  )
}

/* Week and day ------------------------------------------------------------ */

function TimeGrid({
  days,
  items,
  tz,
  todayKey,
  nowT,
  workingHours,
  selected,
  itemButtonProps,
  timeText,
  skeleton,
  dayView,
  heightClass,
}: {
  days: string[]
  items: Item[]
  tz: string
  todayKey: string | null
  nowT: number | null
  workingHours?: { start?: string; end?: string }
  selected: string | null
  itemButtonProps: ItemButtonProps
  timeText: (t: number) => string
  skeleton: boolean
  dayView: boolean
  /** Max height of the scrolling hours (a Tailwind `max-h-*` class). */
  heightClass: string
}) {
  const locale = useGenUILocale()
  const workStart = parseHHmm(workingHours?.start) ?? 9 * 60
  const workEndRaw = parseHHmm(workingHours?.end) ?? 18 * 60
  const workEnd = workEndRaw > workStart ? workEndRaw : 18 * 60

  const columns = days.map((day) => {
    const allDay = items.filter(
      (i) =>
        i.iv.allDay &&
        diffDays(i.iv.startKey, day) >= 0 &&
        diffDays(day, i.iv.endKey) > 0,
    )
    const timed = items.flatMap((item) => {
      if (item.iv.allDay) return []
      const seg = segmentOnDay(item.iv, day, tz)
      if (!seg) return []
      return [
        {
          item,
          ...seg,
          // Only the first visible piece of a multi-day event is a button.
          primary: item.iv.startKey === day || day === days[0],
        },
      ]
    })
    const layout = layoutColumns(
      timed.map((s) => ({
        key: s.item.key,
        startMin: s.startMin,
        endMin: s.endMin,
      })),
    )
    return { day, allDay, timed, layout }
  })

  let gridStart = Math.max(0, Math.floor(workStart / 60) * 60 - 60)
  let gridEnd = Math.min(1440, Math.ceil(workEnd / 60) * 60 + 60)
  for (const c of columns) {
    for (const s of c.timed) {
      gridStart = Math.min(gridStart, Math.floor(s.startMin / 60) * 60)
      gridEnd = Math.max(gridEnd, Math.ceil(s.endMin / 60) * 60)
    }
  }
  const hours = (gridEnd - gridStart) / 60
  const hourList = Array.from({ length: hours }, (_, i) => gridStart / 60 + i)
  const height = hours * HOUR_PX
  const y = (min: number) => ((min - gridStart) / 60) * HOUR_PX
  const hasAllDay = columns.some((c) => c.allDay.length > 0)
  const nowKey = nowT !== null ? dayKeyOf(nowT, tz) : null
  const nowMin = nowT !== null ? minutesOfDay(nowT, tz) : null

  // The hours scroll inside the card. Open on what matters: the earliest
  // change under review, else the current time, else the start of the day.
  const changed = columns.flatMap((c) =>
    c.timed.filter((s) => s.item.state !== "event").map((s) => s.startMin),
  )
  const focusMin =
    changed.length > 0
      ? Math.min(...changed) - 15
      : nowKey !== null && days.includes(nowKey) && nowMin !== null
        ? Math.floor((nowMin - 60) / 60) * 60
        : workStart
  const focusTop = Math.max(0, Math.round(y(focusMin)))
  const scrollRef = React.useRef<HTMLElement>(null)
  const userScrolled = React.useRef(false)
  React.useEffect(() => {
    const el = scrollRef.current
    if (el && !userScrolled.current) el.scrollTop = focusTop
  }, [focusTop])
  const stopFollowing = () => {
    userScrolled.current = true
  }

  return (
    <section
      ref={scrollRef}
      aria-label={dayView ? "Day schedule" : "Week schedule"}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must be reachable by keyboard to scroll it
      tabIndex={0}
      onWheel={stopFollowing}
      onTouchStart={stopFollowing}
      onKeyDown={stopFollowing}
      onPointerDown={stopFollowing}
      className={cn(
        "overflow-y-auto overscroll-auto pb-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
        "[mask-image:linear-gradient(to_bottom,#000_calc(100%-1rem),transparent)]",
        heightClass,
      )}
    >
      <div
        className="grid"
        style={{
          gridTemplateColumns: `4.5rem repeat(${days.length}, minmax(0, 1fr))`,
        }}
      >
        <div
          aria-hidden
          className="sticky top-0 z-20 h-12 border-b bg-[var(--surface-bg)]"
          style={{ gridColumn: 1, gridRow: 1 }}
        />
        {hasAllDay && (
          <div
            className="sticky top-12 z-20 border-b bg-[var(--surface-bg)] px-1 py-1.5 text-right text-[13px] leading-tight text-muted-foreground"
            style={{ gridColumn: 1, gridRow: 2 }}
          >
            All day
          </div>
        )}
        <div
          aria-hidden
          className="relative"
          style={{ gridColumn: 1, gridRow: 3, height }}
        >
          {hourList.map((hour) => (
            <span
              key={hour}
              className="absolute right-1.5 text-[13px] leading-none text-muted-foreground tabular-nums"
              style={{ top: (hour - gridStart / 60) * HOUR_PX + 3 }}
            >
              {formatHour(hour, locale)}
            </span>
          ))}
          {/* The current time, pinned in the gutter on the line below. */}
          {nowT !== null &&
            nowKey !== null &&
            days.includes(nowKey) &&
            nowMin !== null &&
            nowMin >= gridStart &&
            nowMin <= gridEnd && (
              <span
                className="absolute right-1 z-10 -translate-y-1/2 rounded-full bg-foreground px-1.5 py-0.5 text-[13px] leading-none font-medium whitespace-nowrap text-background tabular-nums"
                style={{ top: y(nowMin) }}
              >
                {timeText(nowT)}
              </span>
            )}
        </div>

        {columns.map(({ day, allDay, timed, layout }, index) => {
          const isToday = day === todayKey
          return (
            <React.Fragment key={day}>
              <div
                className="sticky top-0 z-20 flex h-12 items-center justify-center border-b bg-[var(--surface-bg)] px-0.5"
                style={{ gridColumn: index + 2, gridRow: 1 }}
              >
                <div
                  className={cn(
                    "flex size-full flex-col items-center justify-center gap-0.5 rounded-[10px]",
                    isToday && "bg-foreground text-background",
                  )}
                >
                  <span
                    className={cn(
                      "text-[13px] leading-none",
                      !isToday && "text-muted-foreground",
                    )}
                  >
                    {formatDay(
                      day,
                      dayView ? "weekday-long" : "weekday",
                      locale,
                    )}
                  </span>
                  <span className="font-figure text-[24px] leading-none font-normal tabular-nums">
                    {formatDay(day, "day", locale)}
                  </span>
                  {isToday && <span className="sr-only">, today</span>}
                </div>
              </div>

              {hasAllDay && (
                <div
                  className="sticky top-12 z-20 flex min-w-0 flex-col gap-0.5 border-b bg-[var(--surface-bg)] p-0.5"
                  style={{ gridColumn: index + 2, gridRow: 2 }}
                >
                  {allDay.map((item) =>
                    item.iv.startKey === day || day === days[0] ? (
                      <motion.button
                        key={item.key}
                        {...itemButtonProps(item)}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={genuiMotion.fade}
                        style={calStyle(item)}
                        className={cn(
                          itemClasses(item, selected === item.key),
                          "flex h-6 min-w-0 items-center px-1.5 text-[13px]",
                        )}
                      >
                        <ItemTitle item={item} onFill={isFilled(item)} />
                      </motion.button>
                    ) : (
                      // Continuation of a multi-day event; the first day's button covers it.
                      <div
                        key={item.key}
                        aria-hidden
                        className="flex h-6 min-w-0 items-center rounded-md border border-border bg-transparent px-1.5 text-[13px] text-muted-foreground"
                      >
                        <span className="truncate">{item.title}</span>
                      </div>
                    ),
                  )}
                </div>
              )}

              <div
                className="relative"
                style={{ gridColumn: index + 2, gridRow: 3, height }}
              >
                {/* Hour lines and out-of-hours shading: decoration only. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                >
                  {hourList.slice(1).map((hour) => (
                    <div
                      key={hour}
                      className="absolute inset-x-0 border-t border-border/60"
                      style={{ top: (hour - gridStart / 60) * HOUR_PX }}
                    />
                  ))}
                </div>

                {timed.map(({ item, startMin, endMin, primary }) => {
                  const pos = layout.get(item.key) ?? { col: 0, cols: 1 }
                  const top = y(startMin)
                  const h = Math.max(((endMin - startMin) / 60) * HOUR_PX, 24)
                  const style: React.CSSProperties = {
                    top,
                    height: h,
                    left: `calc(${(pos.col / pos.cols) * 100}% + 1px)`,
                    width: `calc(${100 / pos.cols}% - 2px)`,
                    zIndex: item.state === "proposed" ? 2 : 1,
                  }
                  const compact = h < 36
                  const content = (
                    <>
                      <ItemTitle
                        item={item}
                        compact={compact}
                        wrap={!compact && pos.cols > 1}
                        onFill={isFilled(item)}
                        className="text-[13px] leading-tight"
                      />
                      {!compact && pos.cols === 1 && (
                        <span className="truncate text-[13px] leading-tight text-muted-foreground tabular-nums">
                          {timeText(item.iv.start)}–{timeText(item.iv.end)}
                        </span>
                      )}
                      {!compact && <ItemNotes item={item} />}
                    </>
                  )
                  return primary ? (
                    <motion.button
                      key={item.key}
                      {...itemButtonProps(item)}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      style={{ ...style, ...calStyle(item) }}
                      className={cn(
                        itemClasses(item, selected === item.key),
                        "absolute flex flex-col gap-0.5 overflow-hidden py-1",
                        pos.cols > 1 ? "px-1" : "px-2",
                      )}
                    >
                      {content}
                    </motion.button>
                  ) : (
                    <div
                      key={item.key}
                      aria-hidden
                      style={style}
                      className="absolute flex flex-col gap-0.5 overflow-hidden rounded-[10px] border bg-transparent px-1.5 py-1"
                    >
                      {content}
                    </div>
                  )
                })}

                {skeleton && index % 2 === 0 && (
                  <Skeleton
                    className="absolute inset-x-1 rounded-md"
                    style={{
                      top: HOUR_PX * (1 + (index % 3)),
                      height: HOUR_PX,
                    }}
                  />
                )}

                {day === nowKey &&
                  nowMin !== null &&
                  nowMin >= gridStart &&
                  nowMin <= gridEnd && (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-10 h-px bg-foreground"
                      style={{ top: y(nowMin) }}
                    >
                      <span className="absolute -top-[3px] -left-[3px] size-[7px] rounded-full bg-foreground" />
                    </div>
                  )}
              </div>
            </React.Fragment>
          )
        })}
      </div>
    </section>
  )
}

/* Today ------------------------------------------------------------------- */

/** One-word text label per block. Style backs it up; never color alone. */
function todayTag(item: Item, mark: "now" | "next" | undefined) {
  if (mark === "now") return "Now"
  if (mark === "next") return "Next"
  if (item.state === "proposed") return "Proposed"
  if (item.state === "moving") return "Move proposed"
  if (item.state === "cancelling") return "Cancel proposed"
  if (item.state === "added") return "Added"
  if (item.state === "moved") return "Moved"
  // All-day events are free by default, so only timed ones say so.
  if (!item.busy && !item.iv.allDay) return "Free"
  return null
}

/** The current time between two events: a dot and a hairline. Decorative; the Now / Next labels carry it. */
function NowLine() {
  return (
    <li aria-hidden className="flex items-center gap-2 py-0.5">
      <span className="size-2 shrink-0 rounded-full bg-foreground" />
      <span className="h-px flex-1 bg-foreground" />
    </li>
  )
}

function TodayCard({
  day,
  items,
  tz,
  todayKey,
  nowT,
  selected,
  itemButtonProps,
  shortAt,
  skeleton,
  zoneLabel,
}: {
  day: string | null
  items: Item[]
  tz: string
  todayKey: string | null
  nowT: number | null
  selected: string | null
  itemButtonProps: ItemButtonProps
  shortAt: (t: number) => string
  skeleton: boolean
  zoneLabel: string
}) {
  const locale = useGenUILocale()
  const allDay = day
    ? items.filter(
        (i) =>
          i.iv.allDay &&
          diffDays(i.iv.startKey, day) >= 0 &&
          diffDays(day, i.iv.endKey) > 0,
      )
    : []
  const timed = day
    ? items.flatMap((item) => {
        if (item.iv.allDay) return []
        const seg = segmentOnDay(item.iv, day, tz)
        return seg ? [{ item, ...seg }] : []
      })
    : []
  // Only real (or applied) events get Now / Next; proposals keep their label.
  const marks =
    day && day === todayKey
      ? nowAndNext(
          timed
            .filter(
              ({ item }) =>
                item.state === "event" ||
                item.state === "added" ||
                item.state === "moved",
            )
            .map(({ item }) => ({
              key: item.key,
              start: item.iv.start,
              end: item.iv.end,
            })),
          nowT,
        )
      : new Map<string, "now" | "next">()

  const empty = allDay.length === 0 && timed.length === 0

  // The current time as a line between the events that are over (or running)
  // and the ones still to come; only on today.
  const nowLine =
    day && day === todayKey && nowT !== null && timed.length > 0
      ? (() => {
          const i = timed.findIndex(({ item }) => item.iv.start > nowT)
          return i < 0 ? timed.length : i
        })()
      : -1

  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 px-3 py-3">
      <div className="flex flex-col">
        {day ? (
          <>
            <span aria-hidden className={genuiType.label}>
              {formatDay(day, "weekday", locale)}
            </span>
            <span aria-hidden className={cn(genuiType.display, "text-[40px]")}>
              {formatDay(day, "day", locale)}
            </span>
            <span className="sr-only">
              {formatDay(day, "long", locale)}
              {day === todayKey && ", today"}. Times in {zoneLabel}.
            </span>
          </>
        ) : (
          <>
            <Skeleton className="h-3 w-8" />
            <Skeleton className="mt-1.5 h-11 w-14" />
          </>
        )}
      </div>

      {/* Long days scroll inside the card; the padding keeps focus rings visible. */}
      <ScrollFade className="-m-1 max-h-96 min-w-0" viewportClassName="flex flex-col gap-1.5 overflow-y-auto p-1">
        {allDay.length > 0 && (
          <ul aria-label="All day" className="flex flex-col gap-1.5">
            {allDay.map((item) => {
              const tag = todayTag(item, undefined)
              return (
                <li key={item.key}>
                  <motion.button
                    {...itemButtonProps(item)}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    style={calStyle(item)}
                    className={cn(
                      "flex min-h-8 w-full min-w-0 items-center gap-2 rounded-full px-3.5 py-1 text-left text-[13px] outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                      item.state === "proposed"
                        ? "border border-dashed border-foreground/50 bg-card hover:bg-muted/50"
                        : struck(item)
                          ? "border border-border bg-transparent text-muted-foreground opacity-70 hover:opacity-100"
                          : `border border-transparent ${CAL_FILL}`,
                      selected === item.key && "ring-2 ring-ring",
                    )}
                  >
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate font-semibold",
                        struck(item) &&
                          "line-through decoration-muted-foreground/70",
                      )}
                    >
                      {item.title}
                    </span>
                    {tag && <span className="shrink-0 opacity-80">{tag}</span>}
                  </motion.button>
                </li>
              )
            })}
          </ul>
        )}

        {timed.length > 0 && (
          <ol aria-label="Events" className="flex flex-col gap-1.5">
            {timed.map(({ item, startMin, endMin }, index) => {
              const mark = marks.get(item.key)
              const past =
                nowLine >= 0 &&
                item.iv.end > item.iv.start &&
                item.iv.end <= (nowT ?? 0)
              const tag = todayTag(item, mark)
              const untimed = item.iv.end === item.iv.start
              const continues = item.iv.startKey !== day
              const props = itemButtonProps(item)
              return (
                <React.Fragment key={item.key}>
                {nowLine === index && <NowLine />}
                <li>
                  <motion.button
                    {...props}
                    aria-label={
                      mark === "now"
                        ? `${props["aria-label"]}, happening now`
                        : mark === "next"
                          ? `${props["aria-label"]}, up next`
                          : props["aria-label"]
                    }
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    style={{
                      ...calStyle(item),
                      minHeight: untimed
                        ? undefined
                        : agendaBlockHeight(endMin - startMin),
                    }}
                    className={cn(
                      "flex w-full min-w-0 flex-col justify-start gap-0.5 rounded-[10px] px-4 py-3 text-left outline-none transition-colors",
                      "focus-visible:ring-2 focus-visible:ring-ring/50",
                      item.state === "proposed"
                        ? "border border-dashed border-foreground/50 bg-card hover:bg-muted/50"
                        : struck(item)
                          ? "border border-border bg-transparent text-muted-foreground opacity-70 hover:opacity-100"
                          : !item.busy && item.state === "event"
                            ? "border border-border bg-transparent hover:bg-foreground/5"
                            : `border border-transparent ${CAL_FILL}`,
                      past && "opacity-60 hover:opacity-100",
                      selected === item.key && "ring-2 ring-ring",
                    )}
                  >
                    <span className="flex w-full min-w-0 items-baseline gap-2">
                      <ItemTitle
                        item={item}
                        onFill={isFilled(item)}
                        className="min-w-0 flex-1 text-[13px] leading-snug font-semibold"
                      />
                      {tag && (
                        <span
                          className={cn(
                            "shrink-0 text-[13px]",
                            mark ? "font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {tag}
                        </span>
                      )}
                    </span>
                    {!untimed && (
                      <span className="truncate text-[13px] text-muted-foreground tabular-nums">
                        {continues
                          ? `Until ${formatTime(item.iv.end, tz, locale)}`
                          : formatTimeRange(
                              item.iv.start,
                              item.iv.end,
                              tz,
                              locale,
                            )}
                      </span>
                    )}
                    {item.state === "proposed" &&
                      item.movedFrom !== undefined && (
                        <span className="truncate text-[13px] text-muted-foreground">
                          Moved from {shortAt(item.movedFrom)}
                        </span>
                      )}
                    {item.state === "moving" && item.movedTo !== undefined && (
                      <span className="truncate text-[13px]">
                        Moving to {shortAt(item.movedTo)}
                      </span>
                    )}
                    {item.conflicts.length > 0 && (
                      <span className="truncate text-[13px]">
                        Conflicts with {joinTitles(item.conflicts)}
                      </span>
                    )}
                  </motion.button>
                </li>
                </React.Fragment>
              )
            })}
            {nowLine === timed.length && <NowLine />}
          </ol>
        )}

        {skeleton && (
          <div aria-hidden className="flex flex-col gap-1.5">
            <Skeleton className="h-8 w-full rounded-full" />
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-11 w-full rounded-lg" />
          </div>
        )}
        {empty && !skeleton && day && (
          <p className="py-2 text-[13px] text-muted-foreground">
            Nothing scheduled
          </p>
        )}
      </ScrollFade>
    </div>
  )
}

/* Month ------------------------------------------------------------------- */

function MonthView({
  anchor,
  firstDay,
  items,
  todayKey,
  selected,
  expandedDays,
  onExpand,
  itemButtonProps,
  timeText,
  skeleton,
}: {
  anchor: string
  firstDay: number
  items: Item[]
  todayKey: string | null
  selected: string | null
  expandedDays: Set<string>
  onExpand: (day: string) => void
  itemButtonProps: ItemButtonProps
  timeText: (t: number) => string
  skeleton: boolean
}) {
  const locale = useGenUILocale()
  const weeks = monthGrid(anchor, firstDay)
  const gridRef = React.useRef<HTMLDivElement>(null)
  const month = anchor.slice(0, 7)

  // Arrow keys move between days; Up/Down move a week.
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    const steps: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }
    const delta = steps[e.key]
    const grid = gridRef.current
    const cell = (e.currentTarget as HTMLElement).closest<HTMLElement>(
      "[data-day]",
    )
    if (!delta || !grid || !cell?.dataset.day) return
    let key = cell.dataset.day
    for (let i = 0; i < 42; i++) {
      key = addDays(key, delta)
      const day = grid.querySelector(`[data-day="${key}"]`)
      if (!day) return
      const target = day.querySelector<HTMLElement>("[data-cal-focus]")
      if (target) {
        e.preventDefault()
        target.focus()
        return
      }
    }
  }

  return (
    <div ref={gridRef}>
      <div aria-hidden className="grid grid-cols-7 border-b">
        {weeks[0].map((day) => (
          <div
            key={day}
            className="px-1.5 py-1.5 text-[13px] text-muted-foreground"
          >
            {formatDay(day, "weekday", locale)}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div
          key={week[0]}
          className="grid grid-cols-7 border-b last:border-b-0"
        >
          {week.map((day) => {
            const inMonth = day.startsWith(month)
            const dayItems = items.filter(
              (i) =>
                diffDays(i.iv.startKey, day) >= 0 &&
                diffDays(day, i.iv.endKey) > 0,
            )
            const collapsed =
              dayItems.length > MONTH_COLLAPSE_OVER && !expandedDays.has(day)
            const shown = collapsed
              ? dayItems.slice(0, MONTH_COLLAPSED_SHOWS)
              : dayItems
            const isToday = day === todayKey
            return (
              <div
                key={day}
                data-day={day}
                className={cn(
                  "flex min-h-[5.25rem] min-w-0 flex-col gap-0.5 p-1",
                )}
              >
                <span
                  className={cn(
                    "inline-flex size-5 items-center justify-center rounded-full text-xs tabular-nums",
                    !inMonth && "text-muted-foreground",
                    isToday && "bg-foreground font-medium text-background",
                  )}
                >
                  {formatDay(day, "day", locale)}
                  {isToday && <span className="sr-only">, today</span>}
                </span>
                {shown.map((item) => {
                  const props = itemButtonProps(item)
                  return (
                    <motion.button
                      key={item.key}
                      {...props}
                      data-cal-focus=""
                      onKeyDown={(e) => {
                        props.onKeyDown(e)
                        onKeyDown(e)
                      }}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      style={calStyle(item)}
                      className={cn(
                        itemClasses(item, selected === item.key),
                        "flex h-6 min-w-0 items-center gap-1 px-1 text-[13px]",
                        !item.iv.allDay &&
                          item.state !== "proposed" &&
                          "border-transparent bg-transparent hover:bg-muted",
                      )}
                    >
                      {!item.iv.allDay && (
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {timeText(item.iv.start)}
                        </span>
                      )}
                      <ItemTitle
                        item={item}
                        onFill={item.iv.allDay && isFilled(item)}
                      />
                    </motion.button>
                  )
                })}
                {collapsed && (
                  <button
                    type="button"
                    data-cal-focus=""
                    onKeyDown={onKeyDown}
                    aria-expanded={false}
                    aria-label={`Show ${dayItems.length - shown.length} more events on ${formatDay(day, "long", locale)}`}
                    onClick={() => onExpand(day)}
                    className="h-6 rounded-md px-1 text-left text-[13px] font-medium text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    +{dayItems.length - shown.length} more
                  </button>
                )}
                {skeleton && inMonth && Number(day.slice(8, 10)) % 4 === 1 && (
                  <Skeleton className="h-4 w-4/5" />
                )}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/* Agenda ------------------------------------------------------------------ */

function AgendaView({
  items,
  rangeStart,
  spanDays,
  todayKey,
  selected,
  itemButtonProps,
  timeText,
  shortAt,
  skeleton,
  heightClass,
}: {
  items: Item[]
  rangeStart: string | null
  spanDays: number
  todayKey: string | null
  selected: string | null
  itemButtonProps: ItemButtonProps
  timeText: (t: number) => string
  shortAt: (t: number) => string
  skeleton: boolean
  /** Max height of the scrolling list (a Tailwind `max-h-*` class). */
  heightClass: string
}) {
  const locale = useGenUILocale()
  // Every day in the range, plus any day an event reaches outside it.
  let first = rangeStart ?? items[0]?.iv.startKey
  let last = rangeStart ? addDays(rangeStart, spanDays) : first
  for (const i of items) {
    if (first && diffDays(i.iv.startKey, first) > 0) first = i.iv.startKey
    if (last && diffDays(last, i.iv.endKey) > 0) last = i.iv.endKey
  }
  const days =
    first && last ? dayRange(first, Math.min(62, diffDays(first, last))) : []
  const groups = days
    .map((day) => ({
      day,
      items: items.filter(
        (i) =>
          diffDays(i.iv.startKey, day) >= 0 && diffDays(day, i.iv.endKey) > 0,
      ),
    }))
    .filter((g) => g.items.length > 0)

  if (groups.length === 0) {
    return skeleton ? (
      <div className="flex flex-col gap-3 px-3 py-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    ) : (
      <p className="px-3 py-3 text-[13px] text-muted-foreground">
        Nothing scheduled
      </p>
    )
  }

  return (
    <ScrollFade
      label="Agenda"
      className={heightClass}
      viewportClassName="overflow-y-auto pb-3"
    >
      <ol className="flex flex-col gap-5 pt-1">
        {groups.map(({ day, items: dayItems }) => (
          <li key={day}>
            <h4 className={cn(genuiType.label, "px-3 pb-1")}>
              {formatDay(day, "long", locale)}
              {day === todayKey && " · Today"}
            </h4>
            <ul>
              {dayItems.map((item) => {
                const continues = item.iv.startKey !== day
                return (
                  <li key={item.key}>
                    <motion.button
                      {...itemButtonProps(item)}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className={cn(
                        "flex w-full gap-3 px-3 py-3 text-left text-[13px] outline-none transition-colors",
                        "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
                        selected === item.key && "bg-muted/50",
                        struck(item) && "text-muted-foreground",
                      )}
                    >
                      <span className="w-28 shrink-0 pt-px text-[13px] text-muted-foreground tabular-nums">
                        {item.iv.allDay
                          ? "All day"
                          : continues
                            ? `Until ${timeText(item.iv.end)}`
                            : `${timeText(item.iv.start)}–${timeText(item.iv.end)}`}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <ItemTitle item={item} />
                          {item.state === "proposed" && (
                            <Badge variant="warning" className="text-[13px]">
                              Proposed
                            </Badge>
                          )}
                        </span>
                        {item.location && (
                          <span className="truncate text-[13px] text-muted-foreground">
                            {item.location}
                          </span>
                        )}
                        <AgendaNotes item={item} shortAt={shortAt} />
                      </span>
                    </motion.button>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ol>
    </ScrollFade>
  )
}

function AgendaNotes({
  item,
  shortAt,
}: {
  item: Item
  shortAt: (t: number) => string
}) {
  const notes: string[] = []
  if (item.state === "proposed" && item.movedFrom !== undefined) {
    notes.push(`Moved from ${shortAt(item.movedFrom)}`)
  }
  if (item.state === "moving" && item.movedTo !== undefined) {
    notes.push(`Moving to ${shortAt(item.movedTo)}`)
  }
  if (item.state === "cancelling") notes.push("Cancel proposed")
  if (item.state === "added") notes.push("Added")
  if (item.state === "moved") notes.push("Moved")
  if (!item.busy && item.state === "event") notes.push("Free")
  return (
    <>
      {notes.length > 0 && (
        <span className="text-[13px] text-muted-foreground">
          {notes.join(" · ")}
        </span>
      )}
      {item.conflicts.length > 0 && (
        <span className="flex items-start gap-1.5 text-[13px]">
          <AlertTriangleIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          Conflicts with {joinTitles(item.conflicts)}
        </span>
      )}
    </>
  )
}
