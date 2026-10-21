import { z } from "zod"

/**
 * Region Map: the agent's contract.
 *
 * A static data map: US states or countries shaded by a value, and/or labelled
 * pins with a value each. For "where" questions about numbers, not for finding
 * places (use the Map for that).
 */

export const regionMapIcons = [
  "wind",
  "solar",
  "building",
  "factory",
  "store",
  "users",
  "dollar",
  "pin",
] as const

export const regionMapRegionSchema = z.object({
  id: z
    .string()
    .describe(
      "DATA-BOUND. US states: 2-letter code like 'TX' (FIPS like '48' and names work too). World: ISO 3166-1 alpha-3 like 'PRT' (numeric like '620' and names work too). Returned in the result.",
    ),
  value: z.number().describe("DATA-BOUND. The number that shades the region."),
  label: z
    .string()
    .max(32)
    .optional()
    .describe(
      "Text shown for the value instead of the formatted number, e.g. '$50M · 12 deals'.",
    ),
})

export const regionMapScaleSchema = z.object({
  format: z
    .enum(["currency", "number", "percent"])
    .default("number")
    .describe(
      "How values are written. Percent values are percentages: 12.5 means 12.5%.",
    ),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for 'currency', e.g. 'USD'."),
  steps: z
    .number()
    .int()
    .min(3)
    .max(7)
    .default(5)
    .describe("Number of equal-width shading buckets."),
  legendLabel: z
    .string()
    .max(48)
    .optional()
    .describe(
      "What the shading measures, e.g. 'Closed-won revenue'. Screen readers only.",
    ),
})

export const regionMapPinSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  lat: z.number().min(-90).max(90).describe("DATA-BOUND."),
  lng: z.number().min(-180).max(180).describe("DATA-BOUND."),
  label: z
    .string()
    .max(16)
    .describe("DATA-BOUND. The value on the pin, e.g. '$10M'. Keep it short."),
  title: z
    .string()
    .max(60)
    .optional()
    .describe(
      "DATA-BOUND. What the pin is, e.g. 'Mesa Wind Farm'. Shown on hover and in the list.",
    ),
  icon: z
    .enum(regionMapIcons)
    .optional()
    .describe("Icon on the label. Default 'pin'."),
  emphasis: z
    .boolean()
    .optional()
    .describe("Make this pin stand out. Use for one or two pins at most."),
})

export const regionMapSchema = z.object({
  title: z.string().optional().describe("e.g. 'Sales by state, Q3'."),
  description: z
    .string()
    .optional()
    .describe("One line on the data, e.g. the period or source."),
  geography: z
    .enum(["us-states", "world"])
    .describe("'us-states': the 50 states and DC. 'world': countries."),
  regions: z
    .array(regionMapRegionSchema)
    .max(250)
    .optional()
    .describe("DATA-BOUND. Regions shaded by value (a choropleth)."),
  scale: regionMapScaleSchema
    .optional()
    .describe("Formatting and buckets for region values."),
  pins: z
    .array(regionMapPinSchema)
    .max(12)
    .optional()
    .describe(
      "DATA-BOUND. Labelled points with coordinates from a tool result.",
    ),
  highlight: z
    .array(z.string())
    .max(250)
    .optional()
    .describe(
      "DATA-BOUND. Region ids to tint without a value, e.g. the states a team covers.",
    ),
  highlightLabel: z
    .string()
    .max(40)
    .optional()
    .describe("Legend text for highlighted regions, e.g. 'Service territory'."),
  selectable: z
    .enum(["none", "region", "pin"])
    .default("none")
    .describe(
      "'region': the user can choose a region with a value. 'pin': the user can choose a pin. 'none': display only.",
    ),
})

export type RegionMapRegion = z.infer<typeof regionMapRegionSchema>
export type RegionMapScale = z.input<typeof regionMapScaleSchema>
export type RegionMapPin = z.infer<typeof regionMapPinSchema>
export type RegionMapIcon = (typeof regionMapIcons)[number]
export type RegionMapInput = z.input<typeof regionMapSchema>

/** Sent back when the user chooses a region or a pin (only when selectable). */
export type RegionMapResult =
  | { action: "select-region"; id: string }
  | { action: "select-pin"; id: string }

/** Usage guidance the agent reads before choosing this component. */
export const regionMapGuidance = {
  useWhen: [
    "The answer is a number per state or country and where it happens matters: sales by state, users by country.",
    "A few sites with a value each, where their location tells the story: projects and their size, deals and their value.",
    "The user should pick a state, country or site from data you show.",
  ],
  avoidWhen: [
    "The user needs to find, compare or route between places, or drop a pin. Use the Map.",
    "Exact comparison matters more than geography. Use a chart or a data table.",
    "There are only one or two regions. Say it in a sentence.",
    "The data isn't by US state or country, e.g. cities in one region or sales territories.",
  ],
  rules: [
    "Take every value, id and coordinate from a tool result. Never guess coordinates.",
    "Use regions for a value per state or country, pins for individual sites, highlight for a set of regions without values.",
    "Keep pin labels to the value ('$10M') and put the name in title.",
    "Set scale.format and currency so values read correctly; percent values are percentages.",
    "Only set selectable when the user's choice changes what you do next.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(regionMapSchema)`.
 */
export const regionMapTool = {
  name: "show_region_map",
  description: [
    "Show a static map of US states or countries shaded by a value, with optional labelled pins.",
    `Use when: ${regionMapGuidance.useWhen.join(" ")}`,
    `Avoid when: ${regionMapGuidance.avoidWhen.join(" ")}`,
    `Rules: ${regionMapGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: regionMapSchema,
} as const
