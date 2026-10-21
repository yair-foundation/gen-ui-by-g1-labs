"use client"

import * as React from "react"
import {
  CheckIcon,
  ChevronDownIcon,
  LifeBuoyIcon,
  MessageSquareIcon,
  NotebookPenIcon,
  PhoneIcon,
  ReceiptTextIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { FormField, formTextareaClass } from "@/components/genui/form-field"
import { useGenUILocale } from "@/components/genui/locale"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  arrivalText,
  currentStageIndex,
  formatRating,
  formatStageTime,
  headingText,
  initialsOf,
  instructionsLabel,
  isComplete,
  itemsSummary,
  merchantContactLabel,
  parseTime,
  remaining,
  remainingBadge,
  resolveActions,
  resolveNow,
  safeImageSrc,
  stepSpoken,
  streetOnly,
  type DeliveryAction,
} from "./delivery-tracker-utils"
import type {
  DeliveryCourier,
  DeliveryStage,
  DeliveryTrackerInput,
  DeliveryTrackerResult,
} from "./delivery-tracker.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { LogoTile } from "@/components/genui/logo-tile"

export type DeliveryTrackerStatus = "streaming" | "ready"

export type DeliveryTrackerProps = Partial<
  Omit<
    DeliveryTrackerInput,
    "merchant" | "stages" | "eta" | "courier" | "items" | "issue"
  >
> & {
  /** Everything may be partial while the tool call streams. */
  merchant?: {
    name?: string
    logo?: { src?: string; alt?: string }
    color?: string
  }
  stages?: Partial<DeliveryStage>[]
  eta?: { at?: string; windowEnd?: string }
  courier?: Partial<Omit<DeliveryCourier, "photo">> & {
    photo?: { src?: string; alt?: string }
  }
  items?: { name?: string; quantity?: number }[]
  issue?: {
    kind?: "delayed" | "address-problem" | "failed-attempt"
    message?: string
  }
  /**
   * The moment minutes left are measured from. Defaults to the viewer's clock,
   * read after mount and every 30 seconds.
   */
  now?: Date | string | number
  /** Lifecycle, controlled by the host. The card never locks after an action. */
  status?: DeliveryTrackerStatus
  /** Called on every action. The host hands it to the service. */
  onResult?: (result: DeliveryTrackerResult) => void
  /** The last action from history. Shows its confirmation; never calls onResult. */
  result?: DeliveryTrackerResult
  className?: string
}

type ReadyStage = DeliveryStage

const ISSUE_LABEL = {
  delayed: "Delayed",
  "address-problem": "Address problem",
  "failed-attempt": "Missed delivery",
} as const

const entry = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

/**
 * The current time: the host's `now`, or the viewer's clock read after mount
 * (so server and client render the same markup) and refreshed every 30 s.
 */
function useNow(fixed: number | null) {
  const [now, setNow] = React.useState<number | null>(null)
  React.useEffect(() => {
    if (fixed !== null) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [fixed])
  return fixed ?? now
}

/** The quiet line shown after an action, so the user knows it went through. */
function confirmation(
  r: DeliveryTrackerResult,
  courierName: string | undefined,
  merchantName: string | undefined,
): string {
  switch (r.action) {
    case "contact-courier":
      return `Asked to connect you with ${courierName ?? "your courier"}`
    case "contact-merchant":
      return `Asked to connect you with ${merchantName ?? "the merchant"}`
    case "change-instructions":
      return "Instructions sent"
    case "get-help":
      return "Help requested"
  }
}

function Avatar({
  courier,
}: {
  courier: Partial<Omit<DeliveryCourier, "photo">> & {
    photo?: { src?: string; alt?: string }
  }
}) {
  const [failed, setFailed] = React.useState(false)
  const src = safeImageSrc(courier.photo?.src)
  const initials = (courier.initials || initialsOf(courier.name)).slice(0, 3)
  if (src && !failed) {
    return (
      // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
      <img
        src={src}
        alt={courier.photo?.alt ?? ""}
        onError={() => setFailed(true)}
        className="size-10 shrink-0 rounded-full bg-muted object-cover"
      />
    )
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-transparent text-[13px] font-medium"
    >
      {initials}
    </span>
  )
}

export function DeliveryTracker({
  kind,
  merchant,
  orderNumber,
  stages = [],
  eta,
  courier,
  items,
  address,
  issue,
  asOf,
  actions,
  now: nowProp,
  status: statusProp,
  onResult,
  result,
  className,
}: DeliveryTrackerProps) {
  const locale = useGenUILocale()
  const reduceMotion = useReducedMotion()
  const status: DeliveryTrackerStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const now = useNow(resolveNow(nowProp))
  const titleId = React.useId()
  const itemsId = React.useId()
  const instructionsId = React.useId()

  const [confirmed, setConfirmed] =
    React.useState<DeliveryTrackerResult | null>(result ?? null)
  const [itemsOpen, setItemsOpen] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [text, setText] = React.useState("")
  const [announcement, setAnnouncement] = React.useState("")
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const instructionsButtonRef = React.useRef<HTMLButtonElement>(null)

  const ready = stages.filter(
    (s): s is ReadyStage =>
      typeof s.id === "string" &&
      typeof s.label === "string" &&
      (s.state === "done" || s.state === "current" || s.state === "upcoming"),
  )
  const complete = !streaming && isComplete(ready)
  const index = currentStageIndex(ready)
  const stage = index >= 0 ? ready[index] : undefined
  // While streaming, a partial list whose stages are all done isn't "Delivered".
  const settling = streaming && isComplete(ready)
  const heading = settling ? "" : headingText(ready, locale)
  const spoken = settling ? "" : stepSpoken(ready)
  const reference = now ?? parseTime(asOf)?.t ?? null
  const arrival = complete ? "" : arrivalText(eta, { reference, locale })
  const badge =
    complete || streaming ? null : remainingBadge(remaining(eta?.at, now))

  const merchantName = merchant?.name
  const logoSrc = safeImageSrc(merchant?.logo?.src)
  // The brand colour tints the progress bar; anything but #rrggbb is ignored.
  const brand = /^#[0-9a-f]{6}$/i.test(merchant?.color ?? "")
    ? (merchant?.color as string)
    : undefined
  const courierReady =
    courier && typeof courier.name === "string" ? courier : undefined
  const rating = formatRating(courierReady?.rating)
  const readyItems = (items ?? []).filter(
    (i): i is { name: string; quantity: number } =>
      typeof i.name === "string" && typeof i.quantity === "number",
  )
  const summary = itemsSummary(readyItems, orderNumber)
  const street = streetOnly(address)
  const issueReady =
    issue?.kind && typeof issue.message === "string" ? issue : undefined

  const available: DeliveryAction[] =
    ready.length > 0 ? resolveActions(actions, kind, ready, courierReady) : []
  const canCall =
    !complete &&
    Boolean(courierReady?.phoneAvailable) &&
    available.includes("contact-courier")
  const footerActions = available.filter((a) => a !== "contact-courier")

  // Announce stage changes and new issues from live re-renders, never the
  // first render.
  const heard = React.useRef<{ stage: string; issue: string } | null>(null)
  const stageKey = complete ? "complete" : (stage?.id ?? "")
  const issueText = issueReady?.message ?? ""
  React.useEffect(() => {
    if (streaming || !stageKey) return
    const prev = heard.current
    heard.current = { stage: stageKey, issue: issueText }
    if (prev === null) return
    const parts: string[] = []
    if (prev.stage !== stageKey) parts.push(complete ? heading : spoken)
    if (issueText && issueText !== prev.issue) parts.push(issueText)
    if (parts.length > 0) setAnnouncement(parts.join(". "))
  }, [streaming, stageKey, issueText, complete, heading, spoken])

  // Focus the instructions box when it opens.
  React.useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  const send = (r: DeliveryTrackerResult) => {
    if (streaming) return
    setConfirmed(r)
    onResult?.(r)
  }

  const closeEditor = () => {
    setEditing(false)
    setText("")
    // Back to the button that opened it, after it re-renders.
    requestAnimationFrame(() => instructionsButtonRef.current?.focus())
  }

  const contextName = merchantName ? `, ${merchantName}` : ""

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="delivery-tracker"
        data-status={status}
        data-kind={kind}
        data-stage={complete ? "complete" : stage?.id}
        aria-busy={streaming}
        aria-labelledby={heading ? titleId : undefined}
        aria-label={heading ? undefined : "Delivery tracking"}
        className={className}
      >
        <SurfaceHeader
          className={cn("pb-3", logoSrc && "flex-row items-center gap-3")}
        >
          <LogoTile
            src={logoSrc}
            alt={merchant?.logo?.alt}
            size={64}
            fit="full"
            tone="muted"
          />
          <div className="flex min-w-0 flex-col gap-1">
            {heading ? (
              <h3
                id={titleId}
                className={cn(genuiType.title, "text-[17px] leading-[1.35]")}
                suppressHydrationWarning
              >
                {heading}
              </h3>
            ) : (
              <Skeleton className="h-5 w-36" />
            )}
            {merchantName ? (
              <p className={genuiType.meta}>{merchantName}</p>
            ) : (
              streaming && <Skeleton className="h-3 w-28" />
            )}
          </div>
        </SurfaceHeader>

        <div className="flex flex-col">
          {/* Arrival: minutes left when soon, else the window */}
          <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
            {badge || arrival ? (
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
                {badge ? (
                  <p className="flex items-baseline gap-1.5">
                    <span className="sr-only">{badge.spoken}</span>
                    {badge.word ? (
                      <span aria-hidden className={genuiType.display}>
                        {badge.word}
                      </span>
                    ) : (
                      <span aria-hidden className="flex items-baseline gap-1.5">
                        <span className={genuiType.display}>
                          <SlidingNumber
                            number={badge.value ?? 0}
                            initiallyStable
                          />
                        </span>
                        <span className={genuiType.title}>{badge.unit}</span>
                      </span>
                    )}
                  </p>
                ) : null}
                {arrival && (
                  <p
                    className={cn(
                      badge ? genuiType.body : genuiType.stat,
                      // Beside the countdown, pushed to the right edge.
                      badge && "ml-auto text-right",
                    )}
                    suppressHydrationWarning
                  >
                    {arrival}
                  </p>
                )}
              </div>
            ) : (
              streaming && <Skeleton className="h-10 w-32" />
            )}

            {/* Segmented progress, one segment per stage */}
            {ready.length > 0 ? (
              <>
                <div
                  role="img"
                  aria-label={spoken || "Delivery progress"}
                  className="flex gap-1.5"
                >
                  {ready.map((s, i) => {
                    const filled = complete || s.state !== "upcoming"
                    const pulsing =
                      !complete && i === index && s.state === "current"
                    // Live and under way: finished stages and the current one flow.
                    const flows = filled && !complete && !reduceMotion
                    return (
                      <motion.span
                        key={s.id}
                        {...entry}
                        className="h-2 flex-1 overflow-hidden rounded-full bg-muted dark:bg-white/10"
                      >
                        <motion.span
                          className={cn(
                            "block h-full w-full origin-left rounded-full",
                            complete
                              ? "bg-emerald-500 dark:bg-emerald-400"
                              : "bg-(--bar)",
                            // Without the flow (reduced motion), the stage under way still pulses softly.
                            pulsing &&
                              !flows &&
                              "animate-pulse motion-reduce:animate-none",
                            !complete &&
                              !brand &&
                              "[--bar:var(--color-sky-500)] dark:[--bar:var(--color-sky-400)]",
                          )}
                          // The bar's colour: the brand's, or sky.
                          // While live, a gradient of that colour flows along the bar without end.
                          style={
                            complete
                              ? undefined
                              : ({
                                  ...(brand
                                    ? {
                                        "--bar": brand,
                                      }
                                    : null),
                                  ...(flows
                                    ? {
                                        backgroundImage:
                                          "linear-gradient(90deg, oklch(from var(--bar) calc(l - 0.2) c h) 0%, var(--bar) 28%, oklch(from var(--bar) calc(l + 0.16) c h) 50%, var(--bar) 72%, oklch(from var(--bar) calc(l - 0.2) c h) 100%)",
                                        backgroundSize: "300% 100%",
                                      }
                                    : null),
                                } as React.CSSProperties)
                          }
                          initial={false}
                          animate={
                            flows
                              ? {
                                  scaleX: 1,
                                  backgroundPosition: ["0% 0%", "150% 0%"],
                                  // The stage under way blinks; finished stages stay steady.
                                  ...(pulsing
                                    ? { opacity: [1, 0.35, 1] }
                                    : null),
                                }
                              : { scaleX: filled ? 1 : 0 }
                          }
                          transition={
                            flows
                              ? {
                                  scaleX: { duration: 0.6, ease: "easeInOut" },
                                  opacity: {
                                    duration: 1.3,
                                    ease: "easeInOut",
                                    repeat: Number.POSITIVE_INFINITY,
                                  },
                                  backgroundPosition: {
                                    duration: 3.2,
                                    ease: "linear",
                                    repeat: Number.POSITIVE_INFINITY,
                                  },
                                }
                              : { duration: 0.6, ease: "easeInOut" }
                          }
                        />
                      </motion.span>
                    )
                  })}
                </div>
                {/* Stage names and times, for screen readers; the heading names the current one. */}
                <ol aria-label="Stages" className="sr-only">
                  {ready.map((s, i) => {
                    const isCurrent = !complete && i === index
                    const time = formatStageTime(s.at, reference, locale)
                    const state = complete ? "done" : s.state
                    return (
                      <li
                        key={s.id}
                        aria-current={isCurrent ? "step" : undefined}
                        suppressHydrationWarning
                      >
                        {s.label}
                        {state === "done"
                          ? ", done"
                          : state === "current"
                            ? ", in progress"
                            : ", upcoming"}
                        {time &&
                          `, ${state === "upcoming" ? "expected " : ""}${time}`}
                      </li>
                    )
                  })}
                </ol>
              </>
            ) : (
              <Skeleton className="h-2 w-full rounded-full" />
            )}
          </div>

          {issueReady && (
            <motion.div {...entry} className="border-t border-border px-3 py-3">
              <div className="rounded-[10px] border border-border bg-transparent p-1">
                <p className="flex items-center gap-3 rounded-md bg-orange-500/10 px-3 py-3 text-[13px] dark:bg-orange-400/10">
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-orange-500/15 dark:bg-orange-400/15">
                    <TriangleAlertIcon
                      aria-hidden
                      className="size-4 shrink-0 text-orange-500 dark:text-orange-400"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="sr-only">{`${ISSUE_LABEL[issueReady.kind ?? "delayed"]}: `}</span>
                    {issueReady.message}
                  </span>
                </p>
              </div>
            </motion.div>
          )}

          {courierReady && (
            <motion.div
              {...entry}
              className="flex items-center gap-3 border-t border-border px-3 py-3"
            >
              <Avatar courier={courierReady} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className={cn(genuiType.body, "font-medium")}>
                  {courierReady.name}
                  {rating && (
                    <span className="sr-only">{`, rated ${rating} out of 5`}</span>
                  )}
                </p>
                {courierReady.vehicle && (
                  <p className={cn(genuiType.meta, "truncate")}>
                    {courierReady.vehicle}
                  </p>
                )}
              </div>
              {canCall && (
                <IconTip label={`Call ${courierReady.name}`}>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="shrink-0 rounded-full"
                    disabled={streaming}
                    aria-label={`Call ${courierReady.name}`}
                    onClick={() => send({ action: "contact-courier" })}
                  >
                    <PhoneIcon aria-hidden />
                  </Button>
                </IconTip>
              )}
            </motion.div>
          )}

          {summary && (
            <div className="border-t border-border px-3 py-3">
              {readyItems.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    aria-expanded={itemsOpen}
                    aria-controls={itemsId}
                    onClick={() => setItemsOpen((o) => !o)}
                    className={cn(
                      genuiType.meta,
                      "-mx-2.5 flex min-h-8 items-center gap-1.5 self-start rounded-full px-2.5 text-left outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                    )}
                  >
                    <ReceiptTextIcon
                      aria-hidden
                      className="size-3.5 shrink-0"
                    />
                    <span>{summary}</span>
                    <ChevronDownIcon
                      aria-hidden
                      className={cn(
                        "size-3.5 shrink-0 transition-transform",
                        itemsOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {itemsOpen && (
                    <ul
                      id={itemsId}
                      className={cn(genuiType.body, "flex flex-col gap-1.5")}
                    >
                      {readyItems.map((item, i) => (
                        <li
                          // biome-ignore lint/suspicious/noArrayIndexKey: items have no id; names may repeat
                          key={`${item.name}-${i}`}
                          className="flex gap-2"
                        >
                          <span className="w-6 shrink-0 tabular-nums text-muted-foreground">
                            {`${item.quantity}×`}
                          </span>
                          <span className="min-w-0">{item.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <p className={cn(genuiType.meta, "flex items-center gap-1")}>
                  <ReceiptTextIcon aria-hidden className="size-3.5 shrink-0" />
                  {summary}
                </p>
              )}
            </div>
          )}
          {street && (
            <p className="sr-only">
              {kind === "ride" ? "Pickup at " : "Delivering to "}
              {street}
            </p>
          )}
        </div>

        <span className="sr-only" aria-live="polite">
          {announcement}
        </span>

        {(streaming || footerActions.length > 0 || confirmed) && (
          <SurfaceFooter className="flex-col items-stretch gap-3">
            {editing && (
              <div className="flex flex-col gap-2">
                <FormField
                  htmlFor={instructionsId}
                  label={instructionsLabel(kind)}
                  pinned
                >
                  <Textarea
                    id={instructionsId}
                    ref={textareaRef}
                    value={text}
                    maxLength={240}
                    placeholder={
                      kind === "ride"
                        ? "e.g. I'm by the north entrance"
                        : "e.g. Leave it with the concierge"
                    }
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault()
                        closeEditor()
                      }
                    }}
                    className={formTextareaClass}
                  />
                </FormField>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="secondary" onClick={closeEditor}>
                    Cancel
                  </Button>
                  <WhyDisabled
                    reason={
                      !streaming &&
                      text.trim() === "" &&
                      "Write instructions first"
                    }
                  >
                    <Button
                      size="sm"
                      disabled={streaming || text.trim() === ""}
                      onClick={() => {
                        send({
                          action: "change-instructions",
                          text: text.trim(),
                        })
                        closeEditor()
                      }}
                    >
                      Send instructions
                    </Button>
                  </WhyDisabled>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <p
                aria-live="polite"
                className={cn(
                  genuiType.meta,
                  "flex min-w-0 items-center gap-1.5",
                )}
              >
                {streaming ? (
                  <ShimmeringText
                    text="Loading tracking…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                ) : (
                  confirmed && (
                    <>
                      <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                      {confirmation(
                        confirmed,
                        courierReady?.name,
                        merchantName,
                      )}
                    </>
                  )
                )}
              </p>
              {footerActions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {footerActions.includes("contact-merchant") && (
                    <Button
                      size="sm"
                      variant={
                        footerActions.length === 1 ? "default" : "secondary"
                      }
                      disabled={streaming}
                      onClick={() => send({ action: "contact-merchant" })}
                    >
                      <MessageSquareIcon aria-hidden />
                      {merchantContactLabel(kind)}
                      {contextName && (
                        <span className="sr-only">{contextName}</span>
                      )}
                    </Button>
                  )}
                  {footerActions.includes("change-instructions") && (
                    <Button
                      ref={instructionsButtonRef}
                      size="sm"
                      variant={
                        footerActions.length === 1 ? "default" : "secondary"
                      }
                      disabled={streaming}
                      aria-expanded={editing}
                      aria-controls={editing ? instructionsId : undefined}
                      onClick={() =>
                        editing ? closeEditor() : setEditing(true)
                      }
                    >
                      <NotebookPenIcon aria-hidden />
                      {instructionsLabel(kind)}
                    </Button>
                  )}
                  {footerActions.includes("get-help") &&
                    (footerActions.length > 2 ? (
                      // A third action stays as an icon, so the footer keeps two labelled buttons.
                      <IconTip label="Get help">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={streaming}
                          aria-label={`Get help with this ${kind === "ride" ? "ride" : "order"}`}
                          onClick={() => send({ action: "get-help" })}
                        >
                          <LifeBuoyIcon aria-hidden />
                        </Button>
                      </IconTip>
                    ) : (
                      <Button
                        size="sm"
                        variant={
                          footerActions.length === 1 ? "default" : "secondary"
                        }
                        disabled={streaming}
                        onClick={() => send({ action: "get-help" })}
                      >
                        <LifeBuoyIcon aria-hidden />
                        Get help
                        <span className="sr-only">{` with this ${kind === "ride" ? "ride" : "order"}`}</span>
                      </Button>
                    ))}
                </div>
              )}
            </div>
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
