import { z } from "zod"

/**
 * Preference Controls: the agent's contract.
 *
 * The constraints behind an answer (budget, priorities, tone, length, dates,
 * must-haves) as controls. The user tunes them and asks you to redo the
 * answer with the new values.
 */

const id = z
  .string()
  .describe("Stable identifier. Keys the values in the result.")
const label = z.string().max(40).describe("What it controls, e.g. 'Budget'.")

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD.")

export const sliderControlSchema = z.object({
  type: z.literal("slider"),
  id,
  label,
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  value: z.number().describe("The value the current answer was made with."),
  unit: z
    .string()
    .max(24)
    .optional()
    .describe(
      "Shown after the number, e.g. 'min' or 'words'. Ignored for currency.",
    ),
  format: z
    .enum(["currency", "number", "percent"])
    .optional()
    .describe("Default 'number'. 'percent' expects 0–100."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe(
      "ISO 4217 code for format 'currency', e.g. 'EUR'. Default 'USD'.",
    ),
  minLabel: z
    .string()
    .max(20)
    .optional()
    .describe("Word for the low end, e.g. 'Relaxed'."),
  maxLabel: z
    .string()
    .max(20)
    .optional()
    .describe("Word for the high end, e.g. 'Packed'."),
})

export const segmentedControlSchema = z.object({
  type: z.literal("segmented"),
  id,
  label,
  options: z
    .array(z.object({ value: z.string(), label: z.string().max(20) }))
    .min(2)
    .max(5),
  value: z.string().describe("The option the current answer was made with."),
})

export const prioritiesControlSchema = z.object({
  type: z.literal("priorities"),
  id,
  label,
  items: z
    .array(z.object({ id: z.string(), label: z.string().max(32) }))
    .min(2)
    .max(6)
    .describe("Most important first, as the current answer weighs them."),
})

export const toggleControlSchema = z.object({
  type: z.literal("toggle"),
  id,
  label,
  value: z.boolean(),
  help: z
    .string()
    .max(80)
    .optional()
    .describe("One line on what it changes. Screen readers only."),
})

export const chipsControlSchema = z.object({
  type: z.literal("chips"),
  id,
  label,
  options: z.array(z.string().max(32)).min(1).max(12),
  value: z.array(z.string()).describe("The options currently required."),
  max: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Most the user can pick."),
})

export const dateRangeControlSchema = z.object({
  type: z.literal("date-range"),
  id,
  label,
  start: isoDate,
  end: isoDate,
  min: isoDate.optional().describe("Earliest allowed date."),
  max: isoDate.optional().describe("Latest allowed date."),
})

export const controlSchema = z.discriminatedUnion("type", [
  sliderControlSchema,
  segmentedControlSchema,
  prioritiesControlSchema,
  toggleControlSchema,
  chipsControlSchema,
  dateRangeControlSchema,
])

/** One control's value, as sent back and as used in presets. */
export const controlValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.string()),
  z.object({ start: isoDate, end: isoDate }),
])

export const presetSchema = z.object({
  id: z.string(),
  label: z.string().max(20).describe("e.g. 'Budget', 'Balanced', 'Comfort'."),
  values: z
    .record(z.string(), controlValueSchema)
    .describe(
      "Control id → value. Sliders: number; segmented: option value; priorities: item ids in order; toggle: boolean; chips: options; date-range: { start, end }.",
    ),
})

export const preferenceControlsSchema = z.object({
  title: z.string().max(40).default("Adjust"),
  appliesTo: z
    .string()
    .max(60)
    .optional()
    .describe(
      "What gets redone, e.g. 'your 5-day Lisbon itinerary'. Names the button ('Update itinerary'); otherwise screen readers only.",
    ),
  controls: z
    .array(controlSchema)
    .min(1)
    .max(8)
    .describe(
      "The constraints you actually used, each set to the value behind the current answer.",
    ),
  presets: z
    .array(presetSchema)
    .max(4)
    .optional()
    .describe("Named starting points, e.g. Budget / Balanced / Comfort."),
  live: z
    .boolean()
    .default(false)
    .describe(
      "Send each change after a short pause instead of on 'Update'. Only for cheap, fast regenerations.",
    ),
})

export type SliderControl = z.infer<typeof sliderControlSchema>
export type SegmentedControl = z.infer<typeof segmentedControlSchema>
export type PrioritiesControl = z.infer<typeof prioritiesControlSchema>
export type ToggleControl = z.infer<typeof toggleControlSchema>
export type ChipsControl = z.infer<typeof chipsControlSchema>
export type DateRangeControl = z.infer<typeof dateRangeControlSchema>
export type PreferenceControl = z.infer<typeof controlSchema>
export type PreferenceControlValue = z.infer<typeof controlValueSchema>
export type PreferencePreset = z.infer<typeof presetSchema>
export type PreferenceControlsInput = z.input<typeof preferenceControlsSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type PreferenceControlsResult =
  | {
      action: "update"
      /** Every control's value (not only the changed ones), keyed by id. */
      values: Record<string, PreferenceControlValue>
      /** Ids of the controls that differ from the values you sent. */
      changed: string[]
    }
  /** Go back to the values you sent, undoing an update already requested. */
  | { action: "reset" }

/** Usage guidance the agent reads before choosing this component. */
export const preferenceControlsGuidance = {
  useWhen: [
    "You produced an answer that depends on a few constraints (a budget, a pace, a tone, a length, dates, must-haves), and the user is likely to want it redone with different ones.",
    "The user asks to make an answer cheaper, shorter, more casual, more relaxed, or to change what matters most.",
  ],
  avoidWhen: [
    "The user still has to give you the inputs for a first answer. Ask with a form or questions instead.",
    "The numbers can be recomputed on the spot without you. Use a simulation or calculator.",
    "The user is choosing between finished alternatives. Offer drafts or options.",
  ],
  rules: [
    "Show it next to the answer it controls, and name that answer in appliesTo.",
    "Only expose constraints you actually used, set to the values behind the current answer.",
    "Use stable ids; on 'update', redo the answer with every value in values and say what changed (changed lists the ids).",
    "After an update, call the tool again with the new values as the current ones, so the user can keep iterating.",
    "On 'reset', go back to the answer made with the values you sent.",
    "Set live only when regenerating is cheap and fast; otherwise the user presses Update.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(preferenceControlsSchema)`.
 */
export const preferenceControlsTool = {
  name: "adjust_preferences",
  description: [
    "Show the constraints behind an answer (budget, priorities, tone, length, dates, must-haves) as controls the user can tune to ask you to redo it.",
    `Use when: ${preferenceControlsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${preferenceControlsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${preferenceControlsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: preferenceControlsSchema,
} as const
