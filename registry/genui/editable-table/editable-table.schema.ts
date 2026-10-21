import { z } from "zod"

/**
 * Editable Table: the agent's contract.
 *
 * Records the user corrects in place like a small spreadsheet: edit cells,
 * add and delete rows, undo, then save. The user's edits come back as a diff.
 * Fields marked DATA-BOUND must come from a tool result.
 */

export const editableCellSchema = z.union([z.string(), z.number(), z.null()])

export const editableColumnSchema = z.object({
  key: z.string().describe("Matches the keys in each row's cells."),
  label: z.string().max(32),
  type: z
    .enum(["text", "number", "select", "url", "date"])
    .default("text")
    .describe(
      "Editor and formatting. 'select' picks one of options and shows a tag. 'url' shows the domain as a link. 'date' takes an ISO date, 'YYYY-MM-DD'.",
    ),
  options: z
    .array(z.string().min(1).max(32))
    .max(12)
    .optional()
    .describe(
      "For 'select': the allowed values, from the system the table writes to. The first five get their own tag colours, by position.",
    ),
  readOnly: z
    .boolean()
    .optional()
    .describe("The user can't change this column, e.g. a computed field."),
  sortable: z.boolean().default(true),
})

export const editableRowSchema = z.object({
  id: z
    .string()
    .describe("DATA-BOUND. The record's real id. Returned in the result."),
  cells: z
    .record(z.string(), editableCellSchema)
    .describe("DATA-BOUND. Values keyed by column key, from a tool result."),
  logo: z
    .object({
      url: z
        .string()
        .describe(
          "DATA-BOUND. The brand's logo mark: http(s), or a same-origin path starting with a single slash.",
        ),
      darkUrl: z
        .string()
        .optional()
        .describe(
          "DATA-BOUND. A version of the mark for dark backgrounds, when the source has one.",
        ),
      alt: z.string().optional().describe("e.g. 'Figma'."),
    })
    .optional()
    .describe(
      "The row's brand logo, a small mark beside the first column. Only when the data provides one; never invent a URL.",
    ),
})

export const editableTableSchema = z.object({
  title: z
    .string()
    .max(60)
    .describe("What the records are, e.g. 'Design stack'."),
  description: z.string().max(80).optional(),
  columns: z.array(editableColumnSchema).min(1).max(6),
  rows: z.array(editableRowSchema).max(100),
  allowAdd: z
    .boolean()
    .default(true)
    .describe(
      "Lets the user add rows. Turn off when records can't be created.",
    ),
  allowDelete: z
    .boolean()
    .default(true)
    .describe(
      "Lets the user delete rows. Turn off when records can't be removed.",
    ),
  sort: z
    .object({ key: z.string(), direction: z.enum(["asc", "desc"]) })
    .optional()
    .describe("Initial sort."),
  submitLabel: z
    .string()
    .max(24)
    .optional()
    .describe("Save button label. Defaults to 'Save changes'."),
})

export type EditableCell = z.infer<typeof editableCellSchema>
export type EditableColumn = z.infer<typeof editableColumnSchema>
export type EditableRow = z.infer<typeof editableRowSchema>
export type EditableTableInput = z.input<typeof editableTableSchema>
export type EditableTableData = z.output<typeof editableTableSchema>

/**
 * What the component sends back when the user saves. Only what changed:
 * `updated` carries just the edited cells of each existing row, `added` the
 * full cells of new rows (no id yet), `deleted` the ids of removed rows.
 */
export type EditableTableResult = {
  action: "save"
  updated: { id: string; cells: Record<string, EditableCell> }[]
  added: { cells: Record<string, EditableCell> }[]
  deleted: string[]
}

/** Usage guidance the agent reads before choosing this component. */
export const editableTableGuidance = {
  useWhen: [
    "The user wants to fix, fill in or update several records with the same fields, e.g. 'let me clean up our tool list', 'update the renewal dates'.",
    "The user will add or remove a few rows and change values across them before anything is saved.",
  ],
  avoidWhen: [
    "The user wants to read, sort or act on records in bulk without changing values. Use a data table.",
    "You are proposing specific changes for the user to approve. Use a change preview with before/after values.",
    "One record with many fields. Use a generated form.",
    "Editing generated text. Use the inline editor.",
  ],
  rules: [
    "Every row and value must come from a tool result. Never invent records or fill blanks with guesses; leave a missing value null.",
    "Keep to the 2–6 columns the user will edit; put the identifying column first.",
    "Give a 'select' column every allowed value as options, so the user can't type one the system rejects.",
    "Mark computed or system fields readOnly.",
    "The result is the user's intended changes, not a confirmed write. Apply them with your tools, then report what was saved.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(editableTableSchema)`.
 */
export const editableTableTool = {
  name: "edit_table",
  description: [
    "Show records in an editable table: the user edits cells, adds and deletes rows, then saves; you get back only what changed.",
    `Use when: ${editableTableGuidance.useWhen.join(" ")}`,
    `Avoid when: ${editableTableGuidance.avoidWhen.join(" ")}`,
    `Rules: ${editableTableGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: editableTableSchema,
} as const
