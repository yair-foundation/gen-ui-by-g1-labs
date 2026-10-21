import { z } from "zod"

/**
 * Quantity Scaler: the agent's contract.
 *
 * A list of quantities written for a number of people (or guests, servings,
 * units) that scales live as the user changes the count. Fields marked
 * DATA-BOUND must come from a tool result or the user's source.
 */

export const quantityScalerItemSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  name: z
    .string()
    .describe("What to buy or bring, e.g. 'Bone-in leg of lamb'."),
  quantity: z
    .number()
    .nonnegative()
    .describe("The amount for `base` people, in `unit`."),
  unit: z
    .string()
    .max(12)
    .optional()
    .describe(
      "'g', 'kg', 'ml', 'l', any other unit such as 'tbsp' or 'rolls', or empty for a count.",
    ),
  scale: z
    .enum(["linear", "fixed", "step"])
    .default("linear")
    .describe(
      "'linear' grows with the count. 'fixed' never changes (e.g. 1 oven tray). 'step' rounds up to whole units (eggs, packs).",
    ),
  round: z
    .number()
    .int()
    .min(0)
    .max(3)
    .optional()
    .describe(
      "Decimal places, overriding the unit's default rounding (g/ml to the nearest 25, kg/l to 0.1, counts up to whole). Also keeps the unit as given.",
    ),
})

export const quantityScalerSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("Heading over the list, e.g. 'Your shopping quantities'."),
  unitLabel: z
    .object({
      singular: z
        .string()
        .max(20)
        .describe("e.g. 'person', 'guest', 'serving'."),
      plural: z
        .string()
        .max(20)
        .describe("e.g. 'people', 'guests', 'servings'."),
    })
    .describe("What the count counts."),
  base: z
    .number()
    .int()
    .positive()
    .describe("The number of people the quantities are written for."),
  value: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "The starting count, e.g. what the user asked for. Defaults to base.",
    ),
  min: z.number().int().min(1).default(1),
  max: z.number().int().min(1).max(1000).default(50),
  items: z
    .array(quantityScalerItemSchema)
    .min(1)
    .max(20)
    .describe(
      "DATA-BOUND. Quantities from the recipe, supplier list or tool result, never invented.",
    ),
  note: z
    .string()
    .max(120)
    .optional()
    .describe(
      "One short line under the list, e.g. 'Lamb at 400 g per person, bone-in.'",
    ),
})

export type QuantityScalerItem = z.infer<typeof quantityScalerItemSchema>
export type QuantityScalerInput = z.input<typeof quantityScalerSchema>
export type QuantityScalerData = z.output<typeof quantityScalerSchema>

/**
 * What the component sends back. A closed set of actions; the scaler never
 * locks, so 'set' arrives (debounced) each time the user settles on a count.
 */
export type QuantityScalerResult =
  | {
      action: "set"
      value: number
      /** The scaled amounts as shown, after rounding and unit switching. */
      items: { id: string; quantity: number; unit: string }[]
    }
  /** The user copied the shopping list. */
  | { action: "copy" }

/** Usage guidance the agent reads before choosing this component. */
export const quantityScalerGuidance = {
  useWhen: [
    "Quantities depend on a headcount the user may change: a recipe, party supplies, catering, packing for a group.",
    "The user asked how much to buy or bring for a number of people.",
  ],
  avoidWhen: [
    "The count is fixed and final. Give the list in text.",
    "The quantities depend on more than one number (budget, duration). Use a calculator.",
    "You don't know the per-person amounts. Find a source first.",
  ],
  rules: [
    "Set base to the count the quantities are written for, and value to what the user asked for.",
    "Use 'fixed' for things that don't grow with the count and 'step' for whole items like eggs or packs.",
    "Give each item its natural unit; grams switch to kilograms (and ml to litres) at 1000 on their own.",
    "Keep the note to one line; skip it unless it changes what to buy.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(quantityScalerSchema)`.
 */
export const quantityScalerTool = {
  name: "scale_quantities",
  description: [
    "Show quantities that scale live with a number of people, guests or servings, with a copyable shopping list.",
    `Use when: ${quantityScalerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${quantityScalerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${quantityScalerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: quantityScalerSchema,
} as const
