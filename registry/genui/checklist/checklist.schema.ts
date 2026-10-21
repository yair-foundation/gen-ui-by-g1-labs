import { z } from "zod"

/**
 * Checklist: the agent's contract.
 *
 * Steps the user carries out over time, checked off as they go.
 */

export const checklistItemSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .describe(
      "The step or thing, as short as possible: 'Parboil the potatoes', 'Rain jacket'.",
    ),
  description: z
    .string()
    .optional()
    .describe(
      "One line of detail under the step, if it helps. Switches the list to the step layout.",
    ),
  time: z
    .string()
    .max(24)
    .optional()
    .describe(
      "When to do it, shown small above the step: '12:30 PM' or 'Saturday'. Switches the list to the step layout.",
    ),
  group: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Section heading, e.g. 'Clothing'. Sections appear in the order their first item does.",
    ),
  meta: z
    .string()
    .max(24)
    .optional()
    .describe(
      "Who, shown on the right, e.g. 'IT'. Prefer `time` for when. Keep it short.",
    ),
  checked: z.boolean().optional().describe("Already done."),
})

export const checklistSchema = z.object({
  title: z.string().describe("e.g. 'Sunday cooking timeline'."),
  items: z.array(checklistItemSchema).min(2).max(20),
  ordered: z
    .boolean()
    .default(false)
    .describe("Number the steps when order matters."),
  countLabel: z
    .string()
    .max(16)
    .optional()
    .describe(
      "Word after the count: 'packed' shows '3/14 packed'. Omit for '3 of 14'.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe(
      "Adds a button that sends progress back to you, e.g. 'I'm ready'. Omit when you don't need to know.",
    ),
})

export type ChecklistItem = z.infer<typeof checklistItemSchema>
export type ChecklistInput = z.input<typeof checklistSchema>

/** Sent back when the user presses the submit button. */
export type ChecklistResult = {
  action: "submit"
  /** Ids of the checked items. */
  checked: string[]
}

/** Usage guidance the agent reads before choosing this component. */
export const checklistGuidance = {
  useWhen: [
    "The user will carry out several steps over time: a cooking timeline, onboarding, a renewal, a launch.",
    "Ticking things off helps them keep their place.",
  ],
  avoidWhen: [
    "The steps are things you will do yourself. Show an action plan or activity instead.",
    "There are only one or two steps. Say them in text.",
    "The list is information, not tasks. Use plain bullets.",
  ],
  rules: [
    "Write each step as an action the user takes, in the order they'll do it.",
    "For a timeline, give each step a time and, if useful, a one-line description. For a list of things (packing, documents), use short labels only.",
    "Use group to split long lists into sections, and countLabel for what the count means ('packed').",
    "Use meta only for an owner; keep it under a few words.",
    "Only add submitLabel when their progress changes what you do next.",
  ],
} as const

/* Pure helpers, shared by the component and its tests. */

export type ChecklistSection<T> = { group?: string; items: T[] }

/**
 * Splits items into sections by `group`, in the order each group first
 * appears. Ungrouped items before the first group stay in a headless section;
 * later ungrouped items join the section above them.
 */
export function checklistSections<T extends { group?: string }>(
  items: T[],
): ChecklistSection<T>[] {
  const sections: ChecklistSection<T>[] = []
  const byGroup = new Map<string, ChecklistSection<T>>()
  for (const item of items) {
    const group = item.group?.trim() || undefined
    let section = group ? byGroup.get(group) : sections[sections.length - 1]
    if (!section) {
      section = { group, items: [] }
      sections.push(section)
      if (group) byGroup.set(group, section)
    }
    section.items.push(item)
  }
  return sections
}

/** Step layout (time above a bold title, description under it) vs simple rows. */
export function checklistUsesSteps(
  items: { time?: string; description?: string }[],
): boolean {
  return items.some((i) => Boolean(i.time || i.description))
}

/** "3/14 packed" with a count label, otherwise "3 of 14". */
export function checklistCountText(
  done: number,
  total: number,
  countLabel?: string,
): string {
  const label = countLabel?.trim()
  return label ? `${done}/${total} ${label}` : `${done} of ${total}`
}

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(checklistSchema)`.
 */
export const checklistTool = {
  name: "show_checklist",
  description: [
    "Give the user a checklist to work through: timed steps, or things to pack or bring, optionally in sections.",
    `Use when: ${checklistGuidance.useWhen.join(" ")}`,
    `Avoid when: ${checklistGuidance.avoidWhen.join(" ")}`,
    `Rules: ${checklistGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: checklistSchema,
} as const
