import { z } from "zod"

/**
 * Task Queue: the agent's contract.
 *
 * The tasks the agent has lined up, in the order it will run them: what is
 * running now, what waits, what finished or failed. The user can reorder the
 * waiting tasks, pause or cancel one, and approve the queue. Tasks and their
 * states are DATA-BOUND: they come from the agent's runtime, never from model
 * free text.
 */

/** Models often write booleans as strings; accept them. */
const looseBoolean = z.preprocess(
  (v) => (v === "true" ? true : v === "false" ? false : v),
  z.boolean(),
)

export const queueTaskStateSchema = z
  .enum(["running", "waiting", "done", "failed"])
  .describe(
    "running: in progress now. waiting: queued, runs in list order. done, failed: finished.",
  )

export const queueTaskSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in results."),
  title: z
    .string()
    .max(80)
    .describe("What the task does, e.g. 'Summarise the Q3 support tickets'."),
  detail: z
    .string()
    .max(60)
    .optional()
    .describe(
      "One short line, e.g. '~2 min · 14 files' or 'Needs Drive access'.",
    ),
  state: queueTaskStateSchema,
  progress: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("0–1, for a running task that can measure it."),
  error: z
    .string()
    .max(120)
    .optional()
    .describe("For a failed task: what went wrong, in plain words."),
})

export const taskQueueSchema = z.object({
  title: z
    .string()
    .describe("The queue's name, e.g. 'Queued for this afternoon'."),
  tasks: z
    .array(queueTaskSchema)
    .min(1)
    .max(20)
    .describe(
      "DATA-BOUND. Every task in the queue, from your runtime. Waiting tasks in the order they will run.",
    ),
  note: z
    .string()
    .max(80)
    .optional()
    .describe("One quiet line under the list, e.g. 'Runs one task at a time.'"),
  canReorder: looseBoolean
    .optional()
    .describe("false when the order is fixed (dependencies). Default true."),
  canPause: looseBoolean
    .optional()
    .describe("false when running tasks can't be paused. Default true."),
  canCancel: looseBoolean
    .optional()
    .describe("false when tasks can't be cancelled. Default true."),
  approveLabel: z
    .string()
    .max(24)
    .optional()
    .describe("Label for the approve button. Default 'Approve order'."),
})

export type QueueTaskState = z.infer<typeof queueTaskStateSchema>
export type QueueTask = z.infer<typeof queueTaskSchema>
export type TaskQueueInput = z.input<typeof taskQueueSchema>

/**
 * What the component sends back to the agent. A closed set of commands; the
 * component reflects them only when the host sends updated props.
 */
export type TaskQueueResult =
  /** Run the waiting tasks in this order (ids of waiting tasks, first to last). */
  | { action: "approve"; order: string[] }
  /** Stop and drop this task (running or waiting). */
  | { action: "cancel"; taskId: string }
  /** Pause this running task. */
  | { action: "pause"; taskId: string }

/** Usage guidance the agent reads before choosing this component. */
export const taskQueueGuidance = {
  useWhen: [
    "You have several separate tasks lined up to run one after another, and the user may want a say in the order.",
    "The user asks what you are working on next, or to change the order, pause or drop something you queued.",
  ],
  avoidWhen: [
    "It's the steps of one job running now. Use execution progress.",
    "The tasks are for the user to do. Use a checklist or their to-do list.",
    "Work items move between stages on a team board. Use a kanban board.",
    "There is only one task. Just do it, or ask.",
  ],
  rules: [
    "Pass every task from your runtime with its real state; keep ids stable as states change.",
    "List waiting tasks in the order they will run.",
    "Set canReorder, canPause or canCancel to false when you can't actually do it.",
    "Treat every result as a command: act on it, then send updated props. Never assume it was applied.",
    "On 'approve', run the waiting tasks in exactly the returned order. After 'pause', show the task as waiting again.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(taskQueueSchema)`.
 */
export const taskQueueTool = {
  name: "show_queue",
  description: [
    "Show the tasks you have queued (running, waiting, done, failed) in run order. The user can reorder the waiting tasks, pause or cancel one, and approve the order.",
    `Use when: ${taskQueueGuidance.useWhen.join(" ")}`,
    `Avoid when: ${taskQueueGuidance.avoidWhen.join(" ")}`,
    `Rules: ${taskQueueGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: taskQueueSchema,
} as const
