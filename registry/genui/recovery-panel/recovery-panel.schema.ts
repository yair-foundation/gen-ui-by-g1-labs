import { z } from "zod"

/**
 * Recovery Panel: the agent's contract.
 *
 * When the agent can't finish what it proposed, it says what happened, what
 * still worked, and offers concrete ways to continue. Fields marked
 * DATA-BOUND must come from a tool result, never from model free text.
 */

/** Stable identifier, returned in the result. */
const id = z.string()
/** Overrides the primary button label when the option is selected (see rules). */
const actionLabel = z.string().max(40).optional()

export const retryOptionSchema = z.object({
  type: z.literal("retry"),
  id,
  label: z.string(),
  detail: z.string().optional().describe("Screen readers only."),
  availableAt: z
    .string()
    .optional()
    .describe("DATA-BOUND. ISO 8601 time when a retry can work."),
  actionLabel,
})

export const reconnectOptionSchema = z.object({
  type: z.literal("reconnect"),
  id,
  label: z.string(),
  service: z.string(),
  actionLabel,
})

export const requestAccessOptionSchema = z.object({
  type: z.literal("request-access"),
  id,
  label: z.string(),
  to: z.string().optional().describe("DATA-BOUND."),
  messagePreview: z
    .string()
    .max(500)
    .optional()
    .describe("Draft message the user can edit."),
  actionLabel,
})

export const fixInputFieldSchema = z.object({
  id,
  label: z.string(),
  type: z.enum(["text", "email", "number", "date"]).default("text"),
  value: z.string().optional().describe("DATA-BOUND. The value that failed."),
  error: z.string().optional().describe("DATA-BOUND. Why it failed."),
  required: z.boolean().optional(),
})

export const fixInputOptionSchema = z.object({
  type: z.literal("fix-input"),
  id,
  label: z.string().describe("e.g. 'Fix the 2 email addresses'."),
  fields: z.array(fixInputFieldSchema).min(1).max(8),
  actionLabel,
})

export const alternativeChoiceSchema = z.object({
  id,
  label: z.string(),
  detail: z.string().optional(),
})

export const alternativeOptionSchema = z.object({
  type: z.literal("alternative"),
  id,
  label: z.string(),
  choices: z
    .array(alternativeChoiceSchema)
    .min(1)
    .max(8)
    .describe("DATA-BOUND. Only ones actually available."),
  verb: z
    .string()
    .max(20)
    .optional()
    .describe("Button verb before the chosen label, e.g. 'Book'."),
  actionLabel,
})

export const skipOptionSchema = z.object({
  type: z.literal("skip"),
  id,
  label: z.string().describe("e.g. 'Continue without the 2 bounced invoices'."),
  consequence: z.string().optional().describe("What skipping means."),
  actionLabel,
})

export const contactOptionSchema = z.object({
  type: z.literal("contact"),
  id,
  label: z.string(),
  url: z.string().optional().describe("DATA-BOUND. http(s) support page."),
  actionLabel,
})

export const cancelOptionSchema = z.object({
  type: z.literal("cancel"),
  id,
  label: z.string(),
})

export const recoveryOptionSchema = z.discriminatedUnion("type", [
  retryOptionSchema,
  reconnectOptionSchema,
  requestAccessOptionSchema,
  fixInputOptionSchema,
  alternativeOptionSchema,
  skipOptionSchema,
  contactOptionSchema,
  cancelOptionSchema,
])

export const recoveryPanelSchema = z.object({
  title: z
    .string()
    .describe("What didn't happen, e.g. '2 invoices weren't sent'."),
  kind: z
    .enum(["access", "input", "unavailable", "partial", "limit", "conflict"])
    .optional()
    .describe(
      "access: permission/sign-in. input: invalid input. unavailable: sold out, taken, price changed. partial: some failed. limit: quota/rate. conflict: changed by others. Screen readers only.",
    ),
  explanation: z.string().max(280),
  completed: z
    .object({
      label: z.string().describe("e.g. '8 invoices sent'."),
      count: z.number().int().min(0).meta({ maximum: undefined }).optional(),
      verb: z
        .string()
        .max(20)
        .optional()
        .describe("Past tense, e.g. 'sent' (8 sent · 2 failed)."),
      items: z
        .array(z.string())
        .max(5)
        .optional()
        .describe("Screen readers only."),
    })
    .optional()
    .describe("DATA-BOUND. What worked. Omit when nothing did."),
  failed: z
    .object({
      label: z.string().describe("e.g. '2 bounced'."),
      count: z.number().int().min(0).meta({ maximum: undefined }).optional(),
      items: z
        .array(z.object({ id, label: z.string(), reason: z.string() }))
        .max(20)
        .optional(),
    })
    .optional()
    .describe("DATA-BOUND."),
  nothingChanged: z.boolean().optional(),
  options: z.array(recoveryOptionSchema).min(1).max(5).describe("Best first."),
})

export type RecoveryOption = z.infer<typeof recoveryOptionSchema>
export type FixInputField = z.infer<typeof fixInputFieldSchema>
export type AlternativeChoice = z.infer<typeof alternativeChoiceSchema>
export type RecoveryPanelInput = z.input<typeof recoveryPanelSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type RecoveryPanelResult =
  | {
      action: "recover"
      optionId: string
      type: RecoveryOption["type"]
      /** fix-input: the corrected values, by field id. */
      values?: Record<string, string>
      /** alternative: the chosen choice id. */
      choiceId?: string
      /** request-access: the message the user sent (may be empty). */
      message?: string
    }
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const recoveryPanelGuidance = {
  useWhen: [
    "You couldn't finish what you proposed and there are concrete ways to continue: missing access, rejected input, an option that's gone, a partial failure, a limit, or a conflict.",
    "Part of the work succeeded and the user needs to see what did and didn't happen before deciding.",
  ],
  avoidWhen: [
    "A tool call errored and all you can offer is trying again. The host shows its own failure card.",
    "Nothing went wrong and you only need a choice. Use a picker or ask.",
    "You need new information, not a fix to rejected input. Use a form.",
    "A transient error you can safely retry yourself. Retry first, then report.",
  ],
  rules: [
    "Explain what happened in one or two plain sentences, without blaming the user or the service.",
    "completed, failed, field errors, alternatives and availableAt come from tool results. Never estimate counts or invent alternatives.",
    "Set nothingChanged only when you're certain nothing was written, sent or charged.",
    "Offer 1–5 options, best first. Add a cancel option when stopping is reasonable.",
    "reconnect never collects credentials: the host opens its own sign-in.",
    "An option's actionLabel replaces the primary button label while it's selected.",
    "Act only on the returned option: use the returned values for fix-input, choiceId for alternative and message for request-access.",
    "On cancel, stop the flow; don't retry on your own.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(recoveryPanelSchema)`.
 */
export const recoveryPanelTool = {
  name: "offer_recovery",
  description: [
    "Explain why something couldn't be finished, what still worked, and offer ways to continue.",
    `Use when: ${recoveryPanelGuidance.useWhen.join(" ")}`,
    `Avoid when: ${recoveryPanelGuidance.avoidWhen.join(" ")}`,
    `Rules: ${recoveryPanelGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: recoveryPanelSchema,
} as const
