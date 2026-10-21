"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/animate-ui/components/base/checkbox"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import {
  type ChecklistInput,
  type ChecklistItem,
  type ChecklistResult,
  checklistCountText,
  checklistSections,
  checklistUsesSteps,
} from "./checklist.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"

export type ChecklistStatus = "streaming" | "ready" | "submitted"

export type ChecklistProps = Partial<Omit<ChecklistInput, "items">> & {
  /** Items may be partial while the tool call streams. */
  items?: Partial<ChecklistItem>[]
  /** Lifecycle, controlled by the host. */
  status?: ChecklistStatus
  /** Called when the user presses the submit button (only with `submitLabel`). */
  onResult?: (result: ChecklistResult) => void
  /**
   * Called on every tick, so the host can save progress (it isn't sent to the
   * agent). Pass it back as `progress` to restore the ticks.
   */
  onProgress?: (checked: string[]) => void
  /** Saved ticks (from `onProgress`). The checklist stays editable. */
  progress?: string[]
  /** A submission from history. Restores the ticks and locks; never calls onResult. */
  result?: ChecklistResult
  className?: string
}

/** Done text: struck through and muted. */
const doneText =
  "text-muted-foreground line-through decoration-muted-foreground/60"

export function Checklist({
  title,
  items = [],
  ordered = false,
  countLabel,
  submitLabel,
  status: statusProp,
  onResult,
  onProgress,
  progress,
  result,
  className,
}: ChecklistProps) {
  // Ticks = the agent's `checked`, overridden by the user's saved or live ticks.
  const restored = result?.checked ?? progress
  const [overrides, setOverrides] = React.useState<Map<string, boolean>>(
    () => new Map(restored?.map((id) => [id, true])),
  )
  const [submitted, setSubmitted] = React.useState(result !== undefined)
  const baseId = React.useId()

  const status: ChecklistStatus =
    submitted && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const ready = items.filter(
    (i): i is ChecklistItem =>
      typeof i.id === "string" && typeof i.label === "string",
  )
  const isChecked = (i: ChecklistItem) =>
    restored
      ? (overrides.get(i.id) ?? false)
      : (overrides.get(i.id) ?? Boolean(i.checked))
  const done = ready.filter(isChecked).length
  const total = ready.length
  const steps = checklistUsesSteps(ready)
  const sections = checklistSections(ready)
  const label = countLabel?.trim()

  const toggle = (id: string, on: boolean) => {
    const next = new Map(overrides)
    next.set(id, on)
    setOverrides(next)
    onProgress?.(
      ready.filter((i) => (i.id === id ? on : isChecked(i))).map((i) => i.id),
    )
  }

  const submit = () => {
    setSubmitted(true)
    onResult?.({
      action: "submit",
      checked: ready.filter(isChecked).map((i) => i.id),
    })
  }

  let position = 0
  const renderItem = (item: ChecklistItem) => {
    position += 1
    const checked = isChecked(item)
    const itemId = `${baseId}-${item.id}`
    const details = [
      item.time && `${itemId}-time`,
      item.description && `${itemId}-desc`,
    ]
      .filter(Boolean)
      .join(" ")
    const number = ordered && (
      <span className="mr-1.5 tabular-nums text-muted-foreground">
        {position}.
      </span>
    )

    return (
      <motion.li
        key={item.id}
        className={steps ? "px-3" : undefined}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={genuiMotion.fade}
      >
        {/* The whole row toggles the check (a wrapping label clicks it). */}
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the Checkbox inside renders the button and input */}
        <label
          className={cn(
            "flex gap-3 transition-colors",
            steps
              ? "-mx-2 items-center rounded-lg px-2 py-3.5"
              : // Items share a line when wide: each is a button card.
                "h-full items-start rounded-[10px] border border-border px-3 py-3",
            !steps &&
              checked &&
              "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
            status === "submitted"
              ? "cursor-default"
              : "cursor-pointer hover:bg-muted dark:hover:bg-white/5",
          )}
        >
          <Checkbox
            nativeButton
            size="sm"
            aria-labelledby={`${itemId}-label`}
            aria-describedby={details || undefined}
            checked={checked}
            disabled={status === "submitted"}
            onCheckedChange={(on) => toggle(item.id, Boolean(on))}
            // A large round check, with a tap area beyond its 22px.
            className="relative size-5.5 rounded-full border-[1.5px] border-muted-foreground/70 after:absolute after:-inset-2 data-checked:border-primary [&_svg]:size-3"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {steps && item.time && (
              <span
                id={`${itemId}-time`}
                className={cn("tabular-nums", genuiType.meta)}
              >
                {item.time}
              </span>
            )}
            <div className="flex items-baseline justify-between gap-3">
              <span
                id={`${itemId}-label`}
                className={cn(
                  genuiType.body,
                  "transition-colors",
                  steps ? "font-semibold" : "py-px leading-5",
                  checked && doneText,
                )}
              >
                {number}
                {item.label}
              </span>
              {item.meta && (
                <Badge variant="info" className="shrink-0 tabular-nums">
                  {item.meta}
                </Badge>
              )}
            </div>
            {item.description && (
              <span
                id={`${itemId}-desc`}
                className={cn(
                  genuiType.body,
                  "transition-colors",
                  checked && doneText,
                )}
              >
                {item.description}
              </span>
            )}
          </div>
        </label>
      </motion.li>
    )
  }

  const skeletonRow = streaming && (
    <li
      aria-hidden
      className={cn(
        "flex items-center gap-3",
        steps ? "px-3 py-3.5" : "py-3 @lg:col-span-full",
      )}
    >
      <Skeleton className="size-5.5 rounded-full" />
      <Skeleton className="h-4 flex-1" />
    </li>
  )


  const List = ordered ? "ol" : "ul"
  // Short items flow into two columns of button cards when the card is wide; timed steps stay
  // in one column, divided.
  const listClass = steps
    ? "flex flex-col divide-y divide-border"
    : "grid grid-cols-1 gap-2 px-3 @lg:grid-cols-2"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="checklist"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Checklist"}
        className={cn("@container", className)}
      >
        <SurfaceHeader className="gap-3 pb-3">
          <div className="flex items-baseline justify-between gap-3">
            <SurfaceTitle>{title}</SurfaceTitle>
            {total > 0 && (
              <span
                className={cn(
                  genuiType.body,
                  "inline-flex shrink-0 items-center tabular-nums text-muted-foreground",
                )}
              >
                <span className="sr-only">
                  {label
                    ? checklistCountText(done, total, label)
                    : `${done} of ${total} done`}
                </span>
                <span aria-hidden className="inline-flex items-center">
                  <SlidingNumber number={done} initiallyStable />
                  {label ? `/${total} ${label}` : ` of ${total}`}
                </span>
              </span>
            )}
          </div>
          {/* Progress: decorative, the count above is the accessible value. */}
          <div
            aria-hidden
            className="h-1.5 overflow-hidden rounded-full bg-muted dark:bg-white/10"
          >
            <motion.div
              className={cn(
                "h-full rounded-full",
                done > 0 && done === total
                  ? "bg-emerald-500 dark:bg-emerald-400"
                  : "bg-choice",
              )}
              initial={false}
              animate={{ width: total ? `${(done / total) * 100}%` : "0%" }}
              transition={genuiMotion.gentle}
            />
          </div>
        </SurfaceHeader>

        <AutoHeight>
          <ScrollFade
            className="border-t border-border"
            viewportClassName={cn(
              "flex flex-col gap-5 overflow-y-auto",
              steps ? "py-0" : "py-3",
            )}
          >
            {sections.length === 0 && streaming && (
              <ul className={listClass}>{skeletonRow}</ul>
            )}
            {sections.map((section, s) => {
              const headingId = `${baseId}-group-${s}`
              const last = s === sections.length - 1
              return (
                <section
                  key={section.group ?? `section-${s}`}
                  aria-labelledby={section.group ? headingId : undefined}
                  className="flex flex-col"
                >
                  {section.group && (
                    <h4
                      id={headingId}
                      className={cn(
                        genuiType.body,
                        "px-3 pt-2 pb-1 font-semibold",
                      )}
                    >
                      {section.group}
                    </h4>
                  )}
                  <List className={listClass}>
                    {section.items.map(renderItem)}
                    {last && skeletonRow}
                  </List>
                </section>
              )
            })}
          </ScrollFade>
        </AutoHeight>

        {(submitLabel || status === "submitted") && (
          <SurfaceFooter aria-live="polite">
            {status === "submitted" ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4" />
                Sent: {done} of {total} done
              </p>
            ) : (
              <WhyDisabled className="inline-flex ml-auto" when={streaming} reason="Still loading…">
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={streaming}
                  onClick={submit}
                >
                  {submitLabel}
                </Button>
              </WhyDisabled>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
