"use client"

import * as React from "react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
} from "@/components/genui/surface"
import {
  CheckMark,
  RadioMark,
  SwapText,
  genuiEase,
  genuiStepIn,
} from "@/components/genui/genui-motion"

import type {
  CheckpointInput,
  CheckpointItem,
  CheckpointResult,
} from "./checkpoint.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"

export type CheckpointStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "restored"
  | "continued"

export type CheckpointProps = Partial<Omit<CheckpointInput, "checkpoints">> & {
  /** Checkpoints may be partial while the tool call is still streaming. */
  checkpoints?: Partial<CheckpointItem>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host acts on the choice.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: CheckpointStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: CheckpointResult) => void
  /** A decision from history. Renders the record and never calls onResult. */
  result?: CheckpointResult
  className?: string
}

const isReady = (c: Partial<CheckpointItem>): c is CheckpointItem =>
  typeof c.id === "string" &&
  typeof c.label === "string" &&
  typeof c.time === "string"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** The neutral tag on the checkpoint the run is at. */
function CurrentChip() {
  return (
    <Badge variant="info" className="shrink-0 text-[13px]">
      Current
    </Badge>
  )
}

export function Checkpoint({
  title,
  checkpoints = [],
  currentId,
  caveat,
  continueLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: CheckpointProps) {
  const [final, setFinal] = React.useState<CheckpointResult | null>(
    result ?? null,
  )
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [confirming, setConfirming] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const baseId = React.useId()
  const titleId = `${baseId}-title`
  const confirmId = `${baseId}-confirm`
  const confirmRef = React.useRef<HTMLDivElement>(null)
  const primaryRef = React.useRef<HTMLButtonElement>(null)

  const decision = final
    ? final.action === "restore"
      ? "restored"
      : "continued"
    : null
  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: CheckpointStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const done = status === "restored" || status === "continued"
  const interactive = status === "ready"

  const ready = checkpoints.filter(isReady)
  const currentIndex = Math.max(
    0,
    currentId !== undefined
      ? ready.findIndex((c) => c.id === currentId)
      : ready.length - 1,
  )
  const current = ready[currentIndex]
  const restoredIndex =
    final?.action === "restore"
      ? ready.findIndex((c) => c.id === final.checkpointId)
      : -1

  const selectedIndex = (() => {
    const i = ready.findIndex((c) => c.id === selectedId)
    return i === -1 ? currentIndex : i
  })()
  const selected = ready[selectedIndex]
  const undoCount = Math.max(0, currentIndex - selectedIndex)
  const restoring = Boolean(selected) && selectedIndex < currentIndex

  // After a restore, everything later than the target is gone from the list.
  const visible =
    done && restoredIndex >= 0 ? ready.slice(0, restoredIndex + 1) : ready
  const markedIndex = done && restoredIndex >= 0 ? restoredIndex : currentIndex

  React.useEffect(() => {
    if (confirming) confirmRef.current?.focus()
  }, [confirming])

  const select = (c: CheckpointItem, i: number) => {
    setSelectedId(c.id)
    setConfirming(false)
    const n = currentIndex - i
    setAnnouncement(
      n > 0
        ? `${c.label} selected. Restoring undoes ${plural(n, "later checkpoint")}.`
        : `${c.label} selected. This is the current state.`,
    )
  }

  const finish = (r: CheckpointResult) => {
    setFinal(r)
    setConfirming(false)
    // History results are restored, never re-sent.
    if (!result) onResult?.(r)
  }

  const primary = () => {
    if (!interactive || !selected) return
    if (restoring) {
      setConfirming(true)
      return
    }
    finish({ action: "continue" })
  }

  const back = () => {
    setConfirming(false)
    requestAnimationFrame(() => primaryRef.current?.focus())
  }

  const recordText = (() => {
    if (!final) return ""
    if (final.action === "continue")
      return current ? `Continued from “${current.label}”.` : "Continued."
    const target = ready[restoredIndex]
    const undone = Math.max(0, currentIndex - restoredIndex)
    return target
      ? `Restored to “${target.label}” · ${plural(undone, "checkpoint")} undone.`
      : "Restored."
  })()

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="checkpoint"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Checkpoints"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
        </SurfaceHeader>

        <ScrollFade
          className="max-h-[400px] border-t border-border"
          viewportClassName="px-3 py-3"
        >
        <div
          {...(done
            ? {}
            : {
                role: "radiogroup",
                "aria-labelledby": title ? titleId : undefined,
                "aria-label": title ? undefined : "Checkpoints",
              })}
        >
          <ol className="flex flex-col">
            <AnimatePresence initial={false}>
              {visible.map((c, i) => {
                const isCurrent = i === markedIndex
                const isSelected = !done && i === selectedIndex
                // Rows a restore would undo, while a past checkpoint is selected.
                const undone = !done && restoring && i > selectedIndex
                const last = i === visible.length - 1
                // A label around the radio while choosing; plain once decided.
                const Row = done ? "div" : "label"
                return (
                  <motion.li
                    key={c.id}
                    initial={genuiStepIn.initial}
                    animate={genuiStepIn.animate}
                    exit={{
                      opacity: 0,
                      height: 0,
                      transition: {
                        duration: 0.35,
                        ease: genuiEase.emphasized,
                      },
                    }}
                    transition={genuiStepIn.transition}
                    className="relative overflow-hidden"
                  >
                    {/* Rail between this mark and the next. */}
                    {!last && (
                      <span
                        aria-hidden
                        className="absolute top-[42px] -bottom-[6px] left-[20px] w-px -translate-x-1/2 bg-border"
                      />
                    )}
                    <Row
                      className={cn(
                        "flex min-h-11 items-start gap-3 rounded-[10px] px-2 py-2.5 transition-[opacity,background-color] duration-300",
                        !done &&
                          "cursor-pointer has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-default",
                        !done &&
                          !isSelected &&
                          "hover:bg-muted has-disabled:hover:bg-transparent",
                        undone && "opacity-45",
                      )}
                    >
                      {done ? (
                        <span
                          aria-hidden
                          className="flex size-6 shrink-0 items-center justify-center"
                        >
                          <span
                            className={cn(
                              "rounded-full transition-all",
                              isCurrent
                                ? "size-2.5 bg-foreground"
                                : "size-2 bg-muted-foreground/50",
                            )}
                          />
                        </span>
                      ) : (
                        <>
                          <input
                            type="radio"
                            name={baseId}
                            value={c.id}
                            checked={isSelected}
                            disabled={!interactive}
                            onChange={() => select(c, i)}
                            className="sr-only"
                          />
                          <RadioMark checked={isSelected} />
                        </>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              genuiType.body,
                              "min-w-0 truncate",
                              isCurrent
                                ? "font-semibold"
                                : "font-medium text-foreground/80",
                            )}
                          >
                            {c.label}
                          </span>
                          {isCurrent && <CurrentChip />}
                          <span
                            className={cn(
                              genuiType.meta,
                              "ml-auto shrink-0 tabular-nums",
                            )}
                          >
                            <span className="sr-only">, saved at </span>
                            {c.time}
                          </span>
                        </span>
                        {c.change && (
                          <span className={cn(genuiType.meta, "break-words")}>
                            <span className="sr-only">, </span>
                            {c.change}
                          </span>
                        )}
                        {undone && (
                          <span className="sr-only">, would be undone</span>
                        )}
                      </span>
                    </Row>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ol>
          {streaming && ready.length < 2 && (
            <div className="flex flex-col gap-3 px-2 py-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-4/5" />
            </div>
          )}
        </div>
        </ScrollFade>

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <SurfaceFooter aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {done ? (
              <motion.p
                key="record"
                {...genuiStepIn}
                className={cn(genuiType.body, "flex items-center gap-2")}
              >
                <CheckMark className="size-4 shrink-0" />
                {recordText}
              </motion.p>
            ) : confirming && selected ? (
              <motion.div
                key="confirm"
                ref={confirmRef}
                tabIndex={-1}
                role="group"
                aria-labelledby={confirmId}
                onKeyDown={(e) => {
                  if (e.key === "Escape") back()
                }}
                {...genuiStepIn}
                className="flex w-full flex-col gap-3 outline-none"
              >
                <div className="flex flex-col gap-0.5">
                  <p
                    id={confirmId}
                    className={cn(genuiType.body, "font-medium")}
                  >
                    {`Go back to “${selected.label}”? This undoes ${plural(undoCount, "later checkpoint")}.`}
                  </p>
                  {caveat && <p className={genuiType.meta}>{caveat}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    variant="secondary"
                    className="h-11 px-3"
                    onClick={back}
                  >
                    Back
                  </Button>
                  <Button
                    className="h-11 px-3"
                    onClick={() =>
                      finish({ action: "restore", checkpointId: selected.id })
                    }
                  >
                    Restore
                  </Button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="actions"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, ease: genuiEase.easeOut }}
                className="ml-auto flex"
              >
                <WhyDisabled reason={interactive && !selected && "Pick a checkpoint first"}>
                  <Button
                    ref={primaryRef}
                    className="h-11 px-3"
                    disabled={!interactive || !selected}
                    onClick={primary}
                  >
                    {status === "submitting" ? (
                      "Working…"
                    ) : (
                      <SwapText
                        value={
                          restoring ? "Restore…" : (continueLabel ?? "Continue")
                        }
                      />
                    )}
                  </Button>
                </WhyDisabled>
              </motion.div>
            )}
          </AnimatePresence>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
