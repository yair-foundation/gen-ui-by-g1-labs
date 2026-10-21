import { z } from "zod"

/**
 * dB Meter: the agent's contract.
 *
 * A sound level meter in the chat. Two sources:
 * - "live": the user's microphone, measured in the browser only after they
 *   press Start. Browser microphones are uncalibrated, so levels are
 *   approximate: dB ≈ dBFS + calibrationOffset (default 94, so −20 dBFS ≈
 *   74 dB). No A-weighting is applied ("unweighted", dB Z). Nothing is
 *   recorded or sent; only the summary comes back to you.
 * - "reading": values from a connected sensor or tool. Every value is
 *   DATA-BOUND: it must come from a tool result, never from model free text.
 */

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "ISO 8601 date-time, e.g. '2026-10-08T14:30:00Z'",
  )

const level = z.number().min(-20).max(200)

export const dbMeterHistoryPointSchema = z.object({
  t: isoDateTime.describe("DATA-BOUND. When this value was measured."),
  value: level.describe("DATA-BOUND. Level in dB."),
})

export const dbMeterReadingSchema = z.object({
  current: level.describe("DATA-BOUND. The latest level in dB."),
  min: level.optional().describe("DATA-BOUND. Lowest level in the period."),
  max: level.optional().describe("DATA-BOUND. Highest level in the period."),
  average: level
    .optional()
    .describe(
      "DATA-BOUND. Energy average (Leq) over the period, as reported by the sensor.",
    ),
  history: z
    .array(dbMeterHistoryPointSchema)
    .max(600)
    .optional()
    .describe("DATA-BOUND. Recent levels, oldest first, for the sparkline."),
  location: z
    .string()
    .max(60)
    .optional()
    .describe(
      "DATA-BOUND. Where the sensor is, e.g. 'Warehouse floor, bay 4'.",
    ),
  asOf: isoDateTime.describe("DATA-BOUND. When `current` was measured."),
})

export const dbMeterSchema = z.object({
  source: z
    .enum(["live", "reading"])
    .describe(
      "'live': measure with the user's microphone after they press Start. 'reading': show values from a sensor or tool.",
    ),
  title: z
    .string()
    .max(60)
    .optional()
    .describe(
      "e.g. 'Home office' or 'Warehouse floor'. Defaults to 'Sound level'.",
    ),
  reading: dbMeterReadingSchema
    .optional()
    .describe("Required when source is 'reading'. DATA-BOUND."),
  purpose: z
    .enum(["general", "recording", "sleep", "workplace"])
    .default("general")
    .describe(
      "Adds a verdict line. 'recording': under 40 dB. 'sleep': under 35 dB. 'workplace': hearing protection above 85 dB.",
    ),
  calibrationOffset: z
    .number()
    .min(0)
    .max(140)
    .default(94)
    .describe(
      "Live only: dB ≈ dBFS + offset. Default 94 (−20 dBFS ≈ 74 dB). Change only with a known calibration for this device.",
    ),
  durationSeconds: z
    .number()
    .int()
    .min(5)
    .max(300)
    .default(30)
    .describe(
      "Live only: stop measuring automatically after this many seconds.",
    ),
  allowAlert: z
    .boolean()
    .default(false)
    .describe(
      "Reading only: adds an 'Alert above N dB' field. Only when you can create the alert.",
    ),
})

export type DbMeterHistoryPoint = z.infer<typeof dbMeterHistoryPointSchema>
export type DbMeterReading = z.infer<typeof dbMeterReadingSchema>
export type DbMeterInput = z.input<typeof dbMeterSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type DbMeterResult =
  | {
      /** Sent once, when a live session stops (by the user or at the time limit). */
      action: "measurement"
      /** Energy average (Leq) in dB, approximate. */
      average: number
      min: number
      max: number
      /** How long the microphone was measured, in seconds. */
      durationSeconds: number
      /** Always true: browser microphones are uncalibrated. */
      approximate: true
    }
  | {
      /** Reading only: the user asked to be alerted above this level. */
      action: "alert"
      /** In dB. */
      threshold: number
    }

/** Usage guidance the agent reads before choosing this component. */
export const dbMeterGuidance = {
  useWhen: [
    "The user asks how loud it is where they are: 'how loud is it in here?', 'is my office quiet enough to record?', 'is the baby's room quiet?'.",
    "You have a reading from a connected sound sensor or tool and want to show it with context.",
  ],
  avoidWhen: [
    "The user asks about typical loudness in general ('how loud is a jet?'). Answer in text.",
    "Hearing health or medical questions. The meter gives general safety information, not medical advice.",
    "You need a calibrated or legal measurement. Browser readings are approximate and unweighted.",
  ],
  rules: [
    "Live: the user presses Start; never claim a level before you receive a 'measurement' result.",
    "Say live levels are approximate when you answer, and base your answer on the average.",
    "Set purpose when the user names one: recording, sleep or workplace.",
    "Reading: every value must come from the sensor's tool result; set allowAlert only if you can create alerts.",
    "On 'alert', create the alert at the threshold and confirm it in one line.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(dbMeterSchema)`.
 */
export const dbMeterTool = {
  name: "show_sound_meter",
  description: [
    "Show a sound level meter: measure with the user's microphone, or show a sensor reading.",
    `Use when: ${dbMeterGuidance.useWhen.join(" ")}`,
    `Avoid when: ${dbMeterGuidance.avoidWhen.join(" ")}`,
    `Rules: ${dbMeterGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: dbMeterSchema,
} as const
