"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  AlertTriangleIcon,
  CheckIcon,
  GripVerticalIcon,
  HandIcon,
  MessageSquareIcon,
  OctagonAlertIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"
import { LayoutGroup, MotionConfig, motion, useMotionValue } from "motion/react"

import { cn } from "@/lib/utils"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import {
  type DependencyIssue,
  type PlanItem,
  addStep,
  countChanges,
  describeIssue,
  diffPlan,
  editStep,
  estimateLabel,
  findDependencyIssues,
  fromResultSteps,
  indexFromMidpoints,
  liveSteps,
  livePosition,
  moveStep,
  moveStepBy,
  removeStep,
  restoreStep,
  setStepEnabled,
  toPlanItems,
  toResultSteps,
  uniqueStepId,
} from "./plan-review-utils"
import type {
  PlanReviewInput,
  PlanReviewResult,
  PlanStep,
} from "./plan-review.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type PlanReviewStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "approved"
  | "revised"
  | "dismissed"

export type PlanReviewProps = Partial<
  Omit<PlanReviewInput, "steps" | "assumptions">
> & {
  /** Steps and assumptions may be partial while the tool call streams. */
  steps?: Partial<PlanStep>[]
  assumptions?: (string | undefined)[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host starts the run.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: PlanReviewStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: PlanReviewResult) => void
  /**
   * A decision from history. Restores the approved plan read-only (or the
   * request for changes) and never calls onResult.
   */
  result?: PlanReviewResult
  className?: string
}

/** Most steps a plan can hold, the agent's and the user's together. */
const MAX_STEPS = 20
/** Pointer travel (px) before pressing the handle becomes a drag. */
const DRAG_SLOP = 4
const ASSUMPTIONS_PREFIX = "About the assumptions: "

type PointerDrag = {
  id: string
  pointerId: number
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  width: number
  active: boolean
  userSelect: string
}

function DropLine({ edge }: { edge: "before" | "after" }) {
  return (
    <span
      aria-hidden
      data-slot="plan-review-drop-indicator"
      className={cn(
        "pointer-events-none absolute inset-x-2 z-20 h-0.5 rounded-full bg-primary",
        edge === "before" ? "-top-px" : "-bottom-px",
      )}
    />
  )
}

/** Inline title + description editor, shared by "Edit" and "Add a step". */
function StepForm({
  initialTitle = "",
  initialDescription = "",
  titleLabel,
  descriptionLabel,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initialTitle?: string
  initialDescription?: string
  titleLabel: string
  descriptionLabel: string
  submitLabel: string
  onSubmit: (title: string, description: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = React.useState(initialTitle)
  const [description, setDescription] = React.useState(initialDescription)
  const submit = () => {
    if (title.trim()) onSubmit(title, description)
  }
  return (
    <div className="flex w-full flex-col gap-2">
      <Input
        autoFocus
        aria-label={titleLabel}
        placeholder="Step title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            submit()
          }
          if (e.key === "Escape") onCancel()
        }}
      />
      <Textarea
        aria-label={descriptionLabel}
        placeholder="Details (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit()
          if (e.key === "Escape") onCancel()
        }}
        className="min-h-16"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <WhyDisabled when={!title.trim()} reason="Add a title first">
          <Button size="sm" onClick={submit} disabled={!title.trim()}>
            {submitLabel}
          </Button>
        </WhyDisabled>
      </div>
    </div>
  )
}

/**
 * Risk, approval pause, optional and the user's changes. Tools and the
 * per-step estimate are read to screen readers only; the header sums time.
 */
function StepMeta({
  step,
  item,
  moved,
  edited,
}: {
  step: Partial<PlanStep> | undefined
  item: PlanItem
  moved: boolean
  edited: boolean
}) {
  const tools = [...new Set(step?.tools ?? [])].filter(Boolean)
  const notes = [
    item.addedByUser && "Added by you",
    moved && "Moved",
    edited && "Edited",
  ].filter((n): n is string => Boolean(n))
  const visible =
    (step?.risk && step.risk !== "low") ||
    step?.requiresApproval ||
    step?.optional ||
    notes.length > 0
  return (
    <>
      {(tools.length > 0 || step?.estimate) && (
        <span className="sr-only">
          {tools.length > 0 && `Uses ${tools.join(", ")}. `}
          {step?.estimate && `Takes ${step.estimate}.`}
        </span>
      )}
      {visible && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-4 text-muted-foreground">
          {step?.risk === "medium" && (
            <Badge variant="warning" className="h-5">
              <AlertTriangleIcon aria-hidden />
              Medium risk
            </Badge>
          )}
          {step?.risk === "high" && (
            <Badge variant="destructive" className="h-5">
              <OctagonAlertIcon aria-hidden />
              High risk
            </Badge>
          )}
          {step?.requiresApproval && (
            <span className="inline-flex items-center gap-1 text-foreground">
              <HandIcon aria-hidden className="size-3.5" />
              Pauses for approval
            </span>
          )}
          {step?.optional && (
            <span>{item.enabled ? "Optional" : "Skipped"}</span>
          )}
          {notes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      )}
    </>
  )
}

export function PlanReview({
  title,
  goal,
  steps = [],
  assumptions = [],
  totalEstimate,
  editable = true,
  allowAdd = true,
  status: statusProp,
  onResult,
  result,
  className,
}: PlanReviewProps) {
  const groupId = React.useId()
  const instructionsId = React.useId()
  const rootRef = React.useRef<HTMLElement>(null)
  const listRef = React.useRef<HTMLOListElement>(null)

  // ---- Data (may be partial while streaming) ----
  const readySteps: PlanStep[] = []
  const seenIds = new Set<string>()
  for (const s of steps) {
    if (typeof s.id !== "string" || !s.title || seenIds.has(s.id)) continue
    seenIds.add(s.id)
    readySteps.push(s as PlanStep)
  }
  const stepById = new Map(readySteps.map((s) => [s.id, s]))
  const original = toPlanItems(readySteps)
  const dependsOn = Object.fromEntries(
    readySteps.map((s) => [s.id, s.dependsOn]),
  )
  const readyAssumptions = assumptions
    .filter((a): a is string => typeof a === "string" && a.trim() !== "")
    .slice(0, 5)

  // ---- State ----
  const [items, setItems] = React.useState<PlanItem[] | null>(null)
  const [decision, setDecision] = React.useState<
    "approved" | "revised" | "dismissed" | null
  >(null)
  const [revising, setRevising] = React.useState(false)
  const [feedback, setFeedback] = React.useState(
    result?.action === "revise" ? result.feedback : "",
  )
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [adding, setAdding] = React.useState(false)
  const [held, setHeld] = React.useState<{
    id: string
    snapshot: PlanItem[]
  } | null>(null)
  const [drag, setDrag] = React.useState<{ id: string; width: number } | null>(
    null,
  )
  const [target, setTarget] = React.useState<number | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const [focusKey, setFocusKey] = React.useState<string | null>(null)

  const restored = result
    ? (
        {
          approve: "approved",
          revise: "revised",
          dismiss: "dismissed",
        } as const
      )[result.action]
    : null
  const decided = restored ?? decision

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: PlanReviewStatus =
    decided && (statusProp === undefined || statusProp === "ready")
      ? decided
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"
  const canEdit = editable && !locked
  // Controls show (disabled) while streaming, so nothing shifts when ready.
  const showControls = editable && (status === "ready" || streaming)

  // ---- The plan on screen ----
  let current: PlanItem[]
  if (result?.action === "approve") {
    current = fromResultSteps(result.steps)
  } else if (status === "revised" || status === "dismissed") {
    // Nothing was approved, so show the plan as proposed.
    current = original
  } else {
    current = items ?? original
  }

  const live = liveSteps(current)
  // History keeps the change sets that were sent; live edits are diffed.
  const changes =
    result?.action === "approve" ? result.changes : diffPlan(original, current)
  const changeCount = countChanges(changes)
  const hasTombstones = current.some((s) => s.removed)
  const issues = locked ? [] : findDependencyIssues(current, dependsOn)
  const issuesByStep = new Map<string, DependencyIssue[]>()
  for (const issue of issues) {
    issuesByStep.set(issue.stepId, [
      ...(issuesByStep.get(issue.stepId) ?? []),
      issue,
    ])
  }
  const enabledCount = live.filter((s) => s.enabled).length
  const skippedCount = live.length - enabledCount
  const estimate = estimateLabel(
    live
      .filter((s) => s.enabled && !s.addedByUser)
      .map((s) => stepById.get(s.id)?.estimate),
    totalEstimate,
  )
  const canApprove =
    !locked && live.length > 0 && enabledCount > 0 && issues.length === 0
  const titleOf = (id: string) =>
    current.find((s) => s.id === id)?.title ?? "Step"
  const stepLabel = (id: string) =>
    `step ${livePosition(current, id) + 1}, ${titleOf(id)}`

  // ---- Announcements and focus ----
  const lastAnnouncement = React.useRef("")
  const announce = (text: string) => {
    // A repeated message gets a trailing space so screen readers read it again.
    const next = text === lastAnnouncement.current ? `${text} ` : text
    lastAnnouncement.current = next
    setAnnouncement(next)
  }

  React.useLayoutEffect(() => {
    if (!focusKey) return
    const el = rootRef.current?.querySelector<HTMLElement>(
      `[data-focus-key="${CSS.escape(focusKey)}"]`,
    )
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
    el?.scrollIntoView({ block: "nearest" })
    setFocusKey(null)
  }, [focusKey])

  /** Mentions a dependency problem the latest change created. */
  const issueNote = (next: PlanItem[]) => {
    const found = findDependencyIssues(next, dependsOn)
    if (found.length === 0) return ""
    return ` Warning: ${describeIssue(found[0], next)}`
  }

  // ---- Edits ----
  const commit = (next: PlanItem[]) => setItems(next)

  const remove = (id: string) => {
    const label = stepLabel(id)
    const next = removeStep(current, id)
    commit(next)
    if (editingId === id) setEditingId(null)
    setFocusKey(`${id}:undo`)
    announce(`Removed ${label}. Undo is available.${issueNote(next)}`)
  }

  const restore = (id: string) => {
    const next = restoreStep(current, id)
    commit(next)
    setFocusKey(`${id}:remove`)
    announce(
      `Restored ${titleOf(id)} as step ${livePosition(next, id) + 1}.${issueNote(next)}`,
    )
  }

  const toggle = (id: string, on: boolean) => {
    const next = setStepEnabled(current, id, on)
    commit(next)
    const note = issueNote(next)
    if (note) announce(note.trim())
  }

  const saveEdit = (id: string, newTitle: string, description: string) => {
    commit(editStep(current, id, { title: newTitle, description }))
    setEditingId(null)
    setFocusKey(`${id}:edit`)
  }

  const cancelEdit = (id: string) => {
    setEditingId(null)
    setFocusKey(`${id}:edit`)
  }

  const add = (newTitle: string, description: string) => {
    const id = uniqueStepId(current)
    const next = addStep(current, { id, title: newTitle, description })
    commit(next)
    setAdding(false)
    setFocusKey("add")
    announce(`Added step ${liveSteps(next).length}, ${newTitle.trim()}.`)
  }

  const reset = () => {
    setItems(null)
    setHeld(null)
    setEditingId(null)
    setAdding(false)
    announce("Plan reset to the proposal.")
  }

  const approve = () => {
    if (!canApprove) return
    setHeld(null)
    setEditingId(null)
    setAdding(false)
    setDecision("approved")
    onResult?.({
      action: "approve",
      steps: toResultSteps(current),
      edited: changeCount > 0,
      changes,
    })
  }

  const openRevise = (prefill?: string) => {
    if (prefill) setFeedback((f) => (f.trim() ? f : prefill))
    setRevising(true)
  }

  const requestChanges = () => {
    const text = feedback.trim()
    if (!text || text === ASSUMPTIONS_PREFIX.trim()) return
    setRevising(false)
    setHeld(null)
    setEditingId(null)
    setAdding(false)
    setDecision("revised")
    onResult?.({ action: "revise", feedback: text })
  }

  const dismiss = () => {
    setHeld(null)
    setEditingId(null)
    setAdding(false)
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  // ---- Keyboard reordering ----
  const onHandleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (!canEdit || drag) return
    const { key } = e
    if (!held) {
      if (key === " " || key === "Enter") {
        e.preventDefault()
        setHeld({ id, snapshot: current })
        announce(
          `Picked up ${stepLabel(id)}. Use the up and down arrow keys to move it, Space to drop, Escape to cancel.`,
        )
      }
      return
    }
    if (held.id !== id) return
    const total = live.length
    let next: PlanItem[] | null = null
    switch (key) {
      case "ArrowUp":
      case "ArrowDown":
        next = moveStepBy(current, id, key === "ArrowUp" ? -1 : 1)
        break
      case "Home":
        next = moveStep(current, id, 0)
        break
      case "End":
        next = moveStep(current, id, total - 1)
        break
      case " ":
      case "Enter":
      case "Tab": {
        if (key !== "Tab") e.preventDefault()
        setHeld(null)
        announce(
          `Dropped ${titleOf(id)} at step ${livePosition(current, id) + 1} of ${total}.${issueNote(current)}`,
        )
        return
      }
      case "Escape": {
        e.preventDefault()
        const back = held.snapshot
        setHeld(null)
        commit(back)
        setFocusKey(`${id}:handle`)
        announce(
          `Move cancelled. ${titleOf(id)} is back at step ${livePosition(back, id) + 1}.`,
        )
        return
      }
      default:
        return
    }
    e.preventDefault()
    if (next === current) {
      announce(
        `${titleOf(id)}. Step ${livePosition(current, id) + 1} of ${total}.`,
      )
      return
    }
    commit(next)
    setFocusKey(`${id}:handle`)
    announce(`${titleOf(id)}. Step ${livePosition(next, id) + 1} of ${total}.`)
  }

  const onHandleBlur = (e: React.FocusEvent<HTMLButtonElement>, id: string) => {
    // Focus moved elsewhere (not a re-render): drop the step where it is.
    if (held?.id === id && e.relatedTarget) {
      setHeld(null)
      announce(
        `Dropped ${titleOf(id)} at step ${livePosition(current, id) + 1}.`,
      )
    }
  }

  // ---- Pointer reordering (mouse, touch, pen) on the handle ----
  const dragRef = React.useRef<PointerDrag | null>(null)
  const pointer = React.useRef({ x: 0, y: 0 })
  const targetRef = React.useRef<number | null>(null)
  const overlayX = useMotionValue(0)
  const overlayY = useMotionValue(0)

  const handlers = React.useRef({
    move: (_e: PointerEvent) => {},
    up: (_e: PointerEvent) => {},
    cancel: () => {},
  })

  // Stable wrappers, so window listeners can be added and removed by identity.
  const [listeners] = React.useState(() => {
    const l = {
      move: (e: PointerEvent) => handlers.current.move(e),
      up: (e: PointerEvent) => handlers.current.up(e),
      cancel: () => handlers.current.cancel(),
      key: (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault()
          handlers.current.cancel()
        }
      },
      attach: () => {
        window.addEventListener("pointermove", l.move)
        window.addEventListener("pointerup", l.up)
        window.addEventListener("pointercancel", l.cancel)
      },
      detach: () => {
        window.removeEventListener("pointermove", l.move)
        window.removeEventListener("pointerup", l.up)
        window.removeEventListener("pointercancel", l.cancel)
        window.removeEventListener("keydown", l.key)
      },
    }
    return l
  })

  const updateTarget = () => {
    const d = dragRef.current
    const list = listRef.current
    if (!d?.active || !list) return
    const mids = [...list.querySelectorAll<HTMLElement>("[data-plan-step]")]
      .filter((el) => el.dataset.stepId !== d.id)
      .map((el) => {
        const b = el.getBoundingClientRect()
        return b.top + b.height / 2
      })
    const next = indexFromMidpoints(mids, pointer.current.y)
    if (next !== targetRef.current) {
      targetRef.current = next
      setTarget(next)
    }
  }

  const endDrag = () => {
    const d = dragRef.current
    if (d?.active) document.body.style.userSelect = d.userSelect
    listeners.detach()
    dragRef.current = null
    targetRef.current = null
    setDrag(null)
    setTarget(null)
  }

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    pointer.current = { x: e.clientX, y: e.clientY }
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= DRAG_SLOP)
        return
      d.active = true
      d.userSelect = document.body.style.userSelect
      document.body.style.userSelect = "none"
      setDrag({ id: d.id, width: d.width })
      window.addEventListener("keydown", listeners.key)
      announce(`Picked up ${stepLabel(d.id)}.`)
    }
    overlayX.set(e.clientX - d.offsetX)
    overlayY.set(e.clientY - d.offsetY)
    updateTarget()
  }

  const onPointerUp = (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || e.pointerId !== d.pointerId) return
    if (!d.active) return endDrag()
    const t = targetRef.current
    const from = livePosition(current, d.id)
    if (t !== null && from !== -1 && t !== from) {
      const next = moveStep(current, d.id, t)
      commit(next)
      announce(
        `Moved ${titleOf(d.id)} to step ${livePosition(next, d.id) + 1} of ${live.length}.${issueNote(next)}`,
      )
    } else {
      announce(`${titleOf(d.id)} was not moved.`)
    }
    endDrag()
  }

  const onPointerCancel = () => {
    const d = dragRef.current
    if (d?.active) announce(`Move cancelled. ${titleOf(d.id)} was not moved.`)
    endDrag()
  }

  React.useLayoutEffect(() => {
    handlers.current = {
      move: onPointerMove,
      up: onPointerUp,
      cancel: onPointerCancel,
    }
  })

  React.useEffect(
    () => () => {
      const d = dragRef.current
      if (d?.active) document.body.style.userSelect = d.userSelect
      listeners.detach()
    },
    [listeners],
  )

  const onHandlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (!canEdit || held || dragRef.current) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    const row = e.currentTarget.closest<HTMLElement>("[data-plan-step]")
    if (!row) return
    const rect = row.getBoundingClientRect()
    pointer.current = { x: e.clientX, y: e.clientY }
    dragRef.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      width: rect.width,
      active: false,
      userSelect: "",
    }
    listeners.attach()
  }

  /** Where the drop line goes while dragging. */
  let indicator: { id: string; edge: "before" | "after" } | null = null
  if (drag && target !== null && target !== livePosition(current, drag.id)) {
    const others = live.filter((s) => s.id !== drag.id)
    if (target < others.length) {
      indicator = { id: others[target].id, edge: "before" }
    } else if (others.length > 0) {
      indicator = { id: others[others.length - 1].id, edge: "after" }
    }
  }

  // ---- Render ----
  const dragItem = drag ? current.find((s) => s.id === drag.id) : undefined
  const showAdd = canEdit && allowAdd && !streaming && readySteps.length > 0
  const approveLabel = changeCount > 0 ? "Approve edited plan" : "Approve plan"

  const footerHint = streaming ? (
    <ShimmeringText
      text="Drafting the plan…"
      color="var(--muted-foreground)"
      shimmeringColor="var(--foreground)"
    />
  ) : status === "submitting" ? (
    "Starting…"
  ) : issues.length > 0 ? (
    <span className="text-destructive">
      {issues.length === 1
        ? "Fix the warning to approve"
        : `Fix ${issues.length} warnings to approve`}
    </span>
  ) : live.length > 0 && enabledCount === 0 ? (
    "Turn on at least one step to approve"
  ) : live.length === 0 && readySteps.length > 0 ? (
    "Every step was removed"
  ) : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        ref={rootRef}
        data-slot="plan-review"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-label={title ?? "Proposed plan"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
          {goal && <p className="sr-only">{goal}</p>}
          {live.length > 0
            ? estimate && (
                <p className={cn(genuiType.meta, "tabular-nums")}>
                  <span className="sr-only">
                    {enabledCount} {enabledCount === 1 ? "step" : "steps"}
                    {skippedCount > 0 && `, ${skippedCount} skipped`}.{" "}
                  </span>
                  {estimate.charAt(0).toUpperCase() + estimate.slice(1)}
                </p>
              )
            : streaming && <Skeleton className="h-3 w-24" />}
        </SurfaceHeader>

        <p id={instructionsId} className="sr-only">
          Press Space or Enter to pick up this step. Then use the up and down
          arrow keys to move it, Space or Enter to drop it, or Escape to cancel.
        </p>
        <p className="sr-only" aria-live="assertive" aria-atomic="true">
          {announcement}
        </p>

        <AutoHeight>
          <LayoutGroup id={groupId}>
            <ol
              ref={listRef}
              aria-label={`${title ?? "Plan"}: steps`}
              className="flex flex-col border-t border-border py-1"
            >
              {current.map((item) => {
                const step = stepById.get(item.id)
                if (item.removed) {
                  if (locked) return null
                  return (
                    <motion.li
                      key={item.id}
                      layout="position"
                      data-slot="plan-review-removed"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={genuiMotion.fade}
                      className="mx-2 flex items-center gap-2 rounded-lg border border-border bg-transparent py-1.5 pr-1.5 pl-3 text-[13px] leading-4 text-muted-foreground"
                    >
                      <span className="min-w-0 flex-1 break-words">
                        Removed “{item.title}”
                      </span>
                      {canEdit && (
                        <Button
                          size="xs"
                          variant="secondary"
                          data-focus-key={`${item.id}:undo`}
                          aria-label={`Undo removing “${item.title}”`}
                          onClick={() => restore(item.id)}
                        >
                          Undo
                        </Button>
                      )}
                    </motion.li>
                  )
                }

                const n = livePosition(current, item.id) + 1
                const name = `step ${n}: ${item.title}`
                const stepIssues = issuesByStep.get(item.id) ?? []
                const isHeld = canEdit && held?.id === item.id
                const editing = canEdit && editingId === item.id
                return (
                  <motion.li
                    key={item.id}
                    layout="position"
                    data-plan-step=""
                    data-step-id={item.id}
                    data-enabled={item.enabled}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    className={cn(
                      "relative flex items-start gap-2 bg-(--surface-bg) px-3 py-2",
                      drag?.id === item.id && "opacity-40",
                      isHeld && "z-10 ring-2 ring-ring ring-inset",
                    )}
                  >
                    {indicator?.id === item.id &&
                      indicator.edge === "before" && <DropLine edge="before" />}

                    {showControls && (
                      <button
                        type="button"
                        disabled={!canEdit}
                        data-focus-key={`${item.id}:handle`}
                        data-slot="plan-review-handle"
                        aria-label={`Reorder ${name}`}
                        aria-roledescription="draggable step"
                        aria-describedby={instructionsId}
                        onKeyDown={(e) => onHandleKeyDown(e, item.id)}
                        onBlur={(e) => onHandleBlur(e, item.id)}
                        onPointerDown={(e) => onHandlePointerDown(e, item.id)}
                        className={cn("relative", genuiHit, "-ml-2 inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing disabled:pointer-events-none disabled:opacity-50")}
                      >
                        <GripVerticalIcon aria-hidden className="size-4" />
                      </button>
                    )}

                    <span className="w-5 shrink-0 pt-0.5 text-[13px] leading-5 tabular-nums text-muted-foreground">
                      {n}.
                    </span>

                    {editing ? (
                      <StepForm
                        initialTitle={item.title}
                        initialDescription={item.description}
                        titleLabel={`Title for step ${n}`}
                        descriptionLabel={`Details for step ${n}`}
                        submitLabel="Save"
                        onSubmit={(t, d) => saveEdit(item.id, t, d)}
                        onCancel={() => cancelEdit(item.id)}
                      />
                    ) : (
                      <>
                        <motion.div
                          animate={{ opacity: item.enabled ? 1 : 0.65 }}
                          transition={{ duration: 0.2 }}
                          className="flex min-w-0 flex-1 flex-col gap-0.5"
                        >
                          <span
                            className={cn(
                              "pt-0.5 text-[13px] leading-5 font-semibold break-words",
                              !item.enabled &&
                                "text-muted-foreground line-through decoration-muted-foreground/60",
                            )}
                          >
                            {item.title}
                          </span>
                          {item.description && (
                            <span
                              className={cn(
                                genuiType.meta,
                                "break-words",
                                !item.enabled && "line-through",
                              )}
                            >
                              {item.description}
                            </span>
                          )}
                          <StepMeta
                            step={step}
                            item={item}
                            moved={changes.moved.includes(item.id)}
                            edited={changes.edited.includes(item.id)}
                          />
                          {stepIssues.map((issue) => (
                            <p
                              key={issue.dependsOnId}
                              className="flex items-start gap-1.5 text-[13px] leading-4 text-destructive"
                            >
                              <AlertTriangleIcon
                                aria-hidden
                                className="mt-px size-3.5 shrink-0"
                              />
                              {describeIssue(issue, current)}
                            </p>
                          ))}
                        </motion.div>

                        {showControls && (
                          <div className="flex shrink-0 items-center gap-0.5">
                            {step?.optional && (
                              <Switch
                                nativeButton
                                disabled={!canEdit}
                                aria-label={`Run ${name}`}
                                checked={item.enabled}
                                onCheckedChange={(on) => toggle(item.id, on)}
                                // Larger tap area than the 20px track.
                                className="mr-1.5 after:absolute after:-inset-2"
                              />
                            )}
                            <WhyDisabled
                              when={!canEdit}
                              reason="Can’t edit right now"
                            >
                              <IconTip label={`Edit ${name}`}>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={!canEdit}
                                  data-focus-key={`${item.id}:edit`}
                                  aria-label={`Edit ${name}`}
                                  onClick={() => {
                                    setAdding(false)
                                    setEditingId(item.id)
                                  }}
                                >
                                  <PencilIcon />
                                </Button>
                              </IconTip>
                            </WhyDisabled>
                            <WhyDisabled
                              when={!canEdit}
                              reason="Can’t edit right now"
                            >
                              <IconTip label={`Remove ${name}`}>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  disabled={!canEdit}
                                  data-focus-key={`${item.id}:remove`}
                                  aria-label={`Remove ${name}`}
                                  onClick={() => remove(item.id)}
                                >
                                  <Trash2Icon />
                                </Button>
                              </IconTip>
                            </WhyDisabled>
                          </div>
                        )}
                      </>
                    )}

                    {indicator?.id === item.id &&
                      indicator.edge === "after" && <DropLine edge="after" />}
                  </motion.li>
                )
              })}

              {streaming && (
                <li aria-hidden className="flex gap-3 px-3 py-3">
                  <Skeleton className="h-4 w-5" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/3" />
                  </div>
                </li>
              )}
            </ol>
          </LayoutGroup>

          {showAdd && (
            <div className="border-t border-border px-3 py-2">
              {adding ? (
                <StepForm
                  titleLabel="New step title"
                  descriptionLabel="New step details (optional)"
                  submitLabel="Add step"
                  onSubmit={add}
                  onCancel={() => {
                    setAdding(false)
                    setFocusKey("add")
                  }}
                />
              ) : (
                <WhyDisabled
                  when={live.length >= MAX_STEPS}
                  reason="Step limit reached"
                >
                  <Button
                    size="sm"
                    variant="secondary"
                    data-focus-key="add"
                    className="-ml-2.5"
                    disabled={live.length >= MAX_STEPS}
                    onClick={() => {
                      setEditingId(null)
                      setAdding(true)
                    }}
                  >
                    <PlusIcon aria-hidden />
                    Add a step
                  </Button>
                </WhyDisabled>
              )}
            </div>
          )}

          {readyAssumptions.length > 0 && (
            <div className="flex flex-col gap-1 border-t border-border px-3 py-2">
              <h4 className={genuiType.label}>Assuming</h4>
              <ul className="flex flex-col gap-0.5 text-[13px] leading-5">
                {readyAssumptions.map((a) => (
                  <motion.li
                    key={a}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                  >
                    {a}
                  </motion.li>
                ))}
              </ul>
              {(status === "ready" || streaming) && (
                <WhyDisabled className="inline-flex self-start" when={locked} reason="Already sent">
                  <Button
                    size="xs"
                    variant="link"
                    disabled={locked}
                    className="self-start px-0 text-muted-foreground hover:text-foreground"
                    onClick={() => openRevise(ASSUMPTIONS_PREFIX)}
                  >
                    These are wrong
                  </Button>
                </WhyDisabled>
              )}
            </div>
          )}
        </AutoHeight>

        <SurfaceFooter
          aria-live="polite"
          className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          {status === "approved" ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] leading-5">
              <CheckIcon aria-hidden className="size-4" />
              Approved · running
              {changeCount > 0 && (
                <span className="text-muted-foreground">· with your edits</span>
              )}
            </p>
          ) : status === "dismissed" ? (
            <p className="flex items-center gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <XIcon aria-hidden className="size-4" />
              Dismissed. Nothing will run.
            </p>
          ) : status === "revised" ? (
            <p className="flex items-start gap-1.5 text-[13px] leading-5 text-muted-foreground">
              <MessageSquareIcon
                aria-hidden
                className="mt-0.5 size-4 shrink-0"
              />
              <span>
                Changes requested
                {feedback && (
                  <span className="text-foreground">: “{feedback}”</span>
                )}
              </span>
            </p>
          ) : revising ? (
            <div className="flex w-full flex-col gap-2">
              <Textarea
                autoFocus
                aria-label="What should change in the plan?"
                placeholder="What should change?"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                onFocus={(e) => {
                  const end = e.currentTarget.value.length
                  e.currentTarget.setSelectionRange(end, end)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    requestChanges()
                  }
                  if (e.key === "Escape") setRevising(false)
                }}
                className="min-h-20"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRevising(false)}
                >
                  Cancel
                </Button>
                <WhyDisabled
                  when={
                    !feedback.trim() ||
                    feedback.trim() === ASSUMPTIONS_PREFIX.trim()
                  }
                  reason="Describe the change first"
                >
                  <Button
                    size="sm"
                    onClick={requestChanges}
                    disabled={
                      !feedback.trim() ||
                      feedback.trim() === ASSUMPTIONS_PREFIX.trim()
                    }
                  >
                    Send request
                  </Button>
                </WhyDisabled>
              </div>
            </div>
          ) : (
            <>
              <p className={genuiType.meta}>{footerHint}</p>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <WhyDisabled when={locked} reason="Already sent">
                  <IconTip label="Dismiss plan">
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Dismiss plan"
                      onClick={dismiss}
                      disabled={locked}
                      className="relative after:absolute after:-inset-1"
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </IconTip>
                </WhyDisabled>
                {editable && (
                  <WhyDisabled
                    when={
                      locked ||
                      items === null ||
                      (changeCount === 0 && !hasTombstones)
                    }
                    reason="Nothing to reset"
                  >
                    <IconTip label="Reset plan to the proposal">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Reset plan to the proposal"
                        onClick={reset}
                        disabled={
                          locked ||
                          items === null ||
                          (changeCount === 0 && !hasTombstones)
                        }
                        className="relative after:absolute after:-inset-1"
                      >
                        <RotateCcwIcon aria-hidden />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                )}
                <WhyDisabled className="flex flex-1 sm:flex-none" when={locked} reason="Already sent">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openRevise()}
                    disabled={locked}
                    className="flex-1 sm:flex-none"
                  >
                    Request changes
                  </Button>
                </WhyDisabled>
                <WhyDisabled className="flex flex-1 sm:flex-none" when={!canApprove} reason="Nothing to approve yet">
                  <Button
                    size="sm"
                    onClick={approve}
                    disabled={!canApprove}
                    className="flex-1 sm:flex-none"
                  >
                    {status === "submitting" ? "Starting…" : approveLabel}
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>

      {drag &&
        dragItem &&
        typeof document !== "undefined" &&
        createPortal(
          <MotionConfig reducedMotion="user">
            <motion.div
              aria-hidden
              data-slot="plan-review-drag-preview"
              style={{ x: overlayX, y: overlayY, width: drag.width }}
              className="pointer-events-none fixed top-0 left-0 z-[100] cursor-grabbing"
            >
              <motion.div
                initial={{ scale: 1 }}
                animate={{ scale: 1.02 }}
                transition={{ duration: 0.15, ease: "easeOut" }}
                className="flex items-start gap-2 rounded-[10px] border bg-card px-3 py-3 text-card-foreground shadow-lg dark:shadow-none"
              >
                <GripVerticalIcon className="-ml-1.5 size-4 shrink-0 translate-y-0.5 text-muted-foreground" />
                <span className="text-[13px] leading-5 font-medium break-words">
                  {dragItem.title}
                </span>
              </motion.div>
            </motion.div>
          </MotionConfig>,
          document.body,
        )}
    </MotionConfig>
  )
}
