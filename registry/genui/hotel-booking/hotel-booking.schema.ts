import { z } from "zod";

/**
 * Hotel Booking: the agent's contract.
 *
 * One hotel's real availability: the user picks dates, guests, a room and a
 * rate, sees the full price with taxes and the cancellation terms, and hands
 * off to the host's booking flow. Also shows an existing reservation. Fields
 * marked DATA-BOUND must come from a tool result (the booking API), never from
 * model free text. This component never books, charges or cancels by itself.
 */

// `.meta({ pattern: undefined })` and `.meta({ maximum: undefined })` keep
// Zod's checks but leave its long ISO regex and 2^53 integer bound out of the
// JSON Schema the model reads (token cost only; `format` still says date).
const isoDate = z.iso.date().meta({ pattern: undefined });
const isoDateTime = z.iso
  .datetime({ offset: true })
  .meta({ pattern: undefined });
const count = z.number().int().min(0).meta({ maximum: undefined });

export const hotelSchema = z.object({
  name: z.string(),
  address: z.string().describe("Street address."),
  city: z.string(),
  stars: z.number().int().min(1).max(5).optional(),
  rating: z
    .object({
      score: z.number().min(0),
      outOf: z.number().positive(),
      label: z.string().max(24).optional().describe("e.g. 'Excellent'."),
      count: count.optional().describe("Screen readers only."),
    })
    .optional(),
  checkInFrom: z
    .string()
    .max(8)
    .optional()
    .describe("Local time, e.g. '15:00'. In the details."),
  checkOutUntil: z
    .string()
    .max(8)
    .optional()
    .describe("Local time. In the details."),
  timeZone: z.string().describe("IANA, e.g. 'Europe/Lisbon'."),
  phone: z.string().optional().describe("In the details."),
  url: z.string().optional().describe("http(s) only. In the details."),
  image: z
    .object({
      src: z
        .string()
        .describe("http(s) or same-origin path (single leading '/')."),
      alt: z.string(),
    })
    .optional(),
});

export const staySchema = z.object({
  checkIn: isoDate,
  checkOut: isoDate,
  adults: z.number().int().min(1).max(16),
  children: z.number().int().min(0).max(16).optional(),
  rooms: z
    .number()
    .int()
    .min(1)
    .max(8)
    .optional()
    .describe("Of the chosen type. Default 1."),
});

export const nightlyPriceSchema = z.object({
  date: isoDate.describe("The date the night starts."),
  amount: z.number().min(0).describe("All rooms, before taxes and fees."),
});

export const chargeSchema = z.object({
  label: z.string().describe("e.g. 'City tax'."),
  amount: z.number().min(0),
  perNight: z
    .boolean()
    .optional()
    .describe("Charged each night. Otherwise for the whole quoted stay."),
});

export const feeSchema = chargeSchema.extend({
  payAtHotel: z
    .boolean()
    .optional()
    .describe("Paid at the hotel even when the rate is paid now."),
});

export const rateSchema = z.object({
  id: z.string(),
  label: z.string().max(40).describe("e.g. 'Flexible'."),
  nightly: z
    .array(nightlyPriceSchema)
    .min(1)
    .describe(
      "One per night, at least every night of `stay`; extra nights let the user move dates.",
    ),
  taxes: z.array(chargeSchema).optional(),
  fees: z.array(feeSchema).optional(),
  refundable: z.boolean(),
  freeCancelUntil: isoDateTime.optional(),
  breakfast: z.boolean().optional(),
  payment: z.enum(["now", "at-hotel"]),
});

export const roomSchema = z.object({
  id: z.string(),
  name: z.string(),
  bed: z.string().max(40).describe("e.g. '1 king'."),
  sizeM2: z.number().positive().optional().describe("Screen readers only."),
  maxGuests: z.number().int().min(1).describe("Per room, children included."),
  amenities: z
    .array(z.string().max(32))
    .max(6)
    .optional()
    .describe("Screen readers only."),
  remaining: count.optional().describe("Rooms left. 0: sold out."),
  rates: z.array(rateSchema).min(1).max(6),
});

export const bookingSchema = z.object({
  number: z.string().describe("Confirmation number."),
  bookingState: z.enum(["confirmed", "pending", "cancelled"]),
  roomId: z.string(),
  rateId: z.string(),
  guestName: z.string().describe("In the details."),
});

export const hotelBookingSchema = z.object({
  mode: z.enum(["select", "confirmation"]),
  hotel: hotelSchema.describe("DATA-BOUND."),
  stay: staySchema.describe("DATA-BOUND. The quoted or booked stay."),
  availability: z
    .object({
      minDate: isoDate,
      maxDate: isoDate,
      unavailable: z
        .array(isoDate)
        .optional()
        .describe("Nights that can't be booked."),
    })
    .optional()
    .describe("DATA-BOUND. Window to move dates within. Omit to lock dates."),
  rooms: z
    .array(roomSchema)
    .min(1)
    .max(8)
    .describe(
      "DATA-BOUND. Best fit first. Confirmation mode: at least the booked room and rate.",
    ),
  currency: z.string().length(3).describe("ISO 4217, for every amount."),
  confirmation: bookingSchema.optional().describe("DATA-BOUND."),
  source: z
    .object({
      label: z.string(),
      url: z.string().optional().describe("http(s) only."),
    })
    .describe("DATA-BOUND. In the details."),
});

export type Hotel = z.infer<typeof hotelSchema>;
export type HotelStay = z.infer<typeof staySchema>;
export type HotelRate = z.infer<typeof rateSchema>;
export type HotelRoom = z.infer<typeof roomSchema>;
export type HotelReservation = z.infer<typeof bookingSchema>;
export type HotelBookingInput = z.input<typeof hotelBookingSchema>;

/** A stay as returned in results, with defaults filled in. */
export type HotelBookingStay = {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  rooms: number;
};

/** What the component sends back. A closed set of actions. */
export type HotelBookingResult =
  /** Hand off to the host's booking flow. Nothing is booked or charged yet. */
  | {
      action: "reserve";
      roomId: string;
      rateId: string;
      stay: HotelBookingStay;
      total: {
        amount: number;
        payNow: number;
        payAtHotel: number;
        currency: string;
      };
    }
  /** The user changed dates or guests: quote again for this stay. */
  | { action: "change-stay"; stay: HotelBookingStay }
  | { action: "dismiss" }
  /** Confirmation mode. cancel-booking is only sent after a second, explicit click. */
  | { action: "manage" | "cancel-booking" | "add-to-calendar" };

/** Usage guidance the agent reads before choosing this component. */
export const hotelBookingGuidance = {
  useWhen: [
    "The user has one hotel in mind and wants to book it: show its real rooms, rates and prices for their dates.",
    "The user asks which room fits their party at a specific hotel.",
    "The user asks about an existing reservation (mode 'confirmation').",
  ],
  avoidWhen: [
    "The user is still comparing hotels. Show them as entity cards first.",
    "You don't have availability and nightly prices from a booking tool. Never invent prices, rooms or availability.",
    "The user wants to pay in chat. Reserve hands off to the host's booking flow.",
  ],
  rules: [
    "Pass rooms, rates, nightly prices, taxes, fees and cancellation deadlines exactly as the source returned them, in one currency.",
    "Quote nightly prices for every night of `stay`; mark per-night taxes and fees with perNight, and fees paid at the hotel with payAtHotel.",
    "Order rooms with the best fit first. The first room that fits is preselected.",
    "On reserve, start the host's booking flow with exactly the returned roomId, rateId and stay. Never treat it as booked until the source confirms.",
    "On change-stay, fetch availability for the returned stay and show this component again.",
    "On cancel-booking, cancel through the booking tool and confirm in one line. On dismiss, do nothing.",
    "Never ask for card details in chat.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(hotelBookingSchema)`.
 */
export const hotelBookingTool = {
  name: "book_hotel",
  description: [
    "One hotel's rooms and rates for the user's stay with the full price, handed off to booking; or an existing reservation.",
    `Use when: ${hotelBookingGuidance.useWhen.join(" ")}`,
    `Avoid when: ${hotelBookingGuidance.avoidWhen.join(" ")}`,
    `Rules: ${hotelBookingGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: hotelBookingSchema,
} as const;
