import { z } from "zod"

/**
 * Entity Card: the agent's contract.
 *
 * Products, places or people the agent found, as cards the user can compare
 * and act on. Fields marked DATA-BOUND must come from a tool result (a search,
 * a catalog, a CRM), never from model free text.
 */

/** The closed set of things a user can do with a card. The host wires each one. */
export const entityActionIds = [
  "add_to_cart",
  "save",
  "select",
  "book",
  "contact",
] as const

export const entityActionSchema = z.object({
  id: z
    .enum(entityActionIds)
    .describe(
      "What the button does. The host decides what each id means, e.g. add_to_cart calls the cart API.",
    ),
  label: z.string().max(20).describe("Button text, e.g. 'Add to cart'."),
})

export const entitySchema = z.object({
  id: z
    .string()
    .describe("Stable identifier from the source system. Returned in results."),
  name: z.string().describe("e.g. 'Stride Lite 2' or 'Dana Okafor'."),
  subtitle: z
    .string()
    .optional()
    .describe("One short line, e.g. the brand, cuisine or current role."),
  image: z
    .object({
      url: z
        .string()
        .describe(
          "http(s), or a same-origin path starting with a single \"/\". Other schemes are ignored.",
        ),
      alt: z.string().describe("What the image shows."),
    })
    .optional()
    .describe("Omit when the source has no image; a placeholder is shown."),
  price: z
    .object({
      amount: z.number(),
      currency: z.string().length(3).describe("ISO 4217 code, e.g. 'USD'."),
    })
    .optional(),
  rating: z
    .object({
      value: z.number().min(0).max(5),
      count: z.number().int().min(0).optional().describe("Number of reviews."),
    })
    .optional(),
  attributes: z
    .array(z.string().max(32))
    .max(3)
    .optional()
    .describe("Up to 3 short facts, e.g. ['8 yrs', 'Go', 'Remote']."),
  badge: z
    .string()
    .max(20)
    .optional()
    .describe(
      "A real state from the source, e.g. 'In stock' or 'Open now'. Never marketing copy.",
    ),
  badgeTone: z
    .enum(["neutral", "success", "warning", "info", "danger"])
    .optional()
    .describe(
      "What the badge means: success (done, on track), warning (at risk, needs attention), danger (failed, blocked), info (in progress). Default neutral.",
    ),
  url: z
    .string()
    .optional()
    .describe("The item's page, http(s) only. Opens in a new tab."),
})

export const entityCardSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("e.g. 'Running shoes under $150'. Omit when the reply says it."),
  layout: z
    .enum(["carousel", "list"])
    .default("carousel")
    .describe(
      "'carousel' for visual items the user browses (products). 'list' for items compared by text (places, people).",
    ),
  entities: z
    .array(entitySchema)
    .min(1)
    .max(8)
    .describe(
      "DATA-BOUND. The items exactly as the tool returned them, best match first.",
    ),
  actions: z
    .array(entityActionSchema)
    .max(2)
    .optional()
    .describe("Buttons on every card. Omit for a read-only result."),
})

export type EntityActionId = (typeof entityActionIds)[number]
export type EntityAction = z.infer<typeof entityActionSchema>
export type Entity = z.infer<typeof entitySchema>
export type EntityCardInput = z.input<typeof entityCardSchema>

/** Sent once per button press. A closed set of actions. */
export type EntityCardResult = {
  action: EntityActionId
  /** The card the user acted on. */
  entityId: string
}

/** Usage guidance the agent reads before choosing this component. */
export const entityCardGuidance = {
  useWhen: [
    "You found a few products, places or people and the user will compare them or pick one.",
    "The items have a picture, price, rating or a few short facts worth scanning side by side.",
  ],
  avoidWhen: [
    "There is a single result. Describe it in text, or use a summary card.",
    "The user needs to compare many fields across many rows. Use a data table.",
    "You don't have the items from a tool. Never invent products, prices or ratings.",
  ],
  rules: [
    "Show 1–8 items, best match first, exactly as the tool returned them.",
    "Only set price, rating and badge from the source data; omit them when unknown.",
    "Keep attributes to 3 short facts the user will compare, e.g. '8 yrs', 'Remote'.",
    "Only add actions the host supports. Each press sends { action, entityId }; act on it, then confirm in text.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(entityCardSchema)`.
 */
export const entityCardTool = {
  name: "show_entities",
  description: [
    "Show products, places or people you found as cards with image, price, rating and short facts, optionally with an action button on each.",
    `Use when: ${entityCardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${entityCardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${entityCardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: entityCardSchema,
} as const
