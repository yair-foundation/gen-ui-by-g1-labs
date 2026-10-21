import { z } from "zod"

/**
 * Data Table: the agent's contract.
 *
 * Tabular results the user can sort, select and act on in bulk.
 * Fields marked DATA-BOUND must come from a tool result.
 */

export const cellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
])

export const columnSchema = z.object({
  key: z.string().describe("Matches the keys in each row's cells."),
  label: z.string(),
  type: z
    .enum(["text", "number", "currency", "percent", "date", "status"])
    .default("text")
    .describe(
      "Formatting. 'percent' takes 12.5 to mean 12.5%. 'date' takes an ISO date string. 'status' is plain text unless listed in negative.",
    ),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for 'currency', e.g. 'USD'."),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe("Fixed decimals for 'number' and 'percent'."),
  negative: z
    .array(z.string())
    .optional()
    .describe(
      "For 'status': values shown as a negative badge, e.g. ['At risk'].",
    ),
  sortable: z.boolean().default(true),
})

export const rowSchema = z.object({
  id: z
    .string()
    .describe("DATA-BOUND. The record's real id. Returned in the result."),
  cells: z
    .record(z.string(), cellValueSchema)
    .describe("DATA-BOUND. Values keyed by column key, from a tool result."),
  flag: z
    .string()
    .optional()
    .describe(
      "One short line on why this row matters, e.g. 'ROAS below 1.0 for 7 days'.",
    ),
  selected: z
    .boolean()
    .optional()
    .describe("Pre-select this row. Use for the rows you recommend acting on."),
})

export const tableActionSchema = z.object({
  id: z.string().describe("Returned in the result. A closed set you handle."),
  label: z.string().describe("Verb phrase, e.g. 'Pause ads'."),
  variant: z.enum(["default", "destructive"]).default("default"),
})

export const dataTableSchema = z.object({
  title: z
    .string()
    .describe("What the table shows, e.g. 'Ads below target ROAS'."),
  description: z.string().optional(),
  columns: z.array(columnSchema).min(1).max(8),
  rows: z.array(rowSchema).max(200),
  selectable: z
    .boolean()
    .default(false)
    .describe("Lets the user pick rows. Required for actions."),
  actions: z
    .array(tableActionSchema)
    .max(3)
    .optional()
    .describe("Bulk actions on the selected rows."),
  sort: z
    .object({ key: z.string(), direction: z.enum(["asc", "desc"]) })
    .optional()
    .describe("Initial sort. Put the most important rows first."),
  pageSize: z
    .number()
    .int()
    .min(3)
    .max(50)
    .optional()
    .describe(
      "Only for long tables: rows shown before 'Show more'. Omit to show every row.",
    ),
})

export type CellValue = z.infer<typeof cellValueSchema>
export type Column = z.infer<typeof columnSchema>
export type Row = z.infer<typeof rowSchema>
export type TableAction = z.infer<typeof tableActionSchema>
export type DataTableInput = z.input<typeof dataTableSchema>
export type DataTableData = z.output<typeof dataTableSchema>

/** What the component sends back when the user runs a bulk action. */
export type DataTableResult = {
  action: string
  rowIds: string[]
}

/** Usage guidance the agent reads before choosing this component. */
export const dataTableGuidance = {
  useWhen: [
    "You are showing several records with the same fields, where comparing across rows matters.",
    "The user may want to act on some of the rows, e.g. pause ads, email contacts, close tickets.",
  ],
  avoidWhen: [
    "There are 1–2 records. Describe them in text or use entity cards.",
    "There is one number to report. Answer in a sentence.",
    "The point is a trend over time. Use a chart.",
    "Comparing 2–3 options side by side across many attributes. Use a comparison.",
  ],
  rules: [
    "Every row and value must come from a tool result. Never invent or round records.",
    "Keep to the 3–6 columns that answer the question; put the identifying column first.",
    "Sort so the rows that matter come first, flag them, and pre-select the ones you recommend acting on.",
    "An action is the user's intent, not a confirmed write. Before changing anything, show a change preview.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(dataTableSchema)`.
 */
export const dataTableTool = {
  name: "show_table",
  description: [
    "Show records in a sortable table; optionally let the user select rows and pick a bulk action.",
    `Use when: ${dataTableGuidance.useWhen.join(" ")}`,
    `Avoid when: ${dataTableGuidance.avoidWhen.join(" ")}`,
    `Rules: ${dataTableGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: dataTableSchema,
} as const
