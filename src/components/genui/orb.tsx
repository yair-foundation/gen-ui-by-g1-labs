"use client"

import type * as React from "react"
import { motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"

/**
 * Orb: a compact, monochrome agent-activity indicator.
 *
 * Ported from Halaska UI's Orb (https://ui.halaska.com, MIT License,
 * (c) Halaska). Five variants keyed to agent tasks, drawn on a 24px stage
 * scaled to `size`, coloured with `currentColor`. The original uses injected
 * CSS keyframes; this port uses `motion`, so it ships without extra CSS.
 * Per-dot negative delays turn one shared animation into wavefronts, comets
 * and orbits. With reduced motion the dots stay still.
 */

export type OrbVariant = "pulse" | "orbit" | "sweep" | "globe" | "spark"

/** The task each variant stands for, used as the default label. */
export const orbTasks: Record<OrbVariant, string> = {
  pulse: "Thinking",
  orbit: "Searching",
  sweep: "Writing",
  globe: "Planning",
  spark: "Waiting",
}

export const orbVariants = Object.keys(orbTasks) as OrbVariant[]

const STAGE = 24
const easeInOut = [0.4, 0, 0.2, 1] as const

const lattice = Array.from({ length: 9 }, (_, i) => ({
  x: i % 3,
  y: Math.floor(i / 3),
}))
const ring = Array.from({ length: 8 }, (_, i) => i)

/** The shared "swell" keyframes: small and faint, then full, then back. */
const swell = {
  scale: [0.4, 1, 0.4, 0.4],
  opacity: [0.25, 1, 0.25, 0.25],
}
const swellTimes = [0, 0.25, 0.6, 1]

/** Eight stops around the flattened globe's track (x, y, depth scale, opacity). */
const globeTrack = [
  [9, 0, 1, 0.9],
  [6.4, 3.2, 0.95, 0.75],
  [0, 4.5, 0.85, 0.55],
  [-6.4, 3.2, 0.76, 0.4],
  [-9, 0, 0.7, 0.3],
  [-6.4, -3.2, 0.76, 0.4],
  [0, -4.5, 0.85, 0.55],
  [6.4, -3.2, 0.95, 0.75],
] as const
const globeLoop = [...globeTrack, globeTrack[0]]
const pick = (n: 0 | 1 | 2 | 3) => globeLoop.map((stop) => stop[n])

const dot = "absolute rounded-full bg-current"

function Cells({ variant, still }: { variant: OrbVariant; still: boolean }) {
  if (variant === "pulse" || variant === "sweep") {
    // 3×3 lattice: radial wavefront (pulse) or left-to-right band (sweep).
    return lattice.map(({ x, y }) => {
      const delay =
        variant === "pulse" ? Math.hypot(x - 1, y - 1) * 0.26 : x * 0.22
      return (
        <motion.span
          key={`${x}${y}`}
          className={dot}
          style={{ left: x * 8 + 2, top: y * 8 + 2, width: 4, height: 4 }}
          initial={still ? { opacity: 0.6 } : { scale: 0.4, opacity: 0.25 }}
          animate={still ? undefined : swell}
          transition={{
            duration: 1.6,
            times: swellTimes,
            ease: easeInOut,
            delay,
            repeat: Number.POSITIVE_INFINITY,
          }}
        />
      )
    })
  }

  if (variant === "orbit") {
    // Ring of 8: negative delays turn one swell into a comet chase.
    return ring.map((i) => {
      const a = (i / 8) * Math.PI * 2
      return (
        <motion.span
          key={i}
          className={dot}
          style={{
            left: 12 + Math.cos(a) * 9 - 1.75,
            top: 12 + Math.sin(a) * 9 - 1.75,
            width: 3.5,
            height: 3.5,
          }}
          initial={still ? { opacity: 0.6 } : { scale: 0.5, opacity: 0.2 }}
          animate={still ? undefined : swell}
          transition={{
            duration: 1.4,
            times: swellTimes,
            ease: easeInOut,
            delay: -(i / 8) * 1.4,
            repeat: Number.POSITIVE_INFINITY,
          }}
        />
      )
    })
  }

  if (variant === "globe") {
    // Dots share one elliptical track, spaced by negative delay: a flattened
    // globe spinning, with scale and opacity as the depth cue.
    return ring.map((i) => (
      <motion.span
        key={i}
        className={dot}
        style={{ left: 12 - 1.75, top: 12 - 1.75, width: 3.5, height: 3.5 }}
        initial={
          still
            ? { x: globeTrack[i][0], y: globeTrack[i][1], opacity: 0.6 }
            : { x: 9, y: 0, scale: 1, opacity: 0.9 }
        }
        animate={
          still
            ? undefined
            : { x: pick(0), y: pick(1), scale: pick(2), opacity: pick(3) }
        }
        transition={{
          duration: 3.2,
          ease: "linear",
          delay: -(i / 8) * 3.2,
          repeat: Number.POSITIVE_INFINITY,
        }}
      />
    ))
  }

  // spark: the ✦ glyph breathing, with a soft echo bursting outward.
  const glyph =
    "absolute inset-0 flex items-center justify-center text-[15px] leading-none"
  return (
    <>
      <motion.span
        className={glyph}
        initial={{ opacity: still ? 0.6 : 0.9 }}
        animate={
          still
            ? undefined
            : {
                rotate: [0, 90, 0],
                scale: [1, 0.7, 1],
                opacity: [0.9, 0.5, 0.9],
              }
        }
        transition={{
          duration: 2.4,
          ease: easeInOut,
          repeat: Number.POSITIVE_INFINITY,
        }}
      >
        ✦
      </motion.span>
      {!still && (
        <motion.span
          className={glyph}
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 1.3, 1.6], opacity: [0.9, 0.4, 0] }}
          transition={{
            duration: 2.4,
            times: [0, 0.6, 1],
            ease: "easeOut",
            repeat: Number.POSITIVE_INFINITY,
          }}
        >
          ✦
        </motion.span>
      )}
    </>
  )
}

export type OrbProps = {
  /** Which task the orb signals. Default `pulse` (Thinking). */
  variant?: OrbVariant
  /** Glyph size in px. Default 20. */
  size?: number
  /** Status text. Defaults to the variant's task, e.g. "Searching…". */
  label?: string
  /** Render as a filled pill with the label visible next to the glyph. */
  pill?: boolean
  /**
   * Announce the label as a live status (default true). Turn it off when the
   * orb sits inside another status region, so the label isn't announced twice.
   */
  announce?: boolean
  className?: string
}

export function Orb({
  variant = "pulse",
  size = 20,
  label,
  pill = false,
  announce = true,
  className,
}: OrbProps) {
  const still = useReducedMotion() ?? false
  const text = label || `${orbTasks[variant] ?? "Working"}…`
  const status: React.HTMLAttributes<HTMLSpanElement> = announce
    ? { role: "status", "aria-label": pill ? undefined : text }
    : {}

  const glyph = (
    <span
      aria-hidden
      className="relative inline-block shrink-0"
      style={{ width: size, height: size }}
    >
      <span
        className="absolute top-0 left-0 origin-top-left"
        style={{
          width: STAGE,
          height: STAGE,
          transform: `scale(${size / STAGE})`,
        }}
      >
        <Cells variant={variant} still={still} />
      </span>
    </span>
  )

  if (!pill) {
    return (
      <span
        data-slot="orb"
        data-variant={variant}
        {...status}
        className={cn("inline-flex text-muted-foreground", className)}
      >
        {glyph}
      </span>
    )
  }

  return (
    <span
      data-slot="orb"
      data-variant={variant}
      {...status}
      className={cn(
        "inline-flex h-[30px] items-center gap-[7px] rounded-full bg-muted pr-3 pl-1.5 text-[13px] leading-none text-muted-foreground",
        className,
      )}
    >
      {glyph}
      <span className="whitespace-nowrap">{text}</span>
    </span>
  )
}
