import { z } from "zod"

import { VENUE_SEAT_FEATURES } from "./venue-map-utils"

/**
 * Venue Map: the agent's contract.
 *
 * A stadium, arena or concert hall from a ticketing system. The user picks a
 * section on an overview map, then seats in that section. Fields marked
 * DATA-BOUND must come from a tool result, never from model free text.
 */

export const venueSeatSchema = z.object({
  id: z.string().describe("DATA-BOUND. Ticketing-system id."),
  label: z.string().max(4).optional().describe("Default: the id."),
  state: z.enum(["available", "taken", "blocked"]).describe("DATA-BOUND."),
  price: z
    .number()
    .nonnegative()
    .optional()
    .describe("DATA-BOUND. Omit when the section has one price."),
  features: z
    .array(z.enum(VENUE_SEAT_FEATURES))
    .max(4)
    .optional()
    .describe("DATA-BOUND."),
})

export const venueSeatGapSchema = z.object({
  gap: z.literal(true).describe("A stairway or empty space."),
})

export const venueRowSchema = z.object({
  label: z.string().max(4),
  seats: z
    .array(z.union([venueSeatSchema, venueSeatGapSchema]))
    .min(1)
    .max(40)
    .describe(
      "Left to right facing the focal point; { gap: true } for stairways.",
    ),
})

export const ringPositionSchema = z.object({
  angle: z
    .number()
    .min(0)
    .max(360)
    .describe("Degrees around the focal point, 0 = top, clockwise."),
  span: z.number().positive().max(180).describe("Degrees covered."),
  ring: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .describe("1 = nearest the focal point."),
})

export const floorPositionSchema = z.object({
  floor: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().positive().max(1),
      h: z.number().positive().max(1),
    })
    .describe("0–1 units of the floor area; y = 0 is the front."),
})

export const venueSectionSchema = z.object({
  id: z.string().describe("DATA-BOUND."),
  label: z.string().max(8).describe("DATA-BOUND. e.g. '112'."),
  tier: z
    .enum(["floor", "lower", "middle", "upper"])
    .optional()
    .describe("Screen readers only. Default: from position."),
  position: z
    .union([ringPositionSchema, floorPositionSchema])
    .describe("A ring segment or a floor rectangle."),
  price: z
    .object({
      from: z.number().nonnegative(),
      to: z.number().nonnegative().optional(),
    })
    .optional()
    .describe("DATA-BOUND. Per seat; only `from` when all cost the same."),
  available: z.number().int().nonnegative().describe("DATA-BOUND. Seats left."),
  accessible: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. Has wheelchair spaces."),
  view: z.string().max(40).optional().describe("DATA-BOUND. e.g. 'Side view'."),
  rows: z
    .array(venueRowSchema)
    .min(1)
    .max(60)
    .optional()
    .describe(
      "DATA-BOUND. Only sections fetched seat by seat, front row first.",
    ),
})

export const venueMapSchema = z.object({
  venue: z.object({
    name: z.string().describe("DATA-BOUND."),
  }),
  event: z
    .object({
      title: z.string().describe("DATA-BOUND."),
      start: z.string().describe("DATA-BOUND. ISO 8601."),
    })
    .optional(),
  focal: z.object({
    kind: z
      .enum(["pitch", "court", "stage", "rink"])
      .describe("What the seats face."),
    label: z.string().max(20).optional().describe("e.g. 'Pitch'."),
  }),
  sections: z
    .array(venueSectionSchema)
    .min(1)
    .max(120)
    .describe("DATA-BOUND. Every section on sale."),
  currency: z.string().length(3).describe("ISO 4217."),
  count: z.number().int().min(1).max(10).default(2).describe("Tickets wanted."),
  together: z.boolean().default(true),
  maxPrice: z
    .number()
    .positive()
    .optional()
    .describe("Per-ticket budget the user mentioned."),
  colorBy: z
    .enum(["price", "availability"])
    .default("price")
    .describe("Initial map shading."),
  initialSection: z
    .string()
    .optional()
    .describe("Section to open first, e.g. when answering 'open-section'."),
})

export type VenueSeat = z.infer<typeof venueSeatSchema>
export type VenueSeatGap = z.infer<typeof venueSeatGapSchema>
export type VenueRow = z.infer<typeof venueRowSchema>
export type VenueSection = z.infer<typeof venueSectionSchema>
export type VenueMapInput = z.input<typeof venueMapSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type VenueMapResult =
  | {
      /** A request, not a decision: fetch this section's rows and send them. */
      action: "open-section"
      sectionId: string
    }
  | {
      /** You pick the seats. */
      action: "best-available"
      count: number
      together: boolean
      /** Only when the user lowered the price slider. */
      maxPrice?: number
      /** Only when "Accessible only" is on. */
      accessible?: true
    }
  | {
      action: "select"
      sectionId: string
      /** In map order. `price` when known. */
      seats: { seatId: string; price?: number }[]
    }
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const venueMapGuidance = {
  useWhen: [
    "The user is buying tickets for a stadium, arena or concert hall and where they sit matters: 'behind the goal', 'not too far back', 'two together'.",
    "You fetched the venue's sections, prices and live availability from the ticketing system.",
  ],
  avoidWhen: [
    "General admission or a single price zone: nothing to choose. Ask how many tickets and book.",
    "A small room with one seating block (a cinema, a theater stalls). Use the seat map.",
    "You don't have real availability. Fetch it first; never invent sections or prices.",
  ],
  rules: [
    "Send every section with its real id, label, price and seats left. Lay ring sections out with angle and span around the focal point (0 = top, clockwise), ring 1 nearest.",
    "Send rows only for sections you fetched seat by seat. When the result is 'open-section', fetch that section and call again with its rows and initialSection.",
    "Set count, together and maxPrice from what the user said.",
    "On 'best-available', pick the seats yourself within count, together and maxPrice, and tell the user which ones.",
    "This only picks seats. Reserve them after 'select' and confirm the total before charging.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(venueMapSchema)`.
 */
export const venueMapTool = {
  name: "pick_venue_seats",
  description: [
    "Show a stadium, arena or concert hall map: the user picks a section by price and availability, then seats in it, or asks you for the best available.",
    `Use when: ${venueMapGuidance.useWhen.join(" ")}`,
    `Avoid when: ${venueMapGuidance.avoidWhen.join(" ")}`,
    `Rules: ${venueMapGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: venueMapSchema,
} as const
