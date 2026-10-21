import { z } from "zod"

/**
 * Color Picker: the agent's contract.
 *
 * The user picks one or more colors from a palette the host provides: paint
 * colors, brand colors, fabric or product finishes, chart colors. Fields marked
 * DATA-BOUND must come from a tool result, never from model free text.
 */

const hexColor = z
  .string()
  .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "A hex color like #3a6ea5")

export const paletteColorSchema = z.object({
  id: z
    .string()
    .describe(
      "DATA-BOUND. The color's id in the source. Returned in the result.",
    ),
  name: z
    .string()
    .describe("DATA-BOUND. The color's name, e.g. 'Harbor Blue'."),
  hex: hexColor.describe("DATA-BOUND. The sRGB value, e.g. '#3a6ea5'."),
  code: z
    .string()
    .max(24)
    .optional()
    .describe(
      "DATA-BOUND. The vendor's own code for this color, exactly as the source gives it. Never make one up.",
    ),
  group: z
    .string()
    .optional()
    .describe("Heading that groups colors, e.g. 'Warm neutrals'."),
})

export const colorPickerSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("What to pick, e.g. 'Wall color for the living room'."),
  palette: z
    .array(paletteColorSchema)
    .min(1)
    .max(200)
    .describe(
      "DATA-BOUND. The colors from your tool result, grouped and in a useful order. Never invent colors or codes.",
    ),
  selection: z
    .enum(["single", "multiple"])
    .default("single")
    .describe("Let the user pick one color or several."),
  max: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Most colors allowed when selection is 'multiple'."),
  allowCustom: z
    .boolean()
    .default(false)
    .describe(
      "Also let the user mix their own color with sliders or a hex value. It's returned without an id.",
    ),
  preview: z
    .enum(["swatch", "text", "ui"])
    .default("swatch")
    .describe(
      "How to simulate the color: 'swatch' side by side with compareAgainst, 'text' for readability, 'ui' tinted onto a button, badge, link and chart bar.",
    ),
  compareAgainst: hexColor
    .optional()
    .describe(
      "DATA-BOUND when it describes something real. The color to compare with, e.g. the current wall or brand color.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe("Verb for the confirm button, e.g. 'Use this color'."),
})

export type PaletteColor = z.infer<typeof paletteColorSchema>
export type ColorPickerInput = z.input<typeof colorPickerSchema>

/** A chosen color. Custom colors have no id, name or code. */
export type PickedColor = {
  id?: string
  name?: string
  /** Lowercase "#rrggbb". */
  hex: string
  code?: string
}

/** What the component sends back to the agent. A closed set of actions. */
export type ColorPickerResult =
  | {
      action: "select"
      /** The chosen colors, in the order the user picked them. */
      colors: PickedColor[]
    }
  /** The user closed the picker. Ask in text what they want instead. */
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const colorPickerGuidance = {
  useWhen: [
    "The user must choose a color from a real set: paint colors, brand colors, fabric or product finishes, chart or theme colors.",
    "Seeing the colors, their contrast or how they look in use helps the decision.",
  ],
  avoidWhen: [
    "You have no palette from a tool result. Fetch it first; never list colors or codes from memory.",
    "The choice isn't visual, e.g. a product variant named by color. Use product options.",
    "There is one obvious color. Say which and why.",
  ],
  rules: [
    "Every color, hex and code must come from the source, exactly as given.",
    "Use group to split long palettes into families, e.g. 'Warm neutrals', 'Greens'.",
    "Set compareAgainst when the user mentions what they have now, and preview 'swatch' to show both.",
    "Use preview 'ui' for interface colors and 'text' when readability matters.",
    "Set allowCustom only when a color outside the palette is acceptable.",
    "Act only on the colors returned with action 'select'. Custom colors have no id; treat them as hex values.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(colorPickerSchema)`.
 */
export const colorPickerTool = {
  name: "pick_color",
  description: [
    "Let the user pick one or more colors from a palette you fetched, with contrast and a preview, and wait for their choice.",
    `Use when: ${colorPickerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${colorPickerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${colorPickerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: colorPickerSchema,
} as const
