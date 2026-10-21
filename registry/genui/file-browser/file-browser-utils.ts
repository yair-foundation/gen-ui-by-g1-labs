/**
 * File Browser: pure helpers for walking the tree, sorting a folder and
 * formatting sizes and dates. No React, no Zod, so they run anywhere.
 *
 * Nodes are typed loosely because the tree may still be streaming: any field
 * can be missing until the tool call finishes.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale"

export const FILE_KINDS = [
  "doc",
  "sheet",
  "slides",
  "pdf",
  "image",
  "video",
  "archive",
  "other",
] as const

export type FileKind = (typeof FILE_KINDS)[number]

/** A folder or file as it arrives, possibly incomplete. */
export type LooseNode = {
  type?: "folder" | "file"
  id?: string
  name?: string
  children?: (LooseNode | undefined)[]
  kind?: FileKind
  sizeBytes?: number
  modifiedAt?: string
  owner?: string
  url?: string
  shared?: boolean
}

export type ReadyFolder = LooseNode & {
  type: "folder"
  id: string
  name: string
}
export type ReadyFile = LooseNode & { type: "file"; id: string; name: string }
export type ReadyNode = ReadyFolder | ReadyFile

export type SortKey = "name" | "modified" | "size"
export type SortDirection = "asc" | "desc"

/** What the component sends back for each chosen file. */
export type FileRef = { id: string; name: string; kind: FileKind }

export const KIND_LABELS: Record<FileKind, string> = {
  doc: "Document",
  sheet: "Spreadsheet",
  slides: "Presentation",
  pdf: "PDF",
  image: "Image",
  video: "Video",
  archive: "Archive",
  other: "File",
}

/** True once a node has the fields needed to render and act on it. */
export function isReady(node: LooseNode | undefined): node is ReadyNode {
  return (
    !!node &&
    (node.type === "folder" || node.type === "file") &&
    typeof node.id === "string" &&
    typeof node.name === "string"
  )
}

export function isFolder(node: LooseNode | undefined): node is ReadyFolder {
  return isReady(node) && node.type === "folder"
}

export function kindOf(node: LooseNode): FileKind {
  return node.kind && FILE_KINDS.includes(node.kind) ? node.kind : "other"
}

/** The ready children of a folder, in the order the agent sent them. */
export function readyChildren(folder: LooseNode | undefined): ReadyNode[] {
  return (folder?.children ?? []).filter(isReady)
}

/**
 * Folders from the root down to the folder with this id (both included), or
 * null when no such folder exists (yet).
 */
export function findFolderPath(
  root: LooseNode | undefined,
  id: string,
): ReadyFolder[] | null {
  if (!isFolder(root)) return null
  if (root.id === id) return [root]
  for (const child of readyChildren(root)) {
    if (child.type !== "folder") continue
    const path = findFolderPath(child, id)
    if (path) return [root, ...path]
  }
  return null
}

/** Every ready file in the tree, by id. */
export function indexFiles(root: LooseNode | undefined) {
  const files = new Map<string, ReadyFile>()
  const walk = (node: LooseNode) => {
    for (const child of readyChildren(node)) {
      if (child.type === "file") files.set(child.id, child)
      else walk(child)
    }
  }
  if (isFolder(root)) walk(root)
  return files
}

export function toFileRef(file: ReadyFile): FileRef {
  return { id: file.id, name: file.name, kind: kindOf(file) }
}

function time(node: LooseNode): number | null {
  if (!node.modifiedAt) return null
  const t = Date.parse(node.modifiedAt)
  return Number.isNaN(t) ? null : t
}

/** Missing values sort last in either direction. */
function compareMaybe(a: number | null, b: number | null, dir: number) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1
  return (a - b) * dir
}

/**
 * Folders first, always. Folders have no size, so they stay by name when
 * sorting by size; everything ties back to name.
 */
export function sortNodes<T extends ReadyNode>(
  nodes: T[],
  key: SortKey,
  direction: SortDirection,
  locale: string = DEFAULT_LOCALE,
): T[] {
  const dir = direction === "asc" ? 1 : -1
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  })
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1
    const byName = collator.compare(a.name, b.name)
    if (key === "name") return byName * dir
    if (key === "size" && a.type === "folder") return byName
    const primary =
      key === "modified"
        ? compareMaybe(time(a), time(b), dir)
        : compareMaybe(a.sizeBytes ?? null, b.sizeBytes ?? null, dir)
    return primary || byName
  })
}

/** The direction a sort key starts in: names A→Z, newest and largest first. */
export function defaultDirection(key: SortKey): SortDirection {
  return key === "name" ? "asc" : "desc"
}

/** Human-readable size: 1536 → "1.5 KB", 48_300_000 → "46 MB". */
export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return ""
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  // 1023.6 KB rounds to 1024; show it as the next unit instead.
  if (rounded >= 1024 && i < units.length - 1) return `1 ${units[i + 1]}`
  return `${rounded} ${units[i]}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Short modified date: "Just now", "5 minutes ago", "3 hours ago",
 * "Yesterday", "2 days ago" within the week; "Oct 2" this year; "Oct 2, 2025"
 * before that. Future dates (clock skew) read as "Just now".
 */
export function formatModified(
  iso: string | undefined,
  now: Date = new Date(),
  locale: string = DEFAULT_LOCALE,
): string {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  const diff = now.getTime() - date.getTime()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" })
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  if (diff < MINUTE) return "Just now"
  if (diff < HOUR) return cap(rtf.format(-Math.floor(diff / MINUTE), "minute"))
  if (diff < DAY) return cap(rtf.format(-Math.floor(diff / HOUR), "hour"))
  if (diff < 7 * DAY) {
    // Calendar days, so 11 PM yesterday is "Yesterday", not "21 hours ago".
    const startOf = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const days = Math.round((startOf(now) - startOf(date)) / DAY)
    return cap(rtf.format(-Math.max(days, 1), "day"))
  }
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  }).format(date)
}

/** Full date and time, for a tooltip or screen readers. */
export function formatFullDate(
  iso: string | undefined,
  locale: string = DEFAULT_LOCALE,
) {
  if (!iso) return ""
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export function pluralize(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`
}

/** The URL when it is an absolute http(s) link, otherwise null. */
export function safeHttpUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}
