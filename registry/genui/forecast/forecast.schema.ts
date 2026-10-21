import { z } from "zod";

/**
 * Forecast: the agent's contract.
 *
 * A projection of one metric into the future with honest uncertainty: the
 * actuals, the forecast median, the ranges around it, and when it crosses a
 * goal or a limit. Every number comes from a forecasting tool; the agent never
 * extrapolates by itself.
 */

const isoDate = z
  .string()
  .describe("ISO date ('2026-10-01') or date-time. One period per point.");

export const forecastMetricSchema = z.object({
  label: z.string().describe("What is measured, e.g. 'Monthly revenue'."),
  format: z
    .enum(["currency", "number", "percent"])
    .default("number")
    .describe("'percent' values are in points: 12.5 means 12.5%."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code when format is 'currency', e.g. 'USD'."),
  unit: z
    .string()
    .max(16)
    .optional()
    .describe("Plural unit shown after numbers, e.g. 'tickets'."),
});

export const forecastHistoryPointSchema = z.object({
  t: isoDate,
  value: z.number(),
});

export const forecastPointSchema = z.object({
  t: isoDate,
  p50: z.number().describe("The median: half of outcomes fall below it."),
  p10: z.number().optional().describe("Low end of the 80% range."),
  p90: z.number().optional().describe("High end of the 80% range."),
  p25: z.number().optional().describe("Low end of the 50% range."),
  p75: z.number().optional().describe("High end of the 50% range."),
});

export const forecastScenarioSchema = z.object({
  id: z.string(),
  label: z.string().describe("e.g. 'Base', 'Hiring freeze', 'Raise in Q2'."),
  points: z.array(forecastHistoryPointSchema).min(1).max(200),
  note: z
    .string()
    .optional()
    .describe(
      "One short line on what the scenario changes. Screen readers only.",
    ),
});

export const forecastTargetSchema = z.object({
  value: z.number(),
  label: z.string().describe("e.g. 'Goal $1.2M'."),
  by: isoDate.optional().describe("Deadline for the goal, if any."),
});

export const forecastThresholdSchema = z.object({
  value: z.number(),
  label: z.string().describe("What crossing means, e.g. 'Runway ends'."),
  direction: z
    .enum(["below", "above"])
    .describe("Crossing happens when the metric goes below or above value."),
});

export const forecastDriverSchema = z.object({
  label: z.string().describe("e.g. 'Holiday season'."),
  effect: z.enum(["up", "down"]).describe("Which way it moves the forecast."),
  note: z.string().optional().describe("One line of evidence."),
});

export const forecastSchema = z.object({
  title: z.string().describe("e.g. 'Revenue forecast, Q4 2026'."),
  metric: forecastMetricSchema,
  granularity: z
    .enum(["day", "week", "month", "quarter", "year"])
    .describe("The period each point covers. Drives the date labels."),
  history: z
    .array(forecastHistoryPointSchema)
    .min(1)
    .max(500)
    .describe("DATA-BOUND. Actual values, oldest first."),
  forecast: z
    .array(forecastPointSchema)
    .min(1)
    .max(200)
    .describe(
      "DATA-BOUND. The model's output for the periods after the last actual: the median plus the quantiles the model returned. Never invent or widen bands.",
    ),
  scenarios: z
    .array(forecastScenarioSchema)
    .max(3)
    .optional()
    .describe(
      "DATA-BOUND. Alternate runs of the model, shown as lines behind a toggle.",
    ),
  target: forecastTargetSchema
    .optional()
    .describe("A goal line. The component marks when the median reaches it."),
  threshold: forecastThresholdSchema
    .optional()
    .describe(
      "A limit line. The component marks when the median crosses it, with the range from the bands.",
    ),
  drivers: z
    .array(forecastDriverSchema)
    .max(5)
    .optional()
    .describe(
      "DATA-BOUND. What moves the forecast, from the model or source. In the collapsed details.",
    ),
  method: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. How it was made, e.g. 'Seasonal model on 24 months of data'. In the collapsed details.",
    ),
  accuracy: z
    .object({
      label: z
        .string()
        .describe("e.g. 'Last quarter's forecast was within 4%'."),
      mape: z
        .number()
        .min(0)
        .optional()
        .describe("Mean absolute percentage error, in points."),
    })
    .optional()
    .describe(
      "DATA-BOUND. How well past forecasts held up. In the collapsed details.",
    ),
  assumptionsNote: z
    .string()
    .max(200)
    .optional()
    .describe(
      "One sentence. In the collapsed details. List deeper assumptions in the Assumptions component instead.",
    ),
  asOf: z.string().describe("DATA-BOUND. When the forecast was run (ISO)."),
  source: z
    .object({ label: z.string(), url: z.string().optional() })
    .optional()
    .describe("DATA-BOUND. Where the data and model came from."),
  actions: z
    .array(z.enum(["adjust", "alert"]))
    .max(2)
    .optional()
    .describe(
      "'adjust' adds 'Change assumptions'; 'alert' adds 'Set an alert' for the threshold. Omit for a display-only forecast.",
    ),
});

export type ForecastMetric = z.input<typeof forecastMetricSchema>;
export type ForecastHistoryPoint = z.infer<typeof forecastHistoryPointSchema>;
export type ForecastPoint = z.infer<typeof forecastPointSchema>;
export type ForecastScenario = z.infer<typeof forecastScenarioSchema>;
export type ForecastTarget = z.infer<typeof forecastTargetSchema>;
export type ForecastThreshold = z.infer<typeof forecastThresholdSchema>;
export type ForecastDriver = z.infer<typeof forecastDriverSchema>;
export type ForecastInput = z.input<typeof forecastSchema>;

/**
 * Sent back when the user presses an action. A handoff: the forecast never
 * locks, so the user may send several.
 */
export type ForecastResult =
  /** Show the assumptions or preference controls so the user can change them. */
  | { action: "adjust" }
  /** Set up an alert for when the metric crosses the threshold value. */
  | { action: "alert"; value: number };

/** Usage guidance the agent reads before choosing this component. */
export const forecastGuidance = {
  useWhen: [
    "The user asks where a business or personal metric is heading: next quarter's revenue, when the runway ends, expected ticket volume, whether a savings goal will be met.",
    "A forecasting tool returned the history and the model's median, ideally with quantile bands.",
  ],
  avoidWhen: [
    "You have no forecasting tool result. Never extrapolate a trend yourself or invent bands.",
    "The user wants to try what-if inputs themselves. Use Simulation.",
    "It's a weather forecast. Use Weather.",
    "The user only asks about the past. Use Chart.",
  ],
  rules: [
    "Copy history, forecast, scenarios, drivers, method and accuracy from the tool result unchanged.",
    "Pass the quantiles the model returned (p10/p90 for the 80% range, p25/p75 for the 50% range); omit them when it returned none rather than guessing.",
    "Use threshold for limits the user fears crossing (cash at 0, capacity) and target for goals; the component computes the crossing date.",
    "Keep assumptionsNote to one sentence. If assumptions matter to the answer, follow with the Assumptions component.",
    "On 'adjust', show the Assumptions or Preference Controls component; on 'alert', confirm the alert before creating it. Re-run the forecast after changes.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(forecastSchema)`.
 */
export const forecastTool = {
  name: "show_forecast",
  description: [
    "Show a forecast of one metric: actuals, the median projection with uncertainty bands, scenarios, and when it reaches a goal or crosses a limit.",
    `Use when: ${forecastGuidance.useWhen.join(" ")}`,
    `Avoid when: ${forecastGuidance.avoidWhen.join(" ")}`,
    `Rules: ${forecastGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: forecastSchema,
} as const;
