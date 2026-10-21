"use client"

import * as React from "react"
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageOffIcon,
  Maximize2Icon,
  PauseIcon,
  PlayIcon,
  XIcon,
} from "lucide-react"
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"
import { CheckMark } from "@/components/genui/genui-motion"

import type {
  DeckSlide,
  ImageSlide,
  Slide,
  SlideGalleryInput,
  SlideGalleryResult,
} from "./slide-gallery.schema"
import {
  aspectRatio,
  clampIndex,
  counterText,
  defaultAspect,
  type InlineNode,
  isSelectionFull,
  neighborIndices,
  orderSelection,
  type PartialSlide,
  parseInline,
  readySlides,
  safeImageSrc,
  selectionSummary,
  slideAnnouncement,
  slideLabel,
  slidePosition,
  swipeDirection,
  toggleSelection,
  wrapIndex,
} from "./slide-gallery-utils"
import { IconTip, WhyDisabled } from "@/components/genui/hint"

export type SlideGalleryStatus =
  | "streaming"
  | "ready"
  | "selected"
  | "dismissed"

export type SlideGalleryProps = Partial<Omit<SlideGalleryInput, "slides">> & {
  /** Slides may be partial while the tool call streams. */
  slides?: PartialSlide[]
  /** Lifecycle, controlled by the host. */
  status?: SlideGalleryStatus
  /** Called once with the user's pick (only with `selection`). */
  onResult?: (result: SlideGalleryResult) => void
  /** A decision from history. Restores the pick read-only; never calls onResult. */
  result?: SlideGalleryResult
  className?: string
}

const AUTOPLAY_MS = 5000
const focusRing = "outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
/** Overlaid controls: shown on hover or focus, always on touch screens. */
const reveal =
  "opacity-0 transition-opacity group-hover/stage:opacity-100 group-focus-within/stage:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
const overlayButton =
  "bg-background/90 shadow-sm dark:shadow-none hover:bg-background dark:bg-background/90 dark:hover:bg-background"

/** Stable keys without using the map index (lists here never reorder). */
function keyed<T>(items: readonly T[], prefix: string) {
  const out: { key: string; value: T }[] = []
  for (let i = 0; i < items.length; i++) {
    out.push({ key: `${prefix}${i}`, value: items[i] })
  }
  return out
}

// ---- Content ---------------------------------------------------------------

function Inline({ nodes }: { nodes: InlineNode[] }) {
  return keyed(nodes, "n").map(({ key, value: n }) => {
    switch (n.type) {
      case "text":
        return <React.Fragment key={key}>{n.value}</React.Fragment>
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            <Inline nodes={n.children} />
          </strong>
        )
      case "em":
        return (
          <em key={key}>
            <Inline nodes={n.children} />
          </em>
        )
      case "code":
        return (
          <code
            key={key}
            className="rounded border border-border bg-transparent px-1 py-0.5 font-mono text-[13px]"
          >
            {n.value}
          </code>
        )
      default:
        return (
          <a
            key={key}
            href={n.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={cn(
              "rounded-sm underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground",
              focusRing,
            )}
          >
            <Inline nodes={n.children} />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )
    }
  })
}

function SlideImage({
  slide,
  thumb,
  cover,
}: {
  slide: ImageSlide
  thumb?: boolean
  /** Fill the stage and crop, instead of fitting the whole image. */
  cover?: boolean
}) {
  const src = safeImageSrc(slide.src)
  const [failed, setFailed] = React.useState<string | null>(null)

  if (!src || failed === src) {
    if (thumb) {
      return (
        <span className="flex size-full items-center justify-center bg-muted text-muted-foreground">
          <ImageOffIcon aria-hidden className="size-4" />
        </span>
      )
    }
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1.5 bg-transparent p-6 text-center">
        <ImageOffIcon aria-hidden className="size-5 text-muted-foreground" />
        <p className={cn(genuiType.body, "font-medium")}>Image unavailable</p>
        <p className="max-w-sm text-[13px] text-muted-foreground">
          {slide.alt}
        </p>
      </div>
    )
  }

  return (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={src}
      alt={thumb ? "" : slide.alt}
      loading={thumb ? "lazy" : "eager"}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(src)}
      className={cn(
        "size-full select-none",
        thumb || cover ? "object-cover" : "object-contain",
      )}
    />
  )
}

/** A neutral presentation slide. Type scales with the stage width (cqw). */
function DeckSlideView({ slide }: { slide: DeckSlide }) {
  const hasBody = Boolean(slide.stat || slide.bullets?.length)
  return (
    <div className="flex size-full flex-col justify-center gap-[3cqw] overflow-hidden bg-background p-[7cqw] text-left">
      <div className="flex flex-col gap-[1cqw]">
        <h4
          className={cn(
            "leading-tight font-semibold tracking-tight text-balance",
            hasBody
              ? "text-[length:clamp(0.9rem,4.2cqw,2.6rem)]"
              : "text-[length:clamp(1.25rem,6.5cqw,4rem)]",
          )}
        >
          {slide.title}
        </h4>
        {slide.subtitle && (
          <p className="text-[length:clamp(0.7rem,2.6cqw,1.6rem)] text-muted-foreground">
            {slide.subtitle}
          </p>
        )}
      </div>
      {slide.stat && (
        <div className="flex flex-wrap items-baseline gap-x-[2cqw] gap-y-[0.5cqw]">
          <p className="font-figure text-[length:clamp(2rem,13cqw,8rem)] leading-none font-normal tracking-tight tabular-nums">
            {slide.stat.value}
          </p>
          <p className="text-[length:clamp(0.7rem,2.6cqw,1.6rem)] text-muted-foreground">
            {slide.stat.label}
          </p>
        </div>
      )}
      {slide.bullets && slide.bullets.length > 0 && (
        <ul className="flex list-disc flex-col gap-[1cqw] pl-[1.2em] text-[length:clamp(0.625rem,2.4cqw,1.5rem)] leading-snug marker:text-muted-foreground">
          {keyed(slide.bullets, "b").map(({ key, value }) => (
            <li key={key}>{value}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DeckThumb({ slide }: { slide: DeckSlide }) {
  return (
    <span className="flex size-full flex-col justify-center gap-1 bg-background p-1.5 text-left">
      <span className="line-clamp-2 text-[8px] leading-tight font-semibold">
        {slide.title}
      </span>
      {slide.stat ? (
        <span className="text-[10px] leading-none font-semibold tabular-nums">
          {slide.stat.value}
        </span>
      ) : (
        keyed(slide.bullets?.slice(0, 3) ?? [], "t").map(({ key }) => (
          <span
            key={key}
            className="block h-0.5 w-3/4 rounded-full bg-muted-foreground/30"
          />
        ))
      )}
    </span>
  )
}

function Caption({
  slide,
  notesOpen,
  onNotesToggle,
}: {
  slide: Slide
  notesOpen: boolean
  onNotesToggle: (open: boolean) => void
}) {
  if (slide.type === "image") {
    if (!slide.caption && !slide.credit) return null
    return (
      <div className="flex flex-col gap-0.5 border-t border-border px-3 py-3">
        {slide.caption && (
          <p className={genuiType.body}>
            <Inline nodes={parseInline(slide.caption)} />
          </p>
        )}
        {slide.credit && <p className={genuiType.meta}>{slide.credit}</p>}
      </div>
    )
  }
  if (!slide.notes) return null
  // Collapsed by default, like a deck tool; stays open across slides.
  return (
    <details
      open={notesOpen}
      onToggle={(e) => onNotesToggle(e.currentTarget.open)}
      className="group/notes border-t border-border px-3 py-3"
    >
      <summary
        className={cn(
          "inline-flex min-h-6 cursor-pointer list-none items-center gap-1 rounded-sm text-[13px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <ChevronRightIcon
          aria-hidden
          className="size-4 text-muted-foreground transition-transform group-open/notes:rotate-90 motion-reduce:transition-none"
        />
        Speaker notes
      </summary>
      <p className={cn(genuiType.body, "mt-1.5 whitespace-pre-line")}>
        {slide.notes}
      </p>
    </details>
  )
}

// ---- Stage -----------------------------------------------------------------

const slideVariants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 24 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir * -24 }),
}

type StageSelection = {
  selected: boolean
  disabled: boolean
  onToggle: () => void
}

function Stage({
  slides,
  index,
  direction,
  streaming,
  ratio,
  maxHeight,
  fill,
  regionRef,
  selection,
  onStep,
  onJump,
}: {
  slides: Slide[]
  index: number
  direction: number
  streaming: boolean
  ratio: number
  /** CSS length capping the stage height; the width follows the ratio. */
  maxHeight: string
  /** Span the full width and crop photos to the stage, edge to edge. */
  fill?: boolean
  regionRef?: React.Ref<HTMLElement>
  selection: StageSelection | null
  onStep: (delta: 1 | -1) => void
  onJump: (index: number) => void
}) {
  const reduced = useReducedMotion()
  const swipe = React.useRef<{ x: number; y: number; id: number } | null>(null)
  const count = slides.length
  const slide = slides[index] as Slide | undefined
  const label = slide ? slideLabel(slide) : ""

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.altKey || e.ctrlKey || e.metaKey || count === 0) return
    if (e.key === "ArrowLeft") onStep(-1)
    else if (e.key === "ArrowRight") onStep(1)
    else if (e.key === "Home") onJump(0)
    else if (e.key === "End") onJump(count - 1)
    else return
    e.preventDefault()
  }

  return (
    <section
      ref={regionRef}
      aria-roledescription="carousel"
      aria-label="Slides"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the WAI carousel region takes focus for arrow-key navigation
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        "group/stage relative bg-muted focus-visible:ring-inset",
        focusRing,
      )}
    >
      {/* Swipe surface. pan-y keeps vertical page scrolling on touch. */}
      <div
        className={cn("relative overflow-hidden", !fill && "mx-auto")}
        style={{
          aspectRatio: ratio,
          width: fill ? "100%" : `min(100%, calc(${maxHeight} * ${ratio}))`,
          maxHeight: fill ? maxHeight : undefined,
          touchAction: "pan-y",
        }}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse") return
          swipe.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
        }}
        onPointerUp={(e) => {
          const start = swipe.current
          swipe.current = null
          if (!start || start.id !== e.pointerId) return
          const dir = swipeDirection(e.clientX - start.x, e.clientY - start.y)
          if (dir !== 0) onStep(dir)
        }}
        onPointerCancel={() => {
          swipe.current = null
        }}
      >
        {slide ? (
          <AnimatePresence initial={false} custom={direction}>
            <motion.div
              key={slide.id}
              role="group"
              aria-roledescription="slide"
              aria-label={slidePosition(index, count, streaming)}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: reduced ? 0 : 0.25, ease: "easeOut" }}
              className="@container absolute inset-0"
            >
              {slide.type === "image" ? (
                <SlideImage slide={slide} cover={fill} />
              ) : (
                <DeckSlideView slide={slide} />
              )}
            </motion.div>
          </AnimatePresence>
        ) : streaming ? (
          <Skeleton className="absolute inset-0 rounded-none" />
        ) : (
          <p
            className={cn(
              genuiType.body,
              "absolute inset-0 flex items-center justify-center text-muted-foreground",
            )}
          >
            No slides
          </p>
        )}
      </div>

      {count > 1 && (
        <>
          <IconTip label="Previous slide">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Previous slide"
              disabled={streaming && index === 0}
              onClick={() => onStep(-1)}
              className={cn(
                "absolute inset-y-0 left-3 my-auto",
                overlayButton,
                reveal,
              )}
            >
              <ChevronLeftIcon />
            </Button>
          </IconTip>
          <IconTip label="Next slide">
            <Button
              size="icon-sm"
              variant="outline"
              aria-label="Next slide"
              disabled={streaming && index === count - 1}
              onClick={() => onStep(1)}
              className={cn(
                "absolute inset-y-0 right-3 my-auto",
                overlayButton,
                reveal,
              )}
            >
              <ChevronRightIcon />
            </Button>
          </IconTip>
        </>
      )}

      {slide && selection && (
        <Button
          size="sm"
          variant="outline"
          aria-pressed={selection.selected}
          aria-label={`Select ${label}`}
          disabled={selection.disabled}
          onClick={selection.onToggle}
          className={cn(
            "absolute top-3 right-3",
            overlayButton,
            selection.selected && "ring-2 ring-choice ring-inset",
          )}
        >
          {/* Constant text so the visible label stays in the accessible name;
              aria-pressed and the check carry the state. */}
          {selection.selected && <CheckMark className="size-3.5 text-choice" />}
          Select
        </Button>
      )}

      {slide && (
        // The slide's "3 of 12" label carries this for assistive tech.
        <span
          aria-hidden
          className="absolute right-3 bottom-3 rounded-full bg-background/90 px-2.5 py-1 text-[13px] tabular-nums"
        >
          {counterText(index, count, streaming)}
        </span>
      )}
    </section>
  )
}

// ---- Gallery ---------------------------------------------------------------

export function SlideGallery({
  title,
  slides,
  aspect,
  startIndex,
  selection = "none",
  max,
  autoplay = false,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: SlideGalleryProps) {
  const reduced = useReducedMotion()
  const [decision, setDecision] = React.useState<
    "selected" | "dismissed" | null
  >(() =>
    result ? (result.action === "select" ? "selected" : "dismissed") : null,
  )
  const [picked, setPicked] = React.useState<string[]>(() =>
    result?.action === "select" ? result.slideIds : [],
  )

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: SlideGalleryStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  const ready = React.useMemo(
    () => readySlides(slides, streaming),
    [slides, streaming],
  )
  const count = ready.length

  // Navigation: null until the user moves, so a late `startIndex` still applies.
  const [nav, setNav] = React.useState<{ index: number; dir: number } | null>(
    null,
  )
  const index = clampIndex(nav ? nav.index : (startIndex ?? 0), count)
  const direction = nav?.dir ?? 0
  const slide = ready[index] as Slide | undefined
  const [message, setMessage] = React.useState("")
  const [notesOpen, setNotesOpen] = React.useState(false)

  const ratio = aspectRatio(aspect ?? defaultAspect(slides?.[0]))
  const label = title ?? "Slides"

  const go = (target: number, dir: number, announce = true) => {
    if (count === 0) return
    // Wrap around once everything has arrived; clamp while slides stream in.
    const next = streaming
      ? clampIndex(target, count)
      : wrapIndex(target, count)
    if (next === index) return
    setNav({ index: next, dir })
    if (announce) {
      setMessage(slideAnnouncement(next, count, ready[next], streaming))
    }
  }
  const step = (delta: 1 | -1) => go(index + delta, delta)
  const jump = (i: number) => go(i, i > index ? 1 : -1)

  // ---- Selection
  const selectable = selection !== "none"
  const selectedIds = orderSelection(picked, ready)
  const full = isSelectionFull(selectedIds, selection, max)
  const toggle = (id: string) => {
    if (locked) return
    setPicked((prev) =>
      toggleSelection(orderSelection(prev, ready), id, selection, max),
    )
  }
  const submit = () => {
    if (locked || selectedIds.length === 0) return
    setDecision("selected")
    onResult?.({ action: "select", slideIds: selectedIds })
  }
  const dismiss = () => {
    if (locked) return
    setDecision("dismissed")
    onResult?.({ action: "dismiss" })
  }
  const stageSelection = (s: Slide | undefined): StageSelection | null => {
    if (!selectable || !s) return null
    const selected = selectedIds.includes(s.id)
    return {
      selected,
      disabled: locked || (!selected && full),
      onToggle: () => toggle(s.id),
    }
  }

  // ---- Lightbox (native <dialog>: modal focus containment and Escape built in)
  const dialogRef = React.useRef<HTMLDialogElement>(null)
  const expandRef = React.useRef<HTMLButtonElement>(null)
  const lightboxStageRef = React.useRef<HTMLElement>(null)
  const [open, setOpen] = React.useState(false)
  const openLightbox = () => {
    const dialog = dialogRef.current
    if (!dialog || dialog.open || typeof dialog.showModal !== "function") return
    dialog.showModal()
    setOpen(true)
  }
  const closeLightbox = () => dialogRef.current?.close()
  React.useEffect(() => {
    if (open) lightboxStageRef.current?.focus()
  }, [open])

  // ---- Autoplay: off by default; paused on hover, focus and reduced motion.
  const [playOverride, setPlayOverride] = React.useState<boolean | null>(null)
  const wantsPlay = playOverride ?? (autoplay === true && !reduced)
  const [hovered, setHovered] = React.useState(false)
  const [focused, setFocused] = React.useState(false)
  const running =
    wantsPlay && !hovered && !focused && !open && !streaming && count > 1
  const advance = React.useRef<(from: number) => void>(() => {})
  advance.current = (from) => go(from + 1, 1, false)
  React.useEffect(() => {
    if (!running) return
    const timer = window.setTimeout(() => advance.current(index), AUTOPLAY_MS)
    return () => window.clearTimeout(timer)
  }, [running, index])

  // ---- Preload the neighbours so next/previous feel instant.
  React.useEffect(() => {
    for (const i of neighborIndices(index, ready.length)) {
      const s = ready[i]
      if (s?.type !== "image") continue
      const src = safeImageSrc(s.src)
      if (!src || src.startsWith("data:")) continue
      const img = new Image()
      img.referrerPolicy = "no-referrer"
      img.src = src
    }
  }, [index, ready])

  // ---- Keep the current thumbnail in view (horizontally only).
  const stripRef = React.useRef<HTMLDivElement>(null)
  const stripEdges = useScrollEdges(stripRef, count)
  React.useEffect(() => {
    const strip = stripRef.current
    const thumb = strip?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    if (!strip || !thumb) return
    const left = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2
    strip.scrollTo({ left, behavior: reduced ? "auto" : "smooth" })
  }, [index, reduced])

  const stageProps = {
    slides: ready,
    index,
    direction,
    streaming,
    ratio,
    selection: stageSelection(slide),
    onStep: step,
    onJump: jump,
  }
  const caption = slide ? (
    <Caption slide={slide} notesOpen={notesOpen} onNotesToggle={setNotesOpen} />
  ) : null

  const sentLabel =
    selectedIds.length === 1
      ? slideLabel(ready.find((s) => s.id === selectedIds[0]) as Slide, 60)
      : `${selectedIds.length} slides`

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="slide-gallery"
        data-status={status}
        aria-busy={streaming}
        aria-label={label}
        className={className}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={() => setHovered(false)}
      >
        <SurfaceHeader className="flex-row items-center justify-between gap-2 pb-3">
          {title ? (
            <SurfaceTitle className="min-w-0 truncate">{title}</SurfaceTitle>
          ) : streaming && count === 0 ? (
            <Skeleton className="h-4 w-40" />
          ) : (
            <span className={genuiType.meta}>
              {count} {count === 1 ? "slide" : "slides"}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {(autoplay || playOverride !== null) && count > 1 && (
              <IconTip label={wantsPlay ? "Pause slideshow" : "Play slideshow"}>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={wantsPlay ? "Pause slideshow" : "Play slideshow"}
                  onClick={() => setPlayOverride(!wantsPlay)}
                >
                  {wantsPlay ? <PauseIcon /> : <PlayIcon />}
                </Button>
              </IconTip>
            )}
            <IconTip label="Expand">
              <Button
                ref={expandRef}
                size="icon-sm"
                variant="ghost"
                aria-label="Expand"
                aria-haspopup="dialog"
                disabled={!slide}
                onClick={openLightbox}
              >
                <Maximize2Icon aria-hidden />
              </Button>
            </IconTip>
          </div>
        </SurfaceHeader>

        {/* Focus anywhere in the slides pauses autoplay. */}
        {/* biome-ignore lint/a11y/noStaticElementInteractions: listens for focus bubbling from the controls inside; adds no interaction of its own */}
        <div
          className="border-t border-border"
          onFocus={() => setFocused(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
              setFocused(false)
            }
          }}
        >
          <Stage
            {...stageProps}
            maxHeight="22rem"
            fill={ready.length > 0 && ready.every((x) => x.type === "image")}
          />

          {caption ??
            (streaming && count === 0 && (
              <p
                className={cn(
                  genuiType.body,
                  "border-t border-border px-3 py-3",
                )}
              >
                <ShimmeringText
                  text="Loading slides…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </p>
            ))}

          {(count > 1 || (streaming && count > 0)) && (
            <div className="relative">
              <div
                ref={stripRef}
                className={cn(
                  "snap-x snap-mandatory scroll-px-3 overflow-x-auto overscroll-x-contain border-t border-border px-3 py-3 [scrollbar-width:thin]",
                )}
              >
                <ul aria-label="Slide thumbnails" className="flex w-max gap-2">
                  {ready.map((s, i) => {
                    const current = i === index
                    const selected = selectedIds.includes(s.id)
                    return (
                      <motion.li
                        key={s.id}
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={genuiMotion.fade}
                        className="shrink-0 snap-start"
                      >
                        <button
                          type="button"
                          data-index={i}
                          aria-label={`Go to slide ${i + 1}: ${slideLabel(s)}${selected ? " (selected)" : ""}`}
                          aria-current={current ? "true" : undefined}
                          onClick={() => jump(i)}
                          style={{ aspectRatio: ratio }}
                          className={cn(
                            "relative block h-14 overflow-hidden rounded-lg border border-border bg-transparent transition-opacity",
                            current
                              ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
                              : "opacity-70 hover:opacity-100",
                            focusRing,
                          )}
                        >
                          {s.type === "image" ? (
                            <SlideImage slide={s} thumb />
                          ) : (
                            <DeckThumb slide={s} />
                          )}
                          {selected && (
                            <span
                              aria-hidden
                              className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-choice text-background"
                            >
                              <CheckMark className="size-3" />
                            </span>
                          )}
                        </button>
                      </motion.li>
                    )
                  })}
                  {streaming && (
                    <li aria-hidden className="shrink-0">
                      <Skeleton
                        className="h-14 rounded-lg"
                        style={{ aspectRatio: ratio }}
                      />
                    </li>
                  )}
                </ul>
              </div>
              <ScrollFades edges={stripEdges} />
            </div>
          )}
        </div>

        {(selectable || decision) && (
          <SurfaceFooter aria-live="polite" className="justify-between">
            {status === "selected" ? (
              <p className={cn(genuiType.body, "flex items-center gap-1.5")}>
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                Chose {sentLabel}
              </p>
            ) : status === "dismissed" ? (
              <p
                className={cn(
                  genuiType.body,
                  "flex items-center gap-1.5 text-muted-foreground",
                )}
              >
                <XIcon aria-hidden className="size-4 shrink-0" />
                None selected
              </p>
            ) : (
              <>
                <p
                  className={cn(
                    genuiType.meta,
                    "min-w-0 flex-1",
                    // "Pick one" is an instruction; keep it for screen readers only.
                    !streaming &&
                      selectedIds.length === 0 &&
                      selection === "single" &&
                      "sr-only",
                  )}
                >
                  {streaming ? (
                    <ShimmeringText
                      text="Loading slides…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  ) : (
                    selectionSummary(selectedIds.length, selection, max)
                  )}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={dismiss}
                    disabled={locked}
                  >
                    None of these
                  </Button>
                  <WhyDisabled
                    reason={
                      !locked &&
                      selectedIds.length === 0 &&
                      "Select at least one"
                    }
                  >
                    <Button
                      size="sm"
                      onClick={submit}
                      disabled={locked || selectedIds.length === 0}
                    >
                      {submitLabel ??
                        (selection === "single" ? "Choose" : "Send selection")}
                    </Button>
                  </WhyDisabled>
                </div>
              </>
            )}
          </SurfaceFooter>
        )}

        {/* Navigation announcements. Off while autoplay runs (WAI carousel). */}
        <p className="sr-only" aria-live={running ? "off" : "polite"}>
          {open ? "" : message}
        </p>

        {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a mouse shortcut; Escape and the Close button cover keyboards */}
        <dialog
          ref={dialogRef}
          aria-label={`${label}, expanded`}
          onClose={() => {
            setOpen(false)
            expandRef.current?.focus()
          }}
          onClick={(e) => {
            // Clicks on the dialog element itself land on the backdrop.
            if (e.target === e.currentTarget) closeLightbox()
          }}
          className="m-auto max-h-[96dvh] w-[min(96vw,72rem)] max-w-none overflow-hidden rounded-3xl border bg-card p-0 text-card-foreground backdrop:bg-black/70"
        >
          {open && (
            <div className="flex flex-col">
              <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
                <h2 className={cn(genuiType.title, "min-w-0 truncate")}>
                  {label}
                </h2>
                <IconTip label="Close">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Close"
                    onClick={closeLightbox}
                  >
                    <XIcon />
                  </Button>
                </IconTip>
              </div>
              <Stage
                {...stageProps}
                maxHeight="calc(96dvh - 12rem)"
                regionRef={lightboxStageRef}
              />
              {caption}
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

/** Which sides of a horizontal scroller have more content past the edge. */
function useScrollEdges(
  ref: React.RefObject<HTMLElement | null>,
  dep?: unknown,
) {
  const [edges, setEdges] = React.useState({ prev: false, next: false })
  // biome-ignore lint/correctness/useExhaustiveDependencies: dep re-measures when the content changes
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const prev = el.scrollLeft > 4
      const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
      setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    resize?.observe(el)
    const mutation = new MutationObserver(update)
    mutation.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", update)
      resize?.disconnect()
      mutation.disconnect()
    }
  }, [ref, dep])
  return edges
}

/** Edge fades that say the row goes on; each shows only on its side. */
function ScrollFades({ edges }: { edges: { prev: boolean; next: boolean } }) {
  return (
    <>
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 left-0 w-14 bg-linear-to-r from-card to-transparent transition-opacity duration-200",
          edges.prev ? "opacity-100" : "opacity-0",
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-14 bg-linear-to-l from-card to-transparent transition-opacity duration-200",
          edges.next ? "opacity-100" : "opacity-0",
        )}
      />
    </>
  )
}
