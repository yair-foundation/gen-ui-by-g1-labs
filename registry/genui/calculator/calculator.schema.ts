import { z } from "zod"

/**
 * Calculator: the agent's contract.
 *
 * A single-use calculator built from config. The agent declares inputs and
 * output formulas; it never writes code. Formulas use the safe language in
 * calculator-formula.ts.
 */

const identifier = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Use letters, digits and _ only")

export const numberFormatSchema = z
  .enum(["number", "currency", "percent"])
  .default("number")
  .describe("'percent' shows 12.5 as 12.5%.")

export const calculatorInputSchema = z.object({
  id: identifier.describe("Name used in formulas, e.g. 'people'."),
  label: z.string(),
  control: z
    .enum(["stepper", "slider", "number", "choice", "toggle"])
    .default("slider")
    .describe(
      "'slider' (the default) for any value with a sensible range: weight, height, age, amounts, rates, durations. 'stepper' for small counts (people, servings), 'number' only for exact values with no sensible range (an account balance), 'choice' for 2–6 fixed options, 'toggle' for on (1) / off (0).",
    ),
  default: z.number().describe("Start from what the user already told you."),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  format: numberFormatSchema,
  currency: z.string().length(3).optional(),
  decimals: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe("Digits shown, e.g. 0 for whole dollars."),
  unit: z
    .string()
    .max(12)
    .optional()
    .describe("Shown after the value, e.g. 'people'."),
  options: z
    .array(z.object({ label: z.string(), value: z.number() }))
    .min(2)
    .max(6)
    .optional()
    .describe("Required for 'choice'."),
  ticks: z
    .array(z.number())
    .min(2)
    .max(5)
    .optional()
    .describe(
      "Sliders only: values marked under the track. Defaults to min, a round middle and max.",
    ),
})

export const calculatorBreakdownSchema = z
  .object({
    parts: z
      .array(
        z.object({
          label: z.string().max(32).describe("e.g. 'Your contributions'."),
          formula: z
            .string()
            .max(500)
            .describe("Same language as outputs; may use any output id."),
        }),
      )
      .min(2)
      .max(3),
  })
  .describe(
    "Splits the primary output into 2–3 parts that add up to it, shown as a stacked bar with labels and values, e.g. contributions vs growth.",
  )

export const calculatorBandsSchema = z
  .array(
    z.object({
      label: z.string().max(16).describe("One or two words, e.g. 'Healthy'."),
      below: z
        .number()
        .optional()
        .describe("Where this band ends (exclusive). Omit on the last band."),
      tone: z
        .enum(["good", "caution", "bad"])
        .optional()
        .describe(
          "Colours the band when it carries a judgement. Omit for neutral ranges.",
        ),
    }),
  )
  .min(2)
  .max(6)
  .describe(
    "Named ranges the value falls into, lowest first, shown as a scale with the current band marked. BMI: Under below 18.5 (caution), Healthy below 25 (good), Over below 30 (caution), Obese (bad).",
  )

export const calculatorOutputSchema = z.object({
  id: identifier.describe("Later outputs can use this name in their formulas."),
  label: z
    .string()
    .max(40)
    .describe(
      "2–4 words, e.g. 'Monthly payment'; never a legend or a list of codes. May include an input id in braces, filled with its current value: 'Balance after {years} years'.",
    ),
  formula: z
    .string()
    .max(500)
    .describe(
      "Uses input ids and earlier output ids. Operators + - * / % ^ and comparisons; functions min, max, round(x, digits), floor, ceil, abs, sqrt, pow, clamp(x, lo, hi), if(cond, a, b).",
    ),
  format: numberFormatSchema,
  currency: z.string().length(3).optional(),
  decimals: z.number().int().min(0).max(4).optional(),
  unit: z.string().max(12).optional().describe("e.g. 'kg' or 'per person'."),
  primary: z
    .boolean()
    .optional()
    .describe("The answer the user cares most about. Mark exactly one."),
  breakdown: calculatorBreakdownSchema.optional(),
  bands: calculatorBandsSchema.optional(),
})

export const calculatorSchema = z.object({
  title: z.string().describe("What it calculates, e.g. 'Shopping quantities'."),
  description: z
    .string()
    .optional()
    .describe(
      "One line, e.g. where the defaults come from. Screen readers only.",
    ),
  inputs: z.array(calculatorInputSchema).min(1).max(6),
  outputs: z.array(calculatorOutputSchema).min(1).max(8),
  assumptions: z
    .array(z.string())
    .max(4)
    .optional()
    .describe(
      "What the numbers assume, joined into one short line at the bottom.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe(
      "Adds a button that sends the current numbers back to you, e.g. 'Use this split'. Omit when the calculator is the whole answer.",
    ),
})

export type CalculatorBreakdown = z.infer<typeof calculatorBreakdownSchema>
export type CalculatorBand = z.infer<typeof calculatorBandsSchema>[number]
export type CalculatorInput = z.infer<typeof calculatorInputSchema>
export type CalculatorOutput = z.infer<typeof calculatorOutputSchema>
export type CalculatorConfig = z.input<typeof calculatorSchema>
export type CalculatorData = z.output<typeof calculatorSchema>

/** Sent back when the user presses the submit button. */
export type CalculatorResult = {
  action: "submit"
  inputs: Record<string, number>
  outputs: Record<string, number | null>
}

/** Usage guidance the agent reads before choosing this component. */
export const calculatorGuidance = {
  useWhen: [
    "The answer depends on numbers the user may want to adjust: headcount, budget, rate, duration.",
    "The user is exploring a trade-off, e.g. a budget split, a recipe scale or a loan term.",
  ],
  avoidWhen: [
    "All inputs are known and fixed. Calculate it and answer in a sentence.",
    "You are unsure of the right formula. Explain the method in text instead.",
    "The numbers must come from live data the formulas can't see. Fetch the data first.",
  ],
  rules: [
    "Default every input to what the user already said; only expose inputs they might change.",
    "Prefer sliders: give every value with a sensible range a slider with min, max and step that bracket the user's value; use a number field only when no range makes sense.",
    "Formulas may only use input ids and earlier output ids.",
    "Mark one output as primary, give each output a unit or format, and round sensibly.",
    "When the primary output is a sum of parts (contributions and growth, principal and interest), add a breakdown instead of extra outputs.",
    "Keep output labels to 2–4 words. When a value falls into named ranges (a BMI category, a risk level), add bands to that output instead of a separate coded output such as '1 under, 2 healthy'.",
    "Keep assumptions to one short line. Present results as estimates, not financial advice.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(calculatorSchema)`.
 */
export const calculatorTool = {
  name: "build_calculator",
  description: [
    "Build a small interactive calculator from inputs and output formulas, so the user can adjust the numbers themselves.",
    `Use when: ${calculatorGuidance.useWhen.join(" ")}`,
    `Avoid when: ${calculatorGuidance.avoidWhen.join(" ")}`,
    `Rules: ${calculatorGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: calculatorSchema,
} as const

/* Pure helpers, shared by the component and its tests. */

/**
 * Default slider ticks: min, a round middle and max. The middle is the
 * roundest value near the midpoint (within 10% of the range) that is a
 * multiple of the step, e.g. 0–625 → 0, 300, 625.
 */
export function sliderTicks(min: number, max: number, step = 1): number[] {
  if (!(max > min)) return [min]
  const mid = (min + max) / 2
  const range = max - min
  const isStep = (v: number) => Math.abs(v / step - Math.round(v / step)) < 1e-9
  for (let p = 10 ** Math.floor(Math.log10(range)); p >= 1e-6; p /= 10) {
    const v = Number((Math.round(mid / p) * p).toPrecision(12))
    if (Math.abs(v - mid) <= range * 0.1 && v > min && v < max && isStep(v))
      return [min, v, max]
  }
  return [min, Number((Math.round(mid / step) * step).toPrecision(12)), max]
}

/**
 * Columns for the result tiles, so no row ends with a lone tile: up to `max`
 * share one row; more take as few rows as possible, split as evenly as
 * possible (5 → 3+2, 6 → 3+3, 7 → 4+3). `lead` is true when the first
 * (primary) tile should span a full row because the rest would leave one
 * tile alone.
 */
export function statColumns(count: number, max = 4): { columns: number; lead: boolean } {
  let columns = Math.max(Math.min(count, max), 1)
  if (count > max) {
    const rows = (c: number) => Math.ceil(count / c)
    for (let c = max; c >= 2; c--) {
      if (count % c !== 1 && rows(c) <= rows(columns)) columns = c
    }
  }
  return { columns, lead: columns > 1 && count % columns === 1 }
}

/** Index of the band the value falls in: the first whose `below` it is under. */
export function bandIndex(
  value: number,
  bands: readonly { below?: number }[],
): number {
  const i = bands.findIndex((b) => b.below === undefined || value < b.below)
  return i === -1 ? bands.length - 1 : i
}

/**
 * Where to mark the value on a scale of equal-width bands, in percent. Inside
 * its band it sits proportionally; the open-ended first and last bands borrow
 * their neighbour's width. Kept off the band edges so the marker reads as
 * inside the band.
 */
export function bandPosition(
  value: number,
  bands: readonly { below?: number }[],
): number {
  const n = bands.length
  const i = bandIndex(value, bands)
  const width = (k: number) => {
    const lo = bands[k - 1]?.below
    const hi = bands[k]?.below
    return lo !== undefined && hi !== undefined ? hi - lo : undefined
  }
  let lo = bands[i - 1]?.below
  let hi = bands[i]?.below
  const fallback = Math.abs(lo ?? hi ?? 1) * 0.5 || 1
  if (lo === undefined && hi !== undefined) lo = hi - (width(i + 1) ?? fallback)
  if (hi === undefined && lo !== undefined) hi = lo + (width(i - 1) ?? fallback)
  const frac =
    lo !== undefined && hi !== undefined && hi > lo ? (value - lo) / (hi - lo) : 0.5
  const inside = Math.min(0.9, Math.max(0.1, frac))
  return ((i + inside) / n) * 100
}

/**
 * A slider's bounds. When the agent leaves them out, they bracket the default
 * with room either side, rounded: 175 → 0–400, 82 → 0–200, -5 → -10–0.
 */
export function sliderRange(
  value: number,
  min?: number,
  max?: number,
): { min: number; max: number } {
  const round = (v: number) => {
    const p = 10 ** Math.floor(Math.log10(Math.abs(v) || 1))
    return Math.ceil(v / p) * p
  }
  const lo = min ?? (value < 0 ? -round(-value * 2) : 0)
  let hi = max ?? (value > 0 ? round(value * 2) : 100)
  if (!(hi > lo)) hi = lo + (Math.abs(lo) || 100)
  return { min: lo, max: Math.max(hi, value) }
}

/** Bar widths (percent) for breakdown parts. Negative parts get no width. */
export function breakdownShares(values: number[]): number[] {
  const safe = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
  const sum = safe.reduce((a, b) => a + b, 0)
  return safe.map((v) => (sum > 0 ? (v / sum) * 100 : 0))
}

/**
 * Fills `{id}` in a label with formatted values; unknown ids stay as typed.
 */
export function fillLabel(
  label: string,
  values: Record<string, string | undefined>,
): string {
  return label.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, id: string) =>
    Object.hasOwn(values, id) && values[id] !== undefined
      ? (values[id] as string)
      : match,
  )
}
