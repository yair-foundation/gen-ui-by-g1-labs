"use client"

import * as React from "react"
import { CheckIcon, FileIcon, UploadIcon, XIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { AutoHeight } from "@/components/animate-ui/primitives/effects/auto-height"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  type FileUploadInput,
  type FileUploadResult,
  type UploadSlot,
  type UploadedFileMeta,
  describeAccept,
  formatBytes,
  toAcceptAttribute,
  validateUpload,
} from "./file-upload.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type FileUploadStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "submitted"
  | "cancelled"

type PartialSlot = Partial<UploadSlot>
type ReadySlot = PartialSlot & { id: string; label: string }

export type FileUploadProps = Partial<Omit<FileUploadInput, "slots">> & {
  /** Slots may be partial while the tool call is still streaming. */
  slots?: PartialSlot[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host uploads the files.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: FileUploadStatus
  /**
   * Receives the actual files on submit, once per slot, before onResult.
   * File objects can't go to the agent: upload or store them here and hand
   * your tools a reference.
   */
  onFiles?: (slotId: string, files: File[]) => void
  /** Called once with the user's decision (file metadata only). */
  onResult?: (result: FileUploadResult) => void
  /**
   * A decision from history (e.g. the tool call's stored output). Lists the
   * submitted file names, without previews, and never calls onResult.
   */
  result?: FileUploadResult
  className?: string
}

type Entry = {
  key: string
  file: File
  /** Object URL for image previews. Revoked on remove and unmount. */
  url?: string
  width?: number
  height?: number
  checking: boolean
  error: string | null
}

function readImageSize(url: string) {
  return new Promise<{ width: number; height: number } | null>((resolve) => {
    const img = new Image()
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function slotHint(slot: PartialSlot) {
  return [
    slot.accept?.length ? describeAccept(slot.accept) : null,
    slot.aspectRatio,
    slot.maxSizeMB !== undefined ? `Up to ${slot.maxSizeMB} MB` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

function toMeta(slotId: string, e: Entry): UploadedFileMeta {
  return {
    slotId,
    name: e.file.name,
    type: e.file.type,
    size: e.file.size,
    ...(e.width && e.height ? { width: e.width, height: e.height } : {}),
  }
}

function RequiredMark() {
  return (
    <span aria-hidden className="text-muted-foreground">
      {" "}
      *
    </span>
  )
}

export function FileUpload({
  title,
  description,
  slots = [],
  submitLabel,
  status: statusProp,
  onFiles,
  onResult,
  result,
  className,
}: FileUploadProps) {
  const [entries, setEntries] = React.useState<Record<string, Entry[]>>({})
  const [dragging, setDragging] = React.useState<string | null>(null)
  const [attempted, setAttempted] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const [submitted, setSubmitted] = React.useState<UploadedFileMeta[]>(() =>
    result?.action === "submit" ? result.files : [],
  )
  const [decision, setDecision] = React.useState<
    "submitted" | "cancelled" | null
  >(() =>
    result ? (result.action === "submit" ? "submitted" : "cancelled") : null,
  )
  const urls = React.useRef(new Set<string>())
  const inputs = React.useRef(new Map<string, HTMLInputElement>())
  const zones = React.useRef(new Map<string, HTMLButtonElement>())
  const counter = React.useRef(0)
  const mounted = React.useRef(true)
  const baseId = React.useId()
  const titleId = `${baseId}-title`

  // Release every preview when the component goes away.
  React.useEffect(() => {
    mounted.current = true
    const created = urls.current
    return () => {
      mounted.current = false
      for (const url of created) URL.revokeObjectURL(url)
      created.clear()
    }
  }, [])

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: FileUploadStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready" && status !== "streaming"
  const done = status === "submitted" || status === "cancelled"

  const ready = slots.filter(
    (s): s is ReadySlot =>
      typeof s.id === "string" && typeof s.label === "string",
  )
  const listFor = (id: string) => entries[id] ?? []
  const checking = ready.some((s) => listFor(s.id).some((e) => e.checking))

  const slotError = (slot: ReadySlot) => {
    const list = listFor(slot.id)
    if (list.some((e) => e.error)) {
      return "Remove the files that don't meet the requirements."
    }
    if (attempted && slot.required !== false && list.length === 0) {
      return `${slot.label} is required.`
    }
    return null
  }

  const release = (list: Entry[]) => {
    for (const e of list) {
      if (!e.url) continue
      URL.revokeObjectURL(e.url)
      urls.current.delete(e.url)
    }
  }

  const updateEntry = (slotId: string, key: string, patch: Partial<Entry>) =>
    setEntries((prev) => ({
      ...prev,
      [slotId]: (prev[slotId] ?? []).map((e) =>
        e.key === key ? { ...e, ...patch } : e,
      ),
    }))

  const addFiles = (slot: ReadySlot, list: FileList | File[]) => {
    if (locked || !slot.accept?.length) return
    const rules = {
      accept: slot.accept,
      maxSizeMB: slot.maxSizeMB,
      aspectRatio: slot.aspectRatio,
    }
    const existing = listFor(slot.id)
    let files = Array.from(list)
    if (slot.multiple) {
      files = files.filter(
        (f) =>
          !existing.some(
            (e) =>
              e.file.name === f.name &&
              e.file.size === f.size &&
              e.file.lastModified === f.lastModified,
          ),
      )
    } else {
      files = files.slice(0, 1)
    }
    if (files.length === 0) return

    const added: Entry[] = files.map((file) => {
      counter.current += 1
      const key = `${slot.id}-${counter.current}`
      const isImage = file.type.startsWith("image/")
      // Type and size first; the aspect ratio needs the image's dimensions.
      const basic = validateUpload(file, { ...rules, aspectRatio: undefined })
      const url = isImage && !basic ? URL.createObjectURL(file) : undefined
      if (url) urls.current.add(url)
      return {
        key,
        file,
        url,
        checking: Boolean(url),
        error: basic ?? (url ? null : validateUpload(file, rules)),
      }
    })

    // A single-file slot replaces what it held.
    if (!slot.multiple) release(existing)
    setEntries((prev) => ({
      ...prev,
      [slot.id]: slot.multiple ? [...(prev[slot.id] ?? []), ...added] : added,
    }))

    for (const entry of added) {
      if (!entry.url) {
        setAnnouncement(
          entry.error
            ? `${entry.file.name}: ${entry.error}`
            : `${entry.file.name} added to ${slot.label}.`,
        )
        continue
      }
      readImageSize(entry.url).then((size) => {
        if (!mounted.current) return
        // The browser can't decode it (e.g. HEIC): drop the broken preview.
        if (!size) release([entry])
        const { name, type, size: bytes } = entry.file
        const error = validateUpload(
          { name, type, size: bytes, width: size?.width, height: size?.height },
          rules,
        )
        updateEntry(slot.id, entry.key, {
          checking: false,
          ...(size ? {} : { url: undefined }),
          width: size?.width,
          height: size?.height,
          error,
        })
        setAnnouncement(
          error
            ? `${entry.file.name}: ${error}`
            : `${entry.file.name} added to ${slot.label}.`,
        )
      })
    }
  }

  const remove = (slot: ReadySlot, entry: Entry) => {
    release([entry])
    setEntries((prev) => ({
      ...prev,
      [slot.id]: (prev[slot.id] ?? []).filter((e) => e.key !== entry.key),
    }))
    setAnnouncement(`${entry.file.name} removed.`)
    zones.current.get(slot.id)?.focus()
  }

  const submit = () => {
    if (locked || streaming || checking) return
    setAttempted(true)
    const problem = ready.find((s) => {
      const list = listFor(s.id)
      return (
        list.some((e) => e.error) || (s.required !== false && list.length === 0)
      )
    })
    if (problem) {
      zones.current.get(problem.id)?.focus()
      return
    }
    const files: UploadedFileMeta[] = []
    for (const s of ready) {
      const list = listFor(s.id)
      if (list.length)
        onFiles?.(
          s.id,
          list.map((e) => e.file),
        )
      files.push(...list.map((e) => toMeta(s.id, e)))
    }
    setSubmitted(files)
    setDecision("submitted")
    onResult?.({ action: "submit", files })
  }

  const cancel = () => {
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  const header = (
    <SurfaceHeader className="pb-3">
      <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
      {description && <SurfaceDescription>{description}</SurfaceDescription>}
    </SurfaceHeader>
  )

  // Submitted or cancelled: file names only, for the chat history.
  if (done) {
    const fileRowClass = cn(genuiType.body, "flex items-baseline gap-2")
    const bySlot = ready
      .map((s) => ({
        slot: s,
        files: submitted.filter((f) => f.slotId === s.id),
      }))
      .filter((g) => g.files.length > 0)
    const orphans = submitted.filter(
      (f) => !ready.some((s) => s.id === f.slotId),
    )
    return (
      <MotionConfig reducedMotion="user">
        <Surface
          data-slot="file-upload"
          data-status={status}
          aria-labelledby={titleId}
          className={className}
        >
          <SurfaceHeader
            className={cn(
              "flex-row items-start justify-between gap-3",
              status === "submitted" && submitted.length > 0 ? "pb-3" : "pb-3",
            )}
          >
            <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            <p
              aria-live="polite"
              className={cn(
                genuiType.meta,
                "flex shrink-0 items-center gap-1 pt-0.5",
              )}
            >
              {status === "submitted" ? (
                <>
                  <CheckIcon aria-hidden className="size-3.5" />
                  Sent
                  <span className="sr-only">
                    {" "}
                    {submitted.length === 1
                      ? "1 file"
                      : `${submitted.length} files`}
                  </span>
                </>
              ) : (
                <>
                  <XIcon aria-hidden className="size-3.5" />
                  Cancelled
                  <span className="sr-only">. No files were shared.</span>
                </>
              )}
            </p>
          </SurfaceHeader>
          {status === "submitted" && submitted.length > 0 && (
            <motion.dl
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-3 border-t border-border px-3 py-3"
            >
              {[
                ...bySlot.map((g) => ({
                  key: g.slot.id,
                  label: g.slot.label,
                  files: g.files,
                })),
                ...(orphans.length
                  ? [{ key: "_", label: "Files", files: orphans }]
                  : []),
              ].map((g) => (
                <div key={g.key} className="flex flex-col gap-0.5">
                  <dt className={genuiType.label}>{g.label}</dt>
                  {g.files.map((f, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: names can repeat; order is stable
                    <dd key={i} className={fileRowClass}>
                      <span className="min-w-0 font-medium break-all">
                        {f.name}
                      </span>
                      <span
                        className={cn(genuiType.meta, "shrink-0 tabular-nums")}
                      >
                        {formatBytes(f.size)}
                        {f.width && f.height ? ` · ${f.width}×${f.height}` : ""}
                      </span>
                    </dd>
                  ))}
                </div>
              ))}
            </motion.dl>
          )}
        </Surface>
      </MotionConfig>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="file-upload"
        data-status={status}
        aria-busy={streaming || status === "submitting"}
        aria-labelledby={titleId}
        className={className}
      >
        {header}

        <AutoHeight>
          <div className="flex flex-col">
            {ready.map((slot) => {
              const list = listFor(slot.id)
              const error = slotError(slot)
              const hint = slotHint(slot)
              const hintId = `${baseId}-${slot.id}-hint`
              const descId = `${baseId}-${slot.id}-desc`
              const errorId = `${baseId}-${slot.id}-error`
              const canAdd = !locked && Boolean(slot.accept?.length)
              const filled = !slot.multiple && list.length > 0
              const noun = slot.aspectRatio ? "image" : "file"

              return (
                <motion.div
                  key={slot.id}
                  data-slot="file-upload-slot"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className="flex flex-col gap-2 border-t border-border px-3 py-3"
                >
                  <span className={genuiType.label}>
                    {slot.label}
                    {slot.required !== false && <RequiredMark />}
                  </span>
                  {/* Guidance is read with the drop zone, not shown. */}
                  {slot.description && (
                    <span id={descId} className="sr-only">
                      {slot.description}
                    </span>
                  )}

                  <input
                    ref={(el) => {
                      if (el) inputs.current.set(slot.id, el)
                      else inputs.current.delete(slot.id)
                    }}
                    type="file"
                    hidden
                    tabIndex={-1}
                    aria-hidden
                    accept={
                      slot.accept ? toAcceptAttribute(slot.accept) : undefined
                    }
                    multiple={slot.multiple}
                    onChange={(e) => {
                      if (e.target.files) addFiles(slot, e.target.files)
                      // Allow picking the same file again after removing it.
                      e.target.value = ""
                    }}
                  />

                  <button
                    ref={(el) => {
                      if (el) zones.current.set(slot.id, el)
                      else zones.current.delete(slot.id)
                    }}
                    type="button"
                    disabled={!canAdd}
                    data-dragging={dragging === slot.id || undefined}
                    aria-describedby={
                      [
                        slot.description && descId,
                        hint && hintId,
                        error && errorId,
                      ]
                        .filter(Boolean)
                        .join(" ") || undefined
                    }
                    aria-invalid={error ? true : undefined}
                    onClick={() => inputs.current.get(slot.id)?.click()}
                    onDragEnter={(e) => {
                      e.preventDefault()
                      if (canAdd) setDragging(slot.id)
                    }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = canAdd ? "copy" : "none"
                    }}
                    onDragLeave={(e) => {
                      if (
                        !e.currentTarget.contains(
                          e.relatedTarget as Node | null,
                        )
                      ) {
                        setDragging(null)
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDragging(null)
                      if (canAdd) addFiles(slot, e.dataTransfer.files)
                    }}
                    className={cn(
                      "flex w-full flex-col items-center justify-center gap-1 rounded-[10px] border border-dashed bg-transparent px-3 text-center transition-colors outline-none",
                      "hover:bg-accent dark:hover:bg-white/5 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                      "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                      "data-dragging:border-primary data-dragging:bg-accent dark:data-dragging:bg-accent",
                      "aria-invalid:border-destructive",
                      filled ? "py-3" : "py-8",
                    )}
                  >
                    {!filled && (
                      <UploadIcon
                        aria-hidden
                        className="size-5 text-muted-foreground"
                      />
                    )}
                    <span className={genuiType.body}>
                      <span className="sr-only">{slot.label}: </span>
                      {filled
                        ? `Replace ${noun}`
                        : `Drop ${slot.multiple ? `${noun}s` : `a ${noun}`} or `}
                      {!filled && (
                        <span className="underline underline-offset-4">
                          browse
                        </span>
                      )}
                    </span>
                    {hint && (
                      <span id={hintId} className={genuiType.meta}>
                        {hint}
                      </span>
                    )}
                  </button>

                  {list.length > 0 && (
                    <ul className="flex flex-col gap-2">
                      {list.map((entry) => (
                        <motion.li
                          key={entry.key}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={genuiMotion.fade}
                          className="flex items-center gap-3 py-1"
                        >
                          <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-transparent">
                            {entry.url ? (
                              // biome-ignore lint/performance/noImgElement: local object-URL preview; next/image can't optimize it
                              <img
                                src={entry.url}
                                alt=""
                                className="size-full object-contain"
                              />
                            ) : (
                              <FileIcon
                                aria-hidden
                                className="size-5 text-muted-foreground"
                              />
                            )}
                          </span>
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span
                              className={cn(
                                genuiType.body,
                                "font-medium break-all",
                              )}
                            >
                              {entry.file.name}
                            </span>
                            <span
                              className={cn(genuiType.meta, "tabular-nums")}
                            >
                              {formatBytes(entry.file.size)}
                              {entry.width && entry.height
                                ? ` · ${entry.width}×${entry.height}`
                                : ""}
                              {entry.checking ? " · Checking…" : ""}
                            </span>
                            {entry.error && (
                              <span className="text-[13px] text-destructive">
                                {entry.error}
                              </span>
                            )}
                          </div>
                          <WhyDisabled when={locked} reason="Already sent">
                            <IconTip
                              label={`Remove ${entry.file.name} from ${slot.label}`}
                            >
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                aria-label={`Remove ${entry.file.name} from ${slot.label}`}
                                disabled={locked}
                                onClick={() => remove(slot, entry)}
                              >
                                <XIcon />
                              </Button>
                            </IconTip>
                          </WhyDisabled>
                        </motion.li>
                      ))}
                    </ul>
                  )}

                  {error && (
                    <p id={errorId} className="text-[13px] text-destructive">
                      {error}
                    </p>
                  )}
                </motion.div>
              )
            })}

            {streaming && (
              <div
                aria-hidden
                className="flex flex-col gap-2 border-t border-border px-3 py-3"
              >
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-28 w-full rounded-[10px]" />
              </div>
            )}
          </div>
        </AutoHeight>

        {/* Announces files added, rejected and removed. */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>

        <SurfaceFooter className="justify-between gap-3">
          <p aria-live="polite" className={genuiType.meta}>
            {streaming ? (
              <ShimmeringText
                text="Preparing upload…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
              />
            ) : status === "submitting" ? (
              "Uploading…"
            ) : checking ? (
              "Checking files…"
            ) : null}
          </p>
          <div className="ml-auto flex gap-2">
            <WhyDisabled when={locked} reason="Already sent">
              <Button
                size="sm"
                variant="secondary"
                onClick={cancel}
                disabled={locked}
              >
                Cancel
              </Button>
            </WhyDisabled>
            <WhyDisabled
              when={locked || streaming || checking}
              reason="Not ready yet"
            >
              <Button
                size="sm"
                onClick={submit}
                disabled={locked || streaming || checking}
              >
                {status === "submitting"
                  ? "Uploading…"
                  : (submitLabel ?? "Submit")}
              </Button>
            </WhyDisabled>
          </div>
        </SurfaceFooter>
      </Surface>
    </MotionConfig>
  )
}
