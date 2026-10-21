"use client"

import * as React from "react"
import { CheckIcon, XIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import {
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  surfaceInset,
  genuiMotion,
} from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"

import type {
  TimelineEvent,
  TimelineEventState,
  TimelineInput,
} from "./timeline.schema"

export type TimelineProps = Partial<Omit<TimelineInput, "events">> & {
  /** Events may be partial while the tool call streams. */
  events?: Partial<TimelineEvent>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type ReadyEvent = Partial<TimelineEvent> & { id: string; title: string }

const STATE_LABEL: Record<TimelineEventState, string> = {
  done: "Done",
  current: "In progress",
  upcoming: "Upcoming",
  failed: "Failed",
}

/** An ISO date or timestamp, parsed; date-only values are local dates. */
export function parseTime(
  value: string | undefined,
): { date: Date; hasTime: boolean } | null {
  if (!value) return null
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (dateOnly) {
    const [y, m, d] = dateOnly.slice(1).map(Number)
    const date = new Date(y, m - 1, d)
    // Rejects rollovers such as 2026-02-31.
    return date.getMonth() === m - 1 && date.getDate() === d
      ? { date, hasTime: false }
      : null
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : { date, hasTime: true }
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate()

/**
 * Formats an event time. A timestamp on the same day as the previous event
 * shows only the time, so a same-day incident doesn't repeat its date.
 */
export function formatTime(
  value: string | undefined,
  previous: string | undefined,
  showYear: boolean,
  locale: string,
): string {
  const parsed = parseTime(value)
  if (!parsed) return value ?? ""
  const prev = parseTime(previous)
  const date: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
  }
  if (!parsed.hasTime) {
    return new Intl.DateTimeFormat(locale, date).format(parsed.date)
  }
  const time: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  }
  const timeOnly = prev?.hasTime && sameDay(prev.date, parsed.date)
  return new Intl.DateTimeFormat(
    locale,
    timeOnly ? time : { ...date, ...time },
  ).format(parsed.date)
}

/** "2h ago" or "in 3h" for timestamps within a day of now; otherwise null. */
export function relativeHint(
  value: string | undefined,
  now: number,
  locale: string,
) {
  const parsed = parseTime(value)
  if (!parsed?.hasTime) return null
  const minutes = Math.round((parsed.date.getTime() - now) / 60_000)
  if (Math.abs(minutes) >= 24 * 60) return null
  const rtf = new Intl.RelativeTimeFormat(locale, {
    numeric: "auto",
    style: "narrow",
  })
  return Math.abs(minutes) < 60
    ? rtf.format(minutes, "minute")
    : rtf.format(Math.round(minutes / 60), "hour")
}

/** The clock, read only on the client so server and first render agree. */
function useNow() {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

function Node({ state }: { state?: TimelineEventState }) {
  const base = "relative z-10 flex size-4 shrink-0 items-center justify-center"
  switch (state) {
    case "done":
      return (
        <span
          className={cn(
            base,
            "rounded-full bg-emerald-500 text-background dark:bg-emerald-400",
          )}
        >
          <CheckIcon aria-hidden className="size-2.5" strokeWidth={3} />
        </span>
      )
    case "current":
      return (
        <span
          className={cn(
            base,
            "rounded-full border-2 border-foreground/70 bg-background",
          )}
        >
          <span className="size-1.5 rounded-full bg-sky-500 dark:bg-sky-400" />
        </span>
      )
    case "failed":
      return (
        <span className={cn(base, "rounded-full bg-destructive text-card")}>
          <XIcon aria-hidden className="size-2.5" strokeWidth={3} />
        </span>
      )
    case "upcoming":
      return (
        <span
          className={cn(
            base,
            "rounded-full border border-muted-foreground/50 bg-background",
          )}
        />
      )
    default:
      return (
        <span className={base}>
          <span className="size-2 rounded-full bg-muted-foreground" />
        </span>
      )
  }
}

export function Timeline({
  title,
  events = [],
  status: lifecycle = "ready",
  className,
}: TimelineProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const titleId = React.useId()
  const now = useNow()

  const ready = events.filter(
    (e): e is ReadyEvent =>
      typeof e.id === "string" && typeof e.title === "string",
  )

  // Show the year only when the dated events span more than one.
  const years = new Set(
    ready
      .map((e) => parseTime(e.time)?.date.getFullYear())
      .filter((y) => y !== undefined),
  )
  const showYear = years.size > 1

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="timeline"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Timeline"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
        </SurfaceHeader>

        <ol className={cn("flex flex-col border-t border-border py-3", surfaceInset)}>
          {ready.map((event, index) => {
            const next = ready[index + 1]
            const isLast = index === ready.length - 1 && !streaming
            const parsed = parseTime(event.time)
            const hint = now === null ? null : relativeHint(event.time, now, locale)
            const current = event.state === "current"
            return (
              <motion.li
                key={event.id}
                data-state={event.state}
                aria-current={current ? "step" : undefined}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className="flex gap-3"
              >
                <div
                  aria-hidden
                  className={cn(
                    "flex flex-col items-center",
                    current ? "pt-1" : "pt-0.5",
                  )}
                >
                  <Node state={event.state} />
                  {!isLast && (
                    <span
                      className={cn(
                        "mt-1 flex-1",
                        !next || next.state === "upcoming"
                          ? "border-l border-dashed border-muted-foreground/40"
                          : "w-px bg-foreground/40",
                      )}
                    />
                  )}
                </div>
                <div
                  className={cn(
                    "flex min-w-0 flex-1 flex-col gap-0.5",
                    !isLast && "pb-3",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span
                      className={cn(
                        // The current step is the answer, so it reads largest.
                        current ? genuiType.title : genuiType.body,
                        event.state === "upcoming" && "text-muted-foreground",
                        event.state === "failed" &&
                          "font-medium text-destructive",
                      )}
                    >
                      {event.title}
                      {event.state && (
                        <span className="sr-only">
                          {` (${STATE_LABEL[event.state]})`}
                        </span>
                      )}
                    </span>
                    {event.time === undefined ? (
                      <Skeleton className="h-3 w-16" />
                    ) : (
                      <span
                        className={cn(
                          "shrink-0 tabular-nums",
                          genuiType.meta,
                          current && "text-foreground",
                        )}
                      >
                        {parsed ? (
                          <time
                            dateTime={event.time}
                            // Formatted in the viewer's time zone.
                            suppressHydrationWarning
                          >
                            {formatTime(
                              event.time,
                              ready[index - 1]?.time,
                              showYear,
                              locale,
                            )}
                          </time>
                        ) : (
                          event.time
                        )}
                        {hint && <span> · {hint}</span>}
                      </span>
                    )}
                  </div>
                  {event.description && (
                    <p className={genuiType.meta}>{event.description}</p>
                  )}
                </div>
              </motion.li>
            )
          })}
          {streaming && (
            <li aria-hidden className="flex gap-3">
              <span className="flex size-4 shrink-0 items-center justify-center pt-0.5">
                <Skeleton className="size-3 rounded-full" />
              </span>
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-4 w-48 max-w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            </li>
          )}
        </ol>
      </Surface>
    </MotionConfig>
  )
}
