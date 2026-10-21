import { z } from "zod";

/**
 * Cart: the agent's contract.
 *
 * The user reviews the cart (quantities, shipping, totals) before checkout.
 * Fields marked DATA-BOUND must come from a tool result (the store's cart),
 * never from model free text. Checkout is a handoff: the host opens its own
 * checkout. This component never collects payment details.
 */

export const cartItemSchema = z.object({
  id: z.string().describe("Cart line or SKU id. Returned in the result."),
  name: z.string().describe("e.g. 'Stride Lite 2'."),
  variant: z
    .string()
    .max(48)
    .optional()
    .describe("The chosen options, e.g. 'Size 42 · Black'."),
  image: z
    .object({
      url: z
        .string()
        .describe(
          'http(s), or a same-origin path starting with a single "/". Other schemes are ignored.',
        ),
      alt: z.string().describe("What the image shows."),
    })
    .optional()
    .describe("Omit when the store has no image; the row is then text only."),
  unitPrice: z.number().min(0).describe("Price of one unit, in currency."),
  quantity: z.number().int().min(1),
  maxQuantity: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Stock or per-order limit. Caps the stepper. Default 10."),
});

export const shippingOptionSchema = z.object({
  id: z.string().describe("Returned as shippingId."),
  label: z.string().max(32).describe("e.g. 'Standard' or 'Express'."),
  price: z.number().min(0).describe("0 shows as Free."),
  eta: z
    .string()
    .max(40)
    .optional()
    .describe("When it arrives, e.g. 'Arrives Tue 12 Nov'."),
});

export const cartSchema = z.object({
  title: z.string().optional().describe("Default 'Your cart'."),
  currency: z
    .string()
    .length(3)
    .describe("ISO 4217 code for every amount, e.g. 'USD'."),
  items: z
    .array(cartItemSchema)
    .min(1)
    .max(20)
    .describe("DATA-BOUND. The cart lines exactly as the store returned them."),
  shipping: z
    .object({
      options: z.array(shippingOptionSchema).min(1).max(4),
      selected: z
        .string()
        .optional()
        .describe("Id of the preselected option. Default the first."),
    })
    .optional()
    .describe("DATA-BOUND. Shipping options and prices from the store."),
  promo: z
    .object({
      code: z.string().max(24).describe("e.g. 'SPRING10'."),
      amount: z
        .number()
        .min(0)
        .describe("Discount in currency, e.g. 5 for 5.00 off."),
    })
    .optional()
    .describe(
      "DATA-BOUND. A discount the store has already applied. Never invent one.",
    ),
  taxNote: z
    .string()
    .max(80)
    .optional()
    .describe("e.g. 'Taxes calculated at checkout'."),
  checkoutLabel: z
    .string()
    .max(28)
    .optional()
    .describe("Button text. Default 'Continue to checkout'."),
});

export type CartItem = z.infer<typeof cartItemSchema>;
export type ShippingOption = z.infer<typeof shippingOptionSchema>;
export type CartInput = z.input<typeof cartSchema>;

/** What the component sends back. A closed set of actions. */
export type CartResult =
  | {
      /** Open the host's own checkout with these lines. */
      action: "checkout";
      /** Remaining lines and their final quantities. Removed lines are left out. */
      items: { id: string; quantity: number }[];
      shippingId?: string;
      /** The total the user saw. Recompute it at checkout; don't charge it. */
      total: number;
    }
  | { action: "keep_shopping" };

/** Usage guidance the agent reads before choosing this component. */
export const cartGuidance = {
  useWhen: [
    "The user is ready to check out, or asks to see or change their cart.",
    "They should confirm quantities and pick shipping before the store's checkout.",
  ],
  avoidWhen: [
    "The user is still choosing a product or its options. Use product options or entity cards.",
    "The user asks about one item's price or whether it is a good deal. Use price details.",
    'A sentence answers it ("how much is my cart?", "what\'s in it?") and nothing needs changing.',
    "You don't have the cart from the store. Never invent items, prices, shipping or discounts.",
    "The order is already placed. Show a receipt instead.",
  ],
  rules: [
    "Pass items, prices, shipping and promo exactly as the store's cart returned them, in one currency.",
    "Only set promo for a discount the store has already applied.",
    "On checkout, update the store's cart to the returned items and shipping, then open the host's checkout. The host recomputes the total.",
    "Never collect payment, card or bank details in chat; payment happens only in the host's checkout.",
    "On keep_shopping, leave the cart as it was and help the user find more.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(cartSchema)`.
 */
export const cartTool = {
  name: "review_cart",
  description: [
    "Show the user's cart to review before checkout: change quantities, remove items, choose shipping, see totals. Checkout hands off to the host's own checkout.",
    `Use when: ${cartGuidance.useWhen.join(" ")}`,
    `Avoid when: ${cartGuidance.avoidWhen.join(" ")}`,
    `Rules: ${cartGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: cartSchema,
} as const;
