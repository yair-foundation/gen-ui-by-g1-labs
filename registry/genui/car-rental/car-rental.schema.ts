import { z } from "zod"

/**
 * Car Rental: the agent's contract.
 *
 * Real rental offers for one trip: the user filters and picks a car, chooses
 * cover and extras, sees the full cost with what's paid now and at the desk,
 * and hands off to the host's booking flow. Also shows an existing rental.
 * Fields marked DATA-BOUND must come from a tool result (the rental API),
 * never from model free text. This component never books, charges or cancels
 * by itself.
 */

// `.meta({ pattern: undefined })` and `.meta({ maximum: undefined })` keep
// Zod's checks but leave its long ISO regex and 2^53 integer bound out of the
// JSON Schema the model reads (token cost only).
const count = z.number().int().min(0).meta({ maximum: undefined })

const dateTime = z.iso
  .datetime({ offset: true, local: true })
  .meta({ pattern: undefined })
  .describe("ISO 8601. No offset: local time at the desk.")

export const tripPointSchema = z.object({
  location: z.string(),
  at: dateTime,
  timeZone: z.string().describe("IANA, e.g. 'Europe/Lisbon'."),
})

export const insuranceOptionSchema = z.object({
  id: z.string(),
  label: z.string().max(40),
  included: z.boolean().describe("In the base price."),
  excess: z.number().min(0).describe("Deductible. 0 for none."),
  pricePerDay: z.number().min(0).optional(),
  payAtDesk: z
    .boolean()
    .optional()
    .describe(
      "Paid at the counter. Omitted: with the booking, unless the base price is paid at the desk. Same for extras and fees.",
    ),
})

export const extraSchema = z.object({
  id: z.string(),
  label: z.string().max(40),
  pricePerDay: z.number().min(0).optional().describe("Per unit."),
  priceTotal: z
    .number()
    .min(0)
    .optional()
    .describe("Per unit, whole rental. Wins over pricePerDay."),
  maxQuantity: z.number().int().min(1).max(9).optional().describe("Default 1."),
  payAtDesk: z.boolean().optional(),
})

export const offerSchema = z.object({
  id: z.string(),
  supplier: z.string(),
  category: z.string().max(24).describe("e.g. 'Compact', 'SUV', 'Van'."),
  model: z.string().max(48),
  orSimilar: z
    .boolean()
    .optional()
    .describe("false: guaranteed model. Omit when unknown."),
  seats: z.number().int().min(1).max(17),
  bags: z.object({
    large: count,
    small: count,
  }),
  doors: z.number().int().min(2).max(6).optional().describe("In the details."),
  transmission: z.enum(["automatic", "manual"]),
  fuel: z.enum(["petrol", "diesel", "hybrid", "electric"]),
  rangeKm: z.number().positive().optional().describe("Electric cars."),
  airCon: z.boolean().optional().describe("In the details."),
  mileage: z.object({
    unlimited: z.boolean(),
    includedKm: z.number().min(0).optional().describe("Whole rental."),
    extraPerKm: z.number().min(0).optional(),
  }),
  fuelPolicy: z
    .enum(["full-to-full", "same-to-same", "prepaid"])
    .optional()
    .describe("In the details."),
  pickupType: z
    .enum(["in-terminal", "shuttle", "meet-and-greet"])
    .optional()
    .describe("In the details (select mode)."),
  pickupNote: z
    .string()
    .max(80)
    .optional()
    .describe("How to reach the desk. Overrides pickupType."),
  rating: z
    .object({
      score: z.number().min(0),
      outOf: z.number().positive(),
      count: count.optional().describe("Screen readers only."),
    })
    .optional(),
  price: z.object({
    total: z
      .number()
      .min(0)
      .describe("Base price, before optional cover, extras and fees."),
    perDay: z
      .number()
      .min(0)
      .optional()
      .describe("In the details. Default: total ÷ days."),
    payNow: z.number().min(0).optional(),
    payAtDesk: z
      .number()
      .min(0)
      .optional()
      .describe("payNow + payAtDesk = total. Omit both if all paid now."),
  }),
  deposit: z
    .object({
      amount: z.number().min(0),
      card: z.enum(["credit-only", "credit-or-debit"]),
    })
    .optional(),
  insurance: z.array(insuranceOptionSchema).min(1).max(4),
  extras: z.array(extraSchema).max(8).optional(),
  youngDriverFee: z
    .object({
      underAge: z.number().int().min(18).max(30),
      perDay: z.number().min(0),
      payAtDesk: z.boolean().optional(),
    })
    .optional()
    .describe("Applies when driver.age < underAge."),
  freeCancelUntil: z.iso
    .datetime({ offset: true })
    .meta({ pattern: undefined })
    .optional(),
})

export const rentalSchema = z.object({
  number: z.string().describe("Confirmation number."),
  bookingState: z.enum(["confirmed", "pending", "cancelled"]),
  offerId: z.string(),
  insuranceId: z.string().optional().describe("Default: the first option."),
  extras: z
    .array(
      z.object({
        id: z.string(),
        quantity: z.number().int().min(1).meta({ maximum: undefined }),
      }),
    )
    .optional(),
  driverName: z.string(),
})

export const filterPresetSchema = z.object({
  transmission: z.enum(["any", "automatic", "manual"]).optional(),
  minSeats: z.number().int().min(0).max(17).optional(),
  categories: z.array(z.string()).optional(),
  unlimitedMileage: z.boolean().optional(),
  freeCancellation: z.boolean().optional(),
  sort: z.enum(["price", "rating"]).optional(),
})

export const carRentalSchema = z.object({
  mode: z.enum(["select", "confirmation"]),
  pickup: tripPointSchema.describe("DATA-BOUND."),
  dropoff: tripPointSchema.describe("DATA-BOUND."),
  driver: z
    .object({
      age: z
        .number()
        .int()
        .min(16)
        .max(99)
        .optional()
        .describe("At pick-up, if the user gave it."),
    })
    .optional(),
  offers: z
    .array(offerSchema)
    .min(1)
    .max(12)
    .describe("DATA-BOUND. Confirmation mode: at least the booked offer."),
  currency: z.string().length(3).describe("ISO 4217, for every amount."),
  filters: z.boolean().optional().describe("Default: on with 4+ offers."),
  defaultFilters: filterPresetSchema.optional(),
  confirmation: rentalSchema.optional().describe("DATA-BOUND."),
  source: z
    .object({
      label: z.string(),
      url: z.string().optional().describe("http(s) only."),
    })
    .describe("DATA-BOUND. In the details."),
})

export type CarRentalTripPoint = z.infer<typeof tripPointSchema>
export type CarRentalOffer = z.infer<typeof offerSchema>
export type CarRentalInsurance = z.infer<typeof insuranceOptionSchema>
export type CarRentalExtra = z.infer<typeof extraSchema>
export type CarRentalReservation = z.infer<typeof rentalSchema>
export type CarRentalFilterPreset = z.infer<typeof filterPresetSchema>
export type CarRentalInput = z.input<typeof carRentalSchema>

/** What the component sends back. A closed set of actions. */
export type CarRentalResult =
  /** Hand off to the host's booking flow. Nothing is booked or charged yet. */
  | {
      action: "reserve"
      offerId: string
      insuranceId: string
      /** Extras with a quantity of at least 1. */
      extras: { id: string; quantity: number }[]
      total: {
        amount: number
        payNow: number
        payAtDesk: number
        currency: string
      }
    }
  /** The user changed places, times or the driver's age: fetch offers again. */
  | {
      action: "change-trip"
      pickup: CarRentalTripPoint
      dropoff: CarRentalTripPoint
      driverAge?: number
    }
  | { action: "dismiss" }
  /** Confirmation mode. cancel-rental is only sent after a second, explicit click. */
  | { action: "manage" | "cancel-rental" | "add-to-calendar" }

/** Usage guidance the agent reads before choosing this component. */
export const carRentalGuidance = {
  useWhen: [
    "The user wants to rent a car for a trip and you have real offers from a rental tool: show them to compare and pick.",
    "The user asks for a kind of car ('automatic for 5 people with luggage'): preset defaultFilters from the request.",
    "The user asks about a rental they already have (mode 'confirmation').",
  ],
  avoidWhen: [
    "You don't have offers and prices from a rental tool. Never invent offers, prices, cover or extras.",
    "The user wants a taxi, transfer or ride. This is for self-drive rentals.",
    "The user wants to pay in chat. Reserve hands off to the host's booking flow.",
  ],
  rules: [
    "Pass offers, prices, cover, extras, deposits and deadlines exactly as the source returned them, in one currency.",
    "Quote prices for the given pickup, dropoff and driver age; pass driver.age when the user gave it so the young driver fee applies.",
    "Put the included cover first in insurance; mark add-ons paid at the counter with payAtDesk.",
    "Preset defaultFilters only from what the user asked for.",
    "On reserve, start the host's booking flow with exactly the returned offerId, insuranceId and extras. Never treat it as booked until the source confirms.",
    "On change-trip, fetch offers for the returned pickup, dropoff and driverAge and show this component again. If the location changed, resolve its time zone again.",
    "On cancel-rental, cancel through the rental tool and confirm in one line. On dismiss, do nothing.",
    "Never ask for card details in chat.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(carRentalSchema)`.
 */
export const carRentalTool = {
  name: "rent_car",
  description: [
    "Real rental car offers for a trip to filter and pick, with cover, extras and full cost, handed off to booking; or an existing rental.",
    `Use when: ${carRentalGuidance.useWhen.join(" ")}`,
    `Avoid when: ${carRentalGuidance.avoidWhen.join(" ")}`,
    `Rules: ${carRentalGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: carRentalSchema,
} as const
