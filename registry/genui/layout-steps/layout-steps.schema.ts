import { z } from "zod";

/** Child props may arrive as a JSON string (strict tool schemas, or a model that stringifies). */
function parseIfJSONString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * Layout Steps: the agent's contract.
 *
 * A numbered procedure where each step is its own component: pick a time,
 * then confirm; upload a file, then review the changes. Every step is
 * visible at once, so the user sees the whole path.
 */

export const genuiChildSchema = z.object({
  component: z
    .string()
    .describe(
      "Catalog name, e.g. 'pick_slot'. A layout may hold one more layout, no deeper.",
    ),
  props: z
    .preprocess(parseIfJSONString, z.record(z.string(), z.unknown()))
    .describe(
      'That component\'s props, following its own schema. A value may be { "$bind": "<step id>.<path>", "default": … } to copy an earlier step\'s latest result.',
    ),
  id: z
    .string()
    .max(24)
    .optional()
    .describe("Lets later steps bind to this step's result, e.g. 'slot'."),
});

export const layoutStepSchema = genuiChildSchema.extend({
  title: z.string().max(60).describe("The step, imperative: 'Pick a time'."),
  description: z
    .string()
    .max(120)
    .optional()
    .describe("One line only when the title isn't enough."),
});

export const layoutStepsSchema = z.object({
  title: z
    .string()
    .max(60)
    .optional()
    .describe("What the steps achieve, e.g. 'Book the service visit'."),
  steps: z.array(layoutStepSchema).min(2).max(6),
});

export type LayoutStep = z.input<typeof layoutStepSchema>;
export type LayoutStepsInput = z.input<typeof layoutStepsSchema>;

export const layoutStepsGuidance = {
  useWhen: [
    "A task has 2–6 steps in order, and each step is best done with its own component: pick, then confirm; upload, then review.",
    "A later step should reflect what the user did in an earlier one (bind to it).",
  ],
  avoidWhen: [
    "The steps are questions with short answers. Use a question stepper or a guided flow, which show one step at a time.",
    "The steps are instructions for the user to follow elsewhere. Use a checklist.",
    "There is no order. Use a stack or a grid.",
  ],
  rules: [
    "When the user asks to pick something and then confirm or approve it in one reply, use steps with the confirmation bound to the pick; don't send the picker alone and wait for the next turn.",
    "Title each step with a verb. Keep descriptions to one line, and only when needed.",
    'Give an id to steps whose result later steps use, and bind to it with { "$bind": "<id>.<path>", "default": … }. Binds only copy values.',
    "The last step is the one that commits: an approval, a receipt, a confirmation.",
    "A layout may hold one more layout and no deeper.",
  ],
} as const;

export const layoutStepsTool = {
  name: "show_steps",
  description: [
    "Lay out a 2–6 step procedure where each step is its own component, with later steps able to read earlier ones.",
    `Use when: ${layoutStepsGuidance.useWhen.join(" ")}`,
    `Avoid when: ${layoutStepsGuidance.avoidWhen.join(" ")}`,
    `Rules: ${layoutStepsGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: layoutStepsSchema,
} as const;
