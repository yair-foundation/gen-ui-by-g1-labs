"use client"

import * as React from "react"
import {
  CheckIcon,
  PencilIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { WhyDisabled } from "@/components/genui/hint"
import { Textarea } from "@/components/ui/textarea"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { RadioMark } from "@/components/genui/genui-motion"

import { type DiffPart, diffStats, diffWords } from "./draft-options-diff"
import type {
  DraftOption,
  DraftOptionsInput,
  DraftOptionsResult,
} from "./draft-options.schema"

export type DraftOptionsStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "applied"
  | "regenerated"
  | "cancelled"

export type DraftOptionsProps = Partial<Omit<DraftOptionsInput, "options">> & {
  /** Options may be partial while the tool call streams. */
  options?: Partial<DraftOption>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host applies the text.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: DraftOptionsStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: DraftOptionsResult) => void
  /**
   * A decision from history. Renders the finished state (selection and edits
   * included) and never calls onResult.
   */
  result?: DraftOptionsResult
  className?: string
}

const decisionFor = {
  apply: "applied",
  regenerate: "regenerated",
  cancel: "cancelled",
} as const

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

function Diff({ parts }: { parts: DiffPart[] }) {
  return (
    <>
      {parts.map((p, i) => {
        const Tag =
          p.type === "removed" ? "del" : p.type === "added" ? "ins" : "span"
        return (
          <Tag
            // biome-ignore lint/suspicious/noArrayIndexKey: diff parts are positional
            key={i}
            className={cn(
              p.type === "removed" && "text-muted-foreground line-through",
              p.type === "added" &&
                "font-medium text-foreground underline decoration-foreground/40 underline-offset-[3px]",
            )}
          >
            {p.text}
          </Tag>
        )
      })}
    </>
  )
}

export function DraftOptions({
  title,
  original,
  options = [],
  applyLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: DraftOptionsProps) {
  const groupName = React.useId()
  // Restored from `result` when the decision is already in history.
  const [selectedId, setSelectedId] = React.useState<string | null>(() =>
    result?.action === "apply" ? result.optionId : null,
  )
  const [edits, setEdits] = React.useState<Record<string, string>>(() =>
    result?.action === "apply" && result.edited
      ? { [result.optionId]: result.text }
      : {},
  )
  const [editing, setEditing] = React.useState(false)
  const [buffer, setBuffer] = React.useState("")
  const [decision, setDecision] = React.useState<
    "applied" | "regenerated" | "cancelled" | null
  >(() => (result ? decisionFor[result.action] : null))
  const [regenerating, setRegenerating] = React.useState(false)
  const [note, setNote] = React.useState(
    result?.action === "regenerate" ? (result.note ?? "") : "",
  )

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: DraftOptionsStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  const ready = options.filter(
    (o): o is DraftOption =>
      typeof o.id === "string" &&
      typeof o.label === "string" &&
      typeof o.text === "string",
  )
  // The first draft is selected by default once the drafts have arrived.
  const selected =
    ready.find((o) => o.id === selectedId) ??
    (status === "ready" && !result ? ready[0] : undefined)
  const textOf = (o: DraftOption) => edits[o.id] ?? o.text

  /** Saves the open editor; returns the selected draft's final text. */
  const commitEdit = () => {
    if (!selected) return ""
    if (!editing) return textOf(selected)
    const value = buffer.trim() === selected.text.trim() ? undefined : buffer
    setEdits((prev) => {
      const next = { ...prev }
      if (value === undefined) delete next[selected.id]
      else next[selected.id] = value
      return next
    })
    setEditing(false)
    return value ?? selected.text
  }

  const select = (id: string) => {
    if (locked) return
    commitEdit()
    setSelectedId(id)
  }

  const startEdit = () => {
    if (!selected) return
    setBuffer(textOf(selected))
    setEditing(true)
  }

  const resetEdit = () => {
    if (!selected) return
    setEdits((prev) => {
      const next = { ...prev }
      delete next[selected.id]
      return next
    })
  }

  const apply = () => {
    if (!selected || locked) return
    const text = commitEdit()
    if (!text.trim()) return
    setSelectedId(selected.id)
    setDecision("applied")
    onResult?.({
      action: "apply",
      optionId: selected.id,
      text,
      edited: text !== selected.text,
    })
  }

  const regenerate = () => {
    const text = note.trim()
    setRegenerating(false)
    setEditing(false)
    setDecision("regenerated")
    onResult?.(
      text ? { action: "regenerate", note: text } : { action: "regenerate" },
    )
  }

  const cancel = () => {
    setEditing(false)
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  const appliedText = selected ? textOf(selected) : ""
  const applyDisabled =
    locked || !selected || !(editing ? buffer : appliedText).trim()

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="draft-options"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-label={title ?? "Drafts"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
        </SurfaceHeader>

        {/* The diff shows the original visually; screen readers get it here. */}
        {original && (
          <p data-slot="draft-options-original" className="sr-only">
            Original: {original}
          </p>
        )}

        <AutoHeight>
          <fieldset disabled={locked} className="min-w-0">
            <legend className="sr-only">{title ?? "Drafts"}</legend>
            <div className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
              {ready.map((o) => {
                const isSelected = selected?.id === o.id
                const isEditing = editing && isSelected && !locked
                const text = textOf(o)
                const edited = o.id in edits
                const parts =
                  isSelected && original !== undefined
                    ? diffWords(original, text)
                    : null
                const stats = parts ? diffStats(parts) : null
                const id = `${groupName}-${o.id}`
                // Edit buttons or the editor, shown under the selected draft.
                const hasControls = isSelected && !locked
                return (
                  <motion.div
                    key={o.id}
                    data-slot="draft-options-option"
                    data-selected={isSelected}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    className={cn(
                      "flex flex-col rounded-[10px] transition-colors",
                      isSelected && "bg-accent",
                      !isSelected &&
                        !locked &&
                        "hover:bg-muted dark:hover:bg-white/5",
                    )}
                  >
                    {/* One label around the radio, its mark and the draft:
                        the whole option selects it. The edit controls sit
                        below, outside it. */}
                    <label
                      className={cn(
                        "flex gap-3 px-3 pt-3",
                        hasControls ? "pb-2" : "pb-3",
                        locked ? "cursor-default" : "cursor-pointer",
                      )}
                    >
                      <input
                        type="radio"
                        id={id}
                        name={groupName}
                        value={o.id}
                        checked={isSelected}
                        onChange={() => select(o.id)}
                        aria-labelledby={`${id}-label`}
                        aria-describedby={
                          stats ? `${id}-text ${id}-stats` : `${id}-text`
                        }
                        className="peer sr-only"
                      />
                      <RadioMark
                        checked={isSelected}
                        className="-mt-px size-5 shrink-0 peer-focus-visible:ring-2 peer-focus-visible:ring-ring/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-60"
                      />
                      <span className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span id={`${id}-label`} className={genuiType.label}>
                            {o.label}
                          </span>
                          {edited && <Badge variant="outline">Edited</Badge>}
                        </span>
                        {!isEditing &&
                          (parts ? (
                            <>
                              <span id={`${id}-text`} className="sr-only">
                                {text}
                              </span>
                              <span
                                aria-hidden
                                className="text-[14px] whitespace-pre-wrap break-words"
                              >
                                <Diff parts={parts} />
                              </span>
                            </>
                          ) : (
                            <span
                              id={`${id}-text`}
                              className={cn(
                                "text-[14px] whitespace-pre-wrap break-words",
                                !isSelected &&
                                  locked &&
                                  "text-muted-foreground",
                              )}
                            >
                              {text}
                            </span>
                          ))}
                        {stats && (
                          <span id={`${id}-stats`} className="sr-only">
                            {stats.added || stats.removed
                              ? `Compared with the original: ${plural(stats.added, "word")} added, ${plural(stats.removed, "word")} removed.`
                              : "Same as the original."}
                          </span>
                        )}
                      </span>
                    </label>

                    {isEditing ? (
                      <div className="flex min-w-0 flex-col gap-2 pr-3 pb-3 pl-11">
                        <Textarea
                          autoFocus
                          id={`${id}-text`}
                          aria-label={`Edit ${o.label} draft`}
                          value={buffer}
                          onChange={(e) => setBuffer(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") setEditing(false)
                            if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                              commitEdit()
                          }}
                          className="min-h-20"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={commitEdit}
                          >
                            Done
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setEditing(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      isSelected &&
                      !locked && (
                        <div className="flex gap-1 pr-3 pb-3 pl-8.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label={`Edit ${o.label} draft`}
                            onClick={startEdit}
                          >
                            <PencilIcon aria-hidden />
                            Edit
                          </Button>
                          {edited && (
                            <Button
                              size="sm"
                              variant="secondary"
                              aria-label={`Undo edits to ${o.label} draft`}
                              onClick={resetEdit}
                            >
                              <RotateCcwIcon aria-hidden />
                              Undo edits
                            </Button>
                          )}
                        </div>
                      )
                    )}
                  </motion.div>
                )
              })}
              {streaming &&
                Array.from({ length: ready.length === 0 ? 2 : 1 }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                  <div key={i} aria-hidden className="flex gap-3 px-3 py-3">
                    <Skeleton className="size-4 rounded-full" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-20" />
                      <Skeleton className="h-4 w-full" />
                    </div>
                  </div>
                ))}
            </div>
          </fieldset>
        </AutoHeight>

        <SurfaceFooter
          aria-live="polite"
          className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          {status === "applied" ? (
            <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
              <CheckIcon aria-hidden className="size-4 shrink-0" />
              <span>
                Applied {selected ? `“${selected.label}”` : "the draft"}
                {selected && selected.id in edits && " with your edits"}
              </span>
            </p>
          ) : status === "regenerated" ? (
            <p
              className={cn(
                genuiType.body,
                "flex items-start gap-1.5 text-muted-foreground",
              )}
            >
              <RefreshCwIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>
                Asked for new drafts
                {note && <span className="text-foreground">: “{note}”</span>}
              </span>
            </p>
          ) : status === "cancelled" ? (
            <p
              className={cn(
                genuiType.body,
                "flex items-center gap-1.5 text-muted-foreground",
              )}
            >
              <XIcon aria-hidden className="size-4 shrink-0" />
              Cancelled
            </p>
          ) : regenerating ? (
            <div className="flex w-full flex-col gap-2">
              <Textarea
                autoFocus
                aria-label="What should the new drafts do differently? (optional)"
                placeholder="What should change? (optional)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey))
                    regenerate()
                  if (e.key === "Escape") setRegenerating(false)
                }}
                className="min-h-16"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRegenerating(false)}
                >
                  Back
                </Button>
                <Button size="sm" onClick={regenerate}>
                  Get new drafts
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className={genuiType.meta}>
                {streaming ? (
                  <ShimmeringText
                    text="Writing drafts…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                ) : status === "submitting" ? (
                  "Applying…"
                ) : null}
              </p>
              <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Cancel"
                        onClick={cancel}
                        disabled={locked}
                        className="hover:bg-muted dark:hover:bg-white/10 relative after:absolute after:-inset-1"
                      />
                    }
                  >
                    <XIcon aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>Cancel</TooltipContent>
                </Tooltip>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setRegenerating(true)}
                  disabled={locked}
                  className="flex-1 sm:flex-none"
                >
                  None of these
                </Button>
                <WhyDisabled
                  when={applyDisabled && !locked}
                  reason={
                    !selected ? "Pick a draft first" : "Draft can't be empty"
                  }
                >
                  <Button
                    size="sm"
                    onClick={apply}
                    disabled={applyDisabled}
                    className="flex-1 sm:flex-none"
                  >
                    {status === "submitting"
                      ? "Applying…"
                      : (applyLabel ?? "Apply")}
                  </Button>
                </WhyDisabled>
              </div>
            </>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
