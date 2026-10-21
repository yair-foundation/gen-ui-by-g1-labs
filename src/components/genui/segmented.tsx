"use client"

import type * as React from "react"

import { IconTip, WhyDisabled } from "@/components/genui/hint"

import { cn } from "@/lib/utils"

/**
 * A segmented control: one choice of 2–5 views or modes (Table / Raw,
 * Day / Week). A hollow bordered track, equal segments filling the width,
 * the selected one filled (`dark:bg-accent`). Buttons with `aria-pressed`
 * under a hidden legend. Leave 12px between it and the content it switches.
 */
export type SegmentedOption<T extends string> = {
  value: T
  label: React.ReactNode
  /** The spoken name, when the label is an icon or abbreviation. */
  ariaLabel?: string
  /** A tooltip (icon-only segments need one). */
  tip?: string
  /** Turns this one segment off; `disabledReason` says why in a tooltip. */
  disabled?: boolean
  disabledReason?: string
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  fit,
  className,
}: {
  /** What the choice is about, for screen readers, e.g. "Forecast view". */
  label: string
  /** The selected value; "" when nothing is selected yet. */
  value: T | ""
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
  /**
   * Compact, for a header row: the track hugs its labels (each segment as
   * wide as the longest one) and never truncates. Default: fill the width.
   */
  fit?: boolean
  className?: string
}) {
  return (
    <fieldset
      className={cn("m-0 border-0 p-0", fit ? "flex-none" : "min-w-0 flex-1", className)}
      disabled={disabled}
    >
      <legend className="sr-only">{label}</legend>
      <div
        className={cn(
          "gap-0.5 rounded-full border border-border p-1",
          // Equal segments: grid columns as wide as the widest label, or a
          // full-width flex row.
          fit ? "inline-grid auto-cols-fr grid-flow-col" : "flex w-full",
        )}
      >
        {options.map((o) => {
          const button = (
            <button
              type="button"
              aria-label={o.ariaLabel}
              aria-pressed={value === o.value}
              disabled={o.disabled}
              onClick={() => onChange(o.value)}
              className="relative after:absolute after:top-1/2 after:left-1/2 after:size-full after:min-h-11 after:min-w-11 after:-translate-x-1/2 after:-translate-y-1/2 inline-flex h-8 w-full min-w-0 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-accent aria-pressed:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
            >
              {typeof o.label === "string" && !fit ? <span className="truncate">{o.label}</span> : o.label}
            </button>
          )
          // Each segment takes an equal share; a tooltip or a disabled reason wraps it.
          return (
            <span key={o.value} className={cn("flex", !fit && "min-w-0 flex-1")}>
              {o.disabled && o.disabledReason ? (
                <WhyDisabled reason={o.disabledReason}>{button}</WhyDisabled>
              ) : o.tip ? (
                <IconTip label={o.tip}>{button}</IconTip>
              ) : (
                button
              )}
            </span>
          )
        })}
      </div>
    </fieldset>
  )
}
