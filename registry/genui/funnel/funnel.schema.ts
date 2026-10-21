import { z } from "zod";

/**
 * Funnel: the agent's contract.
 *
 * A conversion funnel from analytics: how many people reach each step and
 * where they drop off, optionally against the previous period or split by
 * segment. Fields marked DATA-BOUND must come from a tool result.
 */

export const funnelStepSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in drill-down results."),
  label: z
    .string()
    .max(40)
    .describe("The step, e.g. 'Added to cart'. DATA-BOUND."),
  count: z
    .number()
    .int()
    .nonnegative()
    .describe("People who reached this step. DATA-BOUND."),
  previous: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("The same step's count in the comparison period. DATA-BOUND."),
});

export const funnelPeriodSchema = z.object({
  label: z.string().max(32).describe("The period shown, e.g. 'Oct 1–7'."),
  compareLabel: z
    .string()
    .max(32)
    .optional()
    .describe("The period `previous` is from, e.g. 'Sep 24–30'."),
});

export const funnelSegmentSchema = z.object({
  id: z.string().describe("Returned in drill-down results."),
  label: z.string().max(24).describe("e.g. 'Mobile'. DATA-BOUND."),
  counts: z
    .array(z.number().int().nonnegative())
    .min(2)
    .max(8)
    .describe("One count per step, in the same order as `steps`. DATA-BOUND."),
});

export const funnelValueSchema = z.object({
  perConversion: z
    .number()
    .positive()
    .optional()
    .describe(
      "Average value of one conversion at the last step, e.g. revenue per purchase. DATA-BOUND.",
    ),
  currency: z.string().length(3).describe("ISO 4217 code, e.g. 'USD'."),
});

export const funnelSourceSchema = z.object({
  label: z.string().max(60).describe("e.g. 'Store analytics'."),
  url: z.string().optional().describe("http(s) link to the report."),
});

export const funnelActionSchema = z.enum(["drill-down", "export"]);

export const funnelSchema = z.object({
  title: z.string().max(60).describe("e.g. 'Checkout funnel'."),
  steps: z
    .array(funnelStepSchema)
    .min(2)
    .max(8)
    .describe("In funnel order, first step first. DATA-BOUND."),
  period: funnelPeriodSchema.optional(),
  segments: z
    .array(funnelSegmentSchema)
    .max(4)
    .optional()
    .describe(
      "Splits of the same funnel, e.g. Mobile and Desktop. Adds a switch and a Compare view. DATA-BOUND.",
    ),
  value: funnelValueSchema
    .optional()
    .describe("Sizes the opportunity at the biggest drop."),
  insight: z
    .string()
    .max(200)
    .optional()
    .describe(
      "One sentence grounded in the numbers, e.g. 'Most of the drop is at checkout: 58% leave after starting it'.",
    ),
  source: funnelSourceSchema
    .optional()
    .describe("DATA-BOUND. Where the numbers came from."),
  asOf: z
    .string()
    .optional()
    .describe("DATA-BOUND. ISO date or date-time the data was pulled."),
  actions: z
    .array(funnelActionSchema)
    .max(2)
    .optional()
    .describe(
      "'drill-down' adds 'Drill into {step}' per step; 'export' adds 'Export CSV'. Omit for display only.",
    ),
});

export type FunnelStep = z.infer<typeof funnelStepSchema>;
export type FunnelPeriod = z.infer<typeof funnelPeriodSchema>;
export type FunnelSegment = z.infer<typeof funnelSegmentSchema>;
export type FunnelValue = z.infer<typeof funnelValueSchema>;
export type FunnelSource = z.infer<typeof funnelSourceSchema>;
export type FunnelAction = z.infer<typeof funnelActionSchema>;
export type FunnelInput = z.input<typeof funnelSchema>;

/** Sent back each time the user drills into a step or exports. */
export type FunnelResult =
  | {
      action: "drill-down";
      stepId: string;
      /** The segment on screen, when one is selected. */
      segmentId?: string;
    }
  | { action: "export" };

/** Usage guidance the agent reads before choosing this component. */
export const funnelGuidance = {
  useWhen: [
    "The user asks how a multi-step flow converts or where people drop off: checkout, signup, onboarding, a trial-to-paid path.",
    "You have per-step counts from analytics, optionally for a previous period or by segment (device, channel, plan).",
  ],
  avoidWhen: [
    "The steps aren't sequential, or people can enter at any step. Use a chart or a table.",
    "The question is about one number over time. Use a KPI card or a chart.",
    "You don't have real counts. Don't invent or estimate them.",
  ],
  rules: [
    "Every count must come from the tool result, in funnel order; percentages and drops are computed by the component.",
    "Set `previous` per step only when you have the same steps for the comparison period, and name it in period.compareLabel.",
    "Give segments the same steps in the same order; at most 4.",
    "Add value.perConversion only when you know the real value of one conversion; the card states its 5% recovery assumption.",
    "Keep the insight to one sentence that names the step and a number from the data.",
    "Drill-down and export are the user's requests, not actions you've taken: fetch the step's detail when asked.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(funnelSchema)`.
 */
export const funnelTool = {
  name: "show_funnel",
  description: [
    "Show a conversion funnel: people per step, drop-off between steps, the biggest drop, overall conversion vs the previous period, and optional segments.",
    `Use when: ${funnelGuidance.useWhen.join(" ")}`,
    `Avoid when: ${funnelGuidance.avoidWhen.join(" ")}`,
    `Rules: ${funnelGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: funnelSchema,
} as const;
