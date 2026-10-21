import { z } from "zod"

/**
 * Checkpoint: the agent's contract.
 *
 * During a long run, the agent lists the states it saved along the way and
 * marks the one it's at. The user can roll back to an earlier checkpoint
 * (after a confirm step) or tell the agent to carry on. Fields marked
 * DATA-BOUND must come from the agent's own run log, never be invented.
 */

export const checkpointItemSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .max(60)
    .describe("DATA-BOUND. What the state is, e.g. 'After Acme replies'."),
  time: z
    .string()
    .max(20)
    .describe("DATA-BOUND. When it was saved, as shown, e.g. '14:21'."),
  change: z
    .string()
    .max(80)
    .optional()
    .describe(
      "DATA-BOUND. What changed since the previous checkpoint, e.g. '23 tickets closed'.",
    ),
})

export const checkpointSchema = z.object({
  title: z
    .string()
    .max(60)
    .describe("Card heading, e.g. 'Ticket triage checkpoints'."),
  checkpoints: z
    .array(checkpointItemSchema)
    .min(2)
    .max(12)
    .describe("Saved states, oldest first."),
  currentId: z
    .string()
    .optional()
    .describe("The checkpoint the run is at now. Defaults to the last one."),
  caveat: z
    .string()
    .max(140)
    .optional()
    .describe(
      "DATA-BOUND. What a restore can't undo (sent messages, payments), in one line. Shown in the confirm step.",
    ),
  continueLabel: z
    .string()
    .max(30)
    .optional()
    .describe(
      "Label for carrying on from the current state. Default 'Continue'.",
    ),
})

export type CheckpointItem = z.infer<typeof checkpointItemSchema>
export type CheckpointInput = z.input<typeof checkpointSchema>
export type CheckpointData = z.output<typeof checkpointSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type CheckpointResult =
  | {
      action: "restore"
      /** The checkpoint to roll back to. Everything after it is undone. */
      checkpointId: string
    }
  | { action: "continue" }

/** Usage guidance the agent reads before choosing this component. */
export const checkpointGuidance = {
  useWhen: [
    "You are partway through a long run that changed things, you saved restore points along the way, and the user may want to go back before you continue.",
    "The user asks to undo part of the run, or questions a step you took a while ago.",
  ],
  avoidWhen: [
    "You can't actually roll back to the states you'd list. Never offer a restore you can't perform.",
    "The user only wants to see what you did. Use the activity trail.",
    "One action is waiting for approval. Use the approval request.",
    "Something failed and you need a way forward. Use the recovery panel.",
  ],
  rules: [
    "List only checkpoints you really saved, oldest first, with the time each was saved.",
    "Write change as what that step did, in a few words with real counts.",
    "Set currentId to where the run is now; it defaults to the last checkpoint.",
    "Use caveat for anything a restore can't undo (emails sent, payments made). Leave it out when everything is reversible.",
    "Pause the run while this is open. On 'restore', roll back to checkpointId, say what was undone, and wait. On 'continue', carry on from the current state.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(checkpointSchema)`.
 */
export const checkpointTool = {
  name: "show_checkpoints",
  description: [
    "Show the restore points of a long agent run, with the current one marked; the user can roll back to an earlier one after confirming, or continue.",
    `Use when: ${checkpointGuidance.useWhen.join(" ")}`,
    `Avoid when: ${checkpointGuidance.avoidWhen.join(" ")}`,
    `Rules: ${checkpointGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: checkpointSchema,
} as const
