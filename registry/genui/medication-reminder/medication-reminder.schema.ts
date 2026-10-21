import { z } from "zod"

/**
 * Medication Reminder: the agent's contract.
 *
 * A medicine or supplement schedule with this week at a glance and today's
 * doses to log. The schedule comes only from the user or their prescription
 * data (DATA-BOUND): the agent never suggests doses, timings or medicines.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export const medicationScheduleSchema = z.object({
  frequency: z
    .enum(["daily", "weekly", "every-n-days", "as-needed"])
    .describe(
      "DATA-BOUND. 'weekly' uses daysOfWeek; 'every-n-days' uses everyNDays from startDate.",
    ),
  timesPerDay: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe(
      "DATA-BOUND. Doses on each scheduled day when there are no set times. Default 1.",
    ),
  times: z
    .array(z.string().regex(TIME))
    .max(12)
    .optional()
    .describe(
      "DATA-BOUND. Set times, 24-hour local time in timeZone, e.g. ['08:00', '20:00']. Only times the user or prescription gave.",
    ),
  daysOfWeek: z
    .array(z.number().int().min(0).max(6))
    .max(7)
    .optional()
    .describe("DATA-BOUND. Weekly: 0 = Sunday … 6 = Saturday."),
  everyNDays: z
    .number()
    .int()
    .min(2)
    .max(90)
    .optional()
    .describe("DATA-BOUND. Every-n-days: the interval, e.g. 3."),
  startDate: z
    .string()
    .regex(DAY)
    .optional()
    .describe(
      "DATA-BOUND. 'YYYY-MM-DD'. First day of the schedule; every-n-days counts from it.",
    ),
  endDate: z
    .string()
    .regex(DAY)
    .optional()
    .describe(
      "DATA-BOUND. 'YYYY-MM-DD'. Last day of a course, e.g. antibiotics. Shows 'Ends Oct 14, 6 days left'.",
    ),
})

export const medicationLogEntrySchema = z.object({
  at: z.string().describe("ISO 8601 with offset: when it was logged."),
  status: z.enum(["taken", "skipped"]),
  scheduledFor: z
    .string()
    .optional()
    .describe(
      "The dose it's for: the ISO instant of a timed dose, or 'YYYY-MM-DD' for an untimed one. When missing, matched to the nearest dose that day.",
    ),
})

export const medicationSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in results."),
  name: z
    .string()
    .max(60)
    .describe("DATA-BOUND. As the user or label names it, e.g. 'Vitamin D3'."),
  strength: z
    .string()
    .max(30)
    .optional()
    .describe(
      "DATA-BOUND. As written on the label, e.g. '1000 IU' or '500 mg'. Never your own suggestion.",
    ),
  instructions: z
    .string()
    .max(80)
    .optional()
    .describe(
      "DATA-BOUND. Copied from the label or prescription, e.g. 'With food'. Never advice of your own.",
    ),
  schedule: medicationScheduleSchema,
  log: z
    .array(medicationLogEntrySchema)
    .max(200)
    .optional()
    .describe(
      "DATA-BOUND. Doses already logged (this week is enough). Never invent history.",
    ),
  refill: z
    .object({
      remaining: z
        .number()
        .int()
        .min(0)
        .describe("DATA-BOUND. Doses or pills left."),
      unit: z.enum(["doses", "pills"]).optional().describe("Default 'doses'."),
      refillBy: z
        .string()
        .regex(DAY)
        .optional()
        .describe(
          "DATA-BOUND. 'YYYY-MM-DD' from the pharmacy or prescription.",
        ),
    })
    .optional()
    .describe(
      "DATA-BOUND. Supply on hand. The card warns when it lasts 7 days or less at this schedule.",
    ),
})

export const medicationReminderSchema = z.object({
  medications: z.array(medicationSchema).min(1).max(6),
  timeZone: z
    .string()
    .describe(
      "IANA time zone the times apply in, e.g. 'America/New_York'. Never an abbreviation.",
    ),
  weekStart: z
    .union([z.literal(0), z.literal(1)])
    .optional()
    .describe("0 = Sunday (default), 1 = Monday. Match the user's locale."),
  reminders: z
    .boolean()
    .optional()
    .describe(
      "Set true only when your host can actually send reminders. Adds a 'Reminders' switch.",
    ),
  locale: z
    .string()
    .optional()
    .describe(
      "BCP 47 locale for times, dates and weekday names, e.g. 'en-GB'.",
    ),
})

export type MedicationSchedule = z.infer<typeof medicationScheduleSchema>
export type MedicationLogEntry = z.infer<typeof medicationLogEntrySchema>
export type Medication = z.infer<typeof medicationSchema>
export type MedicationReminderInput = z.input<typeof medicationReminderSchema>

/** One dose the user logged in the card. */
export type MedicationDoseLog = {
  medId: string
  /** The dose: an ISO instant for timed doses, 'YYYY-MM-DD' for untimed ones. */
  scheduledFor: string
  status: "taken" | "skipped"
  /** ISO 8601: when the user logged it. */
  at: string
}

/**
 * Saved dose changes (`onProgress` → `progress`). Not sent to the agent.
 * `scheduledFor` ties each change to its dose.
 */
export type MedicationReminderProgress = {
  medId: string
  at: string
  status: "taken" | "skipped"
  scheduledFor?: string
}[]

/** What the component sends back to the agent. A closed set of actions. */
export type MedicationReminderResult =
  /**
   * Every dose logged in this card so far, latest state (an undone dose drops
   * out). Sent 1 s after the last change.
   */
  | { action: "log"; entries: MedicationDoseLog[] }
  /** The user turned reminders on or off (only with `reminders`). */
  | { action: "reminders"; enabled: boolean }
  /** The user asked for a refill. Hand off to the pharmacy flow. */
  | { action: "refill"; medId: string }

/** Usage guidance the agent reads before choosing this component. */
export const medicationReminderGuidance = {
  useWhen: [
    "The user wants to track or be reminded about medicines or supplements they already take: 'remind me to take vitamin D three times a week', 'did I take my antibiotics today?', 'set up reminders for my prescription'.",
    "You have the schedule from the user's own words or their prescription data.",
  ],
  avoidWhen: [
    "The user asks what to take, how much, or when. Don't answer with a schedule; suggest they ask their pharmacist or clinician.",
    "You'd have to guess any part of the schedule. Ask the user instead.",
    "The question is about side effects, interactions or symptoms. This is a log, not advice.",
  ],
  rules: [
    "Use only the schedule the user or their prescription gave. Never suggest or fill in doses, times, strengths or medicines.",
    "Copy strength and instructions exactly as written on the label; leave them out when unknown.",
    "Never put dosing advice or diagnosis anywhere in the props.",
    "log must come from stored history. Never invent past doses.",
    "Set reminders only when your host can send them.",
    "On 'log', store the entries: write new ones and remove ones that dropped out (undone). On 'refill', hand off to the pharmacy flow; don't order anything yourself.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(medicationReminderSchema)`.
 */
export const medicationReminderTool = {
  name: "show_medication_schedule",
  description: [
    "Show the user's medicine or supplement schedule: this week's doses at a glance and today's doses to mark taken or skipped.",
    `Use when: ${medicationReminderGuidance.useWhen.join(" ")}`,
    `Avoid when: ${medicationReminderGuidance.avoidWhen.join(" ")}`,
    `Rules: ${medicationReminderGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: medicationReminderSchema,
} as const
