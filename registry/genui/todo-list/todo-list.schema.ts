import { z } from "zod"

import type { TodoChanges, TodoItemData } from "./todo-list-utils"

/**
 * To-do List: the agent's contract.
 *
 * The user's own to-do list (from their tasks app, or one the agent drafted
 * for them), fully editable in the chat. Edits are collected and sent back as
 * one change set when the user saves. Fields marked DATA-BOUND must come from
 * a tool result, never from model free text.
 */

export const todoSubtaskSchema = z.object({
  id: z.string(),
  text: z.string(),
  done: z.boolean(),
})

export const todoItemSchema = z.object({
  id: z
    .string()
    .describe(
      "DATA-BOUND. The task's id in the tasks app. Returned in changes.",
    ),
  text: z.string().describe("The task, e.g. 'Renew car insurance'."),
  done: z.boolean(),
  due: z
    .string()
    .optional()
    .describe(
      "ISO date ('2026-10-09') or date-time ('2026-10-09T15:00', read in timeZone; or with an offset).",
    ),
  priority: z.enum(["high", "medium", "low"]).optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).max(3).optional(),
  subtasks: z.array(todoSubtaskSchema).max(10).optional(),
  assignee: z
    .object({ name: z.string(), initials: z.string().max(3) })
    .optional()
    .describe("Shared lists only. Shown as initials."),
  isNew: z
    .boolean()
    .optional()
    .describe(
      "Not in the tasks app yet: you added it at the user's request. Shown as 'Added' and saved with the other changes.",
    ),
})

export const todoSuggestionSchema = z.object({
  text: z.string().describe("A task you suggest adding."),
  due: z.string().optional().describe("ISO date, like items[].due."),
  tags: z
    .array(z.string())
    .max(3)
    .optional()
    .describe("Tags it would get, so it lands in the right group."),
  reason: z
    .string()
    .optional()
    .describe(
      "One short line on why, e.g. 'UV index is high this weekend'. Tooltip.",
    ),
})

export const todoListSchema = z.object({
  title: z.string().describe("e.g. 'Today' or 'Packing list'."),
  source: z
    .object({
      label: z
        .string()
        .describe("e.g. 'Tasks app'. Names the Save button ('Save to …')."),
    })
    .optional()
    .describe(
      "DATA-BOUND. Where the list lives. Omit for a list you drafted that isn't saved anywhere yet.",
    ),
  items: z
    .array(todoItemSchema)
    .max(100)
    .describe(
      "DATA-BOUND. The list exactly as the tasks app returns it, in its order. For a drafted list, your items.",
    ),
  groupBy: z
    .enum(["none", "due", "priority", "tag"])
    .default("none")
    .describe(
      "'due': Overdue, Today, Tomorrow, This week, Later, No date. 'tag': by each item's first tag. The user can reorder by hand with 'none' and 'priority'.",
    ),
  timeZone: z
    .string()
    .optional()
    .describe(
      "IANA time zone for 'today' and 'overdue', e.g. 'America/New_York'. Defaults to the viewer's.",
    ),
  allowAdd: z.boolean().default(true).describe("Show the 'Add a task' row."),
  allowEdit: z
    .boolean()
    .default(true)
    .describe("Let the user edit, reorder, reschedule and delete items."),
  hideDone: z
    .boolean()
    .default(false)
    .describe(
      "Hide done items. By default they sit in a collapsed 'Done' group at the bottom.",
    ),
  suggestions: z
    .array(todoSuggestionSchema)
    .max(5)
    .optional()
    .describe(
      "Tasks you suggest adding, shown as 'Suggested' rows the user can add or dismiss. Never add them to items.",
    ),
})

export type TodoSubtask = z.infer<typeof todoSubtaskSchema>
export type TodoItem = z.infer<typeof todoItemSchema>
export type TodoSuggestion = z.infer<typeof todoSuggestionSchema>
export type TodoListInput = z.input<typeof todoListSchema>
export type TodoGroupBy = NonNullable<TodoListInput["groupBy"]>

export type { TodoChanges, TodoItemData }

/**
 * Sent back when the user saves or discards. A closed set of actions.
 *
 * `save` carries the smallest change set against the list as loaded (or as
 * last saved): `added` items in full; `updated` fields per item (a cleared
 * field is null); ids `completed`, `reopened` and `deleted`; and `reordered`,
 * the fewest items whose move explains the new order, with `order` (every id,
 * final order) when anything moved.
 */
export type TodoListResult =
  | { action: "save"; changes: TodoChanges }
  | { action: "discard" }

/**
 * The working copy, for saving across reloads (it isn't sent to the agent).
 * `baseline` is the list as last saved, which changes are counted against.
 */
export type TodoListProgress = {
  items: TodoItemData[]
  baseline: TodoItemData[]
  /** Suggestions the user added or dismissed, by text. */
  handledSuggestions?: string[]
}

/** Usage guidance the agent reads before choosing this component. */
export const todoListGuidance = {
  useWhen: [
    "The user asks about their own to-do list: 'what's on my list today?', 'what's overdue?'.",
    "The user asks to add, reschedule or tick off tasks in their tasks app.",
    "The user wants a list they'll keep and edit, e.g. a packing or shopping list.",
  ],
  avoidWhen: [
    "The steps are your instructions for one task (a recipe, a setup guide). Use a Checklist.",
    "The items are things you will do yourself. Show a plan instead.",
    "Work items move between stages on a team board. Use a Kanban Board.",
    "You can't read the user's list. Fetch it first; never invent their tasks.",
  ],
  rules: [
    "Pass items exactly as the tasks app returns them, in order. Never change their text, dates or done state yourself.",
    "To add a task the user asked for, include it in items with isNew: true and a new id. It is saved only when the user saves.",
    "Put your own ideas in suggestions, each with a short reason; never mix them into items.",
    "Use groupBy 'due' for 'today' or 'overdue' questions, 'tag' for categorized lists like packing.",
    "Write nothing to the tasks app until you receive action 'save', then apply exactly the returned changes. On 'discard', write nothing.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(todoListSchema)`.
 */
export const todoListTool = {
  name: "show_todos",
  description: [
    "Show the user's to-do list, editable in the chat; their edits come back as one change set when they save.",
    `Use when: ${todoListGuidance.useWhen.join(" ")}`,
    `Avoid when: ${todoListGuidance.avoidWhen.join(" ")}`,
    `Rules: ${todoListGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: todoListSchema,
} as const
