import { z } from "zod"

/**
 * Execution Progress: the agent's contract.
 *
 * Live progress of work the agent is doing right now, with controls to
 * intervene. The host re-renders it as the runtime reports updates, so steps,
 * run state and outputs are DATA-BOUND: they come from the agent's runtime,
 * never from model free text.
 */

export const stepStateSchema = z
  .enum([
    "pending",
    "running",
    "waiting",
    "blocked",
    "done",
    "failed",
    "skipped",
  ])
  .describe(
    "pending: not started. running: in progress. waiting: paused on the user (approval, input, access). blocked: can't continue for a reason outside the run, e.g. a login wall. done, failed, skipped: finished.",
  )

export const substepSchema = z.object({
  label: z.string().describe("e.g. 'Pricing overview' or 'Funding'."),
  state: stepStateSchema,
})

export const executionStepSchema = z.object({
  id: z.string().describe("Stable identifier. Keep it as the step updates."),
  label: z
    .string()
    .describe("What the step does, e.g. 'Convert batch 2' or 'Check links'."),
  state: stepStateSchema,
  detail: z
    .string()
    .optional()
    .describe("Short, e.g. '12 of 40 docs' or '212 links checked'."),
  progress: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("0–1, for running steps that can measure it."),
  startedAt: z.string().optional().describe("ISO 8601."),
  finishedAt: z.string().optional().describe("ISO 8601."),
  waitingFor: z
    .string()
    .optional()
    .describe(
      "For waiting and blocked steps: what the run needs, e.g. 'Your approval for the send' or 'Site requires login'.",
    ),
  error: z
    .string()
    .optional()
    .describe(
      "For failed steps: what went wrong. For blocked or skipped steps: why. Plain words.",
    ),
  canSkip: z
    .boolean()
    .optional()
    .describe("Offer 'Skip step' when the step failed or is blocked."),
  canRetry: z
    .boolean()
    .optional()
    .describe("Offer 'Retry step' when the step failed or is blocked."),
  substeps: z
    .array(substepSchema)
    .max(10)
    .optional()
    .describe("Up to 10 parts, e.g. the docs in a batch."),
})

export const runStateSchema = z.enum([
  "running",
  "paused",
  "stopping",
  "cancelled",
  "completed",
  "failed",
])

export const runControlSchema = z.enum([
  "pause",
  "resume",
  "cancel",
  "skip",
  "retry",
])

export const executionProgressSchema = z.object({
  title: z
    .string()
    .describe(
      "The job, e.g. 'Migrate the 40 product docs to the new template'.",
    ),
  goal: z
    .string()
    .optional()
    .describe(
      "One line on what done looks like, if the title doesn't say it. Screen readers only.",
    ),
  steps: z
    .array(executionStepSchema)
    .min(1)
    .max(60)
    .describe(
      "DATA-BOUND. The run's steps and their live state, from the agent's runtime.",
    ),
  overall: z
    .object({
      progress: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("0–1. Omit to derive it from the steps."),
      etaSeconds: z
        .number()
        .nonnegative()
        .optional()
        .describe("Estimated time left, in seconds. Omit if unknown."),
    })
    .optional()
    .describe(
      "DATA-BOUND. From the runtime, when it can measure better than step counts.",
    ),
  runState: runStateSchema.describe(
    "DATA-BOUND. The run as the runtime reports it.",
  ),
  startedAt: z.string().optional().describe("ISO 8601. When the run started."),
  controls: z
    .array(runControlSchema)
    .optional()
    .describe(
      "What the user may do. Default: pause, resume and cancel, plus skip and retry on steps that allow them. When set, it is the full list.",
    ),
  cancelNote: z
    .string()
    .optional()
    .describe(
      "What cancelling leaves behind, shown in the confirm, e.g. '12 docs are already migrated and stay migrated.'",
    ),
  outputs: z
    .array(
      z.object({
        label: z.string().describe("e.g. 'Target accounts sheet'."),
        url: z
          .string()
          .optional()
          .describe("http(s) link. Other protocols are not linked."),
      }),
    )
    .max(20)
    .optional()
    .describe("DATA-BOUND. Results produced so far."),
})

export type StepState = z.infer<typeof stepStateSchema>
export type RunState = z.infer<typeof runStateSchema>
export type RunControl = z.infer<typeof runControlSchema>
export type ExecutionStep = z.input<typeof executionStepSchema>
export type ExecutionSubstep = z.input<typeof substepSchema>
export type ExecutionProgressInput = z.input<typeof executionProgressSchema>

/**
 * Commands to the agent runtime. A closed set. The component reflects them
 * only when the host sends updated props.
 */
export type ExecutionProgressResult =
  | { action: "pause" | "resume" | "cancel" }
  | { action: "skip" | "retry" | "open-waiting"; stepId: string }

/** Usage guidance the agent reads before choosing this component. */
export const executionProgressGuidance = {
  useWhen: [
    "You are running a multi-step job right now that takes minutes: migrating docs, researching a list, processing a batch.",
    "The user may need to approve, unblock, pause or stop the work while it runs.",
  ],
  avoidWhen: [
    "The work is already finished. Show the activity trail of what you did.",
    "It takes a few seconds. Do it and answer.",
    "The steps are for the user to carry out. Use a checklist.",
  ],
  rules: [
    "Steps, states and outputs come from your runtime; update them as they change and keep step ids stable.",
    "Use 'waiting' only when the run needs the user, and say what in waitingFor.",
    "Give failed steps a plain error, and set canSkip or canRetry only when you can actually do it.",
    "Treat every result as a command: act on it, then send updated props. Never assume it was applied.",
    "Set cancelNote when cancelling leaves finished work in place.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(executionProgressSchema)`.
 */
export const executionProgressTool = {
  name: "show_progress",
  description: [
    "Show live progress of a job you are running, with steps, outputs and controls to pause, cancel, skip or retry.",
    `Use when: ${executionProgressGuidance.useWhen.join(" ")}`,
    `Avoid when: ${executionProgressGuidance.avoidWhen.join(" ")}`,
    `Rules: ${executionProgressGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: executionProgressSchema,
} as const
