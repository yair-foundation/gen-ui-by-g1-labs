import { z } from "zod";

/**
 * Guided Flow: the agent's contract.
 *
 * A short wizard embedded in the chat: booking a table, returning an item,
 * scheduling a delivery. Fields marked DATA-BOUND must come from a tool result.
 */

export const flowOptionSchema = z.object({
  value: z.string().describe("Returned in the result when selected."),
  label: z.string(),
  description: z
    .string()
    .optional()
    .describe("One line on what choosing this means, e.g. a price or date."),
});

export const flowFieldSchema = z.object({
  id: z.string().describe("Key of this field in the step's value."),
  label: z.string().describe("e.g. 'Phone number'."),
  type: z
    .enum(["text", "email", "tel", "number", "textarea", "date"])
    .default("text")
    .describe("Controls the input and its validation."),
  required: z.boolean().default(false),
  placeholder: z.string().optional(),
});

export const flowSlotSchema = z.object({
  id: z.string().describe("Returned in the result when picked."),
  label: z.string().describe("e.g. '7:30 PM' or '10 AM–12 PM'."),
  available: z
    .boolean()
    .default(true)
    .describe("Unavailable slots are shown but can't be picked."),
});

const stepBase = {
  id: z
    .string()
    .describe("Stable identifier. Keys the step's value in the result."),
  title: z
    .string()
    .describe("Short step name, 1–3 words, e.g. 'Party size' or 'Details'."),
  description: z
    .string()
    .optional()
    .describe("One line of context for the step."),
};

export const flowChoiceStepSchema = z.object({
  ...stepBase,
  type: z.literal("choice"),
  options: z
    .array(flowOptionSchema)
    .min(2)
    .max(8)
    .describe(
      "DATA-BOUND when options refer to real entities (order items, payment methods, addresses).",
    ),
  multiple: z
    .boolean()
    .default(false)
    .describe("Let the user pick several options."),
});

export const flowFieldsStepSchema = z.object({
  ...stepBase,
  type: z.literal("fields"),
  fields: z.array(flowFieldSchema).min(1).max(6),
});

export const flowSlotsStepSchema = z.object({
  ...stepBase,
  type: z.literal("slots"),
  slots: z
    .array(flowSlotSchema)
    .min(1)
    .max(24)
    .describe(
      "DATA-BOUND. Times and availability from a booking or scheduling tool.",
    ),
});

export const flowReviewStepSchema = z.object({
  ...stepBase,
  type: z.literal("review"),
});

export const flowStepSchema = z.discriminatedUnion("type", [
  flowChoiceStepSchema,
  flowFieldsStepSchema,
  flowSlotsStepSchema,
  flowReviewStepSchema,
]);

export const guidedFlowSchema = z.object({
  title: z
    .string()
    .describe(
      "What the flow does, e.g. 'Book a table at Marlow & Pine'. Screen readers only until submitted.",
    ),
  steps: z
    .array(flowStepSchema)
    .min(2)
    .max(5)
    .describe(
      "2–5 steps. End with a 'review' step when the action is binding.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe(
      "Verb for the final button, e.g. 'Book table'. Default 'Submit'.",
    ),
});

export type FlowOption = z.infer<typeof flowOptionSchema>;
export type FlowField = z.input<typeof flowFieldSchema>;
export type FlowSlot = z.input<typeof flowSlotSchema>;
export type FlowStep = z.input<typeof flowStepSchema>;
export type GuidedFlowInput = z.input<typeof guidedFlowSchema>;

/**
 * A step's value: a choice is one option value (or several with `multiple`),
 * a slots step is the picked slot id, a fields step maps field ids to text.
 * Review steps have no value.
 */
export type GuidedFlowValue = string | string[] | Record<string, string>;

/** What the component sends back to the agent. A closed set of actions. */
export type GuidedFlowResult =
  | { action: "submit"; values: Record<string, GuidedFlowValue> }
  /** The user closed the flow. Don't act; ask in text what they want instead. */
  | { action: "cancel" };

/** Usage guidance the agent reads before choosing this component. */
export const guidedFlowGuidance = {
  useWhen: [
    "The user wants to complete a short task that needs a few ordered inputs: booking, returning, scheduling, signing up.",
    "Later steps depend on earlier ones, or the inputs mix choices, times and contact details.",
  ],
  avoidWhen: [
    "You only need one or two answers. Ask in text or use a question stepper.",
    "The only thing to choose is a time, such as booking one call from open slots. Use a slot picker.",
    "You are collecting a single record with many fields and no order. Use a form.",
    "The task needs more than 5 steps. Split it, or do part of it yourself.",
  ],
  rules: [
    "Keep it to 2–5 steps, each with a short title, in the order a person would decide.",
    "Options and slots that refer to real items, payment methods or availability must come from a tool result.",
    "Mark only the fields you truly need as required.",
    "End with a 'review' step before anything binding, such as a booking, payment or return.",
    "Don't act until you receive action 'submit', and use only the returned values.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(guidedFlowSchema)`.
 */
export const guidedFlowTool = {
  name: "start_flow",
  description: [
    "Walk the user through a short multi-step flow (choices, time slots, contact or address fields, review) and wait for them to submit it.",
    `Use when: ${guidedFlowGuidance.useWhen.join(" ")}`,
    `Avoid when: ${guidedFlowGuidance.avoidWhen.join(" ")}`,
    `Rules: ${guidedFlowGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: guidedFlowSchema,
} as const;
