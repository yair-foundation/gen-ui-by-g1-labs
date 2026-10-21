import { z } from "zod"

/** Child props may arrive as a JSON string (strict tool schemas, or a model that stringifies). */
function parseIfJSONString(value: unknown): unknown {
  if (typeof value !== "string") return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/**
 * Layout Tabs: the agent's contract.
 *
 * Splits a reply into 2–5 parallel views the user switches between. Each tab
 * holds other GenUI components, rendered through the catalog.
 */

export const genuiChildSchema = z.object({
  component: z
    .string()
    .describe(
      "Catalog name, e.g. 'show_summary'. A layout may hold one more layout, no deeper.",
    ),
  props: z
    .preprocess(
      parseIfJSONString,
      z.record(z.string(), z.unknown()),
    )
    .describe(
      "That component's props, following its own schema. A value may be { \"$bind\": \"<sibling id>.<path>\", \"default\": … } to copy a sibling's latest result.",
    ),
  id: z
    .string()
    .max(24)
    .optional()
    .describe("Lets siblings bind to this child's result."),
})

export const layoutTabsSchema = z.object({
  tabs: z
    .array(
      z.object({
        id: z.string(),
        label: z.string().max(24).describe("One or two words, e.g. 'Budget'."),
        children: z.array(genuiChildSchema).min(1).max(3),
      }),
    )
    .min(2)
    .max(5),
  defaultTab: z
    .string()
    .optional()
    .describe("Id of the tab to open first. It must hold the main answer."),
})

export type LayoutTabsInput = z.input<typeof layoutTabsSchema>

export const layoutTabsGuidance = {
  useWhen: [
    "The reply splits into 2–5 parallel views of the same subject the user will switch between, e.g. Overview / Itinerary / Budget.",
  ],
  avoidWhen: [
    "The content is a sequence the user moves through. Use a guided flow.",
    "There's only one view, or the views are short enough to stack.",
    "Something the user must see would end up hidden in a later tab.",
  ],
  rules: [
    "The first (or default) tab holds the main answer.",
    "A layout may hold one more layout and no deeper; never nest tabs in tabs.",
    "Each interactive child's result comes back as { child, result }; the host keeps the latest per child.",
  ],
} as const

export const layoutTabsTool = {
  name: "show_tabs",
  description: [
    "Group your reply into tabs, each holding other components.",
    `Use when: ${layoutTabsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${layoutTabsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${layoutTabsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: layoutTabsSchema,
} as const
