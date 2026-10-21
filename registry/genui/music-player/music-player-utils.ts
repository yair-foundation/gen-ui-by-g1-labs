/**
 * Music Player: pure helpers, no React or DOM.
 */

export type RepeatMode = "off" | "all" | "one"

function whole(seconds: number) {
  return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
}

/** A track length or position: "3:40", or "1:04:03" past an hour. */
export function formatTrackTime(seconds: number): string {
  const total = whole(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
}

/** A playlist length: "47 min", "1 h 12 min", "2 h", "45 sec". */
export function formatTotalDuration(seconds: number): string {
  const total = whole(seconds)
  if (total < 60) return `${total} sec`
  const minutes = Math.round(total / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Spoken form of a playlist length: "47 minutes", "1 hour 12 minutes". */
export function formatTotalDurationSpoken(seconds: number): string {
  const total = whole(seconds)
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  if (total < 60) return unit(total, "second")
  const minutes = Math.round(total / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return unit(m, "minute")
  return m === 0 ? unit(h, "hour") : `${unit(h, "hour")} ${unit(m, "minute")}`
}

/** "1 minute 12 seconds", "0 seconds". */
export function formatTimeSpoken(seconds: number): string {
  const total = whole(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`
  const out: string[] = []
  if (h) out.push(unit(h, "hour"))
  if (m) out.push(unit(m, "minute"))
  if (s || out.length === 0) out.push(unit(s, "second"))
  return out.join(" ")
}

/** A slider's aria-valuetext: "1 minute 12 seconds of 3 minutes 40 seconds". */
export function positionText(current: number, duration: number): string {
  return `${formatTimeSpoken(current)} of ${formatTimeSpoken(duration)}`
}

/** Sum of track lengths in seconds, ignoring missing or invalid values. */
export function totalDuration(
  tracks: { durationSeconds?: number | null }[],
): number {
  let sum = 0
  for (const t of tracks) {
    const d = t.durationSeconds
    if (typeof d === "number" && Number.isFinite(d) && d > 0) sum += d
  }
  return sum
}

/** "1 track", "12 tracks". */
export function trackCount(count: number): string {
  return `${count} ${count === 1 ? "track" : "tracks"}`
}

/** Keeps `time` within 0…duration. */
export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0
  return Math.min(Math.max(0, duration), Math.max(0, time))
}

/** Where a key press on a progress slider should seek, or null to ignore it. */
export function seekForKey(
  key: string,
  current: number,
  duration: number,
): number | null {
  const step: Record<string, number> = {
    ArrowLeft: -5,
    ArrowDown: -5,
    ArrowRight: 5,
    ArrowUp: 5,
    PageDown: -30,
    PageUp: 30,
  }
  if (key === "Home") return 0
  if (key === "End") return Math.max(0, duration)
  if (key in step) return clampTime(current + step[key], duration)
  return null
}

/** off → all → one → off. */
export function nextRepeat(mode: RepeatMode): RepeatMode {
  return mode === "off" ? "all" : mode === "all" ? "one" : "off"
}

/**
 * Which track plays when the current one ends, or null when playback stops.
 * Mirrors what a music app does with its repeat setting.
 */
export function indexAfterEnd(
  index: number,
  count: number,
  repeat: RepeatMode,
): number | null {
  if (count <= 0) return null
  if (repeat === "one") return index
  if (index + 1 < count) return index + 1
  return repeat === "all" ? 0 : null
}

/**
 * Up to two initials for a placeholder tile: "Low Tide Club" → "LT",
 * "nightswim" → "N". Letters and digits only.
 */
export function initials(name: string | undefined): string {
  if (!name) return ""
  const words = name
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .filter(Boolean)
  return words.slice(0, 2).join("").toLocaleUpperCase()
}

// ---- Ordered list editing (the playlist) ----

/** Moves `id` to `toIndex` (clamped). Returns the same array when nothing moves. */
export function moveId(list: string[], id: string, toIndex: number): string[] {
  const from = list.indexOf(id)
  if (from < 0) return list
  const rest = list.filter((x) => x !== id)
  const to = Math.max(0, Math.min(Math.floor(toIndex), rest.length))
  if (to === from) return list
  rest.splice(to, 0, id)
  return rest
}

export type Removal = { id: string; index: number }

/** Removes `id`, remembering where it was so it can be restored. */
export function removeId(
  list: string[],
  id: string,
): { list: string[]; removal: Removal | null } {
  const index = list.indexOf(id)
  if (index < 0) return { list, removal: null }
  return { list: list.filter((x) => x !== id), removal: { id, index } }
}

/** Puts a removed id back at its old position (clamped). No-op if present. */
export function restoreRemoval(list: string[], removal: Removal): string[] {
  if (list.includes(removal.id)) return list
  const next = [...list]
  next.splice(Math.max(0, Math.min(removal.index, next.length)), 0, removal.id)
  return next
}

/**
 * Keeps a user's order in step with the latest data: drops ids that no longer
 * exist or were removed, and appends new ones (e.g. while streaming).
 */
export function reconcileOrder(
  order: string[],
  ids: string[],
  removed: Iterable<string> = [],
): string[] {
  const known = new Set(ids)
  const gone = new Set(removed)
  const seen = new Set<string>()
  const next: string[] = []
  for (const id of order) {
    if (known.has(id) && !gone.has(id) && !seen.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  for (const id of ids) {
    if (!seen.has(id) && !gone.has(id)) {
      seen.add(id)
      next.push(id)
    }
  }
  return next
}

/** The target index for a keyboard move, or null when the key doesn't move. */
export function indexForKey(
  key: string,
  index: number,
  length: number,
): number | null {
  const last = Math.max(0, length - 1)
  switch (key) {
    case "ArrowUp":
      return Math.max(0, index - 1)
    case "ArrowDown":
      return Math.min(last, index + 1)
    case "Home":
      return 0
    case "End":
      return last
    default:
      return null
  }
}

/**
 * Drop position from the pointer's y: the number of rows (excluding the one
 * being dragged) whose vertical midpoint lies above it.
 */
export function indexFromMidpoints(midpoints: number[], y: number): number {
  let index = 0
  for (const mid of midpoints) if (mid < y) index++
  return index
}

// ---- Safe URLs ----

/** The URL when it is an absolute http(s) link, otherwise null. */
export function safeHttpUrl(url?: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url.trim())
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}

/**
 * Artwork URL if safe to load: http(s), a same-origin path that starts with a
 * single "/", or a data:image URL.
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
  if (/^data:/i.test(trimmed)) {
    return /^data:audio\/[a-z0-9.+-]+[;,]/i.test(trimmed) ? trimmed : null
  }
  try {
    const u = new URL(trimmed)
    if (u.protocol === "http:" || u.protocol === "https:") return u.href
    if (u.protocol === "blob:") return trimmed
    return null
  } catch {
    return null
  }
}
