"use client"

import * as React from "react"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarCheckIcon,
  CheckIcon,
  MinusIcon,
  PlusIcon,
  TicketIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { ScrollFade } from "@/components/genui/scroll-fade"

import type {
  ShowtimeSession,
  ShowtimeTitle,
  ShowtimesInput,
  ShowtimesResult,
} from "./showtimes.schema"
import {
  formatDate,
  formatMoney,
  formatTime,
  monogram,
  monthLabel,
  nextIndex,
  normalizeDate,
  quantityRange,
  safeImageSrc,
  zoneCity,
} from "./showtimes-utils"
import { RollingDigits } from "@/components/genui/genui-motion"

export type ShowtimesStatus =
  "streaming" | "ready" | "submitting" | "selected" | "dismissed"

type PartialTitle = Partial<Omit<ShowtimeTitle, "sessions">> & {
  sessions?: Partial<ShowtimeSession>[]
}
type ReadySession = ShowtimeSession & { date: string }
type ReadyTitle = Omit<ShowtimeTitle, "sessions"> & {
  sessions: ReadySession[]
}
type ReadyDay = { date: string; label?: string }

export type ShowtimesProps = Partial<
  Omit<ShowtimesInput, "titles" | "days">
> & {
  /** Days and titles may be partial while the tool call streams. */
  days?: { date?: string; label?: string }[]
  titles?: PartialTitle[]
  /**
   * Locale for dates, times and prices. Defaults to the GenUI locale ("en-US"
   * unless the host sets one) so server and client render the same text.
   */
  locale?: string
  /**
   * Lifecycle, controlled by the host. 'submitting' while the host hands the
   * choice on. When omitted, the component tracks the user's decision itself.
   */
  status?: ShowtimesStatus
  /** Called once with the user's decision. Send it back to the agent. */
  onResult?: (result: ShowtimesResult) => void
  /** A decision from history. Restores it read-only; never calls onResult. */
  result?: ShowtimesResult
  className?: string
}

const PAGE = 7

function Poster({ title }: { title: ReadyTitle }) {
  const src = safeImageSrc(title.image?.src)
  if (src) {
    return (
      // biome-ignore lint/performance/noImgElement: registry components can't assume next/image
      <img
        src={src}
        alt={title.image?.alt ?? ""}
        loading="lazy"
        className="aspect-[2/3] w-22 shrink-0 rounded-[12px] bg-muted object-cover"
      />
    )
  }
  return (
    <div
      aria-hidden
      className="flex aspect-[2/3] w-22 shrink-0 items-center justify-center rounded-[12px] border border-border bg-transparent text-[20px] font-semibold text-muted-foreground"
    >
      {monogram(title.name)}
    </div>
  )
}

export function Showtimes({
  venue,
  days = [],
  titles = [],
  currency,
  defaultDate,
  quantity,
  submitLabel,
  locale: localeProp,
  status: statusProp,
  onResult,
  result,
  className,
}: ShowtimesProps) {
  const hostLocale = useGenUILocale()
  const locale = localeProp ?? hostLocale
  const restored = result?.action === "select" ? result : null
  const [dayChoice, setDayChoice] = React.useState<string | null>(
    restored?.date ?? null,
  )
  const [choice, setChoice] = React.useState<string | null>(
    restored?.sessionId ?? null,
  )
  const [count, setCount] = React.useState<number | null>(
    restored?.quantity ?? null,
  )
  const [decision, setDecision] = React.useState<
    "selected" | "dismissed" | null
  >(result ? (result.action === "select" ? "selected" : "dismissed") : null)
  const dayRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const sessionRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const baseId = React.useId()

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: ShowtimesStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const done = status === "selected" || status === "dismissed"
  const locked = status !== "ready"

  /* Data ------------------------------------------------------------- */
  const ready: ReadyTitle[] = titles
    .filter(
      (t): t is PartialTitle & { id: string; name: string } =>
        typeof t.id === "string" && typeof t.name === "string",
    )
    .map((t) => ({
      ...t,
      sessions: (t.sessions ?? []).flatMap((s): ReadySession[] => {
        const date = normalizeDate(s.date)
        return typeof s.id === "string" && typeof s.time === "string" && date
          ? [{ ...s, id: s.id, time: s.time, date }]
          : []
      }),
    }))

  const sessionDates = new Set(
    ready.flatMap((t) => t.sessions.map((s) => s.date)),
  )
  const allDays: ReadyDay[] = days
    .flatMap((d): ReadyDay[] => {
      const date = normalizeDate(d.date)
      return date ? [{ date, label: d.label }] : []
    })
    .filter((d, i, list) => list.findIndex((x) => x.date === d.date) === i)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
  // Days without sessions aren't shown (once the titles have arrived).
  const visibleDays =
    streaming || ready.length === 0
      ? allDays
      : allDays.filter((d) => sessionDates.has(d.date))

  const preferred = normalizeDate(defaultDate)
  const currentDay =
    visibleDays.find((d) => d.date === dayChoice) ??
    visibleDays.find((d) => d.date === preferred) ??
    visibleDays[0]
  const currentIndex = currentDay ? visibleDays.indexOf(currentDay) : -1

  // The day strip scrolls; the month label follows the days in view.
  const dayRow = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ prev: false, next: false })
  const [inView, setInView] = React.useState<string[] | null>(null)
  const dayKey = visibleDays.map((d) => d.date).join(",")
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measures when the days change
  React.useEffect(() => {
    const row = dayRow.current
    if (!row) return
    const update = () => {
      const prev = row.scrollLeft > 4
      const next = row.scrollLeft + row.clientWidth < row.scrollWidth - 4
      setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
      const box = row.getBoundingClientRect()
      const shown = [...row.querySelectorAll<HTMLElement>("[data-date]")]
        .filter((el) => {
          const r = el.getBoundingClientRect()
          return r.right > box.left + 36 && r.left < box.right - 36
        })
        .map((el) => el.dataset.date ?? "")
      if (shown.length) {
        const key = `${shown[0]}|${shown[shown.length - 1]}`
        setInView((v) =>
          v && `${v[0]}|${v[v.length - 1]}` === key ? v : shown,
        )
      }
    }
    update()
    row.addEventListener("scroll", update, { passive: true })
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    resize?.observe(row)
    return () => {
      row.removeEventListener("scroll", update)
      resize?.disconnect()
    }
  }, [dayKey])
  const scrollDays = (direction: 1 | -1) => {
    const row = dayRow.current
    if (!row) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    row.scrollBy({
      left: direction * row.clientWidth * 0.8,
      behavior: reduce ? "auto" : "smooth",
    })
  }

  const onDay = (title: ReadyTitle) =>
    currentDay ? title.sessions.filter((s) => s.date === currentDay.date) : []
  const dayTitles = ready.filter((t) => onDay(t).length > 0)
  const daySessions = dayTitles.flatMap(onDay)
  const enabledSessions = daySessions.filter((s) => !s.soldOut)

  let chosen: { title: ReadyTitle; session: ReadySession } | null = null
  for (const t of ready) {
    const s = t.sessions.find((x) => x.id === choice)
    if (s) chosen = { title: t, session: s }
  }

  const range = quantity ? quantityRange(quantity) : null
  const qty = range
    ? Math.min(range.max, Math.max(range.min, count ?? range.initial))
    : 1
  const qtyLabel = quantity?.label ?? "Tickets"
  const total =
    chosen && typeof chosen.session.price === "number"
      ? chosen.session.price * qty
      : null

  /* Text ------------------------------------------------------------- */
  const month = monthLabel(
    inView ?? visibleDays.slice(0, PAGE).map((d) => d.date),
    locale,
  )
  const header = venue?.name ?? (streaming ? undefined : "Showtimes")
  const sessionLabel = (t: ReadyTitle, s: ReadySession) =>
    [
      t.name,
      formatTime(s.time, locale),
      s.format,
      s.soldOut ? "sold out" : null,
      s.fewLeft && !s.soldOut ? "few left" : null,
      typeof s.price === "number"
        ? formatMoney(s.price, currency, locale)
        : null,
    ]
      .filter(Boolean)
      .join(", ")
  const summary = (t: ReadyTitle, s: ReadySession) =>
    [
      t.name,
      formatDate(s.date, "short", locale),
      formatTime(s.time, locale),
      s.format,
    ]
      .filter(Boolean)
      .join(" · ")
  const dayName = (d: ReadyDay) =>
    `${formatDate(d.date, "long", locale)}${d.label ? `, ${d.label}` : ""}`

  /* Actions ---------------------------------------------------------- */
  const selectDay = (date: string, focus = false) => {
    setDayChoice(date)
    if (focus) requestAnimationFrame(() => dayRefs.current.get(date)?.focus())
  }

  const onDayKey = (e: React.KeyboardEvent) => {
    const next = nextIndex(e.key, currentIndex, visibleDays.length)
    if (next === null) return
    e.preventDefault()
    selectDay(visibleDays[next].date, true)
  }

  const onSessionKey = (e: React.KeyboardEvent, id: string) => {
    const current = enabledSessions.findIndex((s) => s.id === id)
    const next = nextIndex(e.key, current, enabledSessions.length)
    if (next === null) return
    e.preventDefault()
    const target = enabledSessions[next].id
    setChoice(target)
    requestAnimationFrame(() => sessionRefs.current.get(target)?.focus())
  }

  const submit = () => {
    if (!chosen || locked) return
    setDecision("selected")
    onResult?.({
      action: "select",
      sessionId: chosen.session.id,
      titleId: chosen.title.id,
      date: chosen.session.date,
      time: chosen.session.time,
      ...(range ? { quantity: qty } : {}),
    })
  }

  const dismiss = () => {
    if (locked) return
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  // Roving tabindex: the checked session on this day, else the first open one.
  const tabStop =
    enabledSessions.find((s) => s.id === choice)?.id ?? enabledSessions[0]?.id

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="showtimes"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-label={venue?.name ? `Showtimes at ${venue.name}` : "Showtimes"}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400"
          >
            <TicketIcon className="size-5" />
          </span>
          <SurfaceTitle className="min-w-0 truncate">{header}</SurfaceTitle>
          {venue?.timeZone && (
            <p className="sr-only">
              Times are in {zoneCity(venue.timeZone)} time.
            </p>
          )}
        </SurfaceHeader>

        {/* Day strip: a calendar row (big date, weekday, tick), one radio per
            day with sessions. Scrolls sideways; the arrows page through it. */}
        {(visibleDays.length > 0 || streaming) && (
          <div className="border-t border-border">
            <div className="flex min-h-11 items-center justify-between gap-2 px-3 pt-2">
              <p
                aria-live="polite"
                className="text-[16px] leading-6 font-semibold whitespace-nowrap"
              >
                {month}
              </p>
              {(edges.prev || edges.next) && (
                <div className="flex items-center gap-1">
                  <WhyDisabled when={!edges.prev} reason="First day">
                    <IconTip label="Earlier days">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Earlier days"
                        disabled={!edges.prev}
                        onClick={() => scrollDays(-1)}
                        className="hover:bg-muted dark:hover:bg-white/10"
                      >
                        <ArrowLeftIcon aria-hidden />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                  <WhyDisabled when={!edges.next} reason="Last day">
                    <IconTip label="Later days">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Later days"
                        disabled={!edges.next}
                        onClick={() => scrollDays(1)}
                        className="hover:bg-muted dark:hover:bg-white/10"
                      >
                        <ArrowRightIcon aria-hidden />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                </div>
              )}
            </div>
            <div className="relative">
              {visibleDays.length > 0 ? (
                <div
                  ref={dayRow}
                  role="radiogroup"
                  aria-label="Day"
                  className="flex snap-x snap-mandatory scroll-px-3 gap-1 overflow-x-auto overscroll-x-contain px-3 pt-1 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {visibleDays.map((d) => {
                    const checked = d.date === currentDay?.date
                    return (
                      // biome-ignore lint/a11y/useSemanticElements: a roving-tabindex radio row that scrolls sideways
                      <button
                        key={d.date}
                        ref={(el) => {
                          if (el) dayRefs.current.set(d.date, el)
                          else dayRefs.current.delete(d.date)
                        }}
                        type="button"
                        role="radio"
                        data-date={d.date}
                        aria-checked={checked}
                        aria-label={dayName(d)}
                        tabIndex={checked ? 0 : -1}
                        disabled={done}
                        onClick={() => selectDay(d.date)}
                        onKeyDown={onDayKey}
                        className="group/day flex min-w-[4.5rem] flex-1 shrink-0 snap-start flex-col items-center gap-1.5 rounded-[12px] py-2 text-center outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/5"
                      >
                        <span
                          className={cn(
                            "font-figure text-[36px] leading-none font-normal tracking-tight tabular-nums lining-nums transition-colors",
                            checked
                              ? "text-foreground"
                              : "text-muted-foreground/55 group-hover/day:text-foreground/80",
                          )}
                        >
                          {formatDate(d.date, "day", locale).padStart(2, "0")}
                        </span>
                        <span
                          className={cn(
                            "max-w-full truncate px-0.5 text-[13px] leading-none lowercase",
                            checked
                              ? "font-medium text-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          {d.label ?? formatDate(d.date, "weekday", locale)}
                        </span>
                        <span
                          aria-hidden
                          className={cn(
                            "mt-1 h-4 w-0.5 origin-top rounded-full transition-[scale,background-color]",
                            checked
                              ? "bg-choice"
                              : "scale-y-75 bg-muted-foreground/40",
                          )}
                        />
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div aria-hidden className="flex gap-1 px-3 pt-1 pb-2">
                  {Array.from({ length: PAGE }, (_, i) => (
                    <Skeleton
                      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                      key={i}
                      className="h-20 min-w-[4.5rem] flex-1 rounded-[12px]"
                    />
                  ))}
                </div>
              )}
              {/* Edge fades say the row goes on. */}
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 w-14 bg-linear-to-r from-card to-transparent transition-opacity duration-200",
                  edges.prev ? "opacity-100" : "opacity-0",
                )}
              />
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-y-0 right-0 w-14 bg-linear-to-l from-card to-transparent transition-opacity duration-200",
                  edges.next ? "opacity-100" : "opacity-0",
                )}
              />
            </div>
          </div>
        )}

        <AutoHeight>
          {dayTitles.length > 0 && currentDay ? (
            <ScrollFade className="max-h-[21rem] border-t border-border">
              <div
                role="radiogroup"
                aria-label={`Sessions on ${dayName(currentDay)}`}
                className="flex flex-col gap-4 px-3 py-3"
              >
                {dayTitles.map((t) => {
                  const sessions = onDay(t)
                  const prices = sessions
                    .map((s) => s.price)
                    .filter((p): p is number => typeof p === "number")
                  const from = prices.length ? Math.min(...prices) : null
                  // Tags that repeat a session format (IMAX on IMAX chips) add nothing.
                  const formats = new Set(sessions.map((s) => s.format))
                  const tags = (t.tags ?? [])
                    .filter((tag) => !formats.has(tag))
                    .slice(0, 2)
                  const meta = [
                    t.subtitle,
                    from !== null
                      ? `${new Set(prices).size > 1 ? "From " : ""}${formatMoney(from, currency, locale)}`
                      : null,
                  ].filter(Boolean)
                  return (
                    <motion.div
                      key={t.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className="flex gap-4"
                    >
                      <Poster title={t} />
                      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                        <div className="flex flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className={genuiType.title}>{t.name}</span>
                            {tags.map((tag) => (
                              <Badge key={tag} variant="secondary">
                                {tag}
                              </Badge>
                            ))}
                          </span>
                          {meta.length > 0 && (
                            <span className={genuiType.meta}>
                              {meta.join(" · ")}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {sessions.map((s) => {
                            const checked = s.id === choice
                            const few = s.fewLeft && !s.soldOut
                            const chip = (
                              // biome-ignore lint/a11y/useSemanticElements: one radio group spans every title, with roving tabindex across chips
                              <button
                                ref={(el) => {
                                  if (el) sessionRefs.current.set(s.id, el)
                                  else sessionRefs.current.delete(s.id)
                                }}
                                type="button"
                                role="radio"
                                aria-checked={checked}
                                aria-label={sessionLabel(t, s)}
                                tabIndex={s.id === tabStop ? 0 : -1}
                                disabled={s.soldOut || locked}
                                onClick={() => setChoice(s.id)}
                                onKeyDown={(e) => onSessionKey(e, s.id)}
                                className={cn(
                                  genuiHit, "relative inline-flex h-9 min-w-18 items-center justify-center gap-1 rounded-full px-3.5 text-[13px] font-medium tabular-nums transition-colors outline-none",
                                  "focus-visible:ring-2 focus-visible:ring-ring/50",
                                  checked
                                    ? "bg-accent ring-2 ring-choice ring-inset dark:bg-accent"
                                    : "border border-border bg-transparent hover:bg-accent dark:hover:bg-white/5",
                                  s.soldOut &&
                                    "border-transparent bg-transparent text-muted-foreground/45 dark:border-transparent",
                                  "disabled:cursor-not-allowed disabled:hover:bg-transparent",
                                  locked &&
                                    !checked &&
                                    !s.soldOut &&
                                    "opacity-60",
                                )}
                              >
                                {checked && (
                                  <CheckIcon aria-hidden className="size-3.5" />
                                )}
                                {formatTime(s.time, locale)}
                                {s.format && (
                                  <span
                                    className={cn(
                                      "text-[13px] font-normal",
                                      s.soldOut
                                        ? "text-muted-foreground/45"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {s.format}
                                  </span>
                                )}
                                {few && (
                                  <span
                                    aria-hidden
                                    className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-amber-500 ring-2 ring-card dark:bg-amber-400"
                                  />
                                )}
                              </button>
                            )
                            return (
                              <React.Fragment key={s.id}>
                                {s.soldOut && !locked ? (
                                  <WhyDisabled reason="Sold out">
                                    {chip}
                                  </WhyDisabled>
                                ) : few ? (
                                  <IconTip label="Few seats left">
                                    {chip}
                                  </IconTip>
                                ) : (
                                  chip
                                )}
                              </React.Fragment>
                            )
                          })}
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
                {streaming && <TitleSkeleton />}
              </div>
            </ScrollFade>
          ) : streaming ? (
            <div
              aria-hidden
              className="flex flex-col gap-5 border-t border-border px-3 py-3"
            >
              <TitleSkeleton />
              <TitleSkeleton />
            </div>
          ) : (
            <p
              className={cn(
                genuiType.body,
                "border-t border-border px-3 py-6 text-center text-muted-foreground",
              )}
            >
              Nothing this day
            </p>
          )}
        </AutoHeight>

        {/* Tickets and the total: their own row, above the decision. */}
        {!done && (range || total !== null) && (
          <div className="flex items-center justify-between gap-4 border-t border-border px-3 py-3">
            {range && (
              <div className="flex items-center gap-2.5">
                <span id={`${baseId}-qty`} className={genuiType.label}>
                  {qtyLabel}
                </span>
                <fieldset
                  aria-labelledby={`${baseId}-qty`}
                  className="m-0 flex items-center gap-1 border-0 p-0"
                >
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label={`Fewer ${qtyLabel.toLowerCase()}`}
                          disabled={locked || qty <= range.min}
                          onClick={() => setCount(qty - 1)}
                        />
                      }
                    >
                      <MinusIcon />
                    </TooltipTrigger>
                    <TooltipContent>{`Fewer ${qtyLabel.toLowerCase()}`}</TooltipContent>
                  </Tooltip>
                  <span
                    aria-live="polite"
                    className={cn(
                      "inline-flex min-w-8 justify-center",
                      genuiType.stat,
                      "text-[24px]",
                    )}
                  >
                    <span className="sr-only">{qty}</span>
                    <span aria-hidden className="inline-flex">
                      <SlidingNumber number={qty} initiallyStable />
                    </span>
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="secondary"
                          aria-label={`More ${qtyLabel.toLowerCase()}`}
                          disabled={locked || qty >= range.max}
                          onClick={() => setCount(qty + 1)}
                        />
                      }
                    >
                      <PlusIcon />
                    </TooltipTrigger>
                    <TooltipContent>{`More ${qtyLabel.toLowerCase()}`}</TooltipContent>
                  </Tooltip>
                </fieldset>
              </div>
            )}
            {!range && <span />}
            {total !== null && (
              <span className={genuiType.stat}>
                <span className="sr-only">
                  Total {formatMoney(total, currency, locale)}
                </span>
                <RollingDigits text={formatMoney(total, currency, locale)} />
              </span>
            )}
          </div>
        )}

        <SurfaceFooter className="flex-nowrap items-center justify-between gap-3">
          <p
            aria-live="polite"
            className={cn(genuiType.body, "min-w-0 flex-1")}
          >
            {streaming ? (
              <span className="text-[13px]">
                <ShimmeringText
                  text="Loading the schedule…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </span>
            ) : status === "dismissed" ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <XIcon aria-hidden className="size-4 shrink-0" />
                Closed
              </span>
            ) : status === "selected" && chosen ? (
              <span className="flex items-start gap-1.5 font-medium">
                <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>
                  {summary(chosen.title, chosen.session)}
                  {range && ` · ${qty} ${qtyLabel.toLowerCase()}`}
                  {total !== null &&
                    ` · ${formatMoney(total, currency, locale)}`}
                </span>
              </span>
            ) : status === "submitting" ? (
              <span className="text-muted-foreground">Sending…</span>
            ) : chosen ? (
              <span className="flex items-start gap-1.5 text-[14px] font-medium">
                <CalendarCheckIcon
                  aria-hidden
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                {summary(chosen.title, chosen.session)}
              </span>
            ) : (
              <span className={genuiType.meta}>Pick a time</span>
            )}
          </p>
          {!done && (
            <div className="flex shrink-0 gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={dismiss}
                disabled={locked}
              >
                Not now
              </Button>
              <WhyDisabled when={!chosen && !locked} reason="Pick a time first">
                <Button size="sm" onClick={submit} disabled={!chosen || locked}>
                  {status === "submitting"
                    ? "Sending…"
                    : (submitLabel ?? "Continue")}
                </Button>
              </WhyDisabled>
            </div>
          )}
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

function TitleSkeleton() {
  return (
    <div aria-hidden className="flex gap-4">
      <Skeleton className="aspect-[2/3] w-22 shrink-0 rounded-[12px]" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-4 w-40 max-w-full" />
        <Skeleton className="h-3 w-28" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-18 rounded-full" />
          <Skeleton className="h-9 w-18 rounded-full" />
          <Skeleton className="h-9 w-18 rounded-full" />
        </div>
      </div>
    </div>
  )
}
