import { z } from "zod"

/**
 * Draft Options: the agent's contract.
 *
 * Two to four alternative drafts of the same piece of copy. The user picks
 * one, optionally edits it, and applies it.
 */

export const draftOptionSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  label: z
    .string()
    .max(24)
    .describe("How this draft differs, e.g. 'Shorter' or 'Warmer'."),
  text: z.string().describe("The full draft, ready to use as is."),
})

export const draftOptionsSchema = z.object({
  title: z.string().describe("What is being drafted, e.g. 'Headline options'."),
  original: z
    .string()
    .optional()
    .describe(
      "The text being rewritten, verbatim. When set, the selected draft is shown as a word diff against it. Omit for new copy.",
    ),
  options: z
    .array(draftOptionSchema)
    .min(2)
    .max(4)
    .describe("Genuinely different drafts, strongest first."),
  applyLabel: z
    .string()
    .max(24)
    .optional()
    .describe("Verb for the apply button, e.g. 'Use headline'."),
})

export type DraftOption = z.infer<typeof draftOptionSchema>
export type DraftOptionsInput = z.input<typeof draftOptionsSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type DraftOptionsResult =
  | {
      action: "apply"
      optionId: string
      /** The final text, including the user's edits. Use it verbatim. */
      text: string
      edited: boolean
    }
  /** None of the drafts work. Write new ones, guided by the note. */
  | { action: "regenerate"; note?: string }
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const draftOptionsGuidance = {
  useWhen: [
    "The user asked you to write or rewrite short copy (a headline, subject line, email intro, post) and the right tone or length is a matter of taste.",
    "Offering a few real alternatives saves a round of back-and-forth.",
  ],
  avoidWhen: [
    "There is one obvious answer. Write it.",
    "The text is long, like a full document. Propose changes to it instead.",
    "The drafts would differ only in a word or two. Pick the best one.",
  ],
  rules: [
    "Offer 2–4 drafts that differ in a way you can name in the label: shorter, warmer, more direct.",
    "Pass the user's text verbatim as original when you are rewriting it, so they can see what changed.",
    "Use the returned text verbatim; the user may have edited it.",
    "On 'regenerate', write new drafts that follow the note. On 'cancel', drop it.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(draftOptionsSchema)`.
 */
export const draftOptionsTool = {
  name: "offer_drafts",
  description: [
    "Offer 2–4 alternative drafts of a piece of copy; the user picks one, can edit it, and applies it.",
    `Use when: ${draftOptionsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${draftOptionsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${draftOptionsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: draftOptionsSchema,
} as const
