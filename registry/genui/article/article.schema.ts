import { z } from "zod"

/**
 * Article: the agent's contract.
 *
 * A long-form, structured document in the chat: a brief, an explainer, a
 * how-to, a report, or a fetched web article shown in reader view.
 */

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Use an http(s) URL")

/** An image source: an http(s) URL or a same-origin path starting with a single "/". */
const imageUrl = z
  .string()
  .refine(
    (u) => /^\/(?![/\\])/.test(u) || z.url().safeParse(u).success,
    "Use an http(s) URL or a same-origin /path",
  )
  .refine(
    (u) => u.startsWith("/") || /^https?:\/\//i.test(u),
    "Use an http(s) URL or a same-origin /path",
  )

const inlineHint =
  "Inline markup: **bold**, *italic*, `code`, [text](https://…) links and [n] citation markers, where n is the 1-based position in sources."

/** The icons a fact may carry. Names map to Lucide icons in the component. */
export const articleIcons = [
  "calendar",
  "clock",
  "users",
  "user",
  "map-pin",
  "wallet",
  "credit-card",
  "tag",
  "package",
  "file-text",
  "mail",
  "shield",
  "database",
  "server",
  "globe",
  "hash",
  "trending-up",
  "building",
] as const

export type ArticleIcon = (typeof articleIcons)[number]

export const articleBlockSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("heading"),
    level: z
      .union([z.literal(2), z.literal(3)])
      .describe("2 for sections (listed in the contents), 3 for subsections."),
    text: z.string().describe("Plain text, no markup."),
    id: z
      .string()
      .optional()
      .describe("Anchor id. Generated from the text when omitted."),
  }),
  z.object({
    type: z.literal("paragraph"),
    text: z.string().describe(inlineHint),
  }),
  z.object({
    type: z.literal("list"),
    ordered: z.boolean().optional().describe("Number the items."),
    items: z.array(z.string()).min(1).describe(inlineHint),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string(),
    cite: z
      .string()
      .optional()
      .describe("Who said it. DATA-BOUND for a real person's words."),
  }),
  z.object({
    type: z.literal("callout"),
    tone: z.enum(["note", "warning"]).default("note"),
    text: z.string().describe(inlineHint),
  }),
  z.object({
    type: z.literal("image"),
    src: imageUrl.describe(
      "DATA-BOUND. An http(s) image URL (or a same-origin /path).",
    ),
    alt: z.string().describe("What the image shows."),
    caption: z.string().optional(),
  }),
  z.object({
    type: z.literal("code"),
    language: z.string().optional().describe("e.g. 'bash'. Shown as a label."),
    code: z.string(),
  }),
  z.object({
    type: z.literal("table"),
    columns: z.array(z.string()).min(1).max(8),
    rows: z
      .array(z.array(z.string()))
      .max(50)
      .describe("One string per column, in column order."),
  }),
  z.object({ type: z.literal("divider") }),
  z.object({
    type: z.literal("keyFacts"),
    items: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
          icon: z
            .enum(articleIcons)
            .optional()
            .describe(
              "Optional icon that makes the fact scannable: calendar for dates, users for people, wallet for money. Use it on every fact or on none.",
            ),
        }),
      )
      .min(2)
      .max(8)
      .describe("Short label/value pairs, e.g. 'Churn rate' / '4.1%'."),
  }),
])

export const articleSourceSchema = z.object({
  id: z.string().describe("Stable identifier."),
  title: z.string().describe("DATA-BOUND. The page or document title."),
  publisher: z
    .string()
    .optional()
    .describe("Display name. Defaults to the domain."),
  url: httpUrl.describe("DATA-BOUND. The exact URL you retrieved."),
})

export const articleSchema = z.object({
  title: z.string().describe("e.g. 'Q3 churn brief'."),
  subtitle: z.string().optional().describe("One line under the title."),
  byline: z
    .object({
      author: z.string().optional(),
      publication: z.string().optional(),
      url: httpUrl.optional().describe("The original article's URL."),
    })
    .optional()
    .describe(
      "DATA-BOUND for fetched articles: exactly as published. Omit for documents you wrote.",
    ),
  publishedAt: z
    .string()
    .optional()
    .describe("ISO date. DATA-BOUND for fetched articles."),
  hero: z
    .object({
      src: imageUrl.describe(
        "DATA-BOUND. An http(s) image URL (or a same-origin /path).",
      ),
      alt: z.string(),
      caption: z.string().optional(),
    })
    .optional()
    .describe("Optional lead image."),
  blocks: z.array(articleBlockSchema).min(1).max(150),
  sources: z
    .array(articleSourceSchema)
    .max(30)
    .optional()
    .describe("Retrieved sources the [n] markers point to."),
  toc: z
    .boolean()
    .optional()
    .describe("Show a contents list. Defaults to on with 3 or more sections."),
})

export type ArticleBlock = z.infer<typeof articleBlockSchema>
/** A block as the agent sends it (defaults not yet applied). */
export type ArticleBlockInput = z.input<typeof articleBlockSchema>
export type ArticleSource = z.infer<typeof articleSourceSchema>
export type ArticleInput = z.input<typeof articleSchema>

/** Fired when the user uses a footer action. For analytics; nothing locks. */
export type ArticleResult = {
  action: "copy" | "download" | "open-original"
}

/** Usage guidance the agent reads before choosing this component. */
export const articleGuidance = {
  useWhen: [
    "The user asked for a document to read or keep: a brief, an explainer, a how-to, a report.",
    "The user asked to read a fetched web article in reader view.",
  ],
  avoidWhen: [
    "A few paragraphs answer the question. Reply in text.",
    "The user needs the overview at a glance. Use a summary card.",
    "The answer is a short sourced reply. Use answer_with_sources.",
  ],
  rules: [
    "Structure it with level-2 headings for sections and level-3 for subsections; don't repeat the title as a heading.",
    "Write the full content; nothing is collapsed.",
    "Only cite sources you retrieved, with [n] right after the claim.",
    "For a fetched article, keep the byline, date and text exactly as published, and leave out images you can't link directly.",
    "Use callouts sparingly, for a real note or warning.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(articleSchema)`.
 */
export const articleTool = {
  name: "show_article",
  description: [
    "Show a long-form document with sections, contents, citations and a Markdown copy.",
    `Use when: ${articleGuidance.useWhen.join(" ")}`,
    `Avoid when: ${articleGuidance.avoidWhen.join(" ")}`,
    `Rules: ${articleGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: articleSchema,
} as const
