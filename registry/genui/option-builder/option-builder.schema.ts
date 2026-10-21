import { z } from "zod"

/**
 * Option Builder: the agent's contract.
 *
 * The user picks a combination of options (APIs, add-ons, parts) where each
 * choice carries metrics, and sees the combined totals, budgets and score live
 * before continuing. Option metrics are DATA-BOUND: they come from a tool
 * result (a catalog, a price list, measurements), never from the model.
 */

export const builderMetricSchema = z.object({
  id: z.string().describe("Stable key, used in each option's `metrics`."),
  label: z.string().describe("Short name, e.g. 'Load time', 'Monthly cost'."),
  unit: z
    .string()
    .max(8)
    .optional()
    .describe(
      "Shown after the number for 'number' and 'currency', e.g. 'W' or '/mo'. Ignored for 'bytes' and 'duration-ms'.",
    ),
  format: z
    .enum(["number", "currency", "bytes", "duration-ms"])
    .default("number")
    .describe(
      "'bytes': values in bytes, shown as KB/MB (1 KB = 1,024 bytes). 'duration-ms': values in milliseconds. 'currency' needs `currency`.",
    ),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for format 'currency', e.g. 'USD'."),
  aggregate: z
    .enum(["sum", "max", "min", "avg"])
    .default("sum")
    .describe(
      "How the selected options combine: 'sum' for cost, size or load time; 'max' for a bottleneck; 'avg' for a typical value.",
    ),
  budget: z
    .number()
    .optional()
    .describe(
      "DATA-BOUND. A limit from the user or a tool result. A ceiling when better is 'lower', a floor when 'higher'. Shows 'of {budget}' and an over-budget state.",
    ),
  better: z
    .enum(["lower", "higher"])
    .default("lower")
    .describe("Which direction is good, for budgets and the score."),
})

export const builderOptionSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  name: z.string().describe("e.g. 'Google Cloud Vision'."),
  logo: z
    .object({
      url: z
        .string()
        .describe(
          "DATA-BOUND. The brand's logo from the catalog: http(s), or a same-origin path starting with a single slash.",
        ),
      darkUrl: z
        .string()
        .optional()
        .describe(
          "DATA-BOUND. A version of the logo for dark backgrounds, when the catalog has one.",
        ),
      alt: z.string().optional().describe("e.g. 'Google Cloud'."),
    })
    .optional()
    .describe(
      "The product's brand mark, shown in a small white tile. Omit when there is none; never guess a logo.",
    ),
  description: z
    .string()
    .optional()
    .describe("One short line that tells similar options apart."),
  metrics: z
    .record(z.string(), z.number())
    .describe(
      "DATA-BOUND. Value per metric id, from a tool result. Leave a metric out when it doesn't apply; never estimate.",
    ),
  badges: z
    .array(z.string().max(16))
    .max(2)
    .optional()
    .describe("Real states only, e.g. 'Beta', 'Current plan'."),
  disabled: z
    .string()
    .optional()
    .describe("Why it can't be chosen, e.g. 'Enterprise plan only'."),
  requires: z
    .array(z.string())
    .optional()
    .describe(
      "Option ids that come with this one. Selecting it selects them too.",
    ),
  excludes: z
    .array(z.string())
    .optional()
    .describe(
      "Option ids it can't be combined with. Applies both ways; set it on either side.",
    ),
})

export const builderGroupSchema = z.object({
  id: z.string(),
  label: z
    .string()
    .describe(
      "Tab label, e.g. 'External', 'CPU'. Shown as tabs when >1 group.",
    ),
  min: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Fewest picks in this group, e.g. 1 for a required part."),
  max: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Most picks in this group. 1 makes it a single choice (radios)."),
  options: z.array(builderOptionSchema).min(1).max(30),
})

/** The kinds of build the title icon may show. */
export const builderKinds = ["apis", "add-ons", "hardware", "other"] as const

export type BuilderKind = (typeof builderKinds)[number]

export const optionBuilderSchema = z.object({
  kind: z
    .enum(builderKinds)
    .optional()
    .describe(
      "What is being built: apis, add-ons, hardware or other. Shown as a coloured icon beside the title.",
    ),
  title: z
    .string()
    .describe("What the user is building, e.g. 'Combine APIs for the widget'."),
  description: z.string().optional(),
  metrics: z
    .array(builderMetricSchema)
    .min(1)
    .max(4)
    .describe(
      "The first two are the big header numbers and sit on the right of each row; the rest are listed under each option.",
    ),
  score: z
    .object({
      label: z.string().default("Score"),
      formula: z.literal("budget"),
    })
    .optional()
    .describe(
      "Adds a 0–100 score with a grade A–F from how far each budgeted metric is within budget. Needs at least one metric with a budget.",
    ),
  groups: z.array(builderGroupSchema).min(1).max(6),
  selection: z
    .object({
      min: z
        .number()
        .int()
        .min(0)
        .default(1)
        .describe("Fewest options before continuing. Default 1."),
      max: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Most options overall, dependencies included. 1 makes the whole builder a single choice.",
        ),
    })
    .default({ min: 1 }),
  steps: z
    .object({
      current: z.number().int().min(1),
      total: z.number().int().min(1),
    })
    .optional()
    .describe(
      "When this is one step of a longer flow: shows '1/3' and labels the button 'Next' until the last step.",
    ),
  defaultSelected: z
    .array(z.string())
    .optional()
    .describe("Option ids to start with, e.g. what the user already has."),
  submitLabel: z
    .string()
    .optional()
    .describe("Primary button label. Default 'Next' or 'Done'."),
})

export type BuilderMetric = z.input<typeof builderMetricSchema>
export type BuilderOption = z.input<typeof builderOptionSchema>
export type BuilderGroup = z.input<typeof builderGroupSchema>
export type OptionBuilderInput = z.input<typeof optionBuilderSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type OptionBuilderResult =
  | {
      action: "submit"
      /** Every selected id, dependencies included, in catalog order. */
      selected: string[]
      /** Total per metric id. Metrics with no value (e.g. max of none) are left out. */
      totals: Record<string, number>
      score?: { value: number; grade: "A" | "B" | "C" | "D" | "F" }
    }
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const optionBuilderGuidance = {
  useWhen: [
    "The user is assembling a combination where every choice has a cost or impact: APIs and their load time, plan add-ons and their price, PC parts within a budget, integrations and their monthly cost.",
    "Seeing the combined total, and whether it fits a budget, should shape the choice.",
  ],
  avoidWhen: [
    "The options have no numbers to combine. Use the Entity Picker or Question Stepper.",
    "You don't have real metrics for every option. Fetch them first; never estimate prices, sizes or timings.",
    "It's one product with variants (size, color). Use Product Options.",
  ],
  rules: [
    "Every metric value and budget comes from a tool result or the user, never from you.",
    "Order metrics by importance; the first two are the big numbers.",
    "Use requires for real dependencies and excludes for real conflicts; set group max 1 for one-of choices like a CPU.",
    "Only add score when budgets exist, and say what the budget is in your reply.",
    "Over budget is allowed: on submit, read the totals and point out any overrun before moving on.",
    "On 'dismiss', drop the flow and ask what they'd like instead.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(optionBuilderSchema)`.
 */
export const optionBuilderTool = {
  name: "build_selection",
  description: [
    "Let the user build a combination of options with metrics (cost, size, time) and see the totals, budgets and score update live.",
    `Use when: ${optionBuilderGuidance.useWhen.join(" ")}`,
    `Avoid when: ${optionBuilderGuidance.avoidWhen.join(" ")}`,
    `Rules: ${optionBuilderGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: optionBuilderSchema,
} as const
