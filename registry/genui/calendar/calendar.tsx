"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
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
import { Segmented } from "@/components/genui/segmented"

import type {
  CalendarEvent,
  CalendarInput,
  CalendarProposal,
  CalendarResult,
  CalendarSource,
  CalendarTodo,
  CalendarView,
} from "./calendar.schema"
import {
  type Interval,
  addDays,
  addMonths,
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
  startOfWeek,
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
  Omit<
    CalendarInput,
    "range" | "events" | "proposals" | "calendars" | "todos" | "workingHours"
  >
> & {
  range?: Partial<CalendarInput["range"]>
  /** Events, to-dos and proposals may be partial while the tool call streams. */
  events?: Partial<CalendarEvent>[]
  calendars?: Partial<CalendarSource>[]
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
  week: "Week",
  day: "Day",
  month: "Month",
  today: "Today",
}
const VIEW_ORDER: CalendarView[] = ["week", "day", "month"]
const MONTH_SHOWS = 3

/**
 * Calendar colours (D26, restored by D72): solid fills with their own text
 * colour, after Google Calendar's dark theme: slate blue, teal, gold, green,
 * and grey for later calendars and events with no calendar. Dark mode takes
 * the original values; light mode uses deeper fills with white text, and its
 * teal, gold and green are deepened a little further so every text colour is
 * at least 4.5:1 on its fill in both themes. Put on the root: `--cal-bg-n` is
 * the fill, `--cal-fg-n` the text on it.
 */
const CAL_VARS = [
  "[--cal-bg-0:#5560a8] [--cal-fg-0:#ffffff]",
  "[--cal-bg-1:#2f7d6d] [--cal-fg-1:#ffffff]",
  "[--cal-bg-2:#8a6600] [--cal-fg-2:#ffffff]",
  "[--cal-bg-3:#2f7a4f] [--cal-fg-3:#ffffff]",
  "[--cal-bg-4:#6c6f74] [--cal-fg-4:#ffffff]",
  "dark:[--cal-bg-0:#4a5588] dark:[--cal-fg-0:#e6e9f8]",
  "dark:[--cal-bg-1:#5a9a8e] dark:[--cal-fg-1:#0a1f1b]",
  "dark:[--cal-bg-2:#e9c45b] dark:[--cal-fg-2:#2a2100]",
  "dark:[--cal-bg-3:#6db38a] dark:[--cal-fg-3:#0d2416]",
  "dark:[--cal-bg-4:#505256] dark:[--cal-fg-4:#ececec]",
].join(" ")

const CAL_COLORS = 4
const calSlot = (index: number | undefined) =>
  index !== undefined && index < CAL_COLORS ? index : CAL_COLORS

/** Shapes back the colour up, so a calendar is never told apart by colour alone (D26). */
const MARKERS = [
  "rounded-full bg-current",
  "rounded-full border-2 border-current",
  "rounded-[2px] bg-current",
  "rounded-[2px] border-2 border-current",
  "rotate-45 rounded-[1px] bg-current",
  "rotate-45 rounded-[1px] border-2 border-current",
]

/** `onFill`: the marker sits on its calendar's own fill, so it takes the text colour; elsewhere it is the fill colour. */
function Marker({ index, onFill = false }: { index: number; onFill?: boolean }) {
  return (
    <span
      aria-hidden
      style={onFill ? undefined : { color: `var(--cal-bg-${calSlot(index)})` }}
      className={cn("inline-block size-2 shrink-0", MARKERS[index % MARKERS.length])}
    />
  )
}

/** Sets the event's fill and text colour from its calendar (grey when it has none). */
const calStyle = (item: Item): React.CSSProperties => {
  const slot = calSlot(item.calendar?.index)
  return {
    "--cal-bg": `var(--cal-bg-${slot})`,
    "--cal-fg": `var(--cal-fg-${slot})`,
  } as React.CSSProperties
}

/** What a block's state means, said in words: the sr text never relies on the look. */
const STATE_TEXT: Partial<Record<ItemState, string>> = {
  proposed: "proposed",
  moving: "proposed to move from here",
  cancelling: "proposed to cancel",
  added: "added",
  moved: "moved",
}

/**
 * The schedule's look (D71, D72): an event is a solid block in its calendar's
 * colour; a change (a proposal, or one just applied) is the solid foreground
 * block; the slot a move leaves and an event being cancelled are dashed
 * outlines; a free timed event is hollow, with its calendar's marker.
 */
const CAL_FILL =
  "border border-transparent bg-[var(--cal-bg)] text-[color:var(--cal-fg)] hover:brightness-110"
const CHANGED_FILL =
  "border border-transparent bg-foreground text-background hover:opacity-90"
const DASHED =
  "border border-dashed border-foreground/45 text-muted-foreground hover:bg-foreground/5"
const FREE = "border border-border hover:bg-foreground/5"

const isChanged = (item: Item) =>
  item.state === "proposed" || item.state === "added" || item.state === "moved"
const isStruck = (item: Item) =>
  item.state === "moving" || item.state === "cancelling"

function itemTone(item: Item) {
  if (isChanged(item)) return CHANGED_FILL
  if (isStruck(item)) return DASHED
  // All-day events are free by default, but they are still shown filled.
  return item.busy || item.iv.allDay ? CAL_FILL : FREE
}

/**
 * Days, hours, times and durations on the schedule: 'Mon 12', '9a', '9:30 AM',
 * '15 min'. The `schedule-label` role in the design foundations. Never all caps.
 */
const SCHEDULE_LABEL =
  "font-mono text-[13px] leading-none tracking-[0.02em] tabular-nums"

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
  calendars = [],
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

  /* Local view state: what the user looks at. Never fetches. */
  const [userView, setUserView] = React.useState<CalendarView | null>(null)
  const [userAnchor, setUserAnchor] = React.useState<string | null>(null)
  const [selected, setSelected] = React.useState<string | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const firstDay = React.useMemo(() => firstDayOfWeek(locale), [locale])

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
      // Decided: the resulting schedule, with what changed marked.
      for (const e of applyProposals(readyEvents, readyProposals, acceptedIds)) {
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
          : { title: p.title, busy: true, conflicts: [] }),
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
  const initialView: CalendarView = VIEW_ORDER.concat("today").includes(
    viewProp as CalendarView,
  )
    ? (viewProp as CalendarView)
    : "week"
  const spanDays = rangeStart
    ? (range?.days ??
      (initialView === "day" || initialView === "today"
        ? 1
        : initialView === "month"
          ? daysInMonth(rangeStart) - Number(rangeStart.slice(8, 10)) + 1
          : 7))
    : 7

  // The switch only offers views the events can fill. Today has none.
  const options =
    initialView === "today"
      ? []
      : VIEW_ORDER.filter(
          (v) =>
            v === initialView ||
            v === "day" ||
            (v === "week" && spanDays > 1) ||
            (v === "month" && spanDays >= 14),
        )
  const view: CalendarView = userView ?? initialView

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
        ? [a, Math.min(7, spanDays)]
        : [a, daysInMonth(a)]
  const step = (v: CalendarView, a: string, dir: 1 | -1) =>
    v === "month"
      ? addMonths(a, dir)
      : addDays(a, v === "day" ? dir : 7 * dir)
  const hasItems = (v: CalendarView, a: string) =>
    anyInDays(intervals, ...periodDays(v, a))
  const periodLabel = (v: CalendarView, a: string) =>
    v === "month"
      ? formatDay(a, "month", locale)
      : formatRangeLabel(...periodDays(v, a), locale)

  const navigable = view !== "today"
  const prevAnchor = anchor && navigable ? step(view, anchor, -1) : null
  const nextAnchor = anchor && navigable ? step(view, anchor, 1) : null
  const todayAnchor = todayKey && navigable ? anchorFor(view, todayKey) : null
  const canPrev = !!prevAnchor && hasItems(view, prevAnchor)
  const canNext = !!nextAnchor && hasItems(view, nextAnchor)
  const canToday =
    !!todayAnchor && todayAnchor !== anchor && hasItems(view, todayAnchor)
  const unit = view === "day" ? "day" : view === "week" ? "week" : "month"
  const showNav = navigable && (canPrev || canNext || canToday)

  const rangeLabel = anchor ? periodLabel(view, anchor) : null
  const visibleDays: string[] =
    !anchor || view === "month" || view === "today"
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
  const switchView = (v: CalendarView, focusDay?: string) => {
    const sel = items.find((i) => i.key === selected)
    const focus =
      focusDay ||
      sel?.iv.startKey ||
      (todayKey && visibleDays.includes(todayKey) ? todayKey : null) ||
      (anchor && view === "month" && rangeStart?.startsWith(anchor.slice(0, 7))
        ? rangeStart
        : anchor) ||
      rangeStart
    const a = focus ? anchorFor(v, focus) : null
    setUserView(v)
    setUserAnchor(a)
    setSelected(null)
    announce(v, a)
  }

  /* Labels. */
  const timeText = (t: number) => formatTime(t, tz, locale)
  const whenText = (iv: Interval, long = false) => {
    if (iv.allDay) {
      const last = addDays(iv.endKey, -1)
      const style = long ? "long" : "date"
      return last === iv.startKey
        ? `${formatDay(iv.startKey, style, locale)}, all day`
        : `${formatDay(iv.startKey, style, locale)} to ${formatDay(last, style, locale)}, all day`
    }
    const day = (t: number) =>
      long
        ? formatDay(dayKeyOf(t, tz), "long", locale)
        : formatWeekdayAt(t, tz, "long", locale)
    if (iv.end <= iv.start) return `${day(iv.start)} ${timeText(iv.start)}`
    const sameDay = dayKeyOf(iv.start, tz) === dayKeyOf(iv.end - 1, tz)
    return sameDay
      ? `${day(iv.start)} ${timeText(iv.start)} to ${timeText(iv.end)}`
      : `${day(iv.start)} ${timeText(iv.start)} to ${day(iv.end)} ${timeText(iv.end)}`
  }
  const shortAt = (t: number) =>
    `${formatWeekdayAt(t, tz, "short", locale)} ${timeText(t)}`
  const itemLabel = (item: Item) => {
    const parts = [item.title, whenText(item.iv)]
    if (item.calendar) parts.push(`${item.calendar.label} calendar`)
    if (STATE_TEXT[item.state]) parts.push(STATE_TEXT[item.state] as string)
    if (!item.busy && item.state === "event" && !item.iv.allDay) {
      parts.push("free")
    }
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
  const activeItem = items.find((i) => i.key === selected) ?? null
  // The card keeps its last event while it animates out.
  const lastActive = React.useRef<Item | null>(null)
  if (activeItem) lastActive.current = activeItem
  const cardItem = activeItem ?? lastActive.current
  // Switching from one event to another slides the card; the first open does not.
  const [glide, setGlide] = React.useState(false)
  const prevActive = React.useRef<string | null>(null)
  React.useLayoutEffect(() => {
    if (selected === null) setGlide(false)
    else if (prevActive.current !== null && prevActive.current !== selected)
      setGlide(true)
    prevActive.current = selected
  }, [selected])
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

  const legend = calendarIndex.length > 1 ? calendarIndex : []
  const zone = `Times in ${tz.replace(/_/g, " ")}.`
  const skeleton = streaming && readyEvents.length === 0

  let body: React.ReactNode
  if (!anchor) {
    body = (
      <div className="px-3 pb-3">
        <Skeleton className="h-72 w-full rounded-[10px]" />
      </div>
    )
  } else if (view === "today") {
    body = (
      <TodayList
        day={anchor}
        items={items}
        todos={readyTodos}
        tz={tz}
        todayKey={todayKey}
        nowT={nowT}
        selected={selected}
        itemButtonProps={itemButtonProps}
        skeleton={skeleton}
      />
    )
  } else if (view === "month") {
    body = (
      <MonthGrid
        month={anchor}
        items={items}
        todayKey={todayKey}
        selected={selected}
        itemButtonProps={itemButtonProps}
        timeText={(t) => formatTimeShort(t, tz, locale)}
        onOpenDay={
          options.includes("day") ? (day) => switchView("day", day) : undefined
        }
        skeleton={skeleton}
      />
    )
  } else {
    body = (
      <TimeGrid
        days={visibleDays}
        items={items}
        tz={tz}
        todayKey={todayKey}
        workingHours={workingHours}
        selected={selected}
        itemButtonProps={itemButtonProps}
        timeText={timeText}
        timeShort={(t) => formatTimeShort(t, tz, locale)}
        skeleton={skeleton}
      />
    )
  }

  const multiple = readyProposals.length > 1
  const acceptedCount = acceptedIds.length
  const declinedCount = readyProposals.length - acceptedCount
  const showFooter = hasProposals || (result !== undefined && !streaming)
  const showMeta = !streaming && ((title && rangeLabel) || legend.length > 0)

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
          // The list carries its own date line; the title is for screen readers.
          <h3 id={titleId} className="sr-only">
            {title ?? rangeLabel ?? "Today"}. {zone}
          </h3>
        ) : (
          <SurfaceHeader className="gap-2 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-col gap-0.5">
                <SurfaceTitle id={titleId}>
                  {title ?? rangeLabel}
                  {title && rangeLabel && (
                    <span className="sr-only">, {rangeLabel}</span>
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
                {showMeta && (
                  <div
                    className={cn(
                      genuiType.meta,
                      "flex flex-wrap items-center gap-x-3 gap-y-0.5",
                    )}
                  >
                    {title && rangeLabel && <p>{rangeLabel}</p>}
                    {legend.length > 0 && (
                      <ul aria-label="Calendars" className="flex flex-wrap gap-x-3">
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
                {options.length > 1 && (
                  <Segmented
                    label="View"
                    value={view}
                    options={options.map((v) => ({
                      value: v,
                      label: VIEW_LABELS[v],
                    }))}
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
                    <WhyDisabled reason={!canPrev ? "Nothing earlier" : undefined}>
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
                    <WhyDisabled reason={!canNext ? "Nothing later" : undefined}>
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

const fadeIn = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
}

/** Shared by every event you can press: a focus ring, and the selected ring (D8). */
const PRESSABLE =
  "text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50"
const SELECTED = "ring-2 ring-choice"

/** Hollow events (free, timed) sit on the card, so their marker is the calendar's colour. */
const isHollow = (item: Item) =>
  item.state === "event" && !item.busy && !item.iv.allDay

/** The calendar marker (when it has one), a warning for a conflict, then the title. */
function ItemTitle({
  item,
  className,
  showMarker = true,
}: {
  item: Item
  className?: string
  showMarker?: boolean
}) {
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {showMarker && item.calendar && (
        <Marker index={item.calendar.index} onFill={!isHollow(item)} />
      )}
      {item.conflicts.length > 0 && (
        <AlertTriangleIcon aria-hidden className="size-3 shrink-0" />
      )}
      <span
        className={cn(
          "truncate",
          item.state === "cancelling" && "line-through decoration-current/60",
        )}
      >
        {item.title}
      </span>
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
  if (item.calendar) {
    rows.push([
      "Calendar",
      <span key="cal" className="flex items-center gap-1.5">
        <Marker index={item.calendar.index} />
        {item.calendar.label}
      </span>,
    ])
  }
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
  workingHours,
  selected,
  itemButtonProps,
  timeText,
  timeShort,
  skeleton,
}: {
  days: string[]
  items: Item[]
  tz: string
  todayKey: string | null
  workingHours?: { start?: string; end?: string }
  selected: string | null
  itemButtonProps: ItemButtonProps
  timeText: (t: number) => string
  /** A compact time ('3p') for the short blocks that have no room for a line of their own. */
  timeShort: (t: number) => string
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
  const y = (min: number) => ((min - gridStart) / 60) * hourPx
  /** Every hour line, top to bottom, as hours of the day. */
  const hourLines = Array.from({ length: hours + 1 }, (_, i) => gridStart / 60 + i)
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
          gridTemplateColumns: `2.25rem repeat(${days.length}, minmax(${many ? "5rem" : "0"}, 1fr))`,
        }}
      >
        {columns.map(({ day }, index) => (
          <div
            key={day}
            className={cn(
              SCHEDULE_LABEL,
              "truncate px-0.5 pb-3",
              day === todayKey ? "text-foreground" : "text-muted-foreground",
            )}
            style={{ gridColumn: index + 2, gridRow: 1 }}
          >
            <span aria-hidden>
              {formatDay(day, "weekday", locale)} {formatDay(day, "day", locale)}
            </span>
            <h4 className="sr-only">
              {formatDay(day, "long", locale)}
              {day === todayKey && ", today"}
            </h4>
          </div>
        ))}

        {hasAllDay &&
          columns.map(({ day, allDay }, index) => (
            <div
              key={day}
              className="flex min-w-0 flex-col gap-1 pb-2"
              style={{ gridColumn: index + 2, gridRow: 2 }}
            >
              {allDay.map((item) =>
                item.iv.startKey === day || day === days[0] ? (
                  <motion.button
                    key={item.key}
                    {...itemButtonProps(item)}
                    {...fadeIn}
                    style={calStyle(item)}
                    className={cn(
                      PRESSABLE,
                      "flex h-6 min-w-0 items-center rounded-full px-2.5 text-[13px]",
                      itemTone(item),
                      selected === item.key && SELECTED,
                    )}
                  >
                    <ItemTitle item={item} />
                  </motion.button>
                ) : (
                  // Continuation of a multi-day event; the first day's button covers it.
                  <div
                    key={item.key}
                    aria-hidden
                    style={calStyle(item)}
                    className={cn(
                      "flex h-6 min-w-0 items-center rounded-full px-2.5 text-[13px]",
                      itemTone(item),
                    )}
                  >
                    <ItemTitle item={item} showMarker={false} />
                  </div>
                ),
              )}
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
            {allDay.length + timed.length === 0 && !skeleton && (
              <p className="sr-only">Nothing scheduled</p>
            )}
            {timed.map(({ item, startMin, endMin, primary }) => {
              const pos = layout.get(item.key) ?? { col: 0, cols: 1 }
              const h = Math.max(((endMin - startMin) / 60) * hourPx - 4, 6)
              const changed = isChanged(item)
              const showText = h >= 18 && item.state !== "moving"
              // Two lines (title, then the time) need about 54px; shorter blocks show the title.
              const roomy = h >= 54 && pos.cols === 1
              const style: React.CSSProperties = {
                ...calStyle(item),
                top: y(startMin) + 2,
                height: h,
                left: `calc(${(pos.col / pos.cols) * 100}% + ${pos.col ? 2 : 0}px)`,
                width: `calc(${100 / pos.cols}% - ${pos.cols > 1 ? 2 : 0}px)`,
                zIndex: changed ? 2 : 1,
              }
              const content = showText && (
                <span
                  aria-hidden
                  className={cn(
                    "flex min-w-0 flex-col gap-0.5 text-[13px] leading-[18px]",
                    roomy ? "px-2 py-1.5" : h >= 30 ? "px-2 py-[7px]" : "px-2 py-px",
                    changed && "font-semibold",
                  )}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <ItemTitle
                      item={item}
                      showMarker={pos.cols === 1 && !(changed && !roomy)}
                      className="flex-1"
                    />
                    {changed && !roomy && (
                      <span className={cn(SCHEDULE_LABEL, "shrink-0 font-normal")}>
                        {timeShort(item.iv.start)}
                      </span>
                    )}
                  </span>
                  {roomy && (
                    <span className={cn(SCHEDULE_LABEL, "truncate font-normal")}>
                      {timeText(item.iv.start)}
                    </span>
                  )}
                </span>
              )
              return primary ? (
                <motion.button
                  key={item.key}
                  {...itemButtonProps(item)}
                  {...fadeIn}
                  style={style}
                  className={cn(
                    PRESSABLE,
                    "absolute overflow-hidden rounded-[8px]",
                    itemTone(item),
                    selected === item.key && SELECTED,
                  )}
                >
                  {content}
                </motion.button>
              ) : (
                <div
                  key={item.key}
                  aria-hidden
                  style={style}
                  className={cn("absolute overflow-hidden rounded-[8px]", itemTone(item))}
                >
                  {content}
                </div>
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

function MonthGrid({
  month,
  items,
  todayKey,
  selected,
  itemButtonProps,
  timeText,
  onOpenDay,
  skeleton,
}: {
  month: string
  items: Item[]
  todayKey: string | null
  selected: string | null
  itemButtonProps: ItemButtonProps
  timeText: (t: number) => string
  /** Pressing a date opens that day, when the Day view is available. */
  onOpenDay?: (day: string) => void
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
          const dateClass = cn(
            "inline-flex h-6 min-w-6 items-center justify-center self-start rounded-full px-1.5 text-[13px] tabular-nums",
            !inMonth && "text-muted-foreground/60",
            isToday && "bg-foreground font-medium text-background",
          )
          return (
            <div
              key={day}
              className={cn(
                "flex min-h-[6.75rem] min-w-0 flex-col gap-1 rounded-[10px] p-1.5",
                inMonth
                  ? "bg-foreground/[0.035] dark:bg-foreground/[0.07]"
                  : "bg-foreground/[0.015] dark:bg-foreground/[0.03]",
              )}
            >
              {inMonth && onOpenDay ? (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  aria-label={`Open ${formatDay(day, "long", locale)}${isToday ? ", today" : ""}`}
                  className={cn(
                    dateClass,
                    "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                    !isToday && "hover:bg-foreground/10",
                  )}
                >
                  {formatDay(day, "day", locale)}
                </button>
              ) : (
                <span aria-hidden={!inMonth || undefined} className={dateClass}>
                  {formatDay(day, "day", locale)}
                  {inMonth && (
                    <span className="sr-only">
                      , {formatDay(day, "long", locale)}
                      {isToday && ", today"}
                    </span>
                  )}
                </span>
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
                  <li key={item.key} className="min-w-0">
                    <motion.button
                      {...itemButtonProps(item)}
                      {...fadeIn}
                      style={calStyle(item)}
                      className={cn(
                        PRESSABLE,
                        "flex h-[22px] w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 text-[13px]",
                        itemTone(item),
                        isChanged(item) && "font-semibold",
                        selected === item.key && SELECTED,
                      )}
                    >
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          item.state === "cancelling" && "line-through",
                        )}
                      >
                        {item.title}
                      </span>
                      {!item.iv.allDay && item.iv.startKey === day && (
                        <span
                          aria-hidden
                          className={cn(SCHEDULE_LABEL, "shrink-0 font-normal")}
                        >
                          {timeText(item.iv.start)}
                        </span>
                      )}
                    </motion.button>
                  </li>
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
  selected,
  itemButtonProps,
  skeleton,
}: {
  day: string
  items: Item[]
  todos: CalendarTodo[]
  tz: string
  todayKey: string | null
  nowT: number | null
  selected: string | null
  itemButtonProps: ItemButtonProps
  skeleton: boolean
}) {
  const locale = useGenUILocale()
  const isToday = day === todayKey
  const dayItems = items.filter((i) => onDay(i, day))
  const eventCount = dayItems.filter((i) => i.state !== "proposed").length
  const counts = [
    `${eventCount} ${eventCount === 1 ? "event" : "events"}`,
    todos.length > 0 &&
      `${todos.length} ${todos.length === 1 ? "to-do" : "to-dos"}`,
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
          const aside = isNow
            ? "Now"
            : seg
              ? formatDuration(seg.endMin - seg.startMin, locale)
              : null
          const props = itemButtonProps(item)
          return (
            <motion.li key={item.key} {...fadeIn}>
              <button
                {...props}
                aria-label={`${props["aria-label"]}${isNow ? ", happening now" : ""}${past ? ", over" : ""}`}
                style={calStyle(item)}
                className={cn(
                  PRESSABLE,
                  row,
                  "w-full",
                  itemTone(item),
                  selected === item.key && SELECTED,
                )}
              >
                <span aria-hidden className={cn(SCHEDULE_LABEL, "truncate")}>
                  {when}
                </span>
                <ItemTitle
                  item={item}
                  className={cn(
                    genuiType.title,
                    titleCell,
                    "leading-snug",
                    isChanged(item) && "font-semibold",
                  )}
                />
                <span
                  aria-hidden
                  className={cn(
                    SCHEDULE_LABEL,
                    "col-start-2 row-start-1 shrink-0 @sm:col-start-3",
                    isNow && "font-semibold",
                  )}
                >
                  {aside}
                </span>
              </button>
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
            <span
              className={cn(titleCell, "flex items-center gap-2.5 @sm:col-span-2")}
            >
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
