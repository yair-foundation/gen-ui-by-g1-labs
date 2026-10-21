"use client"

import type * as React from "react"
import { AnimatePresence, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"

/**
 * Selection and value-change motion shared by GenUI components.
 *
 * Timings and curves follow Halaska UI (https://ui.halaska.com, MIT License,
 * (c) Halaska): an Apple-style overshoot for marks that pop in, a short
 * blur or roll when a value is replaced, and a blur-up entrance for new rows.
 * Built on `motion`, so components carry their motion without extra CSS;
 * wrap the component in `<MotionConfig reducedMotion="user">` as usual.
 */

/** Easing curves. */
export const genuiEase = {
  /** Overshoot for small marks (radio dots, toggles). */
  spring: [0.34, 1.56, 0.64, 1],
  /** Strong deceleration for things arriving. */
  emphasized: [0.2, 0, 0, 1],
  easeOut: [0, 0, 0.2, 1],
  easeIn: [0.4, 0, 1, 1],
} as const

/** Blur-up entrance for rows, steps and messages as they arrive. */
export const genuiStepIn = {
  initial: { opacity: 0, y: 6, filter: "blur(2px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  transition: { duration: 0.25, ease: genuiEase.emphasized },
} as const

/**
 * The circle of a radio option: our 24px size, accent ring and a dot that
 * pops in with an overshoot. Purely visual; pair it with a native
 * `<input type="radio" className="sr-only">` inside the same label.
 */
export function RadioMark({
  checked,
  className,
}: {
  checked: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      data-checked={checked || undefined}
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-foreground/25 bg-transparent transition-[border-color,border-width] duration-300 ease-out data-checked:border-2 data-checked:border-choice data-checked:delay-150",
        className,
      )}
    >
      <AnimatePresence initial={false}>
        {checked && (
          <motion.span
            key="dot"
            className="size-2.5 rounded-full bg-choice"
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.45, 0.9, 1] }}
            exit={{ scale: 0, transition: { duration: 0.15, ease: genuiEase.easeIn } }}
            transition={{ duration: 0.4, times: [0, 0.45, 0.7, 1], ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
    </span>
  )
}

/** A checkmark that draws itself in when it mounts. */
export function CheckMark({
  className,
  delay = 0,
}: {
  className?: string
  delay?: number
}) {
  return (
    <svg
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={cn("size-3.5", className)}
    >
      <motion.polyline
        points="2,6 5,9 10,3"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.3, delay, ease: genuiEase.easeOut }}
      />
    </svg>
  )
}

const swapVariants = {
  blur: {
    initial: { opacity: 0, y: "30%", filter: "blur(3px)" },
    animate: { opacity: 1, y: "0%", filter: "blur(0px)" },
    exit: { opacity: 0, y: "-30%", filter: "blur(3px)" },
  },
  rolodex: {
    initial: { opacity: 0, y: "40%" },
    animate: { opacity: 1, y: "0%" },
    exit: { opacity: 0, y: "-40%" },
  },
} as const

/**
 * Replaces a value with a short transition when it changes: 'blur' (the old
 * value blurs up and out, the new one resolves in) or 'rolodex' (a vertical
 * flip). Use for totals, prices and labels that change as the user edits.
 * Screen readers read the current text; announce changes separately.
 */
export function SwapText({
  value,
  variant = "blur",
  className,
  ...props
}: {
  value: React.ReactNode
  /** Stable key for the value. Defaults to `String(value)`. */
  swapKey?: string
  variant?: keyof typeof swapVariants
  className?: string
}) {
  const key = props.swapKey ?? String(value)
  const v = swapVariants[variant]
  return (
    <span className={cn("inline-flex", className)}>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={key}
          className="inline-block whitespace-nowrap"
          initial={v.initial}
          animate={v.animate}
          exit={v.exit}
          transition={{
            duration: variant === "blur" ? 0.14 : 0.12,
            ease: genuiEase.easeOut,
          }}
        >
          {value}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

/**
 * Text with numbers in it ("$24.50", "04:59", "Month 14") whose digits roll
 * one by one as it changes. Each digit keeps its place counted from the right,
 * so only the changing ones move and a longer number doesn't re-roll the rest.
 * Visual only (`aria-hidden`): pair it with sr-only text. Digits 0 to 9 only.
 */
export function RollingDigits({ text }: { text: string }) {
  const chars = [...text]
  return (
    <span aria-hidden className="inline-flex items-baseline">
      {chars.map((ch, i) => {
        const place = chars.length - i
        return /\d/.test(ch) ? (
          <SlidingNumber key={place} number={Number(ch)} initiallyStable />
        ) : (
          <span key={place} className="whitespace-pre">
            {ch}
          </span>
        )
      })}
    </span>
  )
}
