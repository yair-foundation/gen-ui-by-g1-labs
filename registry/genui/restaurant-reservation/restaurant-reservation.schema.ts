import { z } from "zod"

/**
 * Restaurant Reservation: the agent's contract.
 *
 * One restaurant's real availability for a party: the user picks a day, a
 * time and a seating area, adds an occasion or dietary needs, sees the
 * policies, and hands off to the host's booking flow. Also shows an existing
 * reservation. Fields marked DATA-BOUND must come from a tool result (the
 * booking API), never from model free text. This component never books,
 * charges or cancels by itself.
 */

const isoDate = z.iso.date()
const localTime = z
  .string()
  .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  .describe("HH:mm, local.")

export const seatingAreaSchema = z.enum([
  "indoor",
  "outdoor",
  "bar",
  "counter",
  "private",
])

export const restaurantSchema = z.object({
  name: z.string(),
  cuisine: z.string().max(40).optional(),
  priceLevel: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .describe("1 (cheap) to 4, as the source rates it."),
  address: z.string().describe("Full street address. In the details."),
  neighborhood: z.string().max(40).optional(),
  timeZone: z.string().describe("IANA, e.g. 'Europe/Lisbon'."),
  rating: z
    .object({
      score: z.number().min(0),
      outOf: z.number().positive(),
      count: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Screen readers only."),
    })
    .optional(),
  phone: z.string().optional().describe("In the details."),
  url: z.string().optional().describe("http(s) only. In the details."),
  logo: z
    .object({
      url: z
        .string()
        .describe(
          "DATA-BOUND. The restaurant's logo: http(s), or a same-origin path starting with a single slash. A logo, never a photo of the place or its food.",
        ),
      darkUrl: z
        .string()
        .optional()
        .describe(
          "DATA-BOUND. A version of the logo for dark backgrounds, when the source has one.",
        ),
      alt: z.string().optional().describe("e.g. 'Cal Pep'."),
    })
    .optional()
    .describe(
      "The restaurant's logo, shown in a white tile beside the name in place of the fork-and-knife icon. Only when the source provides one; never invent a URL.",
    ),
})

export const partySchema = z.object({
  size: z.number().int().min(1).max(30),
  min: z.number().int().min(1).optional().describe("Default 1."),
  max: z.number().int().min(1).optional().describe("Default 20."),
})

export const reservationSlotSchema = z.object({
  time: localTime,
  areas: z
    .array(seatingAreaSchema)
    .max(5)
    .optional()
    .describe("Omit if the source doesn't say."),
  note: z
    .string()
    .max(40)
    .optional()
    .describe("From the source, e.g. '2-hour limit'."),
})

export const reservationDaySchema = z.object({
  date: isoDate,
  slots: z
    .array(reservationSlotSchema)
    .max(40)
    .describe("Empty: the day is full."),
})

export const reservationPoliciesSchema = z.object({
  cancellation: z.string().max(160).optional().describe("One sentence."),
  deposit: z
    .object({
      amount: z.number().min(0).describe("In `currency`."),
      perPerson: z.boolean().optional(),
      refundableUntil: z
        .string()
        .max(40)
        .optional()
        .describe("As the source states it."),
    })
    .optional(),
  dressCode: z.string().max(40).optional(),
  maxDurationMinutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("How long the table is held."),
})

export const reservationRequestsSchema = z.object({
  occasions: z
    .array(z.string().max(32))
    .max(8)
    .optional()
    .describe("e.g. 'Birthday'."),
  allowNote: z.boolean().optional().describe("Show a free-text note."),
  dietary: z
    .array(z.string().max(32))
    .max(8)
    .optional()
    .describe("e.g. 'Vegetarian'."),
})

export const reservationSchema = z.object({
  number: z.string().describe("Confirmation number."),
  bookingState: z.enum(["confirmed", "pending", "waitlist", "cancelled"]),
  date: isoDate,
  time: localTime,
  size: z.number().int().min(1),
  area: seatingAreaSchema.optional(),
  guestName: z.string().describe("In the details."),
  notes: z
    .string()
    .max(200)
    .optional()
    .describe(
      "e.g. 'Birthday'. Waitlist: include the position if known. In the details.",
    ),
})

export const restaurantReservationSchema = z.object({
  mode: z
    .enum(["select", "confirmation"])
    .describe("'confirmation': an existing reservation."),
  restaurant: restaurantSchema.describe("DATA-BOUND."),
  party: partySchema.describe("DATA-BOUND."),
  days: z
    .array(reservationDaySchema)
    .max(7)
    .default([])
    .describe("DATA-BOUND. Select mode only. Never invent slots."),
  defaultDate: isoDate.optional().describe("Day to show first."),
  policies: reservationPoliciesSchema
    .optional()
    .describe("DATA-BOUND. In the details, except the deposit."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217. Required with a deposit."),
  requests: reservationRequestsSchema
    .optional()
    .describe("DATA-BOUND. Omit what the system doesn't accept."),
  confirmation: reservationSchema.optional().describe("DATA-BOUND."),
  source: z
    .object({
      label: z.string(),
      url: z.string().optional().describe("http(s) only."),
    })
    .describe("DATA-BOUND."),
})

export type SeatingArea = z.infer<typeof seatingAreaSchema>
export type Restaurant = z.infer<typeof restaurantSchema>
export type ReservationParty = z.infer<typeof partySchema>
export type ReservationSlot = z.infer<typeof reservationSlotSchema>
export type ReservationDay = z.infer<typeof reservationDaySchema>
export type ReservationPolicies = z.infer<typeof reservationPoliciesSchema>
export type ReservationRequests = z.infer<typeof reservationRequestsSchema>
export type Reservation = z.infer<typeof reservationSchema>
export type RestaurantReservationInput = z.input<
  typeof restaurantReservationSchema
>

/** What the component sends back. A closed set of actions. */
export type RestaurantReservationResult =
  /** Hand off to the host's booking flow. Nothing is booked or charged yet. */
  | {
      action: "reserve"
      date: string
      time: string
      size: number
      area?: SeatingArea
      occasion?: string
      dietary?: string[]
      note?: string
    }
  /** The user changed the party size: fetch availability for this size. */
  | { action: "change-party"; size: number }
  | { action: "dismiss" }
  /** Confirmation mode. cancel-reservation is only sent after a second, explicit click. */
  | { action: "modify" | "cancel-reservation" | "add-to-calendar" }

/** Usage guidance the agent reads before choosing this component. */
export const restaurantReservationGuidance = {
  useWhen: [
    "The user wants a table at a specific restaurant: show its real open times for their party.",
    "The user asks what's free at a time or on a day at one restaurant.",
    "The user asks about an existing reservation (mode 'confirmation').",
  ],
  avoidWhen: [
    "The user is still choosing a restaurant. Show them as entity cards first.",
    "You haven't fetched availability for the party size. Never invent times.",
    "It's a generic appointment, not a restaurant. Use the slot picker.",
  ],
  rules: [
    "Pass days, slots, areas and notes exactly as the source returned them, for the party size in `party.size`. Include fully booked days with empty slots.",
    "Set defaultDate to the day the user asked for.",
    "Only list occasions and dietary options the booking system accepts; omit requests otherwise.",
    "On reserve, start the host's booking flow with exactly the returned date, time, size and area. Never treat it as booked until the source confirms. The provider collects any deposit.",
    "On change-party, fetch availability for the new size and show this component again.",
    "On cancel-reservation, cancel through the booking tool and confirm in one line. On dismiss, do nothing.",
    "Never ask for card details in chat.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(restaurantReservationSchema)`.
 */
export const restaurantReservationTool = {
  name: "reserve_table",
  description: [
    "Show one restaurant's open tables for the user's party and hand off to booking; or show an existing reservation.",
    `Use when: ${restaurantReservationGuidance.useWhen.join(" ")}`,
    `Avoid when: ${restaurantReservationGuidance.avoidWhen.join(" ")}`,
    `Rules: ${restaurantReservationGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: restaurantReservationSchema,
} as const
