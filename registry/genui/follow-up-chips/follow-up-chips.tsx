"use client"

import * as React from "react"
import { CheckIcon, CornerDownRightIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { genuiType, genuiMotion, Skeleton, genuiHit } from "@/components/genui/surface"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

import type {
  FollowUpChipsInput,
  FollowUpChipsResult,
  FollowUpSuggestion,
} from "./follow-up-chips.schema"

export type FollowUpChipsStatus = "streaming" | "ready" | "selected"

type ReadySuggestion = FollowUpSuggestion

export type FollowUpChipsProps = Partial<
  Omit<FollowUpChipsInput, "suggestions">
> & {
  /** Suggestions may be partial while the tool call is still streaming. */
  suggestions?: Partial<FollowUpSuggestion>[]
  /**
   * Lifecycle, controlled by the host. Arrived suggestions can be tapped while
   * 'streaming'. When omitted, the component tracks the selection itself.
   */
  status?: FollowUpChipsStatus
  /** Called once with the tapped suggestion. Send `prompt` as the user's message. */
  onResult?: (result: FollowUpChipsResult) => void
  /** A selection from history. Marks that chip as chosen; never calls onResult. */
  result?: FollowUpChipsResult
  className?: string
}

export function FollowUpChips({
  label,
  suggestions = [],
  layout = "chips",
  status: statusProp,
  onResult,
  result,
  className,
}: FollowUpChipsProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(
    result?.id ?? null,
  )

  // A host-provided "ready" (or nothing) yields to the user's selection.
  const status: FollowUpChipsStatus =
    selectedId && (statusProp === undefined || statusProp === "ready")
      ? "selected"
      : (statusProp ?? "ready")
  const locked = status === "selected"

  const ready = suggestions.filter(
    (s): s is ReadySuggestion =>
      typeof s.id === "string" && typeof s.label === "string" && s.label !== "",
  )

  const select = (s: ReadySuggestion) => {
    if (locked) return
    setSelectedId(s.id)
    onResult?.({ action: "select", id: s.id, prompt: s.prompt ?? s.label })
  }

  const list = layout === "list"
  const chosenLabel = ready.find((r) => r.id === selectedId)?.label ?? ""
  // A label cut to one line shows in full on hover.
  const tipFor = (label: string, button: React.ReactElement) =>
    label.length > 34 ? <IconTip label={label}>{button}</IconTip> : button

  return (
    <MotionConfig reducedMotion="user">
      {/* biome-ignore lint/a11y/useSemanticElements: a group of action buttons, not form fields, so not a <fieldset> */}
      <div
        data-genui=""
        data-slot="follow-up-chips"
        data-status={status}
        role="group"
        aria-label={label ?? "Suggested follow-ups"}
        aria-busy={status === "streaming"}
        className={cn("flex flex-col gap-2", className)}
      >
        {label && <p className={genuiType.label}>{label}</p>}

        {ready.length === 0 && status === "streaming" && (
          <div aria-hidden className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-32 rounded-full" />
            <Skeleton className="h-8 w-40 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        )}
        {ready.length === 0 && status === "streaming" && (
          <span className="sr-only">Suggesting…</span>
        )}

        <ul
          className={cn(
            list
              ? "flex flex-col divide-y divide-border overflow-hidden rounded-[14px] border border-border"
              : "flex flex-wrap gap-2",
          )}
        >
          {ready.map((s, index) => {
            const selected = s.id === selectedId
            return (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className={cn(list ? "flex" : "flex max-w-full")}
              >
                <WhyDisabled
                  reason={
                    locked && !selected
                      ? `Already chose “${chosenLabel}”`
                      : undefined
                  }
                  className={list ? "flex w-full" : "max-w-full"}
                >
                  {tipFor(
                    s.label,
                    <button
                      type="button"
                      aria-pressed={locked ? selected : undefined}
                      disabled={locked && !selected}
                      onClick={() => select(s)}
                      className={cn(
                        "relative", genuiHit, "text-[13px] transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default",
                        list
                          ? "flex w-full items-center gap-2.5 px-3 py-3 text-left hover:bg-muted focus-visible:ring-inset dark:hover:bg-white/5"
                          : "inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-border bg-transparent px-3 py-1.5 text-left hover:bg-accent dark:hover:bg-white/5",
                        selected &&
                          (list
                            ? "bg-muted ring-2 ring-choice ring-inset dark:bg-accent"
                            : "ring-2 ring-choice ring-inset"),
                        // The first and last rows follow the list's rounded corners.
                        list && index === 0 && "rounded-t-[13px]",
                        list &&
                          index === ready.length - 1 &&
                          "rounded-b-[13px]",
                        locked && !selected && "text-muted-foreground",
                      )}
                    >
                      <CornerDownRightIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 truncate">{s.label}</span>
                      {selected && (
                        <CheckIcon
                          aria-hidden
                          className={cn("size-3.5 shrink-0", list && "ml-auto")}
                        />
                      )}
                    </button>,
                  )}
                </WhyDisabled>
              </motion.li>
            )
          })}
        </ul>
      </div>
    </MotionConfig>
  )
}
