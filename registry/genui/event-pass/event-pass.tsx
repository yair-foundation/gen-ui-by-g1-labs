"use client"

import * as React from "react"
import { Menu } from "@base-ui/react/menu"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DoorOpenIcon,
  EllipsisIcon,
  LayoutGridIcon,
  LogInIcon,
  type LucideIcon,
  RowsIcon,
  ArmchairIcon,
  ScanBarcodeIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  canShowCode,
  clampTicket,
  doorsText,
  encodeQr,
  eventTimeText,
  initialTicketIndex,
  isUsable,
  matrixToPath,
  positionText,
  qrDimension,
  safeTimeZone,
  seatLabel,
  stepTicket,
  ticketActions,
  ticketStateText,
  toInstant,
  type EventPassAction,
  type TicketLike,
} from "./event-pass-utils"
import type {
  EventPassInput,
  EventPassResult,
  PassTicket,
} from "./event-pass.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type EventPassStatus = "streaming" | "ready" | "submitting" | "done"

type PartialTicket = Partial<Omit<PassTicket, "code">> & {
  code?: {
    format?: "qr" | "barcode-placeholder"
    value?: string
    label?: string
  }
}

export type EventPassProps = Partial<
  Omit<EventPassInput, "event" | "holder" | "tickets" | "rules">
> & {
  /** Everything may be partial while the tool call streams. */
  event?: {
    title?: string
    start?: string
    end?: string
    timeZone?: string
    venue?: { name?: string }
  }
  holder?: { name?: string }
  tickets?: PartialTicket[]
  rules?: string[]
  /**
   * Locale for dates and times. Defaults to the host's GenUI locale ("en-US"
   * when unset) so server and client render the same text.
   */
  locale?: string
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host handles an
   * action. When omitted, the component tracks the user's actions itself.
   */
  status?: EventPassStatus
  /**
   * Called once per action and ticket. Each locks after use; the others stay
   * available. Every action is a handoff to your own flow.
   */
  onResult?: (result: EventPassResult) => void
  /** Actions from history (one or several). Shown as done; never calls onResult. */
  result?: EventPassResult | EventPassResult[]
  className?: string
}

/** Size of the QR tile in CSS pixels (quiet zone included). */
const QR_PX = 200

const ACTION_LABEL: Record<EventPassAction, string> = {
  "add-to-wallet": "Add to wallet",
  transfer: "Transfer",
  download: "Download",
}

const CONFIRMATION: Record<EventPassAction, string> = {
  "add-to-wallet": "Opening your wallet pass",
  transfer: "Opening the transfer",
  download: "Preparing the download",
}

/** A ticket once its id and type have arrived, with a complete code (or none). */
function toReady(t: PartialTicket): TicketLike | null {
  if (typeof t.id !== "string" || typeof t.type !== "string") return null
  const { code, ...rest } = t
  const ready: TicketLike = { ...rest, id: t.id, type: t.type }
  if (code?.format === "qr" && typeof code.value === "string" && code.value) {
    ready.code = { format: "qr", value: code.value }
  } else if (
    code?.format === "barcode-placeholder" &&
    typeof code.label === "string"
  ) {
    ready.code = { format: "barcode-placeholder", label: code.label }
  }
  return ready
}

const key = (action: EventPassAction, ticketId: string) =>
  `${action}:${ticketId}`

const FACT_ICONS: Record<string, LucideIcon> = {
  Section: LayoutGridIcon,
  Row: RowsIcon,
  Seat: ArmchairIcon,
  Gate: DoorOpenIcon,
  Entrance: LogInIcon,
  Doors: ClockIcon,
}

function Fact({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  const Icon = FACT_ICONS[label]
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
        {label}
      </dt>
      <dd className={cn(genuiType.stat, "leading-none break-words")}>
        {children}
      </dd>
    </div>
  )
}

/** Dashed divider with two half-circle notches cut out of the card edges. */
function Perforation() {
  return (
    <div
      aria-hidden
      className="relative border-t-2 border-dashed before:absolute before:top-1/2 before:-left-2.5 before:size-5 before:-translate-y-1/2 before:rounded-full before:border before:border-transparent before:bg-background after:absolute after:top-1/2 after:-right-2.5 after:size-5 after:-translate-y-1/2 after:rounded-full after:border after:border-transparent after:bg-background dark:before:border-border dark:after:border-border"
    />
  )
}

export function EventPass({
  event,
  holder,
  tickets = [],
  doorsOpen,
  rules = [],
  transferable,
  walletAvailable,
  locale: localeProp,
  status: statusProp,
  onResult,
  result,
  className,
}: EventPassProps) {
  const hostLocale = useGenUILocale()
  const locale = localeProp ?? hostLocale
  const [done, setDone] = React.useState<Map<string, EventPassResult>>(
    () =>
      new Map(
        (result === undefined
          ? []
          : Array.isArray(result)
            ? result
            : [result]
        ).map((r) => [key(r.action, r.ticketId), r]),
      ),
  )
  const [chosen, setChosen] = React.useState<number | null>(null)
  const prevRef = React.useRef<HTMLButtonElement>(null)
  const nextRef = React.useRef<HTMLButtonElement>(null)

  // A host-provided "ready" (or nothing) yields to the user's actions.
  const status: EventPassStatus =
    done.size > 0 && (statusProp === undefined || statusProp === "ready")
      ? "done"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const busy = streaming || status === "submitting"

  /* Data ------------------------------------------------------------- */
  const tz = safeTimeZone(event?.timeZone)
  const zoneReady =
    !streaming || (event?.timeZone !== undefined && tz === event.timeZone)
  const timeLine = zoneReady
    ? eventTimeText(event?.start, event?.end, tz, locale)
    : null
  const startAt = zoneReady ? toInstant(event?.start, tz) : null
  const doors = zoneReady ? doorsText(doorsOpen, tz, locale) : null
  const doorsTime = doors?.replace(/^Doors /, "") ?? null

  const ready = tickets.flatMap((t) => {
    const r = toReady(t)
    return r ? [r] : []
  })
  const count = ready.length
  const index = clampTicket(chosen ?? initialTicketIndex(ready), count)
  const ticket = ready[index] as TicketLike | undefined
  const number = index + 1
  const usable = ticket ? isUsable(ticket) : false
  const stateText = ticket
    ? ticketStateText(ticket, tz, event?.start, locale)
    : null

  // Encode only once the payload is complete, so the code never changes under a scanner.
  const qrValue =
    !streaming && ticket && canShowCode(ticket) && ticket.code?.format === "qr"
      ? ticket.code.value
      : null
  const encoding = React.useMemo(
    () => (qrValue === null ? null : encodeQr(qrValue, "M")),
    [qrValue],
  )
  const modules = encoding?.ok ? encoding.modules : null
  const path = React.useMemo(
    () => (modules ? matrixToPath(modules) : ""),
    [modules],
  )
  const dim = modules ? qrDimension(modules) : 0

  // The pass fields, large: where to sit, where to enter, when doors open.
  const seated = !!(ticket?.section || ticket?.row || ticket?.seat)
  const seatFacts: { label: string; value: string }[] = ticket
    ? [
        ["Section", ticket.section],
        ["Row", ticket.row],
        ["Seat", ticket.seat],
        ["Gate", ticket.gate],
        ["Entrance", ticket.entrance],
        ["Doors", doorsTime ?? undefined],
      ].flatMap(([label, value]) =>
        value ? [{ label: label as string, value }] : [],
      )
    : []

  const buttons =
    ticket && !streaming
      ? ticketActions(ticket, { walletAvailable, transferable })
      : []
  const primary = buttons.slice(0, 2)
  const overflow = buttons.slice(2)
  const lastDone = [...done.values()].at(-1)
  const readyRules = rules.filter(
    (r): r is string => typeof r === "string" && r.trim() !== "",
  )
  const ticketName = (id: string) => {
    const i = ready.findIndex((t) => t.id === id)
    return count > 1 && i !== -1 ? ` for ticket ${i + 1}` : ""
  }

  /* Actions ---------------------------------------------------------- */
  const go = (delta: number) => {
    const next = stepTicket(index, delta, count)
    if (next === index) return
    setChosen(next)
    // Keep focus on a usable control when an arrow disables at the end.
    if (next === 0) requestAnimationFrame(() => nextRef.current?.focus())
    if (next === count - 1) {
      requestAnimationFrame(() => prevRef.current?.focus())
    }
  }

  const onNavKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      go(-1)
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      go(1)
    }
  }

  const fire = (action: EventPassAction) => {
    if (!ticket || busy) return
    const k = key(action, ticket.id)
    if (done.has(k)) return
    const r: EventPassResult = { action, ticketId: ticket.id }
    setDone((prev) => new Map(prev).set(k, r))
    onResult?.(r)
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="event-pass"
        data-status={status}
        aria-busy={busy}
        aria-label={
          event?.title ? `Tickets for ${event.title}` : "Event tickets"
        }
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <SurfaceTitle className="min-w-0 break-words">
              {event?.title}
            </SurfaceTitle>
            {count > 1 && (
              // Arrow keys page between tickets while focus is on either button.
              <fieldset
                aria-label="Tickets"
                onKeyDown={onNavKey}
                className="-my-1 -mr-2 flex shrink-0 items-center gap-0.5 border-0 p-0"
              >
                <WhyDisabled reason={index === 0 && "First ticket"}>
                  <IconTip label="Previous ticket">
                    <Button
                      ref={prevRef}
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Previous ticket"
                      disabled={index === 0}
                      onClick={() => go(-1)}
                    >
                      <ChevronLeftIcon aria-hidden />
                    </Button>
                  </IconTip>
                </WhyDisabled>
                <span
                  aria-live="polite"
                  className={cn(genuiType.value, "min-w-10 text-center")}
                >
                  <span className="sr-only">
                    Ticket {positionText(index, count)}
                  </span>
                  <span aria-hidden className="inline-flex justify-center">
                    <SlidingNumber number={number} initiallyStable />
                    &nbsp;of {count}
                  </span>
                </span>
                <WhyDisabled reason={index >= count - 1 && "Last ticket"}>
                  <IconTip label="Next ticket">
                    <Button
                      ref={nextRef}
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Next ticket"
                      disabled={index >= count - 1}
                      onClick={() => go(1)}
                    >
                      <ChevronRightIcon aria-hidden />
                    </Button>
                  </IconTip>
                </WhyDisabled>
              </fieldset>
            )}
          </div>
          {timeLine && startAt !== null ? (
            <p className={genuiType.meta}>
              <time dateTime={new Date(startAt).toISOString()}>{timeLine}</time>
              {event?.venue?.name && ` · ${event.venue.name}`}
            </p>
          ) : (
            streaming && <Skeleton className="h-3 w-44" />
          )}
        </SurfaceHeader>

        {ticket ? (
          <motion.div
            key={ticket.id}
            role="group"
            aria-label={`Ticket ${number} of ${count}: ${seatLabel(ticket)}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={genuiMotion.fade}
            // Swipe between tickets on touch screens; the arrows do the same.
            drag={count > 1 ? "x" : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.15}
            dragSnapToOrigin
            onDragEnd={(_, info) => {
              if (info.offset.x < -60) go(1)
              else if (info.offset.x > 60) go(-1)
            }}
            className={cn("flex flex-col", count > 1 && "touch-pan-y")}
          >
            <div
              className={cn(
                "flex flex-col gap-4 border-t border-border px-3 py-3 transition-opacity",
                !usable && "opacity-60",
              )}
            >
              {!seated && (
                <p className={cn(genuiType.body, "font-medium")}>
                  {ticket.type}
                </p>
              )}
              {seatFacts.length > 0 && (
                <dl className="flex flex-wrap gap-x-10 gap-y-4">
                  {seatFacts.map((f) => (
                    <Fact key={f.label} label={f.label}>
                      {f.value}
                    </Fact>
                  ))}
                </dl>
              )}
              {holder?.name && (
                <p className={genuiType.body}>
                  <span className="sr-only">Name: </span>
                  {holder.name}
                </p>
              )}
            </div>

            <Perforation />

            <div className="flex flex-col items-center gap-3 px-3 py-3">
              {!usable ? (
                <p
                  data-slot="event-pass-state"
                  className={cn(genuiType.body, "py-6 text-center font-medium")}
                >
                  {stateText}
                </p>
              ) : streaming ? (
                <Skeleton
                  className="aspect-square max-w-full rounded-lg"
                  style={{ width: QR_PX }}
                />
              ) : modules ? (
                // Always black on white, in dark mode too: scanners need the contrast.
                <div
                  className="max-w-full overflow-hidden rounded-lg bg-white ring-1 ring-foreground/10"
                  style={{ width: QR_PX }}
                >
                  <svg
                    role="img"
                    aria-label={`Entry code for ticket ${number}`}
                    viewBox={`0 0 ${dim} ${dim}`}
                    shapeRendering="crispEdges"
                    className="block h-auto w-full"
                  >
                    <rect width={dim} height={dim} fill="#fff" />
                    <path fill="#000" d={path} />
                  </svg>
                </div>
              ) : ticket.code?.format === "barcode-placeholder" ? (
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex size-12 shrink-0 items-center justify-center rounded-lg border border-border bg-transparent text-muted-foreground"
                  >
                    <ScanBarcodeIcon className="size-6" />
                  </span>
                  <p className={genuiType.meta}>{ticket.code.label}</p>
                </div>
              ) : (
                <p className={cn(genuiType.meta, "py-6 text-center")}>
                  {encoding && !encoding.ok
                    ? "Code can't be shown here"
                    : "No entry code"}
                  <span className="sr-only">
                    . Open the ticket in the provider's app.
                  </span>
                </p>
              )}
              {readyRules.length > 0 && (
                <p className={cn(genuiType.meta, "text-center")}>
                  <span className="sr-only">Entry rules: </span>
                  {readyRules.join(" · ")}
                </p>
              )}
            </div>
          </motion.div>
        ) : (
          streaming && (
            <div
              aria-hidden
              className="flex flex-col gap-4 border-t border-border px-3 py-3"
            >
              <div className="flex gap-8">
                <Skeleton className="h-10 w-14" />
                <Skeleton className="h-10 w-14" />
                <Skeleton className="h-10 w-14" />
              </div>
              <Skeleton
                className="mx-auto aspect-square max-w-full rounded-lg"
                style={{ width: QR_PX }}
              />
            </div>
          )
        )}

        {(busy || buttons.length > 0 || lastDone) && (
          <SurfaceFooter className="justify-between">
            <p aria-live="polite" className={cn(genuiType.meta, "min-w-0")}>
              {streaming ? (
                <ShimmeringText
                  text="Loading tickets…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : status === "submitting" ? (
                "Opening…"
              ) : lastDone ? (
                <span className="text-foreground">
                  {`${CONFIRMATION[lastDone.action]}${ticketName(lastDone.ticketId)}…`}
                </span>
              ) : null}
            </p>
            {buttons.length > 0 && ticket && (
              <div className="flex items-center gap-2">
                {[...primary].reverse().map((a) => {
                  const used = done.has(key(a, ticket.id))
                  return (
                    <WhyDisabled key={a} when={used} reason="Already done">
                      <Button
                        size="sm"
                        variant={
                          used
                            ? "secondary"
                            : a === primary[0]
                              ? "default"
                              : "outline"
                        }
                        disabled={busy || used}
                        onClick={() => fire(a)}
                      >
                        {used && <CheckIcon aria-hidden />}
                        {ACTION_LABEL[a]}
                        <span className="sr-only">
                          {`, ticket ${number}${used ? " (done)" : ""}`}
                        </span>
                      </Button>
                    </WhyDisabled>
                  )
                })}
                {overflow.length > 0 && (
                  <Menu.Root>
                    <IconTip label={`More actions for ticket ${number}`}>
                      <Menu.Trigger
                        disabled={busy}
                        aria-label={`More actions for ticket ${number}`}
                        render={<Button size="icon-sm" variant="ghost" />}
                      >
                        <EllipsisIcon aria-hidden />
                      </Menu.Trigger>
                    </IconTip>
                    <Menu.Portal>
                      <Menu.Positioner
                        sideOffset={4}
                        align="end"
                        className="isolate z-50 outline-none"
                      >
                        <Menu.Popup className="min-w-40 origin-(--transform-origin) rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10 outline-none">
                          {overflow.map((a) => {
                            const used = done.has(key(a, ticket.id))
                            return (
                              <Menu.Item
                                key={a}
                                disabled={used}
                                onClick={() => fire(a)}
                                className="flex min-h-9 cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                              >
                                {ACTION_LABEL[a]}
                                {used && (
                                  <>
                                    <CheckIcon
                                      aria-hidden
                                      className="ml-auto size-3.5"
                                    />
                                    <span className="sr-only"> (done)</span>
                                  </>
                                )}
                              </Menu.Item>
                            )
                          })}
                        </Menu.Popup>
                      </Menu.Positioner>
                    </Menu.Portal>
                  </Menu.Root>
                )}
              </div>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
