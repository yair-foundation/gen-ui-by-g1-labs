import { z } from "zod"

/**
 * Flight status: the agent's contract.
 *
 * The live status of one flight from a flight-data source: on time or late,
 * where it is, gates and baggage belt. Every time, gate and state is
 * DATA-BOUND: it must come from a tool result, never from model free text.
 * For live updates, the host re-renders with new props.
 */

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "ISO 8601 date-time, e.g. '2026-10-08T13:20:00+01:00'",
  )

export const flightStates = [
  "scheduled",
  "boarding",
  "departed",
  "en-route",
  "landed",
  "arrived",
  "delayed",
  "cancelled",
  "diverted",
] as const

const airportBase = z.object({
  code: z
    .string()
    .regex(/^[A-Z]{3}$/, "3-letter IATA code")
    .describe("IATA airport code, e.g. 'LHR'."),
  city: z.string().max(40).describe("e.g. 'London'."),
  timeZone: z
    .string()
    .describe(
      "The airport's IANA timezone, e.g. 'Europe/London'. Times show in it.",
    ),
  terminal: z.string().max(12).optional(),
  gate: z.string().max(8).optional(),
})

const timesSchema = z.object({
  scheduled: isoDateTime.describe(
    "ISO 8601 with the airport's offset. Without an offset it's read as local time at the airport.",
  ),
  estimated: isoDateTime.optional(),
  actual: isoDateTime.optional(),
})

export const flightStatusSchema = z.object({
  flightNumber: z.string().max(10).describe("DATA-BOUND. e.g. 'NW 482'."),
  airline: z
    .object({
      name: z.string().max(40).describe("e.g. 'Northwind Air'."),
      code: z.string().max(3).describe("IATA airline code, e.g. 'NW'."),
    })
    .describe("DATA-BOUND."),
  from: airportBase.describe("DATA-BOUND. Departure airport."),
  to: airportBase
    .extend({
      baggageBelt: z.string().max(8).optional().describe("e.g. '7'."),
    })
    .describe("DATA-BOUND. Arrival airport."),
  state: z
    .enum(flightStates)
    .describe("DATA-BOUND. As the source reports it. Never infer 'landed'."),
  times: z
    .object({ depart: timesSchema, arrive: timesSchema })
    .describe(
      "DATA-BOUND. Scheduled, estimated and actual times for each end, exactly as reported.",
    ),
  progress: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      "DATA-BOUND. Share of the route flown (0–1) while in the air. Derived from the times when absent.",
    ),
  position: z
    .object({
      altitudeFt: z.number().min(0).max(60000).optional(),
      groundSpeedKt: z.number().min(0).max(800).optional(),
    })
    .optional()
    .describe("DATA-BOUND. Live position data while in the air."),
  delayReason: z
    .string()
    .max(120)
    .optional()
    .describe(
      "DATA-BOUND. As reported, e.g. 'Late arrival of the inbound aircraft'. Screen readers only.",
    ),
  divertedTo: z
    .object({ code: z.string().regex(/^[A-Z]{3}$/), city: z.string().max(40) })
    .optional()
    .describe("DATA-BOUND. Where a diverted flight is going instead."),
  seat: z
    .string()
    .max(4)
    .optional()
    .describe(
      "DATA-BOUND. The user's own seat, when it's their booking. Screen readers only.",
    ),
  class: z
    .enum(["economy", "premium", "business", "first"])
    .optional()
    .describe(
      "DATA-BOUND. The user's cabin, when it's their booking. Screen readers only.",
    ),
  updates: z
    .array(
      z.object({
        at: isoDateTime,
        text: z.string().max(120).describe("e.g. 'Gate changed to B14'."),
      }),
    )
    .max(20)
    .optional()
    .describe(
      "DATA-BOUND. Status changes from the source, newest first. Screen readers only; the newest is announced.",
    ),
  asOf: isoDateTime.describe("DATA-BOUND. When the source last updated."),
  source: z
    .object({
      label: z.string().max(60).describe("e.g. 'Northwind Air flight status'."),
      url: z
        .string()
        .optional()
        .describe("Link to the source. http(s) only; others are ignored."),
    })
    .describe("DATA-BOUND. Where the status came from."),
  watch: z
    .boolean()
    .optional()
    .describe(
      "Show a 'Notify me of changes' button. Only when you can actually send notifications.",
    ),
})

export type FlightStatusTimes = z.infer<typeof timesSchema>
export type FlightStatusAirport = z.infer<typeof airportBase>
export type FlightStatusInput = z.input<typeof flightStatusSchema>

/** Sent back when the user asks to be notified. The only action. */
export type FlightStatusResult = { action: "watch" }

/** Usage guidance the agent reads before choosing this component. */
export const flightStatusGuidance = {
  useWhen: [
    "The user asks about a flight's live status: is it on time, has it landed, where is it now, which gate or baggage belt.",
    "You have the status from a flight-data tool result.",
  ],
  avoidWhen: [
    "You don't have live data from a tool result. Never guess states, gates or times.",
    "The user wants their booking details, seat or boarding pass. Use show_flight_ticket.",
    "The user is comparing flights to book.",
  ],
  rules: [
    "Pass times with the airport's UTC offset and IANA timezone exactly as the source gives them; don't convert them.",
    "Pass scheduled, estimated and actual times as reported; the component works out delays and remaining time.",
    "List updates newest first, in the source's words.",
    "Only set watch when you can actually notify the user; on 'watch', subscribe them and confirm in text.",
    "For live tracking, re-render the same component with new props rather than calling the tool again.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(flightStatusSchema)`.
 */
export const flightStatusTool = {
  name: "track_flight",
  description: [
    "Show the live status of one flight: state, delay, local departure and arrival times, progress, gates and baggage belt.",
    `Use when: ${flightStatusGuidance.useWhen.join(" ")}`,
    `Avoid when: ${flightStatusGuidance.avoidWhen.join(" ")}`,
    `Rules: ${flightStatusGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: flightStatusSchema,
} as const
