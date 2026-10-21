import { z } from "zod"

import { MAX_STEPS, validateModel } from "./simulation-engine"

/**
 * Simulation: the agent's contract.
 *
 * A what-if model that runs over time. The agent declares inputs, state
 * carried between steps and a formula for each state's next value; the
 * component runs it locally as the user moves the inputs. Formulas use the
 * safe language in simulation-engine.ts, never code.
 */

const identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, digits and _ only")

const formula = z.string().max(500)

const unit = z
  .string()
  .max(16)
  .optional()
  .describe(
    "'currency', 'percent' (12.5 shows as 12.5%), 'number', or a short suffix such as 'tickets'.",
  )

const decimals = z
  .number()
  .int()
  .min(0)
  .max(4)
  .optional()
  .describe("Digits after the decimal point.")

export const simulationInputSchema = z.object({
  id: identifier.describe("Name used in formulas, e.g. 'deposit'."),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  step: z.number().positive(),
  default: z
    .number()
    .describe("Start from what the user told you. The baseline run uses it."),
  unit,
  decimals,
})

export const simulationStateSchema = z.object({
  id: identifier.describe("A value carried from step to step, e.g. 'balance'."),
  label: z.string(),
  initial: formula.describe(
    "Value at step 0. May use input ids, earlier state ids and t (0).",
  ),
  unit,
  decimals,
})

export const simulationStepSchema = z.object({
  id: identifier.describe("The state id this formula updates."),
  formula: formula.describe(
    "Next value from the previous step's state and outputs, the inputs and t (the step being computed, from 1). e.g. 'balance * (1 + rate/100/12) + deposit'.",
  ),
})

export const simulationOutputSchema = z.object({
  id: identifier,
  label: z.string(),
  formula: formula.describe(
    "Derived each step from inputs, state, earlier outputs and t.",
  ),
  unit,
  decimals,
})

export const simulationMilestoneSchema = z.object({
  label: z.string().max(40).describe("e.g. 'Backlog cleared'."),
  when: formula.describe(
    "Condition; the first step where it holds is marked, e.g. 'backlog <= 0'.",
  ),
})

export const simulationSchema = z
  .object({
    title: z.string().describe("The question, e.g. 'Savings over 10 years'."),
    description: z
      .string()
      .optional()
      .describe("One line on the model. Screen readers only."),
    currency: z
      .string()
      .length(3)
      .default("USD")
      .describe("ISO 4217 code for values with unit 'currency'."),
    inputs: z.array(simulationInputSchema).min(1).max(6),
    state: z.array(simulationStateSchema).min(1).max(6),
    step: z
      .array(simulationStepSchema)
      .min(1)
      .max(6)
      .describe("Exactly one formula per state id."),
    steps: z
      .number()
      .int()
      .min(1)
      .max(MAX_STEPS)
      .describe("The horizon, e.g. 120 for ten years of months."),
    stepUnit: z
      .string()
      .max(16)
      .describe("'day', 'week', 'month', 'year' or a custom singular label."),
    outputs: z.array(simulationOutputSchema).max(6).optional(),
    stopWhen: formula
      .optional()
      .describe("Ends the run early once true, e.g. 'balance <= 0'."),
    plot: z
      .array(identifier)
      .min(1)
      .max(3)
      .describe("State or output ids to chart. Pick ones sharing a unit."),
    milestones: z.array(simulationMilestoneSchema).max(4).optional(),
    baseline: z
      .boolean()
      .default(true)
      .describe(
        "Show the run with default inputs as a dashed line once the user changes something.",
      ),
    apply: z
      .boolean()
      .default(true)
      .describe(
        "Adds a button that sends the chosen inputs back to you. Set false when the simulation is the whole answer.",
      ),
    applyLabel: z
      .string()
      .max(32)
      .optional()
      .describe("Button text, e.g. 'Use this staffing plan'."),
  })
  .superRefine((value, ctx) => {
    for (const message of validateModel(value)) {
      ctx.addIssue({ code: "custom", message })
    }
  })

export type SimulationInputField = z.infer<typeof simulationInputSchema>
export type SimulationState = z.infer<typeof simulationStateSchema>
export type SimulationStep = z.infer<typeof simulationStepSchema>
export type SimulationOutput = z.infer<typeof simulationOutputSchema>
export type SimulationMilestone = z.infer<typeof simulationMilestoneSchema>
export type SimulationInput = z.input<typeof simulationSchema>
export type SimulationData = z.output<typeof simulationSchema>

/** Sent back when the user presses the apply button. */
export type SimulationResult = {
  action: "apply"
  /** The input values the user chose. */
  inputs: Record<string, number>
  /** Final value of every state and output id in that run. */
  summary: Record<string, number>
}

/** Usage guidance the agent reads before choosing this component. */
export const simulationGuidance = {
  useWhen: [
    "The question is how something changes over time: savings growth, a loan payoff, a support backlog, stock levels.",
    "The user wants to try what-ifs, e.g. a bigger deposit, more staff or an extra payment.",
  ],
  avoidWhen: [
    "The answer is a single number. Use a calculator.",
    "The figures already exist as data. Chart them instead of simulating them.",
    "You are unsure how the system behaves step to step. Explain the method in text.",
  ],
  rules: [
    "Default every input to what the user said; the default run is the dashed baseline.",
    "Give each state exactly one step formula; formulas may only use declared ids and t.",
    "Use stopWhen for runs that end, such as a paid-off loan, and milestones for moments worth marking.",
    "Plot one to three series that share a unit.",
    "Present results as estimates from the stated assumptions, not advice.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(simulationSchema)`.
 */
export const simulationTool = {
  name: "run_simulation",
  description: [
    "Show an interactive what-if model that runs over time, so the user can move the inputs and watch the outcome change.",
    `Use when: ${simulationGuidance.useWhen.join(" ")}`,
    `Avoid when: ${simulationGuidance.avoidWhen.join(" ")}`,
    `Rules: ${simulationGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: simulationSchema,
} as const
