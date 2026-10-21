import { z } from "zod"

/**
 * Revenue Estimator: the agent's contract.
 *
 * A small what-if for income from a headcount: the user drags how many people
 * take part, picks a price per person and sees the total. Fields marked
 * DATA-BOUND must come from the user or a tool result, never be invented.
 */

export const revenueEstimatorTierSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z.string().max(30).describe("e.g. 'Early bird', 'Standard'."),
  price: z
    .number()
    .nonnegative()
    .describe("DATA-BOUND. Price per person, in `currency`."),
})

export const revenueEstimatorSchema = z.object({
  question: z
    .string()
    .optional()
    .describe("The question this answers, shown above the card."),
  title: z
    .string()
    .describe("Card heading, e.g. 'Revenue per cohort'."),
  countLabel: z
    .string()
    .max(30)
    .describe("What the slider counts, e.g. 'Participants'."),
  priceLabel: z
    .string()
    .max(30)
    .describe("Heading over the price options, e.g. 'Price per participant'."),
  currency: z
    .string()
    .length(3)
    .default("USD")
    .describe("ISO 4217 code, e.g. 'ILS', 'USD'."),
  min: z.number().int().min(0).default(1),
  max: z.number().int().min(1).max(10000).default(50),
  step: z.number().int().min(1).default(1),
  value: z
    .number()
    .int()
    .optional()
    .describe("The starting count, e.g. what the user said. Defaults to the midpoint."),
  tiers: z
    .array(revenueEstimatorTierSchema)
    .min(2)
    .max(5)
    .describe("The price options, cheapest first."),
  tierId: z
    .string()
    .optional()
    .describe("The tier selected at the start. Defaults to the first."),
  totalLabel: z
    .string()
    .max(60)
    .describe("Caption over the total, e.g. 'Revenue including ticket sales'."),
  note: z
    .string()
    .max(120)
    .optional()
    .describe("One line under the total, e.g. 'Before VAT, fees and costs.'"),
})

export type RevenueEstimatorTier = z.infer<typeof revenueEstimatorTierSchema>
export type RevenueEstimatorInput = z.input<typeof revenueEstimatorSchema>
export type RevenueEstimatorData = z.output<typeof revenueEstimatorSchema>

/** Sent (debounced) each time the user settles on a count or price. */
export type RevenueEstimatorResult = {
  action: "set"
  count: number
  tierId: string
  price: number
  /** count × price, as shown. */
  total: number
}

/** Usage guidance the agent reads before choosing this component. */
export const revenueEstimatorGuidance = {
  useWhen: [
    "The user asks how much they could earn from a number of paying people: a course cohort, workshop, event or tour.",
    "There are a few price options to compare and the headcount is uncertain.",
  ],
  avoidWhen: [
    "Income depends on more than a count and a price (costs, discounts, growth over time). Use a simulation or calculator.",
    "There is a single price and a fixed count. State the number in text.",
    "You don't know the prices. Ask first; they are data, not guesses.",
  ],
  rules: [
    "Set value to the headcount the user mentioned, otherwise leave it for the midpoint.",
    "Give two to five tiers, cheapest first, each with a short label.",
    "Use note for what the total leaves out (fees, VAT, costs), in one line.",
    "Present the total as an estimate from the stated prices, not advice.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(revenueEstimatorSchema)`.
 */
export const revenueEstimatorTool = {
  name: "estimate_revenue",
  description: [
    "Show a revenue estimator: a participants slider, price-per-person options and the resulting total, updating live.",
    `Use when: ${revenueEstimatorGuidance.useWhen.join(" ")}`,
    `Avoid when: ${revenueEstimatorGuidance.avoidWhen.join(" ")}`,
    `Rules: ${revenueEstimatorGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: revenueEstimatorSchema,
} as const
