import { z } from "zod"

/**
 * Event pass: the agent's contract.
 *
 * Admission to an event: a concert ticket, a conference badge, museum entry,
 * a match ticket. Everything is DATA-BOUND: it must come from the ticketing
 * provider's tool result. Entry codes are drawn exactly as the provider gives
 * them and never invented.
 */

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "ISO 8601 date-time, e.g. '2026-10-08T20:00:00-04:00'",
  )

export const ticketStates = [
  "valid",
  "used",
  "transferred",
  "refunded",
] as const

export const eventPassActions = [
  "add-to-wallet",
  "transfer",
  "download",
] as const

export const ticketCodeSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("qr"),
    value: z
      .string()
      .min(1)
      .max(1000)
      .describe(
        "The scannable payload exactly as the provider gives it. Never generated.",
      ),
  }),
  z.object({
    format: z.literal("barcode-placeholder"),
    label: z
      .string()
      .max(80)
      .describe(
        "Where the real code lives, e.g. 'Barcode in the Acme Tickets app'.",
      ),
  }),
])

export const passTicketSchema = z.object({
  id: z.string().describe("The provider's ticket ID. Returned in the result."),
  type: z
    .string()
    .max(40)
    .describe("e.g. 'General admission', 'VIP', 'Day pass'."),
  section: z.string().max(12).optional(),
  row: z.string().max(8).optional(),
  seat: z.string().max(8).optional(),
  gate: z.string().max(12).optional(),
  entrance: z.string().max(40).optional().describe("e.g. 'North lobby'."),
  code: ticketCodeSchema
    .optional()
    .describe(
      "The entry code. A QR is drawn from `value`; a placeholder only points to the provider's app. Hidden on used, transferred or refunded tickets.",
    ),
  ticketState: z
    .enum(ticketStates)
    .optional()
    .describe(
      "Default 'valid'. Used, transferred and refunded tickets show no code.",
    ),
  usedAt: isoDateTime
    .optional()
    .describe("When a used ticket was scanned, ISO 8601."),
  transferredTo: z
    .string()
    .max(60)
    .optional()
    .describe("Who a transferred ticket went to, e.g. 'Noa Levi'."),
})

export const eventPassSchema = z.object({
  event: z
    .object({
      title: z.string().max(120),
      start: isoDateTime.describe(
        "ISO 8601 with the venue's UTC offset (without one it's local time at the venue).",
      ),
      end: isoDateTime.optional(),
      timeZone: z
        .string()
        .describe("The venue's IANA timezone, e.g. 'America/New_York'."),
      venue: z.object({ name: z.string().max(80) }),
    })
    .describe("DATA-BOUND."),
  holder: z
    .object({ name: z.string().max(60) })
    .optional()
    .describe("DATA-BOUND. The name on the tickets or badge."),
  tickets: z
    .array(passTicketSchema)
    .min(1)
    .max(6)
    .describe("DATA-BOUND. One per admission, in the provider's order."),
  doorsOpen: isoDateTime.optional().describe("DATA-BOUND. ISO 8601."),
  rules: z
    .array(z.string().max(80))
    .max(4)
    .optional()
    .describe("DATA-BOUND. e.g. 'No re-entry', 'Bags under 30×20 cm'."),
  transferable: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. Adds Transfer on valid tickets."),
  walletAvailable: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. Adds Add to wallet on valid tickets."),
})

export type TicketCode = z.infer<typeof ticketCodeSchema>
export type PassTicket = z.infer<typeof passTicketSchema>
export type EventPassInput = z.input<typeof eventPassSchema>

/**
 * What the component sends back, once per action and ticket. A closed set;
 * every action is a handoff to the host or the ticketing provider.
 */
export type EventPassResult = {
  action: (typeof eventPassActions)[number]
  ticketId: string
}

/** Usage guidance the agent reads before choosing this component. */
export const eventPassGuidance = {
  useWhen: [
    "The user wants to see their ticket, badge or pass for an event and you have it from the ticketing provider: 'show my ticket for tonight', 'my conference badge', 'tickets for the match'.",
    "They want to add it to their wallet, transfer a ticket or download it.",
  ],
  avoidWhen: [
    "You don't have the tickets from a tool result. Never invent seats or entry codes.",
    "The user asks about the event itself (agenda, dress code, RSVP). Use show_event.",
    "It's a flight. Use show_flight_ticket.",
  ],
  rules: [
    "Pass code.value exactly as the provider returns it. If you only know the code exists in the provider's app, use format 'barcode-placeholder'.",
    "Set ticketState for used, transferred and refunded tickets; their codes are never shown.",
    "Pass times with the venue's UTC offset and its IANA timeZone; never convert them to the user's timezone.",
    "Every action is a handoff: on 'add-to-wallet', 'transfer' or 'download', open the provider's or host's own flow for that ticketId. Never transfer a ticket without confirming.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(eventPassSchema)`.
 */
export const eventPassTool = {
  name: "show_event_pass",
  description: [
    "Show event tickets or a badge as ticket stubs: event, time and doors, venue, section/row/seat/gate, holder, state, and a scannable QR drawn from the provider's code, with add to wallet, transfer and download (handoffs to the host).",
    `Use when: ${eventPassGuidance.useWhen.join(" ")}`,
    `Avoid when: ${eventPassGuidance.avoidWhen.join(" ")}`,
    `Rules: ${eventPassGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: eventPassSchema,
} as const
