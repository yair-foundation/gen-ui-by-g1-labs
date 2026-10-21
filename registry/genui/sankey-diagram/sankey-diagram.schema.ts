import { z } from "zod"

/**
 * Sankey diagram: the agent's contract.
 *
 * Where an amount goes, stage by stage: one row per flow from a source to a
 * target, drawn as bands as wide as the amount, left to right.
 */

export const sankeyValueSchema = z.object({
  key: z.string().describe("Field in each data row that holds the flow's amount."),
  label: z
    .string()
    .max(32)
    .describe("What flows, 1–4 words, e.g. 'Spend' or 'Visitors'."),
  format: z
    .enum(["number", "currency", "percent"])
    .default("number")
    .describe("'percent' takes 12.5 to mean 12.5%."),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("ISO 4217 code for 'currency', e.g. 'EUR'."),
  unit: z
    .string()
    .max(12)
    .optional()
    .describe("Shown after amounts, e.g. 'GWh'. Not for currency or percent."),
})

export const sankeyDiagramSchema = z.object({
  title: z
    .string()
    .describe("What flows where, e.g. 'Where October's income went'."),
  description: z
    .string()
    .optional()
    .describe("Scope or source, e.g. 'All accounts, 1–31 Oct'."),
  source: z
    .string()
    .describe("Field naming where each flow starts, e.g. 'from'."),
  target: z
    .string()
    .describe("Field naming where each flow ends, e.g. 'to'."),
  value: sankeyValueSchema,
  highlight: z
    .string()
    .optional()
    .describe("A node the user asked about; everything flowing into and out of it is traced."),
  data: z
    .array(z.record(z.string(), z.union([z.string(), z.number()])))
    .min(2)
    .max(60)
    .describe(
      "DATA-BOUND. One row per flow from a tool result, with the source, target and value keys. The same name is the same node in every stage.",
    ),
  summary: z
    .string()
    .optional()
    .describe("One sentence naming the biggest flows, shown under the diagram."),
})

export type SankeyValue = z.infer<typeof sankeyValueSchema>
export type SankeyDiagramInput = z.input<typeof sankeyDiagramSchema>

/** Usage guidance the agent reads before choosing this component. */
export const sankeyDiagramGuidance = {
  useWhen: [
    "The question is where an amount goes, or comes from, across two or more stages: income to spending categories to items, a budget to departments to teams, traffic sources to pages to sign-ups, energy from fuels to uses.",
  ],
  avoidWhen: [
    "A whole splits once (spend by category). Use a composition chart.",
    "People drop out of one sequence of steps. Use a funnel.",
    "Amounts loop back (A to B and back to A). Use a table.",
    "You don't have the amounts from a tool. Never invent them.",
  ],
  rules: [
    "One row per flow with a source, a target and an amount in one unit; flows into a node should add up to what flows out.",
    "Give every node a short, unique name (1–3 words): the same name in two stages is one node, so write 'Other cloud' and 'Other marketing', not 'Other' twice.",
    "Keep it readable: at most 5 stages and about 20 nodes; fold small flows into an 'Other …' node first.",
    "Set highlight to the node the user asked about.",
    "In summary, name the biggest flow and anything surprising, in plain words.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(sankeyDiagramSchema)`.
 */
export const sankeyDiagramTool = {
  name: "show_sankey",
  description: [
    "Show where an amount flows across stages as a Sankey diagram: one row per flow from a source to a target, bands as wide as the amount, with a traced highlight and hover details.",
    `Use when: ${sankeyDiagramGuidance.useWhen.join(" ")}`,
    `Avoid when: ${sankeyDiagramGuidance.avoidWhen.join(" ")}`,
    `Rules: ${sankeyDiagramGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: sankeyDiagramSchema,
} as const
