import { z } from "zod"

/**
 * Artifact Preview: the agent's contract.
 *
 * A file the agent generated or found, previewed in place, with download,
 * and open. Fields marked DATA-BOUND must come from a tool result (the
 * real file), never from model free text.
 */

export const artifactKindSchema = z.enum([
  "pdf",
  "image",
  "code",
  "text",
  "csv",
  "json",
  "markdown",
  "other",
])

export const artifactActionSchema = z.enum(["download", "open"])

export const artifactPreviewSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe("File name with extension, e.g. 'q3-deals.csv'."),
  kind: artifactKindSchema.describe(
    "Picks the preview: the browser's PDF viewer, an image, numbered code or text, a CSV table, a JSON tree, rendered Markdown, or a plain placeholder.",
  ),
  src: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. Where the file lives: an http(s) or blob: URL, or a data: URL whose MIME type matches the kind. Needed for pdf and image previews, Open, and downloads of files without inline content.",
    ),
  content: z
    .string()
    .max(200_000)
    .optional()
    .describe(
      "DATA-BOUND. The full text, inline, for code, text, csv, json and markdown (up to 200 KB). Enables the preview and Download.",
    ),
  language: z
    .string()
    .max(24)
    .optional()
    .describe("For code: the language, shown as a label, e.g. 'SQL'."),
  sizeBytes: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("DATA-BOUND. File size. Computed from content when omitted."),
  pages: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("DATA-BOUND. For pdf: the page count."),
  version: z
    .string()
    .max(16)
    .optional()
    .describe("e.g. '2' (shown as v2) or 'Draft'."),
  summary: z
    .string()
    .max(160)
    .optional()
    .describe(
      "One line on what the file is or what changed. Screen readers only; also the image's alt text.",
    ),
  actions: z
    .array(artifactActionSchema)
    .max(2)
    .optional()
    .describe(
      "Footer actions. Default: download for text kinds, open and download otherwise. Actions that can't work (e.g. open without a URL) are hidden.",
    ),
})

export type ArtifactKind = z.infer<typeof artifactKindSchema>
export type ArtifactAction = z.infer<typeof artifactActionSchema>
export type ArtifactPreviewInput = z.input<typeof artifactPreviewSchema>

/**
 * Sent when the user downloads, opens or copies the file. For analytics: the preview
 * never locks.
 */
export type ArtifactPreviewResult = {
  /** "copy" when the user copies a text file's content (always offered, not an agent action). */
  action: ArtifactAction | "copy"
}

/** Usage guidance the agent reads before choosing this component. */
export const artifactPreviewGuidance = {
  useWhen: [
    "You generated or found a file the user will inspect, keep or share: a PDF, an image, a script, a CSV export, a JSON response, a Markdown doc.",
    "The user asked to export or download something.",
  ],
  avoidWhen: [
    "A short snippet answers the question. Put it in a code block in your reply.",
    "The data is for reading in the chat, not a file. Use a data table or an article.",
    "You don't have the file's real content or URL. Never invent either.",
  ],
  rules: [
    "src and content must come from a tool result; never write a file's content from memory as if it were the real file.",
    "Send the whole content; the preview shows every line and row it can.",
    "Use the kind that matches the file: csv for comma-separated data, json for JSON, code for source files with language set.",
    "Keep summary to one line; don't repeat the file name.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(artifactPreviewSchema)`.
 */
export const artifactPreviewTool = {
  name: "show_artifact",
  description: [
    "Show a file you generated or found with a preview (PDF, image, code, text, CSV table, JSON tree, Markdown) and download and open actions.",
    `Use when: ${artifactPreviewGuidance.useWhen.join(" ")}`,
    `Avoid when: ${artifactPreviewGuidance.avoidWhen.join(" ")}`,
    `Rules: ${artifactPreviewGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: artifactPreviewSchema,
} as const
