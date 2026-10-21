import { z } from "zod"

/**
 * Answer Feedback: the agent's contract.
 *
 * A thumbs up or down under an answer. A thumbs down asks why, from a short
 * closed list, so the next turn gets something typed to act on instead of a
 * bare "unhelpful". Optionally a Regenerate button.
 */

export const feedbackReasonSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .max(28)
    .describe("What was wrong, a few words: 'Too long'."),
})

/** Used when the agent sets no `reasons`. */
export const defaultFeedbackReasons = [
  { id: "inaccurate", label: "Not accurate" },
  { id: "source", label: "Wrong source" },
  { id: "long", label: "Too long" },
  { id: "outdated", label: "Out of date" },
] as const

export const answerFeedbackSchema = z.object({
  answerId: z
    .string()
    .optional()
    .describe("Which answer this rates, e.g. a message id. Echoed in the result."),
  reasons: z
    .array(feedbackReasonSchema)
    .min(2)
    .max(6)
    .optional()
    .describe(
      "Why an answer might be bad, for this kind of answer. Default: not accurate, wrong source, too long, out of date.",
    ),
  regenerate: z
    .boolean()
    .default(false)
    .describe("Also show a Regenerate button."),
})

export type FeedbackReason = z.infer<typeof feedbackReasonSchema>
export type AnswerFeedbackInput = z.input<typeof answerFeedbackSchema>

/** What the component sends back. A closed set of actions. */
export type AnswerFeedbackResult = (
  | { action: "rate"; rating: "up" }
  /** `reasons` are the ids the user ticked; empty when they sent none. */
  | { action: "rate"; rating: "down"; reasons: string[] }
  /** The user wants a new answer to the same question. */
  | { action: "regenerate" }
) & {
  answerId?: string
}

/** Usage guidance the agent reads before choosing this component. */
export const answerFeedbackGuidance = {
  useWhen: [
    "You finished a substantive answer (research, a plan, a recommendation) and want to know how it landed.",
    "The host keeps ratings, or you will use them to improve the next answer in this conversation.",
    "The user asks for a way to say whether your answer was right, or to rate it.",
  ],
  avoidWhen: [
    "The reply is one line, a confirmation, or a chat turn. A rating adds noise.",
    "You are waiting for a decision. Show the approval or question instead.",
    "It would appear under every message. Offer it once per substantive answer.",
  ],
  rules: [
    "Set reasons to what could actually be wrong with this answer (for a sourced answer: wrong source, out of date), not a generic list.",
    "On a down rating, read reasons and fix what was named: shorten, re-check sources, refresh. Don't ask why again.",
    "On 'regenerate', answer the same question afresh, differently from before.",
    "Set regenerate only when a second try is cheap.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(answerFeedbackSchema)`.
 */
export const answerFeedbackTool = {
  name: "rate_answer",
  description: [
    "Ask the user to rate your answer with a thumbs up or down, and for a thumbs down, why, from a short list. Optionally offer Regenerate.",
    `Use when: ${answerFeedbackGuidance.useWhen.join(" ")}`,
    `Avoid when: ${answerFeedbackGuidance.avoidWhen.join(" ")}`,
    `Rules: ${answerFeedbackGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: answerFeedbackSchema,
} as const
