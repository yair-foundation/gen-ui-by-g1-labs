"use client"

import * as React from "react"
import {
  CalendarClockIcon,
  CheckIcon,
  InfoIcon,
  MinusIcon,
  PillIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"

import type {
  Medication,
  MedicationDoseLog,
  MedicationReminderInput,
  MedicationReminderProgress,
  MedicationReminderResult,
  MedicationSchedule,
} from "./medication-reminder.schema"
import {
  addDays,
  courseDaysLeft,
  type DayState,
  type Dose,
  type DoseState,
  dayInZone,
  dayLabel,
  dayStates,
  diffDays,
  formatDay,
  formatTime,
  frequencyText,
  isScheduledOn,
  isSupplyLow,
  type LogEntry,
  refillDaysOfSupply,
  safeTimeZone,
  type WeekDay,
} from "./medication-reminder-utils"

export type MedicationReminderStatus = "streaming" | "ready"

type PartialMedication = Partial<Omit<Medication, "schedule">> & {
  schedule?: Partial<MedicationSchedule>
}

export type MedicationReminderProps = Partial<
  Omit<MedicationReminderInput, "medications">
> & {
  /** Medications may be partial while the tool call streams. */
  medications?: PartialMedication[]
  /**
   * The moment "today" is measured from. Defaults to the viewer's clock, read
   * after mount. A fixed `now` still advances while the card is open.
   */
  now?: Date | string | number
  /** Lifecycle, controlled by the host. The card never locks. */
  status?: MedicationReminderStatus
  /** Log changes (debounced 1 s), the reminders switch and refill requests. */
  onResult?: (result: MedicationReminderResult) => void
  /**
   * Called on every mark, skip and undo, so the host can save the dose log
   * (it isn't sent to the agent). Pass it back as `progress` to restore it.
   */
  onProgress?: (changes: MedicationReminderProgress) => void
  /** Saved dose changes (from `onProgress`). */
  progress?: MedicationReminderProgress
  /** The latest result from history. Restores its state; never calls onResult. */
  result?: MedicationReminderResult
  className?: string
}

/** How long a mark can be undone. */
const UNDO_MS = 5 * 60_000
const LOG_DEBOUNCE_MS = 1000

/**
 * Each day is a tall pill, like a calendar: weekday, date, then one mark per
 * dose. The day's tint says how it went; the marks say it without color.
 */
const DAY_STYLE: Record<DayState, string> = {
  "not-scheduled": "text-muted-foreground/70",
  upcoming: "bg-muted text-foreground dark:bg-white/[0.06]",
  taken:
    "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  partial:
    "bg-emerald-500/15 text-emerald-800 dark:bg-emerald-400/15 dark:text-emerald-200",
  skipped: "bg-muted text-muted-foreground dark:bg-white/[0.06]",
  missed: "bg-rose-500/12 text-rose-800 dark:bg-rose-400/15 dark:text-rose-200",
}

const TODAY_STYLE = "bg-foreground text-background"

/** One mark per dose: filled when taken, hollow when due, a dash when skipped. */
function DoseMark({ state, today }: { state: DoseState; today: boolean }) {
  if (state === "skipped")
    return <span className="h-0.5 w-2 rounded-full bg-current opacity-60" />
  if (state === "missed")
    return <XIcon className="size-2.5 text-rose-500" strokeWidth={4} />
  return (
    <span
      className={cn(
        "size-1.5 rounded-full",
        state === "taken"
          ? today
            ? "bg-emerald-400 dark:bg-emerald-600"
            : "bg-emerald-500 dark:bg-emerald-400"
          : "border border-current opacity-50",
      )}
    />
  )
}

type Change = MedicationDoseLog & { key: number }

/** A validated BCP 47 tag, or undefined (then the host's locale). */
function safeLocale(locale: string | undefined) {
  if (!locale) return undefined
  try {
    return Intl.getCanonicalLocales(locale)[0]
  } catch {
    return undefined
  }
}

function resolveNow(value: Date | string | number | undefined): number | null {
  if (value === undefined) return null
  const t =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value)
  return Number.isFinite(t) ? t : null
}

/**
 * The current time, refreshed every 15 s: the host's `now` advanced by the
 * time since mount, or the viewer's clock read after mount (so server and
 * client render the same markup). `read` gives the exact time for logging.
 */
function useClock(fixed: number | null) {
  const [clock, setClock] = React.useState<{
    start: number
    wall: number
  } | null>(null)
  React.useEffect(() => {
    const start = Date.now()
    setClock({ start, wall: start })
    const id = window.setInterval(
      () => setClock((c) => c && { ...c, wall: Date.now() }),
      15_000,
    )
    return () => window.clearInterval(id)
  }, [])
  const start = clock?.start
  const now =
    fixed !== null
      ? fixed + (clock ? clock.wall - clock.start : 0)
      : (clock?.wall ?? null)
  const read = React.useCallback(
    () =>
      fixed !== null
        ? fixed + (start !== undefined ? Date.now() - start : 0)
        : Date.now(),
    [fixed, start],
  )
  return [now, read] as const
}

function initialChanges(
  progress: MedicationReminderProgress | undefined,
  result: MedicationReminderResult | undefined,
): Change[] {
  const source =
    progress ?? (result?.action === "log" ? result.entries : undefined) ?? []
  return source.map((c, key) => ({
    medId: c.medId,
    scheduledFor: c.scheduledFor ?? c.at,
    status: c.status,
    at: c.at,
    key,
  }))
}

const sameEntry = (e: LogEntry | undefined, c: Change) =>
  e !== undefined &&
  e.at === c.at &&
  e.status === c.status &&
  e.scheduledFor === c.scheduledFor

function validLog(log: PartialMedication["log"]): LogEntry[] {
  return (log ?? []).filter(
    (e): e is LogEntry =>
      typeof e?.at === "string" &&
      (e.status === "taken" || e.status === "skipped"),
  )
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------------------
// Week strip

function WeekStrip({
  week,
  name,
  timeZone,
  locale,
}: {
  week: WeekDay[]
  name: string
  timeZone: string
  locale: string
}) {
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    timeZone: "UTC",
  })
  return (
    <ol aria-label={`This week, ${name}`} className="grid grid-cols-7 gap-1.5">
      {week.map((d) => (
        <motion.li
          key={d.day}
          aria-current={d.isToday ? "date" : undefined}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={genuiMotion.fade}
          className="flex justify-center"
        >
          <span className="sr-only">{dayLabel(d, { timeZone, locale })}</span>
          {/* Visual only: the sr-only label above says the same. */}
          <span
            aria-hidden
            className={cn(
              "flex w-full max-w-12 flex-col items-center gap-1 rounded-full pt-2.5 pb-2",
              d.isToday ? TODAY_STYLE : DAY_STYLE[d.state],
            )}
          >
            <span className="text-[11px] leading-none font-medium opacity-70">
              {weekday.format(new Date(`${d.day}T12:00:00Z`))}
            </span>
            <span className="text-[16px] leading-tight font-medium tabular-nums">
              {Number(d.day.slice(8))}
            </span>
            <span className="flex h-2.5 items-center gap-0.5">
              {d.scheduled &&
                d.doses.map((dose) => (
                  <DoseMark
                    key={dose.index}
                    state={dose.state}
                    today={d.isToday}
                  />
                ))}
            </span>
          </span>
        </motion.li>
      ))}
    </ol>
  )
}

function WeekStripSkeleton() {
  return (
    <div aria-hidden className="grid grid-cols-7 gap-1.5">
      {Array.from({ length: 7 }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
        <span key={i} className="flex justify-center">
          <Skeleton className="h-[66px] w-full max-w-12 rounded-full" />
        </span>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// One medication

type SectionProps = {
  med: PartialMedication & { id: string; name: string }
  changes: Change[]
  now: number | null
  timeZone: string
  locale: string
  weekStart: 0 | 1
  streaming: boolean
  refillRequested: boolean
  onLog: (
    dose: { scheduledFor: string; label: string },
    status: "taken" | "skipped",
  ) => void
  onUndo: (change: Change, label: string) => void
  onRefill: () => void
}

function MedicationSection({
  med,
  changes,
  now,
  timeZone,
  locale,
  weekStart,
  streaming,
  refillRequested,
  onLog,
  onUndo,
  onRefill,
}: SectionProps) {
  const titleId = React.useId()
  const schedule = med.schedule?.frequency
    ? (med.schedule as MedicationSchedule)
    : null
  // While streaming, a weekly count would jump as daysOfWeek arrives.
  const settling =
    streaming &&
    schedule?.frequency === "weekly" &&
    !schedule.daysOfWeek?.length
  const freq = schedule && !settling ? frequencyText(schedule) : null
  const number = new Intl.NumberFormat(locale)
  const live = !streaming && now !== null && schedule !== null

  const log: LogEntry[] = [
    ...validLog(med.log),
    ...changes.map((c) => ({
      at: c.at,
      status: c.status,
      scheduledFor: c.scheduledFor,
    })),
  ]
  const week =
    live && schedule
      ? dayStates(schedule, log, { now, timeZone, weekStart })
      : []
  const today = live ? dayInZone(now, timeZone) : null
  const todayRow = week.find((d) => d.isToday)

  const daysLeft = today ? courseDaysLeft(schedule?.endDate, today) : null
  const supply =
    schedule && med.refill
      ? refillDaysOfSupply(schedule, med.refill.remaining)
      : null
  const refillByDays =
    today && med.refill?.refillBy ? diffDays(med.refill.refillBy, today) : null
  const low = isSupplyLow(supply, daysLeft)
  const showRefill =
    live && med.refill && (low || (refillByDays !== null && refillByDays <= 7))

  const changeFor = (entry: LogEntry | undefined) =>
    changes.find((c) => sameEntry(entry, c))
  const undoable = (c: Change | undefined): c is Change =>
    c !== undefined && now !== null && now - Date.parse(c.at) < UNDO_MS
  const at = (iso: string) => {
    const t = Date.parse(iso)
    return Number.isFinite(t) ? formatTime(t, timeZone, locale) : ""
  }
  const doseLabel = (dose: Dose, count: number) =>
    dose.instant !== undefined
      ? formatTime(dose.instant, timeZone, locale)
      : count === 1
        ? "Today's dose"
        : `Dose ${dose.index + 1}`

  const nextDay = (() => {
    if (!schedule || !today || schedule.frequency === "as-needed") return null
    for (let i = 1; i <= 90; i++) {
      const d = addDays(today, i)
      if (isScheduledOn(schedule, d, today)) return d
    }
    return null
  })()

  const courseEnded = daysLeft !== null && daysLeft < 0

  return (
    <motion.li
      aria-labelledby={titleId}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="flex flex-col gap-3.5 px-3 py-3"
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400"
        >
          <PillIcon className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <SurfaceTitle id={titleId}>{med.name}</SurfaceTitle>
            {med.strength && (
              <span className="rounded-full border border-border bg-transparent px-2 py-0.5 text-[13px] leading-none font-medium text-foreground/80">
                {med.strength}
              </span>
            )}
          </div>
          {freq ? (
            <p className="text-[14px] text-muted-foreground">
              <span className="sr-only">{freq.text}</span>
              <span aria-hidden>
                {freq.prefix && `${freq.prefix} `}
                {freq.count !== null ? (
                  <>
                    <span className="font-medium text-foreground">
                      {number.format(freq.count)}
                    </span>{" "}
                    {freq.label}
                  </>
                ) : (
                  <span className="font-medium text-foreground">
                    {freq.label}
                  </span>
                )}
                {freq.detail && ` · ${freq.detail}`}
              </span>
            </p>
          ) : (
            <Skeleton className="h-4 w-32" />
          )}
        </div>
      </div>
      {med.instructions && <p className={genuiType.meta}>{med.instructions}</p>}

      {live ? (
        <WeekStrip
          week={week}
          name={med.name}
          timeZone={timeZone}
          locale={locale}
        />
      ) : (
        <WeekStripSkeleton />
      )}

      {live && schedule ? (
        <div className="flex flex-col gap-2.5">
          <h4 className={genuiType.label}>Today</h4>
          {schedule.frequency === "as-needed" ? (
            <ul className="-mx-3 flex flex-col divide-y divide-border border-t border-border">
              {(todayRow?.logged ?? []).map((entry) => {
                const change = changeFor(entry)
                return (
                  <DoseRow
                    key={`${entry.at}-${entry.status}`}
                    label={`Taken at ${at(entry.at)}`}
                    icon="taken"
                  >
                    {undoable(change) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Undo dose of ${med.name} taken at ${at(entry.at)}`}
                        onClick={() => onUndo(change, `${at(entry.at)} dose`)}
                      >
                        Undo
                      </Button>
                    )}
                  </DoseRow>
                )
              })}
              <li className="px-3 py-2.5">
                <Button
                  size="sm"
                  aria-label={`Log a dose of ${med.name}`}
                  onClick={() =>
                    onLog({ scheduledFor: "", label: "dose" }, "taken")
                  }
                >
                  Log a dose
                </Button>
              </li>
            </ul>
          ) : todayRow && todayRow.doses.length > 0 ? (
            <ul className="-mx-3 flex flex-col divide-y divide-border border-t border-border">
              {todayRow.doses.map((dose) => {
                const label = doseLabel(dose, todayRow.doses.length)
                const change = changeFor(dose.entry)
                const subject = `${label} dose of ${med.name}`
                if (dose.state === "taken" || dose.state === "skipped") {
                  return (
                    <DoseRow
                      key={dose.index}
                      label={label}
                      icon={dose.state}
                      status={
                        dose.state === "taken"
                          ? dose.entry
                            ? `Taken at ${at(dose.entry.at)}`
                            : "Taken"
                          : "Skipped"
                      }
                    >
                      {undoable(change) && (
                        <Button
                          size="sm"
                          variant="secondary"
                          aria-label={`Undo ${subject}`}
                          onClick={() => onUndo(change, `${label} dose`)}
                        >
                          Undo
                        </Button>
                      )}
                    </DoseRow>
                  )
                }
                return (
                  <DoseRow
                    key={dose.index}
                    label={label}
                    status={dose.state === "due" ? "Due" : undefined}
                  >
                    <Button
                      size="sm"
                      variant="secondary"
                      aria-label={`Skip ${subject}`}
                      onClick={() =>
                        onLog(
                          {
                            scheduledFor: dose.scheduledFor,
                            label: `${label} dose`,
                          },
                          "skipped",
                        )
                      }
                    >
                      Skip
                    </Button>
                    <Button
                      size="sm"
                      aria-label={`Mark ${subject} taken`}
                      onClick={() =>
                        onLog(
                          {
                            scheduledFor: dose.scheduledFor,
                            label: `${label} dose`,
                          },
                          "taken",
                        )
                      }
                    >
                      Mark taken
                    </Button>
                  </DoseRow>
                )
              })}
            </ul>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              {courseEnded
                ? "Course finished."
                : nextDay
                  ? `Nothing scheduled today. Next: ${formatDay(
                      nextDay,
                      locale,
                      diffDays(nextDay, today ?? nextDay) < 7
                        ? "weekday"
                        : "short",
                    )}.`
                  : "Nothing scheduled today."}
            </p>
          )}
        </div>
      ) : (
        <div aria-hidden className="flex flex-col gap-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-12 w-full rounded-[10px]" />
        </div>
      )}

      {live && (daysLeft !== null || med.refill) && (
        <div className="flex flex-col gap-1.5">
          {/* One quiet line: the course and the supply. */}
          <p className={cn(genuiType.meta, "flex items-center gap-1.5")}>
            <CalendarClockIcon aria-hidden className="size-4 shrink-0" />
            {[
              daysLeft !== null && schedule?.endDate
                ? daysLeft > 0
                  ? `Ends ${formatDay(schedule.endDate, locale)}, ${plural(daysLeft, "day", "days")} left`
                  : daysLeft === 0
                    ? "Course ends today"
                    : `Course ended ${formatDay(schedule.endDate, locale)}`
                : null,
              med.refill
                ? `${plural(
                    med.refill.remaining,
                    med.refill.unit === "pills" ? "pill" : "dose",
                    med.refill.unit === "pills" ? "pills" : "doses",
                  )} left`
                : null,
              med.refill?.refillBy
                ? `refill by ${formatDay(med.refill.refillBy, locale)}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {low && supply !== null && (
            <p className="flex items-center gap-1.5 text-[13px] font-medium">
              <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
              {supply === 0
                ? "Running low: less than a day's supply left"
                : `Running low: about ${plural(supply, "day", "days")} of supply left`}
            </p>
          )}
          {showRefill && (
            <div>
              {refillRequested ? (
                <p className="flex items-center gap-1.5 text-[13px] text-foreground">
                  <CheckIcon aria-hidden className="size-4" />
                  Refill requested
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  aria-label={`Request a refill of ${med.name}`}
                  onClick={onRefill}
                >
                  Request refill
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </motion.li>
  )
}

function DoseRow({
  label,
  status,
  icon,
  children,
}: {
  label: string
  status?: string
  icon?: "taken" | "skipped"
  children?: React.ReactNode
}) {
  const Icon =
    icon === "taken" ? CheckIcon : icon === "skipped" ? MinusIcon : null
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"
    >
      <span className="flex items-center gap-2.5 text-[15px]">
        {Icon && (
          <span
            aria-hidden
            className={cn(
              "grid size-5 shrink-0 place-items-center rounded-full",
              icon === "taken"
                ? "bg-emerald-500 text-white dark:bg-emerald-400 dark:text-black"
                : "bg-muted text-muted-foreground",
            )}
          >
            <Icon className="size-3" strokeWidth={3} />
          </span>
        )}
        <span
          className={cn(
            "font-medium tabular-nums",
            icon && "text-muted-foreground",
          )}
        >
          {label}
        </span>
        {status && (
          <span className="text-[14px] text-muted-foreground">
            {icon ? `· ${status}` : status}
          </span>
        )}
      </span>
      {children && (
        <span className="flex items-center gap-1.5">{children}</span>
      )}
    </motion.li>
  )
}

// ---------------------------------------------------------------------------
// Card

export function MedicationReminder({
  medications = [],
  timeZone: timeZoneProp,
  weekStart = 0,
  reminders = false,
  locale: localeProp,
  now: nowProp,
  status: statusProp,
  onResult,
  onProgress,
  progress,
  result,
  className,
}: MedicationReminderProps) {
  const status: MedicationReminderStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const hostLocale = useGenUILocale()
  const locale = safeLocale(localeProp) ?? hostLocale
  const timeZone = safeTimeZone(timeZoneProp)
  const [now, readNow] = useClock(resolveNow(nowProp))
  const switchId = React.useId()

  const [changes, setChanges] = React.useState<Change[]>(() =>
    initialChanges(progress, result),
  )
  const [remindersOn, setRemindersOn] = React.useState(
    result?.action === "reminders" ? result.enabled : false,
  )
  const [refills, setRefills] = React.useState<Set<string>>(
    () => new Set(result?.action === "refill" ? [result.medId] : []),
  )
  const [announcement, setAnnouncement] = React.useState("")

  // Log results are debounced, so read the latest values through refs.
  const changesRef = React.useRef(changes)
  const onResultRef = React.useRef(onResult)
  const timer = React.useRef<number | undefined>(undefined)
  const nextKey = React.useRef(changes.length)
  React.useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  const flush = React.useCallback(() => {
    window.clearTimeout(timer.current)
    timer.current = undefined
    onResultRef.current?.({
      action: "log",
      entries: changesRef.current.map(({ key: _, ...entry }) => entry),
    })
  }, [])
  // Send a pending log rather than drop it when the card unmounts.
  React.useEffect(
    () => () => {
      if (timer.current !== undefined) flush()
    },
    [flush],
  )

  const commit = (next: Change[], message: string) => {
    changesRef.current = next
    setChanges(next)
    setAnnouncement(message)
    onProgress?.(next.map(({ key: _, ...entry }) => entry))
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, LOG_DEBOUNCE_MS)
  }

  const ready = medications.filter(
    (m): m is PartialMedication & { id: string; name: string } =>
      typeof m.id === "string" && typeof m.name === "string",
  )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="medication-reminder"
        data-status={status}
        aria-busy={streaming}
        aria-label="Medication schedule"
        className={className}
      >
        <ul className="flex flex-col divide-y divide-border">
          {ready.map((med) => (
            <MedicationSection
              key={med.id}
              med={med}
              changes={changes.filter((c) => c.medId === med.id)}
              now={now}
              timeZone={timeZone}
              locale={locale}
              weekStart={weekStart}
              streaming={streaming}
              refillRequested={refills.has(med.id)}
              onLog={(dose, logStatus) => {
                const at = new Date(readNow()).toISOString()
                commit(
                  [
                    ...changesRef.current,
                    {
                      medId: med.id,
                      scheduledFor: dose.scheduledFor || at,
                      status: logStatus,
                      at,
                      key: nextKey.current++,
                    },
                  ],
                  `${med.name}, ${dose.label} ${logStatus === "taken" ? "marked taken" : "skipped"}.`,
                )
              }}
              onUndo={(change, label) =>
                commit(
                  changesRef.current.filter((c) => c.key !== change.key),
                  `${med.name}, ${label} undone.`,
                )
              }
              onRefill={() => {
                setRefills((prev) => new Set(prev).add(med.id))
                setAnnouncement(`Refill of ${med.name} requested.`)
                onResult?.({ action: "refill", medId: med.id })
              }}
            />
          ))}
          {streaming && ready.length === 0 && (
            <li aria-hidden className="flex flex-col gap-4 px-3 py-3">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-40" />
              <WeekStripSkeleton />
            </li>
          )}
        </ul>

        <SurfaceFooter className="flex-wrap items-center justify-between gap-x-3 gap-y-2">
          {streaming ? (
            <p className="text-[13px]">
              <ShimmeringText
                text="Loading schedule…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            </p>
          ) : (
            <>
              <p className={cn(genuiType.meta, "flex items-center gap-1.5")}>
                <InfoIcon aria-hidden className="size-4 shrink-0" />
                Follow your prescription.
              </p>
              {reminders && (
                <div className="flex items-center gap-2.5">
                  <span id={`${switchId}-label`} className="text-[14px]">
                    Reminders
                  </span>
                  <Switch
                    nativeButton
                    aria-labelledby={`${switchId}-label`}
                    checked={remindersOn}
                    onCheckedChange={(on: boolean) => {
                      const enabled = Boolean(on)
                      setRemindersOn(enabled)
                      setAnnouncement(
                        enabled ? "Reminders on." : "Reminders off.",
                      )
                      onResult?.({ action: "reminders", enabled })
                    }}
                    className="relative after:absolute after:-inset-1.5"
                  />
                </div>
              )}
            </>
          )}
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
