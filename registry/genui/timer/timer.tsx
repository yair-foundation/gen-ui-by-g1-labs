"use client"

import * as React from "react"
import {
  CheckIcon,
  FlagIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  SkipForwardIcon,
  SquareIcon,
  TimerIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
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
  adjust,
  canAdjust,
  complete,
  formatClock,
  formatLap,
  formatShort,
  formatSpoken,
  initialTimerState,
  lap,
  lapStats,
  lapsFromDurations,
  pause,
  reset,
  skip,
  snapshot,
  start,
  type TimerPlan,
  type TimerState,
  toSeconds,
} from "./timer-engine"
import type { TimerInput, TimerResult, TimerStepInput } from "./timer.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import { RollingDigits } from "@/components/genui/genui-motion"

export type TimerStatus = "streaming" | "ready" | "completed" | "cancelled"

export type TimerProps = Partial<Omit<TimerInput, "steps">> & {
  /** Steps may be partial while the tool call streams. */
  steps?: Partial<TimerStepInput>[]
  /** Lifecycle, controlled by the host. */
  status?: TimerStatus
  /** Called once: when the run finishes, the stopwatch is finished, or the user cancels. */
  onResult?: (result: TimerResult) => void
  /**
   * Called on every start, pause, lap and adjustment, so the host can save the
   * timer (it isn't sent to the agent). Pass it back as `progress` and the
   * timer picks up where the wall clock says it is, even after a reload.
   */
  onProgress?: (state: TimerState) => void
  /** Saved timer state (from `onProgress`). */
  progress?: TimerState
  /** A result from history. Shows the finished timer, read-only; never calls onResult. */
  result?: TimerResult
  className?: string
}

/** Rebuilds a timer state from a stored result. */
function stateFromResult(result: TimerResult): TimerState {
  if (result.action === "cancelled") {
    return {
      ...initialTimerState,
      elapsedBeforePause: result.elapsedSeconds * 1000,
    }
  }
  return {
    ...initialTimerState,
    elapsedBeforePause: result.totalSeconds * 1000,
    laps: result.laps ? lapsFromDurations(result.laps) : undefined,
  }
}

/** A short beep series. Only plays on a context unlocked by a user gesture. */
function playBeep(ctx: AudioContext) {
  const t0 = ctx.currentTime
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const at = t0 + i * 0.3
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.18)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + 0.2)
  }
}

const formatEndsAt = (time: number, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(time)

/**
 * Colour by phase: steps alternate effort (orange) and recovery (blue), a
 * single countdown is blue, and a finished run is green.
 */
const TONES = {
  effort: {
    stroke: "text-orange-500 dark:text-orange-400",
    badge:
      "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  },
  recovery: {
    stroke: "text-sky-500 dark:text-sky-400",
    badge: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  },
  done: {
    stroke: "text-emerald-500 dark:text-emerald-400",
    badge:
      "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  },
} as const
const toneOf = (stepIndex: number, intervals: boolean, finished: boolean) =>
  finished
    ? TONES.done
    : intervals && stepIndex % 2 === 0
      ? TONES.effort
      : TONES.recovery

/** Decorative ring; the time next to it is the accessible value. The track always shows, tinted by the phase. */
function ProgressRing({
  value,
  tone,
}: {
  value: number
  tone: (typeof TONES)[keyof typeof TONES]
}) {
  const r = 30
  const c = 2 * Math.PI * r
  return (
    <svg
      aria-hidden
      viewBox="0 0 72 72"
      className={cn("size-20 shrink-0 -rotate-90", tone.stroke)}
    >
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        strokeWidth="6"
        stroke="currentColor"
        className="opacity-20"
      />
      <circle
        cx="36"
        cy="36"
        r={r}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        stroke="currentColor"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))}
        className={cn(
          "transition-[stroke-dashoffset] duration-300 ease-linear motion-reduce:transition-none",
          value <= 0 && "opacity-0",
        )}
      />
    </svg>
  )
}

export function Timer({
  title,
  mode,
  steps = [],
  repeat = 1,
  autoStart = false,
  allowAdjust,
  status: statusProp,
  onResult,
  onProgress,
  progress,
  result,
  className,
}: TimerProps) {
  const locale = useGenUILocale()
  const [state, setState] = React.useState<TimerState>(() =>
    result ? stateFromResult(result) : (progress ?? initialTimerState),
  )
  const [decision, setDecision] = React.useState<
    "completed" | "cancelled" | null
  >(result?.action ?? null)
  // Restored timers are read-only from the start.
  const [dismissed, setDismissed] = React.useState(result !== undefined)
  const [sent, setSent] = React.useState(result !== undefined)
  const [doneMessage, setDoneMessage] = React.useState("")
  const [stepMessage, setStepMessage] = React.useState("")
  // Null until mounted, so server and client render the same markup.
  const [now, setNow] = React.useState<number | null>(null)
  const sentRef = React.useRef(result !== undefined)
  const gestureRef = React.useRef(false)
  const audioRef = React.useRef<AudioContext | null>(null)
  const displayRef = React.useRef<HTMLDivElement>(null)

  const status: TimerStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const validSteps = steps.filter(
    (s): s is TimerStepInput =>
      typeof s.label === "string" &&
      s.label !== "" &&
      typeof s.seconds === "number" &&
      s.seconds > 0,
  )
  const kind = mode ?? "countdown"
  const plan: TimerPlan = { mode: kind, steps: validSteps, repeat }
  const hasPlan =
    mode !== undefined && (mode === "stopwatch" || validSteps.length > 0)
  const isStopwatch = kind === "stopwatch"
  const canAdjustAtAll = allowAdjust ?? kind === "countdown"

  const clock = now ?? state.startedAt ?? 0
  const snap = snapshot(plan, state, clock)
  const done = hasPlan && snap.done
  const started = state.running || snap.elapsedMs > 0

  const displayTitle = title ?? (isStopwatch ? "Stopwatch" : "Timer")
  const name = /(timer|stopwatch)$/i.test(displayTitle)
    ? displayTitle
    : `${displayTitle} ${isStopwatch ? "stopwatch" : "timer"}`

  // Latest values for effects and timeouts, without re-subscribing every tick.
  const latest = React.useRef({
    plan,
    state,
    snap,
    onProgress,
    onResult,
    displayTitle,
  })
  React.useLayoutEffect(() => {
    latest.current = { plan, state, snap, onProgress, onResult, displayTitle }
  })

  /** Applies an action at the current time and saves the result. */
  const commit = React.useCallback(
    (update: (s: TimerState, t: number) => TimerState) => {
      const t = Date.now()
      setNow(t)
      const prev = latest.current.state
      const next = update(prev, t)
      if (next === prev) return next
      latest.current.state = next
      setState(next)
      latest.current.onProgress?.(next)
      return next
    },
    [],
  )

  const send = React.useCallback((r: TimerResult) => {
    if (sentRef.current) return
    sentRef.current = true
    setSent(true)
    latest.current.onResult?.(r)
  }, [])

  /** Audio may only start from a user gesture, so unlock it on Start. */
  const unlockAudio = () => {
    gestureRef.current = true
    if (!audioRef.current && typeof AudioContext !== "undefined") {
      audioRef.current = new AudioContext()
    }
    void audioRef.current?.resume()
  }

  React.useEffect(() => {
    setNow(Date.now())
    return () => {
      void audioRef.current?.close()
    }
  }, [])

  // autoStart: once the plan has fully arrived, never on a restored timer.
  const autoStartable =
    autoStart && status === "ready" && hasPlan && !progress && !result
  const autoStartedRef = React.useRef(false)
  React.useEffect(() => {
    if (!autoStartable || autoStartedRef.current) return
    autoStartedRef.current = true
    commit(start)
  }, [autoStartable, commit])

  const running = state.running && !done && status === "ready"

  // Display loop: a 250 ms tick for the readout only, paused while hidden.
  React.useEffect(() => {
    if (!running) return
    let id: number | undefined
    const tick = () => setNow(Date.now())
    const loop = () => {
      if (id === undefined && !document.hidden) {
        id = window.setInterval(tick, 250)
      }
    }
    const stop = () => {
      if (id !== undefined) window.clearInterval(id)
      id = undefined
    }
    const onVisibility = () => {
      if (document.hidden) return stop()
      tick()
      loop()
    }
    tick()
    loop()
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      stop()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [running])

  // One timeout at the next step boundary, so the end is caught (and the
  // beep plays) even while the tab is hidden and the display loop is paused.
  const boundaryAt =
    running && snap.current && state.startedAt !== undefined
      ? state.startedAt + snap.current.endMs - state.elapsedBeforePause
      : null
  React.useEffect(() => {
    if (boundaryAt === null) return
    const id = window.setTimeout(
      () => setNow(Date.now()),
      Math.max(0, boundaryAt - Date.now()) + 20,
    )
    return () => window.clearTimeout(id)
  }, [boundaryAt])

  // The run reached zero: stop the clock, announce once, report once.
  const reachedZero = state.running && done && status !== "streaming"
  React.useEffect(() => {
    if (!reachedZero) return
    const { plan: p, displayTitle: label } = latest.current
    const next = commit((prev, t) => complete(p, prev, t))
    setDecision("completed")
    setDismissed(false)
    setDoneMessage(`${label} is done`)
    if (gestureRef.current && audioRef.current) playBeep(audioRef.current)
    const total = snapshot(p, next, Date.now()).totalMs ?? 0
    send({ action: "completed", totalSeconds: toSeconds(total) })
  }, [reachedZero, commit, send])

  // Intervals: announce each new step while running.
  const liveStep = running && kind === "intervals" ? snap.current?.index : null
  const prevStepRef = React.useRef<number | null>(null)
  React.useEffect(() => {
    if (liveStep === null || liveStep === undefined) return
    if (prevStepRef.current !== null && prevStepRef.current !== liveStep) {
      const current = latest.current.snap.current
      if (current) {
        setStepMessage(
          `${current.label}, ${formatSpoken((current.endMs - current.startMs) / 1000)}`,
        )
      }
    }
    prevStepRef.current = liveStep
  }, [liveStep])

  const locked = status !== "ready" || !hasPlan
  const canToggle = !locked && !done

  const toggle = () => {
    if (!canToggle) return
    if (state.running) {
      commit(pause)
    } else {
      unlockAudio()
      commit(start)
    }
  }

  const restart = () => {
    unlockAudio()
    setDecision(null)
    setDoneMessage("")
    prevStepRef.current = null
    commit((_, t) => start(reset(), t))
  }

  const dismiss = () => {
    setDismissed(true)
    // The controls go away; keep focus inside the timer.
    displayRef.current?.focus()
  }

  const finish = () => {
    const next = commit((s, t) => complete(plan, s, t))
    setDecision("completed")
    const stats = lapStats(next.laps)
    send({
      action: "completed",
      totalSeconds: toSeconds(next.elapsedBeforePause),
      ...(stats.durations.length
        ? { laps: stats.durations.map(toSeconds) }
        : {}),
    })
  }

  const cancel = () => {
    const next = commit(pause)
    setDecision("cancelled")
    send({
      action: "cancelled",
      elapsedSeconds: toSeconds(snapshot(plan, next, Date.now()).elapsedMs),
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== " " || e.repeat) return
    // Buttons and other controls keep their own Space behaviour.
    const target = e.target as HTMLElement
    if (
      target.closest(
        "button, a, input, select, textarea, [role=slider], [role=combobox]",
      )
    ) {
      return
    }
    if (!canToggle) return
    e.preventDefault()
    toggle()
  }

  // Readout ------------------------------------------------------------------
  const stats = lapStats(state.laps)
  const lastLap = state.laps?.length ? state.laps[state.laps.length - 1] : 0
  const showDone = done && !isStopwatch
  const readoutMs = isStopwatch
    ? snap.elapsedMs
    : kind === "intervals"
      ? (snap.stepRemainingMs ?? 0)
      : (snap.remainingMs ?? 0)
  const readout = showDone
    ? "Done"
    : formatClock(readoutMs, isStopwatch ? "down" : "up")
  const readoutSeconds = isStopwatch
    ? Math.floor(readoutMs / 1000)
    : Math.ceil(readoutMs / 1000 - 1e-6)
  const spoken = showDone
    ? "Done"
    : isStopwatch
      ? `${formatSpoken(readoutSeconds)} elapsed`
      : `${kind === "intervals" && snap.current ? `${snap.current.label}: ` : ""}${formatSpoken(readoutSeconds)} remaining`

  const rounds = Math.max(1, Math.floor(repeat))
  const adjustedHere =
    snap.current &&
    state.adjustSeconds !== 0 &&
    (kind === "countdown" || state.stepIndex === snap.current.index)
  const adjustText = adjustedHere
    ? `${state.adjustSeconds > 0 ? "+" : "−"}${formatShort(Math.abs(state.adjustSeconds))}`
    : null

  const endsAt =
    running && now !== null && snap.remainingMs !== null
      ? now + snap.remainingMs
      : null
  // Rounded to the minute so it doesn't change (and re-announce) every tick.
  const endsAtMinute =
    endsAt === null ? null : Math.round(endsAt / 60000) * 60000

  // Countdown and intervals keep Restart / Dismiss after zero until dismissed.
  const showControls =
    streaming ||
    ((status === "ready" ||
      (status === "completed" && decision === "completed" && !isStopwatch)) &&
      !(showDone && dismissed))

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="timer"
        data-status={status}
        data-mode={mode}
        aria-busy={streaming}
        aria-label={name}
        onKeyDown={onKeyDown}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
          >
            <TimerIcon className="size-5" />
          </span>
          <SurfaceTitle className="min-w-0">
            {title ?? (streaming ? undefined : displayTitle)}
          </SurfaceTitle>
        </SurfaceHeader>

        <div className="flex items-center gap-4 border-t border-border px-3 py-3">
          {!isStopwatch && hasPlan && (
            <ProgressRing
              value={done ? 1 : snap.stepProgress}
              tone={toneOf(
                snap.current?.stepIndex ?? 0,
                kind === "intervals",
                done,
              )}
            />
          )}
          {!hasPlan && <Skeleton className="size-20 rounded-full" />}
          <div className="flex min-w-0 flex-col gap-1">
            {hasPlan ? (
              <span
                className={cn(
                  "text-[13px] leading-5 font-medium empty:hidden",
                  // The phase you are in: a tinted badge, the cue you act on.
                  !isStopwatch &&
                    !showDone &&
                    kind !== "countdown" &&
                    snap.current?.label &&
                    cn(
                      "w-fit rounded-full px-2.5 py-0.5",
                      toneOf(
                        snap.current.stepIndex,
                        kind === "intervals",
                        false,
                      ).badge,
                    ),
                )}
              >
                {isStopwatch
                  ? state.laps?.length
                    ? `Lap ${state.laps.length + 1}`
                    : null
                  : showDone || kind === "countdown"
                    ? null
                    : snap.current?.label}
                {isStopwatch && state.laps?.length ? (
                  <span className="ml-1.5 font-normal text-muted-foreground tabular-nums">
                    {formatLap(snap.elapsedMs - lastLap)}
                  </span>
                ) : null}
              </span>
            ) : (
              <Skeleton className="h-4 w-20" />
            )}
            {hasPlan ? (
              <div
                ref={displayRef}
                role="timer"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so Space can start and pause from the readout, and focus has a home after Dismiss
                tabIndex={0}
                className="w-fit rounded-lg font-figure lining-nums text-[44px] leading-none font-normal tracking-tighter tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="sr-only">{spoken}</span>
                <span aria-hidden>
                  {showDone ? readout : <RollingDigits text={readout} />}
                </span>
              </div>
            ) : (
              <Skeleton className="h-10 w-40" />
            )}
            {hasPlan && !isStopwatch && (
              <span className={cn(genuiType.meta, "tabular-nums empty:hidden")}>
                {showDone
                  ? `Timed ${formatShort((snap.totalMs ?? 0) / 1000)}`
                  : [
                      kind === "intervals" && rounds > 1 && snap.current
                        ? `Round ${snap.current.round + 1} of ${rounds}`
                        : null,
                      kind === "countdown"
                        ? `of ${formatShort((snap.totalMs ?? 0) / 1000)}`
                        : null,
                      adjustText ? `${adjustText} adjusted` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </span>
            )}
          </div>
        </div>

        {showControls && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-3">
            <Button
              size="sm"
              onClick={showDone ? restart : toggle}
              disabled={showDone ? false : !canToggle}
              aria-label={`${
                showDone
                  ? "Restart"
                  : state.running
                    ? "Pause"
                    : started
                      ? "Resume"
                      : "Start"
              } ${name}`}
            >
              {showDone ? (
                <RotateCcwIcon aria-hidden />
              ) : state.running ? (
                <PauseIcon aria-hidden />
              ) : (
                <PlayIcon aria-hidden />
              )}
              {showDone
                ? "Restart"
                : state.running
                  ? "Pause"
                  : started
                    ? "Resume"
                    : "Start"}
            </Button>

            {showDone ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={dismiss}
                aria-label={`Dismiss ${name}`}
              >
                Dismiss
              </Button>
            ) : (
              <>
                {canAdjustAtAll && !isStopwatch && (
                  <>
                    <WhyDisabled
                      reason={
                        !locked &&
                        !canAdjust(plan, state, -60, clock) &&
                        "Can't go lower"
                      }
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked || !canAdjust(plan, state, -60, clock)}
                        onClick={() =>
                          commit((s, t) => adjust(plan, s, -60, t))
                        }
                        aria-label={`−1 min on ${name}`}
                      >
                        <MinusIcon aria-hidden />1 min
                      </Button>
                    </WhyDisabled>
                    <WhyDisabled
                      reason={
                        !locked &&
                        !canAdjust(plan, state, 60, clock) &&
                        "Can't add more"
                      }
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked || !canAdjust(plan, state, 60, clock)}
                        onClick={() => commit((s, t) => adjust(plan, s, 60, t))}
                        aria-label={`+1 min on ${name}`}
                      >
                        <PlusIcon aria-hidden />1 min
                      </Button>
                    </WhyDisabled>
                  </>
                )}
                {kind === "intervals" && (
                  <IconTip label="Skip step">
                    <Button
                      size="icon-sm"
                      variant="secondary"
                      disabled={locked}
                      onClick={() => commit((s, t) => skip(plan, s, t))}
                      aria-label={`Skip step in ${name}`}
                    >
                      <SkipForwardIcon aria-hidden />
                    </Button>
                  </IconTip>
                )}
                {isStopwatch && (
                  <>
                    <WhyDisabled
                      reason={
                        !locked && !state.running && "Start the timer first"
                      }
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked || !state.running}
                        onClick={() => commit(lap)}
                        aria-label={`Lap on ${name}`}
                      >
                        <FlagIcon aria-hidden />
                        Lap
                      </Button>
                    </WhyDisabled>
                    <WhyDisabled
                      reason={!locked && !started && "Start the timer first"}
                    >
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={locked || !started}
                        onClick={finish}
                        aria-label={`Finish ${name}`}
                      >
                        <SquareIcon aria-hidden />
                        Finish
                      </Button>
                    </WhyDisabled>
                  </>
                )}
                <WhyDisabled
                  reason={
                    !locked &&
                    !started &&
                    state.adjustSeconds === 0 &&
                    "Nothing to reset"
                  }
                >
                  <IconTip label="Reset">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      disabled={
                        locked || (!started && state.adjustSeconds === 0)
                      }
                      onClick={() => commit(() => reset())}
                      aria-label={`Reset ${name}`}
                    >
                      <RotateCcwIcon aria-hidden />
                    </Button>
                  </IconTip>
                </WhyDisabled>
              </>
            )}
            {status === "ready" && !done && !sent && (
              <Button
                size="sm"
                variant="secondary"
                className="ml-auto"
                disabled={locked}
                onClick={cancel}
                aria-label={`Cancel ${name}`}
              >
                Cancel
              </Button>
            )}
          </div>
        )}

        {/* Intervals: where you are in the sequence. */}
        {kind === "intervals" && (validSteps.length > 0 || streaming) && (
          <AutoHeight>
            <ol
              aria-label={`Steps${rounds > 1 ? `, round ${(snap.current?.round ?? 0) + 1} of ${rounds}` : ""}`}
              className="flex flex-col divide-y divide-border border-t border-border"
            >
              {validSteps.map((step, i) => {
                const position = snap.current?.stepIndex ?? 0
                const state_ =
                  done || i < position
                    ? "done"
                    : i === position
                      ? "current"
                      : "upcoming"
                return (
                  <motion.li
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps have no id and only append while streaming
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    aria-current={state_ === "current" ? "step" : undefined}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 text-[14px] leading-5",
                      // The current step: a faint fill across the full width, no box.
                      state_ === "current" &&
                        "bg-muted/60 dark:bg-white/[0.05]",
                    )}
                  >
                    {/* The step's place in the sequence: its number, a check when done, tinted when current. */}
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold tabular-nums",
                        state_ === "done"
                          ? TONES.done.badge
                          : state_ === "current"
                            ? toneOf(i, kind === "intervals", false).badge
                            : "bg-muted text-muted-foreground dark:bg-white/10",
                      )}
                    >
                      {state_ === "done" ? (
                        <CheckIcon className="size-3.5" />
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className="sr-only">
                      {state_ === "done"
                        ? "Done:"
                        : state_ === "current"
                          ? "Now:"
                          : "Up next:"}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1",
                        state_ === "current" && "font-semibold",
                        state_ === "done" && "text-muted-foreground",
                      )}
                    >
                      {step.label}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 tabular-nums",
                        genuiType.meta,
                        state_ === "current" && "font-medium text-foreground",
                      )}
                    >
                      {formatShort(step.seconds)}
                      {state_ === "current" && adjustText && ` (${adjustText})`}
                    </span>
                  </motion.li>
                )
              })}
              {streaming && (
                <li aria-hidden className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-12" />
                </li>
              )}
            </ol>
          </AutoHeight>
        )}

        {/* Stopwatch: laps, newest first. */}
        {isStopwatch && stats.durations.length > 0 && (
          <AutoHeight>
            <ol
              reversed
              aria-label="Laps, newest first"
              className="flex flex-col border-t border-border py-2"
            >
              {stats.durations
                .map((duration, i) => ({ duration, i }))
                .reverse()
                .map(({ duration, i }) => (
                  <motion.li
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    className="flex items-baseline gap-3 px-3 py-2 text-[13px] leading-5"
                  >
                    <span className="w-14 shrink-0">Lap {i + 1}</span>
                    <span className={cn("min-w-0 flex-1", genuiType.meta)}>
                      {i === stats.best
                        ? "Fastest"
                        : i === stats.worst
                          ? "Slowest"
                          : ""}
                    </span>
                    <span className="font-medium tabular-nums">
                      {formatLap(duration)}
                    </span>
                    <span className="sr-only">
                      at {formatLap(state.laps?.[i] ?? 0)}
                    </span>
                  </motion.li>
                ))}
            </ol>
          </AutoHeight>
        )}

        <SurfaceFooter
          className={cn(
            "justify-between",
            // Nothing to show (the button already says Start / Pause): no empty band, only the live text.
            !(
              streaming ||
              status === "completed" ||
              status === "cancelled" ||
              (status === "ready" && showDone) ||
              (endsAtMinute !== null && !isStopwatch)
            ) && "sr-only",
          )}
        >
          <p
            aria-live="polite"
            className="flex min-w-0 items-center gap-1.5 text-[13px] leading-4 text-muted-foreground"
          >
            {streaming ? (
              <ShimmeringText
                text="Setting up the timer…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : status === "completed" || (status === "ready" && showDone) ? (
              <span className="flex items-center gap-1.5 text-[13px] leading-5 text-foreground">
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {isStopwatch
                  ? `Finished at ${formatClock(snap.elapsedMs)}`
                  : `${displayTitle} is done`}
              </span>
            ) : status === "cancelled" ? (
              <span className="flex items-center gap-1.5 text-[13px] leading-5 text-foreground">
                <XIcon aria-hidden className="size-4 shrink-0" />
                Cancelled after {formatShort(snap.elapsedMs / 1000)}
              </span>
            ) : endsAtMinute !== null && !isStopwatch ? (
              <span>
                Ends at{" "}
                <span className="tabular-nums">
                  {formatEndsAt(endsAtMinute, locale)}
                </span>
              </span>
            ) : (
              // The button already says Start / Pause / Resume.
              <span className="sr-only">
                {state.running
                  ? "Running"
                  : started
                    ? "Paused"
                    : hasPlan
                      ? "Not started"
                      : ""}
              </span>
            )}
          </p>
        </SurfaceFooter>

        {/* Announced once when the run reaches zero; steps politely. */}
        <p aria-live="assertive" className="sr-only">
          {doneMessage}
        </p>
        <p aria-live="polite" className="sr-only">
          {stepMessage}
        </p>
      </Surface>
    </MotionConfig>
  )
}
