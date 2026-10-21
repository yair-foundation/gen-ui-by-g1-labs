import { z } from "zod"

/**
 * Citations: the agent's contract.
 *
 * An answer whose claims link to the sources behind them.
 * Everything about a source is DATA-BOUND: it must come from a page or
 * document you actually retrieved.
 */

export const sourceSchema = z.object({
  title: z.string().describe("DATA-BOUND. The page or document title."),
  url: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "Use an http(s) URL")
    .describe("DATA-BOUND. The exact URL you retrieved."),
  publisher: z
    .string()
    .optional()
    .describe("Display name, e.g. 'Serious Eats'. Defaults to the domain."),
  quote: z
    .string()
    .max(300)
    .optional()
    .describe("DATA-BOUND. The verbatim passage that supports your claim."),
  published: z
    .string()
    .optional()
    .describe("ISO date the source was published or last updated."),
})

export const citationsSchema = z.object({
  text: z
    .string()
    .describe(
      "Your answer. Cite with [n] right after the claim, where n is the 1-based position in sources; several as [1][3] or [1,3]. Separate paragraphs with a blank line; start list items with '- '; **bold** is allowed.",
    ),
  sources: z.array(sourceSchema).min(1).max(20),
  marker: z
    .enum(["domain", "number"])
    .default("domain")
    .describe(
      "'domain' shows the site name in each chip; 'number' is more compact.",
    ),
})

export type Source = z.infer<typeof sourceSchema>
export type CitationsInput = z.input<typeof citationsSchema>
export type CitationsData = z.output<typeof citationsSchema>

/** Usage guidance the agent reads before choosing this component. */
export const citationsGuidance = {
  useWhen: [
    "Your answer relies on facts from web pages or documents you retrieved.",
    "The user asked where something comes from, or the claims are worth checking.",
  ],
  avoidWhen: [
    "You have no retrieved sources. Never cite from memory or invent a source.",
    "The answer is your own reasoning, opinion or a calculation.",
    "Casual conversation where sources add nothing.",
  ],
  rules: [
    "Only cite pages you actually retrieved in this conversation, with their exact URLs.",
    "Place each marker right after the claim it supports, and only cite a source for claims it really supports.",
    "Quotes must be verbatim from the source. If you can't quote it, leave quote out.",
    "Prefer primary and recent sources; drop sources you didn't use.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(citationsSchema)`.
 */
export const citationsTool = {
  name: "answer_with_sources",
  description: [
    "Show an answer with inline citations linking each claim to the retrieved source that supports it.",
    `Use when: ${citationsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${citationsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${citationsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: citationsSchema,
} as const
