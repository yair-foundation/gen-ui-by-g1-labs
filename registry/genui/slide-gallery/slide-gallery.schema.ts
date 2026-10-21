import { z } from "zod"

/**
 * Slide Gallery: the agent's contract.
 *
 * A slideshow in the chat: listing or trip photos, product shots, design
 * options, generated images, or a short deck preview. Optionally the user
 * picks one or more slides and the choice comes back as a result.
 */

export const imageSlideSchema = z.object({
  type: z.literal("image"),
  id: z.string().describe("Stable identifier. Returned in the result."),
  src: z
    .string()
    .describe(
      "DATA-BOUND. The image URL from a tool result: http(s), or a host-provided data:image/(png|jpeg|webp|svg+xml). Never invent URLs.",
    ),
  alt: z
    .string()
    .min(1)
    .describe(
      "What the image shows, for screen readers: 'Living room with two sofas and a bay window'.",
    ),
  caption: z
    .string()
    .optional()
    .describe(
      "One short line under the image. Supports **bold** and [links](https://…).",
    ),
  credit: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. Photographer or source, e.g. 'Photo: Casa Lima listing'.",
    ),
})

export const deckSlideSchema = z.object({
  type: z.literal("deck"),
  id: z.string().describe("Stable identifier. Returned in the result."),
  title: z.string().describe("The slide headline."),
  subtitle: z.string().optional(),
  bullets: z
    .array(z.string())
    .max(6)
    .optional()
    .describe("Up to 6 short points."),
  notes: z
    .string()
    .optional()
    .describe("Speaker notes: what the presenter says. Shown collapsed."),
  stat: z
    .object({
      value: z.string().describe("The number, e.g. '3.2×' or '$4M'."),
      label: z.string().describe("What it measures, e.g. 'faster onboarding'."),
    })
    .optional()
    .describe("One big number for the slide."),
})

export const slideSchema = z.discriminatedUnion("type", [
  imageSlideSchema,
  deckSlideSchema,
])

export const slideGallerySchema = z.object({
  title: z
    .string()
    .optional()
    .describe("e.g. 'Apartment on Rua das Flores' or 'Acme pitch deck'."),
  aspect: z
    .enum(["16:9", "4:3", "1:1", "3:4"])
    .optional()
    .describe(
      "Stage shape. Defaults to 16:9 for decks and 4:3 for images. Images are letterboxed, never cropped.",
    ),
  startIndex: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Zero-based slide to open on. Default 0."),
  selection: z
    .enum(["none", "single", "multiple"])
    .default("none")
    .describe(
      "'single' or 'multiple' when the user is choosing, e.g. 'which photo should I post?'. 'none' is display-only.",
    ),
  max: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Most slides the user may pick with selection 'multiple'."),
  autoplay: z
    .boolean()
    .default(false)
    .describe(
      "Advance every 5 seconds, with a pause button. Only when the user asks for a slideshow.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe("Submit button text when selecting, e.g. 'Use this concept'."),
  // Last, so the settings above arrive before the slides stream in.
  slides: z.array(slideSchema).min(1).max(30),
})

export type ImageSlide = z.infer<typeof imageSlideSchema>
export type DeckSlide = z.infer<typeof deckSlideSchema>
export type Slide = z.infer<typeof slideSchema>
export type SlideGalleryInput = z.input<typeof slideGallerySchema>
export type SlideGalleryAspect = NonNullable<SlideGalleryInput["aspect"]>
export type SlideGallerySelection = NonNullable<SlideGalleryInput["selection"]>

/** What the component sends back to the agent. A closed set of actions. */
export type SlideGalleryResult =
  /** The slides the user picked, in slide order. */
  | { action: "select"; slideIds: string[] }
  /** The user picked none of them. */
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const slideGalleryGuidance = {
  useWhen: [
    "The user wants to look through a set of images: listing or trip photos, product shots, design options, generated images.",
    "Previewing a short presentation deck slide by slide.",
    "The user is choosing between visual options: 'which of these photos should I post?', 'which logo concept?'.",
  ],
  avoidWhen: [
    "There is a single image. Put it in the reply.",
    "The items are records to compare by name, price or rating. Use an entity card.",
    "You don't have real image URLs. Never invent or guess them.",
    "The content is a long document. Use an article.",
  ],
  rules: [
    "Image src must come from a tool result or the host; never make up URLs.",
    "Give every image real alt text that says what it shows.",
    "Keep captions to one line; add a credit when the source is known.",
    "Use deck slides for deck previews: a headline, up to 6 bullets or one stat, and speaker notes.",
    "Set selection only when the user is choosing; add a specific submitLabel and max when it matters.",
    "Never set autoplay unless the user asks for a slideshow.",
    "On 'select', act on the returned slideIds only. On 'dismiss', ask what they want instead.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(slideGallerySchema)`.
 */
export const slideGalleryTool = {
  name: "show_gallery",
  description: [
    "Show a slideshow of images or deck slides, optionally letting the user pick one or more.",
    `Use when: ${slideGalleryGuidance.useWhen.join(" ")}`,
    `Avoid when: ${slideGalleryGuidance.avoidWhen.join(" ")}`,
    `Rules: ${slideGalleryGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: slideGallerySchema,
} as const
