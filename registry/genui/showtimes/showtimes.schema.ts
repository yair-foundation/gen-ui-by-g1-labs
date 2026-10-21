import { z } from "zod"

/**
 * Showtimes: the agent's contract.
 *
 * The user picks one session (a screening, a show, a class, a seating) from a
 * venue's schedule. Fields marked DATA-BOUND must come from a tool result,
 * never from model free text.
 */

export const showtimeSessionSchema = z.object({
  id: z
    .string()
    .describe("DATA-BOUND. The session's id in the booking system."),
  date: z.string().describe("DATA-BOUND. 'YYYY-MM-DD', venue local."),
  time: z.string().describe("DATA-BOUND. 'HH:mm' start time, venue local."),
  format: z
    .string()
    .max(16)
    .optional()
    .describe("DATA-BOUND. e.g. 'IMAX', '3D', 'Relaxed'."),
  soldOut: z.boolean().optional().describe("DATA-BOUND. Shown disabled."),
  fewLeft: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. Only a few seats or spots remain."),
  price: z
    .number()
    .nonnegative()
    .optional()
    .describe("DATA-BOUND. Price per ticket or spot, in `currency`."),
})

export const showtimeTitleSchema = z.object({
  id: z.string().describe("DATA-BOUND. The film, show or class id."),
  name: z.string().describe("e.g. 'The Long Harbor' or 'Rhythm Ride 45'."),
  subtitle: z
    .string()
    .optional()
    .describe("One line, e.g. 'PG-13 · 2 h 46 min · English' or 'with Maya'."),
  image: z
    .object({
      src: z.string().describe("DATA-BOUND. http(s) URL or same-origin path (starting with a single '/') of the poster."),
      alt: z.string(),
    })
    .optional()
    .describe("Omit when there's no real image; a monogram tile is shown."),
  tags: z
    .array(z.string().max(16))
    .max(3)
    .optional()
    .describe("e.g. 'Subtitled'. Up to 2 are shown."),
  sessions: z
    .array(showtimeSessionSchema)
    .describe("DATA-BOUND. Every session for this title, in time order."),
})

export const showtimesSchema = z.object({
  venue: z
    .object({
      name: z.string(),
      timeZone: z
        .string()
        .describe("IANA timezone of the venue; all times are local to it."),
    })
    .optional()
    .describe("DATA-BOUND."),
  days: z
    .array(
      z.object({
        date: z.string().describe("'YYYY-MM-DD'."),
        label: z.string().max(16).optional().describe("e.g. 'Today'."),
      }),
    )
    .min(1)
    .max(14)
    .describe("DATA-BOUND. The dates that have sessions, in order."),
  titles: z
    .array(showtimeTitleSchema)
    .min(1)
    .describe("DATA-BOUND. What's on, from the venue's schedule."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for session prices, e.g. 'USD'."),
  defaultDate: z
    .string()
    .optional()
    .describe("Day to open on, e.g. today for 'tonight'. Default: the first."),
  quantity: z
    .object({
      min: z.number().int().min(1),
      max: z.number().int().min(1),
      default: z.number().int().min(1),
      label: z
        .string()
        .max(16)
        .optional()
        .describe("e.g. 'Tickets', 'Spots', 'Guests'. Default 'Tickets'."),
    })
    .optional()
    .describe("Adds a stepper for how many tickets, seats or spots."),
  submitLabel: z
    .string()
    .optional()
    .describe("Verb for the button, e.g. 'Choose seats'. Default 'Continue'."),
})

export type ShowtimeSession = z.input<typeof showtimeSessionSchema>
export type ShowtimeTitle = z.input<typeof showtimeTitleSchema>
export type ShowtimesInput = z.input<typeof showtimesSchema>

/**
 * What the component sends back to the agent. A handoff: nothing is booked
 * or paid for.
 */
export type ShowtimesResult =
  | {
      action: "select"
      sessionId: string
      titleId: string
      /** 'YYYY-MM-DD', venue local. */
      date: string
      /** 'HH:mm', venue local, exactly as given. */
      time: string
      /** Only when `quantity` was set. */
      quantity?: number
    }
  /** The user closed it. Ask in text what they'd like instead. */
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const showtimesGuidance = {
  useWhen: [
    "The user wants to see what's on and pick a session: films, theater, concerts, classes, tours, restaurant seatings.",
    "You fetched a venue's schedule with real session ids.",
  ],
  avoidWhen: [
    "You haven't fetched the schedule. Never invent titles or times.",
    "There's one title with one session. Ask for a yes or no in text.",
    "Booking a generic appointment with no titles. Use a slot picker.",
  ],
  rules: [
    "Every title and session must come from a tool result, with its real id.",
    "Only include days that have sessions; mark sold-out sessions with soldOut instead of dropping them.",
    "Set defaultDate to the day the user asked about ('tonight' → today).",
    "The result is a choice, not a booking: check availability and confirm price before you book.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(showtimesSchema)`.
 */
export const showtimesTool = {
  name: "pick_showtime",
  description: [
    "Show a venue's schedule by day, with titles and session times, and let the user pick one session and how many tickets.",
    `Use when: ${showtimesGuidance.useWhen.join(" ")}`,
    `Avoid when: ${showtimesGuidance.avoidWhen.join(" ")}`,
    `Rules: ${showtimesGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: showtimesSchema,
} as const
