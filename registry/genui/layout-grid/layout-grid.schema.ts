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
 * Layout Grid: the agent's contract.
 *
 * A dashboard-style grid of mixed components: small cards in 2–3 columns,
 * with any item allowed to span wider. Unlike columns, the items need not
 * match, and there can be more of them.
 */

export const genuiChildSchema = z.object({
  component: z
    .string()
    .describe(
      "Catalog name, e.g. 'show_kpis'. A layout may hold one more layout, no deeper.",
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

export const layoutGridItemSchema = genuiChildSchema.extend({
  span: z
    .union([z.literal(1), z.literal(2), z.literal("full")])
    .default(1)
    .describe(
      "Columns this item takes on wide screens. 'full' for a chart or table under a row of cards.",
    ),
})

export const layoutGridSchema = z.object({
  columns: z
    .union([z.literal(2), z.literal(3)])
    .default(2)
    .describe("Columns on wide screens; always one column on phones."),
  items: z.array(layoutGridItemSchema).min(2).max(9),
})

export type LayoutGridItem = z.input<typeof layoutGridItemSchema>
export type LayoutGridInput = z.input<typeof layoutGridSchema>

export const layoutGridGuidance = {
  useWhen: [
    "An overview made of several small, different components: KPIs, a chart, a short table, an insight, each from its own data.",
    "Some items deserve more width than others.",
  ],
  avoidWhen: [
    "The items are the same kind, side by side for comparison. Use columns.",
    "It's one component. Call it on its own.",
    "The items are long or interactive forms. Stack them.",
  ],
  rules: [
    "Order items by importance, reading left to right, top to bottom; the first item is the headline.",
    "Use span 'full' for the one wide item (a chart, a table), at most two of them.",
    "Keep items short: cards, not documents. Long content breaks the grid.",
    "A layout may hold one more layout and no deeper.",
  ],
} as const

export const layoutGridTool = {
  name: "show_grid",
  description: [
    "Arrange 2–9 mixed components in a 2–3 column grid, with items that can span wider.",
    `Use when: ${layoutGridGuidance.useWhen.join(" ")}`,
    `Avoid when: ${layoutGridGuidance.avoidWhen.join(" ")}`,
    `Rules: ${layoutGridGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: layoutGridSchema,
} as const
