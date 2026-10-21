"use client"

import * as React from "react"
import {
  CheckIcon,
  RefreshCwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react"
import { MotionConfig } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Skeleton } from "@/components/genui/surface"
import { CheckMark } from "@/components/genui/genui-motion"

import {
  ratingRecord,
  resolveReasons,
  toggleReason,
} from "./answer-feedback-utils"
import type {
  AnswerFeedbackInput,
  AnswerFeedbackResult,
  FeedbackReason,
} from "./answer-feedback.schema"

export type AnswerFeedbackStatus = "streaming" | "ready"

export type AnswerFeedbackProps = Partial<
  Omit<AnswerFeedbackInput, "reasons">
> & {
  /** Reasons may be partial while the tool call streams. */
  reasons?: Partial<FeedbackReason>[]
  status?: AnswerFeedbackStatus
  /** Called with the rating (after the reasons, for a thumbs down) or a regenerate. */
  onResult?: (result: AnswerFeedbackResult) => void
  /** A result from history. Shows the record; never calls onResult. */
  result?: AnswerFeedbackResult
  className?: string
}

const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export function AnswerFeedback({
  answerId,
  reasons: reasonsProp,
  regenerate = false,
  status = "ready",
  onResult,
  result,
  className,
}: AnswerFeedbackProps) {
  const reasons = React.useMemo(
    () => resolveReasons(reasonsProp),
    [reasonsProp],
  )
  const restoredRating = result?.action === "rate" ? result : null

  const [asking, setAsking] = React.useState(false)
  const [selected, setSelected] = React.useState<string[]>([])
  const [rated, setRated] = React.useState<Extract<
    AnswerFeedbackResult,
    { action: "rate" }
  > | null>(restoredRating)
  const [regenerated, setRegenerated] = React.useState(
    result?.action === "regenerate",
  )
  const recordRef = React.useRef<HTMLParagraphElement>(null)
  const focusRecord = React.useRef(false)
  const downRef = React.useRef<HTMLButtonElement>(null)
  const reasonsId = React.useId()

  const streaming = status === "streaming"
  const locked = rated !== null

  React.useEffect(() => {
    if (rated && focusRecord.current) {
      focusRecord.current = false
      recordRef.current?.focus()
    }
  }, [rated])

  const send = (next: AnswerFeedbackResult) => {
    onResult?.(answerId ? { ...next, answerId } : next)
  }

  const rate = (next: Extract<AnswerFeedbackResult, { action: "rate" }>) => {
    focusRecord.current = true
    setAsking(false)
    setRated(next)
    send(next)
  }

  const closeAsking = () => {
    setAsking(false)
    requestAnimationFrame(() => downRef.current?.focus())
  }

  return (
    <MotionConfig reducedMotion="user">
      <section
        data-genui=""
        data-slot="answer-feedback"
        data-status={locked ? "rated" : status}
        aria-label="Rate this answer"
        aria-busy={streaming}
        className={cn("flex flex-col gap-2", className)}
      >
        <AutoHeight>
          <div className="flex flex-col gap-3">
            {streaming ? (
              <Skeleton className="h-9 w-28 rounded-full" />
            ) : locked && rated ? (
              <p
                ref={recordRef}
                tabIndex={-1}
                data-slot="answer-feedback-record"
                aria-live="polite"
                className={cn(
                  "flex items-center gap-1.5 text-[13px] text-muted-foreground",
                  focusRing,
                )}
              >
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {ratingRecord(rated, reasons)}
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-1">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Good answer"
                        onClick={() => rate({ action: "rate", rating: "up" })}
                        className="hover:bg-muted dark:hover:bg-white/10"
                      />
                    }
                  >
                    <ThumbsUpIcon />
                  </TooltipTrigger>
                  <TooltipContent>Good answer</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        ref={downRef}
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Bad answer"
                        aria-expanded={asking}
                        aria-controls={asking ? reasonsId : undefined}
                        onClick={() => setAsking((v) => !v)}
                        className="hover:bg-muted dark:hover:bg-white/10"
                      />
                    }
                  >
                    <ThumbsDownIcon />
                  </TooltipTrigger>
                  <TooltipContent>Bad answer</TooltipContent>
                </Tooltip>
                {regenerate && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Regenerate"
                          disabled={regenerated}
                          onClick={() => {
                            setRegenerated(true)
                            send({ action: "regenerate" })
                          }}
                          className="hover:bg-muted dark:hover:bg-white/10"
                        />
                      }
                    >
                      <RefreshCwIcon />
                    </TooltipTrigger>
                    <TooltipContent>Regenerate</TooltipContent>
                  </Tooltip>
                )}
              </div>
            )}

            {asking && !locked && (
              // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not form fields
              <div
                id={reasonsId}
                role="group"
                aria-label="What was wrong?"
                onKeyDown={(e) => {
                  if (e.key === "Escape") closeAsking()
                }}
                className="flex flex-col gap-2"
              >
                <p className="sr-only">What was wrong? Pick any, then send.</p>
                <ul className="flex flex-wrap gap-2">
                  {reasons.map((r) => {
                    const on = selected.includes(r.id)
                    return (
                      <li key={r.id}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() =>
                            setSelected((s) => toggleReason(s, r.id, reasons))
                          }
                          className={cn(
                            "inline-flex min-h-8 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] transition-colors",
                            focusRing,
                            on
                              ? "bg-accent text-foreground ring-1 ring-foreground/70"
                              : "border border-border bg-transparent hover:bg-accent dark:hover:bg-white/5",
                          )}
                        >
                          {r.label}
                          {on && <CheckMark />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={closeAsking}>
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    onClick={() =>
                      rate({
                        action: "rate",
                        rating: "down",
                        reasons: selected,
                      })
                    }
                  >
                    Send
                  </Button>
                </div>
              </div>
            )}
          </div>
        </AutoHeight>
      </section>
    </MotionConfig>
  )
}
