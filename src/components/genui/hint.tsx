"use client"

import type * as React from "react"

import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * Names an element that has no text label (icon button, bare glyph). The
 * child becomes the tooltip trigger, so keep its own `aria-label`.
 */
function IconTip({
  label,
  side,
  children,
}: {
  label: React.ReactNode
  side?: "top" | "bottom" | "left" | "right"
  children: React.ReactElement
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Says why a button is disabled. A disabled button swallows pointer events,
 * so the tooltip hangs on a focusable span around it. Pass a `reason` (falsy
 * means the button is enabled and nothing is wrapped), or `when` + `reason`.
 */
function WhyDisabled({
  reason,
  when,
  className,
  children,
}: {
  reason?: React.ReactNode
  when?: boolean
  /** Classes for the wrapping span (default `inline-flex`). */
  className?: string
  children: React.ReactElement
}) {
  if (!(when ?? Boolean(reason))) return children
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable so keyboard users can read why it is disabled
          <span className={cn("inline-flex", className)} tabIndex={0} />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  )
}

export { IconTip, WhyDisabled }
