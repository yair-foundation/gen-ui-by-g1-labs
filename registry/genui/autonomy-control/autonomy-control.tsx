"use client"

import * as React from "react"
import { AnimatePresence, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
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
  RadioMark,
  SwapText,
} from "@/components/genui/genui-motion"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

import type {
  AutonomyControlInput,
  AutonomyControlResult,
  AutonomyLevel,
} from "./autonomy-control.schema"
import { WhyDisabled } from "@/components/genui/hint"

export type AutonomyControlStatus = "streaming" | "ready"

export type AutonomyControlProps = Partial<
  Omit<AutonomyControlInput, "levels">
> & {
  /** Levels may be partial while the tool call is still streaming. */
  levels?: (Partial<Omit<AutonomyLevel, "details">> & {
    details?: (string | undefined)[]
  })[]
  /** Lifecycle, controlled by the host. Controls are disabled while 'streaming'. */
  status?: AutonomyControlStatus
  /** Called with { action: "set" } each time the user saves a new level. */
  onResult?: (result: AutonomyControlResult) => void
  /**
   * The last result from history. Restores the level and never calls
   * onResult; the control stays usable, so the user can change it again.
   */
  result?: AutonomyControlResult
  className?: string
}

type ReadyLevel = Omit<AutonomyLevel, "details"> & { details: string[] }

function readyLevels(levels: AutonomyControlProps["levels"]): ReadyLevel[] {
  const out: ReadyLevel[] = []
  for (const l of levels ?? []) {
    if (typeof l.id !== "string" || typeof l.label !== "string") continue
    out.push({
      id: l.id,
      label: l.label,
      summary: l.summary ?? "",
      details: (l.details ?? []).filter(
        (d): d is string => typeof d === "string" && d.trim() !== "",
      ),
    })
  }
  return out
}

function LevelSkeleton() {
  return (
    <div aria-hidden className="flex min-h-16 items-center gap-3 px-4">
      <Skeleton className="size-6 shrink-0 rounded-full" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-52" />
      </span>
    </div>
  )
}

/** How far along the scale the level sits. Decorative; the radio says it. */
function LevelMeter({ index, total }: { index: number; total: number }) {
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-1">
      {Array.from({ length: total }, (_, i) => (
        <motion.span
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions on a scale.
          key={i}
          className="h-2 w-4 rounded-full"
          initial={false}
          animate={{
            backgroundColor: i <= index ? "var(--choice)" : "var(--muted)",
          }}
          transition={{
            duration: 0.25,
            delay: i * 0.03,
            ease: genuiEase.easeOut,
          }}
        />
      ))}
    </span>
  )
}

export function AutonomyControl({
  question,
  title,
  context,
  levels: levelsProp,
  levelId,
  recommendedId,
  status: statusProp,
  onResult,
  result,
  className,
}: AutonomyControlProps) {
  const [chosen, setChosen] = React.useState<string | null>(
    () => result?.level ?? null,
  )
  // The last level sent to the agent in this session (or restored).
  const [saved, setSaved] = React.useState<string | null>(
    () => result?.level ?? null,
  )
  const [announcement, setAnnouncement] = React.useState("")
  const baseId = React.useId()

  const status: AutonomyControlStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const levels = readyLevels(levelsProp)
  const interactive = !streaming && levels.length > 1

  const find = (id: string | null | undefined) =>
    id ? levels.find((l) => l.id === id) : undefined
  const current = find(saved) ?? find(levelId) ?? levels[0]
  const selected = find(chosen) ?? current
  const selectedIndex = selected ? levels.indexOf(selected) : -1
  const dirty = Boolean(selected && current && selected.id !== current.id)
  // Choosing a level above the one in effect gives the agent more room to act.
  const raises = dirty && levels.indexOf(selected) > levels.indexOf(current)

  const choose = (l: ReadyLevel) => {
    if (!interactive) return
    setChosen(l.id)
    setAnnouncement(
      [l.label, l.summary, l.id === current?.id ? "Current level." : ""]
        .filter(Boolean)
        .join(". "),
    )
  }

  const save = () => {
    if (!interactive || !selected || !dirty) return
    setSaved(selected.id)
    setAnnouncement(`Saved. The agent now works at: ${selected.label}.`)
    // History results are restored, never re-sent; a new choice is sent.
    onResult?.({ action: "set", level: selected.id })
  }

  return (
    <MotionConfig reducedMotion="user">
      {question && (
        <h2 className={cn(genuiType.title, "mb-3 text-[16px]")}>{question}</h2>
      )}
      <Surface
        data-slot="autonomy-control"
        data-status={status}
        data-level={current?.id}
        aria-busy={streaming}
        aria-label={title ?? "Autonomy"}
        className={className}
      >
        <SurfaceHeader>
          <div className="flex items-start gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <SurfaceTitle id={`${baseId}-title`}>{title}</SurfaceTitle>
              {context && <p className={genuiType.meta}>{context}</p>}
            </div>
            {levels.length > 1 && selectedIndex >= 0 && (
              <span className="mt-1.5">
                <LevelMeter index={selectedIndex} total={levels.length} />
              </span>
            )}
          </div>
        </SurfaceHeader>

        <div
          role="radiogroup"
          aria-labelledby={title ? `${baseId}-title` : undefined}
          aria-label={title ? undefined : "Autonomy level"}
          className="flex flex-col gap-2 border-t border-border px-3 py-3"
        >
          {levels.map((l) => {
            const isSelected = l.id === selected?.id
            const isCurrent = l.id === current?.id
            const tags = [
              isCurrent && "Current",
              l.id === recommendedId && "Recommended",
            ].filter((t): t is string => Boolean(t))
            const descId = `${baseId}-${l.id}-desc`
            return (
              <motion.label
                key={l.id}
                data-slot="autonomy-control-level"
                data-checked={isSelected || undefined}
                {...genuiStepIn}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-[10px] px-3 py-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 data-checked:ring-2 data-checked:ring-choice data-checked:ring-inset data-checked:hover:bg-transparent dark:data-checked:hover:bg-transparent",
                  interactive
                    ? "hover:bg-muted dark:hover:bg-white/5"
                    : "cursor-default",
                )}
              >
                <input
                  type="radio"
                  name={`${baseId}-level`}
                  value={l.id}
                  checked={isSelected}
                  disabled={!interactive}
                  aria-describedby={descId}
                  onChange={() => choose(l)}
                  className="sr-only"
                />
                <RadioMark checked={isSelected} className="mt-0.5" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn(genuiType.body, "font-semibold")}>
                      {l.label}
                    </span>
                    {tags.map((t) => (
                      <Badge
                        key={t}
                        variant={t === "Recommended" ? "success" : "info"}
                      >
                        {t}
                      </Badge>
                    ))}
                  </span>
                  <span id={descId} className={genuiType.meta}>
                    {l.summary || <Skeleton className="mt-1 h-3 w-40" />}
                  </span>
                  {/* What the level means in practice, opened when selected. */}
                  <AnimatePresence initial={false}>
                    {isSelected && l.details.length > 0 && (
                      <motion.ul
                        key="details"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{
                          duration: 0.35,
                          ease: genuiEase.emphasized,
                        }}
                        className="overflow-hidden"
                      >
                        {l.details.map((d, i) => (
                          <motion.li
                            key={d}
                            initial={{ opacity: 0, y: 4 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{
                              ...genuiMotion.fade,
                              delay: 0.08 + i * 0.05,
                            }}
                            className={cn(
                              genuiType.body,
                              "flex items-start gap-2 first:pt-2.5 [&:not(:first-child)]:pt-1",
                            )}
                          >
                            <span
                              aria-hidden
                              className="mt-[0.6em] size-1 shrink-0 rounded-full bg-muted-foreground"
                            />
                            {d}
                          </motion.li>
                        ))}
                      </motion.ul>
                    )}
                  </AnimatePresence>
                </span>
              </motion.label>
            )
          })}
          {streaming && <LevelSkeleton />}
        </div>

        <SurfaceFooter className="justify-between gap-3">
          <p
            className={cn(genuiType.meta, "flex min-h-5 items-center gap-1.5")}
          >
            {streaming ? (
              <Skeleton className="h-4 w-32" />
            ) : saved && !dirty ? (
              <>
                <CheckMark className="size-3.5 text-foreground" />
                Saved
              </>
            ) : dirty ? (
              raises ? (
                "Not saved yet · gives the agent more freedom"
              ) : (
                "Not saved yet"
              )
            ) : null}
          </p>
          <WhyDisabled
            when={!interactive || !dirty}
            reason="Change the level first"
          >
            <Button
              disabled={!interactive || !dirty}
              onClick={save}
              className="min-h-11"
            >
              {dirty && selected ? (
                <>
                  <span>Set to</span>
                  <SwapText value={selected.label} />
                </>
              ) : (
                "Save"
              )}
            </Button>
          </WhyDisabled>
        </SurfaceFooter>
        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>
      </Surface>
    </MotionConfig>
  )
}
