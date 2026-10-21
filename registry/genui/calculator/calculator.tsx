"use client"

import * as React from "react"
import {
  CalculatorIcon,
  CheckIcon,
  CopyIcon,
  InfoIcon,
  MinusIcon,
  PlusIcon,
} from "lucide-react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { MotionConfig } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
} from "@/components/genui/surface"
import { useGenUILocale } from "@/components/genui/locale"

import {
  evaluate,
  FormulaError,
  parseFormula,
  variablesOf,
} from "./calculator-formula"
import {
  bandIndex,
  bandPosition,
  breakdownShares,
  type CalculatorBand,
  type CalculatorConfig,
  type CalculatorInput,
  type CalculatorOutput,
  type CalculatorResult,
  fillLabel,
  sliderRange,
  sliderTicks,
  statColumns,
} from "./calculator.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type CalculatorStatus = "streaming" | "ready" | "submitted"

type PartialInput = Partial<Omit<CalculatorInput, "control" | "format">> & {
  control?: CalculatorInput["control"]
  format?: CalculatorInput["format"]
}
type ReadyInput = PartialInput & { id: string; label: string; default: number }
type PartialOutput = Partial<Omit<CalculatorOutput, "format">> & {
  format?: CalculatorOutput["format"]
}
type ReadyOutput = PartialOutput & {
  id: string
  label: string
  formula: string
}

export type CalculatorProps = Partial<
  Omit<CalculatorConfig, "inputs" | "outputs">
> & {
  /** Inputs and outputs may be partial while the tool call streams. */
  inputs?: PartialInput[]
  outputs?: PartialOutput[]
  /**
   * Lifecycle, controlled by the host. Inputs that have arrived can be used
   * while 'streaming'. When omitted, the component tracks submission itself.
   */
  status?: CalculatorStatus
  /** Called when the user presses the submit button (only with `submitLabel`). */
  onResult?: (result: CalculatorResult) => void
  /**
   * Numbers sent earlier (e.g. the tool call's stored output). Restores the
   * inputs and the sent state; never calls onResult.
   */
  result?: CalculatorResult
  className?: string
}

type Formattable = {
  format?: "number" | "currency" | "percent"
  currency?: string
  decimals?: number
}

function numberFormat(f: Formattable, locale: string) {
  const digits =
    f.decimals !== undefined
      ? { minimumFractionDigits: f.decimals, maximumFractionDigits: f.decimals }
      : { maximumFractionDigits: 2 }
  if (f.format === "currency" && f.currency) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: f.currency,
        ...digits,
      })
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  return new Intl.NumberFormat(locale, digits)
}

function formatValue(
  value: number,
  f: Formattable & { unit?: string },
  locale: string,
) {
  const text =
    numberFormat(f, locale).format(value) + (f.format === "percent" ? "%" : "")
  return f.unit ? `${text} ${f.unit}` : text
}

/** Bands that have arrived whole; a scale needs at least two. */
function readyBands(o: PartialOutput): CalculatorBand[] {
  const bands = (o.bands ?? [])
    .filter((b): b is CalculatorBand => typeof b?.label === "string")
    // A tone still streaming ("go" of "good") counts as none yet.
    .map((b) =>
      b.tone && !Object.hasOwn(TONE, b.tone) ? { ...b, tone: undefined } : b,
    )
  return bands.length >= 2 ? bands : []
}

/* Literal classes so Tailwind sees them: result tiles per row, from the
   container's 28rem breakpoint up (two to a row below it). */
const WIDE_COLS = [
  "",
  "@md:grid-cols-1",
  "@md:grid-cols-2",
  "@md:grid-cols-3",
  "@md:grid-cols-4",
]

/* Semantic band colours: green and red match the theme's --up / --down. */
const TONE = {
  good: {
    solid: "bg-green-700 dark:bg-green-400",
    soft: "bg-green-700/25 dark:bg-green-400/25",
  },
  caution: {
    solid: "bg-amber-500 dark:bg-amber-400",
    soft: "bg-amber-500/25 dark:bg-amber-400/25",
  },
  bad: {
    solid: "bg-red-700 dark:bg-red-400",
    soft: "bg-red-700/25 dark:bg-red-400/25",
  },
} as const
const NEUTRAL = { solid: "bg-foreground/70", soft: "bg-foreground/15" }
const toneOf = (band: CalculatorBand) => (band.tone ? TONE[band.tone] : NEUTRAL)

/** A segmented scale of named ranges, the value's band filled and marked. */
function BandScale({
  label,
  value,
  bands,
}: {
  label: string
  value: number | undefined
  bands: CalculatorBand[]
}) {
  const active = value === undefined ? -1 : bandIndex(value, bands)
  return (
    <div className="flex flex-col gap-2.5 px-3 pt-3 pb-4">
      {/* Position only; the labels below say which band is current. */}
      <div aria-hidden className="relative flex h-2 gap-0.5">
        {bands.map((band, i) => (
          <div
            key={band.label}
            className={cn(
              "h-full flex-1 transition-colors first:rounded-l-full last:rounded-r-full motion-reduce:transition-none",
              i === active ? toneOf(band).solid : toneOf(band).soft,
            )}
          />
        ))}
        {value !== undefined && (
          <div
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground transition-[left] duration-300 motion-reduce:transition-none"
            style={{ left: `${bandPosition(value, bands)}%` }}
          />
        )}
      </div>
      <ol aria-label={`${label} ranges`} className="flex gap-0.5">
        {bands.map((band, i) => (
          <li
            key={band.label}
            aria-current={i === active || undefined}
            className={cn(
              "min-w-0 flex-1 truncate",
              genuiType.meta,
              i === 0
                ? "text-left"
                : i === bands.length - 1
                  ? "text-right"
                  : "text-center",
              i === active && "font-semibold text-foreground",
            )}
          >
            {band.label}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** A formatted number whose digits roll when it changes. */
function AnimatedValue({
  value,
  f,
}: {
  value: number
  f: Formattable & { unit?: string }
}) {
  const locale = useGenUILocale()
  const parts = numberFormat(f, locale).formatToParts(value)
  const isNum = (t: string) =>
    t === "integer" || t === "group" || t === "decimal" || t === "fraction"
  const first = parts.findIndex((p) => isNum(p.type))
  const last =
    parts.length - 1 - [...parts].reverse().findIndex((p) => isNum(p.type))
  const text = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join("")
  const fraction = parts.find((p) => p.type === "fraction")?.value.length ?? 0

  return (
    <span className="tabular-nums">
      <span className="sr-only">{formatValue(value, f, locale)}</span>
      <span aria-hidden className="inline-flex items-baseline">
        {text(parts.slice(0, first))}
        <SlidingNumber
          number={Math.abs(value)}
          decimalPlaces={fraction}
          decimalSeparator={
            parts.find((p) => p.type === "decimal")?.value ?? "."
          }
          thousandSeparator={parts.find((p) => p.type === "group")?.value}
          initiallyStable
        />
        {text(parts.slice(last + 1))}
        {f.format === "percent" && "%"}
        {f.unit && (
          // A unit is a label: sans-serif, regular weight, grey, whatever the figure's face and size.
          <span className="ml-1.5 font-sans text-[14px] leading-none font-normal text-muted-foreground">
            {f.unit}
          </span>
        )}
      </span>
    </span>
  )
}

/** Symbol and standard decimals for a currency, e.g. USD → "$", 2. */
function currencyInfo(currency: string, locale: string) {
  try {
    const nf = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
    })
    return {
      symbol:
        nf.formatToParts(0).find((p) => p.type === "currency")?.value ??
        currency,
      digits: nf.resolvedOptions().maximumFractionDigits ?? 2,
    }
  } catch {
    return null
  }
}

function clamp(v: number, input: PartialInput) {
  return Math.min(input.max ?? Infinity, Math.max(input.min ?? -Infinity, v))
}

function InputControl({
  input,
  value,
  disabled,
  onChange,
  stacked,
}: {
  input: ReadyInput
  value: number
  disabled: boolean
  onChange: (v: number) => void
  /** Label above the control, for a half-width cell. */
  stacked?: boolean
}) {
  const locale = useGenUILocale()
  const rowClass = stacked
    ? "flex flex-col items-start gap-2"
    : "flex items-center justify-between gap-4"
  const step = input.step ?? 1
  const id = React.useId()
  const [editing, setEditing] = React.useState(false)
  const money =
    input.format === "currency" && input.currency
      ? currencyInfo(input.currency, locale)
      : null
  const display = formatValue(value, input, locale)
  const label = (
    <label htmlFor={id} className={genuiType.label}>
      {input.label}
    </label>
  )

  // No control given means a slider (the schema's default).
  switch (input.control ?? "slider") {
    case "stepper": {
      // Round to the step's precision to avoid 0.30000000000000004.
      const precision = (String(step).split(".")[1] ?? "").length
      const nudge = (dir: 1 | -1) =>
        onChange(clamp(Number((value + dir * step).toFixed(precision)), input))
      return (
        <div className={rowClass}>
          <span className={genuiType.label} id={id}>
            {input.label}
          </span>
          <fieldset
            className={cn(
              "m-0 flex min-w-0 items-center gap-2 border-0 p-0",
              stacked && "w-full justify-between",
            )}
            aria-labelledby={id}
          >
            <WhyDisabled
              reason={
                !disabled &&
                value <= (input.min ?? -Infinity) &&
                "At the minimum"
              }
            >
              <IconTip label={`Decrease ${input.label}`}>
                <Button
                  size="icon"
                  variant="secondary"
                  className="rounded-full"
                  aria-label={`Decrease ${input.label}`}
                  disabled={disabled || value <= (input.min ?? -Infinity)}
                  onClick={() => nudge(-1)}
                >
                  <MinusIcon />
                </Button>
              </IconTip>
            </WhyDisabled>
            <span
              aria-live="polite"
              className={cn(
                "min-w-16 text-center font-figure text-[30px] leading-none font-normal tracking-tight tabular-nums",
                stacked && "flex-1",
              )}
            >
              <AnimatedValue value={value} f={input} />
            </span>
            <WhyDisabled
              reason={
                !disabled &&
                value >= (input.max ?? Infinity) &&
                "At the maximum"
              }
            >
              <IconTip label={`Increase ${input.label}`}>
                <Button
                  size="icon"
                  variant="secondary"
                  className="rounded-full"
                  aria-label={`Increase ${input.label}`}
                  disabled={disabled || value >= (input.max ?? Infinity)}
                  onClick={() => nudge(1)}
                >
                  <PlusIcon />
                </Button>
              </IconTip>
            </WhyDisabled>
          </fieldset>
        </div>
      )
    }
    case "slider": {
      const { min, max } = sliderRange(
        input.default ?? value,
        input.min,
        input.max,
      )
      const ticks = (input.ticks ?? sliderTicks(min, max, step)).filter(
        (t) => t >= min && t <= max,
      )
      const tickFormat = { ...input, unit: undefined }
      return (
        <div className="flex flex-col gap-2">
          {/* The label and its value share a line, so every track runs the full width. */}
          <div className="flex items-baseline justify-between gap-4">
            <span className={genuiType.label}>{input.label}</span>
            {/* The thumb announces the value; this is the visual readout. */}
            <span
              aria-hidden
              className="text-[16px] leading-6 font-medium whitespace-nowrap tabular-nums"
            >
              <AnimatedValue value={value} f={input} />
            </span>
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <SliderPrimitive.Root
              value={[value]}
              min={min}
              max={max}
              step={step}
              disabled={disabled}
              onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
              thumbAlignment="edge"
            >
              <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1 select-none data-disabled:opacity-50">
                <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-foreground/20">
                  <SliderPrimitive.Indicator className="h-full rounded-full bg-choice" />
                </SliderPrimitive.Track>
                <SliderPrimitive.Thumb
                  getAriaLabel={() => input.label}
                  getAriaValueText={() => display}
                  className="relative block h-7 w-3.5 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-1.5 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
                />
              </SliderPrimitive.Control>
            </SliderPrimitive.Root>
            {/* Visual scale; the slider announces its own value. */}
            {ticks.length > 1 && max > min && (
              <div aria-hidden className={cn("relative h-4", genuiType.meta)}>
                {ticks.map((t) => {
                  const pct = ((t - min) / (max - min)) * 100
                  return (
                    <span
                      key={t}
                      className="absolute top-0 whitespace-nowrap tabular-nums"
                      style={{
                        left: `${pct}%`,
                        transform: `translateX(-${pct}%)`,
                      }}
                    >
                      {formatValue(t, tickFormat, locale)}
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )
    }
    case "choice":
      return (
        <fieldset
          className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
          disabled={disabled}
        >
          <legend className={cn("mb-2 p-0", genuiType.label)}>
            {input.label}
          </legend>
          <div className="flex flex-wrap gap-1 rounded-full border border-border bg-transparent p-1">
            {input.options?.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={o.value === value}
                onClick={() => onChange(o.value)}
                className="flex-1 rounded-full px-3.5 py-1.5 text-[13px] whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-accent aria-pressed:text-foreground"
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
      )
    case "toggle":
      return (
        <div className="flex items-center justify-between gap-4">
          {label}
          <Switch
            id={id}
            nativeButton
            checked={value !== 0}
            disabled={disabled}
            onCheckedChange={(on) => onChange(on ? 1 : 0)}
          />
        </div>
      )
    default:
      return (
        <div className={rowClass}>
          {label}
          <div
            className={cn(
              "relative flex items-center gap-2",
              stacked && "w-full",
            )}
          >
            {money && (
              <span
                aria-hidden
                className="pointer-events-none absolute left-3.5 text-[13px] text-muted-foreground"
              >
                {money.symbol}
              </span>
            )}
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              // Money reads as money ("186.40") except while it's being edited.
              value={
                !Number.isFinite(value)
                  ? ""
                  : money && !editing
                    ? value.toFixed(money.digits)
                    : value
              }
              onFocus={() => setEditing(true)}
              min={input.min}
              max={input.max}
              step={input.step}
              disabled={disabled}
              onChange={(e) =>
                onChange(
                  e.target.value === "" ? Number.NaN : Number(e.target.value),
                )
              }
              onBlur={() => {
                setEditing(false)
                if (Number.isFinite(value)) onChange(clamp(value, input))
              }}
              className={cn(
                "text-right tabular-nums",
                stacked ? "w-full" : "w-32",
                money && "pl-7",
              )}
            />
            {(input.unit || input.format === "percent") && (
              <span className={genuiType.value}>
                {input.format === "percent" ? "%" : input.unit}
              </span>
            )}
          </div>
        </div>
      )
  }
}

/** Breakdown part fills: chart tokens, darkest first, flipped for dark mode. */
const PART_BG = [
  "bg-chart-5 dark:bg-chart-1",
  "bg-chart-2 dark:bg-chart-3",
  "bg-chart-1 dark:bg-chart-2",
]

type Computed =
  | { state: "value"; value: number }
  | { state: "invalid" }
  | { state: "pending" }
  | { state: "error"; message: string }

export function Calculator({
  title,
  description,
  inputs = [],
  outputs = [],
  assumptions,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: CalculatorProps) {
  const locale = useGenUILocale()
  const [values, setValues] = React.useState<Record<string, number>>(
    () => result?.inputs ?? {},
  )
  const [submitted, setSubmitted] = React.useState(Boolean(result))
  const [copied, setCopied] = React.useState(false)

  // A host-provided "ready" (or nothing) yields to the user's submission.
  const status: CalculatorStatus =
    submitted && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status === "submitted"

  const readyInputs = inputs.filter(
    (i): i is ReadyInput =>
      typeof i.id === "string" &&
      typeof i.label === "string" &&
      typeof i.default === "number",
  )
  const readyOutputs = outputs.filter(
    (o): o is ReadyOutput =>
      typeof o.id === "string" &&
      typeof o.label === "string" &&
      typeof o.formula === "string",
  )
  const currentValue = (i: ReadyInput) => values[i.id] ?? i.default

  // Evaluate outputs in order; later outputs may use earlier ones.
  const scope: Record<string, number> = {}
  for (const i of readyInputs) scope[i.id] = currentValue(i)
  const compute = (formula: string): Computed => {
    try {
      const tree = parseFormula(formula)
      const missing = [...variablesOf(tree)].filter(
        (v) => !Object.hasOwn(scope, v),
      )
      if (missing.length) {
        return streaming
          ? { state: "pending" }
          : { state: "error", message: `Unknown value "${missing[0]}"` }
      }
      const v = evaluate(tree, scope)
      return Number.isFinite(v)
        ? { state: "value", value: v }
        : { state: "invalid" }
    } catch (e) {
      return streaming
        ? { state: "pending" }
        : {
            state: "error",
            message: e instanceof FormulaError ? e.message : "Invalid formula",
          }
    }
  }
  const computed = new Map<string, Computed>()
  for (const o of readyOutputs) {
    const result = compute(o.formula)
    computed.set(o.id, result)
    scope[o.id] = result.state === "value" ? result.value : Number.NaN
  }

  const primary = readyOutputs.find((o) => o.primary) ?? readyOutputs[0]
  const secondary = readyOutputs.filter((o) => o !== primary)

  // `{id}` in output labels shows that input's current value.
  const labelValues = Object.fromEntries(
    readyInputs.map((i) => [
      i.id,
      formatValue(currentValue(i), { ...i, unit: undefined }, locale),
    ]),
  )
  const outputLabel = (o: ReadyOutput) => fillLabel(o.label, labelValues)

  // Breakdown of the primary output; parts may use any output.
  const parts = (primary?.breakdown?.parts ?? []).filter(
    (p): p is { label: string; formula: string } =>
      typeof p?.label === "string" && typeof p?.formula === "string",
  )
  const partResults = parts.map((p) => compute(p.formula))
  const shares = breakdownShares(
    partResults.map((c) => (c.state === "value" ? c.value : 0)),
  )

  // The value's named range, when the output has bands.
  const bandOf = (o: ReadyOutput) => {
    const c = computed.get(o.id)
    const bands = readyBands(o)
    return c?.state === "value" && bands.length
      ? bands[bandIndex(c.value, bands)]
      : undefined
  }
  const resultText = (o: ReadyOutput) => {
    const c = computed.get(o.id)
    if (c?.state !== "value") return "—"
    const band = bandOf(o)
    return formatValue(c.value, o, locale) + (band ? ` (${band.label})` : "")
  }
  // One scale at most: the first output with bands.
  const scaled = readyOutputs.find((o) => readyBands(o).length)
  const scaledValue = scaled ? computed.get(scaled.id) : undefined

  const tiles = primary ? [primary, ...secondary] : []
  // Result tiles on a grid that leaves no tile alone on a row (see statColumns).
  const narrow = statColumns(tiles.length, 2)
  const wide = statColumns(tiles.length)
  const tile = (o: ReadyOutput, lead = false) => {
    const band = bandOf(o)
    return (
      <div
        key={o.id}
        className={cn(
          "flex min-w-0 flex-col gap-1 px-3 pt-3 pb-3",
          lead && narrow.lead && "col-span-full",
          lead && (wide.lead ? "@md:col-span-full" : "@md:col-span-1"),
        )}
      >
        <span className={genuiType.label}>{outputLabel(o)}</span>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className={genuiType.stat}>{renderResult(o)}</span>
          {band && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[12px] font-medium">
              {band.tone && (
                <span
                  aria-hidden
                  className={cn("size-2 rounded-full", TONE[band.tone].solid)}
                />
              )}
              {band.label}
            </span>
          )}
        </span>
      </div>
    )
  }

  const copy = async () => {
    const lines = [
      title,
      ...readyInputs.map(
        (i) => `${i.label}: ${formatValue(currentValue(i), i, locale)}`,
      ),
      "",
      ...readyOutputs.map((o) => `${outputLabel(o)}: ${resultText(o)}`),
    ].filter((l) => l !== undefined)
    try {
      await navigator.clipboard.writeText(lines.join("\n"))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (permissions, insecure context): nothing to copy into.
    }
  }

  const submit = () => {
    setSubmitted(true)
    onResult?.({
      action: "submit",
      inputs: Object.fromEntries(
        readyInputs.map((i) => [i.id, currentValue(i)]),
      ),
      outputs: Object.fromEntries(
        readyOutputs.map((o) => {
          const c = computed.get(o.id)
          return [o.id, c?.state === "value" ? c.value : null]
        }),
      ),
    })
  }

  const renderComputed = (c: Computed | undefined, f: ReadyOutput) => {
    if (!c || c.state === "pending") {
      return <Skeleton className="inline-block h-4 w-16 align-middle" />
    }
    if (c.state === "error") {
      return (
        <span className="text-[13px] text-destructive">
          Formula error: {c.message}
        </span>
      )
    }
    if (c.state === "invalid")
      return <span className="text-muted-foreground">—</span>
    return <AnimatedValue value={c.value} f={f} />
  }
  const renderResult = (o: ReadyOutput) => renderComputed(computed.get(o.id), o)

  // Compact inputs (steppers, number fields) pair up two to a line; sliders
  // and choices keep a full row of their own.
  const isCompact = (i: ReadyInput) =>
    i.control !== undefined &&
    i.control !== "slider" &&
    i.control !== "choice" &&
    i.control !== "toggle"
  const inputRows: ReadyInput[][] = []
  for (const i of readyInputs) {
    const last = inputRows[inputRows.length - 1]
    if (isCompact(i) && last && last.length === 1 && isCompact(last[0])) {
      last.push(i)
    } else {
      inputRows.push([i])
    }
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="calculator"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Calculator"}
        className={cn("@container", className)}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-amber-500/15 text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
          >
            <CalculatorIcon className="size-5" />
          </span>
          <SurfaceTitle className="min-w-0 text-[20px] leading-[1.3] text-foreground">
            {title}
          </SurfaceTitle>
          {description && <p className="sr-only">{description}</p>}
        </SurfaceHeader>

        <AutoHeight>
          <div className="flex flex-col">
            {(primary || streaming) && (
              <div
                aria-live="polite"
                className="flex flex-col border-t border-border"
              >
                {!primary && (
                  <div className="flex min-w-0 flex-col gap-1 px-3 pt-3 pb-3">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-8 w-48" />
                  </div>
                )}
                {tiles.length > 0 && (
                  <div
                    className={cn(
                      "grid",
                      narrow.columns === 1 ? "grid-cols-1" : "grid-cols-2",
                      WIDE_COLS[wide.columns],
                    )}
                  >
                    {tiles.map((o, i) => tile(o, i === 0))}
                  </div>
                )}
                {scaled && (
                  <BandScale
                    label={outputLabel(scaled)}
                    value={
                      scaledValue?.state === "value"
                        ? scaledValue.value
                        : undefined
                    }
                    bands={readyBands(scaled)}
                  />
                )}
                {primary && parts.length > 1 && (
                  <div className="flex flex-col gap-2.5 px-3 pb-3">
                    {/* Proportions only; the labels below carry the values. */}
                    <div
                      aria-hidden
                      className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
                    >
                      {shares.every((share) => share === 0) && (
                        <div className="h-full w-full bg-muted" />
                      )}
                      {shares.map(
                        (share, i) =>
                          share > 0 && (
                            <div
                              key={parts[i]?.label}
                              className={cn(
                                "h-full transition-[width] duration-300 motion-reduce:transition-none",
                                PART_BG[i],
                              )}
                              style={{ width: `${share}%` }}
                            />
                          ),
                      )}
                    </div>
                    <dl className="flex justify-between gap-4">
                      {parts.map((part, i) => (
                        <div
                          key={part.label}
                          className={cn(
                            "flex min-w-0 flex-col gap-0.5",
                            i === parts.length - 1 && "items-end text-right",
                            i > 0 &&
                              i < parts.length - 1 &&
                              "items-center text-center",
                          )}
                        >
                          <dt
                            className={cn(
                              "flex items-center gap-1.5",
                              genuiType.meta,
                            )}
                          >
                            <span
                              aria-hidden
                              className={cn(
                                "size-2.5 shrink-0 rounded-[3px]",
                                PART_BG[i],
                              )}
                            />
                            {part.label}
                          </dt>
                          <dd className="text-[13px] font-semibold tabular-nums">
                            {renderComputed(partResults[i], primary)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            )}

            {/* Inputs: compact ones pair up on one line, sliders and choices
                take a full row; a hairline runs edge to edge between rows. */}
            {inputRows.map((row) =>
              row.length === 2 ? (
                <div
                  key={row.map((i) => i.id).join("+")}
                  className="grid grid-cols-2 border-t border-border"
                >
                  {row.map((i, n) => (
                    <div
                      key={i.id}
                      className={cn(
                        "min-w-0 px-3 py-3",
                        n === 1 && "border-l border-border",
                      )}
                    >
                      <InputControl
                        input={i}
                        stacked
                        value={currentValue(i)}
                        disabled={locked}
                        onChange={(v) =>
                          setValues((prev) => ({ ...prev, [i.id]: v }))
                        }
                      />
                    </div>
                  ))}
                </div>
              ) : (
                row.map((i) => (
                  <div key={i.id} className="border-t border-border px-3 py-3">
                    <InputControl
                      input={i}
                      value={currentValue(i)}
                      disabled={locked}
                      onChange={(v) =>
                        setValues((prev) => ({ ...prev, [i.id]: v }))
                      }
                    />
                  </div>
                ))
              ),
            )}
            {readyInputs.length === 0 && (
              <div className="border-t border-border px-3 py-3">
                <Skeleton className="h-10 rounded-lg" />
              </div>
            )}
          </div>
        </AutoHeight>

        <SurfaceFooter className="flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {/* The note (assumptions, a disclaimer) on the left; the actions, grouped, on the right. */}
          {!streaming && assumptions && assumptions.length > 0 && (
            <p
              className={cn(
                genuiType.meta,
                "flex min-w-0 flex-1 items-start gap-1.5",
              )}
            >
              <InfoIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              <span>{assumptions.join(" ")}</span>
            </p>
          )}
          <div className="ml-auto flex items-center gap-2">
            {streaming ? (
              <ShimmeringText
                text="Building calculator…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
                className="text-[13px]"
              />
            ) : locked ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4" />
                Sent
              </p>
            ) : (
              <Button
                size="sm"
                variant={submitLabel ? "secondary" : "default"}
                onClick={copy}
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
                {copied ? (
                  "Copied"
                ) : (
                  <>
                    Copy<span className="sr-only"> results</span>
                  </>
                )}
              </Button>
            )}
            {submitLabel && !locked && (
              <Button size="sm" disabled={streaming} onClick={submit}>
                {submitLabel}
              </Button>
            )}
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
