import { z } from "zod";

/**
 * Heatmap: the agent's contract.
 *
 * Intensity across two dimensions: a matrix (day × hour, product × region), a
 * GitHub-style calendar of days, or a cohort retention triangle.
 */

const cellKey = z.union([z.number().int().min(0), z.string()]);

export const heatmapCellSchema = z.object({
  row: cellKey.describe("DATA-BOUND. A label from rows, or its 0-based index."),
  column: cellKey.describe(
    "DATA-BOUND. A label from columns, or its 0-based index.",
  ),
  value: z
    .number()
    .nullable()
    .describe("DATA-BOUND. null means no data for this cell."),
});

export const heatmapDaySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("DATA-BOUND. YYYY-MM-DD."),
  value: z
    .number()
    .nullable()
    .describe("DATA-BOUND. 0 for a day with nothing; null for no data."),
});

export const heatmapScaleSchema = z.object({
  steps: z
    .number()
    .int()
    .min(3)
    .max(7)
    .default(5)
    .describe("Number of shading buckets."),
  min: z
    .number()
    .optional()
    .describe("Fix the low end, e.g. 0 for percentages. Default: the data."),
  max: z
    .number()
    .optional()
    .describe("Fix the high end, e.g. 100 for percentages. Default: the data."),
  diverging: z
    .object({
      midpoint: z
        .number()
        .describe("The neutral value, e.g. 0 for change vs last week."),
    })
    .optional()
    .describe(
      "Shade below and above a midpoint with two inks, for values that can go either way.",
    ),
});

export const heatmapHighlightSchema = z.object({
  row: cellKey.optional().describe("Matrix and cohort: the cell's row."),
  column: cellKey.optional().describe("Matrix and cohort: the cell's column."),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe("Calendar: the day."),
  label: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Callout text, e.g. 'Busiest: Fri 7 PM'. Without a cell, it marks the highest value.",
    ),
});

export const heatmapSchema = z.object({
  title: z.string().describe("e.g. 'When customers order'."),
  description: z
    .string()
    .optional()
    .describe("One line on the data: the period, the source."),
  layout: z
    .enum(["matrix", "calendar", "cohort"])
    .describe(
      "'matrix': rows × columns with any labels. 'calendar': one cell per day, weeks as columns. 'cohort': a retention triangle, cohorts as rows (oldest first) and periods 0…n as columns.",
    ),
  rows: z
    .array(z.string().max(40))
    .max(60)
    .optional()
    .describe(
      "Matrix and cohort: row labels in order, e.g. ['Mon', …] or cohort start dates.",
    ),
  columns: z
    .array(z.string().max(40))
    .max(60)
    .optional()
    .describe(
      "Matrix and cohort: column labels in order. Hours like '7 PM' show as '7p'. Cohort: ['Week 0', 'Week 1', …].",
    ),
  cells: z
    .array(heatmapCellSchema)
    .max(3600)
    .optional()
    .describe(
      "DATA-BOUND. Matrix and cohort values. Matrix cells left out show as no data; cohort cells left out are periods not reached yet.",
    ),
  days: z
    .array(heatmapDaySchema)
    .max(400)
    .optional()
    .describe(
      "DATA-BOUND. Calendar values, one per day across the range. Days left out show as no data.",
    ),
  cohortSizes: z
    .array(z.number().int().min(0))
    .max(60)
    .optional()
    .describe("DATA-BOUND. Cohort: people in each cohort, in row order."),
  format: z
    .enum(["number", "percent", "currency", "duration-min"])
    .default("number")
    .describe(
      "How values read. Percent values are percentages: 34 means 34%. 'duration-min': minutes.",
    ),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for 'currency', e.g. 'USD'."),
  unit: z
    .string()
    .max(24)
    .optional()
    .describe("Plural noun after values in tooltips, e.g. 'orders'."),
  scale: heatmapScaleSchema.optional(),
  highlight: heatmapHighlightSchema
    .optional()
    .describe("One cell to call out with a ring and a label."),
  selectable: z
    .boolean()
    .default(false)
    .describe(
      "The user can choose one cell (or day) and it's sent back to you, e.g. a time slot.",
    ),
  weekStart: z
    .union([z.literal(0), z.literal(1)])
    .default(0)
    .describe("Calendar: 0 starts weeks on Sunday, 1 on Monday."),
});

export type HeatmapCell = z.infer<typeof heatmapCellSchema>;
export type HeatmapDay = z.infer<typeof heatmapDaySchema>;
export type HeatmapScale = z.input<typeof heatmapScaleSchema>;
export type HeatmapHighlight = z.infer<typeof heatmapHighlightSchema>;
export type HeatmapInput = z.input<typeof heatmapSchema>;

/**
 * Sent back when the user chooses a cell (only when selectable). Matrix and
 * cohort return the row and column labels; the calendar returns the date.
 */
export type HeatmapResult =
  | { action: "select"; row: string; column: string }
  | { action: "select"; date: string };

/** Usage guidance the agent reads before choosing this component. */
export const heatmapGuidance = {
  useWhen: [
    "The answer is how a number varies across two dimensions: orders by day and hour, sales by product and region, usage by feature and segment.",
    "Activity per day over weeks or months: commits, workouts, sales days.",
    "Retention by signup cohort over periods.",
    "The user should pick a slot from the pattern, e.g. a time to schedule a campaign.",
  ],
  avoidWhen: [
    "One dimension over time. Use a chart.",
    "Exact values matter more than the pattern, or there are only a few cells. Use a data table.",
    "Values by US state or country. Use the region map.",
  ],
  rules: [
    "Take every value from a tool result; send null for missing data rather than 0.",
    "Matrix: send rows and columns first, then cells. Calendar: one entry per day in the range, 0 for empty days. Cohort: rows oldest first, period 0 first, with cohortSizes.",
    "Set format, currency and unit so values read correctly; percent values are percentages.",
    "Use scale.diverging only for values that go either way around a midpoint, like change vs last week.",
    "Use highlight for the one cell the answer is about; say the same thing in your reply.",
    "Only set selectable when the user's choice changes what you do next.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(heatmapSchema)`.
 */
export const heatmapTool = {
  name: "show_heatmap",
  description: [
    "Show a heatmap: a matrix of two dimensions, a calendar of days, or a cohort retention triangle, shaded by value.",
    `Use when: ${heatmapGuidance.useWhen.join(" ")}`,
    `Avoid when: ${heatmapGuidance.avoidWhen.join(" ")}`,
    `Rules: ${heatmapGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: heatmapSchema,
} as const;
