"use client"

import * as React from "react"
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Skeleton,
  Surface,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  MosaicImage,
  PhotoMosaicInput,
  PhotoMosaicResult,
} from "./photo-mosaic.schema"
import {
  cleanTags,
  type MosaicCell,
  mosaicLayout,
  photoLabel,
  readyImages,
  safeImageSrc,
  streamingSlots,
  wrapIndex,
} from "./photo-mosaic-utils"

export type PhotoMosaicStatus = "streaming" | "ready"

export type PhotoMosaicProps = Partial<
  Omit<PhotoMosaicInput, "images" | "tags">
> & {
  /** Photos may be partial while the tool call streams. */
  images?: Partial<MosaicImage>[]
  tags?: string[]
  /** Lifecycle, controlled by the host. */
  status?: PhotoMosaicStatus
  /** Called each time a photo is enlarged. Analytics only; never locks. */
  onResult?: (result: PhotoMosaicResult) => void
  className?: string
}

const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
const overlayButton =
  "bg-background/90 shadow-sm dark:shadow-none hover:bg-background dark:bg-background/90 dark:hover:bg-background"

/** A photo, or a neutral tile with its alt text when it can't load. */
function Photo({
  image,
  fit = "cover",
  className,
}: {
  image: MosaicImage
  fit?: "cover" | "contain"
  className?: string
}) {
  const src = safeImageSrc(image.src)
  const [failed, setFailed] = React.useState<string | null>(null)

  if (!src || failed === src) {
    return (
      <span
        className={cn(
          "flex size-full items-center justify-center p-3 text-center",
          className,
        )}
      >
        <span className={cn(genuiType.meta, "line-clamp-4 max-w-sm")}>
          {image.alt}
        </span>
      </span>
    )
  }

  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={image.alt}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(src)}
      className={cn(
        "size-full select-none",
        fit === "cover" ? "object-cover" : "object-contain",
        className,
      )}
    />
  )
}

export function PhotoMosaic({
  title,
  images,
  tags,
  aspect = "wide",
  status: statusProp,
  onResult,
  className,
}: PhotoMosaicProps) {
  const status: PhotoMosaicStatus = statusProp ?? "ready"
  const streaming = status === "streaming"

  const ready = React.useMemo(
    () => readyImages(images, streaming),
    [images, streaming],
  )
  const chips = cleanTags(tags, streaming)
  const count = ready.length
  const slots = streaming ? streamingSlots(count) : Math.max(count, 1)
  const layout = mosaicLayout(slots)
  const label = title ?? "Photos"

  // Photos only append and placeholders sit at fixed positions, so the
  // position is a stable identity.
  const tiles: {
    key: string
    cell: MosaicCell
    image: MosaicImage | undefined
    i: number
  }[] = []
  for (let i = 0; i < layout.cells.length; i++) {
    const image = ready[i] as MosaicImage | undefined
    tiles.push({
      key: `${image ? "photo" : "slot"}-${i}`,
      cell: layout.cells[i],
      image,
      i,
    })
  }

  // ---- Lightbox (native <dialog>: modal focus containment and Escape built in)
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const openerRef = React.useRef<HTMLElement | null>(null)
  const [open, setOpen] = React.useState(false)
  const [index, setIndex] = React.useState(0)
  const [message, setMessage] = React.useState("")
  const current = ready[Math.min(index, count - 1)] as MosaicImage | undefined

  const show = (i: number, opener: HTMLElement) => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open || typeof dialog.showModal !== "function") return
    openerRef.current = opener
    setIndex(i)
    setMessage("")
    dialog.showModal()
    setOpen(true)
    onResult?.({ action: "open", index: i })
  }
  const close = () => dialogRef.current?.close()
  const step = (delta: 1 | -1) => {
    if (count < 2) return
    const next = wrapIndex(index + delta, count)
    setIndex(next)
    setMessage(photoLabel(next, count, ready[next].alt))
  }

  const ratio =
    aspect === "square"
      ? "aspect-square max-w-lg"
      : slots >= 3
        ? // Small tiles need more height on phones.
          "aspect-[4/3] sm:aspect-video"
        : "aspect-video"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        variant="flush"
        data-slot="photo-mosaic"
        data-status={status}
        data-layout={layout.name}
        aria-busy={streaming}
        aria-label={label}
        className={cn("flex flex-col gap-3", className)}
      >
        {title && (
          <h3
            className={cn(
              genuiType.title,
              "text-[16px] font-bold sm:text-[20px]",
            )}
          >
            {title}
          </h3>
        )}

        <ul
          className={cn("grid w-full gap-1.5", ratio)}
          style={{
            gridTemplateColumns: layout.gridTemplateColumns,
            gridTemplateRows: layout.gridTemplateRows,
          }}
        >
          {tiles.map(({ key, cell, image, i }) =>
            image ? (
              <motion.li
                key={key}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
                className="min-h-0 min-w-0"
                style={cell}
              >
                <button
                  type="button"
                  aria-haspopup="dialog"
                  aria-label={photoLabel(i, count, image.alt)}
                  disabled={streaming}
                  onClick={(e) => show(i, e.currentTarget)}
                  className={cn(
                    "group/tile block size-full overflow-hidden rounded-[10px] bg-muted disabled:cursor-default",
                    focusRing,
                    "focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                  )}
                >
                  <Photo
                    image={image}
                    className="transition-transform duration-300 ease-out group-hover/tile:scale-[1.02] group-disabled/tile:scale-100 motion-reduce:transition-none"
                  />
                </button>
              </motion.li>
            ) : (
              <li
                key={key}
                aria-hidden
                className="min-h-0 min-w-0"
                style={cell}
              >
                <Skeleton className="size-full rounded-[10px]" />
              </li>
            ),
          )}
        </ul>

        {chips.length > 0 && (
          <ul aria-label="Tags" className="flex flex-wrap gap-2">
            {chips.map((tag) => (
              <motion.li
                key={tag}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={genuiMotion.fade}
              >
                <Badge variant="info">{tag}</Badge>
              </motion.li>
            ))}
          </ul>
        )}

        {/* Backdrop click is a mouse shortcut; Escape and Close cover keyboards. */}
        <dialog
          ref={dialogRef}
          aria-label={`${label}, enlarged`}
          onClose={() => {
            setOpen(false)
            openerRef.current?.focus()
          }}
          onClick={(e) => {
            // Clicks on the dialog element itself land on the backdrop.
            if (e.target === e.currentTarget) close()
          }}
          onKeyDown={(e) => {
            if (e.altKey || e.ctrlKey || e.metaKey) return
            if (e.key === "ArrowLeft") step(-1)
            else if (e.key === "ArrowRight") step(1)
            else return
            e.preventDefault()
          }}
          className="m-auto max-h-[96dvh] w-[min(96vw,72rem)] max-w-none overflow-hidden rounded-3xl border border-border bg-card p-0 text-card-foreground backdrop:bg-black/80"
        >
          {open && current && (
            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-2 px-3 py-3">
                <p aria-hidden className={cn(genuiType.meta, "tabular-nums")}>
                  {count > 1 ? `${index + 1} / ${count}` : ""}
                </p>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Close"
                        onClick={close}
                        className="hover:bg-muted dark:hover:bg-white/10"
                      />
                    }
                  >
                    <XIcon />
                  </TooltipTrigger>
                  <TooltipContent>Close</TooltipContent>
                </Tooltip>
              </div>
              <div className="relative bg-transparent">
                <div className="aspect-[4/3] max-h-[calc(96dvh-8rem)] w-full">
                  <Photo key={index} image={current} fit="contain" />
                </div>
                {count > 1 && (
                  <>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label="Previous photo"
                            onClick={() => step(-1)}
                            className={cn(
                              "absolute inset-y-0 left-3 my-auto",
                              overlayButton,
                            )}
                          />
                        }
                      >
                        <ChevronLeftIcon />
                      </TooltipTrigger>
                      <TooltipContent>Previous photo</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label="Next photo"
                            onClick={() => step(1)}
                            className={cn(
                              "absolute inset-y-0 right-3 my-auto",
                              overlayButton,
                            )}
                          />
                        }
                      >
                        <ChevronRightIcon />
                      </TooltipTrigger>
                      <TooltipContent>Next photo</TooltipContent>
                    </Tooltip>
                  </>
                )}
              </div>
              {current.caption && (
                <p className={cn(genuiType.body, "px-3 py-3")}>
                  {current.caption}
                </p>
              )}
              <p className="sr-only" aria-live="polite">
                {message}
              </p>
            </div>
          )}
        </dialog>
      </Surface>
    </MotionConfig>
  )
}
