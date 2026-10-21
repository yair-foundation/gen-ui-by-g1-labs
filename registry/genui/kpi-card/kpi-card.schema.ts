import { z } from "zod";

/**
 * KPI Card: the agent's contract.
 *
 * A compact metric card for business or finance numbers from a connected
 * tool: a headline figure, one visual (stacked segments, dot meters, a
 * treemap or bars), a legend or rows, and a footer total. Optionally keyed by
 * period (Weekly / Monthly / Yearly) with a switch.
 */

/** Percent values are in percent units: 12.5 means 12.5% (see rules). */
export const kpiFormatSchema = z.enum(["currency", "number", "percent"]);

/** ISO 4217. Required for 'currency' (see rules). */
const currencySchema = z.string().length(3).optional();

export const kpiValueSchema = z.object({
  label: z.string().max(40),
  value: z.number(),
  format: kpiFormatSchema,
  currency: currencySchema,
});

export const kpiHeadlineSchema = kpiValueSchema.extend({
  label: z.string().max(40).optional(),
});

export const kpiItemSchema = kpiValueSchema.extend({
  delta: z.number().optional().describe("% change vs the previous period."),
  deltaLabel: z
    .string()
    .max(24)
    .optional()
    .describe("e.g. 'vs last week'. Screen readers only."),
  upIsBad: z
    .boolean()
    .optional()
    .describe(
      "True when an increase is bad for this metric (cost, errors, churn): the delta badge is red going up and green going down.",
    ),
});

export const kpiSegmentsSchema = z.object({
  type: z.literal("segments"),
  parts: z
    .array(
      z.object({
        label: z.string().max(40),
        value: z.number().nonnegative(),
      }),
    )
    .min(1)
    .max(5),
  format: kpiFormatSchema.optional(),
  currency: currencySchema,
});

export const kpiDotsRowSchema = kpiValueSchema.extend({
  filled: z
    .number()
    .int()
    .nonnegative()
    .meta({ maximum: undefined })
    .describe("e.g. 3 of 6 payments made."),
  total: z.number().int().min(1).max(10),
});

export const kpiDotsSchema = z.object({
  type: z.literal("dots"),
  rows: z.array(kpiDotsRowSchema).min(1).max(6),
});

export const kpiTileSchema = z.object({
  label: z.string().max(32),
  share: z.number().min(0).max(100).describe("% of the whole."),
  delta: z.number().optional().describe("% change."),
});

export const kpiTreemapSchema = z.object({
  type: z.literal("treemap"),
  tiles: z.array(kpiTileSchema).min(1).max(10),
});

export const kpiBarsSchema = z.object({
  type: z.literal("bars"),
  bars: z
    .array(
      z.object({
        label: z.string().max(12),
        value: z.number().nonnegative(),
      }),
    )
    .min(2)
    .max(24)
    .describe("In order."),
  highlight: z.string().optional().describe("Label of the bar to emphasize."),
  forecastFrom: z
    .string()
    .optional()
    .describe("Label of the first forecast bar."),
  format: kpiFormatSchema.optional(),
  currency: currencySchema,
});

export const kpiVisualSchema = z.discriminatedUnion("type", [
  kpiSegmentsSchema,
  kpiDotsSchema,
  kpiTreemapSchema,
  kpiBarsSchema,
]);

export const kpiBlockSchema = z.object({
  headline: kpiHeadlineSchema.optional(),
  visual: kpiVisualSchema.optional(),
  items: z.array(kpiItemSchema).max(8).optional(),
  footer: kpiValueSchema.optional(),
});

export const kpiPeriodSchema = z.object({
  key: z
    .string()
    .regex(/^[a-z0-9_-]+$/i)
    .describe("Key into `data`."),
  label: z.string().max(16),
});

export const kpiActionSchema = z.object({
  label: z.string().max(32).describe("Tooltip on the header button."),
  kind: z
    .enum(["open", "details"])
    .describe("open: the source screen. details: the breakdown."),
});

export const kpiCardSchema = z.object({
  title: z.string().max(60),
  periods: z.array(kpiPeriodSchema).min(2).max(4).optional(),
  defaultPeriod: z.string().optional(),
  data: z
    .record(z.string(), kpiBlockSchema)
    .describe(
      "DATA-BOUND (every number). One block per period key, or one under 'default'.",
    ),
  action: kpiActionSchema.optional(),
  locale: z.string().optional().describe("BCP 47. Default 'en-US'."),
});

export type KpiFormat = z.infer<typeof kpiFormatSchema>;
export type KpiValue = z.infer<typeof kpiValueSchema>;
export type KpiHeadline = z.infer<typeof kpiHeadlineSchema>;
export type KpiItem = z.infer<typeof kpiItemSchema>;
export type KpiSegments = z.infer<typeof kpiSegmentsSchema>;
export type KpiDotsRow = z.infer<typeof kpiDotsRowSchema>;
export type KpiDots = z.infer<typeof kpiDotsSchema>;
export type KpiTile = z.infer<typeof kpiTileSchema>;
export type KpiTreemap = z.infer<typeof kpiTreemapSchema>;
export type KpiBars = z.infer<typeof kpiBarsSchema>;
export type KpiVisual = z.infer<typeof kpiVisualSchema>;
export type KpiBlock = z.infer<typeof kpiBlockSchema>;
export type KpiPeriod = z.infer<typeof kpiPeriodSchema>;
export type KpiAction = z.infer<typeof kpiActionSchema>;
export type KpiCardInput = z.input<typeof kpiCardSchema>;

/** Sent back when the user presses the header's arrow button. */
export type KpiCardResult = {
  action: "open" | "details";
  /** The period on screen when they pressed it. */
  period?: string;
};

/** Usage guidance the agent reads before choosing this component. */
export const kpiCardGuidance = {
  useWhen: [
    "The user asks how a business or finance number is tracking, from a connected tool: sales this week, what's left on a loan, where transactions went this month, revenue this year.",
    "One headline figure with a small breakdown answers it at a glance.",
  ],
  avoidWhen: [
    "The user wants to explore a series or compare several over time. Use a chart.",
    "There are many records to read. Use a data table.",
    "It's one personal insight in a sentence. Use an insight card.",
    "The numbers aren't from the user's data. Don't invent them.",
  ],
  rules: [
    "Every number must come from the tool result; totals and shares may be computed from it.",
    "Pick the visual for the question: segments for a split of a total, dots for installments or quotas (N of M), treemap for shares of spend by category, bars for a value per period with one highlighted.",
    "Only add periods when you have data for each; key every block by its period key, or use 'default'.",
    "Keep segments and legend rows in the same order, at most 5; treemap tiles at most 10, shares summing to about 100.",
    "Deltas, shares and 'percent' values are in percent units (12.5 = 12.5%); give deltas a short deltaLabel, e.g. 'vs last week'.",
    "Set currency (ISO 4217) wherever format is 'currency'.",
    "Add the action (a header button) only when the host can open the source data.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(kpiCardSchema)`.
 */
export const kpiCardTool = {
  name: "show_kpis",
  description: [
    "A compact metric card: headline number, one visual (segments, dots, treemap or bars), legend with deltas, footer total; optionally per period.",
    `Use when: ${kpiCardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${kpiCardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${kpiCardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: kpiCardSchema,
} as const;
