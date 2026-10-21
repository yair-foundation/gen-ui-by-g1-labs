import { z } from "zod";

/**
 * Flight ticket: the agent's contract.
 *
 * A booking or boarding pass the agent found in the user's email or airline
 * account. Every code, time, seat and reference is DATA-BOUND: it must come
 * from a tool result, never from model free text. The component never draws
 * a scannable code; the host renders its own wallet pass.
 */

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "ISO 8601 date-time, e.g. '2026-10-09T07:40:00+01:00'",
  );

export const flightTicketActions = [
  "check-in",
  "add-to-wallet",
  "choose-seat",
  "manage",
  "share",
] as const;

export const cabinClasses = [
  "economy",
  "premium",
  "business",
  "first",
] as const;

export const ticketAirportSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{3}$/, "3-letter IATA code")
    .describe("IATA airport code, e.g. 'LIS'."),
  city: z.string().max(40).describe("e.g. 'Lisbon'."),
  terminal: z.string().max(12).optional().describe("e.g. '1' or 'T5'."),
  gate: z.string().max(8).optional().describe("Departure gate, e.g. 'B12'."),
  timeZone: z
    .string()
    .describe(
      "The airport's IANA timezone, e.g. 'Europe/Lisbon'. Times show in it.",
    ),
});

export const ticketSegmentSchema = z.object({
  flightNumber: z.string().max(10).describe("e.g. 'NW 482'."),
  from: ticketAirportSchema,
  to: ticketAirportSchema.omit({ gate: true }),
  departAt: isoDateTime.describe(
    "Scheduled departure, ISO 8601 with the airport's offset, e.g. '2026-10-09T07:40:00+01:00'. Without an offset it's read as local time at the airport.",
  ),
  arriveAt: isoDateTime.describe("Scheduled arrival, same format."),
  duration: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Flight time in minutes. Computed from the times when absent."),
  boardingAt: isoDateTime.optional().describe("Boarding time, ISO 8601."),
  boardingGroup: z.string().max(8).optional().describe("e.g. '3' or 'B'."),
  operatedBy: z
    .string()
    .max(40)
    .optional()
    .describe("Codeshare operator, e.g. 'Harbor Connect'."),
});

export const ticketPassengerSchema = z.object({
  name: z.string().max(60).describe("As printed, e.g. 'Maya Cohen'."),
  seat: z.string().max(4).optional().describe("e.g. '14C'."),
  class: z.enum(cabinClasses).optional(),
});

export const flightTicketSchema = z.object({
  bookingRef: z
    .string()
    .regex(/^[A-Z0-9]{5,8}$/, "5–8 letters or digits")
    .describe("DATA-BOUND. The booking reference (PNR), e.g. 'K7Q2LM'."),
  airline: z
    .object({
      name: z.string().max(40).describe("e.g. 'Northwind Air'."),
      code: z.string().max(3).describe("IATA airline code, e.g. 'NW'."),
      logo: z
        .string()
        .optional()
        .describe(
          "DATA-BOUND. The airline's wordmark: http(s), a same-origin path starting with a single slash, or data:image. Only when the data provides one.",
        ),
      logoDark: z
        .string()
        .optional()
        .describe(
          "DATA-BOUND. The same wordmark in light lettering. The ticket is drawn on blue, so it shows this one; without it the airline's name is shown as text.",
        ),
    })
    .describe("DATA-BOUND."),
  passengers: z
    .array(ticketPassengerSchema)
    .min(1)
    .max(9)
    .describe("DATA-BOUND. Everyone on the booking."),
  segments: z
    .array(ticketSegmentSchema)
    .min(1)
    .max(4)
    .describe(
      "DATA-BOUND. Flights in order. Connections and their layover times are derived.",
    ),
  passType: z
    .enum(["booking", "boarding-pass"])
    .describe(
      "'booking' for a reservation; 'boarding-pass' once the passenger has checked in and has a pass.",
    ),
  checkInOpensAt: isoDateTime
    .optional()
    .describe("DATA-BOUND. When online check-in opens, ISO 8601."),
  checkedIn: z.boolean().optional().describe("DATA-BOUND."),
  barcode: z
    .object({
      format: z.enum(["qr", "pdf417", "aztec"]),
      label: z
        .string()
        .max(40)
        .optional()
        .describe("e.g. 'Sequence 042'. Never the encoded payload."),
    })
    .optional()
    .describe(
      "Boarding passes: the pass has a code. Only a placeholder is drawn; the host renders the scannable pass.",
    ),
  source: z
    .object({
      label: z
        .string()
        .max(60)
        .describe(
          "Where it was found, e.g. 'Northwind Air confirmation email'.",
        ),
      url: z
        .string()
        .optional()
        .describe("Link to the original. http(s) only; others are ignored."),
    })
    .describe("DATA-BOUND. Where the booking came from."),
  actions: z
    .array(z.enum(flightTicketActions))
    .max(5)
    .optional()
    .describe(
      "Buttons, the first is primary. Default: boarding pass → add-to-wallet, share; booking with check-in open → check-in, choose-seat, manage; checked in → add-to-wallet, manage; otherwise manage, choose-seat. Check-in is hidden once checked in.",
    ),
});

export type TicketAirport = z.infer<typeof ticketAirportSchema>;
export type TicketSegment = z.infer<typeof ticketSegmentSchema>;
export type TicketPassenger = z.infer<typeof ticketPassengerSchema>;
export type FlightTicketInput = z.input<typeof flightTicketSchema>;

/**
 * What the component sends back, once per action. A closed set; every action
 * is a handoff to the host (its check-in flow, wallet pass, seat map, share
 * sheet or the airline's manage-booking page).
 */
export type FlightTicketResult = {
  action: (typeof flightTicketActions)[number];
};

/** Usage guidance the agent reads before choosing this component. */
export const flightTicketGuidance = {
  useWhen: [
    "The user asks about a flight they booked and you found the booking or boarding pass in their email or airline account: when it leaves, their seat, the gate, their booking reference.",
    "They want to see their boarding pass, check in, or act on the booking.",
  ],
  avoidWhen: [
    "You don't have the booking from a tool result. Never invent times, seats, gates or references.",
    "The user asks whether a flight is on time or where it is now. Use track_flight.",
    "The user is still searching for flights to buy.",
  ],
  rules: [
    "Pass every time with the airport's UTC offset and the airport's IANA timezone, exactly as the source gives them. Never convert times to the user's timezone.",
    "Use one segment per flight, in order; the component works out layovers and flags connections under an hour.",
    "Use passType 'boarding-pass' only when the source has an issued pass. Never generate barcode contents.",
    "Every action is a handoff: on 'check-in', 'add-to-wallet', 'choose-seat', 'manage' or 'share', open the airline's or host's own flow. Never check in or change seats yourself without confirming.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(flightTicketSchema)`.
 */
export const flightTicketTool = {
  name: "show_flight_ticket",
  description: [
    "Show a flight booking or boarding pass: route, local times, connections, seats, gate and boarding details, with actions like check in or add to wallet (handoffs to the host).",
    `Use when: ${flightTicketGuidance.useWhen.join(" ")}`,
    `Avoid when: ${flightTicketGuidance.avoidWhen.join(" ")}`,
    `Rules: ${flightTicketGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: flightTicketSchema,
} as const;
