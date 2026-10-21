import { z } from "zod";

/**
 * Inspiration Cards: the agent's contract.
 *
 * Visual ideas in a grid: tall image cards with a short title and one line
 * each. Outfits, interior styles, recipes, gift ideas, hairstyles. Optionally
 * the user picks the ones they like and the choice comes back as a result.
 */

export const inspirationItemSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  image: z.object({
    src: z
      .string()
      .describe(
        "DATA-BOUND. The image URL from a search or tool result: http(s), or a host-provided data:image/(png|jpeg|webp|svg+xml). Never invent URLs.",
      ),
    alt: z
      .string()
      .min(1)
      .describe(
        "What the image shows, for screen readers: 'Woman in linen trousers and sandals on a cobbled street'.",
      ),
  }),
  title: z
    .string()
    .describe("The idea in a few words, e.g. 'Sightseeing chic'."),
  line: z
    .string()
    .max(90)
    .optional()
    .describe(
      "One line, up to 90 characters: 'Linen trousers, a simple top, comfortable sandals.'",
    ),
  url: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. http(s) page for the idea (a product, a recipe). Opens in a new tab. Ignored when selectable.",
    ),
});

export const inspirationCardsSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("e.g. 'Your Italy outfit inspiration'."),
  columns: z
    .union([z.literal(2), z.literal(3)])
    .default(2)
    .describe("2 (default) or 3. Phones always show 2."),
  selectable: z
    .enum(["none", "single", "multiple"])
    .default("none")
    .describe(
      "'single' or 'multiple' when the user is choosing which ideas to use. 'none' is display-only.",
    ),
  max: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Most cards the user may pick with selectable 'multiple'."),
  submitLabel: z
    .string()
    .optional()
    .describe(
      "Submit button text when selecting. Default 'Use these' ('Use this' for single).",
    ),
  // Last, so the settings above arrive before the cards stream in.
  items: z.array(inspirationItemSchema).min(2).max(8),
});

export type InspirationItem = z.infer<typeof inspirationItemSchema>;
export type InspirationCardsInput = z.input<typeof inspirationCardsSchema>;
export type InspirationSelectable = NonNullable<
  InspirationCardsInput["selectable"]
>;

/** What the component sends back to the agent. A closed set of actions. */
export type InspirationCardsResult =
  /** The cards the user picked, in card order. */
  | { action: "select"; ids: string[] }
  /** The user opened this card's link. Analytics only; never locks. */
  | { action: "open"; id: string };

/** Usage guidance the agent reads before choosing this component. */
export const inspirationCardsGuidance = {
  useWhen: [
    "The user asks for visual ideas: outfits, interior styles, recipes, gift ideas, hairstyles, party themes.",
    "Each idea has an image, a short name and at most one line of detail.",
    "The user wants to pick the ideas they like before you go further.",
  ],
  avoidWhen: [
    "You don't have real image URLs. Never invent or guess them.",
    "The items are records to compare by price, rating or specs. Use a comparison or entity cards.",
    "One scene-setting collage is enough. Use a photo mosaic.",
    "The topic is fashion, with four or more looks the user may want to browse and save: use show_style_board.",
  ],
  rules: [
    "Image src and url must come from a tool result or the host; never make up URLs.",
    "Keep titles to a few words and the line under 90 characters; no marketing copy.",
    "Use 2–8 cards. Use 3 columns for 6 or more compact ideas, otherwise 2.",
    "Set selectable only when the user is choosing; add a specific submitLabel and max when it matters.",
    "On 'select', act on the returned ids only. 'open' is analytics; don't reply to it.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(inspirationCardsSchema)`.
 */
export const inspirationCardsTool = {
  name: "show_inspiration",
  description: [
    "Show visual ideas as a grid of image cards with a title and one line each, optionally letting the user pick the ones they like.",
    `Use when: ${inspirationCardsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${inspirationCardsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${inspirationCardsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: inspirationCardsSchema,
} as const;
