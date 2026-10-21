"use client"

import * as React from "react"
import {
  BellIcon,
  BookIcon,
  BriefcaseIcon,
  CheckIcon,
  CoffeeIcon,
  DumbbellIcon,
  FilmIcon,
  GlobeIcon,
  GripVerticalIcon,
  HeartIcon,
  HomeIcon,
  LeafIcon,
  type LucideIcon,
  MoonIcon,
  MusicIcon,
  NewspaperIcon,
  PlaneIcon,
  PlusIcon,
  ShoppingBagIcon,
  SparklesIcon,
  SunIcon,
  UtensilsIcon,
} from "lucide-react"
import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import {
  AnimatePresence,
  MotionConfig,
  Reorder,
  motion,
  useDragControls,
} from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DatePicker } from "@/components/genui/date-picker"
import {
  FormField,
  FormFieldGroup,
  formDateClass,
  formExampleClass,
  formInputClass,
  formUnlabeledClass,
} from "@/components/genui/form-field"
import { Switch } from "@/components/animate-ui/components/base/switch"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { CheckMark } from "@/components/genui/genui-motion"
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
  addCustomChip,
  buildAnswers,
  type CardsInput,
  type ChipsInput,
  canSkip,
  chipList,
  clamp,
  type DraftValue,
  type Drafts,
  firstBlocking,
  formatScale,
  isRange,
  isSafeImageSrc,
  maxPicks,
  moveItem,
  type NavEvent,
  type NavState,
  navigate,
  picksHint,
  pluralize,
  type RankInput,
  readySteps,
  reviewRows,
  type Schedule,
  type ScaleInput,
  type ScheduleInput,
  type SegmentState,
  segmentStates,
  snapToStep,
  type TextInput,
  type TogglesInput,
  toAnswer,
  togglePick,
  validateStep,
  stepValue,
  WEEKDAYS,
  type WizardStep,
} from "./preferences-wizard-utils"
import type {
  PreferencesWizardAnswer,
  PreferencesWizardInput,
  PreferencesWizardProgress,
  PreferencesWizardResult,
  WizardIcon,
  WizardInput,
} from "./preferences-wizard.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type PreferencesWizardStatus =
  "streaming" | "ready" | "saved" | "dismissed"

/** A step as it may arrive while the tool call streams. */
type PartialStep = {
  id?: string
  title?: string
  description?: string
  required?: boolean
  input?: Partial<WizardInput> | { type?: string; [key: string]: unknown }
}

export type PreferencesWizardProps = Partial<
  Omit<PreferencesWizardInput, "steps">
> & {
  /** Steps may be partial while the tool call streams. */
  steps?: PartialStep[]
  /**
   * Lifecycle, controlled by the host. While 'streaming', the user can answer
   * the steps that have arrived, but can't move past the last one or save.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: PreferencesWizardStatus
  /** Called once, on "Save preferences" or "Not now". Send it to the agent. */
  onResult?: (result: PreferencesWizardResult) => void
  /**
   * Called on every change, so the host can save a half-done wizard (it isn't
   * sent to the agent). Pass it back as `progress` to resume.
   */
  onProgress?: (progress: PreferencesWizardProgress) => void
  /** Saved progress (from `onProgress`). The wizard resumes where it was. */
  progress?: PreferencesWizardProgress
  /** A result from history. Renders the read-only record; never calls onResult. */
  result?: PreferencesWizardResult
  className?: string
}

const icons: Record<WizardIcon, LucideIcon> = {
  newspaper: NewspaperIcon,
  utensils: UtensilsIcon,
  plane: PlaneIcon,
  music: MusicIcon,
  film: FilmIcon,
  book: BookIcon,
  dumbbell: DumbbellIcon,
  leaf: LeafIcon,
  briefcase: BriefcaseIcon,
  heart: HeartIcon,
  globe: GlobeIcon,
  sparkles: SparklesIcon,
  bell: BellIcon,
  moon: MoonIcon,
  sun: SunIcon,
  coffee: CoffeeIcon,
  "shopping-bag": ShoppingBagIcon,
  home: HomeIcon,
}

const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-background"

const chipClass = (on: boolean) =>
  cn(
    "inline-flex min-h-8 items-center gap-1 rounded-full px-3.5 text-[13px] leading-5 transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    focusRing,
    "border border-border bg-transparent",
    on ? "bg-accent ring-2 ring-choice ring-inset" : "hover:bg-accent",
  )

type FieldProps<I, V> = {
  step: WizardStep & { input: I }
  value: V
  /** Id of the step title, for labelling groups. */
  labelId: string
  /** The step's options may still be arriving. */
  loading: boolean
  onChange: (value: V) => void
}

// ---- Fields ----------------------------------------------------------------

function CardsField({
  step,
  value,
  labelId,
  loading,
  onChange,
}: FieldProps<CardsInput, string[]>) {
  const multi = step.input.multiple === true
  const full = multi && value.length >= maxPicks(step)
  return (
    <div
      {...{ role: multi ? "group" : "radiogroup", "aria-labelledby": labelId }}
      className="@container"
    >
      <div className="grid grid-cols-2 gap-2 @md:grid-cols-3">
        {step.input.options.map((o) => {
          const checked = value.includes(o.id)
          const Icon = o.icon ? icons[o.icon as WizardIcon] : undefined
          const image =
            o.image && isSafeImageSrc(o.image.src) ? o.image : undefined
          const ariaProps = multi
            ? { "aria-pressed": checked }
            : { role: "radio", "aria-checked": checked }
          return (
            <motion.button
              key={o.id}
              type="button"
              {...ariaProps}
              disabled={full && !checked}
              onClick={() => onChange(togglePick(step, value, o.id))}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className={cn(
                "group/card relative flex min-h-16 flex-col items-start gap-2.5 rounded-[10px] border border-border bg-transparent text-left transition-colors",
                image ? "overflow-hidden p-0" : "p-3",
                "hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-muted",
                focusRing,
                checked && "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
              )}
            >
              {image ? (
                // A photo card: the picture fills it and the label sits on it.
                <span className="relative block w-full">
                  {/* biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured */}
                  <img
                    src={image.src}
                    alt={image.alt}
                    loading="lazy"
                    className="aspect-[4/3] w-full bg-muted object-cover transition-transform duration-300 group-hover/card:scale-[1.03]"
                  />
                  <span className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 bg-linear-to-t from-black/75 via-black/40 to-transparent px-3 pt-8 pb-2.5 text-white">
                    <span className="text-[14px] font-medium break-words">
                      {o.label}
                    </span>
                    {o.description && (
                      <span className="text-[13px] text-white/75">
                        {o.description}
                      </span>
                    )}
                  </span>
                  {/* The picked ring, drawn over the photo. */}
                  {checked && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-0 rounded-[10px] ring-2 ring-choice ring-inset"
                    />
                  )}
                </span>
              ) : (
                <>
                  {Icon && (
                    <Icon
                      aria-hidden
                      className={cn(
                        "size-6 transition-colors",
                        checked ? "text-choice" : "text-muted-foreground",
                      )}
                    />
                  )}
                  <span className="flex min-w-0 flex-col gap-0.5 pr-5">
                    <span
                      className={cn(genuiType.body, "font-medium break-words")}
                    >
                      {o.label}
                    </span>
                    {o.description && (
                      <span className={genuiType.meta}>{o.description}</span>
                    )}
                  </span>
                </>
              )}
              <span
                aria-hidden
                className={cn(
                  // The mark appears only once picked; the ring says the rest.
                  "absolute top-3 right-3 flex size-5 items-center justify-center rounded-full transition-opacity",
                  checked
                    ? "bg-choice text-background opacity-100"
                    : "opacity-0",
                  image && "top-2.5 right-2.5 shadow-sm dark:shadow-none",
                )}
              >
                <AnimatePresence initial={false}>
                  {checked && (
                    <motion.span
                      key="check"
                      initial={{ scale: 0.9, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.9, opacity: 0 }}
                      transition={genuiMotion.snappy}
                      className="flex"
                    >
                      <CheckMark className="size-3.5" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </span>
            </motion.button>
          )
        })}
        {loading && <Skeleton className="h-16 rounded-[10px]" />}
      </div>
    </div>
  )
}

function ChipsField({
  step,
  value,
  labelId,
  loading,
  onChange,
}: FieldProps<ChipsInput, string[]>) {
  const [draft, setDraft] = React.useState("")
  const inputId = React.useId()
  const full = value.length >= maxPicks(step)
  const add = () => {
    if (full) return
    const next = addCustomChip(step, value, draft)
    if (next !== value) onChange(next)
    // Clears also when the text matched a chip that was already on.
    setDraft("")
  }
  return (
    <div className="flex flex-col gap-3">
      {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset */}
      <div
        role="group"
        aria-labelledby={labelId}
        className="flex flex-wrap gap-2"
      >
        {chipList(step.input, value).map((o) => {
          const on = value.includes(o)
          return (
            <motion.button
              key={o}
              type="button"
              aria-pressed={on}
              disabled={full && !on}
              onClick={() => onChange(togglePick(step, value, o))}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={genuiMotion.fade}
              className={chipClass(on)}
            >
              {on && <CheckMark className="-ml-0.5" />}
              {o}
            </motion.button>
          )
        })}
        {loading && <Skeleton className="h-8 w-20 rounded-full" />}
      </div>
      {step.input.allowCustom && (
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            {`Add your own (${step.title})`}
          </label>
          <Input
            id={inputId}
            value={draft}
            maxLength={40}
            placeholder="Add your own"
            disabled={full}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                // Adds the chip instead of moving to the next step.
                e.preventDefault()
                e.stopPropagation()
                add()
              }
            }}
            className="max-w-60"
          />
          <WhyDisabled
            when={!full && !draft.trim()}
            reason="Type something to add"
          >
            <Button
              size="sm"
              variant="secondary"
              disabled={full || !draft.trim()}
              onClick={add}
            >
              <PlusIcon aria-hidden />
              Add
            </Button>
          </WhyDisabled>
        </div>
      )}
    </div>
  )
}

/**
 * A formatted value ("$40", "30%", "3 days") whose digits roll when it
 * changes. Values are formatted in en-US (see utils); words show as is.
 */
function RollingFigure({ text }: { text: string }) {
  const first = text.search(/\d/)
  let last = -1
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\d/.test(text[i])) {
      last = i
      break
    }
  }
  const body = first >= 0 ? text.slice(first, last + 1) : ""
  const point = body.lastIndexOf(".")
  const number = Number(body.replaceAll(",", ""))
  if (!body || !Number.isFinite(number)) return <>{text}</>
  return (
    <span className="inline-flex items-baseline">
      {text.slice(0, first)}
      <SlidingNumber
        number={number}
        decimalPlaces={point >= 0 ? body.length - point - 1 : 0}
        thousandSeparator={body.includes(",") ? "," : undefined}
        initiallyStable
      />
      {text.slice(last + 1)}
    </span>
  )
}

function ScaleField({ step, value, onChange }: FieldProps<ScaleInput, number>) {
  const locale = useGenUILocale()
  const { input } = step
  const text = formatScale(input, value, locale)
  return (
    <div className="flex flex-col gap-2">
      {/* The slider with its live value on the right (Halaska UI layout). */}
      <div className="flex items-center gap-3">
        <SliderPrimitive.Root
          value={[value]}
          min={input.min}
          max={input.max}
          step={input.step}
          onValueChange={(v) =>
            onChange(snapToStep(input, Array.isArray(v) ? v[0] : v))
          }
          thumbAlignment="edge"
          className="min-w-0 flex-1"
        >
          <SliderPrimitive.Control className="relative flex w-full touch-none items-center py-1.5 select-none">
            <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted dark:bg-white/15">
              <SliderPrimitive.Indicator className="h-full bg-choice" />
            </SliderPrimitive.Track>
            <SliderPrimitive.Thumb
              getAriaLabel={() =>
                `${step.title}: ${input.minLabel} to ${input.maxLabel}`
              }
              getAriaValueText={() => text}
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
      <div
        aria-hidden
        className={cn(genuiType.meta, "mt-1 flex justify-between gap-3")}
      >
        <span>{input.minLabel}</span>
        <span className="text-right">{input.maxLabel}</span>
      </div>
    </div>
  )
}

type Held = { snapshot: string[]; id: string } | null

function RankRow({
  item,
  index,
  count,
  held,
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
        "relative flex items-center gap-2 rounded-lg border border-border bg-background",
        held && "z-10 shadow-md dark:shadow-none ring-2 ring-ring",
      )}
    >
      <span
        aria-hidden
        className={cn(genuiType.label, "w-7 shrink-0 pl-3 tabular-nums")}
      >
        {index + 1}
      </span>
      <button
        type="button"
        aria-roledescription="sortable item"
        aria-describedby={instructionsId}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        onPointerDown={(e) => {
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
          "flex min-h-11 flex-1 cursor-grab items-center justify-between gap-2 rounded-lg py-2 pr-2 text-left text-[13px] leading-5 active:cursor-grabbing",
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

function RankField({
  step,
  value,
  labelId,
  onChange,
}: FieldProps<RankInput, string[]>) {
  const instructionsId = React.useId()
  const [held, setHeld] = React.useState<Held>(null)
  const [announcement, setAnnouncement] = React.useState("")
  const dragFrom = React.useRef<number | null>(null)
  const last = React.useRef("")
  const valueRef = React.useRef(value)
  valueRef.current = value

  const labelOf = (id: string) =>
    step.input.items.find((i) => i.id === id)?.label ?? id
  const announce = (text: string) => {
    // A repeated message gets a trailing space so screen readers read it again.
    const next = text === last.current ? `${text} ` : text
    last.current = next
    setAnnouncement(next)
  }
  const where = (order: string[], id: string) =>
    `position ${order.indexOf(id) + 1} of ${order.length}`

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: string) => {
    const { key } = e
    if (!held) {
      if (key === " " || key === "Enter") {
        // Enter picks up here; it must not reach the step's "Enter = Next".
        e.preventDefault()
        e.stopPropagation()
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
        e.stopPropagation()
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
    .map((id) => step.input.items.find((i) => i.id === id))
    .filter((i): i is { id: string; label: string } => i !== undefined)

  return (
    <div className="flex flex-col gap-2">
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
        onReorder={(next: string[]) => onChange(next)}
        aria-labelledby={labelId}
        className="flex flex-col gap-2"
      >
        {items.map((item, index) => (
          <RankRow
            key={item.id}
            item={item}
            index={index}
            count={items.length}
            held={held?.id === item.id}
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

function TogglesField({
  step,
  value,
  loading,
  onChange,
}: FieldProps<TogglesInput, Record<string, boolean>>) {
  const baseId = React.useId()
  return (
    <ul className="flex flex-col gap-1">
      {step.input.items.map((item) => {
        const id = `${baseId}-${item.id}`
        return (
          <motion.li
            key={item.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={genuiMotion.fade}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="flex min-w-0 flex-col">
              <label
                id={`${id}-label`}
                htmlFor={id}
                className={cn(genuiType.body, "font-medium")}
              >
                {item.label}
              </label>
              {/* Help is read with the switch, not shown. */}
              {item.description && (
                <p id={`${id}-help`} className="sr-only">
                  {item.description}
                </p>
              )}
            </div>
            <Switch
              nativeButton
              id={id}
              aria-labelledby={`${id}-label`}
              aria-describedby={item.description ? `${id}-help` : undefined}
              checked={value[item.id] === true}
              onCheckedChange={(on: boolean) =>
                onChange({ ...value, [item.id]: Boolean(on) })
              }
              className="relative after:absolute after:-inset-1.5"
            />
          </motion.li>
        )
      })}
      {loading && (
        <li aria-hidden className="flex justify-between gap-3 py-2.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-10 rounded-full" />
        </li>
      )}
    </ul>
  )
}

function ScheduleField({
  step,
  value,
  onChange,
}: FieldProps<ScheduleInput, Schedule>) {
  const id = React.useId()
  const range = isRange(step.input)
  const toggleDay = (day: number) =>
    onChange({
      ...value,
      days: value.days.includes(day)
        ? value.days.filter((d) => d !== day)
        : [...value.days, day],
    })
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <span id={`${id}-days`} className={genuiType.label}>
          Days
        </span>
        {/* biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not a form fieldset */}
        <div
          role="group"
          aria-label={`Days (${step.title})`}
          className="flex flex-wrap gap-2"
        >
          {WEEKDAYS.map((w) => {
            const on = value.days.includes(w.day)
            return (
              <button
                key={w.day}
                type="button"
                aria-pressed={on}
                aria-label={w.long}
                onClick={() => toggleDay(w.day)}
                className={cn(chipClass(on), "min-w-12 justify-center px-3")}
              >
                {w.short}
              </button>
            )
          })}
        </div>
      </div>
      {/* The times are form fields: one per row. */}
      <FormFieldGroup>
        <FormField
          htmlFor={`${id}-from`}
          label={
            <>
              {range ? "From" : "At"}
              <span className="sr-only">{` (${step.title})`}</span>
            </>
          }
          pinned
        >
          <DatePicker
            id={`${id}-from`}
            type="time"
            value={value.from}
            onValueChange={(v) => onChange({ ...value, from: v })}
            className={cn(formDateClass, "tabular-nums")}
          />
        </FormField>
        {range && (
          <FormField
            htmlFor={`${id}-to`}
            label={
              <>
                To<span className="sr-only">{` (${step.title})`}</span>
              </>
            }
            pinned
          >
            <DatePicker
              id={`${id}-to`}
              type="time"
              value={value.to ?? ""}
              onValueChange={(v) => onChange({ ...value, to: v })}
              className={cn(formDateClass, "tabular-nums")}
            />
          </FormField>
        )}
      </FormFieldGroup>
    </div>
  )
}

function TextField({
  step,
  value,
  labelId,
  onChange,
}: FieldProps<TextInput, string>) {
  const max = step.input.maxLength
  const id = React.useId()
  return (
    // The step title above names the field (aria-labelledby): no box label.
    <FormField>
      <Input
        id={id}
        aria-labelledby={labelId}
        aria-required={step.required || undefined}
        value={value}
        maxLength={max}
        placeholder={step.input.placeholder ?? "Type your answer"}
        onChange={(e) => onChange(e.target.value)}
        className={cn(formInputClass, formExampleClass, formUnlabeledClass)}
      />
    </FormField>
  )
}

function StepField(props: FieldProps<WizardStep["input"], DraftValue>) {
  const { step, value, onChange } = props
  const common = {
    labelId: props.labelId,
    loading: props.loading,
  }
  switch (step.input.type) {
    case "cards":
      return (
        <CardsField
          {...common}
          step={step as WizardStep & { input: CardsInput }}
          value={value as string[]}
          onChange={onChange}
        />
      )
    case "chips":
      return (
        <ChipsField
          {...common}
          step={step as WizardStep & { input: ChipsInput }}
          value={value as string[]}
          onChange={onChange}
        />
      )
    case "scale":
      return (
        <ScaleField
          {...common}
          step={step as WizardStep & { input: ScaleInput }}
          value={value as number}
          onChange={onChange}
        />
      )
    case "rank":
      return (
        <RankField
          {...common}
          step={step as WizardStep & { input: RankInput }}
          value={value as string[]}
          onChange={onChange}
        />
      )
    case "toggles":
      return (
        <TogglesField
          {...common}
          step={step as WizardStep & { input: TogglesInput }}
          value={value as Record<string, boolean>}
          onChange={onChange}
        />
      )
    case "schedule":
      return (
        <ScheduleField
          {...common}
          step={step as WizardStep & { input: ScheduleInput }}
          value={value as Schedule}
          onChange={onChange}
        />
      )
    case "text":
      return (
        <TextField
          {...common}
          step={step as WizardStep & { input: TextInput }}
          value={value as string}
          onChange={onChange}
        />
      )
  }
}

// ---- Progress bar ----------------------------------------------------------

const segmentText: Record<SegmentState, string> = {
  done: "done",
  skipped: "Skipped",
  current: "current step",
  todo: "not started",
}

function Segments({
  steps,
  states,
}: {
  steps: WizardStep[]
  states: SegmentState[]
}) {
  return (
    <ol aria-label="Steps" className="flex gap-1">
      {steps.map((s, i) => (
        <li
          key={s.id}
          className={cn(
            "h-1.5 flex-1 rounded-full transition-colors",
            states[i] === "done" && "bg-choice/40",
            states[i] === "current" && "bg-choice",
            states[i] === "todo" && "bg-muted dark:bg-white/15",
            // Hollow: skipped steps keep their defaults.
            states[i] === "skipped" &&
              "border border-muted-foreground/50 bg-transparent",
          )}
        >
          <span className="sr-only">{`${s.title}: ${segmentText[states[i]]}`}</span>
        </li>
      ))}
    </ol>
  )
}

// ---- Component -------------------------------------------------------------

type WizardState = { nav: NavState; drafts: Drafts; furthest: number }

function initialState(
  progress: PreferencesWizardProgress | undefined,
  result: PreferencesWizardResult | undefined,
): WizardState {
  if (result?.action === "save") {
    return {
      nav: { stepIndex: 0, skipped: result.skipped, returnToReview: false },
      drafts: result.answers,
      furthest: 0,
    }
  }
  const stepIndex = Math.max(0, Math.floor(progress?.stepIndex ?? 0))
  return {
    nav: {
      stepIndex,
      skipped: progress?.skipped ?? [],
      returnToReview: false,
    },
    drafts: progress?.answers ?? {},
    furthest: stepIndex,
  }
}

export function PreferencesWizard({
  icon,
  title,
  intro,
  steps = [],
  allowSkip = true,
  savedTo,
  status: statusProp,
  onResult,
  onProgress,
  progress,
  result,
  className,
}: PreferencesWizardProps) {
  const locale = useGenUILocale()
  const [state, setState] = React.useState<WizardState>(() =>
    initialState(progress, result),
  )
  const stateRef = React.useRef(state)
  // 1 = forward, -1 = back; drives the slide direction between steps.
  const [direction, setDirection] = React.useState(1)
  const [decision, setDecision] = React.useState<"saved" | "dismissed" | null>(
    () => (result ? (result.action === "save" ? "saved" : "dismissed") : null),
  )
  const baseId = React.useId()
  const headingRef = React.useRef<HTMLHeadingElement>(null)
  const moved = React.useRef(false)

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: PreferencesWizardStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const done = status === "saved" || status === "dismissed"

  const ready = readySteps(steps)
  const total = ready.length
  const { nav, drafts, furthest } = state
  const skipped = nav.skipped.filter((id) =>
    ready.some((s) => s.id === id && !s.required),
  )
  // While streaming, the review isn't reachable yet.
  const at = clamp(nav.stepIndex, 0, streaming ? Math.max(total - 1, 0) : total)
  const reviewing = !streaming && total > 0 && at === total
  const current = reviewing ? undefined : ready[at]
  // The step's options are complete once a later step has started arriving.
  const rawIndex = current ? steps.findIndex((s) => s.id === current.id) : -1
  const complete = !!current && (!streaming || steps.length > rawIndex + 1)
  const value = current ? stepValue(current, drafts) : undefined
  const validity =
    current && value !== undefined ? validateStep(current, value) : null
  const valid = validity?.valid === true
  const isLast = !streaming && at === total - 1
  const returning = nav.returnToReview

  // Move focus to the step heading after navigating, so the step is announced.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on step change only
  React.useEffect(() => {
    if (moved.current) headingRef.current?.focus()
  }, [at, reviewing])

  const commit = (next: WizardState) => {
    stateRef.current = next
    setState(next)
    if (!onProgress) return
    const answers: Record<string, PreferencesWizardAnswer> = {}
    for (const s of ready) {
      if (s.id in next.drafts)
        answers[s.id] = toAnswer(s, stepValue(s, next.drafts))
    }
    onProgress({
      stepIndex: next.nav.stepIndex,
      answers,
      skipped: next.nav.skipped,
    })
  }

  const setValue = (v: DraftValue) => {
    if (!current) return
    const prev = stateRef.current
    commit({ ...prev, drafts: { ...prev.drafts, [current.id]: v } })
  }

  const go = (event: NavEvent, dir: number, drafts?: Drafts) => {
    const prev = stateRef.current
    const nextNav = navigate(
      { ...prev.nav, stepIndex: at },
      event,
      ready,
      allowSkip,
    )
    moved.current = true
    setDirection(dir)
    commit({
      nav: nextNav,
      drafts: drafts ?? prev.drafts,
      furthest: Math.max(prev.furthest, nextNav.stepIndex),
    })
  }

  const next = () => {
    if (!current || !valid || !complete) return
    if (!isLast && !returning && at >= total - 1) return
    go({ type: "next" }, 1)
  }

  const skip = () => {
    if (!current || !complete || !canSkip(current, allowSkip)) return
    if (!isLast && !returning && at >= total - 1) return
    // A skipped step keeps its default, so drop any draft.
    const { [current.id]: _dropped, ...rest } = stateRef.current.drafts
    go({ type: "skip" }, 1, rest)
  }

  const back = () => go({ type: "back" }, -1)
  const edit = (index: number) => go({ type: "edit", index }, -1)

  const rows = reviewRows(ready, drafts, skipped, locale)
  const blocking = firstBlocking(rows)
  const answeredCount = total - skipped.length

  const save = () => {
    if (streaming || blocking) return
    setDecision("saved")
    onResult?.({
      action: "save",
      answers: buildAnswers(ready, drafts, skipped),
      skipped,
    })
  }

  const dismiss = () => {
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }

  const savedLine = `Saved ${pluralize(answeredCount, "preference")}${savedTo ? ` to ${savedTo}` : ""}.`

  // First child in both layouts, so React keeps the same live region node
  // and the outcome is announced when the wizard finishes.
  const announcer = (
    <p aria-live="polite" className="sr-only">
      {status === "saved"
        ? savedLine
        : status === "dismissed"
          ? "Not now. Nothing was saved."
          : ""}
    </p>
  )

  // Finished: a compact, read-only record for the chat history.
  if (done) {
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="preferences-wizard"
          data-status={status}
          aria-label={title ?? "Preferences"}
          className={className}
        >
          {announcer}
          <SurfaceHeader
            className={cn(
              "flex-row items-start justify-between gap-3",
              status === "dismissed" && "pb-3",
            )}
          >
            <SurfaceTitle>{title}</SurfaceTitle>
            <span
              aria-hidden
              className={cn(
                genuiType.meta,
                "flex shrink-0 items-center gap-1 pt-0.5",
              )}
            >
              {status === "saved" ? (
                <>
                  <CheckIcon className="size-3.5" />
                  {savedTo ? `Saved to ${savedTo}` : "Saved"}
                </>
              ) : (
                "Not now"
              )}
            </span>
          </SurfaceHeader>
          {status === "saved" && (
            <motion.dl
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-3 border-t border-border px-3 py-3"
            >
              {rows.map((r) => (
                <div key={r.id} className="flex flex-col gap-0.5">
                  <dt className={genuiType.label}>{r.title}</dt>
                  <dd
                    className={cn(
                      genuiType.body,
                      "font-medium break-words",
                      r.skipped && "font-normal text-muted-foreground",
                    )}
                  >
                    {r.summary}
                  </dd>
                </div>
              ))}
            </motion.dl>
          )}
        </Surface>
      </MotionConfig>
    )
  }

  const titleId = `${baseId}-title`
  const stepTitleId = `${baseId}-step`
  const HeaderIcon = icon ? icons[icon] : SparklesIcon
  const states = segmentStates(
    ready,
    reviewing ? -1 : at,
    skipped,
    reviewing ? total : furthest,
  )
  const hint = current ? picksHint(current) : ""
  const picked =
    current &&
    (current.input.type === "chips" ||
      (current.input.type === "cards" && current.input.multiple)) &&
    Array.isArray(value)
      ? value.length
      : null
  const showError =
    validity && !validity.valid && current?.input.type === "schedule"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="preferences-wizard"
        data-status={status}
        aria-busy={streaming}
        // The title is a skeleton (no id) until it streams in.
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Preferences"}
        className={className}
      >
        {announcer}
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          {/* The title and intro restate the request: read, not shown. */}
          {title && (
            <h3 id={titleId} className="sr-only">
              {title}
            </h3>
          )}
          {intro && <p className="sr-only">{intro}</p>}
          <span
            aria-hidden
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400"
          >
            <HeaderIcon className="size-5" />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p aria-hidden className={cn(genuiType.meta, "tabular-nums")}>
              {reviewing
                ? "Last step"
                : total > 0
                  ? `Step ${at + 1} of ${streaming ? `${total}…` : total}`
                  : " "}
            </p>
            <h4
              ref={headingRef}
              tabIndex={-1}
              className="flex flex-wrap items-center gap-x-2 text-[16px] leading-6 font-semibold outline-none"
            >
              {reviewing ? (
                <>
                  Review
                  <span className="sr-only">
                    {savedTo
                      ? ` your preferences. They'll be saved to ${savedTo}.`
                      : " your preferences."}
                  </span>
                </>
              ) : current ? (
                <>
                  <span className="sr-only">
                    Step {at + 1} of {streaming ? `${total}…` : total}:{" "}
                  </span>
                  <span id={stepTitleId}>{current.title}</span>
                  {current.required && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[12px] leading-4 font-medium text-muted-foreground dark:bg-white/10">
                      Required
                    </span>
                  )}
                </>
              ) : (
                <Skeleton className="h-5 w-32" />
              )}
            </h4>
          </div>
        </SurfaceHeader>
        <div className="px-3 pb-3">
          {total > 0 ? (
            <Segments steps={ready} states={states} />
          ) : (
            <Skeleton className="h-1.5 w-full" />
          )}
        </div>

        {/* Height follows the step; steps slide in their direction. */}
        <AutoHeight>
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            {reviewing ? (
              <motion.div
                key="pw-review"
                custom={direction}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex flex-col"
              >
                <dl className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  {rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-3">
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <dt className={genuiType.label}>{r.title}</dt>
                        <dd
                          className={cn(
                            genuiType.body,
                            "font-medium break-words",
                            r.skipped && "font-normal text-muted-foreground",
                            r.invalid && "text-destructive",
                          )}
                        >
                          {r.invalid ? "Needs an answer" : r.summary}
                        </dd>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        aria-label={`Edit ${r.title}`}
                        onClick={() => edit(r.index)}
                        className="-mr-2 shrink-0"
                      >
                        Edit
                      </Button>
                    </div>
                  ))}
                </dl>
                {blocking && (
                  <p
                    className={cn(
                      genuiType.body,
                      "border-t border-border px-3 py-3 text-destructive",
                    )}
                  >
                    Answer “{blocking.title}” before saving.
                  </p>
                )}
              </motion.div>
            ) : current && value !== undefined ? (
              <motion.div
                key={`pw-step-${current.id}`}
                custom={direction}
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.18, ease: "easeOut" }}
                onKeyDown={(e: React.KeyboardEvent) => {
                  // Enter in a single-line input continues, like a form.
                  if (
                    e.key === "Enter" &&
                    e.target instanceof HTMLInputElement &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault()
                    next()
                  }
                }}
                className="flex flex-col"
              >
                <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                  {current.description && (
                    <p className={genuiType.meta}>{current.description}</p>
                  )}
                  <StepField
                    step={current}
                    value={value}
                    labelId={stepTitleId}
                    loading={!complete}
                    onChange={setValue}
                  />
                  {/* Errors stay by the field; the pick count is in the footer. */}
                  {showError && (
                    <p
                      aria-live="polite"
                      className={cn(
                        genuiType.meta,
                        "tabular-nums",
                        showError && "text-destructive",
                      )}
                    >
                      {!validity.valid ? validity.message : null}
                    </p>
                  )}
                </div>
              </motion.div>
            ) : (
              <div
                key="pw-loading"
                className="flex flex-col gap-3 border-t border-border px-3 py-3"
              >
                <ShimmeringText
                  text="Preparing the steps…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                  className={genuiType.body}
                />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-16 rounded-[10px]" />
                  <Skeleton className="h-16 rounded-[10px]" />
                </div>
              </div>
            )}
          </AnimatePresence>
        </AutoHeight>

        <SurfaceFooter className="flex-wrap gap-x-3 gap-y-2">
          <p
            aria-live="polite"
            className={cn(genuiType.meta, "min-w-0 flex-1 tabular-nums")}
          >
            {!reviewing && hint && !showError
              ? [picked !== null ? `${picked} selected` : "", hint]
                  .filter(Boolean)
                  .join(" · ")
              : null}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={dismiss}
            className="text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-white/10"
          >
            Not now
          </Button>
          {/* No Back on the first step: there's nowhere to go. */}
          {at > 0 && (
            <Button
              size="sm"
              variant="secondary"
              disabled={!current && !reviewing}
              onClick={back}
            >
              Back
            </Button>
          )}
          <div className="flex items-center gap-2">
            {reviewing ? (
              <WhyDisabled
                when={!!blocking}
                reason="Fix the answers marked above first"
              >
                <Button size="sm" disabled={!!blocking} onClick={save}>
                  Save preferences
                </Button>
              </WhyDisabled>
            ) : (
              <>
                {current && canSkip(current, allowSkip) && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={
                      !complete || (!isLast && !returning && at >= total - 1)
                    }
                    onClick={skip}
                  >
                    Skip
                  </Button>
                )}
                <WhyDisabled
                  when={!!current && (!valid || !complete)}
                  reason="Answer this step first"
                >
                  <Button
                    size="sm"
                    disabled={
                      !current ||
                      !valid ||
                      !complete ||
                      (!isLast && !returning && at >= total - 1)
                    }
                    onClick={next}
                  >
                    {returning ? "Back to review" : isLast ? "Review" : "Next"}
                  </Button>
                </WhyDisabled>
              </>
            )}
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}

const slide = {
  enter: (d: number) => ({ opacity: 0, x: d * 16 }),
  center: { opacity: 1, x: 0 },
  exit: (d: number) => ({ opacity: 0, x: d * -16 }),
}
