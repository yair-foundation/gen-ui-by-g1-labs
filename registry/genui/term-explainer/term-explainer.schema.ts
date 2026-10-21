import { z } from "zod"

/**
 * Term Explainer: the agent's contract.
 *
 * A compact explanation of one term in the context the user met it: what it
 * is and, when relevant, the user's own value placed on the range their
 * document gives.
 */

/** The fields a term may belong to; picks the icon beside the title. */
export const termKinds = [
  "health",
  "finance",
  "legal",
  "science",
  "technology",
  "general",
] as const

export type TermKind = (typeof termKinds)[number]

export const termRangeSchema = z.object({
  low: z
    .number()
    .optional()
    .describe(
      "DATA-BOUND. Lower bound exactly as printed in the user's document. Omit if it gives none.",
    ),
  high: z
    .number()
    .optional()
    .describe(
      "DATA-BOUND. Upper bound exactly as printed in the user's document. Omit if it gives none.",
    ),
  unit: z.string().describe("DATA-BOUND. e.g. 'mmol/L' or '%'."),
  source: z
    .string()
    .describe(
      "Where the range comes from, e.g. 'Your lab's reference range'. Never a range you supplied yourself.",
    ),
})

export const termContextSchema = z.object({
  label: z.string().describe("e.g. 'Your result' or 'This offer'."),
  value: z
    .string()
    .describe("DATA-BOUND. The value as printed, e.g. '4.1 mmol/L'."),
  numericValue: z
    .number()
    .optional()
    .describe(
      "DATA-BOUND. The value as a number, for placing it on the range. Read from `value` when omitted.",
    ),
  range: termRangeSchema
    .optional()
    .describe(
      "The range printed in the user's document. Omit when the document gives none.",
    ),
  note: z
    .string()
    .max(200)
    .optional()
    .describe(
      "DATA-BOUND. A note from the document, e.g. 'Sample taken fasting'. Never a diagnosis or advice.",
    ),
})

export const relatedTermSchema = z.object({
  term: z.string().describe("e.g. 'Sodium'."),
  short: z
    .string()
    .max(60)
    .optional()
    .describe(
      "A few words on what it is, e.g. 'Another electrolyte'. Read in the button's label.",
    ),
})

export const termExplainerSchema = z.object({
  term: z.string().describe("The term, e.g. 'Potassium' or 'APR'."),
  pronunciation: z
    .string()
    .max(40)
    .optional()
    .describe("How to say it, e.g. 'puh-TAS-ee-um'."),
  kind: z
    .enum(termKinds)
    .optional()
    .describe(
      "The field the term belongs to: health, finance, legal, science, technology or general. Shown as a coloured icon beside the term. Omit when none fits.",
    ),
  category: z
    .string()
    .max(48)
    .optional()
    .describe(
      "Where it belongs, e.g. 'Blood test · Electrolyte'. Screen readers only.",
    ),
  definition: z
    .string()
    .max(280)
    .describe("What it is, in plain words. One or two sentences."),
  context: termContextSchema
    .optional()
    .describe(
      "The user's own value from their document. Omit when there is none.",
    ),
  aka: z
    .array(z.string())
    .max(6)
    .optional()
    .describe("Other names, e.g. 'K' or 'serum potassium'."),
  related: z
    .array(relatedTermSchema)
    .max(5)
    .optional()
    .describe("Terms the user may ask about next."),
  source: z
    .object({
      name: z.string(),
      url: z.string().describe("http or https."),
    })
    .optional()
    .describe("A reference for the definition."),
  disclaimer: z
    .enum(["medical", "financial", "legal"])
    .nullable()
    .optional()
    .describe(
      "Adds a 'general information, not advice' line. Set it for health, money and legal terms.",
    ),
})

export type TermRange = z.infer<typeof termRangeSchema>
export type TermContext = z.infer<typeof termContextSchema>
export type RelatedTerm = z.infer<typeof relatedTermSchema>
export type TermDisclaimer = NonNullable<
  z.infer<typeof termExplainerSchema>["disclaimer"]
>
export type TermExplainerInput = z.input<typeof termExplainerSchema>

/** Sent when the user taps a related term. The explainer never locks. */
export type TermExplainerResult = { action: "explain"; term: string }

/** Usage guidance the agent reads before choosing this component. */
export const termExplainerGuidance = {
  useWhen: [
    "The user asks what a term means where they met it: a blood test line, a card offer, a contract clause.",
    "Their own value or wording is part of the question, e.g. 'What's potassium on my blood test?'.",
  ],
  avoidWhen: [
    "The user wants a full overview of a topic. Use an encyclopedia snippet or an article.",
    "Several terms need explaining at once. Answer in text or a table.",
    "The user asks what to do about a result. Answer in text and point them to a professional.",
  ],
  rules: [
    "Keep the definition to one or two plain sentences.",
    "Only set context and range from the user's document, exactly as printed. Never supply a reference range yourself.",
    "Never diagnose, interpret a result as a condition, or suggest treatment. The component only places the value on the document's range.",
    "Set disclaimer to medical, financial or legal for those topics.",
    "Offer up to 5 related terms the user is likely to meet next.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(termExplainerSchema)`.
 */
export const termExplainerTool = {
  name: "explain_term",
  description: [
    "Explain one term in the user's context: what it is and their value on their document's range.",
    `Use when: ${termExplainerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${termExplainerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${termExplainerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: termExplainerSchema,
} as const
