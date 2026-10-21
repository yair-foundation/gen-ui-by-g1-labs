import { z } from "zod"

/**
 * Streaming Skeleton: the host's placeholder.
 *
 * Not an agent tool. The host (or the Renderer) shows it while a tool call's
 * name or props are still unknown, so the message reserves space in roughly
 * the shape of what is coming. There is deliberately no tool definition.
 */

export const streamingSkeletonSchema = z.object({
  shape: z
    .enum(["card", "table", "list", "text", "media"])
    .default("card")
    .describe(
      "Rough shape of the coming content. Use 'card' when the component is unknown.",
    ),
  lines: z
    .number()
    .int()
    .min(1)
    .max(12)
    .optional()
    .describe("Rows or lines of placeholder. Each shape has its own default."),
  label: z
    .string()
    .optional()
    .describe(
      "Status text. Screen reader only, unless 'activity' is set, then shown next to the orb. Default 'Generating…', or the activity's own word ('Searching…').",
    ),
  activity: z
    .enum(["thinking", "searching", "writing", "planning", "waiting"])
    .optional()
    .describe(
      "What the agent is doing, when the host knows. Shows a small activity orb with the label above the placeholder. Leave it out for a plain skeleton.",
    ),
})

export type StreamingSkeletonInput = z.input<typeof streamingSkeletonSchema>

/** Guidance for hosts deciding when to show the placeholder. */
export const streamingSkeletonGuidance = {
  useWhen: [
    "A tool call has started but its name or props have not arrived, so the real component can't render yet.",
    "You know roughly what is coming (a table, a list, a card) and want the message to keep its place.",
  ],
  avoidWhen: [
    "The component is known. Render it with status 'streaming'; every GenUI component has its own loading state.",
    "The agent is still writing text. Show the text as it streams instead.",
  ],
  rules: [
    "Replace it with the real component as soon as the tool name is known.",
    "Pick the shape from the tool name when you can; fall back to 'card'.",
    "Keep lines close to the expected size, so the layout doesn't jump when the component arrives.",
    "Set 'activity' only when the host really knows the step (a search tool is running, the model is writing); otherwise leave it out.",
  ],
} as const
