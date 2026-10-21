import { z } from "zod"

/**
 * Question Stepper: the agent's contract.
 *
 * Batches the decisions an agent needs before it can proceed into one
 * paginated card. Fields marked DATA-BOUND must come from a tool result.
 */

export const questionOptionSchema = z.object({
  value: z.string().describe("Returned in the result when selected."),
  label: z.string(),
  description: z
    .string()
    .optional()
    .describe("One line on what choosing this means."),
  recommended: z
    .boolean()
    .optional()
    .describe("Mark at most one option per question."),
})

export const questionSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  header: z
    .string()
    .optional()
    .describe("Short topic label, 1–3 words, e.g. 'Data source'."),
  prompt: z.string().describe("The question, ending with a question mark."),
  description: z
    .string()
    .optional()
    .describe("Why you are asking. Screen readers only."),
  type: z
    .enum(["single", "multi", "text"])
    .default("single")
    .describe(
      "'single' picks one option, 'multi' picks several, 'text' is free input.",
    ),
  options: z
    .array(questionOptionSchema)
    .max(8)
    .optional()
    .describe(
      "Required for 'single' and 'multi'. DATA-BOUND when options refer to real entities (accounts, files, records).",
    ),
  allowOther: z
    .boolean()
    .default(true)
    .describe(
      "Adds a free-text 'Other' option. Disable only when options are exhaustive.",
    ),
  required: z
    .boolean()
    .default(false)
    .describe("When false, the user can skip the question."),
  placeholder: z.string().optional(),
})

export const questionStepperSchema = z.object({
  title: z
    .string()
    .optional()
    .describe(
      "e.g. 'A few questions before I build this'. Screen readers only.",
    ),
  questions: z.array(questionSchema).min(1).max(6),
  allowDelegate: z
    .boolean()
    .default(true)
    .describe(
      "Shows 'Let agent decide' so the user can hand a question back to you.",
    ),
  submitLabel: z.string().optional(),
})

export type QuestionOption = z.infer<typeof questionOptionSchema>
export type Question = z.infer<typeof questionSchema>
export type QuestionStepperInput = z.input<typeof questionStepperSchema>
export type QuestionStepperData = z.output<typeof questionStepperSchema>

export type QuestionAnswer = {
  id: string
  /** 'delegated': the user asked you to decide. Say what you chose. */
  status: "answered" | "skipped" | "delegated"
  /** Selected option values ('single' and 'multi'). */
  selected?: string[]
  /** Free text: the 'Other' input, or the answer to a 'text' question. */
  text?: string
}

/** What the component sends back to the agent. A closed set of actions. */
export type QuestionStepperResult =
  | { action: "submit"; answers: QuestionAnswer[] }
  /** The user refused the premise. Ask in text what they want instead. */
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const questionStepperGuidance = {
  useWhen: [
    "You need 1–5 decisions from the user before you can do the work well.",
    "The answer would materially change the result and you cannot infer it.",
    "The choices are discrete enough that you can propose good options.",
  ],
  avoidWhen: [
    "You can find the answer yourself in data, files or earlier messages. Look it up.",
    "It is a single yes/no. Ask in one sentence or use follow-up chips.",
    "You would need more than 5 questions. Proceed with sensible defaults and ask afterwards.",
    "You are collecting record data such as an address or a new contact. Use a generated form.",
  ],
  rules: [
    "Put the most consequential question first.",
    "Options that refer to real entities must come from a tool result, never invented.",
    "Recommend at most one option per question and say why in its description.",
    "Keep allowOther on unless the options are truly exhaustive.",
    "For 'delegated' answers, choose the recommended option or your best judgement, and tell the user what you chose.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(questionStepperSchema)`.
 */
export const questionStepperTool = {
  name: "ask_questions",
  description: [
    "Ask the user a short batch of questions, one at a time, and wait for their answers before continuing.",
    `Use when: ${questionStepperGuidance.useWhen.join(" ")}`,
    `Avoid when: ${questionStepperGuidance.avoidWhen.join(" ")}`,
    `Rules: ${questionStepperGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: questionStepperSchema,
} as const
