import { z } from "zod"

/**
 * Usage chart: the agent's contract.
 *
 * One metered quantity over a run of days (tokens, energy, data, spend), as a
 * stepped area, optionally with the part of it that was cached, free or
 * otherwise special drawn over it. Dragging across the chart re-adds the
 * figures underneath for the period up to that day, so "how much so far?" is
 * answered by the card, never by the agent's arithmetic.
 */

export const usageValueSchema = z.object({
  key: z.string().describe("Field in each data row that holds the value."),
  label: z
    .string()
    .max(24)
    .describe("1–2 words, e.g. 'Tokens' or 'Cached'. Shown in the legend and the hover card."),
  format: z
    .enum(["number", "currency"])
    .default("number")
    .describe("Large numbers are abbreviated (5.65M, 511.2K)."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for 'currency', e.g. 'USD'."),
  unit: z
    .string()
    .max(12)
    .optional()
    .describe("Shown after the value, e.g. 'kWh'. Leave out when the label already says it."),
})

export const usageStatSchema = z.object({
  label: z.string().max(24).describe("1–3 words, e.g. 'Total usage' or 'Est. cost'."),
  key: z
    .string()
    .describe("Field in each data row to summarize. May differ from the plotted fields (a cost column)."),
  op: z
    .enum(["sum", "average", "max", "min", "latest"])
    .describe(
      "How the days from the start up to the scrubbed day combine: 'sum' for totals and costs, 'average' for daily rates, 'max'/'min' for extremes, 'latest' for a level at that day.",
    ),
  format: z.enum(["number", "currency"]).default("number"),
  currency: z.string().length(3).optional().describe("ISO 4217 code for 'currency'."),
  unit: z.string().max(12).optional(),
})

export const usageChartSchema = z.object({
  title: z.string().describe("What is metered, e.g. 'Token usage'."),
  dateKey: z
    .string()
    .describe("Field in each data row that holds its ISO date, e.g. '2026-09-22'. One row per day."),
  value: usageValueSchema.describe("The plotted quantity, drawn as the grey stepped area."),
  overlay: usageValueSchema
    .optional()
    .describe(
      "A part of the plotted quantity (the cached share of tokens), drawn in blue on the same scale. Its value never exceeds the main one; a day without it may be left out of the row.",
    ),
  stats: z
    .array(usageStatSchema)
    .min(1)
    .max(3)
    .describe("1–3 figures under the chart, recalculated for the period up to the scrubbed day."),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(2)
    .max(400)
    .describe(
      "DATA-BOUND. One row per day from a tool result, each with the date key, the value key, and the overlay and stat keys when used. Copy unchanged; never fill gaps or total anything yourself.",
    ),
  summary: z
    .string()
    .optional()
    .describe("One sentence on what the usage shows, shown under the card's figures."),
})

export type UsageValue = z.infer<typeof usageValueSchema>
export type UsageStat = z.infer<typeof usageStatSchema>
export type UsageChartInput = z.input<typeof usageChartSchema>

/** Usage guidance the agent reads before choosing this component. */
export const usageChartGuidance = {
  useWhen: [
    "The user asks how much of something they've used over a period (API tokens, energy, data, minutes, spend) and you have it per day from a tool.",
    "The answer is a running picture: the shape of the days and what the period adds up to, with the chance to check any point in between.",
  ],
  avoidWhen: [
    "The user wants a trend of a rate or a score, or compares categories. Use a Chart.",
    "You have one total, not days. Say it in a sentence or use a KPI card.",
    "The figures are a forecast or an estimate you made. Only show what the tool returned.",
    "There are fewer than 2 days.",
  ],
  rules: [
    "Pass one row per day exactly as the tool returned them, in any order; never total, average or fill gaps yourself.",
    "Plot the one quantity the user asked about. Add an overlay only for a true part of it (cached of total), never a different measure.",
    "Pick 1–3 stats the user would ask next. The card recalculates them as they scrub; use 'sum' for totals and costs, 'average' for daily rates.",
    "Name the value in 1–2 words, with format, currency or unit.",
    "In summary, say what stands out (the busiest day, a jump) in plain words.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(usageChartSchema)`.
 */
export const usageChartTool = {
  name: "show_usage",
  description: [
    "Show one metered quantity per day from a tool result as a stepped area, with an optional cached or partial share over it, and figures underneath that recalculate for the period up to any day the user drags across.",
    `Use when: ${usageChartGuidance.useWhen.join(" ")}`,
    `Avoid when: ${usageChartGuidance.avoidWhen.join(" ")}`,
    `Rules: ${usageChartGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: usageChartSchema,
} as const
