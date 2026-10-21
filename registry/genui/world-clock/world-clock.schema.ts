import { z } from "zod"

/**
 * World Clock: the agent's contract.
 *
 * The time in one or more places, live or at a given moment, with an optional
 * working-hours planner for finding a meeting time across zones.
 */

export const clockSchema = z.object({
  id: z.string().describe("Stable identifier for this clock."),
  label: z.string().describe("The place, e.g. 'Washington, DC'."),
  code: z
    .string()
    .max(4)
    .optional()
    .describe("Short code shown on the face, e.g. 'DC' or 'LIS'."),
  timeZone: z
    .string()
    .describe("IANA timezone, e.g. 'America/New_York'. Never an abbreviation."),
})

export const worldClockSchema = z.object({
  clocks: z
    .array(clockSchema)
    .min(1)
    .max(6)
    .describe(
      "1–6 places. The first is the reference for offsets, day relations and the planner day.",
    ),
  style: z
    .enum(["analog", "digital"])
    .optional()
    .describe("Default: analog for up to 4 clocks, a digital list for more."),
  numerals: z
    .enum(["quarters", "all"])
    .optional()
    .describe(
      "Analog faces: all 12 hour numerals (default) or only 12, 3, 6 and 9 with dots between.",
    ),
  referenceTime: z
    .string()
    .optional()
    .describe(
      "ISO date-time with offset. Shows every clock at this moment instead of now, e.g. '3 pm in Lisbon' → '2026-10-08T15:00:00+01:00' with Lisbon first.",
    ),
  hour12: z
    .boolean()
    .optional()
    .describe("Force a 12- or 24-hour clock. Default: the viewer's locale."),
  planner: z
    .object({
      workingHours: z.object({
        start: z.string().describe("'HH:mm' local, e.g. '09:00'."),
        end: z.string().describe("'HH:mm' local, e.g. '18:00'."),
      }),
      date: z
        .string()
        .describe("'YYYY-MM-DD', the day to plan in the first clock's zone."),
    })
    .optional()
    .describe(
      "Shows each place's working hours on a shared timeline with the overlap, and lets the user pick an hour.",
    ),
})

export type WorldClockEntry = z.infer<typeof clockSchema>
export type WorldClockInput = z.input<typeof worldClockSchema>

/** Sent back only when `planner` is set and the user picks an overlap hour. */
export type WorldClockResult = {
  action: "pick-time"
  /** The picked moment, ISO 8601 in UTC. */
  at: string
}

/** Usage guidance the agent reads before choosing this component. */
export const worldClockGuidance = {
  useWhen: [
    "The user asks what time it is somewhere, or wants clocks for several places.",
    "The user wants a time converted between zones: 'when is 3 pm Lisbon in San Francisco?'.",
    "The user wants to find a meeting time across zones (set planner).",
  ],
  avoidWhen: [
    "A single conversion the user only needs as a fact in a sentence, with no other places.",
    "Scheduling against real calendars. Fetch availability and use a slot picker.",
    "Counting down to something. Use a timer.",
  ],
  rules: [
    "Use IANA timezones ('Asia/Kolkata'), never abbreviations like 'IST'.",
    "Put the place the user is asking from, or the place they named a time in, first.",
    "For a conversion, set referenceTime as an ISO date-time with that place's offset; omit it for 'now'.",
    "Only set planner when the user wants to find a time; schedule nothing until you get a 'pick-time' result, then confirm it.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(worldClockSchema)`.
 */
export const worldClockTool = {
  name: "show_clocks",
  description: [
    "Show the time in one or more places, live or at a given moment, with an optional working-hours overlap planner.",
    `Use when: ${worldClockGuidance.useWhen.join(" ")}`,
    `Avoid when: ${worldClockGuidance.avoidWhen.join(" ")}`,
    `Rules: ${worldClockGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: worldClockSchema,
} as const
