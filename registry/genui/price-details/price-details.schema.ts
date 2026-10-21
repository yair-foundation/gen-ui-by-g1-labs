import { z } from "zod"

/**
 * Price Details: the agent's contract.
 *
 * Everything about one item's price before buying: what it costs now, what it
 * will cost delivered, how the price has moved, and where it's cheapest. Every
 * price, row, point and offer is DATA-BOUND: it must come from a tool result
 * (a store, a price tracker, a checkout quote), never from model free text.
 * "Add to cart" is a handoff to the host's own cart.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "ISO 8601 date, e.g. '2026-08-12'")

export const breakdownKinds = [
  "base",
  "discount",
  "tax",
  "shipping",
  "fee",
  "deposit",
  "credit",
] as const

export const offerConditions = ["new", "refurbished", "used"] as const

export const dealVerdicts = ["good", "fair", "high"] as const

export const priceActions = [
  "watch-price",
  "add-to-cart",
  "open-offer",
] as const

export const priceItemSchema = z.object({
  name: z.string(),
  variant: z.string().max(80).optional().describe("e.g. 'Graphite · 256 GB'."),
  image: z
    .object({
      src: z
        .string()
        .describe("http(s), same-origin /path or data:image URL."),
      alt: z.string(),
    })
    .optional(),
  url: z.string().optional().describe("http(s) only."),
})

export const priceSchema = z.object({
  current: z.number().min(0).describe("DATA-BOUND."),
  was: z
    .number()
    .min(0)
    .optional()
    .describe(
      "DATA-BOUND. List or previous price, only when the source states it.",
    ),
  unit: z
    .object({
      amount: z.number().min(0),
      per: z.string().max(24).describe("e.g. '100 g', 'load', 'month'."),
    })
    .optional()
    .describe("DATA-BOUND."),
  memberPrice: z
    .object({
      amount: z.number().min(0),
      label: z.string().max(40).describe("Generic, e.g. 'Members'."),
    })
    .optional()
    .describe("DATA-BOUND."),
})

export const breakdownRowSchema = z.object({
  label: z.string().max(60).describe("e.g. 'VAT 21%'."),
  amount: z
    .number()
    .describe("As quoted. Discounts and credits subtract whatever the sign."),
  kind: z.enum(breakdownKinds),
  note: z
    .string()
    .max(80)
    .optional()
    .describe("One short line, e.g. 'Refundable'. Screen readers only."),
})

export const historyPointSchema = z.object({
  date: isoDate,
  price: z.number().min(0),
})

export const offerSchema = z.object({
  seller: z.string().max(60),
  price: z.number().min(0),
  shipping: z
    .number()
    .min(0)
    .optional()
    .describe("0: free. Omit if not listed."),
  total: z
    .number()
    .min(0)
    .optional()
    .describe("When the source states it. Default: price + shipping."),
  delivery: z
    .string()
    .max(40)
    .optional()
    .describe("As quoted, e.g. 'Thu, Oct 15'."),
  condition: z.enum(offerConditions).optional(),
  rating: z
    .object({ score: z.number().min(0), outOf: z.number().positive() })
    .optional()
    .describe("Seller rating. Screen readers only."),
  url: z.string().optional().describe("http(s) only."),
})

export const priceDetailsSchema = z.object({
  item: priceItemSchema.describe("DATA-BOUND."),
  currency: z.string().length(3).describe("ISO 4217, for every amount."),
  price: priceSchema,
  deal: z
    .object({
      verdict: z.enum(dealVerdicts),
      reason: z
        .string()
        .max(120)
        .describe("One sentence grounded in the data."),
    })
    .optional()
    .describe("Only when history or offers support it."),
  breakdown: z
    .array(breakdownRowSchema)
    .max(12)
    .optional()
    .describe("DATA-BOUND. As quoted."),
  total: z.number().optional().describe("DATA-BOUND. As quoted."),
  history: z
    .array(historyPointSchema)
    .min(2)
    .max(400)
    .optional()
    .describe("DATA-BOUND. Ending with today's price."),
  offers: z
    .array(offerSchema)
    .min(2)
    .max(6)
    .optional()
    .describe("DATA-BOUND. Other sellers."),
  asOf: z.string().describe("DATA-BOUND. When prices were fetched."),
  source: z
    .object({
      label: z.string().max(60),
      url: z.string().optional().describe("http(s) only."),
    })
    .describe("DATA-BOUND."),
  actions: z
    .array(z.enum(priceActions))
    .max(3)
    .optional()
    .describe(
      "'open-offer' adds a View link per offer; the others are footer buttons, first is primary. Omit for read-only.",
    ),
})

export type PriceItem = z.infer<typeof priceItemSchema>
export type PriceInfo = z.infer<typeof priceSchema>
export type BreakdownRow = z.infer<typeof breakdownRowSchema>
export type HistoryPoint = z.infer<typeof historyPointSchema>
export type PriceOffer = z.infer<typeof offerSchema>
export type PriceDetailsInput = z.input<typeof priceDetailsSchema>

/** What the component sends back, once per action (per seller for offers). */
export type PriceDetailsResult =
  /** Notify the user when the price drops below `target` (major units). */
  | { action: "watch-price"; target: number }
  /** Hand off to the host's cart. Nothing was bought in chat. */
  | { action: "add-to-cart" }
  /** The user opened this seller's offer. */
  | { action: "open-offer"; seller: string }

/** Usage guidance the agent reads before choosing this component. */
export const priceDetailsGuidance = {
  useWhen: [
    "The user asks about one item's price: is this a good price, what will it cost delivered, where is it cheapest, has it dropped.",
    "A store, price tracker or checkout quote returned the prices, and optionally the history, a cost breakdown or other sellers' offers.",
  ],
  avoidWhen: [
    "You don't have prices from a tool. Never invent, estimate or recall prices.",
    "The user is choosing between different products. Use a comparison matrix.",
    "The user still has to pick a size or color. Use product options.",
    "The user is reviewing several items before checkout. Use a cart.",
  ],
  rules: [
    "Copy every price, row, point and offer from the tool result unchanged, in one currency. Don't round or fix totals; the component flags totals that don't add up.",
    "Only set deal when the history or offers support it, and ground the reason in them ('Lowest price in 90 days').",
    "End history with today's price; send daily or weekly points.",
    "Keep memberPrice labels generic ('Members'), never a program's brand name.",
    "On 'watch-price', set up the alert for the target; on 'add-to-cart', use the host's cart. Never buy in chat.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(priceDetailsSchema)`.
 */
export const priceDetailsTool = {
  name: "show_price_details",
  description: [
    "Show everything about one item's price before buying: the current price and saving, a deal verdict, price history, the delivered cost breakdown and other sellers' offers, with actions to watch the price or add it to the cart.",
    `Use when: ${priceDetailsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${priceDetailsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${priceDetailsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: priceDetailsSchema,
} as const
