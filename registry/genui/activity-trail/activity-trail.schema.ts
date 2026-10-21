import { z } from "zod";

/**
 * Activity Trail: the agent's contract.
 *
 * Shows the work behind an answer: what the agent searched, read, called and
 * wrote. Every step is DATA-BOUND: it must describe something the agent
 * actually did in this turn, taken from its own tool calls.
 */

export const activityTargetSchema = z.object({
  label: z
    .string()
    .describe(
      "What the step touched, e.g. 'consent-screen.md' or a page title.",
    ),
  url: z
    .string()
    .optional()
    .describe("http(s) link to the target. Other protocols are not linked."),
});

export const activityStepSchema = z.object({
  id: z.string().describe("Stable identifier. Keep it when the step updates."),
  kind: z
    .enum(["search", "read", "tool", "think", "write"])
    .optional()
    .describe(
      "Search, read a file or page, call a tool, reason, or write output. Screen readers only.",
    ),
  label: z
    .string()
    .describe(
      "What was done, past tense, e.g. \"Searched 'consent screen errors'\".",
    ),
  detail: z
    .string()
    .optional()
    .describe("Short outcome, e.g. '12 results' or 'Rate limited, retrying'."),
  status: z
    .enum(["running", "done", "error"])
    .default("done")
    .describe("'running' while the step is in progress; 'error' if it failed."),
  durationMs: z
    .number()
    .nonnegative()
    .optional()
    .describe(
      "How long the step took, in milliseconds. Omit while running. Summed in the header; per step, screen readers only.",
    ),
  target: activityTargetSchema
    .optional()
    .describe("The file, page or record the step acted on."),
  input: z
    .string()
    .max(400)
    .optional()
    .describe(
      "DATA-BOUND. What the step was given: the query or the arguments, as short plain text. Shown when the user opens the step. Never include secrets, tokens or personal data.",
    ),
  output: z
    .string()
    .max(600)
    .optional()
    .describe(
      "DATA-BOUND. What the step returned: a short excerpt or summary of the result, as plain text. Shown when the user opens the step. Never include secrets, tokens or personal data.",
    ),
});

export const activityTrailSchema = z.object({
  title: z
    .string()
    .optional()
    .describe(
      "e.g. 'Researched consent screen errors'. Defaults to a step count.",
    ),
  steps: z
    .array(activityStepSchema)
    .min(1)
    .max(40)
    .describe(
      "DATA-BOUND. The steps you actually took, in order, from your own tool calls.",
    ),
});

export type ActivityTarget = z.infer<typeof activityTargetSchema>;
export type ActivityStep = z.input<typeof activityStepSchema>;
export type ActivityTrailInput = z.input<typeof activityTrailSchema>;

/** Usage guidance the agent reads before choosing this component. */
export const activityTrailGuidance = {
  useWhen: [
    "Your answer depends on searches, files or tool calls the user may want to check.",
    "The work took several steps or noticeable time, and showing it builds trust in the result.",
  ],
  avoidWhen: [
    "You answered from general knowledge without using tools. There is nothing to show.",
    "There was a single trivial lookup. Mention it in a sentence.",
    "You want the user to approve an action before it happens. Use a change preview.",
  ],
  rules: [
    "Only list steps you actually performed, in the order you performed them.",
    "Write labels in the past tense and name the query, file or tool: \"Read 'billing.md'\".",
    "Keep detail to a few words: a count, a status code, a short finding.",
    "Report failures as 'error' with the reason in detail; never hide a failed step behind a retry.",
    "Add input and output only to steps whose arguments or result the user may want to check (a query, a tool call), as short excerpts from the real call. Leave them off the rest.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(activityTrailSchema)`.
 */
export const activityTrailTool = {
  name: "show_activity",
  description: [
    "Show the steps you took to produce your answer: searches, files read, tool calls and their outcomes.",
    `Use when: ${activityTrailGuidance.useWhen.join(" ")}`,
    `Avoid when: ${activityTrailGuidance.avoidWhen.join(" ")}`,
    `Rules: ${activityTrailGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: activityTrailSchema,
} as const;
