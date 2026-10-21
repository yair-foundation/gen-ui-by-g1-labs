import { z } from "zod"

/**
 * Preferences Wizard: the agent's contract.
 *
 * A step-by-step setup of the user's lasting preferences (news, diet,
 * travel, notifications). The answers become saved settings you use from
 * now on, so every step is visual, skippable and reviewed before saving.
 */

export const wizardIcons = [
  "newspaper",
  "utensils",
  "plane",
  "music",
  "film",
  "book",
  "dumbbell",
  "leaf",
  "briefcase",
  "heart",
  "globe",
  "sparkles",
  "bell",
  "moon",
  "sun",
  "coffee",
  "shopping-bag",
  "home",
] as const

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .describe("24-hour time, HH:MM.")

export const cardOptionSchema = z.object({
  id: z.string().describe("Returned in the answer when picked."),
  label: z.string().max(32),
  description: z
    .string()
    .max(80)
    .optional()
    .describe("One short line, e.g. 'Plant-based, no meat or fish'."),
  icon: z.enum(wizardIcons).optional(),
  image: z
    .object({
      src: z.string().describe("http(s), same-origin /path or data:image URL."),
      alt: z.string(),
    })
    .optional()
    .describe("Shown instead of the icon. Only when a picture helps choose."),
})

export const cardsInputSchema = z.object({
  type: z.literal("cards"),
  options: z.array(cardOptionSchema).min(2).max(12),
  multiple: z.boolean().default(false),
  min: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Fewest picks with multiple, e.g. 3 topics."),
  max: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Most picks with multiple."),
  value: z
    .array(z.string())
    .optional()
    .describe("Option ids already set (their current preference), if any."),
})

export const chipsInputSchema = z.object({
  type: z.literal("chips"),
  options: z.array(z.string().max(32)).min(1).max(24),
  multiple: z.literal(true).default(true),
  max: z.number().int().positive().optional(),
  allowCustom: z
    .boolean()
    .default(false)
    .describe("Adds an 'Add your own' input, e.g. for allergies or sources."),
  value: z.array(z.string()).optional().describe("Chips already set, if any."),
})

export const scaleInputSchema = z.object({
  type: z.literal("scale"),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  value: z
    .number()
    .describe("The starting value, kept if the step is skipped."),
  minLabel: z.string().max(20).describe("Low end, e.g. 'Headlines'."),
  maxLabel: z.string().max(20).describe("High end, e.g. 'Deep dives'."),
  format: z
    .enum(["level", "number", "currency", "percent"])
    .default("level")
    .describe(
      "'level' reads 'Adventurous (4 of 5)'; 'number' shows the value with unit, e.g. '30 min'.",
    ),
  unit: z
    .string()
    .max(12)
    .optional()
    .describe("For format 'number', e.g. 'min'."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 for 'currency'."),
})

export const rankInputSchema = z.object({
  type: z.literal("rank"),
  items: z
    .array(z.object({ id: z.string(), label: z.string().max(32) }))
    .min(2)
    .max(8)
    .describe("In the starting order, most important first."),
})

export const togglesInputSchema = z.object({
  type: z.literal("toggles"),
  items: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().max(40),
        description: z
          .string()
          .max(80)
          .optional()
          .describe("Screen readers only."),
        value: z.boolean().describe("The starting setting."),
      }),
    )
    .min(1)
    .max(8),
})

export const scheduleInputSchema = z.object({
  type: z.literal("schedule"),
  days: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe("Starting days, 0 = Sunday … 6 = Saturday. Default every day."),
  from: time.optional().describe("Start time, or the one time. Default 08:00."),
  to: time
    .optional()
    .describe(
      "Set for a from–to range (quiet hours); omit for a single time (a digest).",
    ),
})

export const textInputSchema = z.object({
  type: z.literal("text"),
  placeholder: z.string().max(60).optional(),
  maxLength: z.number().int().positive().max(500).optional(),
  value: z.string().optional(),
})

export const wizardInputSchema = z.discriminatedUnion("type", [
  cardsInputSchema,
  chipsInputSchema,
  scaleInputSchema,
  rankInputSchema,
  togglesInputSchema,
  scheduleInputSchema,
  textInputSchema,
])

export const wizardStepSchema = z.object({
  id: z.string().describe("Stable identifier. Keys the answer in the result."),
  title: z
    .string()
    .max(32)
    .describe("Short step name, 1–3 words, e.g. 'Cuisines'."),
  description: z
    .string()
    .max(120)
    .optional()
    .describe("One line: what to pick and what it changes."),
  required: z
    .boolean()
    .default(false)
    .describe("Can't be skipped. Only when you can't work without it."),
  input: wizardInputSchema,
})

export const preferencesWizardSchema = z.object({
  icon: z
    .enum(wizardIcons)
    .optional()
    .describe("What the preferences are about, shown beside the step title."),
  title: z
    .string()
    .max(60)
    .describe(
      "e.g. 'Set up your news preferences'. Screen readers only until saved.",
    ),
  intro: z
    .string()
    .max(160)
    .optional()
    .describe("One sentence: why you're asking. Screen readers only."),
  steps: z.array(wizardStepSchema).min(2).max(8),
  allowSkip: z
    .boolean()
    .default(true)
    .describe("Each optional step can be skipped and keeps its default."),
  savedTo: z
    .string()
    .max(40)
    .optional()
    .describe("Where the settings are kept, e.g. 'your profile'."),
})

export type WizardIcon = (typeof wizardIcons)[number]
export type WizardCardOption = z.infer<typeof cardOptionSchema>
export type WizardInput = z.input<typeof wizardInputSchema>
export type WizardStep = z.input<typeof wizardStepSchema>
export type PreferencesWizardInput = z.input<typeof preferencesWizardSchema>

/**
 * One step's answer. cards: the option id (single) or ids (multiple);
 * chips: the chosen chips, including the user's own; scale: the number;
 * rank: item ids, most important first; toggles: `{ [itemId]: boolean }`;
 * schedule: `{ days, from, to? }`; text: the trimmed text.
 */
export type PreferencesWizardAnswer =
  | string
  | string[]
  | number
  | Record<string, boolean>
  | { days: number[]; from: string; to?: string }

/** What the component sends back to the agent. A closed set of actions. */
export type PreferencesWizardResult =
  | {
      action: "save"
      /** Answers for every step that wasn't skipped, keyed by step id. */
      answers: Record<string, PreferencesWizardAnswer>
      /** Step ids the user skipped. Keep your defaults for these. */
      skipped: string[]
    }
  /** "Not now". Save nothing and don't ask again unless they bring it up. */
  | { action: "dismiss" }

/** Saved by the host on every change so a half-done wizard resumes. */
export type PreferencesWizardProgress = {
  /** The step on screen; steps.length is the review. */
  stepIndex: number
  answers: Record<string, PreferencesWizardAnswer>
  skipped?: string[]
}

/** Usage guidance the agent reads before choosing this component. */
export const preferencesWizardGuidance = {
  useWhen: [
    "The user wants to set up or personalize lasting preferences you will use from now on: news topics, diet, travel style, notifications.",
    "Onboarding, where a few visual choices replace a long back-and-forth.",
  ],
  avoidWhen: [
    "You need answers for this one task only. Use a question stepper.",
    "The user is booking, buying or submitting something. Use a guided flow.",
    "The user wants to tune the constraints of an answer you already gave. Use preference controls.",
  ],
  rules: [
    "Keep it to 2–8 short steps, broad to specific, each with a 1–3 word title.",
    "Prefill value with their current settings when you know them; otherwise use sensible defaults.",
    "Mark a step required only when you can't work without it; everything else can be skipped.",
    "Use cards with icons for a handful of broad choices, chips for long or open lists, scale for a degree, rank for priorities.",
    "Only save on action 'save': store answers as their settings, keep your defaults for skipped steps, and say in one line what changes.",
    "On 'dismiss', save nothing and don't ask again unless they bring it up.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(preferencesWizardSchema)`.
 */
export const preferencesWizardTool = {
  name: "setup_preferences",
  description: [
    "Walk the user through setting up their lasting preferences, one visual step at a time (cards, chips, a scale, a ranking, toggles, a schedule, short text), with a review before saving.",
    `Use when: ${preferencesWizardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${preferencesWizardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${preferencesWizardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: preferencesWizardSchema,
} as const
