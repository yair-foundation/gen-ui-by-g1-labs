import { z } from "zod"

/**
 * Result Receipt: the agent's contract.
 *
 * What the agent just did, after an action ran, with undo while it is still
 * possible. The counterpart of Change Preview. Fields marked DATA-BOUND must
 * come from the action's tool result, never from model free text.
 */

export const receiptItemSchema = z.object({
  label: z.string().describe("What changed, e.g. an ad name or a field name."),
  before: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. The value before the action, formatted for display.",
    ),
  after: z
    .string()
    .optional()
    .describe("DATA-BOUND. The value now, formatted for display."),
  detail: z
    .string()
    .optional()
    .describe("One short line, e.g. an email address or why it changed."),
})

export const resultReceiptSchema = z.object({
  title: z
    .string()
    .describe("What was done, in the past tense, e.g. 'Paused 3 ads'."),
  target: z
    .object({
      label: z.string().describe("e.g. 'Acme Retail'"),
      kind: z
        .string()
        .optional()
        .describe("e.g. 'Meta ad account'. Screen readers only."),
    })
    .optional()
    .describe("DATA-BOUND. The system or record that was changed."),
  items: z
    .array(receiptItemSchema)
    .min(1)
    .max(20)
    .describe("DATA-BOUND. What changed, as reported by the action's result."),
  completedAt: z.iso
    .datetime({ offset: true })
    .describe("DATA-BOUND. When the action finished, ISO 8601."),
  undo: z
    .object({
      label: z.string().max(24).optional().describe("e.g. 'Undo pause'."),
      until: z.iso
        .datetime({ offset: true })
        .optional()
        .describe(
          "DATA-BOUND. When undo stops being possible, ISO 8601. Omit when there is no deadline.",
        ),
    })
    .optional()
    .describe("Only when the system can really reverse the action."),
  link: z
    .object({
      label: z.string().describe("e.g. 'View in CRM'."),
      url: z.string().describe("http(s) only. Opens in a new tab."),
    })
    .optional()
    .describe("Where the user can see the result in the system itself."),
})

export type ReceiptItem = z.infer<typeof receiptItemSchema>
export type ResultReceiptInput = z.input<typeof resultReceiptSchema>

/** Sent when the user presses Undo. Reverse the action, then confirm in text. */
export type ResultReceiptResult = { action: "undo" }

/** Usage guidance the agent reads before choosing this component. */
export const resultReceiptGuidance = {
  useWhen: [
    "You just completed an action in an external system (paused ads, updated a record, sent an invoice) and the user should see exactly what changed.",
    "The system lets the action be reversed for a while, and the user should be able to undo it.",
  ],
  avoidWhen: [
    "The action hasn't run yet. Use a change preview to ask first.",
    "The action failed. Say what went wrong in text, or use a callout.",
    "Nothing changed. Say so in a sentence.",
  ],
  rules: [
    "Only show it after the action's tool returned success, and fill items from that result.",
    "Write the title in the past tense, with the count: 'Paused 3 ads'.",
    "Only set undo when the system can really reverse the action; set until to the system's real deadline.",
    "On 'undo', reverse the action with the system's own undo, then confirm in text.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(resultReceiptSchema)`.
 */
export const resultReceiptTool = {
  name: "show_receipt",
  description: [
    "Show what you just did after an action ran: what changed, when, a link to it, and undo while it is still possible.",
    `Use when: ${resultReceiptGuidance.useWhen.join(" ")}`,
    `Avoid when: ${resultReceiptGuidance.avoidWhen.join(" ")}`,
    `Rules: ${resultReceiptGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: resultReceiptSchema,
} as const
