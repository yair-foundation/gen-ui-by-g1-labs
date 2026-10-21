import { z } from "zod";

/**
 * Style Board: the agent's contract.
 *
 * Fashion looks pinned on a masonry board: images of different shapes in
 * columns, each with a short title and an optional price. The user can filter
 * by category and save the looks they like; the saved ids come back as a
 * result.
 */

export const stylePinSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  image: z.object({
    src: z
      .string()
      .describe(
        "DATA-BOUND. The image URL from a search or tool result: http(s), or a same-origin path starting with a single slash. Never invent URLs.",
      ),
    alt: z
      .string()
      .min(1)
      .describe(
        "What the image shows, for screen readers: 'Woman in a beige trench coat and wide cream trousers on a cobbled street'.",
      ),
    aspect: z
      .number()
      .min(0.5)
      .max(1.6)
      .optional()
      .describe(
        "DATA-BOUND. The image's width divided by its height, e.g. 0.67 for a 2:3 portrait, 1 for a square. From the image's real dimensions; it sets the pin's height before the image loads. Default 0.8.",
      ),
  }),
  title: z
    .string()
    .max(60)
    .describe("The look in a few words, e.g. 'Linen trench, wide trousers'."),
  price: z
    .string()
    .max(20)
    .optional()
    .describe(
      "DATA-BOUND. The price as the store gives it, e.g. '$129'. Only when the pin is a shoppable item.",
    ),
  category: z
    .string()
    .max(20)
    .optional()
    .describe(
      "One word for filtering, e.g. 'Outerwear', 'Dresses'. Filter chips appear when there are two or more.",
    ),
  url: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. http(s) page for the look or product. Opens in a new tab.",
    ),
});

export const styleBoardSchema = z.object({
  title: z.string().optional().describe("e.g. 'Spring wardrobe ideas'."),
  columns: z
    .union([z.literal(2), z.literal(3)])
    .default(3)
    .describe("2 or 3 (default). Narrow screens always show 2."),
  saveable: z
    .boolean()
    .default(true)
    .describe(
      "Let the user save looks with a heart. Set false for a board to look at only.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe("Text of the button that sends the saved looks. Default 'Save to board'."),
  // Last, so the settings above arrive before the pins stream in.
  pins: z.array(stylePinSchema).min(4).max(12),
});

export type StylePin = z.infer<typeof stylePinSchema>;
export type StyleBoardInput = z.input<typeof styleBoardSchema>;

/** What the component sends back to the agent. A closed set of actions. */
export type StyleBoardResult =
  /** The looks the user saved, in board order. */
  | { action: "save"; ids: string[] }
  /** The user opened this pin's link. Analytics only; never locks. */
  | { action: "open"; id: string };

/** Usage guidance the agent reads before choosing this component. */
export const styleBoardGuidance = {
  useWhen: [
    "The user wants to browse fashion looks or outfit ideas as a board, with images of different shapes, and maybe save the ones they like.",
    "You have four to twelve real images of outfits, pieces or accessories, from a search or product tool.",
  ],
  avoidWhen: [
    "You don't have real image URLs. Never invent or guess them.",
    "There are only a few ideas, or the topic isn't clothes. Use inspiration cards.",
    "The items are products to compare by price, size or rating. Use a comparison or entity cards.",
    "One scene-setting collage is enough. Use a photo mosaic.",
  ],
  rules: [
    "Image src and url must come from a tool result or the host; never make up URLs.",
    "Pass each image's real aspect (width divided by height) so the board lays out without jumping.",
    "Keep titles to a few words; add a price only for shoppable items, exactly as the store gives it.",
    "Give a one-word category per pin when there are natural groups (Outerwear, Dresses, Accessories).",
    "Set saveable false when the user only wants to look. On 'save', act on the returned ids only. 'open' is analytics; don't reply to it.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(styleBoardSchema)`.
 */
export const styleBoardTool = {
  name: "show_style_board",
  description: [
    "Show fashion looks as a masonry board of images with a title and optional price each, with category filters and a heart to save looks.",
    `Use when: ${styleBoardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${styleBoardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${styleBoardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: styleBoardSchema,
} as const;
