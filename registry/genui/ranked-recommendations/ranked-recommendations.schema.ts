import { z } from "zod"

/**
 * Ranked Recommendations: the agent's contract.
 *
 * A shortlist ranked for the user's situation: why each option fits, what it
 * costs them, and which of their constraints it meets or misses. Facts about
 * the options are DATA-BOUND: they come from tool results, not memory.
 */

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Use an http(s) URL")

export const recommendationConstraintSchema = z.object({
  id: z
    .string()
    .describe("Stable identifier, used as a key in each item's meets."),
  label: z
    .string()
    .max(40)
    .describe("The user's requirement in a few words, e.g. 'Under $20/month'."),
  kind: z
    .enum(["must", "nice"])
    .describe("'must': a dealbreaker. 'nice': a bonus."),
})

export const recommendationItemSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  rank: z
    .number()
    .int()
    .min(1)
    .describe("1 is your top pick. Items are shown in rank order."),
  name: z.string().describe("DATA-BOUND. e.g. 'Príncipe Real' or 'Tasklane'."),
  subtitle: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. One line of context, e.g. 'Residential, 10 min to the river'. Screen readers only.",
    ),
  image: z
    .object({
      src: z
        .string()
        .refine(
          (s) =>
            /^https?:\/\//i.test(s) ||
            /^data:image\//i.test(s) ||
            /^\/(?![/\\])/.test(s),
          "Use an http(s) URL, a same-origin /path or a data:image URL",
        )
        .describe("DATA-BOUND."),
      alt: z.string().describe("What the image shows."),
    })
    .optional(),
  score: z
    .object({
      value: z.number().min(0),
      outOf: z.number().positive().default(10),
    })
    .optional()
    .describe(
      "Your fit score for this user. Omit unless you scored every item the same way.",
    ),
  why: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe(
      "1–3 reasons it fits this user, as plain sentences. Cite retrieved sources with [n] (1-based position in sources).",
    ),
  tradeoffs: z
    .array(z.string())
    .max(2)
    .optional()
    .describe("Up to 2 honest downsides for this user."),
  meets: z
    .record(
      z.string(),
      z.preprocess(
        // Models often write the booleans as strings; accept them.
        (v) => (v === "true" ? true : v === "false" ? false : v),
        z.union([z.boolean(), z.literal("partial")]),
      ),
    )
    .optional()
    .describe(
      "DATA-BOUND. Constraint id → true, false or 'partial'. Fill it for every constraint.",
    ),
  price: z
    .object({
      amount: z.number().min(0),
      currency: z.string().length(3).describe("ISO 4217, e.g. 'USD'."),
      period: z
        .string()
        .max(20)
        .optional()
        .describe(
          "e.g. 'month', 'user/month', 'night'. Omit for one-off prices.",
        ),
    })
    .optional()
    .describe("DATA-BOUND."),
  url: httpUrl.optional().describe("DATA-BOUND. Where to learn more."),
  tags: z
    .array(z.string().max(24))
    .max(3)
    .optional()
    .describe(
      "Up to 3 short facts, e.g. 'Hilly' or '15 min'. Screen readers only.",
    ),
})

export const recommendationSourceSchema = z.object({
  id: z.string(),
  title: z.string().describe("DATA-BOUND. The page or document title."),
  url: httpUrl.describe("DATA-BOUND. The exact URL you retrieved."),
})

export const rankedRecommendationsSchema = z.object({
  title: z.string().optional().describe("e.g. 'Where to stay in Lisbon'."),
  basis: z
    .string()
    .optional()
    .describe(
      "One sentence on what the ranking optimizes for, e.g. 'Ranked for a 2-person team under $20/month that needs a mobile app'. Screen readers only.",
    ),
  constraints: z
    .array(recommendationConstraintSchema)
    .max(6)
    .optional()
    .describe("The user's requirements, from what they told you."),
  items: z
    .array(recommendationItemSchema)
    .min(2)
    .max(6)
    .describe("DATA-BOUND. 2–6 options, best first."),
  sources: z
    .array(recommendationSourceSchema)
    .max(10)
    .optional()
    .describe("Pages you retrieved and cite with [n] in the reasons."),
  selectable: z
    .enum(["none", "single", "multiple"])
    .default("none")
    .describe(
      "'single' or 'multiple' when the user's pick changes what you do next; 'none' to only inform.",
    ),
  submitLabel: z
    .string()
    .max(32)
    .optional()
    .describe("Verb for the submit button, e.g. 'Start a trial'."),
})

export type RecommendationConstraint = z.infer<
  typeof recommendationConstraintSchema
>
export type RecommendationItem = z.input<typeof recommendationItemSchema>
export type RecommendationSource = z.infer<typeof recommendationSourceSchema>
export type RankedRecommendationsInput = z.input<
  typeof rankedRecommendationsSchema
>

/** What the component sends back to the agent. A closed set of actions. */
export type RankedRecommendationsResult =
  /** The user picked these items (one for 'single'). */
  | { action: "select"; itemIds: string[] }
  /** None of these work. Search again, using the reason if given. */
  | { action: "more"; reason?: string }
  /** The user closed the shortlist without choosing. */
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const rankedRecommendationsGuidance = {
  useWhen: [
    "The user asks which option is best for them: where to stay, which tool to buy, who to interview first, what to cook.",
    "You compared a few real options against their situation and can say why each one fits or doesn't.",
  ],
  avoidWhen: [
    "There is one clear answer. Say it in a sentence.",
    "The user wants to compare many attributes side by side without a verdict. Use a data table.",
    "You only want to show items to browse or buy. Use the entity card.",
    "You haven't looked anything up. Never rank options from memory.",
  ],
  rules: [
    "Write basis as one sentence naming what the ranking optimizes for, in the user's terms.",
    "Rank 1 is your top pick; give each item 1–3 reasons specific to this user, not generic praise.",
    "Be honest: add trade-offs, and mark a missed must-have as false rather than leaving it out.",
    "Fill meets for every constraint; use 'partial' when it's met only in part.",
    "Only cite [n] sources you retrieved, and only for claims they support.",
    "On 'more', search again with the reason; on 'select', act on the returned ids only.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(rankedRecommendationsSchema)`.
 */
export const rankedRecommendationsTool = {
  name: "recommend",
  description: [
    "Show a shortlist ranked for the user's situation, with reasons, trade-offs and the constraints each option meets.",
    `Use when: ${rankedRecommendationsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${rankedRecommendationsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${rankedRecommendationsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: rankedRecommendationsSchema,
} as const
