import { z } from "zod"

/**
 * Autonomy Control: the agent's contract.
 *
 * The user picks how much the agent may do without asking, from a short,
 * ordered set of levels (e.g. Ask every time, Ask for risky actions, Act on
 * its own). Each level says in one line what it means; the selected one
 * expands into what the agent will and won't do at that level.
 */

export const autonomyLevelSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .max(30)
    .describe("Short name, e.g. 'Ask every time', 'Act on its own'."),
  summary: z
    .string()
    .max(70)
    .describe(
      "One line on what the level means, e.g. 'Drafts everything, you send'.",
    ),
  details: z
    .array(z.string().max(90))
    .max(3)
    .optional()
    .describe(
      "Up to three concrete lines shown when the level is selected, e.g. 'Refunds over $50 still need your OK'.",
    ),
})

export const autonomyControlSchema = z.object({
  question: z
    .string()
    .optional()
    .describe("The question this answers, shown above the card."),
  title: z
    .string()
    .max(60)
    .describe("Card heading, e.g. 'How much can I do on my own?'."),
  context: z
    .string()
    .max(100)
    .optional()
    .describe(
      "What the setting applies to, one line, e.g. 'Support inbox, until you change it'.",
    ),
  levels: z
    .array(autonomyLevelSchema)
    .min(2)
    .max(5)
    .describe("The levels, from least to most autonomy."),
  levelId: z
    .string()
    .optional()
    .describe("DATA-BOUND. The level in effect now. Defaults to the first."),
  recommendedId: z
    .string()
    .optional()
    .describe("A level to mark as recommended for this task. Omit if none."),
})

export type AutonomyLevel = z.infer<typeof autonomyLevelSchema>
export type AutonomyControlInput = z.input<typeof autonomyControlSchema>
export type AutonomyControlData = z.output<typeof autonomyControlSchema>

/** Sent when the user saves a level. May be sent again if they change it. */
export type AutonomyControlResult = {
  action: "set"
  /** The id of the chosen level. */
  level: string
}

/** Usage guidance the agent reads before choosing this component. */
export const autonomyControlGuidance = {
  useWhen: [
    "The user wants to change how independently you work: always ask, ask only for risky steps, or act and report.",
    "Before a long or recurring task, to agree how often you should check in.",
  ],
  avoidWhen: [
    "You need access to specific tools or data. Use request_permissions.",
    "You are about to take one specific action. Use an approval request.",
    "There is only one sensible way to work. Say how you'll proceed in text.",
  ],
  rules: [
    "Give two to five levels, least autonomy first, each with a label and a one-line summary.",
    "Use details for concrete consequences at that level (what still needs approval, caps, reports), not for marketing.",
    "Set levelId to the level in effect now, from your settings; recommend at most one level.",
    "After a result, work at the returned level from then on and say so in one line.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(autonomyControlSchema)`.
 */
export const autonomyControlTool = {
  name: "set_autonomy",
  description: [
    "Let the user choose how much the agent may do without asking: an ordered set of levels, each with a one-line meaning, picked like a radio and saved.",
    `Use when: ${autonomyControlGuidance.useWhen.join(" ")}`,
    `Avoid when: ${autonomyControlGuidance.avoidWhen.join(" ")}`,
    `Rules: ${autonomyControlGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: autonomyControlSchema,
} as const
