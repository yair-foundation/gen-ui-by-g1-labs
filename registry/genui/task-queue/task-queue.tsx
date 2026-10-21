"use client"

import * as React from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  LoaderCircleIcon,
  PauseIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
  genuiType,
} from "@/components/genui/surface"
import {
  CheckMark,
  genuiEase,
  genuiStepIn,
} from "@/components/genui/genui-motion"

import type {
  QueueTask,
  QueueTaskState,
  TaskQueueInput,
  TaskQueueResult,
} from "./task-queue.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"

export type TaskQueueStatus = "streaming" | "ready"

export type TaskQueueProps = Partial<Omit<TaskQueueInput, "tasks">> & {
  /** Tasks may be partial while the tool call is still streaming. */
  tasks?: Partial<QueueTask>[]
  /** Lifecycle, controlled by the host. Controls are disabled while 'streaming'. */
  status?: TaskQueueStatus
  /** Called with approve, pause or cancel. The queue changes when the host sends new props. */
  onResult?: (result: TaskQueueResult) => void
  /** The last result from history. Restores it and never calls onResult. */
  result?: TaskQueueResult
  className?: string
}

type Command = "pause" | "cancel"
/** A command sent for a task, with the state the task had when it was sent. */
type Pending = Record<string, { action: Command; state: QueueTaskState }>

const focusRing = "outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const iconButton =
  "size-11 rounded-full text-muted-foreground hover:text-foreground"
/** The compact queue rows: a 36px target keeps them 44px tall. */
const rowButton =
  "size-9 rounded-full text-muted-foreground hover:text-foreground"

/** Off only for false, or the string a model may write for it. */
function on(value: unknown) {
  return value !== false && value !== "false"
}

function isReady(t: Partial<QueueTask>): t is QueueTask {
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    (t.state === "running" ||
      t.state === "waiting" ||
      t.state === "done" ||
      t.state === "failed")
  )
}

/** The user's order, kept in step with the tasks that are still waiting. */
function reconcile(order: string[] | null, waiting: string[]) {
  if (!order) return waiting
  const live = new Set(waiting)
  const kept = order.filter((id) => live.has(id))
  return [...kept, ...waiting.filter((id) => !kept.includes(id))]
}

function sameOrder(a: string[], b: string[]) {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

function initialPending(
  result: TaskQueueResult | undefined,
  tasks: Partial<QueueTask>[],
) {
  if (!result || result.action === "approve") return {}
  const task = tasks.find((t) => t.id === result.taskId)
  if (!task?.state) return {}
  return { [result.taskId]: { action: result.action, state: task.state } }
}

function Spinner() {
  return (
    <LoaderCircleIcon
      aria-hidden
      className="size-4 shrink-0 animate-spin text-foreground motion-reduce:animate-none"
    />
  )
}

export function TaskQueue({
  title,
  tasks = [],
  note,
  canReorder: canReorderProp,
  canPause: canPauseProp,
  canCancel: canCancelProp,
  approveLabel,
  status = "ready",
  onResult,
  result,
  className,
}: TaskQueueProps) {
  const [order, setOrder] = React.useState<string[] | null>(() =>
    result?.action === "approve" ? result.order : null,
  )
  const [approved, setApproved] = React.useState(result?.action === "approve")
  const [pending, setPending] = React.useState<Pending>(() =>
    initialPending(result, tasks),
  )
  const [doneOpen, setDoneOpen] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const moveRefs = React.useRef(new Map<string, HTMLButtonElement | null>())
  const focusAfterMove = React.useRef<{
    id: string
    dir: "up" | "down"
  } | null>(null)
  const recordRef = React.useRef<HTMLParagraphElement>(null)
  const doneId = React.useId()

  const streaming = status === "streaming"
  const fromHistory = result !== undefined
  const canReorder = on(canReorderProp)
  const canPause = on(canPauseProp)
  const canCancel = on(canCancelProp)

  const ready = tasks.filter(isReady)
  const byId = new Map(ready.map((t) => [t.id, t]))
  const running = ready.filter((t) => t.state === "running")
  const failed = ready.filter((t) => t.state === "failed")
  const done = ready.filter((t) => t.state === "done")
  const propOrder = ready.filter((t) => t.state === "waiting").map((t) => t.id)
  const waiting = reconcile(order, propOrder)
  const changed = !sameOrder(waiting, propOrder)

  /** A command counts as pending until the task's state changes. */
  const pendingFor = (task: QueueTask) => {
    const p = pending[task.id]
    return p && p.state === task.state ? p.action : null
  }
  const runOrder = waiting.filter((id) => {
    const t = byId.get(id)
    return t && pendingFor(t) !== "cancel"
  })

  const reorderable = canReorder && !approved && !streaming && !fromHistory
  const commandable = !streaming && !fromHistory

  React.useLayoutEffect(() => {
    const target = focusAfterMove.current
    if (!target) return
    focusAfterMove.current = null
    const el = moveRefs.current.get(`${target.id}:${target.dir}`)
    const other = moveRefs.current.get(
      `${target.id}:${target.dir === "up" ? "down" : "up"}`,
    )
    if (el && !el.disabled) el.focus()
    else other?.focus()
  })

  const move = (id: string, delta: -1 | 1) => {
    const from = waiting.indexOf(id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= waiting.length) return
    const next = [...waiting]
    next.splice(from, 1)
    next.splice(to, 0, id)
    setOrder(next)
    focusAfterMove.current = { id, dir: delta < 0 ? "up" : "down" }
    setAnnouncement(
      `${byId.get(id)?.title ?? "Task"} moved to position ${to + 1} of ${next.length}.`,
    )
  }

  const reset = () => {
    setOrder(null)
    setAnnouncement("Order reset.")
  }

  const command = (task: QueueTask, action: Command) => {
    if (!commandable || pendingFor(task)) return
    setPending((p) => ({ ...p, [task.id]: { action, state: task.state } }))
    setAnnouncement(
      `${action === "pause" ? "Pausing" : "Cancelling"} ${task.title}.`,
    )
    onResult?.({ action, taskId: task.id })
  }

  const approve = () => {
    if (!commandable || approved) return
    setApproved(true)
    setOrder(waiting)
    onResult?.({ action: "approve", order: runOrder })
    requestAnimationFrame(() => recordRef.current?.focus())
  }

  const empty = streaming && ready.length === 0
  const allClear = !streaming && running.length === 0 && waiting.length === 0

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="task-queue"
        data-status={approved ? "approved" : status}
        aria-busy={streaming}
        aria-label={title ?? "Task queue"}
        className={className}
      >
        <div className="flex flex-col">
          {/* Title and the finished count. */}
          <SurfaceHeader>
            <div className="flex items-center justify-between gap-4">
              {title ? (
                <SurfaceTitle>{title}</SurfaceTitle>
              ) : (
                <Skeleton className="h-5 w-44" />
              )}
              {done.length > 0 && (
                <Badge variant="success" className="text-[13px] tabular-nums">
                  <SlidingNumber number={done.length} initiallyStable /> done
                </Badge>
              )}
            </div>
          </SurfaceHeader>

          {/* Working now. */}
          <div className="flex flex-col gap-4 border-t border-border px-3 py-3 empty:hidden">
            <AnimatePresence initial={false}>
              {running.map((task) => {
                const p = pendingFor(task)
                const pct =
                  typeof task.progress === "number"
                    ? Math.round(Math.min(1, Math.max(0, task.progress)) * 100)
                    : null
                return (
                  <motion.section
                    key={task.id}
                    aria-label={`Running: ${task.title}`}
                    {...genuiStepIn}
                    exit={{ opacity: 0, transition: genuiMotion.fade }}
                    className="flex flex-col gap-2.5 rounded-[10px] border border-border bg-transparent px-4 py-3"
                  >
                    <div className="flex items-center gap-3">
                      <Spinner />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className={cn(genuiType.label, "text-[13px]")}>
                          Working now
                        </span>
                        <span className={cn(genuiType.title, "truncate")}>
                          {task.title}
                        </span>
                        {task.detail && (
                          <span className={cn(genuiType.meta, "truncate")}>
                            {task.detail}
                          </span>
                        )}
                      </div>
                      {p ? (
                        <span className={cn(genuiType.meta, "shrink-0")}>
                          {p === "pause" ? "Pausing…" : "Cancelling…"}
                        </span>
                      ) : (
                        <div className="flex shrink-0 items-center">
                          {canPause && (
                            <IconTip label="Pause">
                              <Button
                                variant="ghost"
                                size="icon-lg"
                                className={iconButton}
                                aria-label={`Pause ${task.title}`}
                                disabled={!commandable}
                                onClick={() => command(task, "pause")}
                              >
                                <PauseIcon />
                              </Button>
                            </IconTip>
                          )}
                          {canCancel && (
                            <IconTip label="Cancel">
                              <Button
                                variant="ghost"
                                size="icon-lg"
                                className={iconButton}
                                aria-label={`Cancel ${task.title}`}
                                disabled={!commandable}
                                onClick={() => command(task, "cancel")}
                              >
                                <XIcon />
                              </Button>
                            </IconTip>
                          )}
                        </div>
                      )}
                    </div>
                    {pct !== null && (
                      <div
                        role="progressbar"
                        aria-label={`${task.title} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        className="h-1 overflow-hidden rounded-full bg-background/70 dark:bg-white/15"
                      >
                        <motion.div
                          className="h-full rounded-full bg-sky-500 dark:bg-sky-400"
                          initial={false}
                          animate={{ width: `${pct}%` }}
                          transition={genuiMotion.gentle}
                        />
                      </div>
                    )}
                  </motion.section>
                )
              })}
            </AnimatePresence>

            {allClear && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3, ease: genuiEase.easeOut }}
                className="flex items-center gap-3 rounded-[10px] border border-border bg-transparent px-4 py-3"
              >
                <span className="flex size-6 items-center justify-center rounded-full bg-background">
                  <CheckMark delay={0.1} />
                </span>
                <span className={genuiType.title}>Queue clear</span>
              </motion.div>
            )}

            {empty && (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16 w-full rounded-[10px]" />
                <Skeleton className="h-12 w-full rounded-[10px]" />
              </div>
            )}
          </div>

          {/* Up next, in run order. */}
          {waiting.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
              <h4 className={genuiType.label} id={`${doneId}-next`}>
                Up next
              </h4>
              <ScrollFade
                className="-m-1"
                viewportClassName="overflow-y-auto p-1"
              >
                <ol
                  aria-labelledby={`${doneId}-next`}
                  className="flex flex-col gap-1.5"
                >
                  {waiting.map((id, index) => {
                    const task = byId.get(id)
                    if (!task) return null
                    const p = pendingFor(task)
                    const position = `${index + 1} of ${waiting.length}`
                    return (
                      <motion.li
                        key={id}
                        layout="position"
                        transition={{ layout: genuiMotion.gentle }}
                        initial={genuiStepIn.initial}
                        animate={genuiStepIn.animate}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-[10px] border border-border bg-transparent py-1 pr-1.5 pl-3 transition-opacity",
                          p === "cancel" && "opacity-50",
                        )}
                      >
                        <span
                          aria-hidden
                          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-background text-[13px] font-semibold tabular-nums text-muted-foreground"
                        >
                          <SlidingNumber number={index + 1} initiallyStable />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span
                            className={cn(
                              genuiType.body,
                              "truncate font-medium",
                              p === "cancel" && "line-through",
                            )}
                          >
                            <span className="sr-only">{position}: </span>
                            {task.title}
                          </span>
                          {task.detail && (
                            <span className={cn(genuiType.meta, "truncate")}>
                              {task.detail}
                            </span>
                          )}
                        </div>
                        {p ? (
                          <span className={cn(genuiType.meta, "shrink-0 pr-3")}>
                            Cancelling…
                          </span>
                        ) : (
                          <div className="flex shrink-0 items-center">
                            {canReorder && !approved && (
                              <>
                                <WhyDisabled
                                  reason={
                                    reorderable && index === 0
                                      ? "Already first"
                                      : undefined
                                  }
                                >
                                  <IconTip label="Move up">
                                    <Button
                                      ref={(el) => {
                                        moveRefs.current.set(`${id}:up`, el)
                                      }}
                                      variant="ghost"
                                      size="icon-lg"
                                      className={rowButton}
                                      aria-label={`Move ${task.title} up, now ${position}`}
                                      disabled={!reorderable || index === 0}
                                      onClick={() => move(id, -1)}
                                    >
                                      <ChevronUpIcon />
                                    </Button>
                                  </IconTip>
                                </WhyDisabled>
                                <WhyDisabled
                                  reason={
                                    reorderable && index === waiting.length - 1
                                      ? "Already last"
                                      : undefined
                                  }
                                >
                                  <IconTip label="Move down">
                                    <Button
                                      ref={(el) => {
                                        moveRefs.current.set(`${id}:down`, el)
                                      }}
                                      variant="ghost"
                                      size="icon-lg"
                                      className={rowButton}
                                      aria-label={`Move ${task.title} down, now ${position}`}
                                      disabled={
                                        !reorderable ||
                                        index === waiting.length - 1
                                      }
                                      onClick={() => move(id, 1)}
                                    >
                                      <ChevronDownIcon />
                                    </Button>
                                  </IconTip>
                                </WhyDisabled>
                              </>
                            )}
                            {canCancel && (
                              <IconTip label="Cancel">
                                <Button
                                  variant="ghost"
                                  size="icon-lg"
                                  className={rowButton}
                                  aria-label={`Cancel ${task.title}`}
                                  disabled={!commandable}
                                  onClick={() => command(task, "cancel")}
                                >
                                  <XIcon />
                                </Button>
                              </IconTip>
                            )}
                          </div>
                        )}
                      </motion.li>
                    )
                  })}
                </ol>
              </ScrollFade>
            </div>
          )}

          {/* Failed tasks stay in view; done ones fold away. */}
          {failed.length > 0 && (
            <ul
              aria-label="Failed"
              className="flex flex-col gap-2 border-t border-border px-3 py-3"
            >
              {failed.map((task) => (
                <motion.li
                  key={task.id}
                  {...genuiStepIn}
                  className="flex items-start gap-3 px-1"
                >
                  <XIcon
                    aria-hidden
                    className="mt-0.5 size-4 shrink-0 text-destructive"
                  />
                  <div className="flex min-w-0 flex-col">
                    <span className={genuiType.body}>
                      <span className="sr-only">Failed: </span>
                      {task.title}
                    </span>
                    {task.error && (
                      <span className={cn(genuiType.meta, "text-destructive")}>
                        {task.error}
                      </span>
                    )}
                  </div>
                </motion.li>
              ))}
            </ul>
          )}

          {done.length > 0 && (
            <div className="flex flex-col border-t border-border px-3 py-1">
              <button
                type="button"
                aria-expanded={doneOpen}
                aria-controls={doneId}
                onClick={() => setDoneOpen((v) => !v)}
                className={cn(
                  "-mx-3 flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  focusRing,
                )}
              >
                Finished
                <span className="font-normal tabular-nums">
                  · {done.length}
                </span>
                <motion.span
                  aria-hidden
                  animate={{ rotate: doneOpen ? 180 : 0 }}
                  transition={genuiMotion.snappy}
                  className="ml-auto flex"
                >
                  <ChevronDownIcon className="size-4" />
                </motion.span>
              </button>
              <AnimatePresence initial={false}>
                {doneOpen && (
                  <motion.ul
                    id={doneId}
                    key="done"
                    aria-label="Finished"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: genuiEase.emphasized }}
                    className="flex flex-wrap gap-x-4 gap-y-1.5 overflow-hidden pt-1"
                  >
                    {done.map((task) => (
                      <li
                        key={task.id}
                        style={{ flex: "1 1 min(100%, 16rem)" }}
                        className="flex min-w-0 items-center gap-3 px-1 py-1"
                      >
                        <CheckIcon
                          aria-hidden
                          className="size-4 shrink-0 text-muted-foreground"
                        />
                        <span
                          className={cn(
                            genuiType.body,
                            "truncate text-muted-foreground",
                          )}
                        >
                          {task.title}
                        </span>
                      </li>
                    ))}
                  </motion.ul>
                )}
              </AnimatePresence>
            </div>
          )}

          {note && !(waiting.length > 0 || approved) && (
            <p
              className={cn(genuiType.meta, "border-t border-border px-3 py-3")}
            >
              {note}
            </p>
          )}
        </div>

        {/* Approve the order. */}
        {(waiting.length > 0 || approved) && (
          <SurfaceFooter className="min-h-[68px] justify-between">
            {approved ? (
              <>
                <p
                  ref={recordRef}
                  tabIndex={-1}
                  data-slot="task-queue-record"
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-full text-[13px] text-muted-foreground",
                    focusRing,
                  )}
                >
                  <CheckMark className="size-4 text-foreground" />
                  Order approved
                </p>
                {note && (
                  <p className={cn(genuiType.meta, "min-w-0 flex-1 px-2")}>
                    {note}
                  </p>
                )}
              </>
            ) : (
              <>
                <WhyDisabled
                  when={!streaming && !fromHistory && runOrder.length === 0}
                  reason="Nothing to approve"
                >
                  <Button
                    size="lg"
                    disabled={streaming || fromHistory || runOrder.length === 0}
                    onClick={approve}
                  >
                    {approveLabel || "Approve order"}
                  </Button>
                </WhyDisabled>
                {note && (
                  <p className={cn(genuiType.meta, "min-w-0 flex-1 px-2")}>
                    {note}
                  </p>
                )}
                <AnimatePresence initial={false}>
                  {changed && reorderable && (
                    <motion.span
                      key="reset"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={genuiMotion.fade}
                    >
                      <Button size="lg" variant="ghost" onClick={reset}>
                        <RotateCcwIcon data-icon="inline-start" />
                        Reset order
                      </Button>
                    </motion.span>
                  )}
                </AnimatePresence>
              </>
            )}
          </SurfaceFooter>
        )}

        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </Surface>
    </MotionConfig>
  )
}
