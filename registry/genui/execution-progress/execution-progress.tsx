"use client"

import * as React from "react"
import {
  AlertTriangleIcon,
  BanIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  CircleStopIcon,
  ExternalLinkIcon,
  HandIcon,
  LoaderCircleIcon,
  type LucideIcon,
  SkipForwardIcon,
  XIcon,
} from "lucide-react"
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  ExecutionProgressInput,
  ExecutionProgressResult,
  ExecutionStep,
  ExecutionSubstep,
  RunState,
  StepState,
} from "./execution-progress.schema"
import {
  attentionMessage,
  canReview,
  clamp01,
  countByState,
  deriveOverallProgress,
  finishedCount,
  focusStepId,
  formatElapsed,
  formatEta,
  formatStepDuration,
  isAttentionState,
  isCommandPending,
  isTerminal,
  needsAttention,
  parseTime,
  progressText,
  runControls,
  runStateMessage,
  safeUrl,
  type StepCommand,
  stepActions,
  stepDurationMs,
  summaryLine,
} from "./execution-progress-utils"

export type ExecutionProgressStatus = "streaming" | "ready"

type PartialStep = Partial<Omit<ExecutionStep, "substeps">> & {
  substeps?: Partial<ExecutionSubstep>[]
}
type ReadyStep = PartialStep & { id: string; label: string; state: StepState }
type Output = { label?: string; url?: string }

export type ExecutionProgressProps = Partial<
  Omit<ExecutionProgressInput, "steps" | "outputs">
> & {
  /** Steps may be partial while the tool call streams. */
  steps?: PartialStep[]
  outputs?: Output[]
  /** Lifecycle, controlled by the host. Live updates arrive as new props. */
  status?: ExecutionProgressStatus
  /** Called with each command. Forward it to the agent runtime. */
  onResult?: (result: ExecutionProgressResult) => void
  /**
   * The last command, from history. Shown as pending ("Pausing…") until the
   * props reflect it; never re-sent.
   */
  result?: ExecutionProgressResult
  className?: string
}

/** A command not reflected in the props after this long stops blocking its button. */
const PENDING_TIMEOUT_MS = 10_000
/** After the user scrolls the step list, leave it alone for this long. */
const USER_SCROLL_PAUSE_MS = 4_000
/** Above this many steps, the list scrolls inside the card. */
const SCROLL_AFTER = 6
const RUN_KEY = "\u0000run"

const spring = genuiMotion.gentle

const stateIcon: Record<StepState, LucideIcon> = {
  pending: CircleIcon,
  running: LoaderCircleIcon,
  waiting: HandIcon,
  blocked: BanIcon,
  done: CheckIcon,
  failed: XIcon,
  skipped: SkipForwardIcon,
}

const stateTone: Record<StepState, string> = {
  pending: "text-muted-foreground/60",
  running: "animate-spin text-foreground motion-reduce:animate-none",
  waiting: "text-foreground",
  blocked: "text-foreground",
  done: "text-foreground",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
}

const stateName: Record<StepState, string> = {
  pending: "Not started",
  running: "In progress",
  waiting: "Waiting for you",
  blocked: "Blocked",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped",
}

const runMeta: Record<
  RunState,
  { label: string; variant: "success" | "warning" | "info" | "destructive" }
> = {
  running: { label: "Running", variant: "info" },
  paused: { label: "Paused", variant: "warning" },
  stopping: { label: "Stopping", variant: "warning" },
  cancelled: { label: "Cancelled", variant: "destructive" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "destructive" },
}

const pendingLabel: Record<ExecutionProgressResult["action"], string> = {
  pause: "Pausing…",
  resume: "Resuming…",
  cancel: "Cancelling…",
  skip: "Skipping…",
  retry: "Retrying…",
  "open-waiting": "",
}

/** Stable keys for lists without ids: the label, numbered on repeats. */
function keysFor(labels: string[]) {
  const seen = new Map<string, number>()
  return labels.map((l) => {
    const n = (seen.get(l) ?? 0) + 1
    seen.set(l, n)
    return n > 1 ? `${l}#${n}` : l
  })
}

/** Wall clock, ticking each second after mount; null on the server. */
function useNow(active: boolean) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function StepIcon({
  state,
  small = false,
  className,
}: {
  state: StepState
  small?: boolean
  className?: string
}) {
  const Icon = stateIcon[state]
  return (
    <span
      aria-hidden
      className={cn(
        "relative shrink-0",
        small ? "size-3.5" : "size-4",
        className,
      )}
    >
      {/* Cross-fades when the state changes. */}
      <AnimatePresence initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          transition={{ duration: 0.15 }}
          className="absolute inset-0 grid place-items-center"
        >
          <Icon
            className={cn(small ? "size-3.5" : "size-4", stateTone[state])}
          />
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

function StepRow({
  step,
  expanded,
  onToggle,
  actions,
  review,
  pending,
  disabled,
  onCommand,
  rowRef,
}: {
  step: ReadyStep
  expanded: boolean
  onToggle: () => void
  actions: StepCommand[]
  review: boolean
  pending: ExecutionProgressResult["action"] | null
  disabled: boolean
  onCommand: (result: ExecutionProgressResult) => void
  rowRef: (el: HTMLLIElement | null) => void
}) {
  const subId = React.useId()
  const { state } = step
  const needsUser = state === "waiting" || state === "blocked"
  const finished = state === "done" || state === "failed" || state === "skipped"
  const duration = finished ? stepDurationMs(step) : null
  const pct =
    state === "running" && typeof step.progress === "number"
      ? Math.round(clamp01(step.progress) * 100)
      : null
  const subs = (step.substeps ?? []).filter(
    (s): s is ExecutionSubstep => typeof s.label === "string",
  )
  const subKeys = keysFor(subs.map((s) => s.label))
  const subsDone = subs.filter(
    (s) => s.state === "done" || s.state === "skipped",
  ).length
  // Failed: the error. Blocked or skipped: the reason, quieter.
  const showError =
    (state === "failed" || state === "blocked" || state === "skipped") &&
    Boolean(step.error)
  // Only live and stuck steps show their detail and substeps; the rest are
  // one line, with the detail spoken.
  const quiet = !(state === "running" || needsUser || state === "failed")

  return (
    <motion.li
      ref={rowRef}
      layout="position"
      data-slot="execution-progress-step"
      data-state={state}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className={cn(
        "flex gap-3 rounded-[10px] px-3 py-2.5 transition-colors duration-300",
        // Live and stuck steps carry more, so they take the full row.
        !quiet && "@lg:col-span-full",
        needsUser &&
          "border border-border bg-transparent py-3",
      )}
    >
      <StepIcon state={state} className="mt-0.5" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span
            className={cn(
              genuiType.body,
              (state === "pending" || state === "skipped") &&
                "text-muted-foreground",
              state === "failed" && "text-destructive",
              needsUser && "font-medium",
            )}
          >
            <span className="sr-only">
              {stateName[state]}
              {pct !== null ? `, ${pct}%` : ""}:{" "}
            </span>
            {step.label}
            {quiet && step.detail && (
              <span className="sr-only">{`. ${step.detail}`}</span>
            )}
            {duration !== null && (
              <span className="sr-only">{`. Took ${formatStepDuration(duration)}`}</span>
            )}
          </span>
          {pct !== null && (
            <span
              aria-hidden
              className={cn(genuiType.value, "inline-flex shrink-0")}
            >
              <SlidingNumber number={pct} initiallyStable />%
            </span>
          )}
        </div>

        {step.detail && !quiet && (
          <span className={cn(genuiType.meta, "tabular-nums")}>
            {step.detail}
          </span>
        )}

        {pct !== null && (
          <div
            aria-hidden
            className="h-1.5 w-full overflow-hidden rounded-full border border-border bg-transparent"
          >
            <motion.div
              className="h-full rounded-full bg-sky-500 dark:bg-sky-400"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={spring}
            />
          </div>
        )}

        {needsUser && step.waitingFor && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className={cn(genuiType.body, "font-medium")}
          >
            {step.waitingFor}
          </motion.p>
        )}

        {showError && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "text-[13px]",
              state === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {step.error}
          </motion.p>
        )}

        {(review || actions.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {review && (
              <Button
                size="sm"
                variant="link"
                className="h-6 px-0"
                disabled={disabled}
                onClick={() =>
                  onCommand({ action: "open-waiting", stepId: step.id })
                }
              >
                Review
                <span className="sr-only">: {step.label}</span>
              </Button>
            )}
            {actions.includes("retry") && (
              <Button
                size="sm"
                variant={
                  actions.includes("retry") && actions.includes("skip")
                    ? "secondary"
                    : "default"
                }
                focusableWhenDisabled
                disabled={disabled || pending !== null}
                onClick={() => onCommand({ action: "retry", stepId: step.id })}
              >
                {pending === "retry" ? pendingLabel.retry : "Retry step"}
                <span className="sr-only">: {step.label}</span>
              </Button>
            )}
            {actions.includes("skip") && (
              <Button
                size="sm"
                variant={
                  actions.includes("retry") && actions.includes("skip")
                    ? "secondary"
                    : "default"
                }
                focusableWhenDisabled
                disabled={disabled || pending !== null}
                onClick={() => onCommand({ action: "skip", stepId: step.id })}
              >
                {pending === "skip" ? pendingLabel.skip : "Skip step"}
                <span className="sr-only">: {step.label}</span>
              </Button>
            )}
          </div>
        )}

        {subs.length > 0 && quiet && (
          <span className="sr-only">
            {`${subsDone} of ${subs.length} substeps done`}
          </span>
        )}
        {subs.length > 0 && !quiet && (
          <>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={subId}
              onClick={onToggle}
              className="-mx-2 inline-flex h-7 items-center gap-1 self-start rounded-full px-2 text-[13px] tabular-nums text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "size-3.5 shrink-0 transition-transform",
                  expanded && "rotate-180",
                )}
              />
              {subsDone} of {subs.length} substeps
              <span className="sr-only">: {step.label}</span>
            </button>
            {/* Kept in the DOM while collapsed so aria-controls resolves. */}
            <ul id={subId} hidden={!expanded} className="flex flex-col gap-1">
              {subs.map((sub, i) => (
                <li
                  key={subKeys[i]}
                  className={cn(
                    "flex items-center gap-2 text-[13px]",
                    (sub.state === "pending" || sub.state === "skipped") &&
                      "text-muted-foreground",
                    sub.state === "failed" && "text-destructive",
                  )}
                >
                  <StepIcon state={sub.state ?? "pending"} small />
                  <span className="sr-only">
                    {stateName[sub.state ?? "pending"]}:{" "}
                  </span>
                  {sub.label}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </motion.li>
  )
}

export function ExecutionProgress({
  title,
  goal,
  steps = [],
  overall,
  runState,
  startedAt,
  controls,
  cancelNote,
  outputs = [],
  status: statusProp,
  onResult,
  result,
  className,
}: ExecutionProgressProps) {
  // Lifecycle is the host's; the run's state always comes from the props.
  const status: ExecutionProgressStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const terminal = isTerminal(runState)
  const reducedMotion = useReducedMotion()

  const ready = React.useMemo(
    () =>
      steps
        .filter(
          (s): s is PartialStep & { id: string; label: string } =>
            typeof s.id === "string" && typeof s.label === "string",
        )
        .map((s): ReadyStep => ({ ...s, state: s.state ?? "pending" })),
    [steps],
  )
  const outputsReady = outputs.filter(
    (o): o is Output & { label: string } => typeof o.label === "string",
  )
  const outputKeys = keysFor(outputsReady.map((o) => `${o.label} ${o.url}`))

  const progress = deriveOverallProgress(ready, overall?.progress)
  const counts = countByState(ready)
  const done = finishedCount(ready)
  const attention = needsAttention(ready).length
  const summary = summaryLine(runState, ready, startedAt)
  const eta = runState === "running" ? formatEta(overall?.etaSeconds) : null
  const available = runControls(runState, controls)

  // Elapsed time ticks after mount, so server and client markup match.
  const now = useNow(!terminal && parseTime(startedAt) !== null)
  const start = parseTime(startedAt)
  const elapsed =
    !terminal && now !== null && start !== null
      ? formatElapsed(now - start)
      : null

  /* Commands sent, shown as pending until the props reflect them. ------- */
  const [pending, setPending] = React.useState<
    Record<string, { result: ExecutionProgressResult; at: number }>
  >(() => {
    if (!result || result.action === "open-waiting") return {}
    const key = "stepId" in result ? result.stepId : RUN_KEY
    return { [key]: { result, at: Date.now() } }
  })

  React.useEffect(() => {
    const keys = Object.keys(pending)
    if (keys.length === 0) return
    const t0 = Date.now()
    const live = keys.filter(
      (k) =>
        t0 - pending[k].at < PENDING_TIMEOUT_MS &&
        isCommandPending(pending[k].result, runState, ready),
    )
    if (live.length !== keys.length) {
      setPending(Object.fromEntries(live.map((k) => [k, pending[k]])))
      return
    }
    // Never lock for good: drop the command when the runtime stays silent.
    const next =
      Math.min(...live.map((k) => pending[k].at + PENDING_TIMEOUT_MS)) - t0
    const t = setTimeout(() => setPending((p) => ({ ...p })), next)
    return () => clearTimeout(t)
  }, [pending, runState, ready])

  const pendingFor = (key: string) => {
    const p = pending[key]
    return p && isCommandPending(p.result, runState, ready)
      ? p.result.action
      : null
  }
  const runPending = pendingFor(RUN_KEY)

  const send = (r: ExecutionProgressResult) => {
    if (streaming) return
    onResult?.(r)
    if (r.action === "open-waiting") return
    const key = "stepId" in r ? r.stepId : RUN_KEY
    setPending((p) => ({ ...p, [key]: { result: r, at: Date.now() } }))
  }

  /* Substeps: open for the running step unless the user chose otherwise. */
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({})

  /* Cancel: two-step inline confirm, with focus moved in and back. ------ */
  const [confirming, setConfirming] = React.useState(false)
  const keepRef = React.useRef<HTMLButtonElement>(null)
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const wasConfirming = React.useRef(false)
  const showConfirm =
    confirming && available.includes("cancel") && runPending === null
  React.useEffect(() => {
    if (showConfirm) keepRef.current?.focus()
    else if (wasConfirming.current) cancelRef.current?.focus()
    wasConfirming.current = showConfirm
  }, [showConfirm])

  /* Keep the running step in view, inside the list's own scroll box. ---- */
  const scrollable = ready.length > SCROLL_AFTER
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const rowEls = React.useRef(new Map<string, HTMLLIElement>())
  const userScrolledAt = React.useRef(0)
  const focusId = focusStepId(ready)
  React.useEffect(() => {
    const box = scrollRef.current
    if (!box || !focusId || !scrollable) return
    if (Date.now() - userScrolledAt.current < USER_SCROLL_PAUSE_MS) return
    const el = rowEls.current.get(focusId)
    if (!el) return
    const b = box.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    if (r.top >= b.top && r.bottom <= b.bottom) return
    // scrollTo on the box only; the page never moves.
    box.scrollTo({
      top: Math.max(0, box.scrollTop + (r.top - b.top) - b.height / 3),
      behavior: reducedMotion ? "auto" : "smooth",
    })
  }, [focusId, scrollable, reducedMotion])
  const markUserScroll = () => {
    userScrolledAt.current = Date.now()
  }

  /* Announce steps that need the user, and run state changes. ---------- */
  const [announcement, setAnnouncement] = React.useState("")
  const seen = React.useRef<{
    steps: Map<string, StepState>
    run: RunState | undefined
  } | null>(null)
  React.useEffect(() => {
    if (streaming) return
    const prev = seen.current
    seen.current = {
      steps: new Map(ready.map((s) => [s.id, s.state])),
      run: runState,
    }
    if (!prev) return
    const messages = ready
      .filter((s) => prev.steps.get(s.id) !== s.state)
      .filter((s) => isAttentionState(s.state))
      .map(attentionMessage)
    const runMessage = runStateMessage(prev.run, runState, ready, startedAt)
    if (runMessage) messages.push(runMessage)
    if (messages.length) setAnnouncement(messages.join(" "))
  }, [ready, runState, startedAt, streaming])

  const meta = runState ? runMeta[runState] : null
  const SummaryIcon =
    runState === "completed"
      ? CheckCircle2Icon
      : runState === "failed"
        ? AlertTriangleIcon
        : CircleStopIcon
  const canToggle = available.includes("pause") || available.includes("resume")
  const showFooter =
    (terminal && summary !== null) ||
    streaming ||
    runState === "stopping" ||
    available.length > 0
  const total = ready.length

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="execution-progress"
        data-status={status}
        data-run-state={runState}
        aria-busy={streaming}
        aria-label={title ?? "Progress"}
        className={cn("@container", className)}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <SurfaceTitle>{title}</SurfaceTitle>
            {goal && <p className="sr-only">{`Goal: ${goal}`}</p>}
            {/* A finished run says how it ended in the footer instead. */}
            {meta && !(terminal && summary !== null) && (
              <Badge variant={meta.variant} className="mt-px">
                {meta.label}
              </Badge>
            )}
          </div>
        </SurfaceHeader>

        {total > 0 && (
          <div className="border-t border-border px-3 py-3">
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="tabular-nums">
                  <span className="sr-only">
                    {progressText(ready, progress)}
                  </span>
                  <span aria-hidden>
                    <span
                      className={cn(genuiType.stat, "inline-flex leading-none")}
                    >
                      <SlidingNumber number={done} initiallyStable />
                    </span>
                    <span
                      className={cn(genuiType.body, "text-muted-foreground")}
                    >
                      {` of ${total} done`}
                    </span>
                  </span>
                </p>
                <p
                  className={cn(
                    genuiType.meta,
                    "flex flex-wrap gap-x-1.5 tabular-nums",
                  )}
                >
                  {!terminal && attention > 0 && (
                    <span className="font-medium text-foreground">
                      {attention} {attention === 1 ? "needs" : "need"} attention
                    </span>
                  )}
                  {!terminal && attention > 0 && (elapsed || eta) && (
                    <span aria-hidden>·</span>
                  )}
                  {eta ? (
                    <span>{eta}</span>
                  ) : (
                    elapsed && <span>{elapsed} elapsed</span>
                  )}
                </p>
              </div>
              {/* Decorative: the text above is the accessible value. */}
              <div
                aria-hidden
                className="h-2 overflow-hidden rounded-full border border-border bg-transparent"
              >
                <motion.div
                  className={cn(
                    "h-full rounded-full",
                    runState === "completed"
                      ? "bg-emerald-500 dark:bg-emerald-400"
                      : runState === "failed" || runState === "cancelled"
                        ? "bg-red-500 dark:bg-red-400"
                        : runState === "paused"
                          ? "bg-orange-500 dark:bg-orange-400"
                          : "bg-sky-500 dark:bg-sky-400",
                  )}
                  initial={false}
                  animate={{ width: `${progress * 100}%` }}
                  transition={spring}
                />
              </div>
            </div>
          </div>
        )}

        {/* Past ~6 steps the list scrolls inside the card; the region is
            focusable so keyboard users can scroll it. */}
        <motion.div
          ref={scrollRef}
          layoutScroll
          role={scrollable ? "region" : undefined}
          aria-label={
            scrollable ? `Steps for ${title ?? "this run"}` : undefined
          }
          tabIndex={scrollable ? 0 : undefined}
          onWheel={markUserScroll}
          onTouchMove={markUserScroll}
          onKeyDown={markUserScroll}
          className={cn(
            "border-t border-border",
            scrollable &&
              "max-h-[22rem] overflow-y-auto overscroll-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset",
          )}
        >
          <AutoHeight>
            <ol className="grid grid-cols-1 content-start px-2 py-2 @lg:grid-cols-2">
              {ready.map((s) => (
                <StepRow
                  key={s.id}
                  step={s}
                  expanded={expanded[s.id] ?? s.state === "running"}
                  onToggle={() =>
                    setExpanded((e) => ({
                      ...e,
                      [s.id]: !(e[s.id] ?? s.state === "running"),
                    }))
                  }
                  actions={stepActions(s, runState, controls)}
                  review={canReview(s, runState)}
                  pending={pendingFor(s.id)}
                  disabled={streaming || runPending === "cancel"}
                  onCommand={send}
                  rowRef={(el) => {
                    if (el) rowEls.current.set(s.id, el)
                    else rowEls.current.delete(s.id)
                  }}
                />
              ))}
              {streaming && (
                <li
                  aria-hidden
                  className="flex gap-3 px-3 py-2.5 @lg:col-span-full"
                >
                  <Skeleton className="size-4" />
                  <Skeleton className="h-4 flex-1" />
                </li>
              )}
            </ol>
          </AutoHeight>
        </motion.div>

        {outputsReady.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-border px-3 py-3">
            <p className={genuiType.label}>
              {outputsReady.length === 1 ? "Output" : "Outputs"}
              {terminal ? "" : " so far"}
            </p>
            <ul className="flex flex-wrap gap-2 pt-1">
              {outputsReady.map((o, i) => {
                const url = safeUrl(o.url)
                return (
                  <motion.li
                    key={outputKeys[i]}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    className={cn(genuiType.body, "max-w-full")}
                  >
                    {url ? (
                      <a
                        href={url.href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded-full border border-border bg-transparent px-3 outline-none transition-colors hover:bg-muted/70 dark:hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        <span className="truncate">{o.label}</span>
                        <ExternalLinkIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="inline-flex min-h-7 items-center rounded-full border border-border bg-transparent px-3">
                        {o.label}
                      </span>
                    )}
                  </motion.li>
                )
              })}
            </ul>
          </div>
        )}

        {showFooter && (
          <SurfaceFooter>
            {terminal && summary !== null ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <SummaryIcon
                  aria-hidden
                  className={cn(
                    "size-4 shrink-0",
                    runState === "failed" && "text-destructive",
                  )}
                />
                {summary}
              </p>
            ) : streaming || !runState ? (
              <p className={genuiType.meta}>
                <ShimmeringText
                  text="Planning the steps…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </p>
            ) : runState === "stopping" ? (
              <p className={genuiType.meta}>
                <ShimmeringText
                  text="Stopping after the current step…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </p>
            ) : showConfirm ? (
              <div className="flex w-full flex-col gap-2 @md:flex-row @md:items-center @md:justify-between">
                <p className={genuiType.body}>
                  <span className="font-medium">Cancel the run?</span>{" "}
                  {cancelNote ??
                    `${counts.done} of ${total} ${total === 1 ? "step is" : "steps are"} done.`}
                </p>
                <div className="flex gap-2 @md:shrink-0">
                  <Button
                    ref={keepRef}
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirming(false)}
                  >
                    {runState === "paused" ? "Keep the run" : "Keep running"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      setConfirming(false)
                      send({ action: "cancel" })
                    }}
                  >
                    Cancel run
                  </Button>
                </div>
              </div>
            ) : (
              <div className="ml-auto flex flex-wrap gap-2">
                {canToggle && (
                  <Button
                    size="sm"
                    variant={
                      available.includes("cancel") ? "secondary" : "default"
                    }
                    focusableWhenDisabled
                    disabled={runPending !== null}
                    onClick={() =>
                      send({
                        action: runState === "paused" ? "resume" : "pause",
                      })
                    }
                  >
                    {runPending === "pause" || runPending === "resume"
                      ? pendingLabel[runPending]
                      : runState === "paused"
                        ? "Resume"
                        : "Pause"}
                  </Button>
                )}
                {available.includes("cancel") && (
                  <Button
                    ref={cancelRef}
                    size="sm"
                    variant={canToggle ? "secondary" : "default"}
                    focusableWhenDisabled
                    disabled={runPending !== null}
                    onClick={() => setConfirming(true)}
                  >
                    {runPending === "cancel" ? pendingLabel.cancel : "Cancel"}
                  </Button>
                )}
              </div>
            )}
          </SurfaceFooter>
        )}

        {/* Only what needs the user, and run changes; never progress ticks. */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </Surface>
    </MotionConfig>
  )
}
