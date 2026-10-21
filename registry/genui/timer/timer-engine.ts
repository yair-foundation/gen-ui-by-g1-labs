/**
 * Timer: pure time logic, no React.
 *
 * Everything is derived from a small saved state plus the wall clock, so a
 * timer survives reloads and background tabs: remaining time is computed from
 * `Date.now()`, never by counting ticks.
 */

export type TimerMode = "countdown" | "stopwatch" | "intervals"

export type TimerStep = { label: string; seconds: number }

export type TimerState = {
  /** Epoch ms when the current running stretch began. Only set while running. */
  startedAt?: number
  /** Milliseconds timed before the last pause. */
  elapsedBeforePause: number
  running: boolean
  /**
   * The step (counted across rounds) that `adjustSeconds` applies to.
   * Countdown always uses step 0.
   */
  stepIndex?: number
  /** Stopwatch: total elapsed ms at each lap press, oldest first. */
  laps?: number[]
  /** Seconds added (+) or removed (−) on step `stepIndex` with ±1 min. */
  adjustSeconds: number
}

export type TimerPlan = {
  mode: TimerMode
  steps: TimerStep[]
  /** Rounds of the step sequence (intervals). */
  repeat?: number
}

/** One step on the timeline, with its position in ms from the start. */
export type TimelineStep = TimerStep & {
  /** Position across rounds. */
  index: number
  /** Position within the step list. */
  stepIndex: number
  /** 0-based round. */
  round: number
  startMs: number
  endMs: number
}

export type TimerSnapshot = {
  elapsedMs: number
  /** Null for a stopwatch. */
  totalMs: number | null
  remainingMs: number | null
  done: boolean
  current: TimelineStep | null
  next: TimelineStep | null
  /** Milliseconds left in the current step. */
  stepRemainingMs: number | null
  /** 0–1 through the current step (countdown: the whole run). */
  stepProgress: number
}

export const initialTimerState: TimerState = {
  elapsedBeforePause: 0,
  running: false,
  adjustSeconds: 0,
}

const MIN_STEP_MS = 1000

/** Milliseconds timed so far. */
export function elapsedAt(state: TimerState, now: number): number {
  const live =
    state.running && state.startedAt !== undefined
      ? Math.max(0, now - state.startedAt)
      : 0
  return Math.max(0, state.elapsedBeforePause + live)
}

/** The flattened steps, rounds expanded and the adjustment applied. */
export function timeline(plan: TimerPlan, state: TimerState): TimelineStep[] {
  if (plan.mode === "stopwatch") return []
  const steps =
    plan.mode === "countdown" ? plan.steps.slice(0, 1) : plan.steps.slice()
  const rounds =
    plan.mode === "intervals" ? Math.max(1, Math.floor(plan.repeat ?? 1)) : 1
  const adjustedIndex = plan.mode === "countdown" ? 0 : (state.stepIndex ?? 0)
  const out: TimelineStep[] = []
  let at = 0
  for (let round = 0; round < rounds; round++) {
    steps.forEach((step, stepIndex) => {
      const index = out.length
      let ms = Math.max(0, step.seconds) * 1000
      if (index === adjustedIndex) {
        ms = Math.max(MIN_STEP_MS, ms + state.adjustSeconds * 1000)
      }
      out.push({
        ...step,
        index,
        stepIndex,
        round,
        startMs: at,
        endMs: at + ms,
      })
      at += ms
    })
  }
  return out
}

/** The step playing at `elapsedMs` (the last step once the run is over). */
export function stepAt(
  line: TimelineStep[],
  elapsedMs: number,
): TimelineStep | null {
  if (line.length === 0) return null
  for (const step of line) if (elapsedMs < step.endMs) return step
  return line[line.length - 1]
}

export function snapshot(
  plan: TimerPlan,
  state: TimerState,
  now: number,
): TimerSnapshot {
  const elapsedMs = elapsedAt(state, now)
  if (plan.mode === "stopwatch") {
    return {
      elapsedMs,
      totalMs: null,
      remainingMs: null,
      done: false,
      current: null,
      next: null,
      stepRemainingMs: null,
      stepProgress: 0,
    }
  }
  const line = timeline(plan, state)
  const totalMs = line.length ? line[line.length - 1].endMs : 0
  const done = line.length > 0 && elapsedMs >= totalMs
  const current = stepAt(line, elapsedMs)
  const next = current && !done ? (line[current.index + 1] ?? null) : null
  const clamped = Math.min(elapsedMs, totalMs)
  const stepLength = current ? current.endMs - current.startMs : 0
  const stepRemainingMs = current ? Math.max(0, current.endMs - clamped) : null
  return {
    elapsedMs: clamped,
    totalMs,
    remainingMs: Math.max(0, totalMs - clamped),
    done,
    current,
    next,
    stepRemainingMs,
    stepProgress:
      current && stepLength > 0
        ? Math.min(1, (clamped - current.startMs) / stepLength)
        : done
          ? 1
          : 0,
  }
}

// ---------------------------------------------------------------------------
// Actions: each returns the next state.

export function start(state: TimerState, now: number): TimerState {
  if (state.running) return state
  return { ...state, running: true, startedAt: now }
}

export function pause(state: TimerState, now: number): TimerState {
  if (!state.running) return state
  const { startedAt: _, ...rest } = state
  return { ...rest, running: false, elapsedBeforePause: elapsedAt(state, now) }
}

export function reset(): TimerState {
  return { ...initialTimerState }
}

/** Ends the run: stops the clock at the plan's total. */
export function complete(
  plan: TimerPlan,
  state: TimerState,
  now: number,
): TimerState {
  const paused = pause(state, now)
  const { totalMs } = snapshot(plan, paused, now)
  return totalMs === null ? paused : { ...paused, elapsedBeforePause: totalMs }
}

/** Whether ±seconds can be applied to the current step right now. */
export function canAdjust(
  plan: TimerPlan,
  state: TimerState,
  deltaSeconds: number,
  now: number,
): boolean {
  if (plan.mode === "stopwatch") return false
  const snap = snapshot(plan, state, now)
  if (snap.done || !snap.current || snap.stepRemainingMs === null) return false
  // Removing time never ends the step outright: that is what Skip is for.
  return deltaSeconds > 0 || snap.stepRemainingMs > -deltaSeconds * 1000
}

/**
 * Adds or removes time on the current step. Only one step carries an
 * adjustment, so an earlier step's adjustment is folded into elapsed time
 * before the current step takes it over.
 */
export function adjust(
  plan: TimerPlan,
  state: TimerState,
  deltaSeconds: number,
  now: number,
): TimerState {
  if (!canAdjust(plan, state, deltaSeconds, now)) return state
  const current = snapshot(plan, state, now).current
  if (!current) return state
  const index = plan.mode === "countdown" ? 0 : current.index
  const owner = plan.mode === "countdown" ? 0 : (state.stepIndex ?? 0)
  let next = state
  if (owner !== index && state.adjustSeconds !== 0) {
    // The adjusted step is in the past: keep the clock where it is by
    // removing its extra time from the elapsed total.
    next = rebase(state, now, -state.adjustSeconds * 1000)
    next = { ...next, adjustSeconds: 0 }
  }
  const base = timeline(plan, { ...next, adjustSeconds: 0 })[index]
  const baseMs = base ? base.endMs - base.startMs : 0
  const wanted = next.adjustSeconds + deltaSeconds
  // Never shorter than one second.
  const floor = Math.ceil((MIN_STEP_MS - baseMs) / 1000)
  return {
    ...next,
    stepIndex: plan.mode === "countdown" ? undefined : index,
    adjustSeconds: Math.max(floor, wanted),
  }
}

/** Jumps to the start of the next step (or the end, from the last one). */
export function skip(
  plan: TimerPlan,
  state: TimerState,
  now: number,
): TimerState {
  const snap = snapshot(plan, state, now)
  if (snap.done || !snap.current) return state
  return rebase(state, now, snap.current.endMs - snap.elapsedMs)
}

/** Stopwatch: records a lap at the current elapsed time. */
export function lap(state: TimerState, now: number): TimerState {
  return { ...state, laps: [...(state.laps ?? []), elapsedAt(state, now)] }
}

/** Shifts elapsed time by `deltaMs`, keeping the running/paused state. */
function rebase(state: TimerState, now: number, deltaMs: number): TimerState {
  const elapsed = Math.max(0, elapsedAt(state, now) + deltaMs)
  return state.running
    ? { ...state, elapsedBeforePause: elapsed, startedAt: now }
    : { ...state, elapsedBeforePause: elapsed }
}

// ---------------------------------------------------------------------------
// Laps

export type LapStats = {
  /** Duration of each lap in ms, oldest first. */
  durations: number[]
  /** Index of the fastest lap; null with fewer than two distinct laps. */
  best: number | null
  /** Index of the slowest lap; null with fewer than two distinct laps. */
  worst: number | null
}

/** Lap durations from cumulative lap times, with the fastest and slowest. */
export function lapStats(laps: number[] = []): LapStats {
  const durations = laps.map((t, i) => Math.max(0, t - (i ? laps[i - 1] : 0)))
  if (durations.length < 2) return { durations, best: null, worst: null }
  let best = 0
  let worst = 0
  durations.forEach((d, i) => {
    if (d < durations[best]) best = i
    if (d > durations[worst]) worst = i
  })
  if (durations[best] === durations[worst]) {
    return { durations, best: null, worst: null }
  }
  return { durations, best, worst }
}

/** Cumulative lap times from durations (e.g. restoring a result's laps). */
export function lapsFromDurations(durationsSeconds: number[]): number[] {
  let at = 0
  return durationsSeconds.map((s) => {
    at += Math.max(0, s) * 1000
    return at
  })
}

// ---------------------------------------------------------------------------
// Formatting

/** Seconds with one decimal, for results. */
export function toSeconds(ms: number): number {
  return Math.round(ms / 100) / 10
}

/**
 * "04:30", or "1:20:00" past an hour. Countdowns round up (so "00:01" shows
 * until the very end); stopwatches round down.
 */
export function formatClock(
  ms: number,
  rounding: "up" | "down" = "down",
): string {
  const raw = Math.max(0, ms) / 1000
  // Guard against float noise like 59.99999 → 60.
  const total =
    rounding === "up" ? Math.ceil(raw - 1e-6) : Math.floor(raw + 1e-6)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${s}`
    : `${String(m).padStart(2, "0")}:${s}`
}

/** "1:02.3": a lap time with tenths. */
export function formatLap(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100 + 1e-6)
  const total = Math.floor(tenths / 10)
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, "0")
  return `${m}:${s}.${tenths % 10}`
}

function parts(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  return {
    h: Math.floor(total / 3600),
    m: Math.floor((total % 3600) / 60),
    s: total % 60,
  }
}

/** "1 h 20 min", "4 min 30 s", "15 s". */
export function formatShort(seconds: number): string {
  const { h, m, s } = parts(seconds)
  const out: string[] = []
  if (h) out.push(`${h} h`)
  if (m) out.push(`${m} min`)
  if (s || out.length === 0) out.push(`${s} s`)
  return out.join(" ")
}

/** "1 hour 20 minutes", "1 minute 5 seconds", "0 seconds". For screen readers. */
export function formatSpoken(seconds: number): string {
  const { h, m, s } = parts(seconds)
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const out: string[] = []
  if (h) out.push(unit(h, "hour"))
  if (m) out.push(unit(m, "minute"))
  if (s || out.length === 0) out.push(unit(s, "second"))
  return out.join(" ")
}
