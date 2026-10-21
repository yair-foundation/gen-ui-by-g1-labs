import { z } from "zod";

/**
 * Gift card: the agent's contract.
 *
 * Two modes. "balance": a gift card or store credit the user holds, with
 * what's left, its expiry and a scannable code to show at the register. "send": pick an amount, a design and a recipient for a new
 * gift card, then hand off to the host's payment flow. Card data is
 * DATA-BOUND (from the issuer). Full card numbers and PINs never pass through
 * the conversation; the component never collects payment details.
 */

const isoDate = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}.*)?$/,
    "ISO 8601 date, e.g. '2027-12-31'",
  );

const currency = z
  .string()
  .regex(/^[A-Z]{3}$/, "ISO 4217 code")
  .describe("e.g. 'USD'.");

export const giftCardPatterns = ["stripes", "dots", "grid", "plain"] as const;

export const giftCardBrandSchema = z.object({
  name: z.string().max(40).describe("The store, e.g. 'Paper Lantern Books'."),
  initials: z
    .string()
    .max(3)
    .optional()
    .describe("Shown on the card, e.g. 'PL'. Derived from the name if absent."),
});

export const giftCardCardSchema = z.object({
  kind: z
    .enum(["gift-card", "store-credit"])
    .optional()
    .describe("Default 'gift-card'."),
  last4: z
    .string()
    .regex(/^\d{4}$/, "Exactly 4 digits")
    .describe(
      "The last 4 digits only, shown as '•••• 4821'. Never the full number.",
    ),
  balance: z.number().min(0).describe("What's left, in major units."),
  currency,
  expiresAt: isoDate.optional().describe("e.g. '2027-12-31'."),
  pin: z
    .object({ masked: z.literal(true) })
    .optional()
    .describe(
      "The card has a PIN. Never pass the PIN itself; the card says 'PIN on the back of the card'.",
    ),
  code: z
    .object({
      format: z.literal("qr"),
      value: z
        .string()
        .min(1)
        .max(512)
        .describe("The scannable payload exactly as the issuer gave it."),
    })
    .optional()
    .describe(
      "A code the register scans. Only from the issuer; never made up.",
    ),
});

export const giftCardDesignSchema = z.object({
  id: z.string().max(40).describe("Returned as designId."),
  label: z.string().max(30).describe("A neutral pattern name, e.g. 'Stripes'."),
  pattern: z
    .enum(giftCardPatterns)
    .optional()
    .describe(
      "Drawn with lines in the border color. Cycles stripes, dots, grid when absent. The fallback when there is no image.",
    ),
  image: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. The card's artwork: http(s), or a same-origin path starting with a single slash. Fills the card preview and the design thumbnail. Only when the store provides one.",
    ),
});

export const giftCardSendSchema = z.object({
  amounts: z
    .array(z.number().positive())
    .min(1)
    .max(6)
    .describe("Preset amounts in major units, e.g. [25, 50, 100]."),
  custom: z
    .object({ min: z.number().positive(), max: z.number().positive() })
    .refine((r) => r.min <= r.max, "min must not exceed max")
    .optional()
    .describe("Allows a typed amount within this range."),
  currency,
  designs: z
    .array(giftCardDesignSchema)
    .max(6)
    .optional()
    .describe("Card designs to pick from: a pattern each, or the store's artwork."),
  designId: z
    .string()
    .optional()
    .describe("Preselected design. Default: the first."),
  amount: z
    .number()
    .positive()
    .optional()
    .describe(
      "The amount the user asked for. Selects the matching preset, or fills the custom amount.",
    ),
  deliverAt: z
    .union([z.literal("now"), isoDate])
    .optional()
    .describe("'now' (default) or the delivery date, e.g. '2026-10-23'."),
  recipient: z
    .object({
      name: z.string().max(60).optional(),
      email: z.string().max(254).optional(),
    })
    .optional()
    .describe("Prefilled from the user's request or contacts; editable."),
  message: z
    .string()
    .max(1000)
    .optional()
    .describe("A draft message, editable. Only what the user asked for."),
  messageMax: z
    .number()
    .int()
    .min(20)
    .max(1000)
    .default(250)
    .describe("Message length limit in characters."),
});

export const giftCardSchema = z
  .object({
    mode: z
      .enum(["balance", "send"])
      .describe(
        "'balance' to check or redeem a card the user holds; 'send' to buy one for someone.",
      ),
    brand: giftCardBrandSchema.describe("DATA-BOUND."),
    card: giftCardCardSchema
      .optional()
      .describe("DATA-BOUND. Required in balance mode."),
    send: giftCardSendSchema
      .optional()
      .describe(
        "Required in send mode. Amounts and designs are DATA-BOUND (from the store).",
      ),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "balance" && !v.card) {
      ctx.addIssue({
        code: "custom",
        path: ["card"],
        message: "card is required in balance mode",
      });
    }
    if (v.mode === "send" && !v.send) {
      ctx.addIssue({
        code: "custom",
        path: ["send"],
        message: "send is required in send mode",
      });
    }
  });

export type GiftCardBrand = z.infer<typeof giftCardBrandSchema>;
export type GiftCardCard = z.infer<typeof giftCardCardSchema>;
export type GiftCardDesign = z.infer<typeof giftCardDesignSchema>;
export type GiftCardSend = z.input<typeof giftCardSendSchema>;
export type GiftCardInput = z.input<typeof giftCardSchema>;

/**
 * What the component sends back. A closed set.
 * - balance mode, once per action: `add-to-wallet` (the host's wallet pass)
 *   or `refresh` (fetch the balance again).
 * - send mode, once: `send` hands the choices to the host's payment flow
 *   (nothing is charged here), or `dismiss`.
 */
export type GiftCardResult =
  | { action: "add-to-wallet" }
  | { action: "refresh" }
  | {
      action: "send";
      /** Major units, e.g. 50. */
      amount: number;
      currency: string;
      designId?: string;
      recipient: { name: string; email: string };
      message: string;
      /** "now" or a calendar date, e.g. "2026-10-23". */
      deliverAt: string;
    }
  | { action: "dismiss" };

/** Usage guidance the agent reads before choosing this component. */
export const giftCardGuidance = {
  useWhen: [
    "The user asks what's left on a gift card or store credit you found in their account or email.",
    "They want to show a card at a register to pay with it.",
    "They want to send someone a gift card from a store: amount, design, recipient and message, then payment.",
  ],
  avoidWhen: [
    "You don't have the card from the issuer. Never invent balances, codes or card digits.",
    "The user wants to pay for something in chat. This only hands off to the host's payment flow.",
    "It's a bank card or account balance. Use show_balances.",
  ],
  rules: [
    "Pass only the last 4 digits of the card. Never pass the full number or the PIN; set pin.masked when the card has one.",
    "Pass code.value exactly as the issuer gave it; never build a code yourself.",
    "In send mode, prefill amount, recipient and message only from what the user said. On 'send', start the host's payment flow with the returned values; nothing is bought until payment succeeds there.",
    "On 'refresh', fetch the balance again and show a new card; on 'add-to-wallet', open the host's wallet pass.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(giftCardSchema)`.
 */
export const giftCardTool = {
  name: "show_gift_card",
  description: [
    "Show a gift card or store credit: the balance, expiry and a code to scan at the register. Or set up a gift card to send (amount, design, recipient, message, delivery date), handed off to the host's payment flow.",
    `Use when: ${giftCardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${giftCardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${giftCardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: giftCardSchema,
} as const;
