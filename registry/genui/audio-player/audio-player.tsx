"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  AudioLinesIcon,
  DownloadIcon,
  FlagIcon,
  HeadphonesIcon,
  type LucideIcon,
  MicIcon,
  PauseIcon,
  PhoneIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume2Icon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { ScrollFade } from "@/components/genui/scroll-fade"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import {
  clampTime,
  fileNameFor,
  formatTime,
  isWebUrl,
  positionText,
  resamplePeaks,
  safeAudioUrl,
  seekForKey,
  segmentIndexAt,
} from "./audio-player-utils"
import type {
  AudioKind,
  AudioMarker,
  AudioPlayerInput,
  AudioSegment,
  AudioSpeaker,
} from "./audio-player.schema"

export type AudioPlayerProps = Partial<
  Omit<AudioPlayerInput, "peaks" | "markers" | "segments" | "speakers">
> & {
  /** May be missing or partial while the tool call streams. */
  peaks?: number[]
  markers?: Partial<AudioMarker>[]
  segments?: Partial<AudioSegment>[]
  speakers?: Partial<AudioSpeaker>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

/** Title icon per kind: a tinted box. */
const KINDS: Record<AudioKind, { icon: LucideIcon; tone: string }> = {
  call: {
    icon: PhoneIcon,
    tone: "bg-sky-500/15 text-sky-600 dark:bg-sky-400/15 dark:text-sky-400",
  },
  "voice-note": {
    icon: MicIcon,
    tone: "bg-emerald-500/15 text-emerald-600 dark:bg-emerald-400/15 dark:text-emerald-400",
  },
  voiceover: {
    icon: AudioLinesIcon,
    tone: "bg-orange-500/15 text-orange-600 dark:bg-orange-400/15 dark:text-orange-400",
  },
  podcast: {
    icon: HeadphonesIcon,
    tone: "bg-rose-500/15 text-rose-600 dark:bg-rose-400/15 dark:text-rose-400",
  },
  other: {
    icon: Volume2Icon,
    tone: "bg-muted text-muted-foreground dark:bg-white/10",
  },
}

/**
 * Colours for the people in a transcript, in order of first appearance: solid
 * fills with their own text colour, the same four as the calendar's (D26):
 * slate blue, teal, gold and green. `--spk-n` is the fill, `--spk-fg-n` the text
 * on it; light mode uses deeper fills with white text. Put on the root.
 */
const SPEAKER_VARS =
  "[--spk-0:#5560a8] [--spk-fg-0:#ffffff] [--spk-1:#3e8e7e] [--spk-fg-1:#ffffff] [--spk-2:#9a7400] [--spk-fg-2:#ffffff] [--spk-3:#3d8a5c] [--spk-fg-3:#ffffff] dark:[--spk-0:#4a5588] dark:[--spk-fg-0:#e6e9f8] dark:[--spk-1:#5a9a8e] dark:[--spk-fg-1:#0a1f1b] dark:[--spk-2:#e9c45b] dark:[--spk-fg-2:#2a2100] dark:[--spk-3:#6db38a] dark:[--spk-fg-3:#0d2416]"
const SPEAKER_COLORS = 4

/** Sets a speaker's fill and text colour on an element that uses {@link SPEAKER_FILL}. */
const speakerStyle = (who: number): React.CSSProperties =>
  ({
    "--spk": `var(--spk-${who % SPEAKER_COLORS})`,
    "--spk-fg": `var(--spk-fg-${who % SPEAKER_COLORS})`,
  }) as React.CSSProperties

/** The speaker's colours; muted text inside (the time) follows the text colour. */
const SPEAKER_FILL =
  "bg-[var(--spk)] text-[color:var(--spk-fg)] [--muted-foreground:color-mix(in_oklab,var(--spk-fg)_72%,transparent)]"

/** A photo may be http(s), a same-origin path, or an image data URL; anything else is not loaded. */
const safeAvatarSrc = (src?: string) =>
  src &&
  (/^https?:\/\//i.test(src) ||
    /^\/(?!\/)/.test(src) ||
    /^data:image\//i.test(src))
    ? src
    : undefined

/** A speaker's photo, or their initials in a tint when there is none (or it fails to load). */
function Avatar({
  name,
  src,
  tone,
  style,
  className,
}: {
  name: string
  src?: string
  tone: string
  style?: React.CSSProperties
  className?: string
}) {
  const [failed, setFailed] = React.useState(false)
  const url = safeAvatarSrc(src)
  return url && !failed ? (
    // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
    <img
      src={url}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn("shrink-0 rounded-full bg-muted object-cover", className)}
    />
  ) : (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full text-[13px] font-medium",
        tone,
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")

/** How far the back and forward buttons jump, in seconds. */
const SKIP = 15
/** The voice-note waveform: bar and gap widths, and its height. */
const BAR = 3
const GAP = 2
const WAVE_H = 40
const RATES = [0.75, 1, 1.25, 1.5, 2]
const RATE_ITEMS = RATES.map((r) => ({ value: String(r), label: `${r}×` }))
/** Show the transcript in its own scroll area past this many segments. */
const SCROLL_AFTER = 8

export function AudioPlayer({
  kind,
  title,
  subtitle,
  src,
  durationSeconds,
  markers = [],
  peaks = [],
  segments = [],
  speakers = [],
  startAt,
  endAt,
  downloadable = false,
  status: lifecycle = "ready",
  className,
}: AudioPlayerProps) {
  const streaming = lifecycle === "streaming"
  const reduceMotion = useReducedMotion()
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const listRef = React.useRef<HTMLOListElement>(null)
  const scrollerRef = React.useRef<HTMLDivElement>(null)
  const draggingRef = React.useRef(false)
  /** Where playback stops (the clip end), set when playback starts inside the clip. */
  const stopAtRef = React.useRef<number | null>(null)

  const [playing, setPlaying] = React.useState(false)
  const [time, setTime] = React.useState(startAt ?? 0)
  const [metaDuration, setMetaDuration] = React.useState<number | null>(null)
  const [rate, setRate] = React.useState(1)
  const [error, setError] = React.useState(false)
  const [hover, setHover] = React.useState<{ x: number; t: number } | null>(
    null,
  )
  const [waveEl, setWaveEl] = React.useState<HTMLDivElement | null>(null)
  const [width, setWidth] = React.useState(0)

  const safeSrc = safeAudioUrl(src)
  // An unsafe URL is never loaded: it reads as a failed recording.
  const failed = error || (src !== undefined && src !== "" && !safeSrc)
  const loading = !safeSrc && !failed
  const duration = metaDuration ?? durationSeconds ?? 0

  const clipStart =
    startAt !== undefined || endAt !== undefined
      ? clampTime(startAt ?? 0, duration || Number.POSITIVE_INFINITY)
      : undefined
  const clipEnd =
    endAt !== undefined && endAt > (clipStart ?? 0) ? endAt : undefined
  const hasClip = clipStart !== undefined

  const label = title ?? "recording"
  const canPlay = !!safeSrc && !failed && !streaming

  const readyMarkers = markers.filter(
    (m): m is AudioMarker =>
      typeof m.at === "number" && typeof m.label === "string" && m.label !== "",
  )
  const readySegments = segments.filter(
    (s): s is AudioSegment =>
      typeof s.start === "number" &&
      typeof s.end === "number" &&
      typeof s.text === "string" &&
      s.text !== "",
  )
  const activeIndex = segmentIndexAt(readySegments, time)
  const kindInfo = kind ? KINDS[kind] : undefined
  const speakerIndex = React.useMemo(() => {
    const order = new Map<string, number>()
    for (const s of readySegments) {
      if (s.speaker && !order.has(s.speaker)) order.set(s.speaker, order.size)
    }
    return order
  }, [readySegments])
  // The marker whose chip is hovered or focused: its tick on the waveform stands out.
  const [activeMarker, setActiveMarker] = React.useState<number | null>(null)

  // The seek bar's width, for keeping the hover time inside it.
  React.useEffect(() => {
    if (!waveEl) return
    const update = () => setWidth(waveEl.clientWidth)
    update()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(waveEl)
    return () => observer.disconnect()
  }, [waveEl])

  // Smooth progress while playing; also stops at the clip end.
  React.useEffect(() => {
    if (!playing) return
    let id = 0
    const frame = () => {
      const a = audioRef.current
      if (a) {
        const stopAt = stopAtRef.current
        if (stopAt !== null && a.currentTime >= stopAt) {
          stopAtRef.current = null
          a.pause()
          a.currentTime = stopAt
        }
        if (!draggingRef.current) setTime(a.currentTime)
      }
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [playing])

  // Keep the current transcript line in view, scrolling the list only.
  React.useEffect(() => {
    const list = listRef.current
    const scroller = scrollerRef.current
    if (
      !list ||
      !scroller ||
      activeIndex < 0 ||
      scroller.scrollHeight <= scroller.clientHeight
    ) {
      return
    }
    const item = list.children[activeIndex] as HTMLElement | undefined
    if (!item) return
    // The list is offset inside the scroller's content; items are offset inside the list.
    const top = list.offsetTop + item.offsetTop
    const bottom = top + item.offsetHeight
    if (
      top < scroller.scrollTop ||
      bottom > scroller.scrollTop + scroller.clientHeight
    ) {
      scroller.scrollTo({
        top: top - scroller.clientHeight / 2 + item.offsetHeight / 2,
        behavior: reduceMotion ? "auto" : "smooth",
      })
    }
  }, [activeIndex, reduceMotion])

  const seek = (t: number) => {
    const next = clampTime(t, duration)
    const a = audioRef.current
    if (a) a.currentTime = next
    setTime(next)
    if (a && !a.paused) {
      stopAtRef.current =
        clipEnd !== undefined && next < clipEnd - 0.05 ? clipEnd : null
    }
  }

  const togglePlay = () => {
    const a = audioRef.current
    if (!a || !canPlay) return
    if (!a.paused) {
      a.pause()
      return
    }
    // A finished clip or recording plays again from its start.
    if (clipEnd !== undefined && a.currentTime >= clipEnd - 0.05) {
      a.currentTime = clipStart ?? 0
    } else if (duration > 0 && a.currentTime >= duration - 0.05) {
      a.currentTime = clipStart ?? 0
    }
    stopAtRef.current =
      clipEnd !== undefined && a.currentTime < clipEnd - 0.05 ? clipEnd : null
    a.play().catch(() => {
      // Blocked or failed: the error event (if any) shows the message.
      setPlaying(false)
    })
  }

  const timeAt = (clientX: number) => {
    if (!waveEl || duration <= 0) return null
    const rect = waveEl.getBoundingClientRect()
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left))
    return { x, t: (x / rect.width) * duration }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canPlay || e.button !== 0) return
    const at = timeAt(e.clientX)
    if (!at) return
    e.currentTarget.setPointerCapture(e.pointerId)
    draggingRef.current = true
    setHover(at)
    seek(at.t)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const at = timeAt(e.clientX)
    if (!at) return
    setHover(at)
    if (draggingRef.current) seek(at.t)
  }
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (e.pointerType !== "mouse") setHover(null)
  }

  const onSliderKey = (e: React.KeyboardEvent) => {
    if (!canPlay) return
    // Space plays and pauses, as in most media players.
    if (e.key === " ") {
      e.preventDefault()
      if (!e.repeat) togglePlay()
      return
    }
    const next = seekForKey(e.key, time, duration)
    if (next === null) return
    e.preventDefault()
    seek(next)
  }

  // A voice note shows its waveform; everything else keeps the thin bar.
  const showWave = kind === "voice-note" && peaks.length > 0
  const count =
    width > 0 ? Math.max(1, Math.floor((width + GAP) / (BAR + GAP))) : 0
  const bars = React.useMemo(() => resamplePeaks(peaks, count), [peaks, count])
  const barWidth = count > 0 ? (width - GAP * (count - 1)) / count : BAR
  const pct = (t: number) =>
    duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0
  // Progress runs from the start of the clip (or the recording) to the playhead.
  const fillFrom = clipStart ?? 0
  const fillTo = Math.max(time, fillFrom)
  const showDownload = downloadable && !!safeSrc && !failed && !streaming
  const web = safeSrc ? isWebUrl(safeSrc) : false

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="audio-player"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-label={title ?? "Recording"}
        className={cn(SPEAKER_VARS, className)}
      >
        <SurfaceHeader
          className={cn("pb-3", kindInfo && "flex-row items-center gap-3")}
        >
          {kindInfo && (
            <span
              aria-hidden
              className={cn(
                "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px]",
                kindInfo.tone,
              )}
            >
              <kindInfo.icon className="size-5" />
            </span>
          )}
          <div className="flex min-w-0 flex-col gap-1">
            <SurfaceTitle>{title}</SurfaceTitle>
            {(subtitle || (hasClip && duration > 0)) && (
              <SurfaceDescription className="tabular-nums">
                {subtitle}
                {subtitle && hasClip && duration > 0 && " · "}
                {hasClip &&
                  duration > 0 &&
                  `Clip ${formatTime(clipStart ?? 0)}–${formatTime(clipEnd ?? duration)}`}
              </SurfaceDescription>
            )}
          </div>
        </SurfaceHeader>

        {safeSrc && (
          // biome-ignore lint/a11y/useMediaCaption: the transcript, when there is one, is shown below
          <audio
            ref={audioRef}
            src={safeSrc}
            preload="metadata"
            onLoadedMetadata={(e) => {
              const a = e.currentTarget
              if (Number.isFinite(a.duration) && a.duration > 0) {
                setMetaDuration(a.duration)
              }
              a.playbackRate = rate
              if (time > 0) a.currentTime = time
            }}
            onTimeUpdate={(e) => {
              // Also enforces the clip end while the tab is hidden (no rAF).
              const a = e.currentTarget
              const stopAt = stopAtRef.current
              if (stopAt !== null && a.currentTime >= stopAt) {
                stopAtRef.current = null
                a.pause()
                a.currentTime = stopAt
              }
              if (!draggingRef.current) setTime(a.currentTime)
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => {
              stopAtRef.current = null
              setPlaying(false)
            }}
            onError={() => {
              setError(true)
              setPlaying(false)
            }}
          />
        )}

        <div className="flex flex-col gap-4 border-t border-border px-3 py-4">
          {/* Transport: speed on the left, play in the middle, download on the right. */}
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="flex items-center justify-start">
              <Select
                value={String(rate)}
                items={RATE_ITEMS}
                onValueChange={(v) => {
                  const next = Number(v)
                  if (!RATES.includes(next)) return
                  setRate(next)
                  const a = audioRef.current
                  if (a) a.playbackRate = next
                }}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={`Playback speed for ${label}`}
                  disabled={!canPlay}
                  className="tabular-nums"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RATE_ITEMS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <WhyDisabled when={!canPlay} reason="Not ready to play yet">
                <IconTip label="Back 15 seconds">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={!canPlay}
                    onClick={() => seek(time - SKIP)}
                    className="dark:hover:bg-white/10"
                  >
                    <RotateCcwIcon aria-hidden />
                    <span className="sr-only">Back {SKIP} seconds</span>
                  </Button>
                </IconTip>
              </WhyDisabled>
              <WhyDisabled when={!canPlay} reason="Not ready to play yet">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-lg"
                        className="size-12 rounded-full [&_svg]:size-5"
                        onClick={togglePlay}
                        disabled={!canPlay}
                        aria-label={`${playing ? "Pause" : "Play"} ${label}`}
                      />
                    }
                  >
                    {playing ? (
                      <PauseIcon aria-hidden />
                    ) : (
                      <PlayIcon aria-hidden />
                    )}
                  </TooltipTrigger>
                  <TooltipContent>{`${playing ? "Pause" : "Play"} ${label}`}</TooltipContent>
                </Tooltip>
              </WhyDisabled>
              <WhyDisabled when={!canPlay} reason="Not ready to play yet">
                <IconTip label="Forward 15 seconds">
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={!canPlay}
                    onClick={() => seek(time + SKIP)}
                    className="dark:hover:bg-white/10"
                  >
                    <RotateCwIcon aria-hidden />
                    <span className="sr-only">Forward {SKIP} seconds</span>
                  </Button>
                </IconTip>
              </WhyDisabled>
            </div>

            <div className="flex items-center justify-end">
              {showDownload && safeSrc && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <a
                        href={safeSrc}
                        download={fileNameFor(title)}
                        {...(web
                          ? {
                              target: "_blank",
                              rel: "noopener noreferrer nofollow",
                            }
                          : {})}
                        aria-label={`Download ${label}${web ? " (opens in a new tab)" : ""}`}
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon-sm" }),
                          "dark:hover:bg-white/10",
                        )}
                      />
                    }
                  >
                    <DownloadIcon aria-hidden />
                  </TooltipTrigger>
                  <TooltipContent>{`Download ${label}`}</TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          {/* Seek: elapsed, a thin bar, the length. */}
          {streaming || loading || duration <= 0 ? (
            <div className="flex items-center gap-3" aria-hidden>
              <Skeleton className="h-1 flex-1" />
              <ShimmeringText
                text="Loading…"
                color="var(--muted-foreground)"
                shimmeringColor="var(--foreground)"
                className={genuiType.value}
              />
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className={cn(
                  genuiType.value,
                  "w-10 shrink-0 text-right tabular-nums",
                )}
              >
                {formatTime(time)}
              </span>
              <div
                ref={setWaveEl}
                role="slider"
                tabIndex={canPlay ? 0 : -1}
                aria-label={`Seek ${label}`}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration)}
                aria-valuenow={Math.round(time)}
                aria-valuetext={positionText(time, duration)}
                aria-disabled={!canPlay}
                onKeyDown={onSliderKey}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={() => {
                  if (!draggingRef.current) setHover(null)
                }}
                className={cn(
                  "group/seek relative min-w-0 flex-1 touch-pan-y rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  showWave ? "h-12" : "h-8",
                  canPlay ? "cursor-pointer" : "cursor-default",
                )}
              >
                {showWave ? (
                  width > 0 && (
                    <svg
                      aria-hidden
                      width={width}
                      height={WAVE_H}
                      className="absolute top-1/2 left-0 -translate-y-1/2"
                    >
                      {bars.map((peak, i) => {
                        const h = Math.max(3, peak * (WAVE_H - 4))
                        const center = ((i + 0.5) / bars.length) * duration
                        return (
                          <rect
                            // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional
                            key={i}
                            x={i * (barWidth + GAP)}
                            y={(WAVE_H - h) / 2}
                            width={barWidth}
                            height={h}
                            rx={barWidth / 2}
                            className={
                              center <= time
                                ? "fill-[var(--choice)]"
                                : "fill-muted-foreground/40"
                            }
                          />
                        )
                      })}
                    </svg>
                  )
                ) : (
                  <>
                    {/* The track, then the clip on it, then what has played. */}
                    <div
                      aria-hidden
                      className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted dark:bg-white/10"
                    />
                    {hasClip && (
                      <div
                        aria-hidden
                        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/25"
                        style={{
                          left: `${pct(clipStart ?? 0)}%`,
                          width: `${pct(clipEnd ?? duration) - pct(clipStart ?? 0)}%`,
                        }}
                      />
                    )}
                    <div
                      aria-hidden
                      className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-choice"
                      style={{
                        left: `${pct(fillFrom)}%`,
                        width: `${pct(fillTo) - pct(fillFrom)}%`,
                      }}
                    />
                    {readyMarkers.map((m) => (
                      <span
                        key={`${m.at}-${m.label}`}
                        aria-hidden
                        className={cn(
                          "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-card transition-[width,height]",
                          activeMarker === m.at ? "size-3.5" : "size-2.5",
                        )}
                        style={{ left: `${pct(m.at)}%` }}
                      />
                    ))}
                    <span
                      aria-hidden
                      className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground opacity-0 transition-opacity group-hover/seek:opacity-100 group-focus-visible/seek:opacity-100"
                      style={{ left: `${pct(time)}%` }}
                    />
                  </>
                )}
                {hover && canPlay && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute -top-5 rounded-full border bg-popover px-2 py-0.5 text-[13px] text-popover-foreground tabular-nums shadow-sm dark:shadow-none"
                    style={{
                      left: Math.min(
                        Math.max(hover.x, 20),
                        Math.max(20, width - 20),
                      ),
                      transform: "translateX(-50%)",
                    }}
                  >
                    {formatTime(hover.t)}
                  </span>
                )}
              </div>
              <span
                aria-hidden
                className={cn(genuiType.value, "w-10 shrink-0 tabular-nums")}
              >
                {formatTime(duration)}
              </span>
              <span className="sr-only">{positionText(time, duration)}</span>
            </div>
          )}

          {readyMarkers.length > 0 && (
            <ul aria-label="Markers" className="flex flex-wrap gap-2">
              {readyMarkers.map((m) => (
                <li key={`${m.at}-${m.label}`}>
                  <Button
                    size="xs"
                    variant="secondary"
                    disabled={!canPlay}
                    onClick={() => seek(m.at)}
                    onPointerEnter={() => setActiveMarker(m.at)}
                    onPointerLeave={() => setActiveMarker(null)}
                    onFocus={() => setActiveMarker(m.at)}
                    onBlur={() => setActiveMarker(null)}
                    className="h-8 px-3.5 text-[13px] tabular-nums"
                  >
                    <FlagIcon aria-hidden className="size-3.5" />
                    <span className="sr-only">Jump to </span>
                    {m.label} · {formatTime(m.at)}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <p aria-live="polite" className={cn(genuiType.body, "empty:hidden")}>
            {failed && (
              <span className="flex items-center gap-1.5 font-medium">
                <AlertCircleIcon aria-hidden className="size-4 shrink-0" />
                Couldn't load this recording
              </span>
            )}
          </p>
        </div>

        {(readySegments.length > 0 || (streaming && segments.length > 0)) && (
          <div className="border-t border-border">
            <h4 className="sr-only">Transcript</h4>
            <ScrollFade
              scrollRef={scrollerRef}
              className={cn(readySegments.length > SCROLL_AFTER && "max-h-80")}
              viewportClassName="overflow-y-auto"
            >
              <ol ref={listRef} className="relative flex flex-col px-3 py-3">
                {readySegments.map((seg, i) => {
                  const current = i === activeIndex
                  const outside =
                    hasClip &&
                    (seg.end <= (clipStart ?? 0) ||
                      seg.start >= (clipEnd ?? Number.POSITIVE_INFINITY))
                  const who = seg.speaker
                    ? (speakerIndex.get(seg.speaker) ?? 0)
                    : 0
                  // The first speaker sits on the left, the next on the right.
                  const mine = who % 2 === 1
                  const prev = readySegments[i - 1]
                  const sameRun = !!prev && prev.speaker === seg.speaker
                  const photo = speakers.find(
                    (p) => p.name === seg.speaker,
                  )?.avatar
                  return (
                    <motion.li
                      // biome-ignore lint/suspicious/noArrayIndexKey: segments have no id and only append while streaming
                      key={i}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={genuiMotion.fade}
                      className={cn(
                        "flex items-start gap-2.5",
                        sameRun ? "mt-1" : i > 0 && "mt-4",
                        mine && "flex-row-reverse",
                      )}
                    >
                      {/* The photo sits by the first bubble of a run; the rest keep its column. */}
                      {seg.speaker ? (
                        sameRun ? (
                          <span aria-hidden className="size-10 shrink-0" />
                        ) : (
                          <Avatar
                            name={seg.speaker}
                            src={photo}
                            tone={SPEAKER_FILL}
                            style={speakerStyle(who)}
                            className="size-10"
                          />
                        )
                      ) : null}
                      <div
                        className={cn(
                          "flex min-w-0 max-w-[82%] flex-col gap-1",
                          mine ? "items-end" : "items-start",
                        )}
                      >
                        {seg.speaker && !sameRun && (
                          <span
                            className={cn(genuiType.meta, "px-1 font-medium")}
                          >
                            {seg.speaker}
                          </span>
                        )}
                        <button
                          type="button"
                          aria-current={current ? "true" : undefined}
                          disabled={!canPlay}
                          onClick={() => seek(seg.start)}
                          style={speakerStyle(who)}
                          className={cn(
                            "rounded-2xl px-3.5 py-2 text-left text-[13px] outline-none transition-[filter,box-shadow,opacity] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default",
                            SPEAKER_FILL,
                            mine ? "rounded-tr-md" : "rounded-tl-md",
                            // The line being played: a thick ring, like a selected option.
                            current && "ring-2 ring-choice",
                            outside && !current && "opacity-60",
                          )}
                        >
                          <span className="break-words">{seg.text}</span>
                          <span
                            className={cn(
                              genuiType.meta,
                              "ml-2 inline-block align-baseline tabular-nums",
                            )}
                          >
                            {formatTime(seg.start)}
                          </span>
                        </button>
                      </div>
                    </motion.li>
                  )
                })}
                {streaming && (
                  <li aria-hidden className="flex gap-3 px-3 py-3">
                    <Skeleton className="h-4 w-10" />
                    <Skeleton className="h-4 flex-1" />
                  </li>
                )}
              </ol>
            </ScrollFade>
          </div>
        )}
      </Surface>
    </MotionConfig>
  )
}
