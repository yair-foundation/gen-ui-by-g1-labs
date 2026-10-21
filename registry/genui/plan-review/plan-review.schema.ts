import { z } from "zod"

/**
 * Plan Review: the agent's contract.
 *
 * Before multi-step work, the agent shows the steps it intends to take. The
 * user reorders, edits, removes, adds or skips steps, then approves. Nothing
 * runs until an "approve" result arrives.
 */

export const planStepSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable identifier. Returned in the result and used by dependsOn.",
    ),
  title: z
    .string()
    .describe("The step, as an action you will take: 'Export contacts'."),
  description: z
    .string()
    .optional()
    .describe("One line on what exactly happens in this step."),
  tools: z
    .array(z.string())
    .max(6)
    .optional()
    .describe(
      "DATA-BOUND. Connected tools this step uses, e.g. ['Gmail', 'Sheets']. Only tools you actually have. Screen readers only.",
    ),
  estimate: z
    .string()
    .max(24)
    .optional()
    .describe(
      "How long the step takes, e.g. '~2 min' or '1 h'. Summed into the header total; per step, screen readers only.",
    ),
  risk: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "Medium or high is shown with a warning: writes other people see, bulk changes, anything hard to undo.",
    ),
  requiresApproval: z
    .boolean()
    .optional()
    .describe("You will pause at this step and ask before continuing."),
  optional: z
    .boolean()
    .optional()
    .describe("The plan still works without it. The user can switch it off."),
  dependsOn: z
    .array(z.string())
    .optional()
    .describe(
      "Ids of earlier steps this one needs. The user is warned if a reorder or removal breaks this.",
    ),
})

export const planReviewSchema = z.object({
  title: z
    .string()
    .describe("What the plan is for, e.g. 'Plan the Q4 launch'."),
  goal: z
    .string()
    .optional()
    .describe(
      "One sentence on the outcome, e.g. 'Announce Acme Sync 2.0'. Screen readers only.",
    ),
  steps: z
    .array(planStepSchema)
    .min(1)
    .max(20)
    .describe("In the order you will run them."),
  assumptions: z
    .array(z.string())
    .max(5)
    .optional()
    .describe(
      "Things you took for granted that change the plan if wrong, e.g. 'Launch date is Nov 18'.",
    ),
  totalEstimate: z
    .string()
    .optional()
    .describe(
      "Header total when the step estimates can't be summed, e.g. 'About a day, mostly waiting on legal'.",
    ),
  editable: z
    .boolean()
    .default(true)
    .describe("Let the user reorder, edit, remove and skip steps."),
  allowAdd: z
    .boolean()
    .default(true)
    .describe("Let the user add steps of their own."),
})

export type PlanStep = z.infer<typeof planStepSchema>
export type PlanReviewInput = z.input<typeof planReviewSchema>
export type PlanReviewData = z.output<typeof planReviewSchema>

/** A step as approved, in its final order. */
export type PlanResultStep = {
  id: string
  title: string
  description?: string
  /** false when the user switched an optional step off. Skip it. */
  enabled: boolean
  /** A step the user wrote. You have no tools or estimate for it yet. */
  addedByUser?: boolean
}

/** Ids per kind of change, compared with the plan you proposed. */
export type PlanChanges = {
  moved: string[]
  removed: string[]
  edited: string[]
  added: string[]
  disabled: string[]
}

/** What the component sends back to the agent. A closed set of actions. */
export type PlanReviewResult =
  | {
      action: "approve"
      /** The plan to run, in order. Removed steps are left out. */
      steps: PlanResultStep[]
      /** true when the user changed anything. */
      edited: boolean
      changes: PlanChanges
    }
  /** The user wants a different plan. Revise it and propose again. */
  | { action: "revise"; feedback: string }
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const planReviewGuidance = {
  useWhen: [
    "Before multi-step work you will carry out yourself: a launch, a data clean-up, a migration.",
    "The user should shape the steps (order, scope, what to skip) before anything runs.",
    "Some steps write to shared systems or are hard to undo, and the user should see them first.",
  ],
  avoidWhen: [
    "The steps are for the user to do. Use a checklist.",
    "It's one or two quick, reversible actions. Just do them, or confirm in text.",
    "You are proposing specific field changes. Use a change preview.",
  ],
  rules: [
    "Write each step as an action you will take, in run order, with the tools it uses.",
    "Set requiresApproval on steps where you will pause, and risk 'medium' or 'high' on bulk, shared or irreversible writes.",
    "Fill dependsOn for real dependencies only, so the user is warned when a change breaks one.",
    "List assumptions that would change the plan if wrong. Five at most.",
    "Run nothing until you receive 'approve'. Then run exactly the returned steps, in order, skipping disabled ones; ask how to do user-added steps if unclear.",
    "On 'revise', run nothing: address the feedback and propose a new plan.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(planReviewSchema)`.
 */
export const planReviewTool = {
  name: "propose_plan",
  description: [
    "Show the user your step-by-step plan so they can reorder, edit, remove, add or skip steps, and wait for approval before running it.",
    `Use when: ${planReviewGuidance.useWhen.join(" ")}`,
    `Avoid when: ${planReviewGuidance.avoidWhen.join(" ")}`,
    `Rules: ${planReviewGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: planReviewSchema,
} as const
