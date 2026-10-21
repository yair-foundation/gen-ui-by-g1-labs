import { z } from "zod"

/**
 * Flight offers: the agent's contract.
 *
 * A ranked list of bookable flight options from a fare search, to compare and
 * pick one. Every price, time, code and fare rule is DATA-BOUND: it must come
 * from a tool result, never from model free text.
 */

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "ISO 8601 date-time, e.g. '2026-11-12T12:55:00+02:00'",
  )

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date, e.g. '2026-11-12'")

export const offerCabins = ["economy", "premium", "business", "first"] as const
export const offerSorts = ["price", "duration", "departure"] as const

export const offerAirportSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{3}$/, "3-letter IATA code")
    .describe("IATA airport code, e.g. 'TLV'."),
  city: z
    .string()
    .max(30)
    .optional()
    .describe("DATA-BOUND. The city, e.g. 'Tel Aviv'. Shown under the code."),
  timeZone: z
    .string()
    .describe(
      "The airport's IANA timezone, e.g. 'Asia/Jerusalem'. Times show in it.",
    ),
})

export const offerSegmentSchema = z.object({
  flightNumber: z
    .string()
    .max(10)
    .describe("e.g. 'BH 221'. Shown under the flight's times."),
  operatedBy: z
    .string()
    .max(40)
    .optional()
    .describe(
      "DATA-BOUND. The airline that actually flies it, when it isn't the one selling the fare. Shown as 'Operated by …'.",
    ),
  from: offerAirportSchema,
  to: offerAirportSchema,
  departAt: isoDateTime.describe(
    "Scheduled departure, ISO 8601 with the airport's offset, e.g. '2026-11-12T12:55:00+02:00'. Without an offset it's read as local time at the airport.",
  ),
  arriveAt: isoDateTime.describe("Scheduled arrival, same format."),
})

export const offerLegSchema = z.object({
  segments: z
    .array(offerSegmentSchema)
    .min(1)
    .max(4)
    .describe(
      "The flights in this direction, in order. One segment is nonstop; layovers are computed between segments.",
    ),
})

export const flightOfferSchema = z.object({
  id: z.string().describe("Stable identifier, returned on select."),
  airline: z.object({
    name: z.string().max(40).describe("e.g. 'Blue Harbor Airways'."),
    code: z
      .string()
      .max(3)
      .describe(
        "IATA airline code, e.g. 'BH'. Shown as the airline's mark when there is no logo.",
      ),
    logo: z
      .string()
      .optional()
      .describe(
        "DATA-BOUND. The airline's own app icon or logo: http(s), a same-origin path starting with a single slash, or data:image. Shown as a rounded tile in place of the code. Only when the data provides one.",
      ),
    logoDark: z
      .string()
      .optional()
      .describe(
        "DATA-BOUND. The same logo for dark backgrounds (light lettering). Used in dark mode when the logo is an SVG wordmark.",
      ),
  }),
  price: z
    .number()
    .nonnegative()
    .describe(
      "DATA-BOUND. Total for all passengers in the search, taxes included, in `currency`.",
    ),
  fare: z
    .string()
    .max(24)
    .optional()
    .describe("DATA-BOUND. Fare family, e.g. 'Basic', 'Standard', 'Flex'."),
  bags: z
    .object({
      carryOn: z.boolean().describe("A cabin bag is included."),
      checked: z
        .number()
        .int()
        .min(0)
        .max(5)
        .describe("Checked bags included per passenger."),
    })
    .optional()
    .describe("DATA-BOUND. Bags included in the fare."),
  legs: z
    .array(offerLegSchema)
    .min(1)
    .max(2)
    .describe("DATA-BOUND. One leg is one way; two are outbound and return."),
  refundable: z.boolean().optional().describe("DATA-BOUND."),
  seatsLeft: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("DATA-BOUND. Seats left at this price. Shown when 5 or fewer."),
})

export const flightSearchSchema = z.object({
  from: z
    .string()
    .max(40)
    .describe("Origin as the user said it, e.g. 'Tel Aviv'."),
  to: z.string().max(40).describe("Destination, e.g. 'Athens'."),
  departDate: isoDate,
  returnDate: isoDate.optional().describe("Omit for one way."),
  passengers: z.object({
    adults: z.number().int().min(1).max(9),
    children: z.number().int().min(0).max(9).optional(),
    infants: z.number().int().min(0).max(9).optional(),
  }),
  cabin: z.enum(offerCabins).optional().describe("Default economy."),
})

export const flightOffersSchema = z.object({
  search: flightSearchSchema
    .optional()
    .describe(
      "What was searched: titles the card and says who the prices are for.",
    ),
  currency: z.string().length(3).describe("ISO 4217 code, e.g. 'USD'."),
  offers: z
    .array(flightOfferSchema)
    .min(1)
    .max(10)
    .describe(
      "DATA-BOUND. The options, best first. The first 2 show; the rest behind 'Show more'.",
    ),
  sort: z
    .enum(offerSorts)
    .optional()
    .describe(
      "What `offers` is sorted by. Marks that sort as active; the user can re-sort.",
    ),
  selectable: z
    .boolean()
    .default(true)
    .describe("Let the user pick one offer and send it back to you."),
  source: z
    .object({
      label: z.string().max(40).describe("e.g. 'Farely'."),
      url: z.string().optional().describe("http(s) link to the search."),
    })
    .optional()
    .describe("DATA-BOUND. Where the fares came from."),
})

export type OfferAirport = z.infer<typeof offerAirportSchema>
export type OfferSegment = z.infer<typeof offerSegmentSchema>
export type OfferLeg = z.infer<typeof offerLegSchema>
export type FlightOffer = z.infer<typeof flightOfferSchema>
export type FlightSearch = z.infer<typeof flightSearchSchema>
export type FlightOffersInput = z.input<typeof flightOffersSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type FlightOffersResult = { action: "select"; offerId: string }

/** Usage guidance the agent reads before choosing this component. */
export const flightOffersGuidance = {
  useWhen: [
    "The user searched for flights and should compare a few bookable options and pick one: 'flights to Athens in November', 'cheapest nonstop to Lisbon'.",
  ],
  avoidWhen: [
    "The user already booked. Use a flight ticket.",
    "The user asks about a flight in progress. Use flight status.",
    "You have no live fares. Search first; never invent prices or times.",
    "More than 10 options. Narrow the search (nonstop, time of day) first.",
  ],
  rules: [
    "Every price, time and fare rule comes from the fare search result. `price` is the total for all passengers.",
    "Send times with the airport's offset and each airport's IANA timezone, so times show local to each airport.",
    "Order `offers` by what the user asked for (cheapest, fastest) and set `sort` to match.",
    "Pass `search.passengers` so the card says who the prices are for.",
    "Act only on a 'select' result, then confirm the fare before booking: prices change.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(flightOffersSchema)`.
 */
export const flightOffersTool = {
  name: "compare_flights",
  description: [
    "Show ranked flight offers from a fare search: times local to each airport, stops, fare and bags, with the cheapest and fastest marked. The user can re-sort and pick one.",
    `Use when: ${flightOffersGuidance.useWhen.join(" ")}`,
    `Avoid when: ${flightOffersGuidance.avoidWhen.join(" ")}`,
    `Rules: ${flightOffersGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: flightOffersSchema,
} as const
