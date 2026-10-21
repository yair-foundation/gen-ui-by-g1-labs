import { z } from "zod"

/**
 * Composition chart: the agent's contract.
 *
 * What a whole is made of: each part's share of a total, as a donut, 100%
 * bars (one per group, to compare mixes), a waffle of 100 squares, or a
 * treemap for many parts.
 */

export const compositionValueSchema = z.object({
  key: z.string().describe("Field in each data row that holds the part's amount."),
  label: z
    .string()
    .max(32)
    .describe("What the amounts are, 1–4 words, e.g. 'Spend'."),
  format: z
    .enum(["number", "currency", "percent"])
    .default("number")
    .describe("'percent' takes 12.5 to mean 12.5%."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for 'currency', e.g. 'EUR'."),
  unit: z
    .string()
    .max(12)
    .optional()
    .describe("Shown after amounts, e.g. 'visits'. Not for currency or percent."),
})

export const compositionChartSchema = z.object({
  title: z
    .string()
    .describe("The whole being split, e.g. 'Where the October budget went'."),
  description: z
    .string()
    .optional()
    .describe("Scope or source, e.g. 'Card spend, 1–31 Oct'."),
  type: z
    .enum(["donut", "bar", "waffle", "treemap"])
    .describe(
      "'donut' for one whole with up to 5 parts, 'bar' to compare the mix across 2–8 groups (or read one whole precisely), 'waffle' for 'N in 100' with up to 4 parts, 'treemap' for 6–20 parts of one whole.",
    ),
  part: z
    .object({
      key: z.string().describe("Field naming each row's part, e.g. 'category'."),
      label: z.string().max(24).optional().describe("What the parts are, e.g. 'Category'."),
    })
    .describe("The parts. Rows with the same part are added together."),
  value: compositionValueSchema,
  group: z
    .object({
      key: z.string().describe("Field holding each row's group, e.g. 'region'."),
      label: z.string().max(24).optional().describe("What the groups are, e.g. 'Region'."),
    })
    .optional()
    .describe("Bar only: one 100% bar per group, up to 8, to compare their mix."),
  total: z
    .number()
    .positive()
    .optional()
    .describe(
      "The whole, only when the parts don't fill it (a budget and what's spent so far); the rest shows as remainderLabel. One whole only.",
    ),
  remainderLabel: z
    .string()
    .max(20)
    .optional()
    .describe("Name for what's left of total, e.g. 'Left to spend'. Default 'Remaining'."),
  highlight: z
    .string()
    .optional()
    .describe("The part the user asked about; a donut shows its share in the centre."),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(1)
    .max(200)
    .describe(
      "DATA-BOUND. Rows from a tool result, each with the part and value keys (and the group key when used). Amounts, not percentages you computed.",
    ),
  summary: z
    .string()
    .optional()
    .describe("One sentence on what the split shows, shown under the chart."),
})

export type CompositionValue = z.infer<typeof compositionValueSchema>
export type CompositionChartInput = z.input<typeof compositionChartSchema>

/** Usage guidance the agent reads before choosing this component. */
export const compositionChartGuidance = {
  useWhen: [
    "The question is what a whole is made of: spend by category, traffic by source, how a budget is used, who makes up a team.",
    "The user wants to compare the mix across a few groups: traffic sources by region, plan mix by quarter as separate wholes.",
  ],
  avoidWhen: [
    "The parts don't add up to a meaningful whole (separate metrics, or multi-select answers whose percentages overlap). Use a bar chart.",
    "The mix changes over many periods. Use a stacked bar chart.",
    "There is one share to report ('38% of spend went to rent'). Say it in a sentence.",
    "You don't have the amounts from a tool. Never invent them.",
  ],
  rules: [
    "Pass amounts in one unit that add up to the whole; never percentages you worked out, never overlapping shares.",
    "Pick 'donut' for one whole with up to 5 parts, 'bar' to compare 2–8 groups or to read one whole precisely, 'waffle' for 'N in 100' with up to 4 parts, 'treemap' for 6–20 parts.",
    "Beyond 4 parts, donut, bar and waffle fold the smallest into 'Other' themselves; don't fold them yourself.",
    "Set total only when the parts don't fill the whole (budget vs spent), with a remainderLabel like 'Left to spend'.",
    "Set highlight to the part the user asked about.",
    "In summary, name the biggest part and anything surprising, in plain words.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(compositionChartSchema)`.
 */
export const compositionChartTool = {
  name: "show_composition",
  description: [
    "Show what a whole is made of from amounts in a tool result: each part's share as a donut, 100% bars (one per group to compare mixes), a waffle of 100 squares, or a treemap, with a legend of amounts and shares.",
    `Use when: ${compositionChartGuidance.useWhen.join(" ")}`,
    `Avoid when: ${compositionChartGuidance.avoidWhen.join(" ")}`,
    `Rules: ${compositionChartGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: compositionChartSchema,
} as const
