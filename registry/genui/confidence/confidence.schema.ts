import { z } from "zod"

/**
 * Confidence: the agent's contract.
 *
 * An answer or claim with how sure the agent is: a level and a short reason,
 * the evidence for and against, and what would change its mind. The user can
 * ask the agent to verify (dig deeper) or accept the answer as it stands.
 * Fields marked DATA-BOUND must come from a tool result or the user, never be
 * invented.
 */

/** Models often write booleans as strings; accept them. */
const looseBoolean = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
)

export const confidenceLevelSchema = z
  .enum(["low", "medium", "high"])
  .describe(
    "high: several independent sources agree. medium: likely, with a gap or a stale source. low: a hypothesis on thin evidence.",
  )

export const confidenceEvidenceSchema = z.object({
  id: z.string().describe("Stable identifier."),
  stance: z
    .enum(["for", "against"])
    .describe("'for' supports the claim; 'against' cuts against it."),
  text: z
    .string()
    .max(160)
    .describe(
      "One plain sentence, e.g. 'Usage fell 40% in the week after the price change.'",
    ),
  source: z
    .string()
    .max(60)
    .optional()
    .describe(
      "DATA-BOUND. Where it came from, e.g. 'Billing export, 9:40'. Shown as a quiet line under the text.",
    ),
  url: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. http(s) link to the source. Other protocols are not linked.",
    ),
})

export const confidenceSchema = z.object({
  question: z
    .string()
    .optional()
    .describe("The question this answers, shown above the card."),
  claim: z
    .string()
    .max(400)
    .describe(
      "The answer itself, in one to three sentences. Hedge in proportion to the level.",
    ),
  level: confidenceLevelSchema,
  score: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe(
      "DATA-BOUND. A percentage only if a tool or calibrated model produced it. Omit rather than guess; the level is enough.",
    ),
  reason: z
    .string()
    .max(120)
    .describe(
      "Why this level, in one short line, e.g. '3 sources agree' or '2 sources, 1 stale'. Shown next to the level.",
    ),
  hedges: z
    .array(z.string().max(30))
    .max(4)
    .optional()
    .describe(
      "Words in the claim that carry the uncertainty, e.g. 'appears', 'may'. Each must appear verbatim in claim; they are underlined.",
    ),
  evidence: z
    .array(confidenceEvidenceSchema)
    .max(8)
    .optional()
    .describe(
      "The evidence for and against, strongest first. Shown behind an 'Evidence' disclosure (open by default when level is low).",
    ),
  changeMind: z
    .array(z.string().max(120))
    .max(4)
    .optional()
    .describe(
      "What would change your mind, e.g. 'Analytics from the last 6 hours showing normal usage.' Shown inside the disclosure.",
    ),
  verifyLabel: z
    .string()
    .max(28)
    .optional()
    .describe(
      "Label for the verify button, naming how you'd check, e.g. 'Check live data'. Default 'Verify'.",
    ),
  canVerify: looseBoolean
    .optional()
    .describe(
      "false when there is nothing more you could check. Then only Accept is offered. Default true.",
    ),
})

export type ConfidenceLevel = z.infer<typeof confidenceLevelSchema>
export type ConfidenceEvidence = z.infer<typeof confidenceEvidenceSchema>
export type ConfidenceInput = z.input<typeof confidenceSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type ConfidenceResult =
  /** Dig deeper: check the claim against more or fresher sources. */
  | { action: "verify" }
  /** The user takes the answer as it stands. */
  | { action: "accept" }

/** Usage guidance the agent reads before choosing this component. */
export const confidenceGuidance = {
  useWhen: [
    "The user will act on a claim you are not fully sure of: a cause, a diagnosis, a figure pieced together from several sources.",
    "Your sources disagree, are stale or thin, and the user should see that before relying on the answer.",
    "You could check further (fresher data, another source) but it costs time, so the user should decide.",
  ],
  avoidWhen: [
    "The answer is a plain fact you are sure of. Just answer.",
    "The uncertainty is in guesses the user could correct (party size, budget). Use assumptions.",
    "You want to list where each sentence came from. Use citations.",
  ],
  rules: [
    "Set level honestly from the evidence, and hedge the claim to match: no hedges at high, a hedge word at medium and low.",
    "Keep reason to one short line; put the detail in evidence.",
    "Include evidence against whenever it exists. Never invent sources; source and url come from tool results.",
    "Give changeMind as concrete checks, especially at low and medium.",
    "On 'verify', check further and show a new confidence card with the updated level. On 'accept', continue with the answer.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(confidenceSchema)`.
 */
export const confidenceTool = {
  name: "show_confidence",
  description: [
    "Show an answer with how sure you are (level and a short reason), the evidence for and against, and what would change your mind. The user can ask you to verify or accept it.",
    `Use when: ${confidenceGuidance.useWhen.join(" ")}`,
    `Avoid when: ${confidenceGuidance.avoidWhen.join(" ")}`,
    `Rules: ${confidenceGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: confidenceSchema,
} as const
