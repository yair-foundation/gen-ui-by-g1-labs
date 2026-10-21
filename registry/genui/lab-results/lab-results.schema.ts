import { z } from "zod";

/**
 * Lab Results: the agent's contract.
 *
 * A lab panel (blood test or similar) shown as spectrum bars: each value is
 * placed on the lab's own reference range, with trends from earlier tests.
 * The component never diagnoses or interprets; it places values on ranges.
 */

export const labRangeSchema = z
  .object({
    low: z
      .number()
      .optional()
      .describe("DATA-BOUND. Lower bound of the lab's reference range."),
    high: z
      .number()
      .optional()
      .describe("DATA-BOUND. Upper bound of the lab's reference range."),
    optimalLow: z
      .number()
      .optional()
      .describe(
        "DATA-BOUND. Lower bound of an optimal band, only if the lab prints one.",
      ),
    optimalHigh: z
      .number()
      .optional()
      .describe(
        "DATA-BOUND. Upper bound of an optimal band, only if the lab prints one.",
      ),
    text: z
      .string()
      .max(40)
      .optional()
      .describe(
        "DATA-BOUND. The range as printed, e.g. '< 5.2' or 'Negative'. Shown when there are no numeric bounds.",
      ),
  })
  .describe(
    "DATA-BOUND. The reference range exactly as printed on the lab report. Never supply a range from general knowledge.",
  );

export const labHistoryPointSchema = z.object({
  date: z
    .string()
    .describe("DATA-BOUND. When the earlier test was taken (ISO date)."),
  value: z
    .number()
    .describe("DATA-BOUND. The earlier result, in the same unit."),
});

export const labMarkerSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  name: z.string().describe("Marker name as on the report, e.g. 'Potassium'."),
  abbreviation: z
    .string()
    .max(12)
    .optional()
    .describe("Short form as on the report, e.g. 'K'."),
  value: z.number().describe("DATA-BOUND. The result."),
  unit: z.string().max(16).describe("DATA-BOUND. e.g. 'mmol/L'."),
  range: labRangeSchema,
  flag: z
    .enum(["low", "high", "critical-low", "critical-high"])
    .optional()
    .describe(
      "DATA-BOUND. The flag as printed by the lab. Omit when the lab printed none; the component then computes the position from the range.",
    ),
  history: z
    .array(labHistoryPointSchema)
    .max(12)
    .optional()
    .describe("DATA-BOUND. Earlier results for this marker, up to 12."),
  group: z
    .string()
    .max(40)
    .optional()
    .describe("Section heading as on the report, e.g. 'Electrolytes'."),
  explain: z
    .boolean()
    .optional()
    .describe(
      "Adds a 'What is this?' button that asks you to explain the marker.",
    ),
});

export const labResultsSchema = z.object({
  panel: z
    .string()
    .describe(
      "DATA-BOUND. The panel name, e.g. 'Lipid panel' or 'Complete blood count'.",
    ),
  takenAt: z
    .string()
    .describe("DATA-BOUND. When the sample was taken (ISO date)."),
  lab: z
    .object({ name: z.string() })
    .optional()
    .describe("DATA-BOUND. The lab that ran the test."),
  markers: z.array(labMarkerSchema).min(1).max(30),
  clinicianNote: z
    .string()
    .max(600)
    .optional()
    .describe(
      "DATA-BOUND. A note from the clinician printed on the report, copied verbatim. Never write your own.",
    ),
  source: z
    .object({ label: z.string(), url: z.string().optional() })
    .optional()
    .describe(
      "DATA-BOUND. Where the report came from, e.g. the patient portal.",
    ),
});

export type LabRange = z.infer<typeof labRangeSchema>;
export type LabHistoryPoint = z.infer<typeof labHistoryPointSchema>;
export type LabMarker = z.infer<typeof labMarkerSchema>;
export type LabFlag = NonNullable<LabMarker["flag"]>;
export type LabResultsInput = z.input<typeof labResultsSchema>;

/**
 * Sent back when the user presses "What is this?". A handoff: the card never
 * locks, so the user may ask about several markers.
 */
export type LabResultsResult = { action: "explain"; markerId: string };

/** Usage guidance the agent reads before choosing this component. */
export const labResultsGuidance = {
  useWhen: [
    "The user asks to see lab results you have read from a report or health record: 'Show my blood test results', 'Is my vitamin D low?', 'How has my cholesterol changed?'.",
    "The report gives a reference range for each marker, so values can be placed on it.",
  ],
  avoidWhen: [
    "You have no lab report or record. Never invent values or ranges.",
    "The user asks what a result means for their health or what to do about it. Say you can't interpret results and suggest they discuss them with their clinician.",
    "It's a single reading the user is tracking themselves (weight, blood pressure log). Use Chart or KPI Card.",
  ],
  rules: [
    "Copy values, units, ranges, flags, history and clinicianNote from the report unchanged. Ranges come only from the lab report, never from general knowledge.",
    "Set flag only when the lab printed one; otherwise omit it and let the component compute the position.",
    "Never diagnose, suggest causes or recommend treatment, in the component or around it. Describe positions only: 'within', 'below' or 'above the lab's range'.",
    "Set explain on markers the user is likely to ask about. On 'explain', describe what the marker measures in general terms (the Term Explainer fits), without interpreting the user's value.",
    "Keep group names as printed on the report. Up to 30 markers; split larger reports by panel.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(labResultsSchema)`.
 */
export const labResultsTool = {
  name: "show_lab_results",
  description: [
    "Show lab test results with each value placed on the lab's reference range, flags, and trends from earlier tests.",
    `Use when: ${labResultsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${labResultsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${labResultsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: labResultsSchema,
} as const;
