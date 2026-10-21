import { z } from "zod"

import { FILE_KINDS, type FileRef } from "./file-browser-utils"

/**
 * File Browser: the agent's contract.
 *
 * Files the agent found, or a folder it opened, in the user's storage (a
 * shared drive, a document library, a company wiki). The user navigates the
 * folders and picks files. Fields marked DATA-BOUND must come from a tool
 * result, never from model free text.
 */

export const fileNodeSchema = z.object({
  type: z.literal("file"),
  id: z
    .string()
    .describe("DATA-BOUND. The file's real id. Returned in the result."),
  name: z.string().describe("DATA-BOUND. The file name as stored."),
  kind: z
    .enum(FILE_KINDS)
    .describe("DATA-BOUND. Sets the icon. Use 'other' when unsure."),
  sizeBytes: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("DATA-BOUND. Size in bytes."),
  modifiedAt: z
    .string()
    .describe(
      "DATA-BOUND. Last modified, ISO 8601, e.g. '2026-10-02T14:30:00Z'.",
    ),
  owner: z.string().optional().describe("DATA-BOUND. Owner's display name."),
  url: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. http(s) link that opens the file. Others are dropped.",
    ),
  shared: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. Shared with other people."),
})

export type FileNode = z.infer<typeof fileNodeSchema>

export const folderNodeSchema = z.object({
  type: z.literal("folder"),
  id: z.string().describe("DATA-BOUND. The folder's real id."),
  name: z.string().describe("DATA-BOUND. The folder name as stored."),
  get children(): z.ZodArray<
    z.ZodDiscriminatedUnion<[typeof folderNodeSchema, typeof fileNodeSchema]>
  > {
    return z
      .array(z.discriminatedUnion("type", [folderNodeSchema, fileNodeSchema]))
      .max(200)
      .describe(
        "DATA-BOUND. Subfolders and files, as listed by your tool. An empty array is an empty folder.",
      )
  },
})

export type FolderNode = z.infer<typeof folderNodeSchema>

export const fileBrowserSchema = z.object({
  title: z
    .string()
    .optional()
    .describe("What the user is doing, e.g. 'Attach the Q3 board deck'."),
  source: z
    .object({
      label: z
        .string()
        .describe(
          "DATA-BOUND. Where the files live, e.g. 'Acme shared drive'.",
        ),
    })
    .optional(),
  root: folderNodeSchema.describe(
    "DATA-BOUND. The folder tree from your tool result, starting at the folder you opened. Never invent files or folders.",
  ),
  startFolderId: z
    .string()
    .optional()
    .describe(
      "Open this folder first, e.g. the one holding the likely match. The path above it stays navigable. Default: root.",
    ),
  selection: z
    .enum(["none", "single", "multiple"])
    .default("multiple")
    .describe(
      "'multiple' to pick several files, 'single' for one, 'none' to browse with Open links only.",
    ),
  max: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Most files allowed when selection is 'multiple'."),
  submitLabel: z
    .string()
    .optional()
    .describe(
      "Verb for the confirm button, e.g. 'Attach'. The count is added: 'Attach 2 files'.",
    ),
})

export type FileBrowserInput = z.input<typeof fileBrowserSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type FileBrowserResult =
  | {
      action: "select"
      /** The chosen files, in the order the user picked them. */
      files: FileRef[]
    }
  /** The user closed the browser. Ask in text what they want instead. */
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const fileBrowserGuidance = {
  useWhen: [
    "The user needs to find and pick files in their storage: attach a deck, choose contracts to summarize.",
    "You listed a folder or searched and found several candidates in different folders.",
    "The user wants to look around a folder you opened, with links to open each file.",
  ],
  avoidWhen: [
    "Only one file matches. Use it and say which one.",
    "The items are not files, e.g. accounts or people. Use the entity picker.",
    "The user wants to upload files from their device. Use the file upload.",
    "You have not listed the folder yet. List it first; never describe files from memory.",
  ],
  rules: [
    "Every folder and file must come from a tool result, with its real id, name and modified date.",
    "Send only the part of the tree around the task; keep nesting to a few levels.",
    "Set startFolderId to the folder with the likely match so the user starts there.",
    "Use selection 'single' when the next step takes one file, and max when it takes a few.",
    "Only include url when your tool returned one.",
    "Act only on the files returned with action 'select'.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(fileBrowserSchema)`.
 */
export const fileBrowserTool = {
  name: "browse_files",
  description: [
    "Show the user a folder of their files to navigate and pick from, and wait for their choice.",
    `Use when: ${fileBrowserGuidance.useWhen.join(" ")}`,
    `Avoid when: ${fileBrowserGuidance.avoidWhen.join(" ")}`,
    `Rules: ${fileBrowserGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: fileBrowserSchema,
} as const
