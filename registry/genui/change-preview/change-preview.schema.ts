import { z } from "zod"

/**
 * Change Preview: the agent's contract.
 *
 * The agent fills these props via a tool call. Fields marked DATA-BOUND must
 * come from a tool result (the real current state), never from model free text.
 */

export const changeValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const changeOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
})

export const changeItemSchema = z.object({
  id: z
    .string()
    .describe("Stable identifier for this field. Returned in the result."),
  label: z.string().describe("Human-readable field name, e.g. 'Daily budget'."),
  group: z
    .string()
    .optional()
    .describe(
      "Optional heading that groups rows, e.g. the campaign or record name.",
    ),
  kind: z
    .enum(["text", "longtext", "number", "currency", "boolean", "select"])
    .default("text")
    .describe("Controls formatting and the editor used when editing."),
  before: changeValueSchema.describe(
    "DATA-BOUND. The current value read from the system. Use null when the field does not exist yet (a create).",
  ),
  after: changeValueSchema.describe(
    "The proposed value. Use null to remove the field or record.",
  ),
  editable: z
    .boolean()
    .default(true)
    .describe("Whether the user may edit the proposed value before applying."),
  options: z
    .array(changeOptionSchema)
    .optional()
    .describe("DATA-BOUND. Required when kind is 'select'."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for kind 'currency', e.g. 'USD'."),
  note: z
    .string()
    .optional()
    .describe("Why this change is proposed. Screen readers only."),
  warning: z
    .string()
    .optional()
    .describe(
      "Side effect the user must know about, e.g. 'Resets the learning phase'.",
    ),
})

export const changePreviewSchema = z.object({
  title: z
    .string()
    .describe("What will happen, as an action. e.g. 'Update 3 ad sets'."),
  description: z.string().optional().describe("Screen readers only."),
  target: z
    .object({
      label: z.string().describe("e.g. 'Acme Retail'"),
      kind: z
        .string()
        .optional()
        .describe("e.g. 'Meta ad account'. Screen readers only."),
    })
    .optional()
    .describe("DATA-BOUND. The system or record the changes apply to."),
  changes: z.array(changeItemSchema).min(1),
  mode: z
    .enum(["review", "overwrite"])
    .default("review")
    .describe(
      "'review': user can accept or skip each change. 'overwrite': all or nothing, e.g. replacing a document.",
    ),
  risk: z
    .enum(["low", "medium", "high"])
    .default("low")
    .describe("Only 'high' changes the card."),
  reversible: z
    .boolean()
    .default(true)
    .describe("Set false when the change cannot be undone after applying."),
  confirmLabel: z
    .string()
    .optional()
    .describe("Verb for the confirm button, e.g. 'Update ad sets'."),
})

export type ChangeValue = z.infer<typeof changeValueSchema>
export type ChangeItem = z.infer<typeof changeItemSchema>
export type ChangePreviewInput = z.input<typeof changePreviewSchema>
export type ChangePreviewData = z.output<typeof changePreviewSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type ChangePreviewResult =
  | {
      action: "confirm"
      /** Only the changes the user kept, with their final values. */
      changes: { id: string; value: ChangeValue; edited: boolean }[]
      /** Ids the user chose not to apply. */
      skipped: string[]
    }
  | { action: "reject" }
  /** The user wants a different proposal. Revise it and propose again. */
  | { action: "revise"; note: string }

/** Usage guidance the agent reads before choosing this component. */
export const changePreviewGuidance = {
  useWhen: [
    "Before any write to an external system: updating records, settings, budgets, permissions or content.",
    "When the user should see the exact before/after values and be able to edit them before applying.",
    "When several related changes are proposed at once and the user may want to apply only some.",
  ],
  avoidWhen: [
    "The user asked a question. Answer it, do not propose changes.",
    "The action has no 'before' state worth showing, e.g. sending a new message. Use a draft or confirm component.",
    "You cannot read the current values. Fetch them first; never guess 'before'.",
    "The change is trivial and the user explicitly asked to skip confirmations.",
  ],
  rules: [
    "'before' must come from a tool result, never from memory or assumptions.",
    "Order changes by importance; put risky ones first and give them a 'warning'.",
    "Set reversible: false and risk: 'high' for deletes, payments and anything sent to other people.",
    "Never apply changes until you receive a result with action 'confirm', and apply only the returned values.",
    "On 'revise', apply nothing: address the note and show a new change preview.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(changePreviewSchema)`.
 */
export const changePreviewTool = {
  name: "propose_changes",
  description: [
    "Show the user an editable before/after preview of changes and wait for approval before applying them.",
    `Use when: ${changePreviewGuidance.useWhen.join(" ")}`,
    `Avoid when: ${changePreviewGuidance.avoidWhen.join(" ")}`,
    `Rules: ${changePreviewGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: changePreviewSchema,
} as const
