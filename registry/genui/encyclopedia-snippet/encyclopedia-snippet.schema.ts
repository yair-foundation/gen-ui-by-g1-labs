import { z } from "zod"

/**
 * Encyclopedia Snippet: the agent's contract.
 *
 * A short encyclopedia-style summary of a topic, like the lead section of a
 * reference article, always credited to its source.
 */

export const encyclopediaImageSchema = z.object({
  src: z
    .string()
    .describe(
      "DATA-BOUND. The image URL from the source: http(s), a same-origin path starting with a single slash, or data:image. Anything else is not shown.",
    ),
  alt: z.string().describe("What the image shows, for screen readers."),
  caption: z.string().optional().describe("Caption from the source."),
  credit: z
    .string()
    .optional()
    .describe("DATA-BOUND. Who made the image, and its license if known."),
})

/** The icons an infobox row may carry. Names map to Lucide icons in the component. */
export const encyclopediaIcons = [
  "calendar",
  "clock",
  "map-pin",
  "globe",
  "flag",
  "users",
  "user",
  "building",
  "ruler",
  "mountain",
  "thermometer",
  "coins",
  "book",
  "languages",
  "award",
  "lightbulb",
] as const

export type EncyclopediaIcon = (typeof encyclopediaIcons)[number]

/** The kinds of article the title icon may show. */
export const encyclopediaKinds = [
  "person",
  "place",
  "concept",
  "organization",
  "event",
] as const

export type EncyclopediaKind = (typeof encyclopediaKinds)[number]

export const encyclopediaFactSchema = z.object({
  label: z.string().describe("e.g. 'Born', 'Population', 'Known for'."),
  value: z
    .string()
    .describe("DATA-BOUND. The value as the source states it, condensed."),
  icon: z
    .enum(encyclopediaIcons)
    .optional()
    .describe(
      "Optional icon that makes the row scannable: calendar for dates, map-pin for places, users for people or population. Use it on every row or on none.",
    ),
})

export const encyclopediaSectionSchema = z.object({
  title: z.string().describe("Section heading in the source, e.g. 'History'."),
  url: z
    .string()
    .optional()
    .describe("DATA-BOUND. Link to that section (http or https)."),
})

export const encyclopediaSourceSchema = z.object({
  name: z
    .string()
    .describe("DATA-BOUND. Who published it, e.g. 'Acme Encyclopedia'."),
  url: z.string().describe("DATA-BOUND. The full article (http or https)."),
  license: z
    .string()
    .optional()
    .describe("DATA-BOUND. The content license, e.g. 'CC BY-SA 4.0'."),
  retrievedAt: z
    .string()
    .optional()
    .describe(
      "When the text was fetched, as an ISO date or date-time. Only in the copied text.",
    ),
})

export const encyclopediaSnippetSchema = z.object({
  title: z.string().describe("DATA-BOUND. The article title, e.g. 'Lisbon'."),
  kind: z
    .enum(encyclopediaKinds)
    .optional()
    .describe(
      "What the article is about: person, place, concept, organization or event. Shown as a coloured icon beside the title. Omit when none fits.",
    ),
  subtitle: z
    .string()
    .max(120)
    .optional()
    .describe(
      "DATA-BOUND. The short description, e.g. 'English mathematician (1815–1852)'.",
    ),
  summary: z
    .string()
    .max(900)
    .describe(
      "DATA-BOUND. The lead, quoted or condensed from the source; never add facts it doesn't state. Separate paragraphs with a blank line. **bold** and [n] reference markers are allowed.",
    ),
  image: encyclopediaImageSchema
    .optional()
    .describe("The source's lead image. Omit when there isn't one."),
  facts: z
    .array(encyclopediaFactSchema)
    .max(8)
    .optional()
    .describe("Infobox rows from the source, most useful first."),
  sections: z
    .array(encyclopediaSectionSchema)
    .max(6)
    .optional()
    .describe("Sections of the full article worth reading next."),
  source: encyclopediaSourceSchema.describe(
    "Where the text comes from. Always shown.",
  ),
  related: z
    .array(z.string())
    .max(5)
    .optional()
    .describe(
      "Related topics the user can ask about next, e.g. 'Charles Babbage'.",
    ),
  language: z
    .string()
    .optional()
    .describe("BCP 47 language of the text, e.g. 'en' or 'pt'."),
})

export type EncyclopediaImage = z.infer<typeof encyclopediaImageSchema>
export type EncyclopediaFact = z.infer<typeof encyclopediaFactSchema>
export type EncyclopediaSection = z.infer<typeof encyclopediaSectionSchema>
export type EncyclopediaSource = z.infer<typeof encyclopediaSourceSchema>
export type EncyclopediaSnippetInput = z.input<typeof encyclopediaSnippetSchema>

/**
 * Sent when the user taps a related topic ("explore") or opens the full
 * article ("open"). The snippet never locks.
 */
export type EncyclopediaSnippetResult =
  | { action: "explore"; topic: string }
  | { action: "open" }

/** Usage guidance the agent reads before choosing this component. */
export const encyclopediaSnippetGuidance = {
  useWhen: [
    "The user asks who someone was, what something is, or about a place: 'Who was Ada Lovelace?', 'What is a heat pump?', 'Tell me about Lisbon'.",
    "You retrieved a reference article for the topic and can credit it.",
  ],
  avoidWhen: [
    "You have no source to credit. Answer in text.",
    "The question is about current events or live data. Use a sourced answer with citations.",
    "The user needs one fact. Say it in a sentence.",
  ],
  rules: [
    "Take every fact from the retrieved source, quoted or condensed. Never add facts it doesn't state.",
    "Keep the summary to the lead: 900 characters at most, in 1–3 paragraphs.",
    "Always set source with its name and URL, and the license when the source has one.",
    "Only include facts, image and sections that appear in the source.",
    "Offer related topics only when they are natural next questions.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(encyclopediaSnippetSchema)`.
 */
export const encyclopediaSnippetTool = {
  name: "show_encyclopedia",
  description: [
    "Show a short, credited encyclopedia-style summary of a person, thing or place, with key facts and links to read more.",
    `Use when: ${encyclopediaSnippetGuidance.useWhen.join(" ")}`,
    `Avoid when: ${encyclopediaSnippetGuidance.avoidWhen.join(" ")}`,
    `Rules: ${encyclopediaSnippetGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: encyclopediaSnippetSchema,
} as const
