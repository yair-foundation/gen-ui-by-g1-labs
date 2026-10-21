import { z } from "zod"

/**
 * Photo Mosaic: the agent's contract.
 *
 * A hero collage that sets the scene for a plan or a topic: a trip, a dish,
 * a place, an event. One large photo and a few smaller ones, with a row of
 * short tags below. Display-only.
 */

export const mosaicImageSchema = z.object({
  src: z
    .string()
    .describe(
      "DATA-BOUND. The image URL from a search or tool result: http(s), a same-origin path starting with a single slash, or a host-provided data:image/(png|jpeg|webp|svg+xml). Never invent URLs.",
    ),
  alt: z
    .string()
    .min(1)
    .describe(
      "What the photo shows, for screen readers: 'Mount Rainier above a lake at sunset'.",
    ),
  caption: z
    .string()
    .optional()
    .describe(
      "One short line, shown only in the enlarged view, e.g. 'Day 3: Mount Rainier'.",
    ),
})

export const photoMosaicSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("e.g. 'Your 10-day Pacific Northwest road trip'."),
  aspect: z
    .enum(["wide", "square"])
    .default("wide")
    .describe("Shape of the whole mosaic. 'wide' is about 16:9."),
  images: z
    .array(mosaicImageSchema)
    .min(1)
    .max(5)
    .describe(
      "1–5 photos, the hero first. 1: one wide photo; 2: side by side; 3: a hero and two stacked; 4: a hero and three; 5: two over three.",
    ),
  tags: z
    .array(z.string().max(24))
    .max(5)
    .optional()
    .describe("Up to 5 short chips, e.g. ['10 days', 'Road trip']."),
})

export type MosaicImage = z.infer<typeof mosaicImageSchema>
export type PhotoMosaicInput = z.input<typeof photoMosaicSchema>
export type PhotoMosaicAspect = NonNullable<PhotoMosaicInput["aspect"]>

/**
 * What the component sends back. Analytics only: opening a photo never ends
 * the interaction, and the agent doesn't need to respond.
 */
export type PhotoMosaicResult =
  /** The user enlarged the photo at this zero-based index. */
  { action: "open"; index: number }

/** Usage guidance the agent reads before choosing this component. */
export const photoMosaicGuidance = {
  useWhen: [
    "Opening a plan or answer that is visual by nature, to set the scene: a trip, a dish, a place, an event, a venue.",
    "You have 1–5 real photos from a search or tool result.",
  ],
  avoidWhen: [
    "You don't have real image URLs. Never invent or guess them.",
    "The user wants to browse or pick from many photos. Use a slide gallery.",
    "Each image is an option with its own title. Use inspiration cards.",
  ],
  rules: [
    "Use it once, at the top of the reply; the details follow in text or other components.",
    "Image src must come from a tool result or the host; never make up URLs.",
    "Put the strongest photo first: it becomes the hero.",
    "Give every image real alt text that says what it shows.",
    "Keep tags to a few words each, at most 5, and only facts from the plan.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(photoMosaicSchema)`.
 */
export const photoMosaicTool = {
  name: "show_photos",
  description: [
    "Show a hero collage of 1–5 photos with a few tags, to set the scene for a trip, a dish, a place or an event.",
    `Use when: ${photoMosaicGuidance.useWhen.join(" ")}`,
    `Avoid when: ${photoMosaicGuidance.avoidWhen.join(" ")}`,
    `Rules: ${photoMosaicGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: photoMosaicSchema,
} as const
