import { z } from "zod"

/**
 * Timeline: the agent's contract.
 *
 * Ordered events with a state each: shipment tracking, an incident, project
 * milestones.
 */

export const timelineEventSchema = z.object({
  id: z.string().describe("Stable identifier."),
  time: z
    .string()
    .describe(
      "ISO timestamp ('2026-10-06T14:20:00Z') or date ('2026-10-06'), formatted for the user. Or a short label, e.g. 'Q1'.",
    ),
  title: z.string().describe("What happened, e.g. 'Out for delivery'."),
  description: z.string().optional().describe("One line of detail."),
  state: z
    .enum(["done", "current", "upcoming", "failed"])
    .optional()
    .describe(
      "'current' for the one step in progress now; 'failed' for a step that broke. Omit for plain past events.",
    ),
})

export const timelineSchema = z.object({
  title: z.string().describe("e.g. 'Order #4821'."),
  events: z
    .array(timelineEventSchema)
    .min(2)
    .max(30)
    .describe("DATA-BOUND. In chronological order, from a tool result."),
  orientation: z
    .enum(["vertical"])
    .default("vertical")
    .describe("Only vertical for now."),
})

export type TimelineEvent = z.infer<typeof timelineEventSchema>
export type TimelineEventState = NonNullable<TimelineEvent["state"]>
export type TimelineInput = z.input<typeof timelineSchema>

/** Usage guidance the agent reads before choosing this component. */
export const timelineGuidance = {
  useWhen: [
    "The user asks where something is or what happened, and the answer is a sequence of dated events: a shipment, an incident, a project.",
    "The order and timing of the events matter, not just the latest one.",
  ],
  avoidWhen: [
    "Only the latest event matters. Say it in a sentence.",
    "The steps are tasks the user still has to do. Use a checklist.",
    "You don't have the events from a tool. Never invent timestamps.",
  ],
  rules: [
    "List events oldest first, with times copied from the tool result.",
    "Mark at most one event 'current'; mark later ones 'upcoming'.",
    "Use 'failed' for the step that broke, then show the recovery as its own event.",
    "Keep titles short; put detail in description.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(timelineSchema)`.
 */
export const timelineTool = {
  name: "show_timeline",
  description: [
    "Show ordered events with their state: shipment tracking, an incident timeline, project milestones.",
    `Use when: ${timelineGuidance.useWhen.join(" ")}`,
    `Avoid when: ${timelineGuidance.avoidWhen.join(" ")}`,
    `Rules: ${timelineGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: timelineSchema,
} as const
