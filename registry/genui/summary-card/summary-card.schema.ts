import { z } from "zod"

/**
 * Summary Card: the agent's contract.
 *
 * The at-a-glance header for a plan or an overview: what it is, in one line,
 * and the few facts the user will scan for.
 */

/** The icons a fact may carry. Names map to Lucide icons in the component. */
export const summaryIcons = [
  "calendar",
  "clock",
  "timer",
  "users",
  "user",
  "map-pin",
  "bed",
  "wallet",
  "credit-card",
  "tag",
  "package",
  "plane",
  "car",
  "utensils",
  "flame",
  "mail",
  "phone",
  "file-text",
  "list-checks",
  "bug",
  "shield",
  "star",
  "home",
  "briefcase",
  "life-buoy",
  "route",
  "target",
  "cloud-sun",
  "trending-up",
] as const

export type SummaryIcon = (typeof summaryIcons)[number]

export const summaryFactSchema = z.object({
  label: z.string().describe("Short label, e.g. 'Prep'."),
  value: z
    .string()
    .describe("The fact, e.g. 'Most work happens before guests arrive'."),
  delta: z
    .string()
    .max(16)
    .optional()
    .describe(
      "A change next to the value, e.g. '+11%' or '-3%'. Renders as a green badge for an increase and a red one for a decrease. Put the plain value in 'value'.",
    ),
  // Decoration only: a name outside the list is dropped rather than failing
  // the whole card. The tool's JSON schema still lists the names.
  icon: z
    .enum(summaryIcons)
    .optional()
    .catch(undefined)
    .describe(
      "Optional icon that makes the fact scannable: calendar for dates, users for people, wallet for money, trending-up for a rate or growth. Use it on every fact or on none.",
    ),
})

export const summaryCardSchema = z.object({
  title: z
    .string()
    .describe(
      "What this is, e.g. 'Sunday roast for friends'. A title with one arrow and short ends, like '06:40 → 10:05', renders as a route: both ends in big figures with a dashed line between.",
    ),
  summary: z
    .string()
    .optional()
    .describe("One or two sentences framing the plan or overview."),
  badge: z
    .string()
    .max(24)
    .optional()
    .describe(
      "A real state worth a badge, e.g. 'Resolved'. Omit if there is none.",
    ),
  badgeTone: z
    .enum(["neutral", "success", "warning", "info", "danger"])
    .optional()
    .describe(
      "What the badge means: success (done, on track), warning (at risk, needs attention), danger (failed, blocked), info (in progress). Default neutral.",
    ),
  facts: z
    .array(summaryFactSchema)
    .min(2)
    .max(6)
    .describe(
      "The facts the user will scan for. DATA-BOUND when they describe real records.",
    ),
})

export type SummaryFact = z.infer<typeof summaryFactSchema>
export type SummaryCardInput = z.input<typeof summaryCardSchema>

/** Usage guidance the agent reads before choosing this component. */
export const summaryCardGuidance = {
  useWhen: [
    "You are opening a plan or overview that has several key attributes the user will scan: a trip, an event, an incident, a project.",
    "The details follow below, and the user needs the shape of it first.",
  ],
  avoidWhen: [
    "There is one fact to report. Say it in a sentence.",
    "You are listing many records with the same fields. Use a data table.",
    "The facts are generic filler, such as 'Difficulty: Easy' when nobody asked.",
    "You are confirming an action that just finished (an order placed, a record changed). Use a result receipt when its tool returned success; otherwise say it in a sentence.",
  ],
  rules: [
    "Use it once, at the top of the reply.",
    "Keep facts to 2–6 short label/value pairs, in the order the user cares about.",
    "Each value is one short phrase, never a list. When the answer also has items the user works through (open tasks, next steps), put them in a checklist under the card, both in a stack.",
    "Only set badge for a real state; never as decoration.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(summaryCardSchema)`.
 */
export const summaryCardTool = {
  name: "show_summary",
  description: [
    "Open a plan or overview with a title, a one-line summary and its key facts.",
    `Use when: ${summaryCardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${summaryCardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${summaryCardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: summaryCardSchema,
} as const
