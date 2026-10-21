"use client"

import * as React from "react"
import {
  ArrowDownRightIcon,
  ArrowUpRightIcon,
  ChartLineIcon,
  CheckIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { SERIES_VARS, seriesColor } from "@/components/genui/series-colors"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import {
  type CompiledModel,
  compileModel,
  FormulaError,
  finalValues,
  type ModelSpec,
  runModel,
  type SimRun,
  sampleIndexes,
} from "./simulation-engine"
import type {
  SimulationInput,
  SimulationInputField,
  SimulationMilestone,
  SimulationOutput,
  SimulationResult,
  SimulationState,
  SimulationStep,
} from "./simulation.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { RollingDigits } from "@/components/genui/genui-motion"
import { useGenUILocale } from "@/components/genui/locale"

export type SimulationStatus = "streaming" | "ready" | "applied"

export type SimulationProps = Partial<
  Omit<
    SimulationInput,
    "inputs" | "state" | "step" | "outputs" | "milestones" | "plot"
  >
> & {
  /** Arrays may hold partial items while the tool call streams. */
  inputs?: Partial<SimulationInputField>[]
  state?: Partial<SimulationState>[]
  step?: Partial<SimulationStep>[]
  outputs?: Partial<SimulationOutput>[]
  milestones?: Partial<SimulationMilestone>[]
  plot?: string[]
  /**
   * Lifecycle, controlled by the host. When omitted, the component tracks
   * whether the user applied the numbers.
   */
  status?: SimulationStatus
  /** Called when the user presses the apply button. */
  onResult?: (result: SimulationResult) => void
  /**
   * Numbers applied earlier (the tool call's stored output). Restores the
   * inputs read-only; never calls onResult.
   */
  result?: SimulationResult
  className?: string
}

type ReadyInput = SimulationInputField
type Tracked = { id: string; label: string; unit?: string; decimals?: number }
type Fmt = { unit?: string; decimals?: number }

// Neutral palette steps per theme, as in Chart: the first series always has
// the most contrast against the background.
const LIGHT = ["--chart-5", "--chart-2", "--chart-1"]
const DARK = ["--chart-1", "--chart-3", "--chart-2"]
const BUILT_IN_UNITS = new Set(["currency", "percent", "number"])

function precision(n: number) {
  return (String(n).split(".")[1] ?? "").length
}

function numberFormat(
  value: number,
  f: Fmt,
  currency: string,
  locale: string,
  compact = false,
): Intl.NumberFormat {
  const auto =
    f.unit === "currency"
      ? 0
      : f.unit === "percent"
        ? 1
        : Math.abs(value) >= 100
          ? 0
          : 1
  const max = f.decimals ?? auto
  const digits: Intl.NumberFormatOptions = compact
    ? { notation: "compact", maximumFractionDigits: 1 }
    : {
        minimumFractionDigits: f.decimals ?? 0,
        maximumFractionDigits: max,
      }
  if (f.unit === "currency") {
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        ...digits,
      })
    } catch {
      // Fall through for invalid currency codes.
    }
  }
  return new Intl.NumberFormat(locale, digits)
}

function suffix(f: Fmt) {
  if (f.unit === "percent") return "%"
  if (f.unit && !BUILT_IN_UNITS.has(f.unit)) return ` ${f.unit}`
  return ""
}

function formatValue(
  value: number,
  f: Fmt,
  currency: string,
  locale: string,
  compact = false,
) {
  if (!Number.isFinite(value)) return "—"
  return (
    numberFormat(value, f, currency, locale, compact).format(value) + suffix(f)
  )
}

/** The change against the baseline: a tinted badge with the magnitude, then "vs baseline". */
function DeltaVsBaseline({ d }: { d: { up: boolean; amount: string } | null }) {
  if (!d) return null
  const Icon = d.up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span className="flex min-w-0 flex-nowrap items-center gap-2">
      <Badge variant={d.up ? "success" : "destructive"} className="shrink-0">
        <Icon aria-hidden />
        {d.amount}
        <span className="sr-only">{d.up ? " increase" : " decrease"}</span>
      </Badge>
      <span className={cn(genuiType.meta, "min-w-0 truncate")}>
        vs baseline
      </span>
    </span>
  )
}

/** A formatted number whose digits roll when it changes. */
function AnimatedValue({
  value,
  f,
  currency,
}: {
  value: number
  f: Fmt
  currency: string
}) {
  const locale = useGenUILocale()
  if (!Number.isFinite(value)) return <span>—</span>
  const parts = numberFormat(value, f, currency, locale).formatToParts(value)
  const isNum = (t: string) =>
    t === "integer" || t === "group" || t === "decimal" || t === "fraction"
  const first = parts.findIndex((p) => isNum(p.type))
  const last =
    parts.length - 1 - [...parts].reverse().findIndex((p) => isNum(p.type))
  const text = (ps: Intl.NumberFormatPart[]) => ps.map((p) => p.value).join("")
  const fraction = parts.find((p) => p.type === "fraction")?.value.length ?? 0
  const unit = f.unit && !BUILT_IN_UNITS.has(f.unit) ? f.unit : null

  return (
    <span className="tabular-nums">
      <span className="sr-only">{formatValue(value, f, currency, locale)}</span>
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
        {f.unit === "percent" && "%"}
        {unit && (
          <span className="ml-1.5 font-sans text-[14px] leading-none font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
    </span>
  )
}

function currencySymbol(currency: string, locale: string) {
  try {
    return (
      new Intl.NumberFormat(locale, { style: "currency", currency })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? currency
    )
  } catch {
    return currency
  }
}

function clampTo(v: number, input: ReadyInput) {
  return Math.min(input.max, Math.max(input.min, v))
}

function InputRow({
  input,
  value,
  currency,
  disabled,
  onChange,
}: {
  input: ReadyInput
  value: number
  currency: string
  disabled: boolean
  onChange: (v: number) => void
}) {
  const locale = useGenUILocale()
  const id = React.useId()
  const [draft, setDraft] = React.useState<string | null>(null)
  const decimals = input.decimals ?? precision(input.step)
  const money = input.unit === "currency"
  const after = suffix(input).trim()
  const display = formatValue(value, { ...input, decimals }, currency, locale)

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="flex flex-col gap-2"
    >
      {/* The label and its value field share a line, so every track runs the full width. */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className={genuiType.label}>
          {input.label}
        </label>
        <div className="flex shrink-0 items-center gap-1">
          <div className="relative flex items-center gap-2">
            {money && (
              <span
                aria-hidden
                className="pointer-events-none absolute left-2.5 text-[13px] text-muted-foreground"
              >
                {currencySymbol(currency, locale)}
              </span>
            )}
            <Input
              id={id}
              type="number"
              inputMode="decimal"
              // Reads formatted ("500.00") except while it's being edited.
              value={draft ?? value.toFixed(decimals)}
              min={input.min}
              max={input.max}
              step={input.step}
              disabled={disabled}
              onFocus={() => setDraft(String(value))}
              onChange={(e) => {
                setDraft(e.target.value)
                const n = Number(e.target.value)
                if (e.target.value !== "" && Number.isFinite(n))
                  onChange(clampTo(n, input))
              }}
              onBlur={() => setDraft(null)}
              className={cn("w-28 text-right tabular-nums", money && "pl-6")}
            />
            {after && (
              <span className="text-[13px] text-muted-foreground">{after}</span>
            )}
          </div>
          <WhyDisabled
            when={disabled || value === input.default}
            reason="Already at the default"
          >
            <IconTip label="Reset to default">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Reset ${input.label} to default`}
                disabled={disabled || value === input.default}
                onClick={() => onChange(input.default)}
              >
                <RotateCcwIcon />
              </Button>
            </IconTip>
          </WhyDisabled>
        </div>
      </div>
      <SliderPrimitive.Root
        className="min-w-0"
        value={[value]}
        min={input.min}
        max={input.max}
        step={input.step}
        disabled={disabled}
        onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
        thumbAlignment="edge"
      >
        <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1.5 select-none data-disabled:opacity-50">
          <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
            <SliderPrimitive.Indicator className="h-full bg-choice" />
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            getAriaLabel={() => input.label}
            getAriaValueText={() => display}
            className="relative block h-6 w-3 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
          />
        </SliderPrimitive.Control>
      </SliderPrimitive.Root>
    </motion.div>
  )
}

const isStr = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)

type Compiled = { model: CompiledModel } | { error: string } | null

export function Simulation({
  title,
  description,
  currency = "USD",
  inputs = [],
  state = [],
  step,
  steps,
  stepUnit = "step",
  outputs = [],
  stopWhen,
  plot = [],
  milestones = [],
  baseline = true,
  apply = true,
  applyLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: SimulationProps) {
  const locale = useGenUILocale()
  const [values, setValues] = React.useState<Record<string, number>>(
    () => result?.inputs ?? {},
  )
  const [applied, setApplied] = React.useState(Boolean(result))
  // Row index under the cursor; null follows the last step.
  const [cursor, setCursor] = React.useState<number | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const reduceMotion = useReducedMotion()
  const titleId = React.useId()

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: SimulationStatus =
    applied && (statusProp === undefined || statusProp === "ready")
      ? "applied"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status === "applied"

  const readyInputs = inputs.filter(
    (i): i is ReadyInput =>
      isStr(i.id) &&
      isStr(i.label) &&
      isNum(i.min) &&
      isNum(i.max) &&
      isNum(i.step) &&
      isNum(i.default),
  )
  const readyState = state.filter(
    (s): s is SimulationState =>
      isStr(s.id) && isStr(s.label) && isStr(s.initial),
  )
  const readyOutputs = outputs.filter(
    (o): o is SimulationOutput =>
      isStr(o.id) && isStr(o.label) && isStr(o.formula),
  )
  const readySteps = (step ?? []).filter(
    (s): s is SimulationStep => isStr(s.id) && isStr(s.formula),
  )
  const readyMilestones = milestones.filter(
    (m): m is SimulationMilestone => isStr(m.label) && isStr(m.when),
  )
  const modelArrived = readySteps.length > 0 && isNum(steps)

  // Compile once per model; the key changes only when the model does.
  const specKey = modelArrived
    ? JSON.stringify({
        inputs: readyInputs.map(({ id, min, max, default: d }) => ({
          id,
          min,
          max,
          default: d,
        })),
        state: readyState.map(({ id, initial }) => ({ id, initial })),
        step: readySteps.map(({ id, formula }) => ({ id, formula })),
        steps,
        outputs: readyOutputs.map(({ id, formula }) => ({ id, formula })),
        stopWhen,
        milestones: readyMilestones.map(({ label, when }) => ({ label, when })),
      } satisfies ModelSpec)
    : null
  const compiled: Compiled = React.useMemo(() => {
    if (!specKey) return null
    try {
      return { model: compileModel(JSON.parse(specKey) as ModelSpec) }
    } catch (e) {
      return {
        error: e instanceof FormulaError ? e.message : "Invalid model",
      }
    }
  }, [specKey])
  const model = compiled && "model" in compiled ? compiled.model : null
  const modelError =
    compiled && "error" in compiled && !streaming ? compiled.error : null

  const current = (i: ReadyInput) => clampTo(values[i.id] ?? i.default, i)
  const currentInputs = Object.fromEntries(
    readyInputs.map((i) => [i.id, current(i)]),
  )
  const defaultInputs = Object.fromEntries(
    readyInputs.map((i) => [i.id, i.default]),
  )
  const inputsKey = JSON.stringify(currentInputs)
  const defaultsKey = JSON.stringify(defaultInputs)
  const run: SimRun | null = React.useMemo(
    () => (model ? runModel(model, JSON.parse(inputsKey)) : null),
    [model, inputsKey],
  )
  const baseRun: SimRun | null = React.useMemo(
    () => (model ? runModel(model, JSON.parse(defaultsKey)) : null),
    [model, defaultsKey],
  )
  const changed = inputsKey !== defaultsKey
  const showBaseline = Boolean(baseline && changed && baseRun?.rows.length)

  const tracked: Tracked[] = [...readyState, ...readyOutputs]
  const meta = (id: string) => tracked.find((t) => t.id === id)
  const series = plot
    .map((id) => meta(id))
    .filter((t): t is Tracked => t !== undefined)
    .slice(0, 3)

  const rows = run?.rows ?? []
  const lastIndex = Math.max(0, rows.length - 1)
  const cursorIndex = cursor === null ? lastIndex : Math.min(cursor, lastIndex)
  const cursorRow = rows[cursorIndex]

  // Words for steps: "month", "months", "Month".
  const unitWord = stepUnit.trim() || "step"
  const unitPlural = unitWord.endsWith("s") ? unitWord : `${unitWord}s`
  const unitTitle = unitWord.charAt(0).toUpperCase() + unitWord.slice(1)

  // Play moves the cursor across the run; reduced motion jumps to the end.
  React.useEffect(() => {
    if (!playing) return
    const duration = Math.min(5000, Math.max(1500, lastIndex * 50))
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      setCursor(Math.round(p * lastIndex))
      if (p < 1) frame = requestAnimationFrame(tick)
      else {
        setPlaying(false)
        setCursor(null)
      }
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, lastIndex])

  const play = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (reduceMotion) {
      setCursor(null)
      return
    }
    setCursor(0)
    setPlaying(true)
  }

  const applyNumbers = () => {
    if (!run) return
    setApplied(true)
    setPlaying(false)
    onResult?.({
      action: "apply",
      inputs: currentInputs,
      summary: finalValues(
        run,
        tracked.map((t) => t.id),
      ),
    })
  }

  // Chart rows: the current run and, once inputs change, the baseline.
  const length = Math.max(
    rows.length,
    showBaseline ? (baseRun?.rows.length ?? 0) : 0,
  )
  const chartRows = Array.from({ length }, (_, i) => {
    const row: Record<string, number | null> = { step: i }
    series.forEach((s, k) => {
      row[`s${k}`] = rows[i]?.[s.id] ?? null
      if (showBaseline) row[`b${k}`] = baseRun?.rows[i]?.[s.id] ?? null
    })
    return row
  })
  const config: ChartConfig = Object.fromEntries(
    series.flatMap((s, k) => {
      // Two or more series are told apart by the categorical palette; a single one keeps the tone ramp.
      const theme =
        series.length > 1
          ? { light: seriesColor(k), dark: seriesColor(k) }
          : { light: `var(${LIGHT[k]})`, dark: `var(${DARK[k]})` }
      return [
        [`s${k}`, { label: s.label, theme }],
        [`b${k}`, { label: `${s.label} (baseline)`, theme }],
      ]
    }),
  )
  const seriesFor = (slot: string) => series[Number(slot.slice(1))]
  const canDraw = series.length > 0 && rows.length > 0
  const sampled = sampleIndexes(chartRows.length)
  const sampleEvery = sampled.length > 1 ? sampled[1] - sampled[0] : 1

  const deltaText = (id: string) => {
    if (!run || !baseRun || !showBaseline) return null
    const t = meta(id)
    if (!t) return null
    const a = finalValues(run, [id])[id]
    const b = finalValues(baseRun, [id])[id]
    const d = a - b
    if (!Number.isFinite(d)) return null
    const f = { unit: t.unit, decimals: t.decimals }
    if (
      formatValue(Math.abs(d), f, currency, locale) ===
      formatValue(0, f, currency, locale)
    )
      return null
    return { up: d > 0, amount: formatValue(Math.abs(d), f, currency, locale) }
  }

  const stepText = (n: number | null, limit: number) =>
    n === null
      ? `Not within ${limit} ${unitPlural}`
      : n === 0
        ? "At the start"
        : `${unitTitle} ${n}`
  const baseNote = (n: number | null) =>
    showBaseline
      ? `Baseline: ${n === null ? "not reached" : n === 0 ? "at the start" : `${unitWord} ${n}`}`
      : null

  // The answer: milestones first, then where the run ends (unless a milestone
  // already says it). The first one is shown large.
  type Outcome = {
    key: string
    label: string
    value: string
    base: string | null
  }
  const outcomes: Outcome[] = []
  if (run && canDraw && !modelError && !run.invalid) {
    readyMilestones.forEach((m, i) => {
      const n = run.milestones[i] ?? null
      outcomes.push({
        key: `m${i}`,
        label: m.label,
        value: stepText(n, rows.length - 1),
        base: baseNote(baseRun?.milestones[i] ?? null),
      })
    })
    const endSaid = run.milestones.some(
      (n) => n !== null && n === run.stoppedAt,
    )
    if (stopWhen && !endSaid) {
      outcomes.push({
        key: "end",
        label: "Ends",
        value: stepText(run.stoppedAt, steps ?? 0),
        base: baseNote(baseRun?.stoppedAt ?? null),
      })
    }
  }
  const [hero, ...moreOutcomes] = outcomes
  // Without an outcome, the first plotted value at the cursor is the answer.
  const heroValue = !hero ? (series[0] ?? tracked[0]) : undefined
  const cursorValues = tracked.filter((t) => t.id !== heroValue?.id)
  const atEnd = cursorIndex === lastIndex && !playing

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="simulation"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Simulation"}
        className={cn(series.length > 1 && SERIES_VARS, className)}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400"
          >
            <ChartLineIcon className="size-5" />
          </span>
          <SurfaceTitle id={titleId} className="min-w-0">
            {title}
          </SurfaceTitle>
          {description && <p className="sr-only">{description}</p>}
        </SurfaceHeader>

        <div className="flex flex-col">
          {modelError ? (
            <div className="border-t border-border px-3 py-3">
              <div className="rounded-[10px] border border-border bg-transparent p-1">
                <p
                  role="alert"
                  className="flex items-center gap-3 rounded-md bg-red-500/10 px-3 py-3 text-[13px] dark:bg-red-400/10"
                >
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/15 dark:bg-red-400/15">
                    <TriangleAlertIcon
                      aria-hidden
                      className="size-4 shrink-0 text-red-500 dark:text-red-400"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    This model can't run: {modelError}
                  </span>
                </p>
              </div>
            </div>
          ) : canDraw && run ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className="flex flex-col"
            >
              <div
                aria-live="polite"
                className="flex flex-wrap items-end gap-x-6 gap-y-2 border-t border-border px-3 py-3"
              >
                {run.invalid ? (
                  <p className={cn(genuiType.body, "text-destructive")}>
                    The model produced an invalid value at {unitWord}{" "}
                    {run.invalid.step}.
                  </p>
                ) : hero ? (
                  <div className="flex flex-col gap-1.5">
                    <span className={genuiType.label}>{hero.label}</span>
                    <span className={genuiType.stat}>
                      <span className="sr-only">{hero.value}</span>
                      <RollingDigits text={hero.value} />
                    </span>
                    {hero.base && (
                      <span className={genuiType.meta}>{hero.base}</span>
                    )}
                  </div>
                ) : heroValue && cursorRow ? (
                  <div className="flex flex-col gap-1.5">
                    <span className={genuiType.label}>
                      {heroValue.label}, {unitWord} {cursorIndex}
                    </span>
                    <div className="flex min-w-0 flex-nowrap items-center gap-2">
                      <span className={cn(genuiType.stat, "min-w-0")}>
                        <AnimatedValue
                          value={cursorRow[heroValue.id]}
                          f={heroValue}
                          currency={currency}
                        />
                      </span>
                      {atEnd && <DeltaVsBaseline d={deltaText(heroValue.id)} />}
                    </div>
                  </div>
                ) : null}
                {moreOutcomes.map((o) => (
                  <div key={o.key} className="flex flex-col gap-1.5">
                    <span className={genuiType.label}>{o.label}</span>
                    <span className={genuiType.stat}>{o.value}</span>
                    {o.base && <span className={genuiType.meta}>{o.base}</span>}
                  </div>
                ))}
              </div>

              {/* The SVG is visual only; the table below carries the numbers. */}
              <div className="border-t border-border px-3 py-3">
                <div aria-hidden>
                  <ChartContainer
                    config={config}
                    className="aspect-auto h-32 w-full"
                  >
                    <LineChart
                      data={chartRows}
                      accessibilityLayer={false}
                      margin={{ top: 16, right: 8, bottom: 0, left: 0 }}
                    >
                      <CartesianGrid vertical={false} />
                      <XAxis
                        dataKey="step"
                        type="number"
                        domain={[0, Math.max(1, length - 1)]}
                        allowDecimals={false}
                        tickLine={false}
                        axisLine={false}
                        tickMargin={8}
                        minTickGap={24}
                      />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        tickMargin={4}
                        width="auto"
                        tickFormatter={(v) =>
                          formatValue(
                            Number(v),
                            series[0],
                            currency,
                            locale,
                            true,
                          )
                        }
                      />
                      <ChartTooltip
                        cursor={{ strokeDasharray: "3 3" }}
                        content={
                          <ChartTooltipContent
                            labelFormatter={(_, payload) =>
                              `${unitTitle} ${payload?.[0]?.payload?.step ?? ""}`
                            }
                            formatter={(value, _name, item) => {
                              const slot = String(item.dataKey)
                              const s = seriesFor(slot)
                              return (
                                <div className="flex w-full items-center gap-2">
                                  <span
                                    aria-hidden
                                    className="size-2.5 shrink-0 rounded-[2px]"
                                    style={{ backgroundColor: item.color }}
                                  />
                                  <span className="text-muted-foreground">
                                    {config[slot]?.label}
                                  </span>
                                  <span className="ml-auto pl-3 font-mono font-medium tabular-nums text-foreground">
                                    {formatValue(
                                      Number(value),
                                      s ?? {},
                                      currency,
                                      locale,
                                    )}
                                  </span>
                                </div>
                              )
                            }}
                          />
                        }
                      />
                      {(series.length > 1 || showBaseline) && (
                        <ChartLegend content={<ChartLegendContent />} />
                      )}
                      {showBaseline &&
                        series.map((s, k) => (
                          <Line
                            key={`b${s.id}`}
                            dataKey={`b${k}`}
                            name={`b${k}`}
                            type="monotone"
                            stroke={`var(--color-b${k})`}
                            strokeWidth={1.5}
                            strokeDasharray="5 4"
                            strokeOpacity={0.6}
                            dot={false}
                            activeDot={false}
                            isAnimationActive={false}
                          />
                        ))}
                      {series.map((s, k) => (
                        <Line
                          key={s.id}
                          dataKey={`s${k}`}
                          name={`s${k}`}
                          type="monotone"
                          stroke={`var(--color-s${k})`}
                          strokeWidth={2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          isAnimationActive={false}
                        />
                      ))}
                      {readyMilestones.map((m, i) => {
                        const n = run.milestones[i]
                        return n === null || n === undefined ? null : (
                          <ReferenceLine
                            key={m.label}
                            x={n}
                            stroke="var(--muted-foreground)"
                            strokeDasharray="3 3"
                            label={{
                              value: m.label,
                              position: "insideTopLeft",
                              fill: "var(--muted-foreground)",
                              fontSize: 12,
                            }}
                          />
                        )
                      })}
                      {(cursor !== null || playing) && (
                        <ReferenceLine
                          x={cursorIndex}
                          stroke="var(--foreground)"
                          strokeOpacity={0.4}
                        />
                      )}
                    </LineChart>
                  </ChartContainer>
                </div>

                <table className="sr-only">
                  <caption>
                    {`${title ?? "Simulation"} by ${unitWord}${sampleEvery > 1 ? `, every ${sampleEvery} ${unitPlural}` : ""}`}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{unitTitle}</th>
                      {series.map((s) => (
                        <th key={s.id} scope="col">
                          {s.label}
                        </th>
                      ))}
                      {showBaseline &&
                        series.map((s) => (
                          <th key={`b${s.id}`} scope="col">
                            {`${s.label} (baseline)`}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sampled.map((i) => (
                      <tr key={i}>
                        <th scope="row">{i}</th>
                        {series.map((s, k) => (
                          <td key={s.id}>
                            {formatValue(
                              chartRows[i][`s${k}`] ?? Number.NaN,
                              s,
                              currency,
                              locale,
                            )}
                          </td>
                        ))}
                        {showBaseline &&
                          series.map((s, k) => (
                            <td key={`b${s.id}`}>
                              {formatValue(
                                chartRows[i][`b${k}`] ?? Number.NaN,
                                s,
                                currency,
                                locale,
                              )}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center gap-3 border-t border-border px-3 py-3">
                <WhyDisabled when={lastIndex === 0} reason="Nothing to play">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={play}
                    disabled={lastIndex === 0}
                  >
                    {playing ? <PauseIcon /> : <PlayIcon />}
                    {playing ? "Pause" : "Play"}
                  </Button>
                </WhyDisabled>
                <SliderPrimitive.Root
                  className="flex-1"
                  value={[cursorIndex]}
                  min={0}
                  max={Math.max(1, lastIndex)}
                  step={1}
                  disabled={lastIndex === 0}
                  onValueChange={(v) => {
                    const n = Array.isArray(v) ? v[0] : v
                    setPlaying(false)
                    setCursor(n >= lastIndex ? null : n)
                  }}
                  thumbAlignment="edge"
                >
                  <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1.5 select-none data-disabled:opacity-50">
                    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
                      <SliderPrimitive.Indicator className="h-full bg-choice" />
                    </SliderPrimitive.Track>
                    <SliderPrimitive.Thumb
                      getAriaLabel={() => `Inspect ${unitWord}`}
                      getAriaValueText={() =>
                        `${unitTitle} ${cursorIndex} of ${lastIndex}`
                      }
                      className="relative block h-6 w-3 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
                    />
                  </SliderPrimitive.Control>
                </SliderPrimitive.Root>
                <span className="min-w-24 text-right text-[16px] leading-6 font-medium whitespace-nowrap tabular-nums">
                  <span className="sr-only">
                    {unitTitle} {cursorIndex}
                  </span>
                  <span
                    aria-hidden
                    className="inline-flex items-baseline justify-end"
                  >
                    {unitTitle}&nbsp;
                    <SlidingNumber number={cursorIndex} initiallyStable />
                  </span>
                </span>
              </div>

              {cursorRow && cursorValues.length > 0 && (
                <dl
                  className={cn(
                    "grid gap-x-6 gap-y-4 border-t border-border px-3 py-3",
                    // Never one tile alone on a row.
                    cursorValues.length === 1
                      ? "grid-cols-1"
                      : cursorValues.length === 2
                        ? "grid-cols-2"
                        : cursorValues.length === 4
                          ? "grid-cols-2 sm:grid-cols-4"
                          : "grid-cols-2 sm:grid-cols-3",
                  )}
                >
                  {cursorValues.map((t) => {
                    const delta = atEnd ? deltaText(t.id) : null
                    return (
                      <div key={t.id} className="flex min-w-0 flex-col gap-1">
                        <dt className={genuiType.label}>{t.label}</dt>
                        <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className={cn(genuiType.stat, "min-w-0")}>
                            <AnimatedValue
                              value={cursorRow[t.id]}
                              f={t}
                              currency={currency}
                            />
                          </span>
                          {delta && <DeltaVsBaseline d={delta} />}
                        </dd>
                      </div>
                    )
                  })}
                </dl>
              )}
            </motion.div>
          ) : run?.invalid && !streaming ? (
            <div className="border-t border-border px-3 py-3">
              <div className="rounded-[10px] border border-border bg-transparent p-1">
                <p
                  role="alert"
                  className="flex items-center gap-3 rounded-md bg-red-500/10 px-3 py-3 text-[13px] dark:bg-red-400/10"
                >
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-red-500/15 dark:bg-red-400/15">
                    <TriangleAlertIcon
                      aria-hidden
                      className="size-4 shrink-0 text-red-500 dark:text-red-400"
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    The model produced an invalid value at {unitWord}{" "}
                    {run.invalid.step}.
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <div className="border-t border-border px-3 py-3">
              <Skeleton className="h-56 w-full" />
            </div>
          )}

          {readyInputs.map((i) => (
            <div key={i.id} className="border-t border-border px-3 py-3">
              <InputRow
                input={i}
                value={current(i)}
                currency={currency}
                disabled={locked}
                onChange={(v) => setValues((prev) => ({ ...prev, [i.id]: v }))}
              />
            </div>
          ))}
          {readyInputs.length === 0 && (
            <div className="border-t border-border px-3 py-3">
              <Skeleton className="h-12" />
            </div>
          )}
        </div>

        {(streaming || locked || apply) && (
          <SurfaceFooter aria-live="polite">
            {streaming ? (
              <ShimmeringText
                text="Building simulation…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
                className="text-[13px] leading-4"
              />
            ) : locked ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4" />
                Sent
              </p>
            ) : null}
            {apply && !locked && (
              <WhyDisabled
                className="inline-flex ml-auto"
                when={streaming || !run || !rows.length || !!run.invalid}
                reason="Run the simulation first"
              >
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={streaming || !run || !rows.length || !!run.invalid}
                  onClick={applyNumbers}
                >
                  {applyLabel ?? "Use these numbers"}
                </Button>
              </WhyDisabled>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}
