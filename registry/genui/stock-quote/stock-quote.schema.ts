import { z } from "zod"

/**
 * Stock Quote: the agent's contract.
 *
 * A market snapshot for one instrument (stock, ETF, index or crypto): price,
 * change, a candlestick or line chart per range, key stats and the source.
 * Every market figure comes from a tool result.
 */

export const stockRangeKeySchema = z.enum([
  "1D",
  "5D",
  "1M",
  "6M",
  "YTD",
  "1Y",
  "5Y",
])

export const stockCandleSchema = z.object({
  t: z
    .string()
    .describe(
      "ISO date ('2026-09-14') or date-time with offset ('2026-10-07T14:30:00-04:00').",
    ),
  o: z
    .number()
    .optional()
    .describe("Open. Omit o/h/l when the source has one price per point."),
  h: z.number().optional().describe("High."),
  l: z.number().optional().describe("Low."),
  c: z.number().describe("Close, or the price at t."),
  v: z.number().nonnegative().optional().describe("Volume."),
})

export const stockRangeSchema = z.object({
  key: stockRangeKeySchema,
  candles: z
    .array(stockCandleSchema)
    .min(1)
    .max(400)
    .describe("DATA-BOUND. Points in time order, copied from the tool result."),
})

/** The icons a stat may carry. Names map to Lucide icons in the component. */
export const stockStatIcons = [
  "trending-up",
  "trending-down",
  "chevrons-up-down",
  "bar-chart",
  "percent",
  "dollar-sign",
  "wallet",
  "coins",
  "banknote",
  "building",
  "calendar",
  "clock",
  "scale",
  "gauge",
  "hash",
  "activity",
] as const
export type StockStatIcon = (typeof stockStatIcons)[number]

export const stockStatSchema = z.object({
  label: z.string().max(24).describe("e.g. 'Open', '52-wk range', 'P/E'."),
  value: z
    .string()
    .max(40)
    .describe("Formatted as the source gives it, e.g. '$96.40 – $142.80'."),
  icon: z
    .enum(stockStatIcons)
    .optional()
    .describe(
      "Optional icon that makes the stat scannable: chevrons-up-down for ranges, bar-chart for volume, percent for yields, dollar-sign for prices. Use it on every stat or on none.",
    ),
})

export const stockSourceSchema = z.object({
  label: z.string().describe("Data provider, e.g. 'Example Market Data'."),
  url: z.string().optional().describe("http(s) link to the quote page."),
})

export const stockQuoteSchema = z.object({
  symbol: z.string().max(16).describe("DATA-BOUND. Ticker, e.g. 'FIG'."),
  name: z.string().describe("DATA-BOUND. Instrument name."),
  exchange: z.string().optional().describe("DATA-BOUND. e.g. 'NASDAQ'."),
  logo: z
    .object({
      url: z
        .string()
        .describe(
          "DATA-BOUND. The company's logo mark: http(s), or a same-origin path starting with a single slash.",
        ),
      darkUrl: z
        .string()
        .optional()
        .describe(
          "DATA-BOUND. A version of the mark for dark backgrounds, when the source has one.",
        ),
      alt: z.string().optional().describe("e.g. 'Figma'."),
    })
    .optional()
    .describe(
      "The company's logo, shown in a grey tile beside the name. Only when the data provides one; never invent a URL.",
    ),
  currency: z
    .string()
    .length(3)
    .default("USD")
    .describe("ISO 4217 code of the prices."),
  timezone: z
    .string()
    .optional()
    .describe(
      "IANA time zone of the exchange, e.g. 'America/New_York'. Times are shown in it.",
    ),
  price: z.number().describe("DATA-BOUND. Last price."),
  change: z
    .number()
    .describe("DATA-BOUND. Change since previous close, in currency."),
  changePercent: z
    .number()
    .describe("DATA-BOUND. Change in percent points: -1.8 means -1.8%."),
  asOf: z.string().describe("DATA-BOUND. ISO date-time of the price."),
  delayed: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. True when the source delays quotes."),
  marketState: z
    .enum(["open", "closed", "pre", "post"])
    .optional()
    .describe("DATA-BOUND. Trading session at asOf."),
  defaultRange: stockRangeKeySchema
    .optional()
    .describe("Range shown first. Must be one of ranges."),
  previousClose: z
    .number()
    .optional()
    .describe("DATA-BOUND. Drawn as a dashed reference line."),
  ranges: z
    .array(stockRangeSchema)
    .min(1)
    .max(7)
    .describe("DATA-BOUND. One entry per range the tool returned."),
  stats: z
    .array(stockStatSchema)
    .max(8)
    .optional()
    .describe("DATA-BOUND. Key stats, e.g. Open, Day range, Volume, P/E."),
  source: stockSourceSchema.describe("DATA-BOUND. Where the data came from."),
})

export type StockRangeKey = z.infer<typeof stockRangeKeySchema>
export type StockCandle = z.infer<typeof stockCandleSchema>
export type StockRange = z.infer<typeof stockRangeSchema>
export type StockStat = z.infer<typeof stockStatSchema>
export type StockSource = z.infer<typeof stockSourceSchema>
export type StockQuoteInput = z.input<typeof stockQuoteSchema>

/** Usage guidance the agent reads before choosing this component. */
export const stockQuoteGuidance = {
  useWhen: [
    "The user asks how a stock, ETF, index or crypto is doing, and a market data tool returned its quote and price history.",
  ],
  avoidWhen: [
    "You have no quote from a tool. Never invent, estimate or recall prices.",
    "The user is comparing several instruments. Use a chart or data table.",
    "The user asks whether to buy or sell. Don't give investment advice.",
  ],
  rules: [
    "Copy every price, candle and stat from the tool result unchanged.",
    "Only include the ranges the tool returned; set defaultRange to the one the question is about.",
    "Set delayed and marketState from the source; set timezone to the exchange's.",
    "Leave o/h/l out when the source only has one price per point; the chart draws a line.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(stockQuoteSchema)`.
 */
export const stockQuoteTool = {
  name: "show_stock",
  description: [
    "Show a market snapshot for one instrument: price, change, a price chart per range, key stats and source.",
    `Use when: ${stockQuoteGuidance.useWhen.join(" ")}`,
    `Avoid when: ${stockQuoteGuidance.avoidWhen.join(" ")}`,
    `Rules: ${stockQuoteGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: stockQuoteSchema,
} as const
