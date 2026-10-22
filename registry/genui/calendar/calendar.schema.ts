import { z } from "zod"

/**
 * Calendar: the agent's contract.
 *
 * The user's real schedule, read from their calendar, plus any changes the
 * agent proposes, shown in context before anything is written. Fields marked
 * DATA-BOUND must come from a tool result, never from model free text.
 */

const dayKey = /^\d{4}-\d{2}-\d{2}$/
const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/

export const calendarEventSchema = z.object({
  id: z
    .string()
    .describe(
      "DATA-BOUND. The event's id in the calendar. Proposals refer to it.",
    ),
  title: z.string().describe("DATA-BOUND."),
  start: z
    .string()
    .describe(
      "DATA-BOUND. ISO date-time with offset, e.g. '2026-10-13T14:00:00-04:00'. A date-time without an offset is read in `timezone`; for all-day events use 'YYYY-MM-DD'.",
    ),
  end: z
    .string()
    .describe(
      "DATA-BOUND. Same format as start. For all-day events the end date is exclusive: '2026-10-15' to '2026-10-17' is two days.",
    ),
  allDay: z.boolean().optional().describe("DATA-BOUND."),
  busy: z
    .boolean()
    .optional()
    .describe(
      "DATA-BOUND. Whether the event blocks time. Defaults to true for timed events and false for all-day events, which only count as busy when set to true.",
    ),
})

export const calendarTodoSchema = z.object({
  id: z.string().describe("DATA-BOUND. The task's id in the task app."),
  title: z.string().describe("DATA-BOUND."),
  done: z.boolean().optional().describe("DATA-BOUND. Already completed."),
})

export const calendarProposalSchema = z
  .object({
    id: z
      .string()
      .describe("Stable identifier for this change. Returned in the result."),
    kind: z
      .enum(["create", "move", "cancel"])
      .describe(
        "'create' adds an event, 'move' changes an event's time, 'cancel' removes it.",
      ),
    eventId: z
      .string()
      .optional()
      .describe(
        "Required for move and cancel: the id of an event in `events`.",
      ),
    title: z
      .string()
      .describe(
        "The event's title. For move and cancel, the existing event's title.",
      ),
    start: z
      .string()
      .describe(
        "ISO date-time with offset. For a move, the new start; for a cancel, the event's current start.",
      ),
    end: z.string().describe("Same format as start."),
    reason: z
      .string()
      .max(140)
      .optional()
      .describe("One line on why, e.g. 'Dana is free Thursday afternoon'."),
  })
  .refine((p) => p.kind === "create" || !!p.eventId, {
    message: "move and cancel proposals need an eventId",
    path: ["eventId"],
  })

export const calendarSchema = z.object({
  title: z
    .string()
    .optional()
    .describe(
      "e.g. 'Your week' or 'Move 1:1 with Dana'. Defaults to the range.",
    ),
  timezone: z
    .string()
    .describe(
      "IANA timezone to show the schedule in, e.g. 'America/New_York'. Use the user's zone.",
    ),
  view: z
    .enum(["week", "day", "month", "today"])
    .default("week")
    .describe(
      "'week': a time grid of up to 7 days from range.start. 'day': the same grid for one day. 'month': the month of range.start as day tiles. 'today': a list of one day's events (range.start) and to-dos, for 'what's on today?'.",
    ),
  range: z
    .object({
      start: z
        .string()
        .regex(dayKey)
        .describe(
          "First day shown, 'YYYY-MM-DD'. For month, any day in the month.",
        ),
      days: z
        .number()
        .int()
        .min(1)
        .max(7)
        .optional()
        .describe(
          "Week only: how many days the grid shows, e.g. 5 for a work week. Defaults to 7.",
        ),
    })
    .describe("The period the events were fetched for."),
  events: z
    .array(calendarEventSchema)
    .max(300)
    .describe(
      "DATA-BOUND. Every event in the range, read from the calendar connector.",
    ),
  todos: z
    .array(calendarTodoSchema)
    .max(20)
    .optional()
    .describe(
      "DATA-BOUND. View 'today' only: the day's tasks, read from the task connector, listed after the events.",
    ),
  proposals: z
    .array(calendarProposalSchema)
    .max(20)
    .optional()
    .describe(
      "Changes you propose. Omit to just show the schedule; with proposals the user accepts or declines each and you get a result.",
    ),
  workingHours: z
    .object({
      start: z.string().regex(hhmm).describe("'HH:mm', e.g. '09:00'."),
      end: z.string().regex(hhmm).describe("'HH:mm', e.g. '18:00'."),
    })
    .optional()
    .describe(
      "DATA-BOUND when known. The hours the grid shows (default 09:00–17:00); it grows to fit events outside them.",
    ),
  now: z
    .string()
    .optional()
    .describe(
      "ISO date-time that counts as now (marks today and what's on now). Leave it out in real use; the viewer's clock is used.",
    ),
})

export type CalendarEvent = z.input<typeof calendarEventSchema>
export type CalendarTodo = z.input<typeof calendarTodoSchema>
export type CalendarProposal = z.input<typeof calendarProposalSchema>
export type CalendarInput = z.input<typeof calendarSchema>
export type CalendarView = NonNullable<CalendarInput["view"]>

/** What the component sends back to the agent. Only when there are proposals. */
export type CalendarResult =
  | {
      action: "apply"
      /** Proposal ids the user accepted. Write exactly these, nothing else. */
      accepted: string[]
      /** Proposal ids the user declined. */
      declined: string[]
    }
  /** The user wants a different plan. Write nothing; propose again. */
  | { action: "revise"; feedback: string }
  /** The user closed it without deciding. Write nothing. */
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const calendarGuidance = {
  useWhen: [
    "The user asks what their day, week or month looks like.",
    "The user asks what's on today (or one specific day) and wants a quick glance: use view 'today', with the day's to-dos when you have them.",
    "You want to change their calendar (move, add or cancel events) and they should see the changes in context before you write them.",
    "A plan has times that interact with existing meetings: focus blocks, an offsite agenda, rescheduling.",
  ],
  avoidWhen: [
    "The user needs to pick one free time for a new booking. Use the slot picker.",
    "You have not read the calendar. Fetch events first; never invent a schedule.",
    "The question has a one-line answer, e.g. 'When is my next meeting?'. Say it in text.",
  ],
  rules: [
    "Every event must come from the calendar connector, with its real id and times; every to-do from the task connector.",
    "Set timezone to the user's zone and give times with offsets.",
    "For view 'today', set range.start to that day and pass only that day's events and to-dos. Use 'day' instead when the user wants that day as a timeline.",
    "Pass the whole range you fetched, including free events, so overlaps and conflicts are accurate.",
    "Use proposals for every change; give each a one-line reason. For move and cancel, set eventId to the existing event.",
    "Without proposals the calendar is display-only and returns nothing.",
    "To show another stretch of time, call it again with a new range and view: week shows up to 7 days (5 for a work week), month shows the whole month. Its look is fixed; say so if asked to restyle it.",
    "Write only the accepted proposal ids from an 'apply' result. On 'revise' or 'dismiss', write nothing.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(calendarSchema)`.
 */
export const calendarTool = {
  name: "show_calendar",
  description: [
    "Show the user's schedule from their calendar, optionally with proposed changes they accept or decline before anything is written.",
    `Use when: ${calendarGuidance.useWhen.join(" ")}`,
    `Avoid when: ${calendarGuidance.avoidWhen.join(" ")}`,
    `Rules: ${calendarGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: calendarSchema,
} as const
