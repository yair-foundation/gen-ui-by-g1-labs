/**
 * Execution Progress: pure logic. No React, no dates beyond Date.parse.
 *
 * Everything here is derived from the props the runtime sends, so the
 * component can re-render on every update without keeping its own copy.
 */

import type {
  ExecutionProgressResult,
  RunControl,
  RunState,
  StepState,
} from "./execution-progress.schema"

/** The parts of a step this file reads. Streaming steps may lack any of them. */
export type StepLike = {
  id?: string
  label?: string
  state?: StepState
  progress?: number
  startedAt?: string
  finishedAt?: string
  waitingFor?: string
  error?: string
  canSkip?: boolean
  canRetry?: boolean
}

export const STEP_STATES: readonly StepState[] = [
  "pending",
  "running",
  "waiting",
  "blocked",
  "done",
  "failed",
  "skipped",
]

export const DEFAULT_CONTROLS: readonly RunControl[] = [
  "pause",
  "resume",
  "cancel",
]

export type RunCommand = "pause" | "resume" | "cancel"
export type StepCommand = "skip" | "retry"

const TERMINAL: ReadonlySet<RunState> = new Set([
  "cancelled",
  "completed",
  "failed",
])
const ATTENTION: ReadonlySet<StepState> = new Set([
  "waiting",
  "blocked",
  "failed",
])

export function isTerminal(runState: RunState | undefined): boolean {
  return runState !== undefined && TERMINAL.has(runState)
}

/** Steps whose state needs the user: waiting on them, blocked, or failed. */
export function isAttentionState(state: StepState | undefined): boolean {
  return state !== undefined && ATTENTION.has(state)
}

export function needsAttention<T extends StepLike>(steps: readonly T[]): T[] {
  return steps.filter((s) => isAttentionState(s.state))
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/** How many steps are in each state. A missing state counts as pending. */
export function countByState(
  steps: readonly StepLike[],
): Record<StepState, number> {
  const counts = Object.fromEntries(STEP_STATES.map((s) => [s, 0])) as Record<
    StepState,
    number
  >
  for (const s of steps) {
    const state = s.state && s.state in counts ? s.state : "pending"
    counts[state] += 1
  }
  return counts
}

/** Done or skipped: the steps the run has put behind it. */
export function finishedCount(steps: readonly StepLike[]): number {
  const c = countByState(steps)
  return c.done + c.skipped
}

/**
 * Overall progress, 0–1. The runtime's own figure wins; otherwise done and
 * skipped steps count fully and running steps add their own progress.
 */
export function deriveOverallProgress(
  steps: readonly StepLike[],
  override?: number,
): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return clamp01(override)
  }
  if (steps.length === 0) return 0
  let credit = 0
  for (const s of steps) {
    if (s.state === "done" || s.state === "skipped") credit += 1
    else if (s.state === "running" && typeof s.progress === "number") {
      credit += clamp01(s.progress)
    }
  }
  return clamp01(credit / steps.length)
}

/** "12 of 30 steps done, 40%". */
export function progressText(
  steps: readonly StepLike[],
  progress: number,
): string {
  const total = steps.length
  const pct = Math.round(clamp01(progress) * 100)
  return `${finishedCount(steps)} of ${total} ${total === 1 ? "step" : "steps"} done, ${pct}%`
}

/** Milliseconds since epoch, or null for missing and unparseable values. */
export function parseTime(iso: string | undefined): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : null
}

/** "12s", "4m 12s", "1h 4m". The ticking elapsed clock in the header. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s"
  const total = Math.floor(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m < 60) return `${m}m ${total % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** "0.4s", "12s", "1m 5s". Same format as the Activity Trail's steps. */
export function formatStepDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ""
  if (ms < 100) return "<0.1s"
  if (ms < 10_000) {
    const s = Math.round(ms / 100) / 10
    return s >= 10 ? "10s" : `${s}s`
  }
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  if (m >= 60) {
    const h = Math.floor(m / 60)
    return m % 60 ? `${h}h ${m % 60}m` : `${h}h`
  }
  const s = total % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

/** "45 sec", "6 min", "1 h 20 min". For summaries. */
export function formatSpan(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ""
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} sec`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}

/** "less than a minute left", "about 4 min left", "about 1 h 20 min left". */
export function formatEta(seconds: number | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
    return null
  }
  if (seconds < 60) return "less than a minute left"
  return `about ${formatSpan(seconds * 1000)} left`
}

/** How long a finished step took, from its timestamps. */
export function stepDurationMs(step: StepLike): number | null {
  const a = parseTime(step.startedAt)
  const b = parseTime(step.finishedAt)
  if (a === null || b === null || b < a) return null
  return b - a
}

/** Run start to the last step that finished. Null without timestamps. */
export function runDurationMs(
  startedAt: string | undefined,
  steps: readonly StepLike[],
): number | null {
  const start = parseTime(startedAt)
  if (start === null) return null
  let end: number | null = null
  for (const s of steps) {
    const t = parseTime(s.finishedAt)
    if (t !== null && (end === null || t > end)) end = t
  }
  return end !== null && end >= start ? end - start : null
}

/** Run-level buttons for a state, limited to what the agent allows. */
export function runControls(
  runState: RunState | undefined,
  controls?: readonly RunControl[],
): RunCommand[] {
  const allowed = controls ?? DEFAULT_CONTROLS
  const forState: RunCommand[] =
    runState === "running"
      ? ["pause", "cancel"]
      : runState === "paused"
        ? ["resume", "cancel"]
        : []
  return forState.filter((c) => allowed.includes(c))
}

/**
 * Step-level buttons. Failed and blocked steps offer skip and retry when the
 * step allows it; an explicit `controls` list must include them too.
 */
export function stepActions(
  step: StepLike,
  runState: RunState | undefined,
  controls?: readonly RunControl[],
): StepCommand[] {
  if (runState !== "running" && runState !== "paused") return []
  if (step.state !== "failed" && step.state !== "blocked") return []
  const actions: StepCommand[] = []
  if (step.canRetry && (!controls || controls.includes("retry"))) {
    actions.push("retry")
  }
  if (step.canSkip && (!controls || controls.includes("skip"))) {
    actions.push("skip")
  }
  return actions
}

/** Whether a waiting step offers "Review" (the waiting is on the user). */
export function canReview(
  step: StepLike,
  runState: RunState | undefined,
): boolean {
  return (
    step.state === "waiting" &&
    (runState === "running" || runState === "paused")
  )
}

/**
 * Whether a command the user sent is still waiting for the runtime to reflect
 * it. Used for the optimistic "Pausing…" state, and to drop a restored result
 * that the props already show as applied.
 */
export function isCommandPending(
  command: ExecutionProgressResult,
  runState: RunState | undefined,
  steps: readonly StepLike[],
): boolean {
  switch (command.action) {
    case "pause":
      return runState === "running"
    case "resume":
      return runState === "paused"
    case "cancel":
      return runState === "running" || runState === "paused"
    case "skip": {
      if (isTerminal(runState)) return false
      const s = steps.find((x) => x.id === command.stepId)
      return !!s && s.state !== "skipped" && s.state !== "done"
    }
    case "retry": {
      if (isTerminal(runState)) return false
      const s = steps.find((x) => x.id === command.stepId)
      return !!s && (s.state === "failed" || s.state === "blocked")
    }
    default:
      return false
  }
}

function countParts(steps: readonly StepLike[]): string {
  const c = countByState(steps)
  const parts = [`${c.done} done`]
  if (c.skipped) parts.push(`${c.skipped} skipped`)
  if (c.failed) parts.push(`${c.failed} failed`)
  const left = c.pending + c.running + c.waiting + c.blocked
  if (left) parts.push(`${left} not run`)
  return parts.join(", ")
}

/**
 * The line shown when the run is over:
 * "Completed in 6 min · 38 done, 2 skipped". Null while it's still going.
 */
export function summaryLine(
  runState: RunState | undefined,
  steps: readonly StepLike[],
  startedAt?: string,
): string | null {
  if (!isTerminal(runState)) return null
  const ms = runDurationMs(startedAt, steps)
  const span = ms !== null ? formatSpan(ms) : null
  const head =
    runState === "completed"
      ? span
        ? `Completed in ${span}`
        : "Completed"
      : runState === "cancelled"
        ? span
          ? `Cancelled after ${span}`
          : "Cancelled"
        : span
          ? `Failed after ${span}`
          : "Failed"
  return `${head} · ${countParts(steps)}`
}

/** Announcement for a step that just started needing the user. */
export function attentionMessage(step: StepLike): string {
  const label = step.label ?? "A step"
  if (step.state === "waiting") {
    return `Needs you: ${label}.${step.waitingFor ? ` ${step.waitingFor}.` : ""}`
  }
  if (step.state === "blocked") {
    return `Blocked: ${label}.${step.waitingFor ? ` ${step.waitingFor}.` : ""}`
  }
  if (step.state === "failed") {
    return `Failed: ${label}.${step.error ? ` ${step.error}` : ""}`
  }
  return ""
}

/** Announcement for a run state change, or null for changes not worth one. */
export function runStateMessage(
  previous: RunState | undefined,
  next: RunState | undefined,
  steps: readonly StepLike[],
  startedAt?: string,
): string | null {
  if (!next || previous === next || previous === undefined) return null
  if (isTerminal(next)) return summaryLine(next, steps, startedAt)
  if (next === "paused") return "Run paused."
  if (next === "stopping") return "Stopping the run."
  if (next === "running" && previous === "paused") return "Run resumed."
  return null
}

/** The step to keep in view: the running one, else the first that needs the user. */
export function focusStepId(steps: readonly StepLike[]): string | null {
  const running = steps.find((s) => s.state === "running")
  if (running?.id) return running.id
  return needsAttention(steps)[0]?.id ?? null
}

/** Only http(s) links are rendered as links; anything else is dropped. */
export function safeUrl(url?: string): URL | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}
