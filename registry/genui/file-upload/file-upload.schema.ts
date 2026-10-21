import { z } from "zod"

/**
 * File Upload: the agent's contract.
 *
 * Asks the user for files that meet stated rules (type, size, aspect ratio),
 * e.g. ad creatives in Story 9:16 and Feed 1:1. The files stay with the host;
 * the agent receives their metadata.
 */

const ratioPattern = /^\s*(\d+(?:\.\d+)?)\s*[:/x]\s*(\d+(?:\.\d+)?)\s*$/

export const uploadSlotSchema = z.object({
  id: z.string().describe("Stable identifier. Returned with each file."),
  label: z.string().describe("What the file is, e.g. 'Story image'."),
  description: z
    .string()
    .optional()
    .describe(
      "What to upload, e.g. 'Product on a plain background'. Screen readers only.",
    ),
  accept: z
    .array(z.string())
    .min(1)
    .describe(
      "Allowed types: MIME types ('image/png', 'image/*') or extensions ('.pdf').",
    ),
  maxSizeMB: z
    .number()
    .positive()
    .optional()
    .describe("Largest file allowed, in MB."),
  aspectRatio: z
    .string()
    .regex(ratioPattern)
    .optional()
    .describe(
      "Required image shape as width:height, e.g. '9:16' or '1:1'. ±2% is accepted.",
    ),
  required: z.boolean().default(true),
  multiple: z.boolean().default(false).describe("Accept more than one file."),
})

export const fileUploadSchema = z.object({
  title: z
    .string()
    .describe("What you're asking for, e.g. 'Upload ad creatives'."),
  description: z.string().optional(),
  slots: z.array(uploadSlotSchema).min(1).max(6),
  submitLabel: z
    .string()
    .optional()
    .describe("Verb for the submit button, e.g. 'Use these images'."),
})

export type UploadSlot = z.input<typeof uploadSlotSchema>
export type FileUploadInput = z.input<typeof fileUploadSchema>

/** What the agent learns about each file. The file itself goes to the host. */
export type UploadedFileMeta = {
  slotId: string
  name: string
  /** MIME type as reported by the browser; may be empty. */
  type: string
  /** Bytes. */
  size: number
  /** Pixels, for images. */
  width?: number
  height?: number
}

/** What the component sends back to the agent. A closed set of actions. */
export type FileUploadResult =
  | { action: "submit"; files: UploadedFileMeta[] }
  /** The user closed the request. Ask in text how they want to proceed. */
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const fileUploadGuidance = {
  useWhen: [
    "You need files from the user to continue: ad creatives, a receipt, a profile photo, a document to review.",
    "The files have rules you can state up front: type, size or image shape.",
  ],
  avoidWhen: [
    "The file is already available to you in a connected system. Fetch it instead.",
    "You only need a link or a short piece of text. Ask in text.",
  ],
  rules: [
    "Use one slot per distinct file, with the platform's real requirements (e.g. Story 9:16, Feed 1:1).",
    "State accept, maxSizeMB and aspectRatio rather than describing them in prose.",
    "Never ask for identity documents, payment cards or other sensitive files.",
    "You receive file metadata only; the host passes the files to your tools. Don't claim to have seen file contents.",
  ],
} as const

/** Default tolerance for aspect ratios: ±2%. */
export const ASPECT_TOLERANCE = 0.02

/** '9:16' → 0.5625. Also accepts '9/16' and '9x16'. Null when invalid. */
export function parseAspectRatio(ratio: string): number | null {
  const m = ratioPattern.exec(ratio)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  return w > 0 && h > 0 ? w / h : null
}

/** True when width×height is within the tolerance of the ratio. */
export function matchesAspectRatio(
  width: number,
  height: number,
  ratio: string,
  tolerance = ASPECT_TOLERANCE,
): boolean {
  const target = parseAspectRatio(ratio)
  if (target === null) return true
  if (!(width > 0 && height > 0)) return false
  return Math.abs(width / height - target) / target <= tolerance
}

const aliases: Record<string, string[]> = {
  jpg: ["jpeg", "jpe"],
  jpeg: ["jpg", "jpe"],
  tif: ["tiff"],
  tiff: ["tif"],
}

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/**
 * True when the file matches any accept entry: an exact MIME type, a
 * wildcard like 'image/*', or an extension ('.pdf' or 'pdf').
 */
export function matchesAccept(
  file: { name: string; type: string },
  accept: string[],
): boolean {
  if (accept.length === 0) return true
  const type = file.type.toLowerCase()
  const ext = extensionOf(file.name)
  return accept.some((raw) => {
    const entry = raw.trim().toLowerCase()
    if (entry === "*" || entry === "*/*") return true
    if (entry.includes("/")) {
      if (entry.endsWith("/*")) return type.startsWith(entry.slice(0, -1))
      return type === entry
    }
    const want = entry.replace(/^\./, "")
    return ext === want || (aliases[want]?.includes(ext) ?? false)
  })
}

/** The `accept` attribute for a file input. */
export function toAcceptAttribute(accept: string[]): string {
  return accept
    .map((a) => {
      const entry = a.trim()
      return entry.includes("/") || entry.startsWith(".") ? entry : `.${entry}`
    })
    .join(",")
}

/** 'image/png', '.pdf', 'image/*' → 'PNG, PDF, image'. For hints and errors. */
export function describeAccept(accept: string[]): string {
  const names = accept.map((a) => {
    const entry = a.trim().toLowerCase()
    if (entry.endsWith("/*")) return entry.slice(0, -2)
    const part = entry.includes("/")
      ? entry.split("/")[1]
      : entry.replace(/^\./, "")
    if (part === "jpeg") return "JPG"
    if (part === "svg+xml") return "SVG"
    return part.length <= 5 ? part.toUpperCase() : part
  })
  return [...new Set(names)].join(", ")
}

/** Human-readable size: 1536 → '1.5 KB'. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ["KB", "MB", "GB"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[i]}`
}

/**
 * Checks a file against a slot's rules. Returns an error message, or null when
 * it passes. Pass width and height for images when the slot has an aspect
 * ratio; without them an aspect-ratio slot fails.
 */
export function validateUpload(
  file: {
    name: string
    type: string
    size: number
    width?: number
    height?: number
  },
  rules: Pick<UploadSlot, "accept" | "maxSizeMB" | "aspectRatio">,
): string | null {
  if (!matchesAccept(file, rules.accept)) {
    return `This file type isn't accepted. Use ${describeAccept(rules.accept)}.`
  }
  if (
    rules.maxSizeMB !== undefined &&
    file.size > rules.maxSizeMB * 1024 * 1024
  ) {
    return `This file is ${formatBytes(file.size)}. The limit is ${rules.maxSizeMB} MB.`
  }
  if (rules.aspectRatio && parseAspectRatio(rules.aspectRatio) !== null) {
    const { width, height } = file
    if (!width || !height) {
      return `Couldn't read the image size. Use an image in ${rules.aspectRatio}.`
    }
    if (!matchesAspectRatio(width, height, rules.aspectRatio)) {
      const target = parseAspectRatio(rules.aspectRatio) ?? 1
      const example = `${width}×${Math.round(width / target)}`
      return `This image is ${width}×${height}. It needs to be ${rules.aspectRatio}, e.g. ${example}.`
    }
  }
  return null
}

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(fileUploadSchema)`.
 */
export const fileUploadTool = {
  name: "request_files",
  description: [
    "Ask the user to upload files that meet stated rules, and wait for them.",
    `Use when: ${fileUploadGuidance.useWhen.join(" ")}`,
    `Avoid when: ${fileUploadGuidance.avoidWhen.join(" ")}`,
    `Rules: ${fileUploadGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: fileUploadSchema,
} as const
