import { z } from "zod"

/**
 * Comparison Matrix: the agent's contract.
 *
 * 2–5 options compared across shared criteria, with the differences marked
 * and, optionally, one option to pick. Fields marked DATA-BOUND must come
 * from a tool result (real prices, specs and terms), never from model free
 * text.
 */

export const compareValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const comparePriceSchema = z.object({
  amount: z.number(),
  currency: z.string().length(3).describe("ISO 4217 code, e.g. 'USD'."),
  period: z
    .string()
    .optional()
    .describe("What the amount covers, e.g. 'user / month' or 'one-time'."),
})

export const compareItemSchema = z.object({
  id: z
    .string()
    .describe("Stable identifier. Keys `values` and is returned on select."),
  name: z.string().describe("e.g. 'Growth' or 'Northwind Pro 16'."),
  subtitle: z
    .string()
    .optional()
    .describe(
      "One short line, e.g. 'For growing sales teams'. Screen readers only.",
    ),
  badge: z
    .string()
    .max(24)
    .optional()
    .describe(
      "DATA-BOUND. A real state, e.g. 'Current plan'. Never a selling point.",
    ),
  url: z
    .string()
    .optional()
    .describe("DATA-BOUND. http(s) link to the option's page."),
  price: comparePriceSchema
    .optional()
    .describe("DATA-BOUND. The headline price, shown under the name."),
})

export const compareCriterionSchema = z.object({
  id: z.string().describe("Stable identifier. Keys each item's `values`."),
  label: z.string().describe("e.g. 'Annual cost for 10 users'."),
  group: z
    .string()
    .optional()
    .describe("Heading that groups rows, e.g. 'Pricing' or 'Features'."),
  type: z
    .enum(["text", "number", "boolean", "rating", "currency"])
    .default("text")
    .describe(
      "Controls formatting: booleans as Yes/No icons, ratings as '4.5 / 5'.",
    ),
  better: z
    .enum(["higher", "lower"])
    .optional()
    .describe(
      "For number, currency and rating: which direction wins. Marks the best value in the row (ties mark all). Omit when neither is better, e.g. screen size.",
    ),
  unit: z
    .string()
    .max(12)
    .optional()
    .describe("Appended to numbers, e.g. 'GB', 'h', 'kg', '%'."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe(
      "ISO 4217 code for type 'currency'. Defaults to the items' price currency.",
    ),
  outOf: z
    .number()
    .positive()
    .optional()
    .describe("Top of the scale for type 'rating'. Default 5."),
  weight: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "Importance for the optional weighted score (e.g. 1–3). Only booleans and rows with `better` are scored. Omit on every row for no score.",
    ),
  help: z
    .string()
    .optional()
    .describe(
      "One short line on the criterion, e.g. 'First response time'. Screen readers only.",
    ),
})

export const comparisonMatrixSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("What is being compared, e.g. 'CRM plans for a 10-person team'."),
  items: z
    .array(compareItemSchema)
    .min(2)
    .max(5)
    .describe("The options, shown as columns in this order."),
  criteria: z
    .array(compareCriterionSchema)
    .min(1)
    .max(40)
    .describe(
      "The rows, in the order the user cares about, grouped by `group`.",
    ),
  values: z
    .record(z.string(), z.record(z.string(), compareValueSchema))
    .describe(
      "DATA-BOUND. values[itemId][criterionId]. Numbers for number, currency and rating; booleans for boolean. Use null when the value isn't known: it's shown as '—', never guessed.",
    ),
  highlight: z
    .enum(["differences", "all"])
    .default("differences")
    .describe(
      "'differences' folds rows where every option is equal under a 'N rows are the same' toggle. 'all' shows every row.",
    ),
  recommendation: z
    .object({
      itemId: z.string(),
      reason: z
        .string()
        .describe(
          "One sentence that cites the values above, e.g. 'Has automation and reports at half the cost of Scale'.",
        ),
    })
    .optional()
    .describe(
      "Your pick, shown as a 'Recommended' badge and one sentence. It must follow from the values shown.",
    ),
  selectable: z
    .boolean()
    .default(false)
    .describe("Let the user choose one option and send it back to you."),
  submitLabel: z
    .string()
    .optional()
    .describe("Button text when selectable, e.g. 'Switch to this plan'."),
})

export type CompareValue = z.infer<typeof compareValueSchema>
export type ComparePrice = z.infer<typeof comparePriceSchema>
export type CompareItem = z.infer<typeof compareItemSchema>
export type CompareCriterion = z.input<typeof compareCriterionSchema>
export type ComparisonMatrixInput = z.input<typeof comparisonMatrixSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type ComparisonMatrixResult =
  | { action: "select"; itemId: string }
  /** The user chose none of the options. */
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const comparisonMatrixGuidance = {
  useWhen: [
    "The user wants to compare 2–5 options side by side across the same criteria: plans, products, vendors, candidates, approaches.",
    "Seeing where the options differ is the point, and the user may pick one.",
  ],
  avoidWhen: [
    "There is one option. Use an entity card or a summary.",
    "There are more than 5 options, or many records with the same fields. Use a data table.",
    "The options differ on one number. Say it in a sentence or use a chart.",
    "You can't read the real values. Fetch them first; never fill gaps from memory.",
  ],
  rules: [
    "Every value comes from a tool result. Use null for anything unknown; never guess.",
    "Use the same criteria for every option, grouped (Pricing, Features, Support) and ordered by what the user asked about.",
    "Set `better` only where one direction clearly wins (price lower, battery higher). Leave it off for neutral facts like screen size.",
    "Add `weight` only when the user's priorities are known, e.g. 'for video editing'. The score is computed from the values; don't state your own.",
    "A recommendation must follow from the values shown, and its reason must cite them.",
    "Set selectable only when the choice changes what you do next, e.g. switching plans. Act only on a 'select' result.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(comparisonMatrixSchema)`.
 */
export const comparisonMatrixTool = {
  name: "compare_options",
  description: [
    "Compare 2–5 options side by side across shared criteria, mark where they differ and the best value per row, and optionally let the user pick one.",
    `Use when: ${comparisonMatrixGuidance.useWhen.join(" ")}`,
    `Avoid when: ${comparisonMatrixGuidance.avoidWhen.join(" ")}`,
    `Rules: ${comparisonMatrixGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: comparisonMatrixSchema,
} as const
