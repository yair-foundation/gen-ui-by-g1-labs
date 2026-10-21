"use client"

import * as React from "react"
import { CheckIcon, CopyIcon, MinusIcon, PlusIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  genuiType,
  Skeleton,
  Surface,
  genuiMotion,
} from "@/components/genui/surface"
import { Button } from "@/components/ui/button"

import {
  clampCount,
  copyText,
  formatQuantity,
  parseCount,
  type ScaleItem,
  type Scaled,
  scaleItem,
  type UnitLabel,
  unitWord,
} from "./quantity-scaler-utils"
import type {
  QuantityScalerInput,
  QuantityScalerItem,
  QuantityScalerResult,
} from "./quantity-scaler.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type QuantityScalerStatus = "streaming" | "ready"

type PartialItem = Partial<Omit<QuantityScalerItem, "scale">> & {
  scale?: QuantityScalerItem["scale"]
}

export type QuantityScalerProps = Partial<
  Omit<QuantityScalerInput, "items" | "unitLabel">
> & {
  /** Items and labels may be partial while the tool call is still streaming. */
  items?: PartialItem[]
  unitLabel?: Partial<UnitLabel>
  /**
   * Lifecycle, controlled by the host. The count can't be changed and nothing
   * is sent while 'streaming'. The scaler never locks.
   */
  status?: QuantityScalerStatus
  /**
   * Called with { action: "set" } shortly after the user settles on a count,
   * and with { action: "copy" } when they copy the list.
   */
  onResult?: (result: QuantityScalerResult) => void
  /**
   * The last result from history. Restores the count and never calls
   * onResult; the scaler stays usable.
   */
  result?: QuantityScalerResult
  className?: string
}

/** How long the count must stay put before it's sent to the agent. */
const SETTLE_MS = 700

/** A scaled amount whose digits roll when it changes. */
function AnimatedQuantity({ scaled }: { scaled: Scaled }) {
  return (
    <span className="tabular-nums">
      <span className="sr-only">{formatQuantity(scaled)}</span>
      <span aria-hidden className="inline-flex items-baseline">
        <SlidingNumber
          // A unit switch (975 g → 1.0 kg) swaps the number instead of rolling.
          key={scaled.unit}
          number={scaled.quantity}
          decimalPlaces={scaled.decimals}
          initiallyStable
        />
        {scaled.unit && <span className="ml-1">{scaled.unit}</span>}
      </span>
    </span>
  )
}

export function QuantityScaler({
  title,
  unitLabel,
  base,
  value,
  min = 1,
  max = 50,
  items = [],
  note,
  status: statusProp,
  onResult,
  result,
  className,
}: QuantityScalerProps) {
  const [chosen, setChosen] = React.useState<number | null>(() =>
    result?.action === "set" ? result.value : null,
  )
  // The text in the number field while the user is typing.
  const [draft, setDraft] = React.useState<string | null>(null)
  const [copied, setCopied] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const inputId = React.useId()
  const settleTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const copiedTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  const status: QuantityScalerStatus = statusProp ?? "ready"
  const streaming = status === "streaming"
  const interactive = !streaming && typeof base === "number" && base > 0

  const label: UnitLabel = {
    singular: unitLabel?.singular ?? unitLabel?.plural ?? "",
    plural: unitLabel?.plural ?? unitLabel?.singular ?? "",
  }
  const count = clampCount(chosen ?? value ?? base ?? min, min, max)
  const word = unitWord(count, label)

  const readyItems = items.filter(
    (i): i is ScaleItem =>
      typeof i.id === "string" &&
      typeof i.name === "string" &&
      i.name !== "" &&
      typeof i.quantity === "number",
  )
  const scaledFor = (n: number) =>
    readyItems.map((i) => ({ item: i, scaled: scaleItem(i, n, base ?? n) }))
  const rows = scaledFor(count)

  // Latest values for the debounced result, so it never reads stale props.
  const latest = React.useRef({ scaledFor, onResult, result })
  latest.current = { scaledFor, onResult, result }

  React.useEffect(
    () => () => {
      clearTimeout(settleTimer.current)
      clearTimeout(copiedTimer.current)
    },
    [],
  )

  const change = (n: number, announce: boolean) => {
    const next = clampCount(n, min, max)
    if (next === count) return
    setChosen(next)
    if (announce) setAnnouncement(`${next} ${unitWord(next, label)}`)
    clearTimeout(settleTimer.current)
    // History results are restored, never re-sent.
    if (result) return
    settleTimer.current = setTimeout(() => {
      const { scaledFor: scale, onResult: send } = latest.current
      send?.({
        action: "set",
        value: next,
        items: scale(next).map(({ item, scaled }) => ({
          id: item.id,
          quantity: scaled.quantity,
          unit: scaled.unit,
        })),
      })
    }, SETTLE_MS)
  }

  const commitDraft = () => {
    if (draft === null) return
    const n = parseCount(draft)
    if (n !== null) change(n, false)
    setDraft(null)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const moves: Record<string, number> = {
      ArrowUp: count + 1,
      ArrowDown: count - 1,
      PageUp: count + 5,
      PageDown: count - 5,
      Home: min,
      End: max,
    }
    if (e.key in moves) {
      e.preventDefault()
      setDraft(null)
      change(moves[e.key], false)
    } else if (e.key === "Enter") {
      e.preventDefault()
      commitDraft()
    } else if (e.key === "Escape") {
      setDraft(null)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        copyText(readyItems, count, base ?? count, label),
      )
      setCopied(true)
      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopied(false), 1500)
      if (!result) onResult?.({ action: "copy" })
    } catch {
      // Clipboard blocked (permissions, insecure context): nothing to copy into.
    }
  }

  const fieldText = draft ?? String(count)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="quantity-scaler"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Quantities"}
        className={className}
      >
        {/* The count: label above (Halaska UI layout), then − number + and the unit. */}
        <div className="flex flex-col gap-2 px-3 py-3">
          {label.plural ? (
            <label htmlFor={inputId} className={genuiType.label}>
              Number of {label.plural}
            </label>
          ) : (
            <Skeleton className="h-4 w-28" />
          )}
          <div className="flex w-full items-center gap-4">
            <WhyDisabled
              reason={
                interactive && count <= min ? "At the minimum" : undefined
              }
            >
              <IconTip label={`Fewer ${label.plural}`}>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-11 rounded-full"
                  aria-label={`Fewer ${label.plural}`}
                  disabled={!interactive || count <= min}
                  onClick={() => change(count - 1, true)}
                >
                  <MinusIcon className="size-5" />
                </Button>
              </IconTip>
            </WhyDisabled>
            <div className="flex flex-1 items-center justify-center gap-2">
              <div className="flex min-w-12 items-center justify-center">
                {typeof base === "number" ? (
                  <input
                    id={inputId}
                    type="text"
                    inputMode="numeric"
                    role="spinbutton"
                    autoComplete="off"
                    aria-valuenow={count}
                    aria-valuemin={min}
                    aria-valuemax={max}
                    aria-valuetext={`${count} ${word}`}
                    disabled={!interactive}
                    value={fieldText}
                    onChange={(e) => {
                      const t = e.target.value.replace(/\D/g, "").slice(0, 4)
                      setDraft(t)
                      const n = parseCount(t)
                      if (n !== null && n >= min && n <= max) change(n, false)
                    }}
                    onBlur={commitDraft}
                    onKeyDown={onKeyDown}
                    style={{
                      width: `${Math.max(2, fieldText.length) + 0.4}ch`,
                    }}
                    className={cn(
                      "font-figure lining-nums text-[24px] leading-none font-normal tracking-tight tabular-nums",
                      "rounded-lg bg-transparent text-center outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-100",
                    )}
                  />
                ) : (
                  <Skeleton className="h-8 w-10" />
                )}
              </div>
              <span aria-hidden className={genuiType.value}>
                {word}
              </span>
            </div>
            <WhyDisabled
              reason={
                interactive && count >= max ? "At the maximum" : undefined
              }
            >
              <IconTip label={`More ${label.plural}`}>
                <Button
                  variant="secondary"
                  size="icon"
                  className="size-11 rounded-full"
                  aria-label={`More ${label.plural}`}
                  disabled={!interactive || count >= max}
                  onClick={() => change(count + 1, true)}
                >
                  <PlusIcon className="size-5" />
                </Button>
              </IconTip>
            </WhyDisabled>
          </div>
          <span className="sr-only" aria-live="polite">
            {announcement}
          </span>
        </div>

        <AutoHeight>
          <div className="flex flex-col border-t border-border px-3 pt-3">
            {title && (
              <h3 className="text-[16px] leading-snug font-medium">{title}</h3>
            )}
            <ul
              className={cn(
                "flex flex-col divide-y divide-border",
                title && "mt-2",
              )}
            >
              {rows.map(({ item, scaled }) => (
                <motion.li
                  key={item.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex items-baseline justify-between gap-4 py-3"
                >
                  <span className={cn(genuiType.body, "min-w-0")}>
                    {item.name}
                  </span>
                  <span className="text-[14px] font-medium whitespace-nowrap tabular-nums">
                    <AnimatedQuantity scaled={scaled} />
                  </span>
                </motion.li>
              ))}
              {streaming && (
                <li className="flex flex-col gap-2 py-3">
                  {rows.length === 0 && (
                    <ShimmeringText
                      text="Working out quantities…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                      className="text-sm"
                    />
                  )}
                  <Skeleton className="h-5 w-full" />
                </li>
              )}
            </ul>
            {note && <p className={cn(genuiType.meta, "pt-1")}>{note}</p>}
          </div>
        </AutoHeight>

        <div className="border-t border-border px-3 py-3">
          <Button
            size="lg"
            className="h-11 w-full"
            disabled={streaming || rows.length === 0}
            onClick={copy}
          >
            {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
            {copied ? "Copied" : "Copy shopping list"}
          </Button>
          <span className="sr-only" aria-live="polite">
            {copied ? "Copied" : ""}
          </span>
        </div>
      </Surface>
    </MotionConfig>
  )
}
