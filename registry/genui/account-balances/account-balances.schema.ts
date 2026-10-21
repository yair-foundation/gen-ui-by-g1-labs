import { z } from "zod"

/**
 * Account Balances: the agent's contract.
 *
 * The user's money across connected accounts at a glance: a net total, how
 * assets split across accounts, and each account's balance. Read-only: there
 * are no transfer, pay or trade actions.
 */

const currencySchema = z.string().length(3)

export const accountKindSchema = z
  .enum([
    "checking",
    "savings",
    "credit",
    "investment",
    "crypto",
    "cash",
    "loan",
    "other",
  ])
  .describe(
    "'credit' and 'loan' are liabilities: listed separately and subtracted from the total.",
  )

export const balanceAccountSchema = z.object({
  id: z.string().describe("Stable identifier. Returned with 'reconnect'."),
  name: z
    .string()
    .max(60)
    .describe("The account's name, e.g. 'Everyday checking'. DATA-BOUND."),
  kind: accountKindSchema,
  institution: z
    .string()
    .max(60)
    .optional()
    .describe("e.g. 'Harbor Bank'. DATA-BOUND."),
  mask: z
    .string()
    .max(40)
    .optional()
    .describe(
      "An already-masked identifier from the source, e.g. '•••• 4821' or 'GB12…25'. Never a full account number; the component clips anything longer than the first and last 4 characters. DATA-BOUND.",
    ),
  balance: z
    .number()
    .describe(
      "In the account's own currency. For 'credit' and 'loan', the amount owed (either sign is read as owed). DATA-BOUND.",
    ),
  currency: currencySchema
    .optional()
    .describe(
      "ISO 4217 code of the account's own currency, when it differs from the display currency.",
    ),
  balanceInDisplay: z
    .number()
    .optional()
    .describe(
      "The balance converted to the display currency, from the source's own rate. Required when `currency` differs; without it the account is left out of the totals and marked 'Not in total'. DATA-BOUND.",
    ),
  asOf: z
    .string()
    .optional()
    .describe(
      "ISO 8601 time the balance was last refreshed. Older than 24 hours shows 'Updated 3 days ago'. DATA-BOUND.",
    ),
  error: z
    .string()
    .max(60)
    .optional()
    .describe(
      "A connection problem from the source, e.g. 'Reconnect needed'. DATA-BOUND.",
    ),
})

export const balancesActionSchema = z.enum([
  "add-account",
  "view-details",
  "reconnect",
])

export const accountBalancesSchema = z.object({
  title: z.string().max(60).optional().describe("Defaults to 'Total balance'."),
  currency: currencySchema.describe(
    "ISO 4217 code every total is shown in, e.g. 'USD'.",
  ),
  total: z
    .number()
    .optional()
    .describe(
      "The net total as the source reports it. Omit to compute it from the accounts (assets minus liabilities). If it differs from the accounts by more than 0.01, a note says so. DATA-BOUND.",
    ),
  change: z
    .object({
      percent: z
        .number()
        .optional()
        .describe("In percent units: 3.12 means +3.12%. DATA-BOUND."),
      amount: z
        .number()
        .optional()
        .describe("In the display currency. DATA-BOUND."),
      period: z.string().max(32).describe("e.g. 'This month'."),
    })
    .optional()
    .describe("How the total moved over a period, from the source."),
  accounts: z
    .array(balanceAccountSchema)
    .min(1)
    .max(20)
    .describe("Every connected account, as the source returned them."),
  hideAmounts: z
    .boolean()
    .default(false)
    .describe(
      "Start with amounts masked; the user can reveal them. Use when the user asks, or in a shared or public setting.",
    ),
  actions: z
    .array(balancesActionSchema)
    .max(3)
    .optional()
    .describe(
      "Buttons to show. Defaults to ['add-account', 'view-details']. Add 'reconnect' when an account has an error and the host can reconnect it.",
    ),
  locale: z
    .string()
    .optional()
    .describe("BCP 47 locale for numbers, e.g. 'en-US' (default)."),
})

export type AccountKind = z.infer<typeof accountKindSchema>
export type BalanceAccount = z.infer<typeof balanceAccountSchema>
export type BalancesAction = z.infer<typeof balancesActionSchema>
export type AccountBalancesInput = z.input<typeof accountBalancesSchema>

/**
 * Sent when the user presses a button. Handoffs for the host (open the
 * add-account flow, the accounts screen, the reconnect flow); the card stays
 * live and never locks.
 */
export type AccountBalancesResult =
  | { action: "add-account" | "view-details" }
  | { action: "reconnect"; accountId: string }

/** Usage guidance the agent reads before choosing this component. */
export const accountBalancesGuidance = {
  useWhen: [
    "The user asks about their money across connected accounts: their total balance, how much is in each account, or their net worth.",
    "You have the balances from a connected banking, brokerage or wallet tool.",
  ],
  avoidWhen: [
    "You don't have the balances from a tool result. Never invent or estimate them.",
    "The user asks about transactions or spending. Use a data table, chart or KPI card.",
    "The user wants to move money, pay or trade. This card has no such actions; confirm those through the host's own flow.",
    "It's a single account's single number. Say it in a sentence.",
  ],
  rules: [
    "Pass every balance exactly as the source returned it; let the component add them up. Only pass `total` when the source reports one.",
    "Mark credit cards and loans with kind 'credit' or 'loan'; they're subtracted from the total, never drawn in the allocation bar.",
    "For accounts in another currency, pass `currency` and the source's converted `balanceInDisplay`. Never convert with a rate you made up.",
    "Pass `mask` only as the source already masked it; never a full account number, IBAN or wallet address.",
    "Set hideAmounts when the user asks to hide amounts or is sharing their screen.",
    "Add 'reconnect' to actions only when an account has an error and the host can reconnect it.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(accountBalancesSchema)`.
 */
export const accountBalancesTool = {
  name: "show_balances",
  description: [
    "Show the user's balances across connected accounts: a net total with its change, an allocation bar of assets, and each account with liabilities listed separately.",
    `Use when: ${accountBalancesGuidance.useWhen.join(" ")}`,
    `Avoid when: ${accountBalancesGuidance.avoidWhen.join(" ")}`,
    `Rules: ${accountBalancesGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: accountBalancesSchema,
} as const
