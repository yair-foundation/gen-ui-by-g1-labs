"use client"

import { InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { genuiType, Skeleton } from "@/components/genui/surface"

import type { CalloutInput } from "./callout.schema"

export type CalloutProps = Partial<CalloutInput> & {
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

// Tone changes the icon (and a critical title) colour only: one quiet surface, no stripes.
const tones = {
  note: {
    icon: InfoIcon,
    label: "Note",
    accent: "text-sky-500 dark:text-sky-400",
    tint: "bg-sky-500/10 dark:bg-sky-400/10",
    chip: "bg-sky-500/15 dark:bg-sky-400/15",
  },
  warning: {
    icon: TriangleAlertIcon,
    label: "Warning",
    accent: "text-orange-500 dark:text-orange-400",
    tint: "bg-orange-500/10 dark:bg-orange-400/10",
    chip: "bg-orange-500/15 dark:bg-orange-400/15",
  },
  critical: {
    icon: OctagonAlertIcon,
    label: "Critical",
    accent: "text-destructive",
    tint: "bg-red-500/10 dark:bg-red-400/10",
    chip: "bg-red-500/15 dark:bg-red-400/15",
  },
} as const

/** Only http(s) links are rendered as links. */
function safeHref(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

export function Callout({
  tone = "note",
  title,
  text,
  source,
  status = "ready",
  className,
}: CalloutProps) {
  const t = tones[tone] ?? tones.note
  const Icon = t.icon
  const href = safeHref(source?.url)

  return (
    <MotionConfig reducedMotion="user">
      <motion.aside
        data-genui=""
        data-slot="callout"
        data-tone={tone}
        data-status={status}
        aria-busy={status === "streaming"}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className={cn(
          "flex rounded-[10px] border border-border bg-transparent",
          "p-1",
          className,
        )}
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 gap-3",
            "rounded-md px-3 py-3",
            t.tint,
          )}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "inline-flex size-8 shrink-0 items-center justify-center rounded-md",
                    t.chip,
                  )}
                />
              }
            >
              <Icon aria-hidden className={cn("size-4 shrink-0", t.accent)} />
            </TooltipTrigger>
            <TooltipContent>{t.label}</TooltipContent>
          </Tooltip>
          <div
            className={cn(
              genuiType.body,
              "flex min-w-0 flex-1 flex-col gap-1",
              !title && "min-h-8 justify-center",
            )}
          >
            {title && (
              <p
                className={cn(
                  "text-[15px] leading-snug font-medium",
                  tone === "critical" && "text-destructive",
                )}
              >
                <span className="sr-only">{t.label}: </span>
                {title}
              </p>
            )}
            {text ? (
              <p
                className={cn("text-pretty", title && "text-muted-foreground")}
              >
                {!title && <span className="sr-only">{t.label}: </span>}
                {text}
              </p>
            ) : (
              <Skeleton className="h-4 w-3/4" />
            )}
            {source &&
              (href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={cn(
                    genuiType.meta,
                    "w-fit rounded-sm underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50",
                  )}
                >
                  {source.label}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : (
                <span className={genuiType.meta}>{source.label}</span>
              ))}
          </div>
        </div>
      </motion.aside>
    </MotionConfig>
  )
}
