import { z } from "zod"

/**
 * Follow-up Chips: the agent's contract.
 *
 * Suggested next steps the user can send with one tap, shown after an answer.
 */

export const followUpSuggestionSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .max(80)
    .describe(
      "What the user would say, in their voice: 'Adjust for 5 guests', not 'Would you like me to adjust…?'",
    ),
  prompt: z
    .string()
    .optional()
    .describe(
      "Full message sent when tapped, if it should say more than the label.",
    ),
})

export const followUpChipsSchema = z.object({
  label: z
    .string()
    .optional()
    .describe("Optional lead-in, e.g. 'If you want, I can:' or 'Related'."),
  suggestions: z.array(followUpSuggestionSchema).min(1).max(4),
  layout: z
    .enum(["chips", "list"])
    .default("chips")
    .describe(
      "'chips' for short actions. 'list' for longer, question-like suggestions.",
    ),
})

export type FollowUpSuggestion = z.infer<typeof followUpSuggestionSchema>
export type FollowUpChipsInput = z.input<typeof followUpChipsSchema>
export type FollowUpChipsData = z.output<typeof followUpChipsSchema>

/**
 * What the component sends back. Treat `prompt` as the user's next message.
 * Ignoring the chips is also an answer: the user just types.
 */
export type FollowUpChipsResult = {
  action: "select"
  id: string
  prompt: string
}

/** Usage guidance the agent reads before choosing this component. */
export const followUpChipsGuidance = {
  useWhen: [
    "You finished an answer or a task and there are 2–4 likely, specific next steps.",
    "The user may not know a useful thing you can do next, e.g. adjusting a plan or exporting results.",
  ],
  avoidWhen: [
    "The user already said what they want next.",
    "The only suggestions are filler, like 'Tell me more' or 'Anything else?'.",
    "You need an answer before you can continue. Use a question stepper.",
    "In the middle of a task that is waiting for approval. Finish that first.",
  ],
  rules: [
    "Write each label as the user's own request, under 60 characters.",
    "Make every suggestion specific to this conversation, and something you can actually do.",
    "Never repeat what you just did, and never offer more than 4.",
    "Treat the selected prompt exactly as if the user had typed it.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(followUpChipsSchema)`.
 */
export const followUpChipsTool = {
  name: "suggest_follow_ups",
  description: [
    "Offer the user up to 4 one-tap next steps after your answer.",
    `Use when: ${followUpChipsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${followUpChipsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${followUpChipsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: followUpChipsSchema,
} as const
