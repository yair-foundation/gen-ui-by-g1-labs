"use client"

import { cn } from "@/lib/utils"
import { Orb, type OrbVariant } from "@/components/genui/orb"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
} from "@/components/genui/surface"

import type { StreamingSkeletonInput } from "./streaming-skeleton.schema"

export type GenUIPlaceholderProps = StreamingSkeletonInput & {
  className?: string
}

const defaultLines: Record<
  NonNullable<StreamingSkeletonInput["shape"]>,
  number
> = {
  card: 3,
  table: 4,
  list: 4,
  text: 3,
  media: 1,
}

type Activity = NonNullable<StreamingSkeletonInput["activity"]>

/** Each activity's orb (Halaska UI's task glyphs). */
const activityOrb: Record<Activity, OrbVariant> = {
  thinking: "pulse",
  searching: "orbit",
  writing: "sweep",
  planning: "globe",
  waiting: "spark",
}

// Fixed widths, so placeholders never shift between renders.
const widths = ["w-full", "w-11/12", "w-4/5", "w-5/6", "w-3/4"]

/** The shared Skeleton pulses; stop it for users who ask for less motion. */
const still = "motion-reduce:animate-none"

function Bone({ className }: { className?: string }) {
  return <Skeleton className={cn(still, className)} />
}

function clampLines(lines: number | undefined, fallback: number) {
  if (typeof lines !== "number" || !Number.isFinite(lines)) return fallback
  return Math.min(12, Math.max(1, Math.round(lines)))
}

/**
 * A placeholder the host renders while a tool call's name or props are still
 * unknown. Swap it for the real component as soon as the name arrives.
 */
export function GenUIPlaceholder({
  shape = "card",
  lines,
  label,
  activity,
  className,
}: GenUIPlaceholderProps) {
  const count = clampLines(lines, defaultLines[shape] ?? 3)
  const rows = Array.from({ length: count }, (_, i) => i)
  const common = {
    "data-slot": "streaming-skeleton",
    "data-status": "streaming",
    "data-shape": shape,
    role: "status",
    "aria-busy": true,
  } as const
  const variant = activity ? activityOrb[activity] : undefined
  // With an activity, the orb's visible label is the status text (announced
  // by this root, so the orb itself stays quiet). Otherwise it's sr-only.
  const status = variant ? null : (
    <span className="sr-only">{label ?? "Generating…"}</span>
  )
  const orb = variant ? (
    <Orb variant={variant} label={label} pill announce={false} />
  ) : null

  if (shape === "text") {
    return (
      <Surface
        variant="flush"
        {...common}
        className={cn("flex flex-col gap-2 py-1", className)}
      >
        {status}
        {orb && <div className="pb-1">{orb}</div>}
        {rows.map((i) => (
          <Bone
            key={i}
            className={cn(
              "h-4",
              i === count - 1 && count > 1
                ? "w-3/5"
                : widths[i % widths.length],
            )}
          />
        ))}
      </Surface>
    )
  }

  if (shape === "table") {
    return (
      <Surface variant="flush" {...common} className={className}>
        {status}
        {orb && <div className="pb-2">{orb}</div>}
        <div className="flex gap-4 border-b py-2.5">
          <Bone className="h-3 w-1/4" />
          <Bone className="h-3 w-1/5" />
          <Bone className="ml-auto h-3 w-16" />
        </div>
        {rows.map((i) => (
          <div key={i} className="flex gap-4 border-b py-3 last:border-b-0">
            <Bone className={cn("h-4", i % 2 ? "w-1/3" : "w-1/4")} />
            <Bone className={cn("h-4", i % 2 ? "w-1/6" : "w-1/5")} />
            <Bone className="ml-auto h-4 w-16" />
          </div>
        ))}
      </Surface>
    )
  }

  if (shape === "list") {
    return (
      <Surface {...common} className={className}>
        {status}
        <SurfaceHeader>
          {orb && <div className="pb-2">{orb}</div>}
          <Bone className="h-5 w-48 max-w-full" />
        </SurfaceHeader>
        <div className="flex flex-col divide-y">
          {rows.map((i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Bone className="size-4 shrink-0" />
              <Bone className={cn("h-4", widths[(i + 1) % widths.length])} />
            </div>
          ))}
        </div>
      </Surface>
    )
  }

  if (shape === "media") {
    return (
      <Surface {...common} className={className}>
        {status}
        {orb && <div className="px-3 pt-3 pb-3">{orb}</div>}
        <Bone className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-2 px-3 py-3">
          {rows.map((i) => (
            <Bone
              key={i}
              className={cn(
                "h-4",
                i === 0 ? "w-1/2" : widths[i % widths.length],
              )}
            />
          ))}
        </div>
      </Surface>
    )
  }

  return (
    <Surface {...common} className={className}>
      {status}
      {/* Mirrors a GenUI card: title, one focal value, label/value pairs. */}
      <SurfaceHeader>
        {orb && <div className="pb-2">{orb}</div>}
        <Bone className="h-5 w-48 max-w-full" />
      </SurfaceHeader>
      <div className="border-t border-border px-3 py-3">
        <Bone className="h-8 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-x-10 gap-y-3 border-t border-border px-3 py-3">
        {rows.map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Bone className="h-3 w-16" />
            <Bone className={cn("h-4", i % 2 ? "w-2/3" : "w-4/5")} />
          </div>
        ))}
      </div>
      <SurfaceFooter className="justify-end">
        <Bone className="h-9 w-20 rounded-md" />
        <Bone className="h-9 w-28 rounded-md" />
      </SurfaceFooter>
    </Surface>
  )
}
