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
 * Layout Columns: the agent's contract.
 *
 * Puts 2–3 components side by side for comparison. Columns stack on phones.
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

export const layoutColumnsSchema = z.object({
  columns: z
    .union([z.literal(2), z.literal(3)])
    .default(2)
    .describe("Columns on wide screens; always one column on phones."),
  items: z.array(genuiChildSchema).min(2).max(6),
})

export type LayoutColumnsInput = z.input<typeof layoutColumnsSchema>

export const layoutColumnsGuidance = {
  useWhen: [
    "The user is comparing 2–3 options and seeing them side by side helps, e.g. two plans, three flights.",
  ],
  avoidWhen: [
    "Comparing many items across many fields. Use a data table.",
    "The items are long. Side-by-side long content is hard to read; stack them.",
  ],
  rules: [
    "Give every item the same component and the same fields, in the same order.",
    "A layout may hold one more layout and no deeper; never nest columns in columns.",
    "Each interactive child's result comes back as { child, result }; the host keeps the latest per child.",
  ],
} as const

export const layoutColumnsTool = {
  name: "show_columns",
  description: [
    "Show 2–3 components side by side for comparison.",
    `Use when: ${layoutColumnsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${layoutColumnsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${layoutColumnsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: layoutColumnsSchema,
} as const
