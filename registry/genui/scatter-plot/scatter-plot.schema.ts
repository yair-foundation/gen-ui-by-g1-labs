import { z } from "zod"

/**
 * Scatter plot: the agent's contract.
 *
 * Two measures plotted against each other, one point per row, to show whether
 * they move together. A third measure can size the points (a bubble chart),
 * and a category can group them.
 */

export const scatterMeasureSchema = z.object({
  key: z
    .string()
    .describe("Field in each data row that holds this measure."),
  label: z
    .string()
    .max(32)
    .describe("Axis title, 1–4 words, e.g. 'Ad spend'. Shown on the chart."),
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
    .describe("Shown after values, e.g. 'hours'. Not for currency or percent."),
})

export const scatterPlotSchema = z.object({
  title: z
    .string()
    .describe("The question the chart answers, e.g. 'Ad spend vs signups'."),
  description: z
    .string()
    .optional()
    .describe("Scope or source, e.g. '24 campaigns, last quarter'."),
  x: scatterMeasureSchema.describe(
    "Horizontal axis: the measure you suspect drives the other.",
  ),
  y: scatterMeasureSchema.describe("Vertical axis: the measure that responds."),
  size: scatterMeasureSchema
    .optional()
    .describe(
      "A third measure sizing each point (makes it a bubble chart), e.g. 'Units sold'. Only when it adds to the question.",
    ),
  name: z
    .string()
    .optional()
    .describe(
      "Field naming each point, e.g. 'campaign'. Shown on hover and used by highlight.",
    ),
  group: z
    .object({
      key: z.string().describe("Field holding each point's group."),
      label: z
        .string()
        .max(24)
        .optional()
        .describe("What the groups are, e.g. 'Channel'."),
    })
    .optional()
    .describe(
      "Category that splits the points, e.g. channel. Up to 3 groups get their own colour; more fold into 'Other'.",
    ),
  highlight: z
    .array(z.string())
    .max(5)
    .optional()
    .describe(
      "Names (values of the name field) of up to 5 points worth labelling on the chart: outliers or the user's own item.",
    ),
  trend: z
    .boolean()
    .optional()
    .describe(
      "Draw a straight best-fit line and show how strongly the measures move together. Only when that relationship is the question, with 5 or more points.",
    ),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(3)
    .max(500)
    .describe(
      "DATA-BOUND. Rows from a tool result, each with the x and y keys (and the size, name and group keys when used).",
    ),
  summary: z
    .string()
    .optional()
    .describe("One sentence on what the pattern shows, shown under the chart."),
})

export type ScatterMeasure = z.infer<typeof scatterMeasureSchema>
export type ScatterPlotInput = z.input<typeof scatterPlotSchema>

/** Usage guidance the agent reads before choosing this component. */
export const scatterPlotGuidance = {
  useWhen: [
    "The user asks whether two measures are related: does spend drive signups, are pricier products rated higher, do longer calls close more deals.",
    "The user wants to spot outliers or clusters across many items measured two ways.",
  ],
  avoidWhen: [
    "One measure changes over time. Use a line chart.",
    "You compare a few categories on one measure. Use a bar chart.",
    "There are fewer than 5 items. Compare them in a table or a sentence.",
    "You don't have the figures from a tool. Never invent or estimate points.",
  ],
  rules: [
    "Copy data from the tool result unchanged; one row per item.",
    "Put the measure you think drives the other on x, the one that responds on y.",
    "Name both axes in 1–4 words, with format, currency or unit so values read correctly.",
    "Add size only for a third measure that matters to the question (a bubble chart); never to decorate.",
    "Group by a category only when it explains the pattern; at most 3 groups.",
    "Set trend only when the relationship is the question and there are 5 or more points. Correlation is not cause: say 'move together', not 'causes'.",
    "Highlight at most 5 points by name (outliers, the user's own item), and say why in summary.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(scatterPlotSchema)`.
 */
export const scatterPlotTool = {
  name: "show_scatter",
  description: [
    "Show a scatter plot of two measures from a tool result, one point per item, optionally sized by a third measure (bubble chart), grouped by a category, with a trend line and labelled highlights.",
    `Use when: ${scatterPlotGuidance.useWhen.join(" ")}`,
    `Avoid when: ${scatterPlotGuidance.avoidWhen.join(" ")}`,
    `Rules: ${scatterPlotGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: scatterPlotSchema,
} as const
