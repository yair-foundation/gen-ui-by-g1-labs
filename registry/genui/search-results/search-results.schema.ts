import { z } from "zod"

/**
 * Search Results: the agent's contract.
 *
 * A collection the agent retrieved (documents, listings, tickets, people),
 * which the user narrows, sorts and explores. Filters are computed locally
 * from the results; searching the source again goes back to the agent.
 * Fields marked DATA-BOUND must come from a tool result.
 */

export const facetValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
])

export const searchResultItemSchema = z.object({
  id: z.string().describe("DATA-BOUND. The record's real id."),
  title: z.string().describe("DATA-BOUND."),
  subtitle: z
    .string()
    .optional()
    .describe("DATA-BOUND. One line, e.g. the area or author."),
  snippet: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. Short excerpt; wrap matched terms in **double asterisks**, no other markdown.",
    ),
  url: z
    .string()
    .optional()
    .describe("DATA-BOUND. http(s). Without it, a title click sends 'open'."),
  image: z
    .object({
      src: z
        .string()
        .describe("DATA-BOUND. http(s) or same-origin path (single leading '/')."),
      alt: z.string(),
    })
    .optional(),
  meta: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .max(4)
    .optional()
    .describe("DATA-BOUND. e.g. Price, Area."),
  facets: z
    .record(z.string(), facetValueSchema)
    .optional()
    .describe(
      "DATA-BOUND. Raw values by facet id and sort key: numbers (range), booleans (toggle), strings or string arrays (checkbox), ISO dates (date sorts).",
    ),
})

export const searchFacetSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z
    .enum(["checkbox", "range", "toggle"])
    .describe(
      "'checkbox': any of the values found. 'range': min–max over numbers. 'toggle': value is true.",
    ),
  unit: z.string().optional().describe("e.g. 'm²'."),
  format: z.enum(["currency", "number"]).optional(),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217, for format 'currency'."),
})

export const searchSortOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  key: z.string().describe("A facets key, or 'relevance' for the order sent."),
  direction: z.enum(["asc", "desc"]),
})

export const searchResultsSchema = z.object({
  query: z.string().describe("As the user would type it."),
  title: z.string().optional().describe("Default: the query."),
  total: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("DATA-BOUND. Total matches at the source."),
  results: z.array(searchResultItemSchema).max(200),
  facets: z
    .array(searchFacetSchema)
    .max(6)
    .optional()
    .describe("Filters; values and counts come from the results."),
  sort: z
    .array(searchSortOptionSchema)
    .max(6)
    .optional()
    .describe("The first is the initial sort."),
  view: z
    .enum(["list", "grid"])
    .default("list")
    .describe("'grid' for visual items."),
  hasMore: z.boolean().default(false).describe("The source has more results."),
  selectable: z
    .enum(["none", "single", "multiple"])
    .default("none")
    .describe("Let the user pick results."),
  submitLabel: z
    .string()
    .optional()
    .describe("Selection button label, e.g. 'Add to sprint'."),
})

export type FacetValue = z.infer<typeof facetValueSchema>
export type SearchResultItem = z.infer<typeof searchResultItemSchema>
export type SearchFacet = z.infer<typeof searchFacetSchema>
export type SearchSortOption = z.infer<typeof searchSortOptionSchema>
export type SearchResultsInput = z.input<typeof searchResultsSchema>
export type SearchResultsData = z.output<typeof searchResultsSchema>

/**
 * The user's local filters, keyed by facet id. Only active filters appear.
 * Checkbox: the picked values. Range: the narrowed bounds. Toggle: true.
 */
export type SearchFilters = Record<
  string,
  string[] | { min?: number; max?: number } | true
>

/** What the component sends back. A closed set of actions. */
export type SearchResultsResult =
  /** Run the search again at the source with this query and these filters. */
  | { action: "search"; query: string; filters: SearchFilters }
  /** Fetch the next page, starting at `offset`, and send all results so far. */
  | {
      action: "load-more"
      query: string
      filters: SearchFilters
      offset: number
    }
  /** The user picked these results. */
  | { action: "select"; ids: string[] }
  /** Open this result (it has no url). */
  | { action: "open"; id: string }
  /** None of these fit. */
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const searchResultsGuidance = {
  useWhen: [
    "You retrieved a collection the user will browse and narrow: listings, products, articles, tickets, people.",
    "There are enough results (roughly 5 or more) that filtering, sorting or paging helps.",
  ],
  avoidWhen: [
    "There are 1–3 results. Describe them, or use entity cards.",
    "The user needs to compare records across many columns or act on them in bulk. Use a data table.",
    "The user asked a question with one answer. Answer it.",
  ],
  rules: [
    "Every result, total and facet value must come from a tool result. Never invent results or counts.",
    "Send the query as you ran it. Set total when the source reports more matches than you sent, and hasMore when it can return another page.",
    "Only define facets that have values in the results, and put the values in each result's facets.",
    "Highlight matched terms in snippets with **double asterisks**, nothing else.",
    "On 'search', run the query again with the filters; on 'load-more', fetch the page at offset and send all results so far.",
    "Filters are local. Never claim the source was filtered unless you searched again.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(searchResultsSchema)`.
 */
export const searchResultsTool = {
  name: "show_search_results",
  description: [
    "Show search results the user can filter, sort, page through and pick from.",
    `Use when: ${searchResultsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${searchResultsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${searchResultsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: searchResultsSchema,
} as const
