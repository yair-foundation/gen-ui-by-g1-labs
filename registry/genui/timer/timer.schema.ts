import { z } from "zod"

/**
 * Timer: the agent's contract.
 *
 * A working countdown, interval sequence or stopwatch the user runs while
 * doing a task. The time itself lives in the component, never in the model.
 */

export const timerStepSchema = z.object({
  label: z
    .string()
    .max(40)
    .describe("What happens in this step, e.g. 'Roast', 'Work', 'Steep'."),
  seconds: z
    .number()
    .int()
    .min(1)
    .max(86400)
    .describe("Length in seconds, e.g. 4800 for 1 h 20 min."),
})

export const timerSchema = z.object({
  title: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Short name used in labels and the done announcement, e.g. 'Roast' → 'Roast is done'.",
    ),
  mode: z
    .enum(["countdown", "stopwatch", "intervals"])
    .describe(
      "'countdown': one duration. 'intervals': a sequence of steps, optionally repeated. 'stopwatch': counts up, with laps.",
    ),
  steps: z
    .array(timerStepSchema)
    .min(1)
    .max(20)
    .optional()
    .describe(
      "Countdown: exactly one step. Intervals: the sequence, in order. Omit for a stopwatch.",
    ),
  repeat: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(1)
    .describe("Intervals: how many rounds of the sequence, e.g. 8."),
  autoStart: z
    .boolean()
    .default(false)
    .describe(
      "Start counting as soon as it appears. Leave false so the user starts it when they're ready.",
    ),
  allowAdjust: z
    .boolean()
    .optional()
    .describe(
      "Show +1 min / −1 min for the current step. Defaults to true for a countdown, false otherwise.",
    ),
})

export type TimerStepInput = z.infer<typeof timerStepSchema>
export type TimerInput = z.input<typeof timerSchema>

/** Sent back once. A closed set of actions. */
export type TimerResult =
  | {
      action: "completed"
      /**
       * Countdown and intervals: the timed length, including added or removed
       * minutes. Stopwatch: the elapsed time when the user pressed Finish.
       */
      totalSeconds: number
      /** Stopwatch: each lap's duration in seconds, oldest first. */
      laps?: number[]
    }
  | {
      action: "cancelled"
      /** Time run before the user cancelled. */
      elapsedSeconds: number
    }

/** Usage guidance the agent reads before choosing this component. */
export const timerGuidance = {
  useWhen: [
    "Timing matters to what the user is doing right now: cooking, steeping, resting dough, a workout, a pomodoro, a rehearsed talk.",
    "The user asks you to set a timer, run intervals, or time something.",
  ],
  avoidWhen: [
    "The user needs a reminder at a clock time, hours or days away. Use a reminder or calendar tool.",
    "The time is only information, e.g. 'how long do eggs boil?'. Answer in text.",
    "You would need to act when it ends without the user present. The timer runs in the user's browser.",
  ],
  rules: [
    "Give it a short title, the thing being timed: 'Roast', 'Tea', 'Talk'.",
    "Use one step for a countdown, a sequence of labelled steps for intervals, and repeat for rounds instead of listing them.",
    "Leave autoStart false unless the user asked to start now.",
    "On 'completed', move to the next thing they need; on 'cancelled', don't restart it unasked.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(timerSchema)`.
 */
export const timerTool = {
  name: "start_timer",
  description: [
    "Give the user a working countdown, interval timer or stopwatch for a task.",
    `Use when: ${timerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${timerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${timerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: timerSchema,
} as const
