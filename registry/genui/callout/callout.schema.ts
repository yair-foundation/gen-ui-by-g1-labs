import { z } from "zod"

/**
 * Callout: the agent's contract.
 *
 * The one thing in a reply the user must not miss.
 */

export const calloutSchema = z.object({
  tone: z
    .enum(["note", "warning", "critical"])
    .default("note")
    .describe(
      "'note' for useful context, 'warning' for a risk or caveat, 'critical' for safety issues or irreversible consequences.",
    ),
  title: z
    .string()
    .max(80)
    .optional()
    .describe("A few words, e.g. 'Food safety'."),
  text: z
    .string()
    .max(400)
    .describe("One or two sentences. Say the specific thing."),
  source: z
    .object({
      label: z.string().describe("e.g. 'USDA food safety guidance'"),
      url: z.string().url().optional(),
    })
    .optional()
    .describe("DATA-BOUND. Where the rule comes from, when it matters."),
})

export type CalloutInput = z.input<typeof calloutSchema>

/** Usage guidance the agent reads before choosing this component. */
export const calloutGuidance = {
  useWhen: [
    "There is a safety issue, an irreversible consequence, a legal or allergy concern, or a hard deadline the user must not miss.",
    "A caveat would change what the user does, e.g. 'Prices are from 2 hours ago'.",
  ],
  avoidWhen: [
    "To restate or emphasise the answer itself.",
    "For general tips or nice-to-knows. Put them in the text.",
    "More than once in the same reply. If everything is highlighted, nothing is.",
  ],
  rules: [
    "At most one callout per reply.",
    "Pick the lowest tone that fits; reserve 'critical' for real harm or irreversible actions.",
    "Be specific: numbers, names, dates. Cite a source when the rule comes from one.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(calloutSchema)`.
 */
export const calloutTool = {
  name: "show_callout",
  description: [
    "Set apart the one notice in your reply the user must not miss.",
    `Use when: ${calloutGuidance.useWhen.join(" ")}`,
    `Avoid when: ${calloutGuidance.avoidWhen.join(" ")}`,
    `Rules: ${calloutGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: calloutSchema,
} as const
