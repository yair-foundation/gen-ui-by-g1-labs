import { z } from "zod"

/**
 * Assumptions: the agent's contract.
 *
 * The basis of an answer: what the agent assumed, what it doesn't know and
 * what limits the answer. The user can correct any of it, and the agent redoes
 * the work with the corrections.
 */

export const correctionValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
])

export const correctionSchema = z.object({
  type: z
    .enum(["text", "number", "select", "boolean"])
    .describe("The input the user corrects it with."),
  options: z
    .array(z.string())
    .min(2)
    .max(12)
    .optional()
    .describe("Required for 'select'. The choices, in a sensible order."),
  unit: z
    .string()
    .max(16)
    .optional()
    .describe(
      "For 'number': 'adults', '%', '€/night', '£'. A leading currency symbol is placed before the number.",
    ),
  value: correctionValueSchema
    .optional()
    .describe(
      "The value you assumed, matching the type (a number for 'number', one of the options for 'select'). The editor starts from it. Omit for unknowns.",
    ),
})

export const assumptionItemSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  kind: z
    .enum(["assumption", "unknown", "constraint", "data-limit"])
    .describe(
      "'assumption': something you took as given. 'unknown': something you couldn't find out. 'constraint': a limit on what the answer can be. 'data-limit': a gap or cutoff in the data you used.",
    ),
  statement: z
    .string()
    .describe(
      "One plain sentence, e.g. 'Two adults are travelling.' or 'Q3 data ends Sep 28.'",
    ),
  basis: z
    .string()
    .optional()
    .describe(
      "Why you assumed it, e.g. 'From your message on Monday' or 'Industry average'. Shown only while correcting the item.",
    ),
  confidence: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe("How sure you are that it holds."),
  impact: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe("How much the answer changes if it's wrong."),
  correction: correctionSchema
    .optional()
    .describe(
      "How the user can correct it. Omit when it can only be acknowledged.",
    ),
  sourceUrl: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. http(s) link to where the basis came from. Other protocols are not linked.",
    ),
})

export const assumptionsSchema = z.object({
  title: z.string().default("What this is based on"),
  appliesTo: z
    .string()
    .optional()
    .describe(
      "The answer these sit behind, e.g. 'Budget for a week in Lisbon'. Screen readers only.",
    ),
  items: z.array(assumptionItemSchema).min(1).max(12),
})

export type CorrectionValue = z.infer<typeof correctionValueSchema>
export type Correction = z.infer<typeof correctionSchema>
export type AssumptionItem = z.infer<typeof assumptionItemSchema>
export type AssumptionKind = AssumptionItem["kind"]
export type AssumptionsInput = z.input<typeof assumptionsSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type AssumptionsResult =
  /** Redo the work with these corrections. */
  | {
      action: "redo"
      /** Corrected items, with the user's value. */
      corrections: { id: string; value: CorrectionValue }[]
      /** Ids the user marked as right. */
      confirmed: string[]
    }
  /** Everything holds; keep the answer as it is. */
  | { action: "confirm-all" }

/** Usage guidance the agent reads before choosing this component. */
export const assumptionsGuidance = {
  useWhen: [
    "Your answer rests on guesses the user could easily correct: party size, budget, dates, rates, jurisdiction.",
    "Something you needed was missing or cut off, and the user should know before relying on the answer.",
    "A wrong assumption would change the answer a lot, such as an estimate, forecast or recommendation.",
  ],
  avoidWhen: [
    "Nothing was assumed. Don't invent assumptions to look careful.",
    "You need an answer before you can start at all. Ask the question instead.",
    "You want to show the sources or the steps you took. Use citations or an activity trail.",
  ],
  rules: [
    "Show it right after the answer it explains, once per answer.",
    "One plain sentence per item. Put the reason in basis, not in the statement.",
    "Set impact honestly: high only when the answer changes materially if it's wrong.",
    "Add a correction whenever the user could give you the real value; give 'value' the value you assumed.",
    "On 'redo', redo the work with the corrected values and show a new set of assumptions. On 'confirm-all', keep the answer.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(assumptionsSchema)`.
 */
export const assumptionsTool = {
  name: "show_assumptions",
  description: [
    "Show what your answer is based on (assumptions, unknowns and limits) and let the user correct them so you can redo the work.",
    `Use when: ${assumptionsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${assumptionsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${assumptionsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: assumptionsSchema,
} as const
