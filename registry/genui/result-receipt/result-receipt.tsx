"use client"

import * as React from "react"
import {
  ArrowRightIcon,
  CheckIcon,
  ExternalLinkIcon,
  RotateCcwIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { WhyDisabled } from "@/components/genui/hint"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  ReceiptItem,
  ResultReceiptInput,
  ResultReceiptResult,
} from "./result-receipt.schema"
import { RollingDigits } from "@/components/genui/genui-motion"
import { useGenUILocale } from "@/components/genui/locale"

/** Explains a disabled button. Disabled controls swallow pointer events, so the span takes the hover. */
export type ResultReceiptStatus = "streaming" | "ready" | "undone"

export type ResultReceiptProps = Partial<Omit<ResultReceiptInput, "items">> & {
  /** Items may be partial while the tool call streams. */
  items?: Partial<ReceiptItem>[]
  /**
   * Lifecycle, controlled by the host. When omitted, the component tracks
   * the user's undo itself.
   */
  status?: ResultReceiptStatus
  /** Called once when the user presses Undo. Send it back to the agent. */
  onResult?: (result: ResultReceiptResult) => void
  /** An undo from history. Shows "Undo requested"; never calls onResult. */
  result?: ResultReceiptResult
  className?: string
}

function safeUrl(url?: string) {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

function parseTime(iso?: string) {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

function formatCompleted(time: number, locale: string) {
  const date = new Date(time)
  const sameDay = date.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat(
    locale,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { dateStyle: "medium", timeStyle: "short" },
  ).format(date)
}

/** "4:59", or "1:04:59" past an hour. */
function formatRemaining(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

/**
 * The current time, ticking every second while `active`. Null until mounted,
 * so server and client render the same markup.
 */
function useNow(active: boolean) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    setNow(Date.now())
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

export function ResultReceipt({
  title,
  target,
  items = [],
  completedAt,
  undo,
  link,
  status: statusProp,
  onResult,
  result,
  className,
}: ResultReceiptProps) {
  const locale = useGenUILocale()
  const countdownId = React.useId()
  const [undone, setUndone] = React.useState(result?.action === "undo")

  // A host-provided "ready" (or nothing) yields to the user's undo.
  const status: ResultReceiptStatus =
    undone && (statusProp === undefined || statusProp === "ready")
      ? "undone"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const completed = parseTime(completedAt)
  const deadline = parseTime(undo?.until)
  const [expiredAt, setExpiredAt] = React.useState<number | null>(null)
  const counting =
    undo !== undefined &&
    deadline !== null &&
    status === "ready" &&
    expiredAt !== deadline
  const now = useNow(counting)
  const remaining = deadline !== null && now !== null ? deadline - now : null
  const expired = remaining !== null && remaining <= 0

  // Stop ticking once the deadline passes.
  React.useEffect(() => {
    if (expired && deadline !== null) setExpiredAt(deadline)
  }, [expired, deadline])

  const ready = items.filter(
    (i): i is ReceiptItem => typeof i.label === "string" && i.label !== "",
  )
  const href = safeUrl(link?.url)

  const requestUndo = () => {
    if (status !== "ready" || expired) return
    setUndone(true)
    onResult?.({ action: "undo" })
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="result-receipt"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Result"}
        className={className}
      >
        <SurfaceHeader className="gap-1 pb-3">
          {/* The outcome is the answer, so it is the focal line. */}
          <div className="flex items-start gap-2">
            {title && (
              <CheckIcon aria-hidden className="mt-1 size-5 shrink-0" />
            )}
            <SurfaceTitle
              className={cn(genuiType.display, "text-xl leading-tight")}
            >
              {title}
            </SurfaceTitle>
          </div>
          {target?.label && (
            <p className={genuiType.meta}>
              {target.kind && <span className="sr-only">{target.kind}: </span>}
              {target.label}
            </p>
          )}
        </SurfaceHeader>

        <AutoHeight>
          <ul
            className={cn(
              "flex flex-col gap-2",
              (ready.length > 0 || streaming) &&
                "border-t border-border px-3 py-3",
            )}
          >
            {ready.map((item, index) => (
              <motion.li
                // biome-ignore lint/suspicious/noArrayIndexKey: items have no id and only append while streaming
                key={index}
                data-slot="result-receipt-item"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className={cn(
                  genuiType.body,
                  "flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4",
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="break-words">{item.label}</span>
                  {item.detail && (
                    <span className={cn(genuiType.meta, "break-words")}>
                      {item.detail}
                    </span>
                  )}
                </div>
                {(item.before || item.after) && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 sm:shrink-0 sm:justify-end">
                    {item.before && (
                      <span className="break-words text-muted-foreground line-through decoration-muted-foreground/60">
                        <span className="sr-only">Was </span>
                        {item.before}
                      </span>
                    )}
                    {item.before && item.after && (
                      <ArrowRightIcon
                        aria-hidden
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    )}
                    {item.after && (
                      <span className="font-medium break-words">
                        <span className="sr-only">
                          {item.before ? ", now " : "Now "}
                        </span>
                        {item.after}
                      </span>
                    )}
                  </div>
                )}
              </motion.li>
            ))}
            {streaming && (
              <li aria-hidden className="flex gap-4 py-1">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="ml-auto h-4 w-1/4" />
              </li>
            )}
          </ul>
        </AutoHeight>

        <SurfaceFooter className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className={cn(genuiType.meta, "flex min-w-0 flex-col gap-0.5")}>
            {streaming ? (
              <ShimmeringText
                text="Loading…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : (
              completed !== null && (
                <span>
                  <span className="sr-only">Completed at </span>
                  <time
                    dateTime={completedAt}
                    suppressHydrationWarning
                    className="tabular-nums"
                  >
                    {formatCompleted(completed, locale)}
                  </time>
                </span>
              )
            )}
            {/* Ticks every second, so it is read on focus of Undo rather than announced. */}
            {undo && status === "ready" && remaining !== null && !expired && (
              <span id={countdownId} className="sr-only">
                Undo available for {formatRemaining(remaining)}
              </span>
            )}
            <p aria-live="polite">
              {status === "undone" ? (
                <span
                  className={cn(
                    genuiType.body,
                    "flex items-center gap-1.5 text-foreground",
                  )}
                >
                  <RotateCcwIcon aria-hidden className="size-4 shrink-0" />
                  Undo requested
                </span>
              ) : undo && status === "ready" && expired ? (
                "Undo expired"
              ) : null}
            </p>
          </div>

          {(href || (undo && status !== "undone")) && (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {href && link && (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "flex-1 sm:flex-none",
                  )}
                >
                  {link.label}
                  <ExternalLinkIcon aria-hidden />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              )}
              {undo && status !== "undone" && (
                <WhyDisabled
                  when={status === "ready" && expired}
                  reason="Undo window has passed"
                  className="flex-1 sm:flex-none"
                >
                  <Button
                    size="sm"
                    onClick={requestUndo}
                    disabled={
                      status !== "ready" ||
                      expired ||
                      // Unknown until mounted: don't offer an undo that may be past its deadline.
                      (deadline !== null && now === null)
                    }
                    aria-describedby={
                      remaining !== null && !expired ? countdownId : undefined
                    }
                    className="flex-1 sm:flex-none"
                  >
                    <RotateCcwIcon aria-hidden />
                    {undo.label ?? "Undo"}
                    {/* The window is shown on the button it applies to. */}
                    {status === "ready" && remaining !== null && !expired && (
                      <span
                        aria-hidden
                        className="text-muted-foreground tabular-nums"
                      >
                        <RollingDigits text={formatRemaining(remaining)} />
                      </span>
                    )}
                  </Button>
                </WhyDisabled>
              )}
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
