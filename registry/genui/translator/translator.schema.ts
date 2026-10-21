import { z } from "zod"

/**
 * Translator: the agent's contract.
 *
 * A translation in the chat with an editable source. The translation text
 * comes from the agent's translation tool; the component never translates.
 */

const languageTag = z
  .string()
  .min(2)
  .max(35)
  .describe("BCP 47 language tag, e.g. 'en', 'es', 'pt-BR', 'zh-Hant'.")

export const translatorGlossaryEntrySchema = z.object({
  source: z.string().max(80).describe("The term in the source language."),
  target: z.string().max(80).describe("How it's kept in the translation."),
})

export const translatorSchema = z.object({
  source: z.object({
    text: z
      .string()
      .max(5000)
      .describe("The text to translate, exactly as the user gave it."),
    language: languageTag,
    detected: z
      .boolean()
      .optional()
      .describe("True when the language was detected, not stated."),
  }),
  target: z.object({
    language: languageTag,
    text: z
      .string()
      .max(8000)
      .optional()
      .describe(
        "DATA-BOUND. The translation, from the translation tool. Omit until you have it.",
      ),
  }),
  alternatives: z
    .array(z.string().max(500))
    .max(3)
    .optional()
    .describe("DATA-BOUND. Up to 3 other phrasings, for short texts."),
  formality: z
    .enum(["formal", "informal"])
    .nullable()
    .optional()
    .describe(
      "The register used, for languages that distinguish it (es, fr, de, ja, ko…). Null or omitted otherwise.",
    ),
  transliteration: z
    .string()
    .max(1000)
    .optional()
    .describe(
      "DATA-BOUND. The translation in Latin script (romaji, pinyin), for non-Latin targets.",
    ),
  notes: z
    .array(z.string().max(200))
    .max(3)
    .optional()
    .describe(
      "Up to 3 short usage notes, e.g. \"In Spain, 'vale' is common for OK\".",
    ),
  glossary: z
    .array(translatorGlossaryEntrySchema)
    .max(12)
    .optional()
    .describe("Terms kept consistent: names, dishes, product terms."),
  languages: z
    .array(languageTag)
    .max(40)
    .optional()
    .describe(
      "Languages the user can pick. Defaults to about 20 common ones; the current pair is always included.",
    ),
})

export type TranslatorGlossaryEntry = z.infer<
  typeof translatorGlossaryEntrySchema
>
export type TranslatorInput = z.input<typeof translatorSchema>

/** What the component sends back. A closed set of actions. */
export type TranslatorResult =
  /** Translate this text. Reply by re-rendering with the new translation. */
  | {
      action: "translate"
      text: string
      from: string
      to: string
      formality?: "formal" | "informal"
    }
  /** The user prefers this alternative phrasing. */
  | { action: "choose"; text: string }

/** Usage guidance the agent reads before choosing this component. */
export const translatorGuidance = {
  useWhen: [
    "The user asks to translate text: an email, a menu, a sign, a phrase they want to say.",
    "The user may want to tweak the source, switch languages or compare phrasings.",
  ],
  avoidWhen: [
    "The user asks what a single word means in their own language. Answer in text.",
    "The text is a whole document. Translate it as a file.",
    "You don't have a translation from your translation tool yet. Get it first; never make up the target text.",
  ],
  rules: [
    "Pass the source text exactly as given; set detected: true when you inferred the language.",
    "target.text, alternatives and transliteration come from the translation tool.",
    "Set formality only for languages that distinguish it, and say which register you used.",
    "Add a transliteration for non-Latin targets when the user wants to say it aloud.",
    "Keep notes to real usage differences (region, register); at most three.",
    "On 'translate', translate the returned text from 'from' to 'to' (with the formality) and re-render. On 'choose', use that phrasing from now on.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(translatorSchema)`.
 */
export const translatorTool = {
  name: "translate_text",
  description: [
    "Show a translation with an editable source, language pickers, alternatives, transliteration and usage notes.",
    `Use when: ${translatorGuidance.useWhen.join(" ")}`,
    `Avoid when: ${translatorGuidance.avoidWhen.join(" ")}`,
    `Rules: ${translatorGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: translatorSchema,
} as const
