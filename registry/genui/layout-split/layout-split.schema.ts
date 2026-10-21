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
 * Layout Split: the agent's contract.
 *
 * A main component with a narrower aside beside it: a map with its list, an
 * article with its summary, a table with the controls that filter it.
 */

export const genuiChildSchema = z.object({
  component: z
    .string()
    .describe(
      "Catalog name, e.g. 'show_map'. A layout may hold one more layout, no deeper.",
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
    .describe("Lets the other side bind to this child's result."),
})

export const layoutSplitSchema = z.object({
  main: genuiChildSchema.describe(
    "The larger side: the answer itself. An object { component, props }, never a JSON string.",
  ),
  aside: genuiChildSchema.describe(
    "The narrower side: what goes with the answer (a list, a summary, controls). An object { component, props }, never a JSON string.",
  ),
  asideWidth: z
    .enum(["narrow", "wide"])
    .default("narrow")
    .describe("'narrow' is a third of the width, 'wide' is two fifths."),
  asidePosition: z
    .enum(["end", "start"])
    .default("end")
    .describe(
      "'end' puts the aside after the main (right, in left-to-right languages).",
    ),
})

export type LayoutSplitInput = z.input<typeof layoutSplitSchema>

export const layoutSplitGuidance = {
  useWhen: [
    "One component is the answer and another belongs beside it: a map and the places on it, an article and its key facts, a chart and the controls that drive it.",
  ],
  avoidWhen: [
    "The two parts are equals to compare. Use columns.",
    "Both parts are wide (two tables, two charts). Stack them.",
    "There are more than two parts. Use a grid or a stack.",
  ],
  rules: [
    "main holds the answer; aside holds what supports it, and must read well at a third of the width.",
    "Put controls that drive the main component in the aside, and bind the main's props to their result with { \"$bind\" }.",
    "A layout may hold one more layout and no deeper.",
  ],
} as const

export const layoutSplitTool = {
  name: "show_split",
  description: [
    "Show a main component with a narrower aside beside it; they stack on phones.",
    `Use when: ${layoutSplitGuidance.useWhen.join(" ")}`,
    `Avoid when: ${layoutSplitGuidance.avoidWhen.join(" ")}`,
    `Rules: ${layoutSplitGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: layoutSplitSchema,
} as const
