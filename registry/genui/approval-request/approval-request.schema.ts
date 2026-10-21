import { z } from "zod"

/**
 * Approval Request: the agent's contract.
 *
 * The agent pauses before one specific action and asks permission, with its
 * scope and consequences visible. Fields marked DATA-BOUND must come from a
 * tool result (the real targets), never from model free text.
 */

export const adjustValueSchema = z.union([z.string(), z.number(), z.boolean()])

/** The icons a fact may carry. Names map to Lucide icons in the component. */
export const approvalIcons = [
  "calendar",
  "clock",
  "users",
  "user",
  "map-pin",
  "wallet",
  "credit-card",
  "tag",
  "package",
  "file-text",
  "mail",
  "shield",
  "database",
  "server",
  "globe",
  "hash",
  "trending-up",
  "building",
] as const

export type ApprovalIcon = (typeof approvalIcons)[number]

export const approvalScopeSchema = z.object({
  label: z.string().describe("What kind of thing, e.g. 'Recipients'."),
  value: z.string().describe("Which ones, e.g. '240 customers'."),
  detail: z
    .string()
    .optional()
    .describe("One short qualifier, e.g. 'Plans ending in October'."),
  icon: z
    .enum(approvalIcons)
    .optional()
    .describe(
      "Optional icon that makes the scope row scannable: users for recipients, database for data, wallet for money. Use it on every row or on none.",
    ),
})

export const approvalAdjustableSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z.string().describe("e.g. 'Send time' or 'Recipient limit'."),
  type: z.enum(["number", "text", "select", "toggle"]),
  value: adjustValueSchema.describe(
    "The value you plan to use. A number for 'number', a boolean for 'toggle', one of `options` for 'select'.",
  ),
  options: z
    .array(z.string())
    .optional()
    .describe("Required for 'select'. The allowed values, as shown."),
  min: z.number().optional().describe("For 'number'."),
  max: z.number().optional().describe("For 'number'."),
  help: z
    .string()
    .optional()
    .describe("e.g. 'In the customer's time zone'. Screen readers only."),
})

export const approvalAlternativeSchema = z.object({
  id: z.string().describe("Returned in the result when chosen."),
  label: z
    .string()
    .describe(
      "A safer action you could take instead, e.g. 'Send to a test list first'.",
    ),
  description: z.string().optional().describe("Screen readers only."),
})

export const approvalRequestSchema = z.object({
  action: z
    .string()
    .describe("The action, imperative and specific: 'Send renewal email'."),
  summary: z
    .string()
    .optional()
    .describe("What happens if approved. Screen readers only."),
  risk: z
    .enum(["low", "medium", "high"])
    .describe(
      "'high' for anything destructive, costly or hard to reverse at scale (production, deletes, payments, mass sends).",
    ),
  reversible: z
    .preprocess(
      // Models often write the booleans as strings; accept them.
      (v) => (v === "true" ? true : v === "false" ? false : v),
      z.union([z.boolean(), z.literal("partially")]),
    )
    .describe(
      "Whether the action can be undone after it runs: true, false (JSON booleans, not strings) or 'partially'.",
    ),
  undoWindow: z
    .string()
    .optional()
    .describe("How long undo is possible, e.g. 'Undo within 30 seconds'."),
  reversibleDetail: z
    .string()
    .optional()
    .describe(
      "What can and can't be reversed, e.g. 'Refunds are prorated within 14 days'. Use with reversible: 'partially'.",
    ),
  scope: z
    .array(approvalScopeSchema)
    .min(1)
    .max(8)
    .describe(
      "DATA-BOUND. What the action touches: recipients, account, environment, records. Read the real counts and names first.",
    ),
  consequences: z
    .array(z.string())
    .max(5)
    .optional()
    .describe(
      "Plain sentences on what happens, e.g. 'Customers receive the email immediately'.",
    ),
  cost: z
    .object({
      amount: z.number(),
      currency: z.string().length(3).describe("ISO 4217 code, e.g. 'USD'."),
      period: z
        .enum(["one-time", "day", "week", "month", "quarter", "year"])
        .optional(),
    })
    .optional()
    .describe("DATA-BOUND. The charge, from the billing system."),
  requestedBy: z
    .string()
    .optional()
    .describe("e.g. 'Billing agent'. Screen readers only."),
  expiresAt: z
    .string()
    .optional()
    .describe(
      "ISO 8601 time after which the request lapses. Shown as 'Expires in 14 min'; set the same value on the call so the Renderer turns it off.",
    ),
  adjustable: z
    .array(approvalAdjustableSchema)
    .max(6)
    .optional()
    .describe(
      "Parameters the user may change before approving, e.g. a send time, a recipient limit or an amount cap.",
    ),
  confirmPhrase: z
    .string()
    .optional()
    .describe(
      "For high risk: a word the user must type to unlock Approve, e.g. the environment name 'production'.",
    ),
  hold: z
    .boolean()
    .optional()
    .describe(
      "Press and hold Approve for about a second, so a stray tap can't send it. Default: on for risk 'high' (unless a confirmPhrase is set), off otherwise.",
    ),
  alternatives: z
    .array(approvalAlternativeSchema)
    .max(3)
    .optional()
    .describe("Safer options you could take instead."),
})

export type ApprovalScope = z.infer<typeof approvalScopeSchema>
export type ApprovalAdjustable = z.infer<typeof approvalAdjustableSchema>
export type ApprovalAlternative = z.infer<typeof approvalAlternativeSchema>
export type ApprovalAdjustValue = z.infer<typeof adjustValueSchema>
export type ApprovalRequestInput = z.input<typeof approvalRequestSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type ApprovalRequestResult = (
  | {
      action: "approve"
      /** Only the fields the user changed, with their new values. */
      adjustments?: Record<string, ApprovalAdjustValue>
    }
  | { action: "reject"; reason?: string }
  /** A question or a requested change. Do nothing; answer or propose again. */
  | { action: "revise"; feedback: string }
  /** The user picked one of your alternatives instead. */
  | { action: "alternative"; id: string }
) & {
  /** When the user decided (ISO 8601). For the record shown in the card. */
  decidedAt?: string
}

/** Usage guidance the agent reads before choosing this component. */
export const approvalRequestGuidance = {
  useWhen: [
    "You are about to take one specific action that sends, charges, grants access, deletes or runs something, and the user should decide first.",
    "The action has no before/after diff worth showing: sending, paying, running a job, granting a role.",
  ],
  avoidWhen: [
    "You're changing field values the user should see before and after. Use the change preview.",
    "The action is read-only or trivially reversible, and the user asked you to go ahead.",
    "You haven't read the real targets yet. Fetch the recipients, account or environment first.",
  ],
  rules: [
    "Wait for the result. Never act before receiving action 'approve'.",
    "Apply the returned adjustments exactly; anything not listed stays as you proposed.",
    "Scope must come from tool results: real counts, names and environments.",
    "Set risk honestly; use 'high' plus a confirmPhrase for production, deletes and large payments. At risk 'high' without a confirmPhrase, Approve is press-and-hold on its own.",
    "On 'reject', stop. On 'revise', answer the question or propose a new request. On 'alternative', do that instead.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(approvalRequestSchema)`.
 */
export const approvalRequestTool = {
  name: "request_approval",
  description: [
    "Pause and ask the user to approve one specific action, showing its scope, cost and consequences, and wait for their decision.",
    `Use when: ${approvalRequestGuidance.useWhen.join(" ")}`,
    `Avoid when: ${approvalRequestGuidance.avoidWhen.join(" ")}`,
    `Rules: ${approvalRequestGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: approvalRequestSchema,
} as const
