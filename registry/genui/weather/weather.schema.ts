import { z } from "zod"

/**
 * Weather: the agent's contract.
 *
 * A forecast for one place: current conditions, alerts, hourly and daily
 * outlooks, and the agent's one-line answer to the user's question. Every
 * reading comes from a weather tool.
 */

export const weatherConditionSchema = z.enum([
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

export const weatherCurrentSchema = z.object({
  temp: z.number().describe("In the payload's units (°C metric, °F imperial)."),
  feelsLike: z.number(),
  condition: weatherConditionSchema,
  isDay: z.boolean().describe("Picks sun or moon icons."),
  humidity: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Percent. Screen readers only."),
  windSpeed: z
    .number()
    .nonnegative()
    .optional()
    .describe("km/h for metric, mph for imperial."),
  windDir: z
    .number()
    .optional()
    .describe("Degrees the wind blows from: 0 north, 90 east."),
  precipChance: z.number().min(0).max(100).optional().describe("Percent."),
  uvIndex: z.number().nonnegative().optional().describe("Screen readers only."),
})

export const weatherHourSchema = z.object({
  t: z.string().describe("ISO date-time with offset, start of the hour."),
  temp: z.number(),
  condition: weatherConditionSchema,
  isDay: z
    .boolean()
    .optional()
    .describe("Night hours show moon icons. Defaults to day."),
  precipChance: z.number().min(0).max(100).optional(),
})

export const weatherDaySchema = z.object({
  date: z.string().describe("Local calendar date, e.g. '2026-11-14'."),
  min: z.number(),
  max: z.number(),
  condition: weatherConditionSchema,
  precipChance: z.number().min(0).max(100).optional(),
  sunrise: z
    .string()
    .optional()
    .describe("ISO date-time with offset. Screen readers only."),
  sunset: z
    .string()
    .optional()
    .describe("ISO date-time with offset. Screen readers only."),
})

export const weatherAlertSchema = z.object({
  severity: z.enum(["advisory", "watch", "warning"]),
  title: z.string().describe("As issued, e.g. 'Winter storm warning'."),
  starts: z.string().describe("ISO date-time with offset."),
  ends: z.string().describe("ISO date-time with offset."),
  description: z
    .string()
    .max(280)
    .optional()
    .describe("The issuer's summary, shortened if needed."),
})

export const weatherSchema = z.object({
  location: z
    .object({
      name: z.string().describe("e.g. 'Lisbon'."),
      region: z.string().optional().describe("e.g. 'Portugal' or 'CO, USA'."),
    })
    .describe("DATA-BOUND."),
  asOf: z.string().describe("DATA-BOUND. ISO date-time of the observation."),
  timezone: z
    .string()
    .describe("IANA time zone of the location, e.g. 'Europe/Lisbon'."),
  units: z
    .enum(["metric", "imperial"])
    .describe("Units of every temperature and wind speed in the payload."),
  current: weatherCurrentSchema.describe("DATA-BOUND. Current conditions."),
  alerts: z
    .array(weatherAlertSchema)
    .max(3)
    .optional()
    .describe(
      "DATA-BOUND. Official alerts in effect. Omit when there are none.",
    ),
  highlight: z
    .object({
      date: z
        .string()
        .optional()
        .describe("A daily date this answer is about; that row is marked."),
      note: z
        .string()
        .max(160)
        .describe(
          "Your one-sentence answer, e.g. 'Saturday is dry; rain arrives Sunday after 2 pm'.",
        ),
    })
    .optional(),
  hourly: z
    .array(weatherHourSchema)
    .max(24)
    .optional()
    .describe("DATA-BOUND. Up to 24 hours from now."),
  daily: z
    .array(weatherDaySchema)
    .max(10)
    .optional()
    .describe(
      "DATA-BOUND. Up to 10 days in date order, usually starting today.",
    ),
  source: z
    .object({
      label: z.string().describe("Weather provider."),
      url: z.string().optional().describe("http(s) link to the forecast."),
    })
    .describe("DATA-BOUND."),
})

export type WeatherCondition = z.infer<typeof weatherConditionSchema>
export type WeatherCurrent = z.infer<typeof weatherCurrentSchema>
export type WeatherHour = z.infer<typeof weatherHourSchema>
export type WeatherDay = z.infer<typeof weatherDaySchema>
export type WeatherAlert = z.infer<typeof weatherAlertSchema>
export type WeatherInput = z.input<typeof weatherSchema>

/** Usage guidance the agent reads before choosing this component. */
export const weatherGuidance = {
  useWhen: [
    "The user asks about the weather somewhere, or is planning around it: a trip, an event, packing, a drive.",
    "A weather tool returned the forecast for that place.",
  ],
  avoidWhen: [
    "You have no forecast from a tool. Never invent or recall readings.",
    "Weather is incidental and one sentence answers it.",
    "The user compares many places at once. Use a data table.",
  ],
  rules: [
    "Copy readings from the tool result unchanged, in the units it returned.",
    "Put your answer to the question in highlight.note, and set highlight.date to the day it's about.",
    "Include hourly when today or tonight matters, and daily when the question spans days.",
    "Include alerts only when the tool returned official ones; never write your own.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(weatherSchema)`.
 */
export const weatherTool = {
  name: "show_weather",
  description: [
    "Show the forecast for one place: current conditions, alerts, hourly and daily outlooks, with a one-line answer.",
    `Use when: ${weatherGuidance.useWhen.join(" ")}`,
    `Avoid when: ${weatherGuidance.avoidWhen.join(" ")}`,
    `Rules: ${weatherGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: weatherSchema,
} as const
