import type { CdAlbum, CdPlayerResult } from "./cd-player.schema"

/** An album as it may arrive while the tool call streams. */
export type PartialAlbum = Omit<Partial<CdAlbum>, "artwork"> & {
  artwork?: { src?: string; alt?: string }
}

/** Has everything a disc needs to be picked. */
export function isReadyAlbum(a: PartialAlbum | undefined): a is CdAlbum {
  return (
    !!a &&
    typeof a.id === "string" &&
    a.id !== "" &&
    typeof a.title === "string" &&
    a.title !== "" &&
    typeof a.artist === "string" &&
    a.artist !== ""
  )
}

/**
 * Columns for the disc rack, so no row is left with one disc on its own:
 * up to 4 on one row, 5–6 as 3 + 3 (or 3 + 2), 7–8 as 4 + 4 (or 4 + 3).
 */
export function rackColumns(count: number): number {
  if (count <= 4) return Math.max(1, count)
  if (count <= 6) return 3
  return 4
}

/**
 * The artist's name as it's written on a disc: one line above the hub and one
 * below, split between words so the two lines are as even as they can be. A
 * single word goes above the hub alone.
 */
export function letteringLines(text: string): [string, string] {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length <= 1) return [words[0] ?? "", ""]
  let best = 1
  let bestGap = Number.POSITIVE_INFINITY
  for (let k = 1; k < words.length; k++) {
    const gap = Math.abs(
      words.slice(0, k).join(" ").length - words.slice(k).join(" ").length,
    )
    if (gap < bestGap) {
      best = k
      bestGap = gap
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")]
}

/**
 * Lettering size as a percentage of the disc's width, so a small disc carries
 * the same writing as the big one, scaled down. Long lines get smaller so
 * they stay on the disc: about 15% of the width for short names, never under 6%.
 */
export function letteringSize(lines: readonly string[]): number {
  const longest = Math.max(1, ...lines.map((l) => Array.from(l).length))
  return Math.max(6, Math.min(15, Math.round((150 / longest) * 10) / 10))
}

/** What a screen reader hears when the player changes. */
export function playerAnnouncement(
  album: Pick<CdAlbum, "title" | "artist"> | undefined,
  paused: boolean,
): string {
  if (!album) return "The player is empty"
  return `${paused ? "Paused" : "Playing"} ${album.title} by ${album.artist}`
}

/**
 * The player's state from a result in history: which disc is in and whether
 * it was stopped. An id that isn't among the albums leaves the player empty.
 */
export function stateFromResult(
  result: CdPlayerResult | undefined,
  ids: readonly string[],
): { albumId: string | null; paused: boolean } {
  if (!result || !ids.includes(result.albumId))
    return { albumId: null, paused: false }
  return { albumId: result.albumId, paused: result.action === "pause" }
}

/** An http(s) URL, or null. */
export function safeHttpUrl(url?: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url.trim())
    return u.protocol === "http:" || u.protocol === "https:"
      ? u.toString()
      : null
  } catch {
    return null
  }
}

/**
 * Artwork URL if safe to load: http(s), a same-origin path, or a data:image
 * URL. Anything else returns null.
 */
export function safeImageUrl(url?: string | null): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (/^\/(?![/\\])/.test(trimmed)) return trimmed
  if (/^data:/i.test(trimmed)) {
    return /^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml)[;,]/i.test(trimmed)
      ? trimmed
      : null
  }
  return safeHttpUrl(trimmed)
}

/**
 * Preview audio URL if safe to load: http(s), a blob: URL, or a data:audio
 * URL (host-generated audio). Anything else returns null.
 */
export function safeAudioUrl(url?: string | null): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (/^blob:/i.test(trimmed)) return trimmed
  if (/^data:/i.test(trimmed))
    return /^data:audio\//i.test(trimmed) ? trimmed : null
  return safeHttpUrl(trimmed)
}
