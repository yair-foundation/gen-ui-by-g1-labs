"use client"

import * as React from "react"
import { CheckIcon, GripVerticalIcon, RotateCcwIcon } from "lucide-react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { MotionConfig, Reorder, motion, useDragControls } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/genui/date-picker"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { CheckMark } from "@/components/genui/genui-motion"

import {
  applyPreset,
  batchEdit,
  type ChipsControl,
  type Control,
  type ControlValue,
  coerceValue,
  currentValues,
  type DateRange,
  type DateRangeControl,
  diffValues,
  formatSlider,
  initialValues,
  isControlReady,
  matchPreset,
  moveItem,
  nextSend,
  type PrioritiesControl,
  type Preset,
  rangeDays,
  rebaseEdits,
  type SegmentedControl,
  type SliderControl,
  setRangeEnd,
  shortLabel,
  sliderValueText,
  summarizeChanges,
  type ToggleControl,
  toggleChip,
  type Values,
  valuesEqual,
} from "./preference-controls-utils"
import type {
  PreferenceControl,
  PreferenceControlsInput,
  PreferenceControlsResult,
  PreferencePreset,
} from "./preference-controls.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type PreferenceControlsStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "sent"

export type PreferenceControlsProps = Partial<
  Omit<PreferenceControlsInput, "controls" | "presets">
> & {
  /** Controls and presets may be partial while the tool call streams. */
  controls?: Partial<PreferenceControl>[]
  presets?: Partial<PreferencePreset>[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the agent redoes the answer. When
   * omitted, the component shows "Sent · updating" after each send until new
   * props arrive.
   */
  status?: PreferenceControlsStatus
  /** Called on every update or reset. The component never locks. */
  onResult?: (result: PreferenceControlsResult) => void
  /**
   * The last thing sent, from history. Shows those values read-only and never
   * calls onResult.
   */
  result?: PreferenceControlsResult
  className?: string
}

/** Live mode waits this long after the last change before sending. */
const LIVE_DELAY_MS = 600

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background"

// ---- Controls ----

type FieldProps<C extends Control, V> = {
  control: C
  value: V
  disabled: boolean
  onChange: (value: V) => void
}

/** The locale's separators, matching the locale-aware formatting in utils. */
function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234.5)
  return {
    group: parts.find((p) => p.type === "group")?.value ?? ",",
    decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
  }
}

/**
 * A formatted value ("€650", "40%", "30 min") whose digits roll when it
 * changes. Text without a plain number is shown as is.
 */
function RollingFigure({ text }: { text: string }) {
  const locale = useGenUILocale()
  const first = text.search(/\d/)
  let last = -1
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\d/.test(text[i])) {
      last = i
      break
    }
  }
  const body = first >= 0 ? text.slice(first, last + 1) : ""
  const { group, decimal } = separators(locale)
  const point = body.lastIndexOf(decimal)
  const decimals = point >= 0 ? body.length - point - 1 : 0
  const number = Number(body.split(group).join("").replace(decimal, "."))
  if (!body || !Number.isFinite(number)) return <>{text}</>
  return (
    <span className="inline-flex items-baseline">
      {text.slice(0, first)}
      <SlidingNumber
        number={number}
        decimalPlaces={decimals}
        thousandSeparator={body.includes(group) ? group : undefined}
        decimalSeparator={decimal}
        initiallyStable
      />
      {text.slice(last + 1)}
    </span>
  )
}

function SliderField({
  control: c,
  value,
  disabled,
  onChange,
}: FieldProps<SliderControl, number>) {
  const locale = useGenUILocale()
  const text = formatSlider(c, value, locale)
  // Only named ends ("Relaxed" / "Packed") are shown; numeric ends are noise.
  const ends = c.minLabel || c.maxLabel
  return (
    <div className="flex flex-col gap-2">
      {/* Label above, then the slider with its live value (Halaska UI layout). */}
      <span aria-hidden className={genuiType.label}>
        {c.label}
      </span>
      <div className="flex items-center gap-3">
        <SliderPrimitive.Root
          value={[value]}
          min={c.min}
          max={c.max}
          step={c.step}
          disabled={disabled}
          onValueChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
          thumbAlignment="edge"
          className="min-w-0 flex-1"
        >
          <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1 select-none data-disabled:opacity-50">
            <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
              <SliderPrimitive.Indicator className="h-full bg-choice" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              getAriaLabel={() => c.label}
              getAriaValueText={() => sliderValueText(c, value, locale)}
              className="relative block h-6 w-3 shrink-0 rounded-full bg-brand ring-brand/30 transition-[box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden"
            />
          </SliderPrimitive.Control>
        </SliderPrimitive.Root>
        <span
          aria-hidden
          className={cn(
            genuiType.value,
            "shrink-0 text-right whitespace-nowrap",
          )}
        >
          <RollingFigure text={text} />
        </span>
      </div>
      {ends && (
        <div
          aria-hidden
          className={cn(genuiType.meta, "mt-1 flex justify-between gap-3")}
        >
          <span>{c.minLabel}</span>
          <span className="text-right">{c.maxLabel}</span>
        </div>
      )}
    </div>
  )
}

/**
 * Native radios styled as a segmented row (the shared Segmented look: hollow
 * bordered track, selected segment filled). Kept as radios, not the shared
 * Segmented, because presets can have nothing selected (Custom) and radios
 * keep arrow-key navigation. Used for options and presets.
 */
function Segments({
  name,
  options,
  value,
  disabled,
  onChange,
  trailing,
}: {
  name: string
  options: { value: string; label: string }[]
  value: string | null
  disabled: boolean
  onChange: (value: string) => void
  trailing?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap gap-0.5 rounded-full border border-border p-1">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "relative flex min-h-8 flex-1 items-center justify-center rounded-full px-3.5 text-[13px] leading-5 whitespace-nowrap text-muted-foreground transition-colors select-none",
            "has-checked:bg-accent has-checked:text-foreground",
            "has-focus-visible:ring-2 has-focus-visible:ring-ring/50",
            disabled ? "opacity-60" : "cursor-pointer hover:text-foreground",
            !disabled && value !== o.value && "hover:bg-accent",
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            disabled={disabled}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          {o.label}
        </label>
      ))}
      {trailing}
    </div>
  )
}

function SegmentedField({
  control: c,
  value,
  disabled,
  onChange,
}: FieldProps<SegmentedControl, string>) {
  const name = React.useId()
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={cn(genuiType.label, "mb-1.5")}>{c.label}</legend>
      <Segments
        name={name}
        options={c.options}
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    </fieldset>
  )
}

function ToggleField({
  control: c,
  value,
  disabled,
  onChange,
}: FieldProps<ToggleControl, boolean>) {
  const id = React.useId()
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-col">
        <label
          id={`${id}-label`}
          htmlFor={id}
          className="text-[13px] leading-5 font-medium"
        >
          {c.label}
        </label>
        {c.help && (
          <p id={`${id}-help`} className="sr-only">
            {c.help}
          </p>
        )}
      </div>
      <Switch
        nativeButton
        id={id}
        aria-labelledby={`${id}-label`}
        checked={value}
        disabled={disabled}
        aria-describedby={c.help ? `${id}-help` : undefined}
        onCheckedChange={(on: boolean) => onChange(Boolean(on))}
        className="relative after:absolute after:-inset-1.5"
      />
    </div>
  )
}

function ChipsField({
  control: c,
  value,
  disabled,
  onChange,
}: FieldProps<ChipsControl, string[]>) {
  const labelId = React.useId()
  const full = c.max !== undefined && value.length >= c.max
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className={genuiType.label}>
          {c.label}
        </span>
        {c.max !== undefined && (
          <span className={cn(genuiType.meta, "tabular-nums")}>
            <span aria-hidden>
              {value.length}/{c.max}
            </span>
            <span className="sr-only">
              {value.length} of up to {c.max} selected
            </span>
          </span>
        )}
      </div>
      {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset */}
      <div
        role="group"
        aria-labelledby={labelId}
        className="grid gap-2"
        style={{
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 9rem), 1fr))",
        }}
      >
        {c.options.map((o) => {
          const on = value.includes(o)
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={disabled || (full && !on)}
              onClick={() => onChange(toggleChip(c, value, o))}
              className={cn(
                "flex min-h-11 items-center gap-3 rounded-[10px] border border-border px-3 py-3 text-left text-[13px] leading-5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                focusRing,
                on
                  ? "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent"
                  : "hover:bg-accent",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md border border-border text-white transition-colors",
                  on && "border-transparent bg-choice",
                )}
              >
                {on && <CheckMark className="size-3" />}
              </span>
              <span className="min-w-0">{o}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function DateRangeField({
  control: c,
  value,
  disabled,
  onChange,
}: FieldProps<DateRangeControl, DateRange>) {
  const id = React.useId()
  const days = rangeDays(value)
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend
        className={cn(
          genuiType.label,
          "mb-1.5 flex w-full items-baseline justify-between gap-3",
        )}
      >
        {c.label}
      </legend>
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-start`} className={genuiType.label}>
            From<span className="sr-only">{` (${c.label})`}</span>
          </label>
          <DatePicker
            id={`${id}-start`}
            type="date"
            value={value.start}
            min={c.min}
            max={c.max}
            disabled={disabled}
            onValueChange={(v) => onChange(setRangeEnd(value, "start", v))}
            className="w-full tabular-nums"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-end`} className={genuiType.label}>
            To<span className="sr-only">{` (${c.label})`}</span>
          </label>
          <DatePicker
            id={`${id}-end`}
            type="date"
            value={value.end}
            min={value.start || c.min}
            max={c.max}
            disabled={disabled}
            onValueChange={(v) => onChange(setRangeEnd(value, "end", v))}
            className="w-full tabular-nums"
          />
        </div>
      </div>
      {days > 0 && (
        <p className="sr-only">{days === 1 ? "1 day" : `${days} days`}</p>
      )}
    </fieldset>
  )
}

type Held = { snapshot: string[]; id: string } | null

function PriorityRow({
  item,
  index,
  count,
  held,
  disabled,
  instructionsId,
  onKeyDown,
  onBlur,
  onDragStart,
  onDragEnd,
}: {
  item: { id: string; label: string }
  index: number
  count: number
  held: boolean
  disabled: boolean
  instructionsId: string
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  onBlur: (e: React.FocusEvent<HTMLButtonElement>) => void
  onDragStart: () => void
  onDragEnd: () => void
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      as="li"
      value={item.id}
      dragListener={false}
      dragControls={controls}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        "relative flex items-center gap-2 rounded-lg border border-border bg-transparent",
        held && "z-10 shadow-md dark:shadow-none ring-2 ring-ring",
      )}
    >
      <span
        aria-hidden
        className="w-8 shrink-0 pl-3.5 text-[13px] leading-4 tabular-nums text-muted-foreground"
      >
        {index + 1}
      </span>
      <button
        type="button"
        disabled={disabled}
        aria-roledescription="sortable item"
        aria-describedby={instructionsId}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPointerDown={(e) => {
          if (disabled) return
          // Touch drags start from the grip, so the rest of the row still scrolls.
          if (
            e.pointerType !== "mouse" &&
            !(e.target as HTMLElement).closest("[data-grip]")
          )
            return
          e.preventDefault()
          controls.start(e)
        }}
        className={cn(
          "flex min-h-11 flex-1 items-center justify-between gap-2 rounded-lg py-2 pr-2 text-left text-[13px] leading-5 disabled:opacity-60",
          !disabled && "cursor-grab active:cursor-grabbing",
          focusRing,
        )}
      >
        <span className="min-w-0 break-words">
          {item.label}
          <span className="sr-only">{`, ${index + 1} of ${count}`}</span>
        </span>
        <span
          data-grip=""
          aria-hidden
          className="flex size-7 shrink-0 touch-none items-center justify-center text-muted-foreground"
        >
          <GripVerticalIcon className="size-4" />
        </span>
      </button>
    </Reorder.Item>
  )
}

function PrioritiesField({
  control: c,
  value,
  disabled,
  onChange,
}: FieldProps<PrioritiesControl, string[]>) {
  const labelId = React.useId()
  const instructionsId = React.useId()
  const [held, setHeld] = React.useState<Held>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const dragFrom = React.useRef<number | null>(null)
  const last = React.useRef("")
  const valueRef = React.useRef(value)
  valueRef.current = value

  const labelOf = (id: string) => c.items.find((i) => i.id === id)?.label ?? id
  const announce = (text: string) => {
    // A repeated message gets a trailing space so screen readers read it again.
    const next = text === last.current ? `${text} ` : text
    last.current = next
    setAnnouncement(next)
  }
  const where = (order: string[], id: string) =>
    `position ${order.indexOf(id) + 1} of ${order.length}`

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    if (disabled) return
    const { key } = e
    if (!held) {
      if (key === " " || key === "Enter") {
        e.preventDefault()
        setHeld({ id, snapshot: value })
        announce(
          `Picked up ${labelOf(id)}, ${where(value, id)}. Use the up and down arrow keys to move, Space to drop, Escape to cancel.`,
        )
      }
      return
    }
    if (held.id !== id) return
    const from = value.indexOf(id)
    switch (key) {
      case "ArrowUp":
      case "ArrowDown": {
        e.preventDefault()
        const to = from + (key === "ArrowUp" ? -1 : 1)
        if (to < 0 || to >= value.length) {
          announce(`${labelOf(id)}, ${where(value, id)}.`)
          return
        }
        const next = moveItem(value, from, to)
        onChange(next)
        announce(`${labelOf(id)}, ${where(next, id)}.`)
        return
      }
      case " ":
      case "Enter":
        e.preventDefault()
        setHeld(null)
        announce(`Dropped ${labelOf(id)} at ${where(value, id)}.`)
        return
      case "Tab":
        setHeld(null)
        announce(`Dropped ${labelOf(id)} at ${where(value, id)}.`)
        return
      case "Escape":
        e.preventDefault()
        onChange(held.snapshot)
        setHeld(null)
        announce(
          `Move cancelled. ${labelOf(id)} is back at ${where(held.snapshot, id)}.`,
        )
        return
    }
  }

  const onBlur = (e: React.FocusEvent<HTMLButtonElement>, id: string) => {
    if (held?.id === id && e.relatedTarget) {
      setHeld(null)
      announce(`Dropped ${labelOf(id)} at ${where(value, id)}.`)
    }
  }

  const items = value
    .map((id) => c.items.find((i) => i.id === id))
    .filter((i): i is { id: string; label: string } => i !== undefined)

  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className={genuiType.label}>
        {c.label}
      </span>
      <p id={instructionsId} className="sr-only">
        Ordered most to least important. Press Space or Enter to pick up an
        item, the up and down arrow keys to move it, Space or Enter to drop it,
        or Escape to cancel.
      </p>
      <p className="sr-only" aria-live="assertive" aria-atomic="true">
        {announcement}
      </p>
      <Reorder.Group
        as="ol"
        axis="y"
        values={value}
        onReorder={(next: string[]) => {
          if (!disabled) onChange(next)
        }}
        aria-labelledby={labelId}
        className="flex flex-col gap-1.5"
      >
        {items.map((item, index) => (
          <PriorityRow
            key={item.id}
            item={item}
            index={index}
            count={items.length}
            held={held?.id === item.id}
            disabled={disabled}
            instructionsId={instructionsId}
            onKeyDown={(e) => onKeyDown(e, item.id)}
            onBlur={(e) => onBlur(e, item.id)}
            onDragStart={() => {
              dragFrom.current = valueRef.current.indexOf(item.id)
              announce(`Picked up ${item.label}.`)
            }}
            onDragEnd={() => {
              const order = valueRef.current
              const moved = dragFrom.current !== order.indexOf(item.id)
              dragFrom.current = null
              announce(
                moved
                  ? `Moved ${item.label} to ${where(order, item.id)}.`
                  : `${item.label} was not moved.`,
              )
            }}
          />
        ))}
      </Reorder.Group>
    </div>
  )
}

function ControlField({
  control: c,
  value,
  disabled,
  onChange,
}: {
  control: Control
  value: ControlValue
  disabled: boolean
  onChange: (value: ControlValue) => void
}) {
  switch (c.type) {
    case "slider":
      return (
        <SliderField
          control={c}
          value={value as number}
          disabled={disabled}
          onChange={onChange}
        />
      )
    case "segmented":
      return (
        <SegmentedField
          control={c}
          value={value as string}
          disabled={disabled}
          onChange={onChange}
        />
      )
    case "toggle":
      return (
        <ToggleField
          control={c}
          value={value as boolean}
          disabled={disabled}
          onChange={onChange}
        />
      )
    case "chips":
      return (
        <ChipsField
          control={c}
          value={value as string[]}
          disabled={disabled}
          onChange={onChange}
        />
      )
    case "date-range":
      return (
        <DateRangeField
          control={c}
          value={value as DateRange}
          disabled={disabled}
          onChange={onChange}
        />
      )
    case "priorities":
      return (
        <PrioritiesField
          control={c}
          value={value as string[]}
          disabled={disabled}
          onChange={onChange}
        />
      )
  }
}

// ---- Component ----

/** Coerces stored values (from `result`) onto the controls. */
function restoreValues(controls: Control[], base: Values, stored: Values) {
  const next = { ...base }
  for (const c of controls) {
    const v = coerceValue(c, stored[c.id])
    if (v !== undefined) next[c.id] = v
  }
  return next
}

export function PreferenceControls({
  title = "Adjust",
  appliesTo,
  controls = [],
  presets = [],
  live = false,
  status: statusProp,
  onResult,
  result,
  className,
}: PreferenceControlsProps) {
  const locale = useGenUILocale()
  const titleId = React.useId()
  const presetName = React.useId()
  const restored = result !== undefined

  // Controls that have arrived in full; the first of a duplicated id wins.
  const ready: Control[] = []
  for (const c of controls) {
    if (isControlReady(c) && !ready.some((r) => r.id === c.id)) ready.push(c)
  }
  const readyPresets = presets.filter(
    (p): p is Preset =>
      typeof p.id === "string" &&
      typeof p.label === "string" &&
      typeof p.values === "object" &&
      p.values !== null,
  )

  // The values the current answer was made with.
  const baseline = initialValues(ready)
  const baselineKey = JSON.stringify(baseline)

  const [edits, setEdits] = React.useState<Values>({})
  const [lastSent, setLastSent] = React.useState<Values | null>(null)
  const [pending, setPending] = React.useState(false)

  // New props (a regenerated answer) or the host finishing an update end the
  // "Sent · updating" state. Edits made since the last send are kept.
  const [seen, setSeen] = React.useState({
    key: baselineKey,
    status: statusProp,
  })
  if (seen.key !== baselineKey || seen.status !== statusProp) {
    const keyChanged = seen.key !== baselineKey
    const leftSubmitting =
      seen.status === "submitting" && statusProp !== "submitting"
    setSeen({ key: baselineKey, status: statusProp })
    if (keyChanged) {
      setEdits(rebaseEdits(ready, edits, baseline, lastSent))
      setLastSent(null)
      setPending(false)
    } else if (leftSubmitting) {
      setPending(false)
      // Without new props the update didn't land; let the user send again.
      // Live mode keeps it, so it doesn't resend the same values in a loop.
      if (!live) setLastSent(null)
    }
  }

  const current = restored
    ? result.action === "update"
      ? restoreValues(ready, baseline, result.values)
      : baseline
    : currentValues(ready, baseline, edits)
  const currentKey = JSON.stringify(current)

  // A host-provided "ready" (or nothing) yields to the user's local state.
  const decision: PreferenceControlsStatus | null =
    restored || pending ? "sent" : null
  const status: PreferenceControlsStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const disabled = streaming || restored

  const changed = diffValues(ready, baseline, current)
  const summary = summarizeChanges(ready, baseline, current, { locale })
  const kind = restored ? null : nextSend(ready, baseline, current, lastSent)
  const matched = matchPreset(ready, current, readyPresets)
  const noun = shortLabel(appliesTo)

  const setValue = (c: Control, v: ControlValue) =>
    setEdits((prev) => batchEdit(prev, c, v, baseline[c.id]))

  const selectPreset = (id: string) => {
    const p = readyPresets.find((x) => x.id === id)
    if (!p || disabled) return
    const next = applyPreset(ready, current, p)
    setEdits(
      Object.fromEntries(
        diffValues(ready, baseline, next).map((cid) => [cid, next[cid]]),
      ),
    )
  }

  const send = (action: "update" | "reset", values: Values) => {
    if (restored) return
    if (action === "update") {
      const ids = diffValues(ready, baseline, values)
      if (ids.length === 0) return
      setLastSent(values)
      setPending(true)
      onResult?.({ action: "update", values, changed: ids })
    } else {
      setLastSent(baseline)
      setPending(true)
      onResult?.({ action: "reset" })
    }
  }
  const sendRef = React.useRef(send)
  React.useLayoutEffect(() => {
    sendRef.current = send
  })

  // Live mode: send once the values have been still for a moment.
  React.useEffect(() => {
    if (!live || disabled || !kind) return
    const t = window.setTimeout(
      () => sendRef.current(kind, JSON.parse(currentKey) as Values),
      LIVE_DELAY_MS,
    )
    return () => window.clearTimeout(t)
  }, [live, disabled, kind, currentKey])

  const reset = () => {
    setEdits({})
    // Undo an update already sent; otherwise discarding the edits is enough.
    if (lastSent && !valuesEqual(ready, lastSent, baseline)) {
      send("reset", baseline)
    }
  }
  const canReset =
    !disabled &&
    (changed.length > 0 ||
      (lastSent !== null && !valuesEqual(ready, lastSent, baseline)))

  const showPresets = readyPresets.length > 0 && ready.length > 0
  const placeholders = streaming ? (ready.length === 0 ? 2 : 1) : 0

  const note = streaming ? (
    <ShimmeringText
      text="Loading controls…"
      color="var(--muted-foreground)"
      shimmeringColor="var(--foreground)"
    />
  ) : restored ? (
    <span className="flex items-center gap-1.5 text-foreground">
      <CheckIcon aria-hidden className="size-4 shrink-0" />
      {result.action === "reset" ? "Reset to original" : "Sent"}
    </span>
  ) : status === "submitting" || (live && status === "sent") ? (
    <ShimmeringText
      text="Updating…"
      color="var(--muted-foreground)"
      shimmeringColor="var(--foreground)"
    />
  ) : status === "sent" ? (
    <span className="flex items-center gap-1.5 text-foreground">
      <CheckIcon aria-hidden className="size-4 shrink-0" />
      Sent · updating
    </span>
  ) : live && !summary ? (
    "Updates as you go"
  ) : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="preference-controls"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
          {appliesTo && (
            <p className="sr-only">Changes apply to {appliesTo}.</p>
          )}
        </SurfaceHeader>

        {showPresets && (
          <fieldset
            data-slot="preference-controls-presets"
            className="min-w-0 border-t border-border px-3 py-3"
          >
            <legend className="sr-only">
              {`Presets${matched ? "" : " (current values are custom)"}`}
            </legend>
            <Segments
              name={presetName}
              options={readyPresets.map((p) => ({
                value: p.id,
                label: p.label,
              }))}
              value={matched?.id ?? null}
              disabled={disabled}
              onChange={selectPreset}
              trailing={
                <span
                  aria-hidden
                  className={cn(
                    "flex min-h-8 flex-1 items-center justify-center rounded-full px-3.5 text-[13px] leading-5 whitespace-nowrap transition-colors",
                    matched
                      ? "text-muted-foreground/60"
                      : "bg-accent text-foreground",
                  )}
                >
                  Custom
                </span>
              }
            />
          </fieldset>
        )}

        <div className="@container">
          <div className="grid overflow-hidden @md:grid-cols-2">
            {ready.map((c) => (
              <motion.div
                key={c.id}
                data-slot="preference-controls-control"
                data-type={c.type}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className={cn(
                  "min-w-0 border-t border-border px-3 py-3 @md:-ml-px @md:border-l",
                  c.type === "chips" &&
                    "@md:[&:nth-child(odd):last-child]:col-span-2",
                )}
              >
                <ControlField
                  control={c}
                  value={current[c.id]}
                  disabled={disabled}
                  onChange={(v) => setValue(c, v)}
                />
              </motion.div>
            ))}
            {Array.from({ length: placeholders }, (_, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                key={i}
                aria-hidden
                className="flex flex-col gap-2 border-t border-border px-3 py-3 @md:-ml-px @md:border-l"
              >
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-10 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>

        <SurfaceFooter className="flex-nowrap justify-between">
          <div className={cn(genuiType.meta, "min-w-0")}>
            <p aria-live="polite">{note}</p>
            {/* What differs from the values the agent sent. Not live: it
                changes on every slider tick. */}
            {!note && summary && (
              <p data-slot="preference-controls-changes">{summary}</p>
            )}
          </div>
          {!restored && (
            <div className="ml-auto flex shrink-0 gap-2">
              <WhyDisabled reason={!canReset && "Nothing to reset"}>
                <Button
                  size="sm"
                  variant={live ? "default" : "secondary"}
                  disabled={!canReset}
                  onClick={reset}
                >
                  <RotateCcwIcon aria-hidden />
                  Reset
                </Button>
              </WhyDisabled>
              {!live && (
                <WhyDisabled reason={!disabled && kind !== "update" && "No changes to send"}>
                  <Button
                    size="sm"
                    disabled={disabled || kind !== "update"}
                    onClick={() => send("update", current)}
                  >
                    Update {noun}
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
