import { z } from "zod"

/**
 * Email Thread: the agent's contract.
 *
 * An email conversation from the user's mailbox, shown so they can read it in
 * context and, optionally, review a reply the agent drafted before anything
 * is sent. Fields marked DATA-BOUND must come from a tool result (the real
 * mailbox), never from model free text.
 */

export const emailContactSchema = z.object({
  name: z.string().describe("DATA-BOUND. Display name, e.g. 'Dana Levi'."),
  email: z.string().describe("DATA-BOUND. Address, e.g. 'dana@acme.example'."),
})

export const emailParticipantSchema = emailContactSchema.extend({
  self: z
    .boolean()
    .optional()
    .describe("True for the mailbox owner. Shown as 'you'."),
})

export const emailAttachmentSchema = z.object({
  name: z.string().describe("DATA-BOUND. File name, e.g. 'MSA-v3.pdf'."),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("DATA-BOUND. Size in bytes."),
  kind: z
    .enum(["pdf", "image", "doc", "sheet", "other"])
    .optional()
    .describe("Sets the icon. Use 'other' when unsure."),
  url: z
    .string()
    .optional()
    .describe("DATA-BOUND. http(s) link to open or download the file."),
})

export const emailMessageSchema = z.object({
  id: z.string().describe("DATA-BOUND. The message id from the mailbox."),
  from: emailContactSchema,
  to: z.array(emailContactSchema),
  cc: z.array(emailContactSchema).optional(),
  sentAt: z
    .string()
    .describe("DATA-BOUND. When it was sent, ISO 8601 with offset."),
  body: z
    .string()
    .describe(
      "DATA-BOUND. The new text of this message, verbatim, as plain text (never HTML). Without the quoted history.",
    ),
  quoted: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. The quoted older text split off the body. Collapsed behind 'Show quoted'.",
    ),
  attachments: z.array(emailAttachmentSchema).optional(),
  unread: z.boolean().optional().describe("DATA-BOUND. Not yet read."),
  important: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. Flagged important in the mailbox."),
})

export const emailDraftSchema = z.object({
  to: z.array(emailContactSchema).min(1),
  cc: z.array(emailContactSchema).optional(),
  body: z
    .string()
    .describe("The reply you wrote, plain text. The user can edit it."),
  replyToId: z.string().describe("Id of the message this replies to."),
})

export const emailThreadSchema = z.object({
  subject: z.string().describe("DATA-BOUND. The thread's subject line."),
  mailbox: z
    .object({ label: z.string().describe("e.g. 'Work inbox'.") })
    .optional()
    .describe(
      "DATA-BOUND. Which mailbox the thread is in. Screen readers only.",
    ),
  participants: z
    .array(emailParticipantSchema)
    .optional()
    .describe(
      "DATA-BOUND. Everyone on the thread. Mark the mailbox owner with self: true.",
    ),
  messages: z
    .array(emailMessageSchema)
    .min(1)
    .max(50)
    .describe("DATA-BOUND. The messages, oldest first."),
  summary: z
    .string()
    .optional()
    .describe(
      "One or two sentences catching the user up. Must reflect only what the messages say.",
    ),
  highlight: z
    .object({
      messageId: z.string(),
      text: z
        .string()
        .describe(
          "The exact sentence that answers the user's question, copied verbatim from that message's body.",
        ),
    })
    .optional()
    .describe("Highlighted inside the message only if it occurs verbatim."),
  draft: emailDraftSchema
    .optional()
    .describe(
      "A reply you drafted. Adds Send, Request changes and Discard. Nothing is sent by the component.",
    ),
  url: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. http(s) link that opens the thread in the mail app.",
    ),
})

export type EmailContact = z.infer<typeof emailContactSchema>
export type EmailParticipant = z.infer<typeof emailParticipantSchema>
export type EmailAttachment = z.infer<typeof emailAttachmentSchema>
export type EmailMessage = z.infer<typeof emailMessageSchema>
export type EmailDraft = z.infer<typeof emailDraftSchema>
export type EmailThreadInput = z.input<typeof emailThreadSchema>

/** What the component sends back, only when there is a draft. A closed set. */
export type EmailThreadResult =
  /** Send exactly this body. `edited` is true when the user changed it. */
  | { action: "send"; body: string; edited: boolean }
  /** The user wants a different draft. Rewrite it and show the thread again. */
  | { action: "revise"; feedback: string }
  /** Drop the draft. Send nothing. */
  | { action: "discard" }

/** Usage guidance the agent reads before choosing this component. */
export const emailThreadGuidance = {
  useWhen: [
    "The user asks about an email conversation: what someone said, where a thread stands, or to catch up on it.",
    "The user asks you to reply to a thread: show it with your draft so they can review and edit it before anything is sent.",
  ],
  avoidWhen: [
    "You couldn't read the thread. Fetch it first; never reconstruct messages from memory.",
    "The user wants a list of many emails (a search or an inbox view). Use a data table.",
    "The user is writing a new email, not replying in a thread. Use a draft component.",
  ],
  rules: [
    "Pass messages verbatim from the mailbox, oldest first, as plain text. Split quoted history into 'quoted'.",
    "Mark the mailbox owner in participants with self: true.",
    "Keep the summary to one or two sentences that only state what the messages say.",
    "Set highlight only to a sentence copied verbatim from that message's body.",
    "Never send until you receive action 'send', then send exactly the returned body.",
    "On 'revise', send nothing: rewrite the draft from the feedback and show the thread again. On 'discard', send nothing.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(emailThreadSchema)`.
 */
export const emailThreadTool = {
  name: "show_email_thread",
  description: [
    "Show an email thread from the user's mailbox, optionally with a reply you drafted for them to review before it is sent.",
    `Use when: ${emailThreadGuidance.useWhen.join(" ")}`,
    `Avoid when: ${emailThreadGuidance.avoidWhen.join(" ")}`,
    `Rules: ${emailThreadGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: emailThreadSchema,
} as const
