import { z } from "zod"

/**
 * Distribution chart: the agent's contract.
 *
 * How the values of one measure are spread: their typical value, range,
 * skew and outliers. Three forms: a histogram for the shape of one set, box
 * plots to compare spread across groups, and dots when each item matters.
 */

export const distributionMeasureSchema = z.object({
  key: z.string().describe("Field in each data row that holds the value."),
  label: z
    .string()
    .max(32)
    .describe("Axis title, 1–4 words, e.g. 'Delivery time'. Shown on the chart."),
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
    .describe("Shown after values, e.g. 'min'. Not for currency or percent."),
})

export const distributionMarkerSchema = z.object({
  value: z.number().describe("Where the line goes, in the measure's units."),
  label: z
    .string()
    .max(24)
    .describe("1–3 words, e.g. 'Your time' or 'Target'."),
})

export const distributionChartSchema = z.object({
  title: z
    .string()
    .describe("The question it answers, e.g. 'How long deliveries take'."),
  description: z
    .string()
    .optional()
    .describe("Scope or source, e.g. '412 deliveries, last 30 days'."),
  type: z
    .enum(["histogram", "box", "dots"])
    .describe(
      "'histogram' for the shape of one set (30+ values), 'box' to compare spread across 2–6 groups, 'dots' for up to about 80 values when each item matters.",
    ),
  measure: distributionMeasureSchema,
  group: z
    .object({
      key: z.string().describe("Field holding each value's group."),
      label: z
        .string()
        .max(24)
        .optional()
        .describe("What the groups are, e.g. 'Level'."),
    })
    .optional()
    .describe(
      "Box and dots only: one row per group, up to 6, in first-seen order. A histogram shows one set.",
    ),
  name: z
    .string()
    .optional()
    .describe("Field naming each item, e.g. 'order'. Shown on hover in dots and for box outliers."),
  bins: z
    .number()
    .int()
    .min(5)
    .max(40)
    .optional()
    .describe("Histogram only: about how many bars. Omit to choose automatically."),
  markers: z
    .array(distributionMarkerSchema)
    .max(3)
    .optional()
    .describe(
      "Up to 3 reference lines: the user's own value, a target or a limit.",
    ),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(5)
    .max(1000)
    .describe(
      "DATA-BOUND. One row per individual value from a tool result (never pre-binned counts or averages), each with the measure key, and the group and name keys when used.",
    ),
  summary: z
    .string()
    .optional()
    .describe("One sentence on what the spread shows, shown under the chart."),
})

export type DistributionMeasure = z.infer<typeof distributionMeasureSchema>
export type DistributionMarker = z.infer<typeof distributionMarkerSchema>
export type DistributionChartInput = z.input<typeof distributionChartSchema>

/** Usage guidance the agent reads before choosing this component. */
export const distributionChartGuidance = {
  useWhen: [
    "The user asks how values are spread: what's typical, how wide the range is, whether there are outliers or a long tail (how long deliveries usually take, how salaries vary by level).",
    "The user wants to see where one value falls among many (my score against the class, our price against competitors).",
  ],
  avoidWhen: [
    "You only have averages or totals, not the individual values. Say them in a sentence or use a chart.",
    "One measure changes over time. Use a line chart.",
    "The question is whether two measures move together. Use a scatter plot.",
    "There are fewer than 5 values. List them.",
  ],
  rules: [
    "Pass one row per individual value from the tool result; never bin, average or round them yourself.",
    "Pick 'histogram' for the shape of one set of 30 or more values, 'box' to compare spread across 2–6 groups, 'dots' for up to about 80 values or when each item matters (names show on hover).",
    "Name the measure in 1–4 words, with format, currency or unit.",
    "Add a marker for the user's own value, a target or a limit, at most 3.",
    "In summary, say what's typical (the median) and how wide the spread is in plain words; outliers are unusual values, not errors.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(distributionChartSchema)`.
 */
export const distributionChartTool = {
  name: "show_distribution",
  description: [
    "Show how the values of one measure are spread, from individual values in a tool result: a histogram, box plots per group, or a dot plot, with the median and middle half, outliers and reference markers.",
    `Use when: ${distributionChartGuidance.useWhen.join(" ")}`,
    `Avoid when: ${distributionChartGuidance.avoidWhen.join(" ")}`,
    `Rules: ${distributionChartGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: distributionChartSchema,
} as const
