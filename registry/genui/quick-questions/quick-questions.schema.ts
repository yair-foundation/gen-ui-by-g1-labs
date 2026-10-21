import { z } from "zod"

/**
 * Quick Questions: the agent's contract.
 *
 * A few short multiple-choice questions shown together, answered in one go
 * and sent with one button. For one question at a time, use Question Stepper.
 */

export const quickQuestionOptionSchema = z.object({
  id: z.string().describe("Returned in the result when chosen."),
  label: z.string().describe("Plain and short, e.g. 'September to October'."),
})

export const quickQuestionSchema = z.object({
  id: z.string().describe("Stable identifier. Keys the answer in the result."),
  label: z
    .string()
    .describe("The question, short and plain, e.g. 'When are you going?'."),
  header: z
    .string()
    .max(24)
    .optional()
    .describe(
      "1–2 word topic for the submitted summary, e.g. 'When'. Without it the summary shows the answer alone.",
    ),
  type: z
    .enum(["single", "multiple"])
    .default("single")
    .describe("'single' picks one option, 'multiple' picks any number."),
  options: z
    .array(quickQuestionOptionSchema)
    .min(2)
    .max(8)
    .describe(
      "2–8 options. Include 'Not sure yet' as a normal option when it helps. DATA-BOUND when options refer to real entities (venues, accounts, products).",
    ),
  required: z
    .boolean()
    .default(true)
    .describe("Submit stays disabled until required questions are answered."),
  allowOther: z
    .boolean()
    .default(false)
    .describe(
      "Adds an 'Other…' option that reveals a short text input. Its answer is 'other' and the text comes back in `other`. Don't use 'other' as an option id.",
    ),
})

export const quickQuestionsSchema = z.object({
  title: z
    .string()
    .max(60)
    .optional()
    .describe(
      "What the answers are for, e.g. 'Before I build your packing list'. Default: 'A few quick questions'.",
    ),
  questions: z
    .array(quickQuestionSchema)
    .min(1)
    .max(5)
    .describe("Ideally 2–5. Put the most consequential question first."),
  submitLabel: z
    .string()
    .max(40)
    .describe(
      "Says what happens next, e.g. 'Personalize my wardrobe'. Not 'Submit'.",
    ),
  defaults: z
    .record(z.string(), z.union([z.string(), z.array(z.string())]))
    .optional()
    .describe(
      "Preselected answers by question id: an option id for 'single', option ids for 'multiple'. Only what the user already told you.",
    ),
})

export type QuickQuestionOption = z.infer<typeof quickQuestionOptionSchema>
export type QuickQuestion = z.infer<typeof quickQuestionSchema>
export type QuickQuestionsInput = z.input<typeof quickQuestionsSchema>
export type QuickQuestionsData = z.output<typeof quickQuestionsSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type QuickQuestionsResult = {
  action: "submit"
  /**
   * Option id ('single') or option ids ('multiple') by question id.
   * Unanswered optional questions are left out. 'other' means the user typed
   * their own answer; read it from `other`.
   */
  answers: Record<string, string | string[]>
  /** The text typed into 'Other', by question id. */
  other?: Record<string, string>
}

/** Usage guidance the agent reads before choosing this component. */
export const quickQuestionsGuidance = {
  useWhen: [
    "You need 2–5 quick choices from the user before you can tailor the answer, e.g. when, where and dress code before a packing list.",
    "Each question has a handful of obvious options the user can tap without thinking.",
  ],
  avoidWhen: [
    "The questions need explanation, recommendations or free text. Use a question stepper.",
    "You can infer the answer from the conversation or data. Don't ask.",
    "It is a single yes/no. Ask in one sentence or use follow-up chips.",
    "You are collecting record data such as an address or contact details. Use a generated form.",
  ],
  rules: [
    "Keep labels short and plain: a question of a few words, options of one to four words.",
    "Ask only what changes your answer, most consequential first.",
    "Include 'Not sure yet' as a normal option when the user may not know.",
    "Preselect via defaults only what the user already told you.",
    "Write submitLabel as the outcome, e.g. 'Personalize my wardrobe'.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(quickQuestionsSchema)`.
 */
export const quickQuestionsTool = {
  name: "ask_quick_questions",
  description: [
    "Ask the user a few short multiple-choice questions at once, answered together with one button, and wait for the answers before continuing.",
    `Use when: ${quickQuestionsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${quickQuestionsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${quickQuestionsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: quickQuestionsSchema,
} as const
