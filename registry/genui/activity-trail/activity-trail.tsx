"use client"

import * as React from "react"
import { ChevronDownIcon, ExternalLinkIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  Skeleton,
  Surface,
  genuiType,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import type { ActivityStep, ActivityTrailInput } from "./activity-trail.schema"
import { IconTip } from "@/components/genui/hint"

export type ActivityTrailStatus = "streaming" | "ready"

export type ActivityTrailProps = Partial<Omit<ActivityTrailInput, "steps">> & {
  /** Steps may be partial while the tool call streams. */
  steps?: Partial<ActivityStep>[]
  /** Lifecycle, controlled by the host. */
  status?: ActivityTrailStatus
  className?: string
}

type ReadyStep = Partial<ActivityStep> & { id: string; label: string }

const kindNames: Record<NonNullable<ActivityStep["kind"]>, string> = {
  search: "Search",
  read: "Read",
  tool: "Tool call",
  think: "Thinking",
  write: "Write",
}

/** "0.4s", "1.2s", "12s", "1m 5s". Short enough for a step row. */
export function formatDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) return ""
  if (ms < 100) return "<0.1s"
  if (ms < 10_000) {
    const s = Math.round(ms / 100) / 10
    return s >= 10 ? "10s" : `${s}s`
  }
  const total = Math.round(ms / 1000)
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return s ? `${m}m ${s}s` : `${m}m`
}

/** Spoken form for screen readers: "1.2 seconds", "1 minute 5 seconds". */
function spokenDuration(ms: number) {
  return formatDuration(ms)
    .replace("<", "under ")
    .replace(/(\d+)m/, (_, m) => `${m} ${m === "1" ? "minute" : "minutes"}`)
    .replace(/([\d.]+)s/, (_, s) => `${s} ${s === "1" ? "second" : "seconds"}`)
}

/** Only http(s) links are rendered as links; anything else is dropped. */
function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u : null
  } catch {
    return null
  }
}

/**
 * One line per step: what was done, then its outcome or source in quiet text.
 * The kind and duration are spoken, not shown; the label already says it.
 */
function StepRow({
  step,
  open,
  onToggle,
}: {
  step: ReadyStep
  /** Whether the step's input and output are shown. */
  open: boolean
  onToggle: () => void
}) {
  const state = step.status ?? "done"
  const failed = state === "error"
  const url = safeUrl(step.target?.url)
  const detailsId = React.useId()
  const hasDetails = hasStepDetails(step)

  return (
    <motion.li
      data-slot="activity-trail-step"
      data-state={state}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className={cn(genuiType.body, "py-1.5", failed && "text-destructive")}
    >
      <span className="sr-only">
        {kindNames[step.kind ?? "tool"]}
        {state === "running" ? ", in progress: " : failed ? ", failed: " : ": "}
      </span>
      {state === "running" ? (
        <ShimmeringText
          text={step.label}
          color="var(--muted-foreground)"
          shimmeringColor="var(--foreground)"
        />
      ) : (
        step.label
      )}
      {(step.detail || step.target) && (
        <span
          className={cn(
            genuiType.meta,
            "ml-2 inline",
            failed && "text-destructive",
          )}
        >
          {step.detail}
          {step.detail && step.target && <span aria-hidden> · </span>}
          {step.target &&
            (url ? (
              <a
                href={url.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex max-w-full items-center gap-1 rounded-sm align-bottom underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="truncate">{step.target.label}</span>
                <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              step.target.label
            ))}
        </span>
      )}
      {typeof step.durationMs === "number" && state !== "running" && (
        <span className="sr-only">{`, ${spokenDuration(step.durationMs)}`}</span>
      )}
      {hasDetails && (
        <IconTip label={`Details: ${step.label}`}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={detailsId}
            aria-label={`Details: ${step.label}`}
            onClick={onToggle}
            className={cn("relative", genuiHit, "ml-1 inline-flex size-6 items-center justify-center rounded-full align-middle text-muted-foreground outline-none hover:bg-muted hover:text-foreground dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-ring/50")}
          >
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        </IconTip>
      )}
      {hasDetails && (
        <div
          id={detailsId}
          hidden={!open}
          className="mt-1.5 flex flex-wrap gap-2"
        >
          {step.input && <StepText label="Given" text={step.input} />}
          {step.output && <StepText label="Returned" text={step.output} />}
        </div>
      )}
    </motion.li>
  )
}

/** A step the user can open: it carries an input or an output. */
export function hasStepDetails(step: Partial<ActivityStep>) {
  return Boolean(step.input?.trim() || step.output?.trim())
}

/**
 * A labelled block of plain text. Inputs and outputs are capped at 400 and
 * 600 characters, so it never needs to scroll (and isn't an extra tab stop).
 */
function StepText({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-[1_1_min(100%,16rem)] flex-col gap-1">
      <p className={genuiType.label}>{label}</p>
      <p className="rounded-[10px] border border-border bg-transparent px-3.5 py-2.5 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap">
        {text}
      </p>
    </div>
  )
}

/**
 * How long the trail has been working in this view, ticking each second while
 * `active`. Starts after mount, so server rendering stays deterministic; a
 * trail that arrives already finished never ticks.
 */
function useElapsed(active: boolean) {
  const [ms, setMs] = React.useState(0)
  const before = React.useRef(0)
  React.useEffect(() => {
    if (!active) return
    const start = Date.now()
    const timer = setInterval(
      () => setMs(before.current + Date.now() - start),
      1000,
    )
    return () => {
      clearInterval(timer)
      before.current += Date.now() - start
    }
  }, [active])
  return ms
}

export function ActivityTrail({
  title,
  steps = [],
  status: lifecycle = "ready",
  className,
}: ActivityTrailProps) {
  // Expanded by default; the user can still collapse the list.
  const [open, setOpen] = React.useState(true)
  // Steps whose input and output are open, by id.
  const [openSteps, setOpenSteps] = React.useState<Set<string>>(new Set())
  const listId = React.useId()
  const streaming = lifecycle === "streaming"

  const ready = steps.filter(
    (s): s is ReadyStep =>
      typeof s.id === "string" && typeof s.label === "string",
  )
  const running = ready.some((s) => s.status === "running")
  const failed = ready.filter((s) => s.status === "error").length
  const summedMs = ready.reduce(
    (sum, s) => sum + (typeof s.durationMs === "number" ? s.durationMs : 0),
    0,
  )
  const working = running || streaming
  const elapsedMs = useElapsed(working)
  // While working, the live clock; after, the steps' own durations (or the clock's last reading).
  const totalMs = working ? elapsedMs : summedMs > 0 ? summedMs : elapsedMs
  const detailed = ready.filter(hasStepDetails)
  const allOpen =
    detailed.length > 0 && detailed.every((s) => openSteps.has(s.id))
  const toggleStep = (id: string) =>
    setOpenSteps((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const count = `${ready.length} ${ready.length === 1 ? "step" : "steps"}`
  const summary = [
    count,
    totalMs > 0 ? formatDuration(totalMs) : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const spokenSummary = [
    count,
    totalMs > 0 ? spokenDuration(totalMs) : null,
    failed > 0 ? `${failed} failed` : null,
  ]
    .filter(Boolean)
    .join(", ")

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="activity-trail"
        data-status={lifecycle}
        aria-busy={working}
        aria-label={title ?? "Activity"}
        className={cn("flex flex-col", className)}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            onClick={() => setOpen((o) => !o)}
            className={cn(
              genuiType.body,
              "-mx-2 flex min-h-8 items-center gap-1.5 self-start rounded-full px-2 text-left text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          >
            {title && (
              <span className="font-medium text-foreground">{title}</span>
            )}
            {title && ready.length > 0 && <span aria-hidden>·</span>}
            {working ? (
              <span className="inline-flex items-center gap-1.5">
                <ShimmeringText
                  text="Working…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
                {ready.length > 0 && (
                  <span className="tabular-nums">
                    <span aria-hidden>· </span>
                    {summary}
                  </span>
                )}
              </span>
            ) : (
              <span className="tabular-nums">{summary}</span>
            )}
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
          {open && detailed.length >= 2 && (
            <button
              type="button"
              onClick={() =>
                setOpenSteps(
                  allOpen ? new Set() : new Set(detailed.map((s) => s.id)),
                )
              }
              className={cn(
                genuiType.meta,
                "min-h-8 shrink-0 rounded-full px-2.5 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              )}
            >
              {allOpen ? "Collapse all" : "Expand all"}
              <span className="sr-only"> step details</span>
            </button>
          )}
        </div>

        <AutoHeight>
          {/* Kept in the DOM while collapsed so aria-controls resolves. */}
          <ol
            id={listId}
            hidden={!open}
            className="flex flex-col border-t border-border px-3 py-3"
          >
            {ready.map((s) => (
              <StepRow
                key={s.id}
                step={s}
                open={openSteps.has(s.id)}
                onToggle={() => toggleStep(s.id)}
              />
            ))}
            {streaming && !running && (
              <li aria-hidden className="py-2">
                <Skeleton className="h-4 w-2/3" />
              </li>
            )}
          </ol>
        </AutoHeight>

        {/* Announces the outcome once, when the work finishes. */}
        <p aria-live="polite" className="sr-only">
          {!working && ready.length > 0 ? `Finished. ${spokenSummary}.` : ""}
        </p>
      </Surface>
    </MotionConfig>
  )
}
