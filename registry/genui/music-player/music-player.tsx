"use client"

import * as React from "react"
import { Menu } from "@base-ui/react/menu"
import {
  CheckIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  HeartIcon,
  MusicIcon,
  PauseIcon,
  PlayIcon,
  Repeat1Icon,
  RepeatIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react"
import {
  MotionConfig,
  type MotionValue,
  motion,
  useMotionValue,
} from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Skeleton,
  Surface,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  genuiMotion,
  genuiHit,
} from "@/components/genui/surface"

import {
  clampTime,
  formatTotalDuration,
  formatTotalDurationSpoken,
  formatTrackTime,
  indexAfterEnd,
  indexForKey,
  indexFromMidpoints,
  initials,
  moveId,
  nextRepeat,
  positionText,
  type RepeatMode,
  type Removal,
  reconcileOrder,
  removeId,
  restoreRemoval,
  safeAudioUrl,
  safeHttpUrl,
  safeImageUrl,
  seekForKey,
  totalDuration,
  trackCount,
} from "./music-player-utils"
import type {
  MusicNowPlaying,
  MusicPlayerInput,
  MusicPlayerResult,
  MusicTrack,
} from "./music-player.schema"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type MusicPlayerStatus =
  | "streaming"
  | "ready"
  | "submitting"
  | "saved"
  | "dismissed"

type PartialTrack = Omit<Partial<MusicTrack>, "artwork"> & {
  artwork?: { src?: string; alt?: string }
}

export type MusicPlayerProps = Partial<
  Omit<MusicPlayerInput, "tracks" | "nowPlaying">
> & {
  /** Tracks may be partial while the tool call streams. */
  tracks?: PartialTrack[]
  nowPlaying?: Partial<MusicNowPlaying>
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props; 'submitting' while the host saves the playlist.
   * When omitted, the component tracks the user's decision itself.
   */
  status?: MusicPlayerStatus
  /**
   * Now-playing: called on every control (play, pause, next, seek…), so the
   * agent can carry it out with the provider. Playlist: called once with the
   * user's decision (save or dismiss), or when they open it in the provider.
   */
  onResult?: (result: MusicPlayerResult) => void
  /**
   * A playlist decision from history. Restores the saved order read-only and
   * never calls onResult. Ignored in now-playing mode.
   */
  result?: MusicPlayerResult
  className?: string
}

/** The playlist scrolls inside the card past this many tracks. */
const SCROLL_AFTER = 6
/** Pointer travel (px) before a press on the handle becomes a drag. */
const DRAG_SLOP = 4
/** Keyboard seeks are sent this long (ms) after the last key press. */
const SEEK_DEBOUNCE_MS = 600

function isReadyTrack(t: PartialTrack): t is MusicTrack {
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    t.title !== "" &&
    Array.isArray(t.artists) &&
    t.artists.length > 0 &&
    typeof t.durationSeconds === "number" &&
    t.durationSeconds > 0
  )
}

const artistLine = (t: MusicTrack) => t.artists.join(", ")

/** Re-announces a repeated message by toggling a trailing space. */
function useAnnouncer() {
  const [text, setText] = React.useState("")
  const last = React.useRef("")
  const announce = React.useCallback((next: string) => {
    const value = next === last.current ? `${next} ` : next
    last.current = value
    setText(value)
  }, [])
  return [text, announce] as const
}

// ---- Preview playback (one <audio> for the whole component) ----

type Preview = {
  element: React.ReactNode
  /** The track loaded in the player (playing or paused), if any. */
  trackId: string | null
  playing: boolean
  time: number
  duration: number
  failed: ReadonlySet<string>
  toggle: (trackId: string, url: string) => void
  stop: () => void
}

function usePreview(): Preview {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const idRef = React.useRef<string | null>(null)
  const [trackId, setTrackId] = React.useState<string | null>(null)
  const [playing, setPlaying] = React.useState(false)
  const [time, setTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  )

  const load = (id: string | null) => {
    idRef.current = id
    setTrackId(id)
  }

  // Smooth progress while a preview plays.
  React.useEffect(() => {
    if (!playing) return
    let id = 0
    const frame = () => {
      const a = audioRef.current
      if (a) setTime(a.currentTime)
      id = requestAnimationFrame(frame)
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [playing])

  React.useEffect(() => {
    const a = audioRef.current
    return () => a?.pause()
  }, [])

  const toggle = (id: string, url: string) => {
    const a = audioRef.current
    if (!a) return
    if (idRef.current === id) {
      if (a.paused) a.play().catch(() => setPlaying(false))
      else a.pause()
      return
    }
    // Starting another preview stops the current one: one at a time.
    a.pause()
    a.src = url
    load(id)
    setTime(0)
    setDuration(0)
    a.play().catch(() => setPlaying(false))
  }

  const stop = () => {
    audioRef.current?.pause()
    load(null)
    setTime(0)
  }

  const element = (
    // biome-ignore lint/a11y/useMediaCaption: short music previews have no captions
    <audio
      ref={audioRef}
      preload="none"
      onLoadedMetadata={(e) => {
        const d = e.currentTarget.duration
        if (Number.isFinite(d) && d > 0) setDuration(d)
      }}
      onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onEnded={() => {
        setPlaying(false)
        setTime(0)
        load(null)
      }}
      onError={() => {
        const id = idRef.current
        if (id) setFailed((prev) => new Set(prev).add(id))
        setPlaying(false)
        load(null)
      }}
    />
  )

  return { element, trackId, playing, time, duration, failed, toggle, stop }
}

// ---- Small pieces ----

function Artwork({
  track,
  large = false,
  pending = false,
  className,
}: {
  track: MusicTrack | undefined
  large?: boolean
  pending?: boolean
  className?: string
}) {
  const src = safeImageUrl(track?.artwork?.src)
  const [broken, setBroken] = React.useState<string | null>(null)
  const box = cn(
    "shrink-0 overflow-hidden",
    large ? "rounded-[10px]" : "rounded-lg",
    className,
  )
  if (!track || (pending && !src)) return <Skeleton className={box} />
  if (src && broken !== src) {
    return (
      // biome-ignore lint/performance/noImgElement: provider artwork URLs; next/image would need every host configured
      <img
        src={src}
        alt={track.artwork?.alt ?? `Cover of ${track.album ?? track.title}`}
        loading="lazy"
        decoding="async"
        onError={() => setBroken(src)}
        className={cn(box, "bg-muted object-cover")}
      />
    )
  }
  // Neutral placeholder: a note and, when there's room, the album initials.
  return (
    <span
      aria-hidden
      className={cn(
        box,
        "flex flex-col items-center justify-center gap-1 border border-border bg-transparent text-muted-foreground",
      )}
    >
      <MusicIcon className={large ? "size-6" : "size-3.5"} />
      {large && (
        <span className="text-[13px] font-semibold tracking-wide">
          {initials(track.album ?? track.artists[0] ?? track.title)}
        </span>
      )}
    </span>
  )
}

function ExplicitMark() {
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-border bg-transparent text-xs leading-none font-semibold text-muted-foreground">
      <span aria-hidden>E</span>
      <span className="sr-only">explicit</span>
    </span>
  )
}

function DropLine({ edge }: { edge: "before" | "after" }) {
  return (
    <span
      aria-hidden
      data-slot="music-player-drop-indicator"
      className={cn(
        "pointer-events-none absolute inset-x-5 z-20 h-0.5 rounded-full bg-primary",
        edge === "before" ? "-top-px" : "-bottom-px",
      )}
    />
  )
}

type RowEditing = {
  held: boolean
  dragging: boolean
  dragY: MotionValue<number>
  instructionsId: string
  handleRef: (el: HTMLButtonElement | null) => void
  removeRef: (el: HTMLButtonElement | null) => void
  onHandleKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  onHandleBlur: (e: React.FocusEvent<HTMLButtonElement>) => void
  onHandlePointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void
  onHandlePointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void
  onHandlePointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void
  onHandlePointerCancel: () => void
  onRemove: () => void
}

function TrackRow({
  track,
  index,
  pendingArt,
  canPreview,
  preview,
  indicator = null,
  settle = false,
  editing,
}: {
  track: MusicTrack
  index: number
  pendingArt: boolean
  canPreview: boolean
  preview: Preview
  indicator?: "before" | "after" | null
  settle?: boolean
  editing?: RowEditing
}) {
  const url = safeAudioUrl(track.previewUrl)
  const hasPreview = !!url && canPreview && !preview.failed.has(track.id)
  const isCurrent = preview.trackId === track.id
  const previewing = isCurrent && preview.playing
  const progress =
    isCurrent && preview.duration > 0
      ? Math.min(100, (preview.time / preview.duration) * 100)
      : 0
  const dragging = editing?.dragging ?? false

  return (
    <motion.li
      data-slot="music-player-track"
      data-track-id={track.id}
      aria-current={isCurrent ? "true" : undefined}
      layout={dragging || settle ? false : "position"}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className={cn("group/row relative", dragging && "z-10")}
    >
      {indicator === "before" && <DropLine edge="before" />}
      <motion.div
        style={dragging ? { y: editing?.dragY } : undefined}
        className={cn(
          "relative mx-2 flex items-center gap-3 rounded-[10px] px-3 py-3",
          isCurrent && "bg-accent",
          dragging && "bg-[var(--surface-bg)] shadow-md dark:shadow-none",
          editing?.held &&
            "bg-accent ring-2 ring-ring ring-inset",
        )}
      >
        {editing && (
          <IconTip label={`Move ${track.title}`}>
            <button
              ref={editing.handleRef}
              type="button"
              data-slot="music-player-handle"
              aria-label={`Move ${track.title}`}
              aria-roledescription="draggable track"
              aria-describedby={editing.instructionsId}
              onKeyDown={editing.onHandleKeyDown}
              onBlur={editing.onHandleBlur}
              onPointerDown={editing.onHandlePointerDown}
              onPointerMove={editing.onHandlePointerMove}
              onPointerUp={editing.onHandlePointerUp}
              onPointerCancel={editing.onHandlePointerCancel}
              className={cn("relative", genuiHit, "-ml-2 inline-flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-muted-foreground outline-none select-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:cursor-grabbing")}
            >
              <GripVerticalIcon aria-hidden className="size-4" />
            </button>
          </IconTip>
        )}

        {/* Index, swapped for the preview button on hover, focus or touch. */}
        <span className="relative flex size-8 shrink-0 items-center justify-center">
          <span
            aria-hidden
            className={cn(
              "text-[13px] text-muted-foreground tabular-nums",
              hasPreview &&
                "group-focus-within/row:opacity-0 group-hover/row:opacity-0 [@media(hover:none)]:opacity-0",
              hasPreview && isCurrent && "opacity-0",
            )}
          >
            {index + 1}
          </span>
          {hasPreview && url && (
            <IconTip
              label={`${previewing ? "Pause" : "Play"} preview of ${track.title}`}
            >
              <button
                type="button"
                aria-label={`${previewing ? "Pause" : "Play"} preview of ${track.title}`}
                onClick={() => preview.toggle(track.id, url)}
                className={cn(
                  genuiHit, "absolute inset-0 inline-flex items-center justify-center rounded-full opacity-0 outline-none hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-focus-within/row:opacity-100 group-hover/row:opacity-100 [@media(hover:none)]:opacity-100",
                  isCurrent && "opacity-100",
                )}
              >
                {previewing ? (
                  <PauseIcon aria-hidden className="size-3.5" />
                ) : (
                  <PlayIcon aria-hidden className="size-3.5" />
                )}
              </button>
            </IconTip>
          )}
        </span>

        <Artwork track={track} pending={pendingArt} className="size-10" />

        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
            <span className="truncate">{track.title}</span>
            {track.explicit && <ExplicitMark />}
          </span>
          <span className="truncate text-[13px] text-muted-foreground">
            {artistLine(track)}
          </span>
        </span>

        <span className="w-10 shrink-0 text-right text-[13px] text-muted-foreground tabular-nums">
          {formatTrackTime(track.durationSeconds)}
        </span>

        {editing && (
          <IconTip label={`Remove ${track.title}`}>
            <Button
              ref={editing.removeRef}
              size="icon-xs"
              variant="ghost"
              aria-label={`Remove ${track.title}`}
              onClick={editing.onRemove}
              className="-mr-1.5 text-muted-foreground"
            >
              <XIcon aria-hidden />
            </Button>
          </IconTip>
        )}

        {isCurrent && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-muted dark:bg-white/15"
          >
            <span
              className="block h-full bg-choice"
              style={{ width: `${progress}%` }}
            />
          </span>
        )}
      </motion.div>
      {indicator === "after" && <DropLine edge="after" />}
    </motion.li>
  )
}

function RowSkeleton({ editable = false }: { editable?: boolean }) {
  return (
    <li aria-hidden className="mx-2 flex items-center gap-3 px-3 py-3">
      {editable && <span className="-ml-2 w-7" />}
      <span className="size-8" />
      <Skeleton className="size-10 rounded-lg" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-40 max-w-full" />
        <Skeleton className="h-3 w-24" />
      </span>
      <Skeleton className="h-3 w-8" />
    </li>
  )
}

// ---- Now playing ----

type PlaybackState = {
  currentId: string | null
  position: number
  playing: boolean
  shuffle: boolean
  repeat: RepeatMode
}

const fromSnapshot = (n: Partial<MusicNowPlaying> | undefined) =>
  ({
    currentId: n?.trackId ?? null,
    position: n?.positionSeconds ?? 0,
    playing: n?.isPlaying ?? false,
    shuffle: n?.shuffle ?? false,
    repeat: n?.repeat ?? "off",
  }) satisfies PlaybackState

/** Moves playback forward by `dt` seconds, following the repeat setting. */
function advance(
  s: PlaybackState,
  dt: number,
  list: MusicTrack[],
): PlaybackState {
  const found = list.findIndex((t) => t.id === s.currentId)
  const i = found >= 0 ? found : 0
  const cur = list[i]
  if (!cur) return s
  const position = s.position + dt
  if (position < cur.durationSeconds) return { ...s, position }
  const next = indexAfterEnd(i, list.length, s.repeat)
  if (next === null) {
    return { ...s, position: cur.durationSeconds, playing: false }
  }
  return { ...s, currentId: list[next].id, position: 0 }
}

const SENT_TEXT: Record<string, string> = {
  play: "Play",
  pause: "Pause",
  next: "Next track",
  previous: "Previous track",
  like: "Like",
  unlike: "Unlike",
  "shuffle-on": "Shuffle on",
  "shuffle-off": "Shuffle off",
}

function NowPlayingView({
  title,
  tracks,
  nowPlaying,
  provider,
  streaming,
  preview,
  onResult,
}: {
  title?: string
  tracks: MusicTrack[]
  nowPlaying?: Partial<MusicNowPlaying>
  provider?: { name?: string }
  streaming: boolean
  preview: Preview
  onResult?: (result: MusicPlayerResult) => void
}) {
  // Local state mirrors the provider's report and moves on optimistically
  // after each control. A new report from the host replaces it.
  const snapshotKey = JSON.stringify([
    nowPlaying?.trackId,
    nowPlaying?.positionSeconds,
    nowPlaying?.isPlaying,
    nowPlaying?.shuffle,
    nowPlaying?.repeat,
  ])
  const [state, setState] = React.useState<PlaybackState>(() =>
    fromSnapshot(nowPlaying),
  )
  const [synced, setSynced] = React.useState(snapshotKey)
  if (synced !== snapshotKey) {
    setSynced(snapshotKey)
    setState(fromSnapshot(nowPlaying))
  }
  const [likes, setLikes] = React.useState<Record<string, boolean>>({})
  const [sent, announceSent] = useAnnouncer()
  const [scrub, setScrub] = React.useState<number | null>(null)
  const scrubbing = React.useRef(false)
  const seekTimer = React.useRef(0)
  const barRef = React.useRef<HTMLDivElement>(null)
  const tracksRef = React.useRef(tracks)
  React.useLayoutEffect(() => {
    tracksRef.current = tracks
  })
  React.useEffect(() => () => window.clearTimeout(seekTimer.current), [])

  const index = tracks.findIndex(
    (t) => t.id === (state.currentId ?? nowPlaying?.trackId),
  )
  // While streaming, wait for the reported track rather than guess.
  const waiting = streaming && (index < 0 || !nowPlaying?.trackId)
  const currentIndex = index >= 0 ? index : waiting ? -1 : 0
  const current = currentIndex >= 0 ? tracks[currentIndex] : undefined
  const duration = current?.durationSeconds ?? 0
  const shown = clampTime(scrub ?? state.position, duration)
  const liked = current ? (likes[current.id] ?? current.liked ?? false) : false
  const canControl = !!current && !streaming
  const whyCantControl = canControl
    ? undefined
    : streaming
      ? "Loading…"
      : "Nothing is playing"
  const providerName = provider?.name ?? "your music app"
  const openUrl = safeHttpUrl(current?.url)
  const upNext = current ? tracks.slice(currentIndex + 1) : []

  const ticking = state.playing && canControl
  React.useEffect(() => {
    if (!ticking) return
    let last = performance.now()
    const id = window.setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      setState((s) => advance(s, dt, tracksRef.current))
    }, 250)
    return () => window.clearInterval(id)
  }, [ticking])

  const send = (result: MusicPlayerResult, text: string) => {
    onResult?.(result)
    announceSent(`${text} sent to ${providerName}`)
  }

  const control = (
    action:
      | "play"
      | "pause"
      | "next"
      | "previous"
      | "like"
      | "unlike"
      | "shuffle-on"
      | "shuffle-off",
  ) => {
    if (!current) return
    const trackId = current.id
    switch (action) {
      case "play":
      case "pause":
        setState((s) => ({ ...s, playing: action === "play" }))
        break
      case "next": {
        const n =
          currentIndex + 1 < tracks.length
            ? currentIndex + 1
            : state.repeat === "all"
              ? 0
              : null
        if (n !== null) {
          setState((s) => ({ ...s, currentId: tracks[n].id, position: 0 }))
        }
        break
      }
      case "previous": {
        // Like most players: past 3 s, "previous" restarts the track.
        const p =
          state.position > 3
            ? null
            : currentIndex > 0
              ? currentIndex - 1
              : state.repeat === "all"
                ? tracks.length - 1
                : null
        setState((s) => ({
          ...s,
          currentId: p === null ? s.currentId : tracks[p].id,
          position: 0,
        }))
        break
      }
      case "like":
      case "unlike":
        setLikes((l) => ({ ...l, [trackId]: action === "like" }))
        break
      case "shuffle-on":
      case "shuffle-off":
        setState((s) => ({ ...s, shuffle: action === "shuffle-on" }))
        break
    }
    send({ action, trackId }, SENT_TEXT[action])
  }

  const cycleRepeat = () => {
    if (!current) return
    const value = nextRepeat(state.repeat)
    setState((s) => ({ ...s, repeat: value }))
    send({ action: "repeat", value, trackId: current.id }, `Repeat ${value}`)
  }

  const sendSeek = (t: number) => {
    if (!current) return
    send(
      { action: "seek", positionSeconds: Math.round(t), trackId: current.id },
      `Seek to ${formatTrackTime(t)}`,
    )
  }

  const timeAt = (clientX: number) => {
    const el = barRef.current
    if (!el || duration <= 0) return 0
    const rect = el.getBoundingClientRect()
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left))
    return rect.width > 0 ? (x / rect.width) * duration : 0
  }

  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canControl || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubbing.current = true
    setScrub(timeAt(e.clientX))
  }
  const onBarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (scrubbing.current) setScrub(timeAt(e.clientX))
  }
  const onBarPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current) return
    scrubbing.current = false
    const t = timeAt(e.clientX)
    setScrub(null)
    setState((s) => ({ ...s, position: t }))
    // Sent once, on release.
    sendSeek(t)
  }
  const onBarPointerCancel = () => {
    scrubbing.current = false
    setScrub(null)
  }
  const onBarKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!canControl) return
    if (e.key === " ") {
      e.preventDefault()
      if (!e.repeat) control(state.playing ? "pause" : "play")
      return
    }
    const next = seekForKey(e.key, shown, duration)
    if (next === null) return
    e.preventDefault()
    setState((s) => ({ ...s, position: next }))
    window.clearTimeout(seekTimer.current)
    seekTimer.current = window.setTimeout(
      () => sendSeek(next),
      SEEK_DEBOUNCE_MS,
    )
  }

  const pct = duration > 0 ? (shown / duration) * 100 : 0
  const previewUrl = safeAudioUrl(current?.previewUrl)
  const showPreview =
    !!current && !!previewUrl && !preview.failed.has(current.id)
  const previewLoaded = !!current && preview.trackId === current.id
  const previewing = previewLoaded && preview.playing

  return (
    <>
      <SurfaceHeader className="pb-3">
        <SurfaceTitle>{title ?? "Now playing"}</SurfaceTitle>
        {nowPlaying?.device && (
          <p className={genuiType.meta}>
            {state.playing ? "Playing" : "Paused"} on {nowPlaying.device}
          </p>
        )}
      </SurfaceHeader>

      <div className="flex flex-col gap-4 border-t border-border px-3 py-3">
        <div className="flex items-center gap-4">
          <Artwork
            track={current}
            large
            pending={streaming}
            className="size-24 @sm:size-28 @md:size-32"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            {current ? (
              <div className="flex items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="flex items-center gap-1.5 text-xl leading-tight font-semibold tracking-tight">
                    <span className="break-words">{current.title}</span>
                    {current.explicit && <ExplicitMark />}
                  </p>
                  <p className={cn(genuiType.body, "break-words")}>
                    {artistLine(current)}
                  </p>
                  {current.album && (
                    <p className="sr-only">{`Album: ${current.album}`}</p>
                  )}
                </div>
                <WhyDisabled reason={whyCantControl}>
                  <IconTip label={`Like ${current.title}`}>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-pressed={liked}
                      aria-label={`Like ${current.title}`}
                      disabled={!canControl}
                      onClick={() => control(liked ? "unlike" : "like")}
                      className="-mt-1 -mr-1.5 text-muted-foreground aria-pressed:text-foreground"
                    >
                      <HeartIcon
                        aria-hidden
                        className={cn(liked && "fill-current")}
                      />
                    </Button>
                  </IconTip>
                </WhyDisabled>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-6 w-40 max-w-full" />
                <Skeleton className="h-4 w-28" />
              </div>
            )}

            {showPreview && previewUrl && current && (
              <div className="flex items-center">
                <Button
                  size="sm"
                  disabled={streaming}
                  aria-label={`${previewing ? "Pause" : "Play"} preview of ${current.title}`}
                  onClick={() => preview.toggle(current.id, previewUrl)}
                >
                  {previewing ? (
                    <PauseIcon aria-hidden />
                  ) : (
                    <PlayIcon aria-hidden />
                  )}
                  {previewing ? "Pause preview" : "Play preview"}
                </Button>
                {previewLoaded && preview.duration > 0 && (
                  <span className="sr-only">
                    {`Preview at ${positionText(preview.time, preview.duration)}`}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span aria-hidden className={cn(genuiType.value, "min-w-8 shrink-0")}>
            {formatTrackTime(shown)}
          </span>
          <div
            ref={barRef}
            role="slider"
            tabIndex={canControl ? 0 : -1}
            aria-label={current ? `Seek ${current.title}` : "Seek"}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(shown)}
            aria-valuetext={positionText(shown, duration)}
            aria-disabled={!canControl}
            onKeyDown={onBarKeyDown}
            onPointerDown={onBarPointerDown}
            onPointerMove={onBarPointerMove}
            onPointerUp={onBarPointerUp}
            onPointerCancel={onBarPointerCancel}
            className={cn(
              "relative flex h-6 min-w-0 flex-1 touch-none items-center rounded-full outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/50",
              canControl ? "cursor-pointer" : "cursor-default opacity-60",
            )}
          >
            <span className="block h-1 w-full overflow-hidden rounded-full bg-muted dark:bg-white/15">
              <span
                className="block h-full bg-choice"
                style={{ width: `${pct}%` }}
              />
            </span>
            <span
              aria-hidden
              className="absolute top-1/2 h-6 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand"
              style={{ left: `${pct}%` }}
            />
          </div>
          <span
            aria-hidden
            className={cn(genuiType.value, "min-w-8 shrink-0 text-right")}
          >
            {formatTrackTime(duration)}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <WhyDisabled reason={whyCantControl}>
            <IconTip label="Shuffle">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-pressed={state.shuffle}
                aria-label="Shuffle"
                disabled={!canControl}
                onClick={() =>
                  control(state.shuffle ? "shuffle-off" : "shuffle-on")
                }
                className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
              >
                <ShuffleIcon aria-hidden />
              </Button>
            </IconTip>
          </WhyDisabled>
          <div className="flex items-center gap-2">
            <WhyDisabled reason={whyCantControl}>
              <IconTip label="Previous track">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Previous track"
                  disabled={!canControl}
                  onClick={() => control("previous")}
                >
                  <SkipBackIcon aria-hidden />
                </Button>
              </IconTip>
            </WhyDisabled>
            <WhyDisabled reason={whyCantControl}>
              <IconTip label={state.playing ? "Pause" : "Play"}>
                <Button
                  size="icon-lg"
                  aria-label={state.playing ? "Pause" : "Play"}
                  disabled={!canControl}
                  onClick={() => control(state.playing ? "pause" : "play")}
                  className="rounded-full"
                >
                  {state.playing ? (
                    <PauseIcon aria-hidden />
                  ) : (
                    <PlayIcon aria-hidden />
                  )}
                </Button>
              </IconTip>
            </WhyDisabled>
            <WhyDisabled reason={whyCantControl}>
              <IconTip label="Next track">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Next track"
                  disabled={!canControl}
                  onClick={() => control("next")}
                >
                  <SkipForwardIcon aria-hidden />
                </Button>
              </IconTip>
            </WhyDisabled>
          </div>
          <WhyDisabled reason={whyCantControl}>
            <IconTip label={`Repeat: ${state.repeat}`}>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-pressed={state.repeat !== "off"}
                disabled={!canControl}
                onClick={cycleRepeat}
                className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
              >
                {state.repeat === "one" ? (
                  <Repeat1Icon aria-hidden />
                ) : (
                  <RepeatIcon aria-hidden />
                )}
                <span className="sr-only">
                  {`Repeat: ${state.repeat === "off" ? "off" : state.repeat === "all" ? "all" : "one"}`}
                </span>
              </Button>
            </IconTip>
          </WhyDisabled>
        </div>
      </div>

      {upNext.length > 0 && (
        <div className="border-t border-border pt-3 pb-2">
          <h4 className={cn(genuiType.label, "px-3 pb-1.5")}>Up next</h4>
          <ol aria-label="Up next" className="flex flex-col">
            {upNext.map((t, i) => (
              <TrackRow
                key={t.id}
                track={t}
                index={i}
                pendingArt={streaming}
                canPreview={!streaming}
                preview={preview}
              />
            ))}
          </ol>
        </div>
      )}

      <SurfaceFooter className="justify-between">
        <p aria-live="polite" className={cn(genuiType.meta, "min-w-0")}>
          {streaming ? (
            <ShimmeringText
              text="Loading…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
            />
          ) : (
            sent
          )}
        </p>
        {openUrl && !streaming && (
          <a
            href={openUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Open in {providerName}
            <ExternalLinkIcon aria-hidden />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        )}
      </SurfaceFooter>
    </>
  )
}

// ---- Playlist ----

type Held = { id: string; snapshot: string[] }
type PointerDrag = {
  id: string
  pointerId: number
  startY: number
  startScroll: number
  active: boolean
}
type FocusRequest = { id: string; kind: "handle" | "remove" } | null

function PlaylistView({
  title,
  description,
  provider,
  tracks,
  editable,
  totalDurationSeconds,
  status,
  streaming,
  restoredOpen,
  result,
  preview,
  onSave,
  onDismiss,
  onOpen,
}: {
  title?: string
  description?: string
  provider?: { name?: string }
  tracks: MusicTrack[]
  editable: boolean
  totalDurationSeconds?: number
  status: MusicPlayerStatus
  streaming: boolean
  restoredOpen: boolean
  result?: MusicPlayerResult
  preview: Preview
  onSave: (trackIds: string[], removed: string[]) => void
  onDismiss: () => void
  onOpen: () => void
}) {
  const saved = result?.action === "save-playlist" ? result : null
  const [order, setOrder] = React.useState<string[] | null>(null)
  const [removals, setRemovals] = React.useState<Removal[]>([])
  const [held, setHeld] = React.useState<Held | null>(null)
  const [dragId, setDragId] = React.useState<string | null>(null)
  const [dropIndex, setDropIndex] = React.useState<number | null>(null)
  const [settleId, setSettleId] = React.useState<string | null>(null)
  const [focusRequest, setFocusRequest] = React.useState<FocusRequest>(null)
  const [message, setMessage] = useAnnouncer()
  const [announcement, announce] = useAnnouncer()
  const instructionsId = React.useId()

  const listRef = React.useRef<HTMLOListElement>(null)
  const undoRef = React.useRef<HTMLButtonElement>(null)
  const handleEls = React.useRef(new Map<string, HTMLButtonElement>())
  const removeEls = React.useRef(new Map<string, HTMLButtonElement>())
  const dragRef = React.useRef<PointerDrag | null>(null)
  const dropRef = React.useRef<number | null>(null)
  const dragY = useMotionValue(0)

  const locked = status !== "ready" || restoredOpen
  const canEdit = editable && !locked
  const byId = new Map(tracks.map((t) => [t.id, t]))
  const ids = tracks.map((t) => t.id)
  const removedIds = saved
    ? saved.removed
    : removals.map((r) => r.id).filter((id) => byId.has(id))
  // A saved playlist from history shows exactly what was saved.
  const current = saved
    ? saved.trackIds.filter(
        (id, i, all) => byId.has(id) && all.indexOf(id) === i,
      )
    : reconcileOrder(order ?? ids, ids, removedIds)
  const currentTracks = current.flatMap((id) => {
    const t = byId.get(id)
    return t ? [t] : []
  })
  const edited = removedIds.length > 0 || current.join("\n") !== ids.join("\n")
  const total = edited
    ? totalDuration(currentTracks)
    : (totalDurationSeconds ?? totalDuration(tracks))
  const n = current.length
  const titleOf = (id: string) => byId.get(id)?.title ?? "Track"
  const providerName = provider?.name

  // Keep focus on the moved or neighbouring control after a re-order.
  React.useLayoutEffect(() => {
    if (!focusRequest) return
    const el =
      focusRequest.kind === "handle"
        ? handleEls.current.get(focusRequest.id)
        : removeEls.current.get(focusRequest.id)
    if (el) {
      if (document.activeElement !== el) el.focus({ preventScroll: true })
      el.scrollIntoView({ block: "nearest" })
    }
    setFocusRequest(null)
  }, [focusRequest])

  // A dropped row lands in place; only its neighbours slide.
  React.useEffect(() => {
    if (!settleId) return
    const id = requestAnimationFrame(() => setSettleId(null))
    return () => cancelAnimationFrame(id)
  }, [settleId])

  // ---- Edits ----
  const remove = (id: string) => {
    const index = current.indexOf(id)
    const { list, removal } = removeId(current, id)
    if (!removal) return
    if (preview.trackId === id) preview.stop()
    setOrder(list)
    setRemovals((r) => [...r, removal])
    setHeld(null)
    setMessage(`Removed ${titleOf(id)}.`)
    const neighbour = list[index] ?? list[index - 1]
    if (neighbour) setFocusRequest({ id: neighbour, kind: "remove" })
    else requestAnimationFrame(() => undoRef.current?.focus())
  }

  const undo = () => {
    const last = removals.at(-1)
    if (!last) return
    setOrder(restoreRemoval(current, last))
    setRemovals((r) => r.slice(0, -1))
    setMessage(`Restored ${titleOf(last.id)}.`)
    setFocusRequest({ id: last.id, kind: "remove" })
  }

  const save = () => {
    setHeld(null)
    onSave(current, removedIds)
  }

  const open = () => {
    setMessage(`Opening in ${providerName ?? "your music app"}…`)
    onOpen()
  }

  // ---- Keyboard reordering ----
  const position = (list: string[], id: string) =>
    `Position ${list.indexOf(id) + 1} of ${list.length}.`

  const onHandleKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (!canEdit) return
    if (dragRef.current?.active) {
      if (e.key === "Escape") {
        e.preventDefault()
        cancelDrag()
      }
      return
    }
    const name = titleOf(id)
    if (!held) {
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault()
        setHeld({ id, snapshot: current })
        announce(
          `Picked up ${name}. ${position(current, id)} Use the up and down arrow keys to move, Space to drop, Escape to cancel.`,
        )
      }
      return
    }
    if (held.id !== id) return
    switch (e.key) {
      case " ":
      case "Enter":
        e.preventDefault()
        setHeld(null)
        announce(`Dropped ${name}. ${position(current, id)}`)
        return
      case "Tab":
        setHeld(null)
        announce(`Dropped ${name}. ${position(current, id)}`)
        return
      case "Escape": {
        e.preventDefault()
        const back = reconcileOrder(held.snapshot, ids, removedIds)
        setOrder(back)
        setHeld(null)
        setFocusRequest({ id, kind: "handle" })
        announce(`Move cancelled. ${name} is back. ${position(back, id)}`)
        return
      }
    }
    const index = current.indexOf(id)
    const to = indexForKey(e.key, index, n)
    if (to === null) return
    e.preventDefault()
    if (to === index) {
      announce(`${name}. ${position(current, id)}`)
      return
    }
    const next = moveId(current, id, to)
    setOrder(next)
    setFocusRequest({ id, kind: "handle" })
    announce(`${name}. ${position(next, id)}`)
  }

  const onHandleBlur = (e: React.FocusEvent<HTMLButtonElement>, id: string) => {
    // Focus moved elsewhere (not a re-mount): drop the track where it is.
    if (held?.id === id && e.relatedTarget) {
      setHeld(null)
      announce(`Dropped ${titleOf(id)}. ${position(current, id)}`)
    }
  }

  // ---- Pointer reordering (mouse, touch, pen) on the handle ----
  const endDrag = () => {
    dragRef.current = null
    dropRef.current = null
    dragY.set(0)
    setDragId(null)
    setDropIndex(null)
  }

  const cancelDrag = () => {
    const d = dragRef.current
    if (d?.active) announce(`Move cancelled. ${titleOf(d.id)} was not moved.`)
    endDrag()
  }

  const onHandlePointerDown = (
    e: React.PointerEvent<HTMLButtonElement>,
    id: string,
  ) => {
    if (!canEdit || held || dragRef.current) return
    if (e.pointerType === "mouse" && e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      id,
      pointerId: e.pointerId,
      startY: e.clientY,
      startScroll: listRef.current?.scrollTop ?? 0,
      active: false,
    }
  }

  const onHandlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    const list = listRef.current
    if (!d || d.pointerId !== e.pointerId || !list) return
    if (!d.active) {
      if (Math.abs(e.clientY - d.startY) < DRAG_SLOP) return
      d.active = true
      setDragId(d.id)
      announce(`Picked up ${titleOf(d.id)}.`)
    }
    // Scroll a long list when dragging near its edges.
    if (list.scrollHeight > list.clientHeight) {
      const r = list.getBoundingClientRect()
      if (e.clientY < r.top + 32) list.scrollTop -= 12
      else if (e.clientY > r.bottom - 32) list.scrollTop += 12
    }
    dragY.set(e.clientY - d.startY + (list.scrollTop - d.startScroll))
    const mids = [
      ...list.querySelectorAll<HTMLElement>("[data-slot=music-player-track]"),
    ]
      .filter((el) => el.dataset.trackId !== d.id)
      .map((el) => {
        const b = el.getBoundingClientRect()
        return b.top + b.height / 2
      })
    const next = indexFromMidpoints(mids, e.clientY)
    if (next !== dropRef.current) {
      dropRef.current = next
      setDropIndex(next)
    }
  }

  const onHandlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (d.active) {
      const to = dropRef.current
      const from = current.indexOf(d.id)
      if (to !== null && to !== from) {
        const next = moveId(current, d.id, to)
        setOrder(next)
        setSettleId(d.id)
        announce(`Dropped ${titleOf(d.id)}. ${position(next, d.id)}`)
      } else {
        announce(`${titleOf(d.id)} was not moved.`)
      }
    }
    endDrag()
  }

  const indicatorFor = (id: string): "before" | "after" | null => {
    if (!dragId || dropIndex === null) return null
    if (dropIndex === current.indexOf(dragId)) return null
    const others = current.filter((x) => x !== dragId)
    if (dropIndex < others.length) {
      return others[dropIndex] === id ? "before" : null
    }
    return others.at(-1) === id ? "after" : null
  }

  const scrolls = n > SCROLL_AFTER
  const listName = title ?? "playlist"

  return (
    <>
      <SurfaceHeader className="pb-3">
        <SurfaceTitle>
          {saved?.title ?? title ?? (streaming ? undefined : "Playlist")}
        </SurfaceTitle>
        {description && <p className="sr-only">{description}</p>}
        {n > 0 && (
          <p className={cn(genuiType.meta, "tabular-nums")}>
            <span aria-hidden>
              {trackCount(n)} · {formatTotalDuration(total)}
            </span>
            <span className="sr-only">
              {`${trackCount(n)}, ${formatTotalDurationSpoken(total)}`}
            </span>
          </p>
        )}
        {streaming && (
          <p className="text-[13px]">
            <ShimmeringText
              text="Loading playlist…"
              color="var(--muted-foreground)"
              shimmeringColor="var(--foreground)"
            />
          </p>
        )}
      </SurfaceHeader>

      {canEdit && (
        <>
          <p id={instructionsId} className="sr-only">
            Press Space or Enter to pick up this track. Then use the up and down
            arrow keys to move it, Space or Enter to drop it, or Escape to
            cancel.
          </p>
          <p className="sr-only" aria-live="assertive" aria-atomic="true">
            {announcement}
          </p>
        </>
      )}

      <motion.ol
        ref={listRef}
        layoutScroll={scrolls}
        aria-label={`Tracks in ${listName}`}
        data-dragging={dragId ? "true" : undefined}
        className={cn(
          "relative flex flex-col border-t border-border pt-2",
          scrolls &&
            "max-h-[27rem] overflow-y-auto overscroll-auto pb-3 [mask-image:linear-gradient(to_bottom,#000_calc(100%-1rem),transparent)]",
        )}
      >
        {currentTracks.map((track, i) => (
          <TrackRow
            key={track.id}
            track={track}
            index={i}
            pendingArt={streaming}
            canPreview={!streaming}
            preview={preview}
            indicator={indicatorFor(track.id)}
            settle={settleId === track.id}
            editing={
              canEdit
                ? {
                    held: held?.id === track.id,
                    dragging: dragId === track.id,
                    dragY,
                    instructionsId,
                    handleRef: (el) => {
                      if (el) handleEls.current.set(track.id, el)
                      else handleEls.current.delete(track.id)
                    },
                    removeRef: (el) => {
                      if (el) removeEls.current.set(track.id, el)
                      else removeEls.current.delete(track.id)
                    },
                    onHandleKeyDown: (e) => onHandleKeyDown(e, track.id),
                    onHandleBlur: (e) => onHandleBlur(e, track.id),
                    onHandlePointerDown: (e) =>
                      onHandlePointerDown(e, track.id),
                    onHandlePointerMove,
                    onHandlePointerUp,
                    onHandlePointerCancel: cancelDrag,
                    onRemove: () => remove(track.id),
                  }
                : undefined
            }
          />
        ))}
        {streaming && (
          <>
            <RowSkeleton editable={editable} />
            {n === 0 && <RowSkeleton editable={editable} />}
          </>
        )}
        {!streaming && n === 0 && (
          <li className={cn(genuiType.meta, "px-3 py-6 text-center")}>
            No tracks left
          </li>
        )}
      </motion.ol>

      {!streaming && (
        <SurfaceFooter className="justify-between">
          <p
            aria-live="polite"
            className={cn(genuiType.meta, "flex min-w-0 items-center gap-1.5")}
          >
            {status === "saved" ? (
              <>
                <CheckIcon aria-hidden className="size-4 text-foreground" />
                <span className="text-[13px] text-foreground">
                  Saved to your library
                </span>
              </>
            ) : status === "dismissed" ? (
              <span className="text-[13px]">Dismissed. Nothing was saved.</span>
            ) : restoredOpen ? (
              <span className="text-[13px]">
                Opened in {providerName ?? "your music app"}
              </span>
            ) : status === "submitting" ? (
              "Saving…"
            ) : (
              message
            )}
          </p>
          {status !== "saved" && status !== "dismissed" && !restoredOpen && (
            <div className="flex items-center gap-2">
              {!locked && removals.length > 0 && (
                <Button
                  ref={undoRef}
                  size="sm"
                  variant="secondary"
                  onClick={undo}
                >
                  <Undo2Icon aria-hidden />
                  Undo
                  <span className="sr-only">
                    {` removing ${titleOf(removals[removals.length - 1].id)}`}
                  </span>
                </Button>
              )}
              <Tooltip>
                <Menu.Root>
                  <Menu.Trigger
                    disabled={locked}
                    aria-label={`More actions for ${listName}`}
                    render={
                      <TooltipTrigger
                        render={<Button size="icon-sm" variant="ghost" />}
                      />
                    }
                  >
                    <EllipsisIcon aria-hidden />
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner
                      sideOffset={4}
                      align="end"
                      className="isolate z-50 outline-none"
                    >
                      <Menu.Popup className="min-w-44 origin-(--transform-origin) rounded-[10px] bg-popover p-1.5 text-popover-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10 outline-none">
                        {providerName && (
                          <Menu.Item
                            onClick={open}
                            className="flex min-h-9 cursor-default items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                          >
                            Open in {providerName}
                          </Menu.Item>
                        )}
                        <Menu.Item
                          onClick={onDismiss}
                          className="flex min-h-9 cursor-default items-center gap-2 rounded-lg px-3 py-2 text-[13px] outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                        >
                          Dismiss
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
                <TooltipContent>{`More actions for ${listName}`}</TooltipContent>
              </Tooltip>
              <WhyDisabled
                when={!locked && n === 0}
                reason="Add at least one track first"
              >
                <Button size="sm" disabled={locked || n === 0} onClick={save}>
                  {status === "submitting" ? "Saving…" : "Save playlist"}
                </Button>
              </WhyDisabled>
            </div>
          )}
        </SurfaceFooter>
      )}
    </>
  )
}

// ---- Root ----

export function MusicPlayer({
  mode,
  title,
  description,
  provider,
  tracks = [],
  nowPlaying,
  editable = true,
  totalDurationSeconds,
  status: statusProp,
  onResult,
  result,
  className,
}: MusicPlayerProps) {
  const preview = usePreview()
  const playlistResult = mode === "playlist" ? result : undefined
  const [decision, setDecision] = React.useState<"saved" | "dismissed" | null>(
    () =>
      playlistResult?.action === "save-playlist"
        ? "saved"
        : playlistResult?.action === "dismiss"
          ? "dismissed"
          : null,
  )

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: MusicPlayerStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const ready = tracks.filter(isReadyTrack)
  const label = mode === "now-playing" ? "Now playing" : (title ?? "Playlist")

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="music-player"
        data-status={status}
        data-mode={mode}
        aria-busy={streaming || status === "submitting"}
        aria-label={label}
        className={cn("@container", className)}
      >
        {preview.element}
        {mode === "now-playing" ? (
          <NowPlayingView
            title={title}
            tracks={ready}
            nowPlaying={nowPlaying}
            provider={provider}
            streaming={streaming}
            preview={preview}
            onResult={onResult}
          />
        ) : mode === "playlist" ? (
          <PlaylistView
            title={title}
            description={description}
            provider={provider}
            tracks={ready}
            editable={editable}
            totalDurationSeconds={totalDurationSeconds}
            status={status}
            streaming={streaming}
            restoredOpen={playlistResult?.action === "open-in-provider"}
            result={playlistResult}
            preview={preview}
            onSave={(trackIds, removed) => {
              setDecision("saved")
              onResult?.({
                action: "save-playlist",
                title: title ?? "Playlist",
                trackIds,
                removed,
              })
            }}
            onDismiss={() => {
              preview.stop()
              setDecision("dismissed")
              onResult?.({ action: "dismiss" })
            }}
            onOpen={() => onResult?.({ action: "open-in-provider" })}
          />
        ) : (
          // The mode hasn't streamed in yet.
          <>
            <SurfaceHeader>
              <SurfaceTitle />
              <p className="text-[13px]">
                <ShimmeringText
                  text="Loading…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              </p>
            </SurfaceHeader>
            <ul
              aria-hidden
              className="flex flex-col border-t border-border pt-2"
            >
              <RowSkeleton />
              <RowSkeleton />
            </ul>
          </>
        )}
      </Surface>
    </MotionConfig>
  )
}
