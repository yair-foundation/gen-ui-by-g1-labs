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
 * Layout Stack: the agent's contract.
 *
 * Several components, one under the other, as one tool call. The plainest
 * way to compose an answer from catalog parts, and the place where a child
 * can bind to a sibling's result (a picker above, a summary below).
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
    .describe("Lets siblings bind to this child's result, e.g. 'slot'."),
})

export const layoutStackItemSchema = genuiChildSchema.extend({
  label: z
    .string()
    .max(40)
    .optional()
    .describe(
      "A small heading above the component, only when the group needs one, e.g. 'Then'.",
    ),
})

export const layoutStackSchema = z.object({
  items: z.array(layoutStackItemSchema).min(2).max(6),
  gap: z
    .enum(["tight", "normal"])
    .default("normal")
    .describe("'tight' for parts of one thing, 'normal' between separate parts."),
})

export type LayoutStackItem = z.input<typeof layoutStackItemSchema>
export type LayoutStackInput = z.input<typeof layoutStackSchema>

export const layoutStackGuidance = {
  useWhen: [
    "One answer needs 2–6 components that belong together and should arrive as one piece: a summary over a table, a picker over a confirmation, a chart over its KPIs.",
    "A component below should follow what the user does in a component above (a bind).",
  ],
  avoidWhen: [
    "The parts are independent answers. Call each tool on its own; the host stacks them anyway.",
    "The parts are parallel views the user switches between. Use tabs.",
    "The parts are a procedure with an order. Use steps.",
  ],
  rules: [
    "Put the main answer first.",
    "Give an id to any child whose result another child binds to, and write { \"$bind\": \"<id>.<path>\", \"default\": … } in the dependent child's props. Binds only copy values.",
    "A layout may hold one more layout (columns, grid, split) and no deeper.",
    "Each interactive child's result comes back as { child, result }; the host keeps the latest per child.",
  ],
} as const

export const layoutStackTool = {
  name: "show_stack",
  description: [
    "Stack 2–6 components one under the other as one piece, optionally wiring one child's result into another's props.",
    `Use when: ${layoutStackGuidance.useWhen.join(" ")}`,
    `Avoid when: ${layoutStackGuidance.avoidWhen.join(" ")}`,
    `Rules: ${layoutStackGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: layoutStackSchema,
} as const
