import { z } from "zod"

/**
 * Entity Picker: the agent's contract.
 *
 * The user chooses among real records the agent fetched: ad accounts,
 * campaigns, files, teammates. Fields marked DATA-BOUND must come from a tool
 * result, never from model free text.
 */

export const pickerEntitySchema = z.object({
  id: z
    .string()
    .describe("DATA-BOUND. The record's real id. Returned in the result."),
  label: z.string().describe("DATA-BOUND. The record's name."),
  description: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. One line that tells similar records apart, e.g. an email or an account id.",
    ),
  meta: z
    .string()
    .max(32)
    .optional()
    .describe(
      "DATA-BOUND. A short fact shown on the right, e.g. '$12.4k spend'.",
    ),
  group: z
    .string()
    .optional()
    .describe("Heading that groups records, e.g. the parent account."),
})

export const entityPickerSchema = z.object({
  title: z.string().describe("What to pick, e.g. 'Choose an ad account'."),
  description: z.string().optional(),
  entities: z
    .array(pickerEntitySchema)
    .min(1)
    .max(200)
    .describe(
      "DATA-BOUND. The records from your tool result, in a useful order (most relevant first). Never invent records.",
    ),
  multiple: z
    .boolean()
    .default(false)
    .describe("Let the user pick more than one."),
  min: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Fewest picks allowed. Default 1."),
  max: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Most picks allowed when multiple is true."),
  searchable: z
    .boolean()
    .optional()
    .describe(
      "Show a search filter. Default: on when there are more than 6 records.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe("Verb for the confirm button, e.g. 'Use this account'."),
})

export type PickerEntity = z.infer<typeof pickerEntitySchema>
export type EntityPickerInput = z.input<typeof entityPickerSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type EntityPickerResult =
  | {
      action: "select"
      /** Ids of the chosen records, in list order. */
      ids: string[]
    }
  /** The user closed the picker. Ask in text what they want instead. */
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const entityPickerGuidance = {
  useWhen: [
    "The user must choose which real records to work with: an ad account, campaigns, files, teammates.",
    "You fetched more than one candidate and cannot tell which they mean.",
  ],
  avoidWhen: [
    "Only one record matches. Use it and say which one.",
    "The choices are not records but options or preferences. Use the question stepper.",
    "You have not fetched the records yet. Fetch them first; never list records from memory.",
  ],
  rules: [
    "Every entity must come from a tool result, with its real id.",
    "Use description to tell similar records apart (account id, email, path).",
    "Use group when records belong to different parents, e.g. campaigns by ad account.",
    "Set multiple and max only when the next step can take several records.",
    "Act only on the ids returned with action 'select'.",
  ],
} as const

/** Lowercase, accent-insensitive text for matching. */
function fold(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/**
 * True when every word of the query appears in the entity's label,
 * description, meta or group. An empty query matches everything.
 */
export function matchesEntity(
  entity: Partial<
    Pick<PickerEntity, "label" | "description" | "meta" | "group">
  >,
  query: string,
) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = fold(
    [entity.label, entity.description, entity.meta, entity.group]
      .filter(Boolean)
      .join(" "),
  )
  return words.every((w) => haystack.includes(w))
}

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(entityPickerSchema)`.
 */
export const entityPickerTool = {
  name: "pick_entities",
  description: [
    "Let the user choose one or more real records you fetched, and wait for their choice.",
    `Use when: ${entityPickerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${entityPickerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${entityPickerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: entityPickerSchema,
} as const
