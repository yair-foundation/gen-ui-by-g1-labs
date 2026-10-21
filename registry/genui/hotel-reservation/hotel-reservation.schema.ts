import { z } from "zod";

/**
 * Hotel reservation: the agent's contract.
 *
 * The stay card for a hotel the user has already booked, for use during the
 * trip: when check-in opens, which room, the Wi-Fi, what's due. Every name,
 * date, number and code is DATA-BOUND: it comes from the booking or the
 * hotel's app, never from model free text. To book a hotel, use
 * book_hotel instead.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Calendar date, e.g. '2026-10-15'");

const clock = z
  .string()
  .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "24-hour time, e.g. '15:00'");

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "ISO 8601 date-time with offset, e.g. '2026-10-14T23:59:00+01:00'",
  );

export const hotelReservationActions = [
  "check-in",
  "open-digital-key",
  "request-late-checkout",
] as const;

export const reservationHotelSchema = z.object({
  name: z.string().max(80).describe("e.g. 'Casa Azulejo Lisboa'."),
  address: z
    .string()
    .max(160)
    .describe(
      "Street address with the city, e.g. 'Rua das Flores 28, 1200-195 Lisbon'. Used for Directions and the calendar file.",
    ),
  phone: z
    .string()
    .max(32)
    .optional()
    .describe(
      "The front desk, with country code, e.g. '+351 21 000 0428'. Used for Call.",
    ),
  timeZone: z
    .string()
    .describe(
      "The hotel's IANA timezone, e.g. 'Europe/Lisbon'. 'Tonight' and times are read in it.",
    ),
  checkInFrom: clock.describe("Earliest check-in, hotel time, e.g. '15:00'."),
  checkOutUntil: clock.describe("Latest check-out, hotel time, e.g. '11:00'."),
  url: z
    .string()
    .optional()
    .describe("The hotel's website. http(s) only. In the calendar file only."),
});

export const reservationStaySchema = z
  .object({
    checkIn: isoDate.describe("Arrival date, e.g. '2026-10-15'."),
    checkOut: isoDate.describe("Departure date, after checkIn."),
  })
  .refine((s) => s.checkOut > s.checkIn, {
    message: "checkOut must be after checkIn",
    path: ["checkOut"],
  });

export const hotelReservationSchema = z.object({
  hotel: reservationHotelSchema.describe("DATA-BOUND."),
  confirmation: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[A-Za-z0-9-]+$/, "Letters, digits and dashes")
    .describe("DATA-BOUND. The confirmation number, e.g. 'CAZ-48213'."),
  stay: reservationStaySchema.describe("DATA-BOUND."),
  room: z
    .object({
      type: z.string().max(60).describe("e.g. 'Deluxe King'."),
      number: z
        .string()
        .max(8)
        .optional()
        .describe("Only once the hotel has assigned a room, e.g. '512'."),
      floor: z
        .union([z.string().max(8), z.number().int()])
        .optional()
        .describe("e.g. '5'. Only with an assigned room."),
    })
    .optional()
    .describe(
      "DATA-BOUND. Without a number the card says 'Room assigned at check-in'.",
    ),
  digitalKey: z
    .object({
      available: z.boolean(),
      url: z
        .string()
        .optional()
        .describe("Opens the key in the hotel's app. http(s) only."),
    })
    .optional()
    .describe("DATA-BOUND. Whether a phone key exists for this stay."),
  checkIn: z
    .object({
      online: z.boolean().describe("The hotel offers online check-in."),
      done: z.boolean().optional().describe("The guest has checked in."),
      url: z
        .string()
        .optional()
        .describe("The hotel's online check-in page. http(s) only."),
    })
    .optional()
    .describe("DATA-BOUND. Online check-in."),
  wifi: z
    .object({
      network: z.string().max(64).describe("e.g. 'CasaAzulejo-Guest'."),
      password: z
        .string()
        .max(64)
        .optional()
        .describe(
          "Masked until the user taps Show. Never sent back in a result.",
        ),
    })
    .optional()
    .describe("DATA-BOUND."),
  balance: z
    .object({
      due: z.number().min(0).describe("Amount still to pay at the hotel."),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/, "ISO 4217 code")
        .describe("e.g. 'EUR'."),
    })
    .optional()
    .describe("DATA-BOUND. What's due at the hotel."),
  cancellation: z
    .object({
      freeUntil: isoDateTime
        .optional()
        .describe("Free cancellation deadline, ISO 8601 with offset."),
    })
    .optional()
    .describe("DATA-BOUND. Shown before the stay starts."),
});

export type ReservationHotel = z.infer<typeof reservationHotelSchema>;
export type ReservationStay = z.infer<typeof reservationStaySchema>;
export type HotelReservationInput = z.input<typeof hotelReservationSchema>;

/**
 * What the component sends back, once per action. A closed set; every action
 * is a handoff (the hotel's check-in page, its app's digital key, or a
 * late check-out request the agent passes to the hotel). Directions, Call and
 * Add to calendar run locally and send nothing. The Wi-Fi password is never
 * part of a result.
 */
export type HotelReservationResult = {
  action: (typeof hotelReservationActions)[number];
};

/** Usage guidance the agent reads before choosing this component. */
export const hotelReservationGuidance = {
  useWhen: [
    "The user has a hotel booked and asks about it before or during the trip: 'my hotel for tonight', 'what time is check-in?', 'how do I get into my room?', 'what's the Wi-Fi?'.",
    "They want to check in online, open their digital key, call the hotel or get directions.",
  ],
  avoidWhen: [
    "The user is still choosing or booking a hotel. Use book_hotel.",
    "You don't have the reservation from a tool result. Never invent confirmation numbers, rooms, Wi-Fi details or balances.",
  ],
  rules: [
    "Pass stay dates as calendar dates and check-in/out times as the hotel prints them, with the hotel's IANA timezone. Never convert them to the user's timezone.",
    "Pass room.number only when the hotel has assigned one.",
    "Pass the Wi-Fi password only from the hotel's own data. It is masked until the user taps Show and never comes back in a result; don't repeat it in your reply unless asked.",
    "Every action is a handoff: on 'check-in' or 'open-digital-key' open the hotel's flow; on 'request-late-checkout' ask the hotel and report the answer. Never say it's granted until the hotel confirms.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(hotelReservationSchema)`.
 */
export const hotelReservationTool = {
  name: "show_hotel_reservation",
  description: [
    "Show the stay card for a booked hotel during the trip: tonight or in N days, check-in and check-out times, the room, digital key and online check-in, Wi-Fi, what's due, with directions, call, add to calendar and late check-out.",
    `Use when: ${hotelReservationGuidance.useWhen.join(" ")}`,
    `Avoid when: ${hotelReservationGuidance.avoidWhen.join(" ")}`,
    `Rules: ${hotelReservationGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: hotelReservationSchema,
} as const;
