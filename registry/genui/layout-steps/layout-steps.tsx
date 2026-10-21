"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceTitle,
  genuiHit,
} from "@/components/genui/surface"

import type { LayoutStep, LayoutStepsInput } from "./layout-steps.schema"

export type LayoutStepsProps = Partial<Omit<LayoutStepsInput, "steps">> & {
  /** Steps may be partial while the tool call streams. */
  steps?: Partial<LayoutStep>[]
  status?: "streaming" | "ready"
  /** Injected by GenUIRenderer: renders a child component from the catalog. */
  renderChild?: (child: LayoutStep, key: string) => React.ReactNode
  /** Injected by GenUIRenderer: each child's latest result, by key. */
  childResults?: Record<string, unknown>
  className?: string
}

/**
 * A procedure shown one step at a time: a stepper on top (numbers joined by a
 * line, a check once a step has its result), the current step below. A step
 * that produces a result moves the user on; Back and Next cover the rest.
 * Every step stays mounted, so going back keeps what was picked.
 */
export function LayoutSteps({
  title,
  steps = [],
  status = "ready",
  renderChild,
  childResults,
  className,
}: LayoutStepsProps) {
  const ready = steps.filter(
    (s): s is LayoutStep =>
      typeof s.component === "string" && typeof s.title === "string",
  )
  const streaming = status === "streaming"
  const last = ready.length - 1

  const [active, setActive] = React.useState(0)
  const [reached, setReached] = React.useState(0)
  const handled = React.useRef<Record<string, unknown>>({})
  // Going back to a finished step remounts it, so it asks again rather than
  // showing its receipt with no actions.
  const [resets, setResets] = React.useState<Record<number, number>>({})

  // A result on the current step moves the user to the next one.
  React.useEffect(() => {
    const key = String(active)
    const result = childResults?.[key]
    if (result === undefined || handled.current[key] === result) return
    handled.current[key] = result
    if (active < last) {
      setActive(active + 1)
      setReached((r) => Math.max(r, active + 1))
    }
  }, [childResults, active, last])

  const go = (i: number) => {
    if (i < 0 || i > last) return
    if (i < active) setResets((r) => ({ ...r, [i]: (r[i] ?? 0) + 1 }))
    setActive(i)
    setReached((r) => Math.max(r, i))
  }

  const current = ready[active]

  return (
    <Surface
      data-slot="layout-steps"
      data-status={status}
      aria-busy={streaming}
      aria-label={title ?? "Steps"}
      className={className}
    >
      <div className="flex flex-col gap-3 px-3 pt-3 pb-3">
        {title && <SurfaceTitle>{title}</SurfaceTitle>}

        {ready.length > 1 && (
          <nav aria-label="Progress">
            <ol className="flex items-center gap-2">
              {ready.map((step, i) => {
                const done = childResults?.[String(i)] !== undefined
                const isCurrent = i === active
                return (
                  <li
                    // biome-ignore lint/suspicious/noArrayIndexKey: positional layout slots
                    key={i}
                    className={cn(
                      "flex min-w-0 items-center gap-2",
                      i < last && "flex-1",
                    )}
                  >
                    <button
                      type="button"
                      disabled={i > reached}
                      aria-current={isCurrent ? "step" : undefined}
                      onClick={() => go(i)}
                      className={cn("relative", genuiHit, "flex min-w-0 items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default")}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums transition-colors",
                          done && !isCurrent
                            ? "border-transparent bg-choice text-background"
                            : isCurrent
                              ? "border-2 border-choice text-foreground"
                              : "border-border text-muted-foreground",
                        )}
                      >
                        {done && !isCurrent ? (
                          <CheckIcon className="size-4" strokeWidth={3} />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span
                        className={cn(
                          genuiType.label,
                          "truncate",
                          isCurrent
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <span className="sr-only">Step {i + 1}: </span>
                        {step.title}
                      </span>
                    </button>
                    {i < last && (
                      <span
                        aria-hidden
                        className={cn(
                          "h-px min-w-4 flex-1",
                          i < active ? "bg-choice" : "bg-border",
                        )}
                      />
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}

        {current?.description && (
          <p className={genuiType.meta}>{current.description}</p>
        )}
      </div>

      {/* The step's own card melts into this one: no border or radius. */}
      <div className="relative border-t border-border [&_section[data-variant=card]]:rounded-none [&_section[data-variant=card]]:border-0">
        {ready.map((step, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: positional layout slots
            key={i}
            hidden={i !== active}
            className="min-w-0"
          >
            {renderChild ? (
              <React.Fragment key={resets[i] ?? 0}>
                {renderChild(step, String(i))}
              </React.Fragment>
            ) : (
              <p className="text-sm text-muted-foreground">
                Needs GenUIRenderer
              </p>
            )}
          </div>
        ))}
        {streaming && ready.length < 2 && (
          <Skeleton aria-hidden className="h-32 rounded-[14px]" />
        )}
        {ready.length > 1 && active > 0 && (
          // Sits in the step's own footer row, level with its buttons.
          <Button
            size="sm"
            variant="secondary"
            className="absolute bottom-3 left-3"
            onClick={() => go(active - 1)}
          >
            Back
          </Button>
        )}
      </div>

    </Surface>
  )
}

/** Tells GenUIRenderer to pass `renderChild`. */
LayoutSteps.genuiLayout = true
