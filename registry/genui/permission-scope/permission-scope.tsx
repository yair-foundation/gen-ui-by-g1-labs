"use client"

import * as React from "react"
import { TriangleAlertIcon } from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { WhyDisabled } from "@/components/genui/hint"
import {
  genuiMotion,
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
} from "@/components/genui/surface"
import {
  CheckMark,
  genuiEase,
  genuiStepIn,
  SwapText,
} from "@/components/genui/genui-motion"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import type {
  PermissionDuration,
  PermissionRisk,
  PermissionScopeInput,
  PermissionScopeItem,
  PermissionScopeResult,
} from "./permission-scope.schema"

/** Explains a disabled button. Disabled controls swallow pointer events, so the span takes the hover. */
export type PermissionScopeStatus = "streaming" | "ready" | "granted" | "denied"

export type PermissionScopeProps = Partial<
  Omit<PermissionScopeInput, "scopes" | "durations">
> & {
  /** Scopes may be partial while the tool call is still streaming. */
  scopes?: Partial<PermissionScopeItem>[]
  durations?: PermissionDuration[]
  /**
   * Lifecycle, controlled by the host. Controls are disabled while
   * 'streaming'. When omitted, the component tracks the user's decision.
   */
  status?: PermissionScopeStatus
  /** Called once with { action: "grant" } or { action: "deny" }. */
  onResult?: (result: PermissionScopeResult) => void
  /** A decision from history. Restores the record and never calls onResult. */
  result?: PermissionScopeResult
  className?: string
}

/** The badge text, sentence case. */
const RISK_LABEL_SHORT: Record<PermissionRisk, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
}

const RISK_LABEL: Record<PermissionRisk, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
}

const DURATION_LABEL: Record<PermissionDuration, string> = {
  once: "This task",
  session: "This session",
  always: "Always",
}

/** How long a grant lasts, as the end of a sentence. */
const DURATION_PHRASE: Record<PermissionDuration, string> = {
  once: "for this task only",
  session: "until this session ends",
  always: "until you revoke it",
}

function isReady(s: Partial<PermissionScopeItem>): s is PermissionScopeItem {
  return (
    typeof s.id === "string" &&
    typeof s.label === "string" &&
    (s.risk === "low" || s.risk === "medium" || s.risk === "high")
  )
}

/** Ticked at the start: required always, otherwise as asked, high risk off. */
function startsTicked(s: PermissionScopeItem) {
  if (s.required) return true
  return s.granted ?? s.risk !== "high"
}

function ScopeRowSkeleton() {
  return (
    <li aria-hidden className="flex min-h-14 items-center gap-3 px-3">
      <Skeleton className="size-6 shrink-0 rounded-lg" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56" />
      </span>
    </li>
  )
}

/** The filled box of a checkbox, with a check that draws in. Purely visual. */
function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      data-checked={checked || undefined}
      className="flex size-6 shrink-0 items-center justify-center rounded-lg border border-border bg-transparent text-white transition-colors duration-200 data-checked:bg-choice dark:data-checked:border-transparent dark:data-checked:bg-choice"
    >
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            key="check"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ duration: 0.25, ease: genuiEase.spring }}
            className="flex"
          >
            <CheckMark />
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  )
}

export function PermissionScope({
  question,
  title,
  purpose,
  scopes = [],
  durations: durationsProp,
  duration: durationProp,
  status: statusProp,
  onResult,
  result,
  className,
}: PermissionScopeProps) {
  const [decision, setDecision] = React.useState<PermissionScopeResult | null>(
    result ?? null,
  )
  // The user's changes; untouched scopes keep their starting state.
  const [ticks, setTicks] = React.useState<Record<string, boolean>>(() => {
    if (result?.action !== "grant") return {}
    const restored: Record<string, boolean> = {}
    for (const s of scopes) {
      if (typeof s.id === "string")
        restored[s.id] = result.scopes.includes(s.id)
    }
    return restored
  })
  const [chosenDuration, setChosenDuration] =
    React.useState<PermissionDuration | null>(() =>
      result?.action === "grant" ? (result.duration ?? null) : null,
    )
  const [announcement, setAnnouncement] = React.useState("")
  const baseId = React.useId()
  const recordRef = React.useRef<HTMLParagraphElement>(null)
  const focusRecord = React.useRef(false)

  const status: PermissionScopeStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision.action === "grant"
        ? "granted"
        : "denied"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  React.useEffect(() => {
    if (decision && focusRecord.current) {
      focusRecord.current = false
      recordRef.current?.focus()
    }
  }, [decision])

  const ready = scopes.filter(isReady)
  const isTicked = (s: PermissionScopeItem) => {
    if (decision?.action === "deny") return false
    if (decision?.action === "grant") return decision.scopes.includes(s.id)
    if (s.required) return true
    return ticks[s.id] ?? startsTicked(s)
  }
  const ticked = ready.filter(isTicked)

  const durations = (
    durationsProp?.length ? durationsProp : ["once", "session"]
  ).filter(
    (d, i, all): d is PermissionDuration =>
      d in DURATION_LABEL && all.indexOf(d) === i,
  )
  const duration: PermissionDuration =
    chosenDuration && durations.includes(chosenDuration)
      ? chosenDuration
      : durationProp && durations.includes(durationProp)
        ? durationProp
        : (durations[0] ?? "once")

  const highTicked = ticked.filter((s) => s.risk === "high")
  const canAllow = !locked && ticked.length > 0

  const toggle = (s: PermissionScopeItem) => {
    if (locked || s.required) return
    const next = !isTicked(s)
    setTicks((prev) => ({ ...prev, [s.id]: next }))
    const count = ticked.length + (next ? 1 : -1)
    setAnnouncement(
      `${s.label} ${next ? "allowed" : "not allowed"}. ${count} of ${ready.length} selected.`,
    )
  }

  const decide = (next: PermissionScopeResult) => {
    if (locked) return
    focusRecord.current = true
    setDecision(next)
    setAnnouncement("")
    onResult?.(next)
  }

  const allow = () => {
    if (!canAllow) return
    decide({
      action: "grant",
      scopes: ticked.map((s) => s.id),
      duration,
    })
  }

  const record =
    decision?.action === "grant"
      ? `Allowed ${decision.scopes.length} of ${ready.length || decision.scopes.length}, ${DURATION_PHRASE[decision.duration ?? duration]}.`
      : decision
        ? "Denied. Nothing was shared."
        : null

  return (
    <MotionConfig reducedMotion="user">
      {question && (
        <h2 className={cn(genuiType.title, "mb-3 text-[16px]")}>{question}</h2>
      )}
      <Surface
        data-slot="permission-scope"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ? `Permissions: ${title}` : "Permission request"}
        className={className}
      >
        <SurfaceHeader>
          <SurfaceTitle>{title}</SurfaceTitle>
          {purpose && <p className={genuiType.meta}>{purpose}</p>}
        </SurfaceHeader>

        <div className="flex flex-col">
          <div className="flex flex-col gap-4 border-t border-border px-2 py-3">
            <fieldset className="min-w-0">
              <legend className="sr-only">Scopes requested</legend>
              <ul className="flex flex-col gap-0.5">
                {ready.map((s) => {
                  const checked = isTicked(s)
                  const descId = `${baseId}-${s.id}-desc`
                  return (
                    <motion.li
                      key={s.id}
                      data-slot="permission-scope-item"
                      data-risk={s.risk}
                      data-checked={checked || undefined}
                      {...genuiStepIn}
                    >
                      <label
                        className={cn(
                          "flex min-h-14 cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                          checked && "bg-accent",
                          !locked &&
                            !s.required &&
                            "hover:bg-muted dark:hover:bg-white/5",
                          (locked || s.required) && "cursor-default",
                          status === "denied" && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={locked}
                          aria-readonly={s.required || undefined}
                          aria-describedby={descId}
                          onChange={() => toggle(s)}
                          className="peer sr-only"
                        />
                        <CheckBox checked={checked} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span
                            className={cn(
                              genuiType.body,
                              "flex flex-wrap items-baseline gap-x-2 font-medium",
                            )}
                          >
                            {s.label}
                            {s.limit && (
                              <span className="font-medium tabular-nums">
                                {s.limit}
                              </span>
                            )}
                          </span>
                          <span id={descId} className={genuiType.meta}>
                            {[s.detail, s.required && "Required"]
                              .filter(Boolean)
                              .join(" · ")}
                            <span className="sr-only">
                              {s.detail || s.required ? ". " : ""}
                              {RISK_LABEL[s.risk]}
                            </span>
                          </span>
                        </span>
                        <Badge
                          aria-hidden
                          variant={
                            s.risk === "high"
                              ? "destructive"
                              : s.risk === "medium"
                                ? "warning"
                                : "info"
                          }
                        >
                          {RISK_LABEL_SHORT[s.risk]}
                        </Badge>
                      </label>
                    </motion.li>
                  )
                })}
                {streaming && <ScopeRowSkeleton />}
              </ul>
            </fieldset>

            {/* A high-risk grant gets one plain sentence on what it means. */}
            <AnimatePresence initial={false}>
              {!locked && highTicked.length > 0 && (
                <motion.div
                  key="high"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3, ease: genuiEase.emphasized }}
                  className="overflow-hidden"
                >
                  {/* A warning note: a hollow card holding an inset tinted box. */}
                  <div className="mx-1 rounded-[10px] border border-border p-1">
                    <div className="flex items-start gap-3 rounded-md bg-red-500/10 p-3 dark:bg-red-400/10">
                      <span
                        aria-hidden
                        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-600 dark:bg-red-400/15 dark:text-red-400"
                      >
                        <TriangleAlertIcon className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <p className="text-[15px] font-medium">
                          {highTicked.map((s) => s.label).join(" and ")}
                        </p>
                        <p className={genuiType.meta}>
                          {`The agent won't ask again before doing this, ${DURATION_PHRASE[duration]}.`}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {durations.length > 1 && ready.length > 0 && (
            <div
              role="radiogroup"
              aria-labelledby={`${baseId}-duration`}
              className="flex flex-col gap-2 border-t border-border px-3 py-3"
            >
              <span id={`${baseId}-duration`} className={genuiType.label}>
                Allow for
              </span>
              <div className="flex flex-wrap gap-2">
                {durations.map((d) => {
                  const selected = d === duration
                  return (
                    <label
                      key={d}
                      data-checked={selected || undefined}
                      className={cn(
                        genuiType.body,
                        "relative flex min-h-11 cursor-pointer items-center rounded-full border border-border bg-transparent px-4 data-checked:border-transparent data-checked:bg-accent font-medium transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 data-checked:text-foreground has-disabled:cursor-default",
                        !locked &&
                          !selected &&
                          "hover:bg-accent dark:hover:bg-white/5",
                      )}
                    >
                      <input
                        type="radio"
                        name={`${baseId}-duration`}
                        value={d}
                        checked={selected}
                        disabled={locked}
                        onChange={() => {
                          setChosenDuration(d)
                          setAnnouncement(`Allow ${DURATION_PHRASE[d]}.`)
                        }}
                        className="sr-only"
                      />
                      {selected && (
                        <motion.span
                          layoutId={`${baseId}-duration-ring`}
                          aria-hidden
                          className="absolute inset-0 rounded-full ring-2 ring-choice ring-inset"
                          transition={genuiMotion.snappy}
                        />
                      )}
                      <span className="relative">{DURATION_LABEL[d]}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <SurfaceFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          {record ? (
            <p
              ref={recordRef}
              tabIndex={-1}
              role="status"
              data-slot="permission-scope-record"
              className={cn(
                genuiType.body,
                "flex items-center gap-2 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                decision?.action === "deny" && "text-muted-foreground",
              )}
            >
              {decision?.action === "grant" && (
                <span className="flex size-5 items-center justify-center rounded-full bg-choice text-white">
                  <CheckMark className="size-3" />
                </span>
              )}
              {record}
            </p>
          ) : (
            <>
              <p className={cn(genuiType.meta, "min-h-5")} aria-hidden>
                {streaming ? (
                  <Skeleton className="h-4 w-40" />
                ) : ready.length === 0 ? null : ticked.length === 0 ? (
                  <motion.span
                    key="none"
                    className="block"
                    initial={{ opacity: 0, filter: "blur(2px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    transition={{ duration: 0.3, ease: genuiEase.easeOut }}
                  >
                    Nothing selected. Allow is off until you pick a scope.
                  </motion.span>
                ) : (
                  // The count rolls per digit; the duration phrase swaps.
                  <span className="flex flex-wrap items-baseline gap-x-1">
                    <SlidingNumber
                      number={ticked.length}
                      initiallyStable
                      className="tabular-nums"
                    />
                    <span>of {ready.length} allowed,</span>
                    <SwapText value={`${DURATION_PHRASE[duration]}.`} />
                  </span>
                )}
              </p>
              <div className="flex gap-2 sm:shrink-0">
                <Button
                  variant="secondary"
                  disabled={locked || ready.length === 0}
                  onClick={() => decide({ action: "deny" })}
                  className="min-h-11 flex-1 sm:flex-none"
                >
                  Deny all
                </Button>
                <WhyDisabled
                  when={!locked && ticked.length === 0}
                  reason="Select at least one permission"
                  className="flex-1 sm:flex-none"
                >
                  <Button
                    disabled={!canAllow}
                    onClick={allow}
                    className="min-h-11 flex-1 sm:flex-none"
                  >
                    {ticked.length === ready.length && ready.length > 1
                      ? "Allow all"
                      : "Allow selected"}
                    <span className="sr-only">
                      {` (${ticked.length} of ${ready.length})`}
                    </span>
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </Surface>
    </MotionConfig>
  )
}
