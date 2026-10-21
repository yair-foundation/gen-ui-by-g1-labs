import { z } from "zod"

/**
 * Chart: the agent's contract.
 *
 * A line, bar or area chart of numbers the agent pulled from a tool, with an
 * accessible data table behind it.
 */

export const chartAxisSchema = z.object({
  key: z
    .string()
    .describe("Field in each data row that holds the x value, e.g. 'week'."),
  label: z
    .string()
    .optional()
    .describe(
      "Axis name, e.g. 'Week'. Screen readers only (data table header).",
    ),
  format: z
    .enum(["date", "text"])
    .default("text")
    .describe("'date' takes ISO dates ('2026-09-14') and formats them."),
})

export const chartSeriesSchema = z.object({
  key: z
    .string()
    .describe("Field in each data row that holds this series' value."),
  label: z.string().describe("Series name, e.g. 'Signups'."),
  format: z
    .enum(["number", "currency", "percent"])
    .default("number")
    .describe("'percent' takes 12.5 to mean 12.5%."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for 'currency', e.g. 'EUR'."),
})

export const chartAnnotationSchema = z.object({
  x: z
    .union([z.string(), z.number()])
    .describe("An x value that exists in the data."),
  label: z.string().max(32).describe("e.g. 'Release 4.12'."),
})

export const chartSchema = z.object({
  title: z.string().describe("What the chart shows, e.g. 'Weekly signups'."),
  description: z
    .string()
    .optional()
    .describe("Scope or source, e.g. 'Last 12 weeks, all plans'."),
  type: z
    .enum(["line", "bar", "area"])
    .describe(
      "'line' for change over time, 'bar' to compare categories, 'area' for volumes over time.",
    ),
  stacked: z
    .boolean()
    .optional()
    .describe(
      "Bar only. Stack the series into one bar per x value, split into one piece per series; hovering a piece highlights it and shows its share of the bar. Use when the series are parts of a whole (revenue by product line per region), not when they are separate measures to compare.",
    ),
  x: chartAxisSchema,
  series: z
    .array(chartSeriesSchema)
    .min(1)
    .max(4)
    .describe("1–4 series. They share one y-axis, so use one unit."),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(1)
    .max(500)
    .describe(
      "DATA-BOUND. Rows from a tool result, each with the x key and every series key.",
    ),
  annotations: z
    .array(chartAnnotationSchema)
    .max(5)
    .optional()
    .describe("Events worth marking on the x-axis, e.g. a release."),
  summary: z
    .string()
    .optional()
    .describe("One sentence on what the chart shows, shown under it."),
})

export type ChartAxis = z.infer<typeof chartAxisSchema>
export type ChartSeries = z.infer<typeof chartSeriesSchema>
export type ChartAnnotation = z.infer<typeof chartAnnotationSchema>
export type ChartInput = z.input<typeof chartSchema>

/** Usage guidance the agent reads before choosing this component. */
export const chartGuidance = {
  useWhen: [
    "The user asks how a number changed over time or how categories compare, and you have the figures from a tool.",
    "The shape matters more than any single value: a trend, a spike, a gap between two series.",
  ],
  avoidWhen: [
    "There is one number or two. Say them in a sentence.",
    "The user needs exact values for many fields. Use a data table.",
    "You don't have the data from a tool. Never invent or estimate points.",
    "The series use different units. Show two charts instead of mixing them on one axis.",
  ],
  rules: [
    "Copy data from the tool result unchanged; don't round, fill gaps or extrapolate.",
    "Use 'line' for trends, 'bar' for comparing categories, 'area' for volumes over time.",
    "Set stacked: true on a bar chart only when the series add up to a meaningful total (parts of a whole); otherwise leave bars side by side.",
    "Keep to 1–4 series that share a unit.",
    "Only annotate real events that explain the shape, and use an x value from the data.",
    "Put the takeaway in summary in plain words, without repeating every number.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(chartSchema)`.
 */
export const chartTool = {
  name: "show_chart",
  description: [
    "Show a line, bar (side by side or stacked into pieces) or area chart of figures from a tool result, with optional event markers.",
    `Use when: ${chartGuidance.useWhen.join(" ")}`,
    `Avoid when: ${chartGuidance.avoidWhen.join(" ")}`,
    `Rules: ${chartGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: chartSchema,
} as const
