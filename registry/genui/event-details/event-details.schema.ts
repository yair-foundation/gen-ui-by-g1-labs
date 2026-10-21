import { z } from "zod"

/**
 * Event details: the agent's contract.
 *
 * One event the user is interested in or invited to: a conference, concert,
 * meetup, webinar, wedding, match or class. Every time, place, price and count
 * is DATA-BOUND: it must come from a tool result (an invite, a calendar, a
 * ticketing or event page), never from model free text.
 */

const isoDateOrDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}.*)?$/,
    "ISO 8601 date ('2026-10-24') or date-time ('2026-10-15T18:30:00-04:00')",
  )

export const eventKinds = [
  "conference",
  "concert",
  "meetup",
  "webinar",
  "party",
  "sports",
  "class",
  "other",
] as const

export const rsvpStates = ["none", "going", "maybe", "not-going"] as const

export const eventVenueSchema = z.object({
  name: z
    .string()
    .max(80)
    .describe("e.g. 'Acme Studio, 4th floor', or 'Online' for a webinar."),
  address: z
    .string()
    .max(160)
    .optional()
    .describe("Street address. Adds a Directions link."),
  online: z
    .object({
      platform: z.string().max(40).describe("e.g. 'Acme Live'."),
      url: z
        .string()
        .optional()
        .describe("Join link. http(s) only; others are ignored."),
    })
    .optional()
    .describe("For online or hybrid events."),
})

export const agendaItemSchema = z.object({
  time: z
    .string()
    .max(32)
    .describe(
      "'18:30' (local time at the event) or an ISO date-time. Shown in the event's timezone.",
    ),
  title: z.string().max(80).describe("e.g. 'Ceremony' or 'Keynote'."),
  speaker: z.string().max(60).optional(),
})

export const eventPersonSchema = z.object({
  name: z.string().max(60),
  role: z
    .string()
    .max(60)
    .optional()
    .describe("e.g. 'Design systems lead, Acme' or 'Headliner'."),
})

export const eventPriceSchema = z.union([
  z.literal("free"),
  z.object({
    amount: z.number().min(0),
    currency: z.string().length(3).describe("ISO 4217, e.g. 'USD'."),
  }),
])

export const eventDetailsSchema = z.object({
  title: z.string().max(120).describe("DATA-BOUND. The event's name."),
  kind: z
    .enum(eventKinds)
    .optional()
    .describe("Picks the people heading, e.g. 'Lineup' for a concert."),
  start: isoDateOrDateTime.describe(
    "DATA-BOUND. ISO 8601 with the venue's UTC offset, e.g. '2026-10-15T18:30:00-04:00' (without an offset it's local time at the event). A date only ('2026-10-24') is an all-day event.",
  ),
  end: isoDateOrDateTime
    .optional()
    .describe(
      "DATA-BOUND. Same format. For all-day events, the last day (inclusive).",
    ),
  timeZone: z
    .string()
    .describe(
      "DATA-BOUND. The event's IANA timezone, e.g. 'America/New_York'. Times show in it.",
    ),
  allDay: z.boolean().optional().describe("Treat the dates as all-day."),
  venue: eventVenueSchema.optional().describe("DATA-BOUND."),
  description: z
    .string()
    .max(600)
    .optional()
    .describe(
      "Plain text, up to 600 characters. **Bold** for one or two key details.",
    ),
  agenda: z
    .array(agendaItemSchema)
    .max(12)
    .optional()
    .describe("DATA-BOUND. In order."),
  people: z
    .array(eventPersonSchema)
    .max(12)
    .optional()
    .describe("DATA-BOUND. Speakers or lineup."),
  price: eventPriceSchema.optional().describe("DATA-BOUND. Per ticket."),
  capacity: z
    .object({
      going: z.number().int().min(0),
      max: z.number().int().positive().optional(),
    })
    .optional()
    .describe("DATA-BOUND. Attendee count and total spots."),
  dressCode: z.string().max(40).optional().describe("e.g. 'Garden formal'."),
  ageLimit: z.string().max(24).optional().describe("e.g. '21+' or 'All ages'."),
  accessibility: z
    .array(z.string().max(40))
    .max(8)
    .optional()
    .describe("DATA-BOUND. e.g. 'Step-free access', 'Live captions'."),
  rsvp: z
    .object({
      state: z
        .enum(rsvpStates)
        .describe("The user's current answer; 'none' if they haven't."),
      deadline: isoDateOrDateTime
        .optional()
        .describe("RSVP by, ISO 8601. Answers close after it."),
    })
    .optional()
    .describe(
      "DATA-BOUND. Only when the user can respond to this event. Adds Going / Maybe / Can't go.",
    ),
  url: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. Tickets or registration page. Adds 'Get tickets' ('Register' when free). http(s) only.",
    ),
  image: z
    .object({
      src: z
        .string()
        .describe("http(s), same-origin /path or a data:image URI."),
      alt: z.string().max(120),
    })
    .optional()
    .describe("DATA-BOUND. The event's own image, if it has one."),
})

export type EventKind = (typeof eventKinds)[number]
export type RsvpState = (typeof rsvpStates)[number]
export type EventVenue = z.infer<typeof eventVenueSchema>
export type AgendaItem = z.infer<typeof agendaItemSchema>
export type EventPerson = z.infer<typeof eventPersonSchema>
export type EventPrice = z.infer<typeof eventPriceSchema>
export type EventDetailsInput = z.input<typeof eventDetailsSchema>

/**
 * What the component sends back. A closed set. 'rsvp' can be sent again after
 * the user presses Change; the others are sent once each.
 */
export type EventDetailsResult =
  | { action: "rsvp"; state: Exclude<RsvpState, "none"> }
  | { action: "add-to-calendar" }
  | { action: "get-tickets" }
  | { action: "share" }

/** Usage guidance the agent reads before choosing this component. */
export const eventDetailsGuidance = {
  useWhen: [
    "The user asks about one specific event they're interested in or invited to: a conference, concert, meetup, webinar, wedding, match or class.",
    "They want the when and where, the dress code, the agenda or who's speaking, or to RSVP, add it to their calendar or get tickets.",
  ],
  avoidWhen: [
    "You don't have the event from a tool result. Never invent times, venues, prices or attendee counts.",
    "The user wants their ticket or entry code. Use show_event_pass.",
    "There are several events to choose from, or a whole day's schedule. Use a list or the calendar.",
  ],
  rules: [
    "Pass start and end with the venue's UTC offset (or as local time) and the event's IANA timeZone, exactly as the source gives them. Never convert to the user's timezone.",
    "Use a date-only start for all-day events; end is then the last day.",
    "Only include rsvp when the user can actually respond, with their current answer.",
    "Keep the description to useful facts the other fields don't cover, with **bold** for one or two key details.",
    "Every action is a handoff: on 'rsvp', record the answer through the event's own system; 'get-tickets' opens url; 'add-to-calendar' and 'share' happen on the device.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(eventDetailsSchema)`.
 */
export const eventDetailsTool = {
  name: "show_event",
  description: [
    "Show one event: date and time in the event's timezone, venue with directions or an online join link, key facts (price, capacity, dress code, age, accessibility), description, agenda and speakers, with RSVP, add to calendar, get tickets and share.",
    `Use when: ${eventDetailsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${eventDetailsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${eventDetailsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: eventDetailsSchema,
} as const
