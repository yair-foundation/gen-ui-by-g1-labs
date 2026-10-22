import { z } from "zod"

import { MARKER_KINDS, SEAT_FEATURES, SECTION_LAYOUTS } from "./seat-map-utils"

/**
 * Seat Map: the agent's contract.
 *
 * A real seat map from a booking system (a plane, a cinema, a theatre with
 * curved rows and several levels, a train coach) on which the user picks seats. Fields marked DATA-BOUND must come from a tool
 * result, never from model free text.
 */

export const seatSchema = z.object({
  id: z.string().describe("DATA-BOUND. Booking-system id, e.g. '14C'."),
  label: z.string().max(4).optional().describe("When it differs from the id."),
  state: z.enum(["available", "taken", "blocked"]).describe("DATA-BOUND."),
  features: z
    .array(z.enum(SEAT_FEATURES))
    .max(6)
    .optional()
    .describe("DATA-BOUND."),
  price: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "DATA-BOUND. Extra charge (or ticket price at a show). Omit if free or priced by zone.",
    ),
  note: z
    .string()
    .max(40)
    .optional()
    .describe("DATA-BOUND. e.g. 'Extra leg room'."),
  zone: z.string().optional().describe("DATA-BOUND. A `zones` id."),
})

export const seatGapSchema = z.object({
  gap: z.literal(true).describe("An aisle or empty space."),
})

export const seatRowSchema = z.object({
  label: z.string().max(4).describe("e.g. '14'. Boxes layout: the box name."),
  seats: z
    .array(z.union([seatSchema, seatGapSchema]))
    .min(1)
    .max(40)
    .describe("Left to right facing the front; { gap: true } for aisles."),
  side: z
    .enum(["left", "right"])
    .optional()
    .describe("Boxes layout only. Default: first half left."),
})

export const seatMarkerSchema = z.object({
  afterRow: z
    .string()
    .describe("Row label the marker follows; no match: before the first row."),
  kind: z.enum(MARKER_KINDS),
})

export const seatSectionSchema = z.object({
  id: z.string(),
  label: z.string().describe("e.g. 'Economy', 'Stalls'."),
  rows: z.array(seatRowSchema).min(1).max(60).describe("DATA-BOUND."),
  markers: z
    .array(seatMarkerSchema)
    .max(20)
    .optional()
    .describe("DATA-BOUND. Grid layout only."),
  layout: z
    .enum(SECTION_LAYOUTS)
    .optional()
    .describe(
      "Overrides the map's layout. 'boxes': each row is a box beside the stage.",
    ),
  curve: z
    .number()
    .min(10)
    .max(150)
    .optional()
    .describe("Curved layout: row arc in degrees. Default 70."),
  stage: z
    .enum(["front", "below"])
    .optional()
    .describe("'below' for circles and balconies."),
})

export const seatZoneSchema = z.object({
  id: z.string(),
  label: z.string().max(24),
  price: z.number().nonnegative().describe("DATA-BOUND."),
})

export const seatMapSchema = z.object({
  kind: z.enum(["plane", "cinema", "theater", "train", "bus", "venue"]),
  layout: z
    .enum(["grid", "curved"])
    .optional()
    .describe("Default 'curved' for theater, else 'grid'."),
  title: z.string().optional().describe("DATA-BOUND. What's being booked."),
  // Before sections, so seats are shaded and priced as they stream in.
  zones: z
    .array(seatZoneSchema)
    .max(8)
    .optional()
    .describe("DATA-BOUND. Seats in a zone take its price."),
  currency: z.string().length(3).optional().describe("ISO 4217."),
  sections: z
    .array(seatSectionSchema)
    .min(1)
    .max(6)
    .describe("DATA-BOUND. Cabins, areas or levels, front or lowest first."),
  passengers: z
    .array(z.object({ id: z.string(), name: z.string() }))
    .min(1)
    .max(9)
    .optional()
    .describe("DATA-BOUND. One seat each, in order."),
  count: z
    .number()
    .int()
    .min(1)
    .max(10)
    .default(1)
    .describe("Without passengers: seats to pick."),
  current: z
    .array(
      z.object({
        passengerId: z.string().optional(),
        seatId: z.string(),
      }),
    )
    .max(9)
    .optional()
    .describe("DATA-BOUND. Seats the user already holds."),
  legend: z.boolean().default(true),
  submitLabel: z
    .string()
    .optional()
    .describe("Confirm button label, e.g. 'Change seat'."),
})

export type Seat = z.infer<typeof seatSchema>
export type SeatGap = z.infer<typeof seatGapSchema>
export type SeatRow = z.infer<typeof seatRowSchema>
export type SeatMarker = z.infer<typeof seatMarkerSchema>
export type SeatSection = z.infer<typeof seatSectionSchema>
export type SeatZone = z.infer<typeof seatZoneSchema>
export type SeatMapInput = z.input<typeof seatMapSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type SeatMapResult =
  | {
      action: "select"
      /** One per passenger (in passenger order), or `count` seats in map order. */
      seats: { seatId: string; passengerId?: string; price?: number }[]
    }
  | { action: "dismiss" }

/**
 * The selection before the user confirms, sent through `onDraft`: the seats
 * picked so far, possibly fewer than needed. Not a decision.
 */
export type SeatMapDraft = Extract<SeatMapResult, { action: "select" }>

/** Usage guidance the agent reads before choosing this component. */
export const seatMapGuidance = {
  useWhen: [
    "The user picks or changes seats on a real layout: a flight, a cinema or theater show, a train or bus, an event floor.",
    "You fetched the seat map and availability from the booking system.",
  ],
  avoidWhen: [
    "The user asked for any seat, or a seat type you can just request (e.g. 'any aisle seat'). Book it and say which one.",
    "You don't have the real map. Fetch it first; never invent rows or availability.",
    "The choice is between ticket types or zones, not seats. Use product options or an entity picker.",
  ],
  rules: [
    "Send rows front to back and seats left to right, with { gap: true } for aisles so columns line up.",
    "Use passengers when you know who's travelling; use count otherwise.",
    "Pass the user's existing seats as current when they're changing seats, and only those: never a seat you suggest or one they selected without confirming, which would show as already theirs and lose its price. To suggest a seat, name it in your text.",
    "Set price only for seats that cost extra, with currency. For shows priced by area, send zones and set each seat's zone instead.",
    "For theatres, send each level (Stalls, Dress circle, Upper circle, Boxes) as a section; set stage: 'below' on circles and layout: 'boxes' for boxes.",
    "Mark seats with a restricted view with the 'restricted-view' feature and say why in note.",
    "This only picks seats. Book or change them yourself after a 'select' result, and confirm the price before charging.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(seatMapSchema)`.
 */
export const seatMapTool = {
  name: "pick_seats",
  description: [
    "Show a seat map (plane, cinema, theater with curved rows and levels, train, bus or venue) and let the user pick seats, one per passenger or a set count.",
    `Use when: ${seatMapGuidance.useWhen.join(" ")}`,
    `Avoid when: ${seatMapGuidance.avoidWhen.join(" ")}`,
    `Rules: ${seatMapGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: seatMapSchema,
} as const
