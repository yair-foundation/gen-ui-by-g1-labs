/**
 * Preferences Wizard: pure helpers for defaults, validation, summaries,
 * navigation and the review. No React, no Zod, so they run anywhere (and in
 * Node tests). Nothing is mutated; every helper returns new values.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

// ---- Types (mirror the schema, kept plain so this file stands alone) ----

export type CardOption = {
  id: string
  label: string
  description?: string
  icon?: string
  image?: { src: string; alt: string }
}

export type CardsInput = {
  type: "cards"
  options: CardOption[]
  multiple?: boolean
  min?: number
  max?: number
  value?: string[]
}

export type ChipsInput = {
  type: "chips"
  options: string[]
  multiple?: true
  max?: number
  allowCustom?: boolean
  value?: string[]
}

export type ScaleFormat = "level" | "number" | "currency" | "percent"

export type ScaleInput = {
  type: "scale"
  min: number
  max: number
  step: number
  value: number
  minLabel: string
  maxLabel: string
  format?: ScaleFormat
  unit?: string
  currency?: string
}

export type RankInput = {
  type: "rank"
  items: { id: string; label: string }[]
}

export type TogglesInput = {
  type: "toggles"
  items: { id: string; label: string; description?: string; value: boolean }[]
}

export type ScheduleInput = {
  type: "schedule"
  days?: number[]
  from?: string
  to?: string
}

export type TextInput = {
  type: "text"
  placeholder?: string
  maxLength?: number
  value?: string
}

export type WizardInput =
  | CardsInput
  | ChipsInput
  | ScaleInput
  | RankInput
  | TogglesInput
  | ScheduleInput
  | TextInput

export type WizardStep = {
  id: string
  title: string
  description?: string
  required?: boolean
  input: WizardInput
}

export type Schedule = { days: number[]; from: string; to?: string }

/** A step's working value. Cards keep an array even for a single pick. */
export type DraftValue =
  string | string[] | number | Record<string, boolean> | Schedule

export type Drafts = Record<string, DraftValue>

/** A step's value as sent to the agent. A single card pick is its id. */
export type WizardAnswer = DraftValue

// ---- Readiness (streaming) ----

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v)
const isStr = (v: unknown): v is string => typeof v === "string"

/** "07:30" style 24-hour time. */
export function isTime(v: unknown): v is string {
  return isStr(v) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)
}

/** Only http(s), same-origin "/path" and inline images are shown. */
export function isSafeImageSrc(src: unknown): src is string {
  if (!isStr(src)) return false
  if (/^\/(?![/\\])/.test(src)) return true
  if (/^data:image\/(png|jpe?g|gif|webp|avif);/i.test(src)) return true
  try {
    const url = new URL(src)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

function uniqueBy<T>(list: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return list.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * The usable part of an input that may still be streaming: incomplete
 * options are dropped. Returns null while nothing usable has arrived.
 */
export function readyInput(raw: unknown): WizardInput | null {
  if (!isObj(raw) || !isStr(raw.type)) return null
  switch (raw.type) {
    case "cards": {
      const options = uniqueBy(
        (Array.isArray(raw.options) ? raw.options : []).filter(
          (o): o is CardOption => isObj(o) && isStr(o.id) && isStr(o.label),
        ),
        (o) => o.id,
      )
      return { ...(raw as CardsInput), options }
    }
    case "chips": {
      const options = uniqueBy(
        (Array.isArray(raw.options) ? raw.options : []).filter(
          (o): o is string => isStr(o) && o.trim() !== "",
        ),
        (o) => o.toLowerCase(),
      )
      return { ...(raw as ChipsInput), options }
    }
    case "scale":
      return isNum(raw.min) &&
        isNum(raw.max) &&
        isNum(raw.step) &&
        raw.step > 0 &&
        raw.max > raw.min &&
        isNum(raw.value)
        ? (raw as ScaleInput)
        : null
    case "rank": {
      const items = uniqueBy(
        (Array.isArray(raw.items) ? raw.items : []).filter(
          (i): i is { id: string; label: string } =>
            isObj(i) && isStr(i.id) && isStr(i.label),
        ),
        (i) => i.id,
      )
      return { type: "rank", items }
    }
    case "toggles": {
      const items = uniqueBy(
        (Array.isArray(raw.items) ? raw.items : []).filter(
          (i): i is TogglesInput["items"][number] =>
            isObj(i) && isStr(i.id) && isStr(i.label),
        ),
        (i) => i.id,
      )
      return { type: "toggles", items }
    }
    case "schedule":
      return raw as ScheduleInput
    case "text":
      return raw as TextInput
    default:
      return null
  }
}

/** A step as it may arrive while streaming → a usable step, or null. */
export function readyStep(raw: unknown): WizardStep | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.title)) return null
  const input = readyInput(raw.input)
  if (!input) return null
  return {
    id: raw.id,
    title: raw.title,
    description: isStr(raw.description) ? raw.description : undefined,
    required: raw.required === true,
    input,
  }
}

/** The usable steps, in order; the first of a duplicated id wins. */
export function readySteps(raw: unknown[] | undefined): WizardStep[] {
  return uniqueBy(
    (raw ?? []).map(readyStep).filter((s): s is WizardStep => s !== null),
    (s) => s.id,
  )
}

// ---- Scale ----

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Snaps to the nearest step from min, inside the range. */
export function snapToStep(input: ScaleInput, v: number): number {
  const steps = Math.round((v - input.min) / input.step)
  const snapped = input.min + steps * input.step
  // Avoid 0.30000000000000004 from float steps.
  return clamp(Number(snapped.toFixed(10)), input.min, input.max)
}

/** 1-based position and count of a scale value, e.g. 4 of 5. */
export function scalePosition(input: ScaleInput, v: number) {
  const count = Math.floor((input.max - input.min) / input.step + 1e-9) + 1
  const position = Math.round((snapToStep(input, v) - input.min) / input.step)
  return { position: position + 1, count }
}

/** The value as a number, e.g. "$150", "30 min", "40%". */
export function formatScaleNumber(
  input: ScaleInput,
  v: number,
  locale: string = DEFAULT_LOCALE,
): string {
  switch (input.format) {
    case "currency":
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency: input.currency ?? "USD",
          maximumFractionDigits: Number.isInteger(v) ? 0 : 2,
        }).format(v)
      } catch {
        return `${v} ${input.currency ?? ""}`.trim()
      }
    case "percent":
      return `${v}%`
    default:
      return input.unit ? `${v} ${input.unit}` : String(v)
  }
}

/**
 * Words for a scale value. 'level' scales name the nearer end:
 * "Adventurous (4 of 5)"; the exact middle is "Middle (3 of 5)".
 */
export function formatScale(
  input: ScaleInput,
  v: number,
  locale: string = DEFAULT_LOCALE,
): string {
  const format = input.format ?? "level"
  if (format !== "level") return formatScaleNumber(input, v, locale)
  const { position, count } = scalePosition(input, v)
  const middle = (count + 1) / 2
  const word =
    position < middle
      ? input.minLabel
      : position > middle
        ? input.maxLabel
        : "Middle"
  return `${word} (${position} of ${count})`
}

// ---- Schedule ----

export const WEEKDAYS = [
  { day: 1, short: "Mon", long: "Monday" },
  { day: 2, short: "Tue", long: "Tuesday" },
  { day: 3, short: "Wed", long: "Wednesday" },
  { day: 4, short: "Thu", long: "Thursday" },
  { day: 5, short: "Fri", long: "Friday" },
  { day: 6, short: "Sat", long: "Saturday" },
  { day: 0, short: "Sun", long: "Sunday" },
] as const

/** Sorted Monday first, deduped, only 0–6. */
export function normalizeDays(days: unknown): number[] {
  if (!Array.isArray(days)) return []
  const set = new Set(
    days.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6),
  )
  return WEEKDAYS.map((w) => w.day).filter((d) => set.has(d))
}

/** "Weekdays", "Weekends", "Every day" or "Mon, Wed, Fri". */
export function describeDays(days: number[]): string {
  const d = normalizeDays(days)
  const key = d.join(",")
  if (d.length === 0) return "No days"
  if (d.length === 7) return "Every day"
  if (key === "1,2,3,4,5") return "Weekdays"
  if (key === "6,0") return "Weekends"
  return d.map((n) => WEEKDAYS.find((w) => w.day === n)?.short).join(", ")
}

/** Whether the schedule asks for a from–to range (else a single time). */
export function isRange(input: ScheduleInput) {
  return input.to !== undefined
}

// ---- Defaults ----

/** The value a step starts with, and keeps when it is skipped. */
export function defaultValue(input: WizardInput): DraftValue {
  switch (input.type) {
    case "cards": {
      const ids = input.options.map((o) => o.id)
      const v = (input.value ?? []).filter((id) => ids.includes(id))
      return input.multiple ? v : v.slice(0, 1)
    }
    case "chips":
      return [...(input.value ?? [])]
    case "scale":
      return snapToStep(input, input.value)
    case "rank":
      return input.items.map((i) => i.id)
    case "toggles":
      return Object.fromEntries(
        input.items.map((i) => [i.id, i.value === true]),
      )
    case "schedule": {
      const days = input.days === undefined ? [0, 1, 2, 3, 4, 5, 6] : input.days
      const value: Schedule = {
        days: normalizeDays(days),
        from: isTime(input.from) ? input.from : "08:00",
      }
      if (isRange(input)) value.to = isTime(input.to) ? input.to : "20:00"
      return value
    }
    case "text":
      return input.value ?? ""
  }
}

/** A step's working value: the user's draft, or the default. */
export function stepValue(step: WizardStep, drafts: Drafts): DraftValue {
  const v = coerceValue(step.input, drafts[step.id])
  return v === undefined ? defaultValue(step.input) : v
}

/**
 * Fits a stored value (from progress or a result) onto an input. Returns
 * undefined when it doesn't fit, so the default is used instead.
 */
export function coerceValue(
  input: WizardInput,
  raw: unknown,
): DraftValue | undefined {
  if (raw === undefined || raw === null) return undefined
  switch (input.type) {
    case "cards": {
      const list = isStr(raw) ? [raw] : Array.isArray(raw) ? raw : null
      if (!list) return undefined
      const ids = input.options.map((o) => o.id)
      const v = [...new Set(list.filter((x): x is string => isStr(x)))].filter(
        (id) => ids.includes(id),
      )
      return input.multiple ? v : v.slice(0, 1)
    }
    case "chips": {
      if (!Array.isArray(raw)) return undefined
      return uniqueBy(
        raw.filter((x): x is string => isStr(x) && x.trim() !== ""),
        (x) => x.toLowerCase(),
      )
    }
    case "scale":
      return isNum(raw) ? snapToStep(input, raw) : undefined
    case "rank": {
      if (!Array.isArray(raw)) return undefined
      const ids = input.items.map((i) => i.id)
      const kept = [
        ...new Set(raw.filter((x): x is string => isStr(x))),
      ].filter((id) => ids.includes(id))
      // Items the stored order doesn't know go last, in the given order.
      return [...kept, ...ids.filter((id) => !kept.includes(id))]
    }
    case "toggles": {
      if (!isObj(raw)) return undefined
      return Object.fromEntries(
        input.items.map((i) => [
          i.id,
          typeof raw[i.id] === "boolean" ? (raw[i.id] as boolean) : i.value,
        ]),
      )
    }
    case "schedule": {
      if (!isObj(raw)) return undefined
      const base = defaultValue(input) as Schedule
      const value: Schedule = {
        days: Array.isArray(raw.days) ? normalizeDays(raw.days) : base.days,
        from: isStr(raw.from) ? raw.from : base.from,
      }
      if (isRange(input)) value.to = isStr(raw.to) ? raw.to : base.to
      return value
    }
    case "text":
      return isStr(raw) ? raw : undefined
  }
}

// ---- Validation ----

export type Validity = { valid: true } | { valid: false; message: string }

const ok: Validity = { valid: true }
const fail = (message: string): Validity => ({ valid: false, message })

/** The fewest picks a cards or chips step accepts (0 = may be empty). */
export function minPicks(step: WizardStep): number {
  const { input } = step
  if (input.type === "cards") {
    if (!input.multiple) return step.required ? 1 : 0
    return Math.max(input.min ?? 0, step.required ? 1 : 0)
  }
  if (input.type === "chips") return step.required ? 1 : 0
  return 0
}

/** The most picks a cards or chips step accepts. */
export function maxPicks(step: WizardStep): number {
  const { input } = step
  if (input.type === "cards") {
    if (!input.multiple) return 1
    return input.max ?? input.options.length
  }
  if (input.type === "chips") return input.max ?? Number.POSITIVE_INFINITY
  return Number.POSITIVE_INFINITY
}

/** "Pick at least 3", "Pick up to 5", "Pick 2–4", or "". */
export function picksHint(step: WizardStep): string {
  const { input } = step
  if (input.type !== "cards" && input.type !== "chips") return ""
  if (input.type === "cards" && !input.multiple) return ""
  const min = minPicks(step)
  const max = maxPicks(step)
  const hasMax =
    Number.isFinite(max) &&
    !(input.type === "cards" && max >= input.options.length)
  if (min > 0 && hasMax)
    return min === max ? `Pick ${min}` : `Pick ${min}–${max}`
  if (min > 0) return `Pick at least ${min}`
  if (hasMax) return `Pick up to ${max}`
  return ""
}

/**
 * Whether the user may continue with this value. An empty optional answer is
 * valid (it means "none"), unless the step sets a minimum: then the user
 * skips instead.
 */
export function validateStep(step: WizardStep, value: DraftValue): Validity {
  const { input } = step
  switch (input.type) {
    case "cards":
    case "chips": {
      const n = Array.isArray(value) ? value.length : 0
      const min = minPicks(step)
      const max = maxPicks(step)
      if (n < min)
        return fail(min === 1 ? "Pick at least 1." : `Pick at least ${min}.`)
      if (n > max) return fail(`Pick no more than ${max}.`)
      return ok
    }
    case "scale":
      return isNum(value) && value >= input.min && value <= input.max
        ? ok
        : fail("Choose a value.")
    case "rank":
    case "toggles":
      return ok
    case "schedule": {
      const s = value as Schedule
      if (!s || normalizeDays(s.days).length === 0)
        return fail("Pick at least one day.")
      if (!isTime(s.from)) return fail("Enter a time.")
      if (isRange(input)) {
        if (!isTime(s.to)) return fail("Enter an end time.")
        if (s.to === s.from) return fail("Start and end can't be the same.")
      }
      return ok
    }
    case "text": {
      const text = isStr(value) ? value.trim() : ""
      if (step.required && !text) return fail("Enter an answer.")
      if (input.maxLength && text.length > input.maxLength)
        return fail(`Keep it under ${input.maxLength} characters.`)
      return ok
    }
  }
}

export const isStepValid = (step: WizardStep, value: DraftValue) =>
  validateStep(step, value).valid

export function canSkip(step: WizardStep, allowSkip: boolean) {
  return allowSkip && !step.required
}

// ---- Choices ----

/** Toggles a pick, respecting single choice and the maximum. */
export function togglePick(
  step: WizardStep,
  current: string[],
  id: string,
): string[] {
  if (current.includes(id)) return current.filter((x) => x !== id)
  const multiple =
    step.input.type === "chips" ||
    (step.input.type === "cards" && step.input.multiple === true)
  if (!multiple) return [id]
  if (current.length >= maxPicks(step)) return current
  return [...current, id]
}

/** Adds the user's own chip; returns the list unchanged when it can't. */
export function addCustomChip(
  step: WizardStep,
  current: string[],
  raw: string,
): string[] {
  if (step.input.type !== "chips") return current
  const text = raw.trim().replace(/\s+/g, " ").slice(0, 40)
  if (!text) return current
  const known = [...step.input.options, ...current].find(
    (x) => x.toLowerCase() === text.toLowerCase(),
  )
  // Typing an existing option selects it rather than adding a duplicate.
  const value = known ?? text
  if (current.includes(value)) return current
  if (current.length >= maxPicks(step)) return current
  return [...current, value]
}

/** The chips to show: the options, then the user's own additions. */
export function chipList(input: ChipsInput, current: string[]): string[] {
  const lower = input.options.map((o) => o.toLowerCase())
  return [
    ...input.options,
    ...current.filter((c) => !lower.includes(c.toLowerCase())),
  ]
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(clamp(to, 0, next.length), 0, item)
  return next
}

// ---- Summaries ----

/** One line describing a step's value, for the review and the record. */
export function summarize(
  step: WizardStep,
  value: DraftValue,
  locale: string = DEFAULT_LOCALE,
): string {
  const { input } = step
  switch (input.type) {
    case "cards": {
      const list = Array.isArray(value) ? value : []
      const labels = list.map(
        (id) => input.options.find((o) => o.id === id)?.label ?? id,
      )
      return labels.length ? labels.join(", ") : "None"
    }
    case "chips": {
      const list = Array.isArray(value) ? value : []
      return list.length ? list.join(", ") : "None"
    }
    case "scale":
      return isNum(value) ? formatScale(input, value, locale) : ""
    case "rank": {
      const list = Array.isArray(value) ? value : []
      return list
        .map(
          (id, i) =>
            `${i + 1}. ${input.items.find((x) => x.id === id)?.label ?? id}`,
        )
        .join(" ")
    }
    case "toggles": {
      const v = (isObj(value) ? value : {}) as Record<string, unknown>
      const on = input.items.filter((i) => v[i.id] === true).map((i) => i.label)
      if (on.length === 0) return "All off"
      return on.length === input.items.length ? "All on" : on.join(", ")
    }
    case "schedule": {
      const s = value as Schedule
      const days = describeDays(s.days)
      return isRange(input)
        ? `${days} ${s.from}–${s.to}`
        : `${days} at ${s.from}`
    }
    case "text": {
      const text = isStr(value) ? value.trim() : ""
      return text || "None"
    }
  }
}

// ---- Result ----

/** The value sent to the agent: a single card pick becomes its id. */
export function toAnswer(step: WizardStep, value: DraftValue): WizardAnswer {
  const { input } = step
  if (input.type === "cards" && !input.multiple) {
    return Array.isArray(value) ? (value[0] ?? "") : ""
  }
  if (input.type === "text") return isStr(value) ? value.trim() : ""
  return value
}

/** Answers for every step that wasn't skipped, keyed by step id. */
export function buildAnswers(
  steps: WizardStep[],
  drafts: Drafts,
  skipped: string[],
): Record<string, WizardAnswer> {
  return Object.fromEntries(
    steps
      .filter((s) => !skipped.includes(s.id))
      .map((s) => [s.id, toAnswer(s, stepValue(s, drafts))]),
  )
}

/** Stored answers (progress or a result) → working drafts. */
export function draftsFromAnswers(
  steps: WizardStep[],
  answers: Record<string, unknown> | undefined,
): Drafts {
  const drafts: Drafts = {}
  if (!answers) return drafts
  for (const s of steps) {
    const v = coerceValue(s.input, answers[s.id])
    if (v !== undefined) drafts[s.id] = v
  }
  return drafts
}

// ---- Review ----

export type ReviewRow = {
  id: string
  title: string
  index: number
  skipped: boolean
  summary: string
  /** The value can't be saved as it is (e.g. a required step left empty). */
  invalid: boolean
}

/** One row per step, in order; skipped steps read "Using defaults". */
export function reviewRows(
  steps: WizardStep[],
  drafts: Drafts,
  skipped: string[],
  locale: string = DEFAULT_LOCALE,
): ReviewRow[] {
  return steps.map((s, index) => {
    const isSkipped = skipped.includes(s.id) && !s.required
    const value = stepValue(s, drafts)
    return {
      id: s.id,
      title: s.title,
      index,
      skipped: isSkipped,
      summary: isSkipped ? "Using defaults" : summarize(s, value, locale),
      invalid: !isSkipped && !isStepValid(s, value),
    }
  })
}

/** The first step that blocks saving, or null when everything can be saved. */
export function firstBlocking(rows: ReviewRow[]): ReviewRow | null {
  return rows.find((r) => r.invalid) ?? null
}

// ---- Navigation ----

/** Where the user is. stepIndex === steps.length is the review. */
export type NavState = {
  stepIndex: number
  skipped: string[]
  /** Set when the user jumped from the review to edit a step. */
  returnToReview: boolean
}

export type NavEvent =
  | { type: "next" }
  | { type: "skip" }
  | { type: "back" }
  | { type: "edit"; index: number }

/**
 * Moves through the wizard. Next keeps the answer (and un-skips the step);
 * Skip marks it skipped (it keeps its default). After an edit from the
 * review, either one returns to the review. Skipping a required step, or
 * skipping when skips aren't allowed, does nothing.
 */
export function navigate(
  state: NavState,
  event: NavEvent,
  steps: WizardStep[],
  allowSkip = true,
): NavState {
  const total = steps.length
  const at = clamp(state.stepIndex, 0, total)
  const step = steps[at] as WizardStep | undefined
  const advance = (skipped: string[]): NavState =>
    state.returnToReview
      ? { stepIndex: total, skipped, returnToReview: false }
      : { stepIndex: Math.min(at + 1, total), skipped, returnToReview: false }

  switch (event.type) {
    case "next":
      if (!step) return state
      return advance(state.skipped.filter((id) => id !== step.id))
    case "skip":
      if (!step || !canSkip(step, allowSkip)) return state
      return advance(
        state.skipped.includes(step.id)
          ? state.skipped
          : [...state.skipped, step.id],
      )
    case "back":
      return { ...state, stepIndex: Math.max(at - 1, 0) }
    case "edit":
      if (event.index < 0 || event.index >= total) return state
      return { ...state, stepIndex: event.index, returnToReview: true }
  }
}

/** Per-step progress for the segmented bar and its screen reader text. */
export type SegmentState = "done" | "skipped" | "current" | "todo"

export function segmentStates(
  steps: WizardStep[],
  stepIndex: number,
  skipped: string[],
  visited: number,
): SegmentState[] {
  return steps.map((s, i) => {
    if (i === stepIndex) return "current"
    if (skipped.includes(s.id)) return "skipped"
    return i < Math.max(stepIndex, visited) ? "done" : "todo"
  })
}

export function pluralize(count: number, noun: string, plural = `${noun}s`) {
  return `${count} ${count === 1 ? noun : plural}`
}
