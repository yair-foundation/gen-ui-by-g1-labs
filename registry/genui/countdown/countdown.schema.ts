import { z } from "zod"

/**
 * Countdown: the agent's contract.
 *
 * Days left until a date that matters: a trip, a launch, a wedding, a
 * deadline. The time itself is computed in the component from the viewer's
 * clock, never by the model.
 */

export const countdownEventSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .max(60)
    .describe(
      "The event as it reads after 'until': 'Lisbon trip', 'Acme launch', 'the tax deadline'.",
    ),
  at: z
    .string()
    .describe(
      "When it happens. 'YYYY-MM-DD' for a whole day (counts to midnight local time), a local date-time '2026-12-01T09:00' (in timeZone), or an exact moment with an offset '2026-12-01T09:00:00-05:00'. DATA-BOUND when it comes from a booking, calendar or other tool result.",
    ),
  timeZone: z
    .string()
    .optional()
    .describe(
      "IANA timezone where the date or local time applies, e.g. 'America/New_York'. Never an abbreviation. Default: the viewer's.",
    ),
  since: z
    .string()
    .optional()
    .describe(
      "ISO date the wait started, e.g. when the trip was booked or planning began. Adds a progress bar.",
    ),
  note: z
    .string()
    .max(120)
    .optional()
    .describe(
      "One short line, e.g. 'Flight at 7:40 AM, Terminal 2'. First event only, for screen readers and the calendar file.",
    ),
  url: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. An http(s) link for the event, e.g. the booking. First event only. Never invent one.",
    ),
})

export const countdownMilestoneSchema = z.object({
  label: z
    .string()
    .max(60)
    .describe(
      "Something to do before the first event: 'Book airport transfer'.",
    ),
  daysBefore: z
    .number()
    .int()
    .min(0)
    .max(3650)
    .describe(
      "Days before the first event's date, e.g. 7. 0 is the day itself.",
    ),
})

export const countdownSchema = z.object({
  events: z
    .array(countdownEventSchema)
    .min(1)
    .max(5)
    .describe(
      "1–5 dates. The first is the big countdown; the rest are listed below it, soonest first.",
    ),
  precision: z
    .enum(["days", "hours", "minutes", "seconds"])
    .optional()
    .describe(
      "Smallest unit shown. Default: days while more than 2 days away, then hours, minutes and seconds as it gets close.",
    ),
  countBusinessDays: z
    .boolean()
    .default(false)
    .describe(
      "Also show working days left (Monday to Friday, holidays not excluded). For work deadlines.",
    ),
  milestones: z
    .array(countdownMilestoneSchema)
    .max(8)
    .optional()
    .describe(
      "Things to do before the first event, placed by days before it, e.g. 'Book airport transfer' 7 days before.",
    ),
})

export type CountdownEvent = z.infer<typeof countdownEventSchema>
export type CountdownMilestone = z.infer<typeof countdownMilestoneSchema>
export type CountdownInput = z.input<typeof countdownSchema>

/** Fired when the user uses a footer action. For analytics; nothing locks. */
export type CountdownResult = {
  action: "add-to-calendar" | "share"
  /** The event the action was for (the first event). */
  eventId: string
}

/** Usage guidance the agent reads before choosing this component. */
export const countdownGuidance = {
  useWhen: [
    "The user asks how long until a date: a trip, a launch, a wedding, a deadline, a due date, a holiday.",
    "The user wants to see a few upcoming dates side by side, counted down.",
  ],
  avoidWhen: [
    "The user wants to time minutes or hours they start and stop: cooking, a workout, a talk. Use the timer.",
    "The user needs a reminder to fire at a time. Use a reminder or calendar tool.",
    "The date is unknown or only implied. Ask, or look it up first; never guess a date.",
    "The question is about the past only, e.g. 'how long ago was…'. Answer in text.",
  ],
  rules: [
    "Use a plain date for whole-day events (trips, birthdays, deadlines) and a date-time with timeZone for events at a time (a launch at 9 AM New York).",
    "Put the event the user asked about first; order the rest soonest first.",
    "Leave precision unset unless the user asks for hours or seconds; it tightens on its own as the date gets close.",
    "Set since only when you know when the wait began, e.g. the booking date from a tool result.",
    "Turn on countBusinessDays for work deadlines, and say that holidays aren't excluded if it matters.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(countdownSchema)`.
 */
export const countdownTool = {
  name: "show_countdown",
  description: [
    "Show how many days are left until a date that matters, with optional progress, working days, milestones and other upcoming dates.",
    `Use when: ${countdownGuidance.useWhen.join(" ")}`,
    `Avoid when: ${countdownGuidance.avoidWhen.join(" ")}`,
    `Rules: ${countdownGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: countdownSchema,
} as const
