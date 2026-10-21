import { z } from "zod"

/**
 * Permission Scope: the agent's contract.
 *
 * Before it starts a task, the agent asks for the set of scopes it needs
 * (read a calendar, send email, spend up to an amount). The user grants or
 * withholds each one, picks how long the grant lasts, and allows the selection
 * or denies everything. Fields marked DATA-BOUND must come from the user or a
 * tool result, never be invented.
 */

export const permissionRiskSchema = z
  .enum(["low", "medium", "high"])
  .describe(
    "low: reads or reversible changes. medium: acts in the user's name (sends, edits). high: spends money, deletes, or shares data outside.",
  )

export const permissionScopeItemSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .max(40)
    .describe("What the agent may do, verb first, e.g. 'Read your calendar'."),
  detail: z
    .string()
    .max(90)
    .optional()
    .describe(
      "One line on exactly what is touched, e.g. 'Work calendar, next 14 days'.",
    ),
  risk: permissionRiskSchema,
  limit: z
    .string()
    .max(30)
    .optional()
    .describe(
      "DATA-BOUND. A cap that applies to this scope, e.g. 'Up to $400'. Shown next to the label.",
    ),
  required: z
    .boolean()
    .optional()
    .describe(
      "The task can't run without it. The user can't untick it; they can only deny all.",
    ),
  granted: z
    .boolean()
    .optional()
    .describe(
      "Ticked at the start. Defaults to true, except for high-risk scopes, which start unticked.",
    ),
})

export const permissionDurationSchema = z.enum(["once", "session", "always"])

export const permissionScopeSchema = z.object({
  question: z
    .string()
    .optional()
    .describe("The question this answers, shown above the card."),
  title: z
    .string()
    .max(60)
    .describe("Card heading naming the task, e.g. 'Book the team offsite'."),
  purpose: z
    .string()
    .max(140)
    .optional()
    .describe("One line on why the agent needs these, shown under the title."),
  scopes: z
    .array(permissionScopeItemSchema)
    .min(1)
    .max(8)
    .describe("The scopes requested, lowest risk first."),
  durations: z
    .array(permissionDurationSchema)
    .min(1)
    .max(3)
    .default(["once", "session"])
    .describe(
      "How long a grant may last, offered as choices. Offer 'always' only for low-risk, recurring work.",
    ),
  duration: permissionDurationSchema
    .optional()
    .describe(
      "The duration selected at the start. Defaults to the first offered.",
    ),
})

export type PermissionRisk = z.infer<typeof permissionRiskSchema>
export type PermissionScopeItem = z.infer<typeof permissionScopeItemSchema>
export type PermissionDuration = z.infer<typeof permissionDurationSchema>
export type PermissionScopeInput = z.input<typeof permissionScopeSchema>
export type PermissionScopeData = z.output<typeof permissionScopeSchema>

/** Sent once, when the user allows the selection or denies everything. */
export type PermissionScopeResult =
  | {
      action: "grant"
      /** Ids of the scopes the user left ticked. Never empty. */
      scopes: string[]
      duration?: PermissionDuration
    }
  | { action: "deny" }

/** Usage guidance the agent reads before choosing this component. */
export const permissionScopeGuidance = {
  useWhen: [
    "You need several kinds of access before starting a task (read a calendar, send email, spend money) and the user hasn't granted them yet.",
    "The user should decide scope by scope what you may touch, and for how long.",
  ],
  avoidWhen: [
    "You are about to take one specific action with known parameters. Use an approval request.",
    "The user is choosing how independently you work in general, not what you may touch. Use set_autonomy.",
    "Access is already granted. Don't ask again; act.",
  ],
  rules: [
    "Ask only for what the task needs, lowest risk first, each label verb first.",
    "Set risk honestly: spending, deleting and sharing outside are high.",
    "Put spending caps and quotas in limit, from what the user said; never invent an amount.",
    "Mark a scope required only if the task can't run without it.",
    "After a grant, use only the scopes returned, for the duration returned. After deny, don't retry; ask what the user wants instead.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(permissionScopeSchema)`.
 */
export const permissionScopeTool = {
  name: "request_permissions",
  description: [
    "Ask for the access a task needs: one row per scope with its risk, ticked or not, a duration choice, and Allow selected or Deny all.",
    `Use when: ${permissionScopeGuidance.useWhen.join(" ")}`,
    `Avoid when: ${permissionScopeGuidance.avoidWhen.join(" ")}`,
    `Rules: ${permissionScopeGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: permissionScopeSchema,
} as const
