"use client"

import * as React from "react"
import { PauseIcon, PlayIcon } from "lucide-react"
import { LayoutGroup, MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import {
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
  genuiType,
} from "@/components/genui/surface"
import { IconTip } from "@/components/genui/hint"

import {
  isReadyAlbum,
  letteringLines,
  letteringSize,
  type PartialAlbum,
  playerAnnouncement,
  rackColumns,
  safeAudioUrl,
  safeImageUrl,
  stateFromResult,
} from "./cd-player-utils"
import type { CdAlbum, CdPlayerInput, CdPlayerResult } from "./cd-player.schema"

export type CdPlayerStatus = "streaming" | "ready"

export type CdPlayerProps = Partial<Omit<CdPlayerInput, "albums">> & {
  /** Albums may be partial while the tool call streams. */
  albums?: PartialAlbum[]
  /**
   * Lifecycle, controlled by the host. 'streaming' while the agent is still
   * generating props: discs show as they arrive and can't be picked yet.
   */
  status?: CdPlayerStatus
  /** Called each time the user puts a disc in, pauses it or starts it again. */
  onResult?: (result: CdPlayerResult) => void
  /**
   * The last play or pause from history. Puts that disc back in the player
   * without calling onResult; a preview waits for the user to press play.
   */
  result?: CdPlayerResult
  className?: string
}

/** One turn of a spinning disc. Slow enough to read the artwork go round. */
const SPIN = "animate-[spin_3.2s_linear_infinite] motion-reduce:animate-none"

/** A light catching the disc. Stays still while the face turns under it. */
const SHEEN =
  "conic-gradient(from 20deg, rgb(255 255 255 / 0) 0deg, rgb(255 255 255 / 0.32) 35deg, rgb(255 255 255 / 0) 75deg, rgb(255 255 255 / 0) 160deg, rgb(255 255 255 / 0.22) 210deg, rgb(255 255 255 / 0) 250deg, rgb(255 255 255 / 0) 360deg)"

/** Fine rings pressed into the disc. Round, so they don't need to turn. */
const GROOVES =
  "repeating-radial-gradient(circle, rgb(255 255 255 / 0) 0 2px, rgb(255 255 255 / 0.06) 2px 3px)"

/**
 * A blank silver disc, drawn from the theme's own neutrals. Dark mode mixes in
 * more of the foreground so the disc stands off a black card.
 */
const SILVER =
  "conic-gradient(from 0deg, color-mix(in oklab, var(--foreground) var(--cd-lo), var(--card)), color-mix(in oklab, var(--foreground) var(--cd-hi), var(--card)), color-mix(in oklab, var(--foreground) var(--cd-lo), var(--card)), color-mix(in oklab, var(--foreground) var(--cd-hi), var(--card)), color-mix(in oklab, var(--foreground) var(--cd-lo), var(--card)))"
const SILVER_MIX =
  "[--cd-lo:5%] [--cd-hi:16%] dark:[--cd-lo:20%] dark:[--cd-hi:36%]"

/**
 * Handwritten lettering, as on the recording the component was built from
 * (D55): only on disc artwork, never for UI text. Falls back to the browser's
 * cursive face where the host hasn't loaded the font.
 */
const MARKER = "var(--font-marker, 'Gochi Hand', cursive)"

/**
 * Marker ink on artwork: the same near-black in both themes, since the
 * artwork doesn't change with the theme (like type on artwork, D27).
 */
const INK = "#141414"

function albumName(album: CdAlbum) {
  return `${album.title} by ${album.artist}`
}

// ---- The disc ----

function Disc({
  album,
  large = false,
  spinning = false,
}: {
  /** Nothing for the player's blank disc. */
  album?: CdAlbum
  large?: boolean
  spinning?: boolean
}) {
  const src = safeImageUrl(album?.artwork?.src)
  const [broken, setBroken] = React.useState<string | null>(null)
  const art = src && broken !== src ? src : null

  return (
    <span
      aria-hidden
      className="pointer-events-none relative block size-full overflow-hidden rounded-full ring-1 ring-foreground/10 ring-inset"
    >
      {/* The face turns; the light and the hub stay put. */}
      <span
        className={cn(
          "absolute inset-0 rounded-full",
          SILVER_MIX,
          large && SPIN,
          large && !spinning && "[animation-play-state:paused]",
        )}
        style={{ backgroundImage: SILVER }}
      >
        {art ? (
          // biome-ignore lint/performance/noImgElement: provider artwork URLs; next/image would need every host configured
          <img
            src={art}
            alt=""
            draggable={false}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(art)}
            className="size-full rounded-full object-cover"
          />
        ) : null}
        {album && <Lettering text={album.artist} onArtwork={!!art} />}
      </span>
      <span
        className="absolute inset-0 rounded-full mix-blend-soft-light"
        style={{ backgroundImage: `${SHEEN}, ${GROOVES}` }}
      />
      {/* The clear hub, its stacking ring and the hole through the middle. */}
      <span className="absolute inset-[33%] rounded-full bg-background/40 ring-1 ring-background/50 ring-inset dark:bg-foreground/20 dark:ring-foreground/25" />
      <span className="absolute inset-[40%] rounded-full ring-1 ring-foreground/10" />
      <span className="absolute inset-[44%] rounded-full bg-card ring-1 ring-foreground/15" />
    </span>
  )
}

/**
 * The artist's name written on the disc in marker, above and below the hub.
 * Sized against the disc (container units), so a small disc carries the same
 * writing as the big one. Decorative: the name is in every label.
 */
function Lettering({ text, onArtwork }: { text: string; onArtwork: boolean }) {
  const lines = letteringLines(text)
  const size = letteringSize(lines)
  return (
    <span
      className={cn(
        "absolute inset-0 -rotate-[8deg] @container",
        !onArtwork && "text-foreground",
      )}
      style={{
        fontFamily: MARKER,
        color: onArtwork ? INK : undefined,
      }}
    >
      {(["above", "below"] as const).map((place, i) =>
        lines[i] ? (
          <span
            key={place}
            className="absolute inset-x-[8%] -translate-y-1/2 text-center leading-none whitespace-nowrap"
            style={{
              top: place === "above" ? "24%" : "76%",
              fontSize: `${size}cqw`,
            }}
          >
            {lines[i]}
          </span>
        ) : null,
      )}
    </span>
  )
}

// ---- Preview playback (one <audio> for the whole player) ----

function usePreview() {
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const [playingSrc, setPlayingSrc] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState<ReadonlySet<string>>(
    () => new Set(),
  )

  React.useEffect(() => {
    const a = audioRef.current
    return () => a?.pause()
  }, [])

  const play = (src: string) => {
    const a = audioRef.current
    if (!a) return
    if (a.getAttribute("src") !== src) a.src = src
    // Counts as playing from the press, so the disc doesn't wait on loading.
    setPlayingSrc(src)
    a.play().catch(() => setPlayingSrc(null))
  }
  const pause = () => audioRef.current?.pause()

  const element = (
    // biome-ignore lint/a11y/useMediaCaption: short music previews have no captions
    <audio
      ref={audioRef}
      loop
      preload="none"
      onPlay={(e) => setPlayingSrc(e.currentTarget.getAttribute("src"))}
      onPause={() => setPlayingSrc(null)}
      onError={(e) => {
        const src = e.currentTarget.getAttribute("src")
        if (src) setFailed((prev) => new Set(prev).add(src))
        setPlayingSrc(null)
      }}
    />
  )

  return { element, playingSrc, failed, play, pause }
}

// ---- The component ----

export function CdPlayer({
  title,
  albums: rawAlbums,
  nowPlayingId,
  status = "ready",
  onResult,
  result,
  className,
}: CdPlayerProps) {
  const groupId = React.useId()
  const streaming = status === "streaming"
  const albums = rawAlbums ?? []
  const ready = albums.filter(isReadyAlbum)
  const ids = ready.map((a) => a.id)

  // The user's own pick wins; before it, history, then what the provider
  // reports. `here` is true when the disc plays its preview in the chat, false
  // when it plays on the user's device.
  const [picked, setPicked] = React.useState<{
    albumId: string | null
    paused: boolean
    here: boolean
  } | null>(null)
  const restored = stateFromResult(result, ids)
  const fallback =
    restored.albumId !== null
      ? { ...restored, here: true }
      : {
          albumId:
            nowPlayingId && ids.includes(nowPlayingId) ? nowPlayingId : null,
          paused: false,
          here: false,
        }
  const { albumId, paused, here } = picked ?? fallback
  const inserted = ready.find((a) => a.id === albumId)

  const preview = usePreview()
  const insertedSrc = safeAudioUrl(inserted?.previewUrl)
  const hasPreview = !!insertedSrc && !preview.failed.has(insertedSrc)
  // A disc playing its preview here spins while the preview plays; one playing
  // on the user's device spins until they stop it.
  const spinning =
    !!inserted &&
    !paused &&
    (here && hasPreview ? preview.playingSrc === insertedSrc : true)

  const [announcement, setAnnouncement] = React.useState("")
  const wellButtonRef = React.useRef<HTMLButtonElement>(null)
  const wellRef = React.useRef<HTMLDivElement>(null)
  const focusWell = React.useRef(false)
  const dragged = React.useRef(false)

  React.useEffect(() => {
    if (!focusWell.current || !albumId) return
    focusWell.current = false
    wellButtonRef.current?.focus({ preventScroll: true })
  }, [albumId])

  const play = (album: CdAlbum) => {
    const src = safeAudioUrl(album.previewUrl)
    const playable = !!src && !preview.failed.has(src)
    if (playable) preview.play(src)
    else preview.pause()
    setPicked({ albumId: album.id, paused: false, here: playable })
    setAnnouncement(playerAnnouncement(album, false))
    onResult?.({ action: "play", albumId: album.id })
  }

  const insert = (album: CdAlbum, fromRack: boolean) => {
    if (streaming) return
    focusWell.current = fromRack
    play(album)
  }

  const toggle = () => {
    if (!inserted || streaming) return
    if (spinning) {
      preview.pause()
      setPicked({ albumId: inserted.id, paused: true, here })
      setAnnouncement(playerAnnouncement(inserted, true))
      onResult?.({ action: "pause", albumId: inserted.id })
    } else {
      play(inserted)
    }
  }

  /** A disc let go over the player goes in. */
  const droppedOnWell = (point: { x: number; y: number }) => {
    const r = wellRef.current?.getBoundingClientRect()
    if (!r) return false
    const x = point.x - window.scrollX
    const y = point.y - window.scrollY
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }

  const columns = rackColumns(albums.length)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="cd-player"
        data-status={status}
        aria-busy={streaming || undefined}
        className={className}
      >
        {title && (
          <SurfaceHeader>
            <SurfaceTitle>{title}</SurfaceTitle>
          </SurfaceHeader>
        )}
        <LayoutGroup id={groupId}>
          <div
            className={cn(
              "flex flex-col items-center gap-3 px-3 py-5",
              title && "border-t border-border",
            )}
          >
            {/* The player: a blank disc until one goes in on top of it. */}
            <div
              ref={wellRef}
              data-slot="cd-player-well"
              className="relative grid size-44 place-items-center rounded-[10px] border border-border"
            >
              <span className="size-38">
                <Disc />
              </span>
              {inserted && (
                <IconTip key={inserted.id} label={spinning ? "Pause" : "Play"}>
                  <motion.button
                    ref={wellButtonRef}
                    layoutId={`${groupId}-${inserted.id}`}
                    transition={genuiMotion.gentle}
                    type="button"
                    disabled={streaming}
                    aria-label={`${spinning ? "Pause" : "Play"} ${albumName(inserted)}`}
                    onClick={toggle}
                    className="group/well absolute inset-0 m-auto size-38 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Disc album={inserted} large spinning={spinning} />
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-background/85 text-foreground transition-opacity duration-150",
                        spinning
                          ? "opacity-0 group-hover/well:opacity-100 group-focus-visible/well:opacity-100"
                          : "opacity-100",
                      )}
                    >
                      {spinning ? (
                        <PauseIcon className="size-4 fill-current" />
                      ) : (
                        <PlayIcon className="size-4 translate-x-px fill-current" />
                      )}
                    </span>
                  </motion.button>
                </IconTip>
              )}
            </div>

            {/* What's in the player, two lines held so nothing jumps. */}
            <div className="flex min-h-[46px] w-full max-w-72 flex-col items-center justify-center text-center">
              {inserted ? (
                <>
                  <p className={cn(genuiType.title, "w-full truncate")}>
                    {inserted.title}
                  </p>
                  <p className={cn(genuiType.meta, "w-full truncate")}>
                    {inserted.artist}
                  </p>
                </>
              ) : (
                <p className={cn(genuiType.meta, "font-normal")}>
                  {streaming ? "Finding albums" : "Pick a disc"}
                </p>
              )}
            </div>
            <span className="sr-only" aria-live="polite">
              {announcement}
            </span>
          </div>

          {/* The rack. A disc in the player leaves its slot empty. */}
          <div className="border-t border-border px-3 py-4">
            <ul
              aria-label="Albums"
              className="grid w-full justify-center gap-3"
              style={{
                // 56px discs that shrink to fit a narrow card.
                gridTemplateColumns: `repeat(${columns}, minmax(0, 3.5rem))`,
              }}
            >
              {albums.map((album, i) => {
                const key = album.id || `pending-${i}`
                if (!isReadyAlbum(album)) {
                  return (
                    <li key={key} className="aspect-square">
                      <Skeleton className="size-full rounded-full" />
                    </li>
                  )
                }
                if (album.id === inserted?.id) {
                  return (
                    <li
                      key={key}
                      aria-hidden
                      className="aspect-square rounded-full border border-dashed border-border"
                    />
                  )
                }
                return (
                  <li key={key} className="aspect-square">
                    <IconTip label={`${album.title} · ${album.artist}`}>
                      <motion.button
                        layoutId={`${groupId}-${album.id}`}
                        transition={genuiMotion.gentle}
                        type="button"
                        disabled={streaming}
                        aria-label={`Play ${albumName(album)}`}
                        drag={!streaming}
                        dragSnapToOrigin
                        dragElastic={0.6}
                        whileDrag={{ scale: 1.15, zIndex: 20 }}
                        whileHover={streaming ? undefined : { scale: 1.06 }}
                        whileTap={streaming ? undefined : { scale: 0.96 }}
                        onDragStart={() => {
                          dragged.current = true
                        }}
                        onDragEnd={(_, info) => {
                          if (droppedOnWell(info.point)) insert(album, false)
                          // Forget the drag once its trailing click has passed.
                          window.setTimeout(() => {
                            dragged.current = false
                          }, 0)
                        }}
                        onClick={() => {
                          // The click that ends a drag isn't a pick.
                          if (dragged.current) {
                            dragged.current = false
                            return
                          }
                          insert(album, true)
                        }}
                        className="relative block size-full cursor-grab touch-none rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing disabled:cursor-default"
                      >
                        <Disc album={album} />
                      </motion.button>
                    </IconTip>
                  </li>
                )
              })}
            </ul>
          </div>
        </LayoutGroup>
        {preview.element}
      </Surface>
    </MotionConfig>
  )
}
