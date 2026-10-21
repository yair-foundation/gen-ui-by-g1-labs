import { z } from "zod"

/**
 * Product Options: the agent's contract.
 *
 * The user picks a size, color or other options and a quantity for one
 * product, then adds it to the cart. Fields marked DATA-BOUND must come from a
 * tool result (the catalog), never from model free text. This component never
 * takes payment details.
 */

export const productSchema = z.object({
  id: z
    .string()
    .describe("Product id from the catalog. Returned in the result."),
  name: z.string().describe("e.g. 'Stride Lite 2'."),
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
    .describe("Omit when the catalog has no image; a placeholder is shown."),
  price: z
    .object({
      amount: z
        .number()
        .min(0)
        .describe("Base unit price, before option price deltas."),
      currency: z.string().length(3).describe("ISO 4217 code, e.g. 'USD'."),
    })
    .describe("The current selling price."),
  compareAt: z
    .object({
      amount: z.number().min(0),
    })
    .optional()
    .describe(
      "The original price when the item is on sale. Shown struck through. Only from the catalog.",
    ),
  rating: z
    .object({
      value: z.number().min(0).max(5),
      count: z.number().int().min(0).optional().describe("Number of reviews."),
    })
    .optional(),
})

export const optionValueSchema = z.object({
  value: z
    .string()
    .describe("Stable value, e.g. '42' or 'black'. Returned in the result."),
  label: z.string().max(24).describe("What the user sees, e.g. 'Black'."),
  available: z
    .boolean()
    .optional()
    .describe("false when this value is out of stock in every variant."),
  priceDelta: z
    .number()
    .optional()
    .describe(
      "Added to the unit price when chosen, e.g. 9.5 for a larger bag. Negative for cheaper.",
    ),
  swatch: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional()
    .describe(
      "DATA-BOUND. For a color value, its hex from the catalog, e.g. '#1e2a4a'. Shown as a dot beside the label.",
    ),
})

export const optionGroupSchema = z.object({
  id: z.string().describe("e.g. 'size'. Keys the result's options."),
  label: z.string().max(24).describe("e.g. 'Size'."),
  values: z.array(optionValueSchema).min(1).max(16),
})

export const variantSchema = z.object({
  id: z.string().describe("Variant or SKU id. Returned as variantId."),
  options: z
    .record(z.string(), z.string())
    .describe("Option id → value, e.g. { size: '42', color: 'black' }."),
  available: z.boolean(),
  stock: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Units left. 5 or fewer shows 'Only N left'; it also caps the quantity.",
    ),
})

export const productOptionsSchema = z.object({
  product: productSchema.describe(
    "DATA-BOUND. The product exactly as the catalog returned it.",
  ),
  options: z
    .array(optionGroupSchema)
    .min(1)
    .max(3)
    .describe(
      "DATA-BOUND. 1–3 option groups from the catalog, e.g. size and color.",
    ),
  variants: z
    .array(variantSchema)
    .min(1)
    .optional()
    .describe(
      "DATA-BOUND. Every combination the catalog sells, with stock. When given, a value is only available if an in-stock variant matches it and the user's other choices. Combinations not listed count as out of stock.",
    ),
  quantity: z
    .object({
      min: z.number().int().min(1).optional().describe("Default 1."),
      max: z.number().int().min(1).optional().describe("Default 10."),
      default: z.number().int().min(1).optional().describe("Default min."),
    })
    .optional(),
  submitLabel: z
    .string()
    .max(24)
    .optional()
    .describe("Button text. Default 'Add to cart'."),
})

export type Product = z.infer<typeof productSchema>
export type OptionValue = z.infer<typeof optionValueSchema>
export type OptionGroup = z.infer<typeof optionGroupSchema>
export type ProductVariant = z.infer<typeof variantSchema>
export type ProductOptionsInput = z.input<typeof productOptionsSchema>

/** What the component sends back. A closed set of actions. */
export type ProductOptionsResult =
  | {
      action: "add_to_cart"
      productId: string
      /** The matching variant, when variants were given. */
      variantId?: string
      /** Option id → chosen value, e.g. { size: "42", color: "black" }. */
      options: Record<string, string>
      quantity: number
    }
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const productOptionsGuidance = {
  useWhen: [
    "The user wants a specific product that comes in options (size, color, grind, bag size) and is ready to add it to the cart.",
    "The catalog gave you the options, prices and stock for that product.",
  ],
  avoidWhen: [
    "The user is still comparing several products. Show them as entity cards first.",
    "The product has no options. Add it directly, or use an entity card's add_to_cart action.",
    "You don't have the options or stock from the catalog. Never invent sizes, prices or availability.",
    "The user wants to pay. This component only adds to the cart; checkout happens in the host's own checkout.",
  ],
  rules: [
    "Pass options, prices, priceDelta and variants exactly as the catalog returned them.",
    "Give variants with stock whenever the catalog has them, so out-of-stock combinations are disabled.",
    "Set compareAt only when the catalog reports an original price.",
    "On add_to_cart, add exactly the returned variantId (or options) and quantity through the cart API, then confirm in one line.",
    "On cancel, add nothing.",
    "Never ask for card or payment details in chat.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(productOptionsSchema)`.
 */
export const productOptionsTool = {
  name: "choose_product_options",
  description: [
    "Let the user choose options (size, color…) and a quantity for one product, then add it to the cart.",
    `Use when: ${productOptionsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${productOptionsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${productOptionsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: productOptionsSchema,
} as const
