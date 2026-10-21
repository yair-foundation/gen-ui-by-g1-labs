"use client"

import * as React from "react"
import { MotionConfig } from "motion/react"

import { cn } from "@/lib/utils"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
} from "@/components/genui/surface"
import { Slider } from "@/components/ui/slider"
import { RadioMark } from "@/components/genui/genui-motion"
import { useGenUILocale } from "@/components/genui/locale"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"

import { formatMoney, moneyParts, snapCount } from "./revenue-estimator-utils"
import type {
  RevenueEstimatorInput,
  RevenueEstimatorResult,
  RevenueEstimatorTier,
} from "./revenue-estimator.schema"

export type RevenueEstimatorStatus = "streaming" | "ready"

export type RevenueEstimatorProps = Partial<
  Omit<RevenueEstimatorInput, "tiers">
> & {
  /** Tiers may be partial while the tool call is still streaming. */
  tiers?: Partial<RevenueEstimatorTier>[]
  /** Lifecycle, controlled by the host. Controls are disabled while 'streaming'. */
  status?: RevenueEstimatorStatus
  /** Called with { action: "set" } shortly after the user settles on a count or price. */
  onResult?: (result: RevenueEstimatorResult) => void
  /** The last result from history. Restores the choice and never calls onResult. */
  result?: RevenueEstimatorResult
  className?: string
}

/** How long a choice must stay put before it's sent to the agent. */
const SETTLE_MS = 700

/** A money amount whose digits roll when it changes, with its currency symbol. */
function MoneyRoll({ value, currency }: { value: number; currency: string }) {
  const locale = useGenUILocale()
  const parts = moneyParts(value, currency, locale)
  return (
    <span
      aria-hidden
      className={cn(genuiType.stat, "inline-flex self-start items-baseline")}
    >
      {parts.prefix}
      <SlidingNumber
        number={value}
        decimalPlaces={parts.decimals}
        thousandSeparator={parts.group}
        decimalSeparator={parts.decimal}
        initiallyStable
      />
      {parts.suffix}
    </span>
  )
}

export function RevenueEstimator({
  question,
  title,
  countLabel,
  priceLabel,
  currency = "USD",
  min = 1,
  max = 50,
  step = 1,
  value,
  tiers = [],
  tierId,
  totalLabel,
  note,
  status: statusProp,
  onResult,
  result,
  className,
}: RevenueEstimatorProps) {
  const locale = useGenUILocale()
  const [chosenCount, setChosenCount] = React.useState<number | null>(() =>
    result ? result.count : null,
  )
  const [chosenTier, setChosenTier] = React.useState<string | null>(() =>
    result ? result.tierId : null,
  )
  const [announcement, setAnnouncement] = React.useState("")
  const settleTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const groupId = React.useId()

  const status: RevenueEstimatorStatus = statusProp ?? "ready"
  const streaming = status === "streaming"

  const readyTiers = tiers.filter(
    (t): t is RevenueEstimatorTier =>
      typeof t.id === "string" &&
      typeof t.label === "string" &&
      typeof t.price === "number",
  )
  const tier =
    readyTiers.find((t) => t.id === (chosenTier ?? tierId)) ?? readyTiers[0]
  const count = snapCount(
    chosenCount ?? value ?? Math.round((min + max) / 2),
    min,
    max,
    step,
  )
  const total = tier ? count * tier.price : 0
  const interactive = !streaming && readyTiers.length > 0

  const latest = React.useRef({ onResult, result })
  latest.current = { onResult, result }
  React.useEffect(() => () => clearTimeout(settleTimer.current), [])

  const settle = (nextCount: number, nextTier: RevenueEstimatorTier) => {
    clearTimeout(settleTimer.current)
    // History results are restored, never re-sent.
    if (latest.current.result) return
    settleTimer.current = setTimeout(() => {
      latest.current.onResult?.({
        action: "set",
        count: nextCount,
        tierId: nextTier.id,
        price: nextTier.price,
        total: nextCount * nextTier.price,
      })
    }, SETTLE_MS)
  }

  const changeCount = (n: number) => {
    const next = snapCount(n, min, max, step)
    if (next === count || !tier) return
    setChosenCount(next)
    setAnnouncement(
      `${next} ${countLabel?.toLowerCase() ?? ""}, total ${formatMoney(next * tier.price, currency, locale)}`,
    )
    settle(next, tier)
  }

  const changeTier = (next: RevenueEstimatorTier) => {
    if (next.id === tier?.id) return
    setChosenTier(next.id)
    setAnnouncement(
      `${next.label}, total ${formatMoney(count * next.price, currency, locale)}`,
    )
    settle(count, next)
  }

  return (
    <MotionConfig reducedMotion="user">
      {question && (
        <h2 className={cn(genuiType.title, "mb-3 text-[16px]")}>{question}</h2>
      )}
      <Surface
        data-slot="revenue-estimator"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Revenue estimator"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
        </SurfaceHeader>

          {/* Count: label above, then the slider with its live value (Halaska UI layout). */}
          <div className="flex flex-col gap-2 border-t border-border px-3 py-3">
            <span className={genuiType.label}>{countLabel}</span>
            <div className="flex items-center gap-3">
              <Slider
                className="flex-1"
                min={min}
                max={max}
                step={step}
                value={[count]}
                disabled={!interactive}
                aria-label={countLabel ?? "Count"}
                onValueChange={(v) => changeCount(Array.isArray(v) ? v[0] : v)}
              />
              <span
                aria-hidden
                className={cn(genuiType.value, "min-w-8 text-right")}
              >
                <SlidingNumber number={count} initiallyStable />
              </span>
            </div>
          </div>

          {/* Price: one radio per tier. */}
          <div
            role="radiogroup"
            aria-label={priceLabel ?? "Price"}
            className="flex flex-col gap-1 border-t border-border px-3 py-3"
          >
            <span className={cn(genuiType.label, "pb-1")}>{priceLabel}</span>
            {readyTiers.map((t) => {
              const selected = t.id === tier?.id
              return (
                <label
                  key={t.id}
                  className="-mx-1 flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 transition-colors hover:bg-muted dark:hover:bg-white/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50 has-disabled:cursor-default has-disabled:hover:bg-transparent dark:has-disabled:hover:bg-transparent"
                >
                  <input
                    type="radio"
                    name={groupId}
                    value={t.id}
                    checked={selected}
                    disabled={!interactive}
                    onChange={() => changeTier(t)}
                    className="peer sr-only"
                  />
                  <RadioMark checked={selected} />
                  <span className={cn(genuiType.body, "tabular-nums")}>
                    {t.label} — {formatMoney(t.price, currency, locale)}
                  </span>
                </label>
              )
            })}
            {streaming && readyTiers.length === 0 && (
              <Skeleton className="h-11 w-full" />
            )}
          </div>

          {/* The answer: Halaska's stat size, GenUI's rolling digits. */}
          <div className="flex flex-col gap-1 border-t border-border px-3 py-3">
            <span className={genuiType.label}>{totalLabel}</span>
            {tier ? (
              <>
                <MoneyRoll value={total} currency={currency} />
                <span className="sr-only">
                  {formatMoney(total, currency, locale)}
                </span>
              </>
            ) : (
              <Skeleton className="h-8 w-32" />
            )}
            {note && <p className={genuiType.meta}>{note}</p>}
          </div>
          <span className="sr-only" aria-live="polite">
            {announcement}
          </span>
      </Surface>
    </MotionConfig>
  )
}
