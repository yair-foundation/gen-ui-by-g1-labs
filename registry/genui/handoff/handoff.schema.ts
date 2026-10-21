import { z } from "zod";

/**
 * Handoff: the agent's contract.
 *
 * The agent hands a task to a person or another agent: who takes it, why,
 * the context that goes with it, what's done and what's left, plus a note
 * the user can edit. The user confirms the handoff or keeps the task with
 * the agent. Fields marked DATA-BOUND must come from tool results or the
 * agent's own run, never be invented.
 */

/** The icons a context row may carry. Names map to Lucide icons in the component. */
export const handoffIcons = [
  "calendar",
  "clock",
  "user",
  "users",
  "map-pin",
  "wallet",
  "credit-card",
  "tag",
  "package",
  "mail",
  "phone",
  "file-text",
  "building",
  "shield",
  "star",
  "list-checks",
] as const;

export type HandoffIcon = (typeof handoffIcons)[number];

export const handoffContextRowSchema = z.object({
  label: z.string().max(30).describe("e.g. 'Customer', 'Amount'."),
  value: z.string().max(80).describe("DATA-BOUND. e.g. 'Acme Co.', '$3,900'."),
  icon: z
    .enum(handoffIcons)
    .optional()
    .describe(
      "Optional icon that makes the row scannable: calendar for dates, user for people, wallet for money. Use it on every row or on none.",
    ),
});

export const handoffSchema = z.object({
  from: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Who is handing off, e.g. the agent's name. Default 'the agent'.",
    ),
  to: z
    .object({
      name: z.string().max(40).describe("DATA-BOUND. e.g. 'Dana Ruiz'."),
      role: z
        .string()
        .max(50)
        .optional()
        .describe("DATA-BOUND. e.g. 'Billing lead', 'Legal review agent'."),
      kind: z
        .enum(["person", "agent"])
        .default("person")
        .describe("A person or another agent."),
    })
    .describe("Who takes the task."),
  title: z
    .string()
    .max(80)
    .describe("What is being handed off, e.g. 'Acme's refund request'."),
  reason: z
    .string()
    .max(140)
    .describe(
      "Why, in one line, e.g. 'The refund exceeds my $2,500 approval cap.'",
    ),
  context: z
    .array(handoffContextRowSchema)
    .max(6)
    .optional()
    .describe(
      "DATA-BOUND. The facts the receiver inherits, most important first.",
    ),
  done: z
    .array(z.string().max(80))
    .max(6)
    .optional()
    .describe("DATA-BOUND. What's already finished, past tense."),
  left: z
    .array(z.string().max(80))
    .max(6)
    .optional()
    .describe("What's left for the receiver, as next steps."),
  note: z
    .string()
    .max(600)
    .optional()
    .describe(
      "The note sent to the receiver with the handoff. The user can edit it before confirming.",
    ),
  confirmLabel: z
    .string()
    .max(30)
    .optional()
    .describe("Primary button. Default 'Hand off to <first name>'."),
  keepLabel: z
    .string()
    .max(40)
    .optional()
    .describe(
      "What keeping it means, e.g. 'Raise the cap and let me finish'. Default 'Keep it here'.",
    ),
});

export type HandoffContextRow = z.infer<typeof handoffContextRowSchema>;
export type HandoffInput = z.input<typeof handoffSchema>;
export type HandoffData = z.output<typeof handoffSchema>;

/** What the component sends back to the agent. A closed set of actions. */
export type HandoffResult =
  | {
      action: "confirm";
      /** The note to send, as the user left it. Absent when there is none. */
      note?: string;
      /** True when the user changed the proposed note. */
      edited?: boolean;
    }
  | { action: "keep" };

/** Usage guidance the agent reads before choosing this component. */
export const handoffGuidance = {
  useWhen: [
    "You've reached the limit of what you may or can do on a task (an approval cap, a missing permission, a judgement call) and a specific person or agent should take it from here.",
    "The user asks you to pass work to a teammate or another agent, and the receiver needs context to pick it up.",
  ],
  avoidWhen: [
    "You can finish the task once the user approves one action. Use the approval request.",
    "Something failed and you need a way forward. Use the recovery panel.",
    "You only need an answer from the user. Ask, or use a form.",
    "You don't know who should take it. Ask first; the receiver is data, not a guess.",
  ],
  rules: [
    "Name the real receiver from a tool result or the user, with their role.",
    "Give the reason in one plain line; a handoff is an escalation, not an error.",
    "Keep context to the facts the receiver needs, from real data. List done in the past tense and left as next steps.",
    "Write note as the message the receiver will read, in the first person.",
    "Nothing is sent until the result arrives. On 'confirm', hand off with the returned note exactly. On 'keep', keep the task and do what keepLabel promised.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(handoffSchema)`.
 */
export const handoffTool = {
  name: "hand_off",
  description: [
    "Propose handing a task to a person or another agent: who, why, the context passed on, what's done and what's left, with an editable note. The user confirms or keeps it with the agent.",
    `Use when: ${handoffGuidance.useWhen.join(" ")}`,
    `Avoid when: ${handoffGuidance.avoidWhen.join(" ")}`,
    `Rules: ${handoffGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: handoffSchema,
} as const;
