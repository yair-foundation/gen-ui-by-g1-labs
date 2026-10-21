import { z } from "zod";

/**
 * Insight Card: the agent's contract.
 *
 * One personal insight from the user's own data, stated in a sentence and
 * backed by a tiny purpose-built visual: where the money went, how often they
 * went somewhere, how close they are to a budget.
 */

const formatSchema = z
  .enum(["currency", "number"])
  .optional()
  .describe("How to format values. Default 'number'.");

const currencySchema = z
  .string()
  .length(3)
  .optional()
  .describe("ISO 4217 code, e.g. 'ILS' or 'USD'. Required for 'currency'.");

const daySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("Calendar day, 'YYYY-MM-DD'.");

export const insightBubbleSchema = z.object({
  label: z.string().describe("e.g. a merchant. DATA-BOUND."),
  value: z.number().nonnegative().describe("Sizes the bubble. DATA-BOUND."),
  display: z
    .string()
    .max(16)
    .optional()
    .describe("Pre-formatted value, e.g. '₪210'. Overrides format."),
  other: z
    .boolean()
    .optional()
    .describe("The remainder bucket ('Other'). Drawn muted."),
});

export const insightBubblesSchema = z.object({
  type: z.literal("bubbles"),
  items: z
    .array(insightBubbleSchema)
    .min(1)
    .max(12)
    .describe(
      "One bubble per item, area proportional to value. DATA-BOUND. Put small items in one 'Other' item.",
    ),
  format: formatSchema,
  currency: currencySchema,
});

export const insightMarkedDaySchema = z.object({
  date: daySchema.describe("A day in `month`. DATA-BOUND."),
  value: z
    .number()
    .optional()
    .describe("e.g. the amount spent that day. DATA-BOUND."),
  label: z
    .string()
    .max(40)
    .optional()
    .describe("Shown on hover and focus, e.g. '2 drinks'. DATA-BOUND."),
});

export const insightDotCalendarSchema = z.object({
  type: z.literal("dot-calendar"),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .describe("'YYYY-MM'. One dot per day."),
  weekStart: z
    .union([z.literal(0), z.literal(1)])
    .optional()
    .describe("0 = Sunday (default), 1 = Monday. Match the user's locale."),
  marked: z
    .array(insightMarkedDaySchema)
    .max(31)
    .describe("The days that count, e.g. visits. DATA-BOUND."),
  format: formatSchema,
  currency: currencySchema,
});

export const insightProgressSchema = z.object({
  type: z.literal("progress"),
  value: z.number().nonnegative().describe("So far. DATA-BOUND."),
  target: z.number().positive().describe("The goal or budget. DATA-BOUND."),
  label: z
    .string()
    .optional()
    .describe(
      "What the target is, e.g. 'Grocery budget'. Screen readers only.",
    ),
  format: formatSchema,
  currency: currencySchema,
});

export const insightCompareSchema = z.object({
  type: z.literal("compare"),
  items: z
    .array(
      z.object({
        label: z.string().describe("e.g. 'This month', 'Last month'."),
        value: z.number().nonnegative().describe("DATA-BOUND."),
      }),
    )
    .min(2)
    .max(4)
    .describe("Current period first. DATA-BOUND."),
  format: formatSchema,
  currency: currencySchema,
});

export const insightStreakSchema = z.object({
  type: z.literal("streak"),
  count: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe(
      "The streak length, shown large. Default: consecutive done days ending at the last done one. Set it when the streak began before `days`. DATA-BOUND.",
    ),
  label: z
    .string()
    .max(24)
    .optional()
    .describe(
      "What the streak is, e.g. 'Workout streak'. Screen readers only. Default 'Streak'.",
    ),
  days: z
    .array(z.object({ date: daySchema, done: z.boolean() }))
    .min(2)
    .max(31)
    .describe(
      "Oldest first, usually this week through today; may end with upcoming days (done: false). Shown as weekday initials. DATA-BOUND.",
    ),
});

export const insightSequenceIconSchema = z
  .enum([
    "meal",
    "salad",
    "breakfast",
    "snack",
    "drink",
    "workout",
    "walk",
    "sleep",
    "pill",
    "check",
    "book",
    "water",
  ])
  .describe("A closed set of neutral icons. Default 'check'.");

export const insightSequenceItemSchema = z.object({
  label: z
    .string()
    .max(40)
    .describe("e.g. 'Monday lunch'. Read by screen readers. DATA-BOUND."),
  icon: insightSequenceIconSchema.optional(),
  done: z.boolean().describe("Logged or completed. DATA-BOUND."),
});

export const insightSequenceSchema = z.object({
  type: z.literal("sequence"),
  items: z
    .array(insightSequenceItemSchema)
    .min(1)
    .max(12)
    .describe(
      "The steps toward a milestone, in order: done ones are drawn as icon circles, the rest as small dots. DATA-BOUND.",
    ),
  remainingLabel: z
    .string()
    .max(24)
    .optional()
    .describe("Shown after the dots, e.g. '2 to go'. Default: none."),
});

export const insightVisualSchema = z.discriminatedUnion("type", [
  insightBubblesSchema,
  insightDotCalendarSchema,
  insightProgressSchema,
  insightCompareSchema,
  insightStreakSchema,
  insightSequenceSchema,
]);

export const insightActionSchema = z.object({
  label: z.string().max(32).describe("e.g. 'See spending details'."),
  kind: z
    .enum(["details", "transactions", "open"])
    .describe(
      "What the host opens: the breakdown, the matching transactions, or the related screen. 'open' renders as a round arrow button labelled with `label`.",
    ),
});

export const insightCardSchema = z.object({
  title: z.string().max(60).describe("e.g. 'Clothing this month'."),
  insight: z
    .string()
    .max(240)
    .describe(
      "One or two sentences. Wrap key figures in **double asterisks**. Every number must come from the data.",
    ),
  timestamp: z
    .string()
    .optional()
    .describe(
      "ISO date-time the insight was computed. Shown relative, e.g. 'Yesterday'.",
    ),
  visual: insightVisualSchema,
  action: insightActionSchema
    .optional()
    .describe("A link to the data behind the insight."),
  share: z.boolean().optional().describe("Show a share button. Default false."),
  locale: z
    .string()
    .optional()
    .describe(
      "BCP 47 locale for numbers, dates and weekday names, e.g. 'en-GB'.",
    ),
});

export type InsightBubble = z.infer<typeof insightBubbleSchema>;
export type InsightBubbles = z.infer<typeof insightBubblesSchema>;
export type InsightMarkedDay = z.infer<typeof insightMarkedDaySchema>;
export type InsightDotCalendar = z.infer<typeof insightDotCalendarSchema>;
export type InsightProgress = z.infer<typeof insightProgressSchema>;
export type InsightCompare = z.infer<typeof insightCompareSchema>;
export type InsightStreak = z.infer<typeof insightStreakSchema>;
export type InsightSequenceIcon = z.infer<typeof insightSequenceIconSchema>;
export type InsightSequenceItem = z.infer<typeof insightSequenceItemSchema>;
export type InsightSequence = z.infer<typeof insightSequenceSchema>;
export type InsightVisual = z.infer<typeof insightVisualSchema>;
export type InsightAction = z.infer<typeof insightActionSchema>;
export type InsightCardInput = z.input<typeof insightCardSchema>;

/** Sent back when the user presses the action link or the share button. */
export type InsightCardResult = {
  action: "details" | "transactions" | "open" | "share";
};

/** Usage guidance the agent reads before choosing this component. */
export const insightCardGuidance = {
  useWhen: [
    "You have one personal insight from the user's own data worth a glance: where their money went, how often they went somewhere, how close they are to a budget, a streak, how many steps are left before a milestone.",
    "A tiny visual makes the sentence land faster than numbers alone.",
  ],
  avoidWhen: [
    "The user asked to explore or compare a series over time. Use a chart.",
    "There are many records to read. Use a data table.",
    "The insight isn't backed by the user's data. Don't invent one.",
  ],
  rules: [
    "State one insight, in one or two sentences, and bold the key figures.",
    "Every number in the sentence must come from the visual's data (sums and counts of it are fine).",
    "Pick the visual for the question: bubbles for a split of spend, dot-calendar for visits in a month, progress for a budget or goal, compare for this period vs last, streak for daily habits, sequence for logged steps toward a milestone (meals before a weigh-in, doses, sessions).",
    "For a streak, pass count when it began before the days shown.",
    "Use at most 6 bubbles; fold the long tail into one item with other: true.",
    "Set locale to the user's locale and match weekStart to it.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(insightCardSchema)`.
 */
export const insightCardTool = {
  name: "show_insight",
  description: [
    "Show one personal insight from the user's data as a sentence with a tiny visual (bubbles, dot calendar, progress, compare, streak or sequence).",
    `Use when: ${insightCardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${insightCardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${insightCardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: insightCardSchema,
} as const;
