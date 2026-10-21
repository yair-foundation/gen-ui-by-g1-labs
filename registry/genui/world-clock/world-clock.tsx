"use client"

import * as React from "react"
import { CheckIcon, MoonIcon, SunIcon } from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  WorldClockEntry,
  WorldClockInput,
  WorldClockResult,
} from "./world-clock.schema"
import {
  type FormatOptions,
  MINUTE,
  covers,
  dayDifference,
  dayRelationLabel,
  analogGridClass,
  defaultClockStyle,
  FACE_COLORS,
  faceTone,
  formatDayKey,
  formatHour,
  formatLongDate,
  formatShortOffset,
  formatTime,
  formatWeekday,
  handAngles,
  hourStarts,
  isDaytime,
  isValidTimeZone,
  offsetBetween,
  parseClockTime,
  planDay,
  spokenOffset,
  timeParts,
  zonedParts,
} from "./world-clock-utils"
import { RollingDigits } from "@/components/genui/genui-motion"
import { useGenUILocale } from "@/components/genui/locale"

export type WorldClockStatus = "streaming" | "ready" | "picked"

type PartialPlanner = {
  workingHours?: { start?: string; end?: string }
  date?: string
}

export type WorldClockProps = Partial<
  Omit<WorldClockInput, "clocks" | "planner">
> & {
  /** Clocks may be partial while the tool call streams. */
  clocks?: Partial<WorldClockEntry>[]
  planner?: PartialPlanner
  /**
   * Locale for times and dates. Defaults to the GenUI locale ("en-US" unless
   * the host sets one) so server and client render the same text.
   */
  locale?: string
  /** Lifecycle, controlled by the host. */
  status?: WorldClockStatus
  /** Called when the user picks an overlap hour (only with `planner`). */
  onResult?: (result: WorldClockResult) => void
  /** A pick from history. Restores it read-only; never calls onResult. */
  result?: WorldClockResult
  className?: string
}

type ReadyClock = WorldClockEntry & { valid: boolean }

const CENTER = 100

/**
 * The current time, ticking only while live and the page is visible.
 * Null until mounted, so server and client render the same markup.
 * With `sweep`, second hands (`[data-hand=second]` inside `root`) are moved
 * every frame without re-rendering; otherwise the time updates each minute.
 */
function useLiveNow(
  live: boolean,
  sweep: boolean,
  root: React.RefObject<HTMLElement | null>,
) {
  const [now, setNow] = React.useState<number | null>(null)

  React.useEffect(() => {
    if (!live) return
    let raf = 0
    let timer: number | undefined
    let lastSecond = -1

    const frame = () => {
      const t = Date.now()
      const second = Math.floor(t / 1000)
      if (second !== lastSecond) {
        lastSecond = second
        setNow(t)
      }
      // Real zones differ by whole minutes, so seconds are the same everywhere.
      const angle = ((t / 1000) % 60) * 6
      for (const el of root.current?.querySelectorAll<SVGGElement>(
        "[data-hand=second]",
      ) ?? []) {
        el.setAttribute("transform", `rotate(${angle} ${CENTER} ${CENTER})`)
      }
      raf = requestAnimationFrame(frame)
    }
    const minuteTick = () => {
      const t = Date.now()
      setNow(t)
      timer = window.setTimeout(minuteTick, MINUTE - (t % MINUTE) + 20)
    }
    const stop = () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(timer)
    }
    const start = () => {
      stop()
      setNow(Date.now())
      if (document.hidden) return
      if (sweep) frame()
      else minuteTick()
    }

    start()
    document.addEventListener("visibilitychange", start)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", start)
    }
  }, [live, sweep, root])

  return now
}

function ClockFace({
  timeZone,
  code,
  t,
  ariaLabel,
  secondHand,
  numerals,
  fmt,
}: {
  timeZone: string
  code?: string
  t: number
  ariaLabel: string
  /** 'sweep': moved by the frame loop; 'static': drawn at `t`; 'none'. */
  secondHand: "sweep" | "static" | "none"
  numerals: "quarters" | "all"
  fmt: FormatOptions
}) {
  const parts = zonedParts(t, timeZone)
  const angles = handAngles(parts)
  const tone = faceTone(parts.hour)
  const c = FACE_COLORS[tone]
  const { time, period } = timeParts(t, timeZone, fmt)
  const rotate = (a: number) => `rotate(${a} ${CENTER} ${CENTER})`
  const all = numerals === "all"

  return (
    <svg
      viewBox="0 0 200 200"
      role="img"
      aria-label={ariaLabel}
      data-face={tone}
      className="aspect-square w-full max-w-40 font-figure lining-nums select-none"
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      <circle
        cx={CENTER}
        cy={CENTER}
        r={97}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={2}
      />
      {Array.from({ length: 12 }, (_, i) => {
        const hour = i + 1
        const rad = (hour * 30 * Math.PI) / 180
        if (all || hour % 3 === 0) {
          return (
            <text
              key={hour}
              x={CENTER + Math.sin(rad) * (all ? 78 : 76)}
              y={CENTER - Math.cos(rad) * (all ? 78 : 76)}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={all ? 22 : 23}
              fontWeight={400}
              fill={c.numeral}
            >
              {hour}
            </text>
          )
        }
        return (
          <circle
            key={hour}
            cx={CENTER + Math.sin(rad) * 80}
            cy={CENTER - Math.cos(rad) * 80}
            r={2.25}
            fill={c.minor}
          />
        )
      })}

      {code && (
        <text
          x={CENTER}
          y={all ? 60 : 128}
          textAnchor="middle"
          fontSize={12}
          fontWeight={500}
          fill={c.minor}
          className="font-sans"
        >
          {code}
        </text>
      )}
      <text
        x={CENTER}
        y={all ? 145 : code ? 146 : 140}
        textAnchor="middle"
        fontSize={all ? 19 : 20}
        fontWeight={400}
        fill={c.numeral}
      >
        {time}
        {period && (
          <tspan className="font-sans" fontSize={10} fontWeight={500} dx={3}>
            {period}
          </tspan>
        )}
      </text>

      <line
        x1={CENTER}
        y1={CENTER}
        x2={CENTER}
        y2={52}
        stroke={c.hand}
        strokeWidth={6}
        strokeLinecap="round"
        transform={rotate(angles.hour)}
      />
      <line
        x1={CENTER}
        y1={CENTER}
        x2={CENTER}
        y2={28}
        stroke={c.hand}
        strokeWidth={4}
        strokeLinecap="round"
        transform={rotate(angles.minute)}
      />
      {secondHand === "sweep" && (
        // Rotated by the frame loop, so React never fights it on re-render.
        <g data-hand="second">
          <line
            x1={CENTER}
            y1={118}
            x2={CENTER}
            y2={22}
            stroke={c.second}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
        </g>
      )}
      {secondHand === "static" && (
        <line
          x1={CENTER}
          y1={118}
          x2={CENTER}
          y2={22}
          stroke={c.second}
          strokeWidth={1.5}
          strokeLinecap="round"
          transform={rotate(angles.second)}
        />
      )}
      <circle
        cx={CENTER}
        cy={CENTER}
        r={5}
        fill={c.fill}
        stroke={secondHand === "none" ? c.hand : c.second}
        strokeWidth={2.5}
      />
    </svg>
  )
}

function DayNight({ hour }: { hour: number }) {
  const day = isDaytime(hour)
  const Icon = day ? SunIcon : MoonIcon
  return (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="sr-only">{day ? "Daytime" : "Night"}</span>
    </>
  )
}

export function WorldClock({
  clocks = [],
  style,
  numerals,
  referenceTime,
  hour12,
  planner,
  locale,
  status: statusProp,
  onResult,
  result,
  className,
}: WorldClockProps) {
  const hostLocale = useGenUILocale()
  const [picked, setPicked] = React.useState<number | null>(() => {
    const t = result ? Date.parse(result.at) : Number.NaN
    return Number.isNaN(t) ? null : t
  })
  const [decision, setDecision] = React.useState<"picked" | null>(
    result ? "picked" : null,
  )
  const rootRef = React.useRef<HTMLElement>(null)
  const reduceMotion = useReducedMotion()

  // A host-provided "ready" (or nothing) yields to the user's pick.
  const status: WorldClockStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const ready: ReadyClock[] = clocks
    .filter(
      (c): c is WorldClockEntry =>
        typeof c.id === "string" &&
        typeof c.label === "string" &&
        typeof c.timeZone === "string",
    )
    .map((c) => ({ ...c, valid: isValidTimeZone(c.timeZone) }))
  const valid = ready.filter((c) => c.valid)
  const refZone = valid[0]?.timeZone
  const analog = (style ?? defaultClockStyle(ready.length)) === "analog"

  const refParsed = referenceTime ? Date.parse(referenceTime) : Number.NaN
  const referenceT = Number.isNaN(refParsed) ? null : refParsed
  const live = referenceT === null
  const sweep = live && analog && !reduceMotion
  const now = useLiveNow(live, sweep, rootRef)
  const t = referenceT ?? now
  // Accessible names change at most once a minute.
  const labelT = t === null ? null : Math.floor(t / MINUTE) * MINUTE

  const fmt: FormatOptions = { locale: locale ?? hostLocale, hour12 }

  /* Planner ----------------------------------------------------------- */
  const startMin = parseClockTime(planner?.workingHours?.start)
  const endMin = parseClockTime(planner?.workingHours?.end)
  const plan =
    planner?.date && startMin !== null && endMin !== null && valid.length > 0
      ? planDay(
          planner.date,
          valid.map((c) => c.timeZone),
          startMin,
          endMin,
        )
      : null
  const starts = plan ? hourStarts(plan.overlap) : []
  const locked = status !== "ready"

  const zoneTimes = (at: number, sep = " · ") =>
    valid.map((c) => `${formatTime(at, c.timeZone, fmt)} ${c.label}`).join(sep)

  const overlapText = plan
    ? plan.overlap.length === 0
      ? "No overlap in working hours"
      : `${plan.overlap
          .map((o) =>
            valid
              .map(
                (c) =>
                  `${formatTime(o.start, c.timeZone, fmt)}–${formatTime(o.end, c.timeZone, fmt)} ${c.label}`,
              )
              .join(" · "),
          )
          .join("; ")}`
    : null

  const pick = (at: number) => {
    if (locked) return
    setPicked(at)
    setDecision("picked")
    onResult?.({ action: "pick-time", at: new Date(at).toISOString() })
  }

  /* Per-clock text ---------------------------------------------------- */
  // Digital rows: the reference shows its weekday, others "Tomorrow · +7 h".
  const relationText = (c: ReadyClock, at: number, index: number) => {
    if (!refZone) return ""
    if (index === 0 || c.timeZone === refZone) {
      return valid.length === 1
        ? formatLongDate(at, c.timeZone, fmt)
        : formatWeekday(at, c.timeZone, fmt)
    }
    const offset = offsetBetween(at, refZone, c.timeZone)
    return `${dayRelationLabel(dayDifference(at, c.timeZone, refZone))} · ${formatShortOffset(offset)}`
  }
  // Analog faces: "Today" / "Tomorrow" and "+16 h" on two lines, the
  // reference included ("Today", "+0 h"). One clock shows its date instead.
  const faceLines = (c: ReadyClock, at: number) => {
    if (!refZone) return { day: "", offset: null }
    if (valid.length === 1) {
      return { day: formatLongDate(at, c.timeZone, fmt), offset: null }
    }
    return {
      day: dayRelationLabel(dayDifference(at, c.timeZone, refZone)),
      offset: formatShortOffset(offsetBetween(at, refZone, c.timeZone)),
    }
  }
  const spokenRelation = (c: ReadyClock, at: number, index: number) => {
    if (!refZone || index === 0 || c.timeZone === refZone) return ""
    return `, ${spokenOffset(offsetBetween(at, refZone, c.timeZone))}`
  }

  const first = valid[0]
  const title =
    referenceT !== null && first
      ? `${formatTime(referenceT, first.timeZone, fmt)} in ${first.label} is…`
      : null

  const gridCols = analogGridClass(ready.length + (streaming ? 1 : 0))

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        ref={rootRef}
        data-slot="world-clock"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "World clock"}
        className={className}
      >
        {(title || plan) && (
          <SurfaceHeader className="pb-3">
            <SurfaceTitle>
              {title ??
                (plan && planner?.date
                  ? `Working hours on ${formatDayKey(planner.date, fmt)}`
                  : null)}
            </SurfaceTitle>
            {title && first && referenceT !== null && (
              <SurfaceDescription>
                {formatLongDate(referenceT, first.timeZone, fmt)}
              </SurfaceDescription>
            )}
          </SurfaceHeader>
        )}

        {analog ? (
          <div
            className={cn(
              "@container",
              (title || plan) && "border-t border-border",
            )}
          >
            <ul className={cn("grid gap-x-4 gap-y-5 px-3 py-3", gridCols)}>
              {ready.map((c, index) => (
                <motion.li
                  key={c.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex min-w-0 flex-col items-center gap-2 text-center"
                >
                  {!c.valid ? (
                    <div className="flex aspect-square w-full max-w-40 items-center justify-center rounded-full border border-border bg-transparent text-[13px] leading-4 text-muted-foreground">
                      Unknown time zone
                    </div>
                  ) : t === null || labelT === null ? (
                    <Skeleton className="aspect-square w-full max-w-40 rounded-full" />
                  ) : (
                    <ClockFace
                      timeZone={c.timeZone}
                      code={c.code}
                      t={t}
                      fmt={fmt}
                      secondHand={sweep ? "sweep" : live ? "none" : "static"}
                      numerals={numerals ?? "all"}
                      ariaLabel={`${c.label}, ${formatTime(labelT, c.timeZone, fmt)}, ${formatWeekday(labelT, c.timeZone, fmt)}${spokenRelation(c, labelT, index)}`}
                    />
                  )}
                  <div className="flex min-w-0 max-w-full flex-col items-center gap-0.5">
                    <span className="max-w-full truncate text-[13px] leading-5 font-semibold">
                      {c.label}
                    </span>
                    {c.valid && t !== null ? (
                      (() => {
                        const lines = faceLines(c, t)
                        return (
                          <span className={cn(genuiType.meta, "tabular-nums")}>
                            {lines.day}
                            {/* The reference's own offset (+0 h) is implied. */}
                            {lines.offset && index > 0 && ` · ${lines.offset}`}
                            {/* The face color shows day or night; say it too. */}
                            <span className="sr-only">
                              ,{" "}
                              {isDaytime(zonedParts(t, c.timeZone).hour)
                                ? "daytime"
                                : "night"}
                              {index === 0 && lines.offset && ", reference"}
                            </span>
                          </span>
                        )
                      })()
                    ) : c.valid ? (
                      <Skeleton className="h-3.5 w-24" />
                    ) : (
                      <span className={genuiType.meta}>{c.timeZone}</span>
                    )}
                  </div>
                </motion.li>
              ))}
              {streaming && (
                <li aria-hidden className="flex flex-col items-center gap-2">
                  <Skeleton className="aspect-square w-full max-w-40 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                </li>
              )}
            </ul>
          </div>
        ) : (
          <ul
            className={cn(
              "flex flex-wrap py-2",
              (title || plan) && "border-t border-border",
            )}
          >
            {ready.map((c, index) => (
              <motion.li
                key={c.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className="flex flex-[1_1_min(100%,18rem)] items-center gap-3 px-3 py-2.5"
              >
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[13px] leading-5 font-semibold">
                    {c.label}
                  </span>
                  {c.valid && t !== null ? (
                    <span
                      className={cn("flex items-center gap-1", genuiType.meta)}
                    >
                      <DayNight hour={zonedParts(t, c.timeZone).hour} />
                      {relationText(c, t, index)}
                    </span>
                  ) : c.valid ? (
                    <Skeleton className="h-3.5 w-24" />
                  ) : (
                    <span className={genuiType.meta}>
                      Unknown time zone: {c.timeZone}
                    </span>
                  )}
                </div>
                {c.valid &&
                  (t === null ? (
                    <Skeleton className="h-7 w-20" />
                  ) : (
                    <span className={cn("shrink-0", genuiType.display)}>
                      {(() => {
                        const p = timeParts(t, c.timeZone, fmt)
                        return (
                          <>
                            <span className="sr-only">{p.time}</span>
                            <span aria-hidden>
                              <RollingDigits text={p.time} />
                            </span>
                            {p.period && (
                              <span className="ml-1 text-[13px] leading-5 font-medium text-muted-foreground">
                                {p.period}
                              </span>
                            )}
                          </>
                        )
                      })()}
                    </span>
                  ))}
              </motion.li>
            ))}
            {streaming && (
              <li
                aria-hidden
                className="flex flex-[1_1_min(100%,18rem)] items-center gap-3 px-3 py-2.5"
              >
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-7 w-20" />
              </li>
            )}
          </ul>
        )}

        {plan && startMin !== null && endMin !== null && (
          <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
            <div className="flex flex-col gap-1">
              <span className={genuiType.label}>
                {plan.overlap.length > 0 ? "Overlap" : null}
                <span className="sr-only">
                  {plan.overlap.length > 0 ? ". " : ""}
                  Working hours {planner?.workingHours?.start}–
                  {planner?.workingHours?.end}, local time in each place.
                </span>
              </span>
              <p className="font-figure text-[22px] leading-[1.25] font-normal tracking-tight tabular-nums lining-nums">
                {overlapText}
              </p>
            </div>

            {/* The strip is a picture of the text below, so it's hidden from assistive tech. */}
            <div aria-hidden className="flex flex-col gap-2">
              {valid.map((c, z) => (
                <div
                  key={c.id}
                  className="grid grid-cols-[minmax(0,5.5rem)_minmax(0,1fr)] items-start gap-3"
                >
                  <span className="truncate pt-0.5 text-[13px] leading-4">
                    {c.code ?? c.label}
                  </span>
                  <div className="flex flex-col gap-1">
                    <div
                      className="grid h-5 gap-px"
                      style={{
                        gridTemplateColumns: `repeat(${plan.hours}, minmax(0, 1fr))`,
                      }}
                    >
                      {Array.from({ length: plan.hours }, (_, i) => {
                        const mid =
                          plan.window.start + i * 3_600_000 + 1_800_000
                        const working = covers(plan.perZone[z], mid)
                        const shared = covers(plan.overlap, mid)
                        return (
                          <span
                            // biome-ignore lint/suspicious/noArrayIndexKey: hour columns are positional
                            key={i}
                            className={cn(
                              "first:rounded-l-sm last:rounded-r-sm",
                              shared
                                ? "bg-muted-foreground/60"
                                : working
                                  ? "bg-muted-foreground/20"
                                  : "bg-muted dark:bg-white/10",
                            )}
                          />
                        )
                      })}
                    </div>
                    <div className="relative h-5 font-figure text-[16px] leading-none font-normal text-muted-foreground tabular-nums lining-nums">
                      {[0, 6, 12, 18]
                        .filter((i) => i < plan.hours)
                        .map((i) => (
                          <span
                            key={i}
                            className="absolute top-0"
                            style={{ left: `${(i / plan.hours) * 100}%` }}
                          >
                            {formatHour(
                              plan.window.start + i * 3_600_000,
                              c.timeZone,
                              fmt,
                            )}
                          </span>
                        ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {starts.length > 0 && (
              <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
                <legend className={cn("mb-2", genuiType.label)}>
                  Start time ({first?.label})
                </legend>
                <div className="flex flex-wrap gap-2">
                  {starts.map((at) => {
                    const pressed = picked === at
                    return (
                      <Button
                        key={at}
                        size="sm"
                        variant="secondary"
                        aria-pressed={pressed}
                        aria-label={zoneTimes(at, ", ")}
                        disabled={locked}
                        onClick={() => pick(at)}
                        className={cn(
                          "flex-1 font-figure text-[16px] font-normal tabular-nums lining-nums",
                          pressed && "ring-2 ring-choice ring-inset",
                        )}
                      >
                        {first && formatTime(at, first.timeZone, fmt)}
                      </Button>
                    )
                  })}
                </div>
              </fieldset>
            )}
          </div>
        )}

        {plan && (status === "picked" || streaming) && (
          <SurfaceFooter>
            {status === "picked" && picked !== null ? (
              <p className="flex items-center gap-1.5 text-[13px] leading-5">
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                Picked {zoneTimes(picked)}
              </p>
            ) : (
              <p className="text-[13px] leading-4 text-muted-foreground">
                <ShimmeringText
                  text="Finding the overlap…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </p>
            )}
          </SurfaceFooter>
        )}
        {plan && (
          <p aria-live="polite" className="sr-only">
            {status === "picked" && picked !== null
              ? `Picked ${zoneTimes(picked)}`
              : ""}
          </p>
        )}
      </Surface>
    </MotionConfig>
  )
}
