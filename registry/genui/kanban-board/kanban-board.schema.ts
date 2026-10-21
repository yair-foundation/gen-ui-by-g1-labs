import { z } from "zod";

/**
 * Kanban Board: the agent's contract.
 *
 * Work items from the user's tracker, by stage. The user can reorganize them;
 * every change comes back to the agent instead of being written directly.
 */

export const KANBAN_PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export const kanbanColumnSchema = z.object({
  id: z
    .string()
    .describe("Stable column id, e.g. the tracker's status id. Used in moves."),
  title: z.string().describe("Column name, e.g. 'In progress'."),
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Work-in-progress limit. The column says 'Over limit' when it holds more cards.",
    ),
  done: z
    .boolean()
    .optional()
    .describe(
      "True for a finished stage (Done, Complete, Shipped): its cards are shown faded with a check.",
    ),
});

export const kanbanCardSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in moves."),
  columnId: z.string().describe("Id of the column the card is in now."),
  title: z.string().describe("e.g. 'Fix login redirect'."),
  subtitle: z
    .string()
    .max(40)
    .optional()
    .describe("A short key or second line, e.g. 'ENG-142'."),
  assignee: z
    .object({
      name: z.string(),
      initials: z.string().max(3),
    })
    .optional(),
  labels: z
    .array(z.string().max(24))
    .max(3)
    .optional()
    .describe("Screen readers only."),
  due: z.string().optional().describe("ISO 8601 date, e.g. '2026-10-14'."),
  priority: z.enum(KANBAN_PRIORITIES).optional(),
  url: z
    .string()
    .optional()
    .describe("Link to the item in the tracker (http or https). The card's subtitle (its key) becomes the link, so give it a subtitle."),
});

export const kanbanProposalSchema = z.object({
  cardId: z.string(),
  toColumnId: z.string(),
  reason: z
    .string()
    .max(140)
    .optional()
    .describe("Why, in one short sentence. Screen readers only."),
});

export const kanbanBoardSchema = z.object({
  title: z.string().optional().describe("e.g. 'Sprint 42'."),
  source: z
    .object({
      label: z.string().describe("e.g. 'Acme Tracker · Web team'."),
      url: z.string().optional(),
    })
    .optional()
    .describe("DATA-BOUND. Where the board comes from."),
  columns: z
    .array(kanbanColumnSchema)
    .min(1)
    .max(8)
    .describe("DATA-BOUND. The tracker's stages, in display order."),
  cards: z
    .array(kanbanCardSchema)
    .max(200)
    .describe(
      "DATA-BOUND. The items as the tracker returns them, in order within each column (top first).",
    ),
  proposals: z
    .array(kanbanProposalSchema)
    .max(50)
    .optional()
    .describe(
      "Moves you suggest. Shown already applied and marked 'Suggested', each with Undo. Nothing changes until the user applies.",
    ),
  editable: z
    .boolean()
    .default(true)
    .describe(
      "Let the user move cards. Set false for a read-only board; proposals can still be reviewed.",
    ),
  submitLabel: z
    .string()
    .optional()
    .describe("Label for the apply button, e.g. 'Update tracker'."),
});

export type KanbanColumn = z.infer<typeof kanbanColumnSchema>;
export type KanbanCard = z.infer<typeof kanbanCardSchema>;
export type KanbanProposal = z.infer<typeof kanbanProposalSchema>;
export type KanbanPriority = (typeof KANBAN_PRIORITIES)[number];
export type KanbanBoardInput = z.input<typeof kanbanBoardSchema>;

export type KanbanMove = {
  cardId: string;
  fromColumnId: string;
  toColumnId: string;
  /** The card's final 0-based position in the target column. */
  index: number;
};

/** What the component sends back to the agent. A closed set of actions. */
export type KanbanBoardResult =
  /** Apply exactly these moves (accepted suggestions included). */
  | { action: "apply"; moves: KanbanMove[] }
  /** The user wants a different arrangement. Apply nothing; revise and show the board again. */
  | { action: "revise"; feedback: string }
  /** The user declined. Apply nothing. */
  | { action: "dismiss" };

/** Usage guidance the agent reads before choosing this component. */
export const kanbanBoardGuidance = {
  useWhen: [
    "The user wants to see work items by stage: a sprint board, a bug triage, a hiring or sales pipeline.",
    "The user wants to reorganize items between stages, or you are suggesting moves for them to review.",
  ],
  avoidWhen: [
    "There are only a few items or a single stage. Use a list.",
    "The user needs to compare many fields per item. Use a data table.",
    "You can't read the items from their tracker. Fetch them first; never invent cards.",
    "The change is to a field other than the stage. Use a change preview.",
  ],
  rules: [
    "Pass columns and cards exactly as the tracker returns them, in order; a card belongs to the column named by its columnId.",
    "Put moves you recommend in proposals, each with a one-line reason. Never pre-move a card by changing its columnId.",
    "Set editable: false when the user only asked to look.",
    "Apply nothing until you receive action 'apply', then apply exactly the returned moves. Each index is the card's final position in its target column.",
    "On 'revise', apply nothing: address the feedback and show the board again. On 'dismiss', apply nothing.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(kanbanBoardSchema)`.
 */
export const kanbanBoardTool = {
  name: "show_board",
  description: [
    "Show the user's work items as a board of columns they can reorganize, with any moves you suggest, and wait for them to apply.",
    `Use when: ${kanbanBoardGuidance.useWhen.join(" ")}`,
    `Avoid when: ${kanbanBoardGuidance.avoidWhen.join(" ")}`,
    `Rules: ${kanbanBoardGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: kanbanBoardSchema,
} as const;
