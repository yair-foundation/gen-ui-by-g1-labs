import { z } from "zod";

/**
 * Invoice: the agent's contract.
 *
 * One financial document the agent found in the user's email, accounting tool
 * or bank: an invoice, a bill or a receipt. Every amount, date and party is
 * DATA-BOUND: it must come from a tool result, never from model free text.
 * "Pay" is a handoff to the host's own payment flow; this component never
 * collects payment details.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/, "ISO 8601 date, e.g. '2026-10-13'");

export const invoiceKinds = ["invoice", "bill", "receipt"] as const;

export const invoiceStates = [
  "draft",
  "open",
  "due-soon",
  "overdue",
  "paid",
  "partially-paid",
  "void",
  "refunded",
] as const;

export const invoiceActions = [
  "pay",
  "download",
  "forward",
  "dispute",
  "add-to-expenses",
  "remind",
] as const;

export const invoicePartySchema = z.object({
  name: z.string().describe("e.g. 'Harbor Power & Light'."),
  address: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Postal address, lines separated by '\\n'. In the details section.",
    ),
  taxId: z
    .string()
    .max(40)
    .optional()
    .describe(
      "VAT number, EIN or company number, as printed. In the details section.",
    ),
  email: z.string().max(254).optional().describe("In the details section."),
});

export const invoiceLineSchema = z.object({
  description: z.string().describe("e.g. 'Energy use'."),
  quantity: z.number().optional().describe("e.g. 642 (kWh) or 5 (hours)."),
  unitPrice: z
    .number()
    .optional()
    .describe("Price of one unit, up to 4 decimals."),
  amount: z
    .number()
    .describe("The line total as printed. Negative for credits."),
  note: z
    .string()
    .max(120)
    .optional()
    .describe("One short line, e.g. a meter reading or a date range."),
});

export const invoiceAdjustmentSchema = z.object({
  label: z.string().max(48).describe("e.g. 'Returning client 5%'."),
  amount: z.number().min(0).describe("Positive. Shown as a deduction."),
});

export const invoiceTaxSchema = z.object({
  label: z.string().max(48).describe("e.g. 'VAT 17%'."),
  amount: z.number(),
  included: z
    .boolean()
    .optional()
    .describe(
      "True when the line amounts already include this tax (VAT-inclusive prices). It is shown but not added.",
    ),
});

export const invoicePaymentSchema = z.object({
  method: z.enum(["card", "bank", "cash", "wallet", "other"]),
  last4: z
    .string()
    .regex(/^\d{4}$/, "Exactly 4 digits")
    .optional()
    .describe(
      "Last 4 digits of the card or account, digits only. Never pass a full number.",
    ),
  reference: z
    .string()
    .max(64)
    .optional()
    .describe(
      "Transaction or authorization reference. In the details section.",
    ),
});

export const invoiceSchema = z.object({
  kind: z
    .enum(invoiceKinds)
    .describe(
      "'invoice': sent or received for work or goods. 'bill': something the user owes (utility, subscription, rent). 'receipt': proof of a purchase.",
    ),
  number: z
    .string()
    .max(40)
    .optional()
    .describe("DATA-BOUND. The document number, e.g. '1042'."),
  direction: z
    .enum(["sent", "received"])
    .optional()
    .describe(
      "Invoices only. 'sent' when the user issued it and is owed the money; 'received' when a vendor sent it to the user.",
    ),
  issuer: invoicePartySchema.describe(
    "DATA-BOUND. Who issued the document: the vendor, utility or store.",
  ),
  recipient: invoicePartySchema
    .pick({ name: true, address: true, taxId: true })
    .optional()
    .describe("DATA-BOUND. Who it is billed to."),
  issuedAt: isoDate.describe(
    "DATA-BOUND. Issue or purchase date, ISO 8601, e.g. '2026-10-01'. Bills and invoices: in the details section.",
  ),
  dueAt: isoDate
    .optional()
    .describe("DATA-BOUND. Bills and invoices: the due date, ISO 8601."),
  paidAt: isoDate
    .optional()
    .describe("DATA-BOUND. When it was paid in full, ISO 8601."),
  state: z
    .enum(invoiceStates)
    .describe(
      "DATA-BOUND. The state reported by the source system. Never infer 'paid'.",
    ),
  currency: z
    .string()
    .length(3)
    .describe("ISO 4217 code for every amount, e.g. 'USD'."),
  lines: z
    .array(invoiceLineSchema)
    .min(1)
    .max(100)
    .describe("DATA-BOUND. Line items exactly as printed on the document."),
  subtotal: z.number().optional().describe("DATA-BOUND. As printed."),
  discounts: z
    .array(invoiceAdjustmentSchema)
    .max(5)
    .optional()
    .describe("DATA-BOUND. Discounts and credits as printed."),
  tax: z
    .array(invoiceTaxSchema)
    .max(5)
    .optional()
    .describe("DATA-BOUND. Tax lines as printed."),
  shipping: z.number().min(0).optional().describe("DATA-BOUND."),
  total: z.number().describe("DATA-BOUND. The document total as printed."),
  amountPaid: z
    .number()
    .min(0)
    .optional()
    .describe("DATA-BOUND. Paid so far, for partly paid documents."),
  amountDue: z
    .number()
    .min(0)
    .optional()
    .describe("DATA-BOUND. Still owed. Defaults to total minus amountPaid."),
  payment: invoicePaymentSchema
    .optional()
    .describe("DATA-BOUND. How it was paid."),
  returnBy: isoDate
    .optional()
    .describe("DATA-BOUND. Receipts: last day to return, ISO 8601."),
  period: z
    .object({ start: isoDate, end: isoDate })
    .optional()
    .describe("DATA-BOUND. Bills: the service period, ISO 8601 dates."),
  source: z
    .object({
      label: z
        .string()
        .max(60)
        .describe("Where it was found, e.g. 'Email from Harbor Power'."),
      url: z
        .string()
        .optional()
        .describe("Link to the original. http(s) only; others are ignored."),
    })
    .describe("DATA-BOUND. Where the document came from."),
  actions: z
    .array(z.enum(invoiceActions))
    .max(6)
    .optional()
    .describe(
      "Buttons, the first is primary. Default: bill → pay, download; invoice → download (remind first when it's overdue and direction is 'sent'; pay first when 'received' and owed); receipt → download, add-to-expenses. Pay and remind are hidden when nothing is owed.",
    ),
});

export type InvoiceParty = z.infer<typeof invoicePartySchema>;
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;
export type InvoiceAdjustment = z.infer<typeof invoiceAdjustmentSchema>;
export type InvoiceTax = z.infer<typeof invoiceTaxSchema>;
export type InvoicePayment = z.infer<typeof invoicePaymentSchema>;
export type InvoiceInput = z.input<typeof invoiceSchema>;

/** What the component sends back, once per action. A closed set. */
export type InvoiceResult =
  /** Open the host's own payment flow. Nothing was paid in chat. */
  | {
      action: "pay" | "download" | "forward" | "add-to-expenses" | "remind";
    }
  /** The user disputes the document, with their reason. */
  | { action: "dispute"; reason: string };

/** Usage guidance the agent reads before choosing this component. */
export const invoiceGuidance = {
  useWhen: [
    "The user asks about a specific invoice, bill or receipt you found in their email, accounting tool or bank: whether it was paid, what they owe, when it's due, or where the receipt is.",
    "They need the line items, totals, parties or payment details of that one document, or to act on it (pay, download, add to expenses).",
  ],
  avoidWhen: [
    "You don't have the document from a tool result. Never invent amounts, dates or states.",
    "The user wants an overview of many documents. Use a data table.",
    "You just took an action (sent a reminder, paid a bill). Show a result receipt.",
    "The user is still shopping. Use a cart.",
  ],
  rules: [
    "Pass every amount, date, party and state exactly as the source returned them, in one currency. Don't round, recompute or fix totals; the component flags totals that don't add up.",
    "Set direction for invoices so reminders and payments go the right way.",
    "Only pass last4 for payment, never a full card or account number.",
    "On 'pay', open the host's payment flow; never collect payment details in chat and never treat the document as paid until the source says so.",
    "On 'remind' or 'forward', draft the message and confirm recipients before sending. On 'dispute', use the user's reason.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(invoiceSchema)`.
 */
export const invoiceTool = {
  name: "show_invoice",
  description: [
    "Show one invoice, bill or receipt: who issued it, its state, due or paid date, line items, taxes and totals, with actions like pay (a handoff to the host's payment flow), download or add to expenses.",
    `Use when: ${invoiceGuidance.useWhen.join(" ")}`,
    `Avoid when: ${invoiceGuidance.avoidWhen.join(" ")}`,
    `Rules: ${invoiceGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: invoiceSchema,
} as const;
