import { z } from "zod"

/**
 * Weather Outlook: the agent's contract.
 *
 * A plain 5 to 7 day forecast for one place: a day, an icon, a high and a low.
 * No hours, wind or alerts; use Weather when those matter. Every reading comes
 * from a weather tool.
 */

export const weatherOutlookConditionSchema = z.enum([
  "clear",
  "partly-cloudy",
  "cloudy",
  "fog",
  "drizzle",
  "rain",
  "heavy-rain",
  "thunderstorm",
  "snow",
  "sleet",
  "wind",
])

export const weatherOutlookDaySchema = z.object({
  date: z.string().describe("Local calendar date, e.g. '2026-11-14'."),
  min: z.number().describe("Low, in the payload's units."),
  max: z.number().describe("High, in the payload's units."),
  condition: weatherOutlookConditionSchema,
  precipChance: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Percent. Shown when it is 20 or more."),
})

export const weatherOutlookSchema = z.object({
  location: z
    .object({
      name: z.string().describe("e.g. 'Lisbon'."),
      region: z.string().optional().describe("e.g. 'Portugal'."),
    })
    .describe("DATA-BOUND."),
  asOf: z
    .string()
    .describe(
      "DATA-BOUND. ISO date-time of the forecast, used to label Today and Tomorrow.",
    ),
  timezone: z
    .string()
    .describe("IANA time zone of the place, e.g. 'Europe/Lisbon'."),
  units: z
    .enum(["metric", "imperial"])
    .describe("Units of every temperature: °C for metric, °F for imperial."),
  days: z
    .array(weatherOutlookDaySchema)
    .min(5)
    .max(7)
    .describe("DATA-BOUND. 5 to 7 days in date order, usually starting today."),
  summary: z
    .string()
    .max(120)
    .optional()
    .describe(
      "One short sentence on the week, e.g. 'Dry until Thursday, then rain.'",
    ),
})

export type WeatherOutlookCondition = z.infer<
  typeof weatherOutlookConditionSchema
>
export type WeatherOutlookDay = z.infer<typeof weatherOutlookDaySchema>
export type WeatherOutlookInput = z.input<typeof weatherOutlookSchema>

/** Usage guidance the agent reads before choosing this component. */
export const weatherOutlookGuidance = {
  useWhen: [
    "The user asks what the weather will be like over the next several days, with no detail asked for.",
    "A weather tool returned a daily forecast for that place.",
  ],
  avoidWhen: [
    "The question is about today's hours, wind, alerts or what to wear right now. Use Weather.",
    "You have no forecast from a tool. Never invent or recall readings.",
    "The user compares many places at once. Use a data table.",
  ],
  rules: [
    "Send 5 to 7 days in date order, copied from the tool result unchanged, in the units it returned.",
    "Set units to match the readings.",
    "Add summary only when it says something the icons don't, in one short sentence.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(weatherOutlookSchema)`.
 */
export const weatherOutlookTool = {
  name: "show_weather_outlook",
  description: [
    "Show a simple 5 to 7 day forecast for one place: each day's icon, high and low.",
    `Use when: ${weatherOutlookGuidance.useWhen.join(" ")}`,
    `Avoid when: ${weatherOutlookGuidance.avoidWhen.join(" ")}`,
    `Rules: ${weatherOutlookGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: weatherOutlookSchema,
} as const
