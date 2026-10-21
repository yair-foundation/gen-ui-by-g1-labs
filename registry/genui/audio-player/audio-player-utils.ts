/**
 * Audio Player: pure helpers, no React or DOM.
 */

/**
 * Resamples precomputed peaks (0–1) to `count` bars. Downsampling keeps each
 * bucket's loudest value so short sounds don't vanish; upsampling interpolates.
 */
export function resamplePeaks(peaks: number[], count: number): number[] {
  const n = Math.max(0, Math.floor(count))
  const clean = peaks.map((p) =>
    Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0,
  )
  if (n === 0 || clean.length === 0) return []
  if (clean.length === n) return clean
  if (clean.length > n) {
    const out: number[] = []
    for (let i = 0; i < n; i++) {
      const from = Math.floor((i * clean.length) / n)
      const to = Math.max(from + 1, Math.floor(((i + 1) * clean.length) / n))
      let max = 0
      for (let j = from; j < to; j++) max = Math.max(max, clean[j])
      out.push(max)
    }
    return out
  }
  if (clean.length === 1) return Array.from({ length: n }, () => clean[0])
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    const at = (i * (clean.length - 1)) / (n - 1)
    const lo = Math.floor(at)
    const hi = Math.min(clean.length - 1, lo + 1)
    out.push(clean[lo] + (clean[hi] - clean[lo]) * (at - lo))
  }
  return out
}

function whole(seconds: number) {
  return Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
}

/** "1:12", or "1:04:03" past an hour. */
export function formatTime(seconds: number): string {
  const total = whole(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`
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

/** The slider's aria-valuetext: "1 minute 12 seconds of 4 minutes 3 seconds". */
export function positionText(current: number, duration: number): string {
  return `${formatTimeSpoken(current)} of ${formatTimeSpoken(duration)}`
}

export type TimedSegment = { start: number; end: number }

/** Index of the segment playing at `time`, or -1 between segments. */
export function segmentIndexAt(segments: TimedSegment[], time: number): number {
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]
    if (time >= s.start && time < s.end) return i
  }
  return -1
}

/** Keeps `time` within 0…duration. */
export function clampTime(time: number, duration: number): number {
  if (!Number.isFinite(time)) return 0
  return Math.min(Math.max(0, duration), Math.max(0, time))
}

/** Where a key press on the waveform slider should seek, or null to ignore it. */
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

/**
 * The audio URL if it's safe to load: http(s), a blob: URL, or a data:audio
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

/** Whether a (safe) URL is on the web, i.e. it would open in a new tab. */
export function isWebUrl(url: string): boolean {
  return /^https?:/i.test(url)
}

/** A download file name from the title: "Voiceover draft" → "voiceover-draft". */
export function fileNameFor(title: string | undefined): string {
  const slug = (title ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return slug || "recording"
}
