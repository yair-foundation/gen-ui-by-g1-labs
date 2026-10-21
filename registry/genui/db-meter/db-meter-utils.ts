/**
 * dB Meter: pure helpers (no React, no Web Audio), so they can be unit-tested
 * in Node.
 *
 * - meanSquare / rms / rmsToDbfs / meanSquareToDbfs: the level of a block of
 *   time-domain samples, in dB relative to full scale (dBFS).
 * - toApproxDb: dBFS → an approximate sound level, `dB ≈ dBFS + offset`.
 *   Browser microphones are uncalibrated, so this is only an estimate.
 * - timeWeight: exponential ("Fast", 125 ms) smoothing of the mean square.
 * - bandFor / BANDS: Quiet … Harmful, with a plain example per band.
 * - purposeVerdict / purposeGuidance: the recording, sleep and workplace lines.
 * - leq: the energy average of a series of levels.
 * - decayPeak: the gauge's peak-hold marker.
 * - filledSegments / segmentIndex: the segmented gauge.
 * - sparklinePoints / sparklineDomain: the level history line.
 */

// ---------------------------------------------------------------------------
// Levels
// ---------------------------------------------------------------------------

/** The quietest level reported, in dBFS. Silence and invalid input map here. */
export const DBFS_FLOOR = -100

/** Default calibration: −20 dBFS ≈ 74 dB. */
export const DEFAULT_OFFSET = 94

/** The gauge's range, in dB. */
export const GAUGE_MIN = 20
export const GAUGE_MAX = 120

/** Mean of the squared samples (the signal's power). Non-finite samples count as 0. */
export function meanSquare(samples: ArrayLike<number>): number {
  const n = samples.length
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const s = samples[i]
    if (Number.isFinite(s)) sum += s * s
  }
  return sum / n
}

/** Root mean square of the samples. */
export function rms(samples: ArrayLike<number>): number {
  return Math.sqrt(meanSquare(samples))
}

/** RMS (1 = full scale) → dBFS, never below the floor. */
export function rmsToDbfs(value: number, floor = DBFS_FLOOR): number {
  if (!Number.isFinite(value) || value <= 0) return floor
  return Math.max(floor, 20 * Math.log10(value))
}

/** Mean square → dBFS (same as `rmsToDbfs(√ms)`), never below the floor. */
export function meanSquareToDbfs(value: number, floor = DBFS_FLOOR): number {
  if (!Number.isFinite(value) || value <= 0) return floor
  return Math.max(floor, 10 * Math.log10(value))
}

/** A usable calibration offset: finite, 0–140, else the default. */
export function normalizeOffset(offset: unknown): number {
  if (typeof offset !== "number" || !Number.isFinite(offset)) {
    return DEFAULT_OFFSET
  }
  return Math.min(140, Math.max(0, offset))
}

/**
 * dBFS → approximate sound level: `dB ≈ dBFS + offset`, never below 0.
 * With the default offset of 94, −20 dBFS ≈ 74 dB.
 */
export function toApproxDb(dbfs: number, offset = DEFAULT_OFFSET): number {
  if (!Number.isFinite(dbfs)) return 0
  return Math.max(0, dbfs + normalizeOffset(offset))
}

/**
 * Exponential time weighting of the mean square, like a sound level meter's
 * "Fast" setting (τ = 125 ms). `dtMs` is the time since the previous value.
 */
export function timeWeight(
  previous: number,
  next: number,
  dtMs: number,
  tauMs = 125,
): number {
  if (!Number.isFinite(previous)) return next
  if (!Number.isFinite(next)) return previous
  const dt = Math.max(0, Number.isFinite(dtMs) ? dtMs : 0)
  const k = 1 - Math.exp(-dt / Math.max(1, tauMs))
  return previous + (next - previous) * k
}

/** A level is a finite number in a plausible range (−20 to 200 dB). */
export function isLevel(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -20 &&
    value <= 200
  )
}

// ---------------------------------------------------------------------------
// Bands
// ---------------------------------------------------------------------------

export type BandId =
  | "quiet"
  | "moderate"
  | "conversation"
  | "loud"
  | "very-loud"
  | "harmful"

export type Band = {
  id: BandId
  label: string
  /** Inclusive lower edge, in dB. */
  from: number
  /** A plain, everyday comparison. */
  example: string
  /** At or above 85 dB: shown with the destructive token (plus text). */
  warning: boolean
}

export const BANDS: readonly Band[] = [
  {
    id: "quiet",
    label: "Quiet",
    from: Number.NEGATIVE_INFINITY,
    example: "A quiet bedroom at night is around 30 dB",
    warning: false,
  },
  {
    id: "moderate",
    label: "Moderate",
    from: 40,
    example: "A quiet office is around 50 dB",
    warning: false,
  },
  {
    id: "conversation",
    label: "Conversation",
    from: 60,
    example: "Normal conversation is around 60 dB",
    warning: false,
  },
  {
    id: "loud",
    label: "Loud",
    from: 70,
    example: "A vacuum cleaner is around 75 dB",
    warning: false,
  },
  {
    id: "very-loud",
    label: "Very loud",
    from: 85,
    example: "A food blender is around 90 dB",
    warning: true,
  },
  {
    id: "harmful",
    label: "Harmful",
    from: 100,
    example: "A rock concert is around 110 dB",
    warning: true,
  },
]

/** Band edges shown as gauge ticks (plus the gauge's ends). */
export const BAND_EDGES = [40, 60, 70, 85, 100] as const

/** Index of the band a level falls in (edges belong to the band above). */
export function bandIndex(level: number): number {
  if (!Number.isFinite(level)) return 0
  for (let i = BANDS.length - 1; i > 0; i--) {
    if (level >= BANDS[i].from) return i
  }
  return 0
}

/** The band a level falls in: <40 Quiet, 40–59 Moderate, 60–69 Conversation, 70–84 Loud, 85–99 Very loud, ≥100 Harmful. */
export function bandFor(level: number): Band {
  return BANDS[bandIndex(level)]
}

// ---------------------------------------------------------------------------
// Purpose
// ---------------------------------------------------------------------------

export type Purpose = "general" | "recording" | "sleep" | "workplace"

export type Verdict = {
  text: string
  /** True when the level is fine for the purpose. */
  ok: boolean
  /** The purpose's threshold, in dB. */
  threshold: number
}

export const PURPOSE_THRESHOLD: Record<Exclude<Purpose, "general">, number> = {
  recording: 40,
  sleep: 35,
  workplace: 85,
}

/** The guidance shown before there is a level to judge. Null for "general". */
export function purposeGuidance(purpose: Purpose | undefined): string | null {
  switch (purpose) {
    case "recording":
      return "For clean voice recording, aim for under 40 dB."
    case "sleep":
      return "For sleep, aim for under 35 dB."
    case "workplace":
      return "Above 85 dB, hearing protection is recommended for long exposure."
    default:
      return null
  }
}

/** The verdict line for a level. Null for "general" or no level. */
export function purposeVerdict(
  purpose: Purpose | undefined,
  level: number | null | undefined,
): Verdict | null {
  if (typeof level !== "number" || !Number.isFinite(level)) return null
  const value = Math.round(level)
  switch (purpose) {
    case "recording":
      return value < 40
        ? {
            text: "Quiet enough for clean voice recording (under 40 dB)",
            ok: true,
            threshold: 40,
          }
        : {
            text: "Too noisy for clean voice recording (aim for under 40 dB)",
            ok: false,
            threshold: 40,
          }
    case "sleep":
      return value < 35
        ? {
            text: "Quiet enough for sleep (under 35 dB)",
            ok: true,
            threshold: 35,
          }
        : {
            text: "Louder than ideal for sleep (aim for under 35 dB)",
            ok: false,
            threshold: 35,
          }
    case "workplace":
      return value >= 85
        ? {
            text: "Above 85 dB: hearing protection is recommended for long exposure",
            ok: false,
            threshold: 85,
          }
        : {
            text: "Under 85 dB, a common limit for a full workday",
            ok: true,
            threshold: 85,
          }
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/**
 * Equivalent continuous level (Leq): the energy average of the levels,
 * 10·log10(mean(10^(L/10))). Leq of [60, 70] ≈ 67.4. Null when empty.
 */
export function leq(levels: readonly number[]): number | null {
  let sum = 0
  let n = 0
  for (const l of levels) {
    if (!Number.isFinite(l)) continue
    sum += 10 ** (l / 10)
    n++
  }
  if (n === 0) return null
  return 10 * Math.log10(sum / n)
}

/** Min and max of the finite levels. Null when empty. */
export function extent(
  levels: readonly number[],
): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const l of levels) {
    if (!Number.isFinite(l)) continue
    if (l < min) min = l
    if (l > max) max = l
  }
  return min === Number.POSITIVE_INFINITY ? null : { min, max }
}

/** Rounds to one decimal, for results sent to the agent. */
export const round1 = (n: number) => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// Peak hold
// ---------------------------------------------------------------------------

export type Peak = {
  value: number
  /** When the peak was last raised (ms). */
  at: number
}

/**
 * Peak-hold marker: jumps up to any higher level, holds for `holdMs`, then
 * falls at `decayDbPerSecond` until it meets the current level again.
 */
export function decayPeak(
  peak: Peak | null,
  level: number,
  now: number,
  holdMs = 1500,
  decayDbPerSecond = 20,
): Peak {
  if (!peak || !Number.isFinite(peak.value) || level >= peak.value) {
    return { value: level, at: now }
  }
  const since = now - peak.at
  if (since <= holdMs) return peak
  const fallen = peak.value - (decayDbPerSecond * (since - holdMs)) / 1000
  if (fallen <= level) return { value: level, at: now }
  return { value: fallen, at: peak.at }
}

/** The level a peak-hold marker shows at `now`, without updating it. */
export function peakValueAt(
  peak: Peak,
  now: number,
  holdMs = 1500,
  decayDbPerSecond = 20,
): number {
  const since = now - peak.at
  if (since <= holdMs) return peak.value
  return peak.value - (decayDbPerSecond * (since - holdMs)) / 1000
}

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/** 50 segments of 2 dB across 20–120 dB. */
export const SEGMENTS = 50

/** Position of a level on the gauge, 0–1 (clamped). */
export function gaugeFraction(
  level: number,
  min = GAUGE_MIN,
  max = GAUGE_MAX,
): number {
  if (!Number.isFinite(level) || max <= min) return 0
  return Math.min(1, Math.max(0, (level - min) / (max - min)))
}

/**
 * How many segments are lit for a level: a segment lights once the level
 * reaches its lower edge plus half a segment (so 20 dB → 0, 120 dB → all).
 */
export function filledSegments(
  level: number,
  count = SEGMENTS,
  min = GAUGE_MIN,
  max = GAUGE_MAX,
): number {
  if (!Number.isFinite(level)) return 0
  const n = Math.round(gaugeFraction(level, min, max) * count)
  return Math.min(count, Math.max(0, n))
}

/** Index of the segment a level falls in (for the peak marker), 0…count−1. */
export function segmentIndex(
  level: number,
  count = SEGMENTS,
  min = GAUGE_MIN,
  max = GAUGE_MAX,
): number {
  const i = Math.floor(gaugeFraction(level, min, max) * count)
  return Math.min(count - 1, Math.max(0, i))
}

/** Lower edge, in dB, of segment `i`. */
export function segmentLevel(
  i: number,
  count = SEGMENTS,
  min = GAUGE_MIN,
  max = GAUGE_MAX,
): number {
  return min + ((max - min) * i) / count
}

/** Band index of segment `i`, judged at its midpoint (85 dB splits a segment). */
export function segmentBandIndex(
  i: number,
  count = SEGMENTS,
  min = GAUGE_MIN,
  max = GAUGE_MAX,
): number {
  return bandIndex(min + ((max - min) * (i + 0.5)) / count)
}

/**
 * Fill opacity per band for the single chart token (quiet → loud). Bands at
 * 85 dB and above use the destructive token instead.
 */
export const BAND_OPACITY = [0.35, 0.5, 0.7, 0.9, 1, 1] as const

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/**
 * A y domain that fits the values with some padding, at least `minSpan` dB
 * tall, rounded to 5 dB and kept within the gauge range.
 */
export function sparklineDomain(
  values: readonly number[],
  minSpan = 20,
): [number, number] {
  const e = extent(values)
  if (!e) return [GAUGE_MIN, GAUGE_MIN + minSpan]
  let lo = Math.floor((e.min - 3) / 5) * 5
  let hi = Math.ceil((e.max + 3) / 5) * 5
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2
    lo = Math.floor((mid - minSpan / 2) / 5) * 5
    hi = lo + minSpan
  }
  if (lo < 0) {
    hi -= lo
    lo = 0
  }
  return [lo, hi]
}

/**
 * SVG polyline points for values spread evenly across `width`, scaled into
 * `height` over the domain (higher levels nearer the top).
 */
export function sparklinePoints(
  values: readonly number[],
  width: number,
  height: number,
  domain: [number, number],
): string {
  const finite = values.filter((v) => Number.isFinite(v))
  if (finite.length === 0) return ""
  const [lo, hi] = domain
  const span = hi - lo || 1
  const step = finite.length > 1 ? width / (finite.length - 1) : 0
  return finite
    .map((v, i) => {
      const t = Math.min(1, Math.max(0, (v - lo) / span))
      const x = finite.length > 1 ? i * step : width
      const y = height - t * height
      return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`
    })
    .join(" ")
}

// ---------------------------------------------------------------------------
// Durations
// ---------------------------------------------------------------------------

/** Live auto-stop length: whole seconds, 5–300, default 30. */
export function normalizeDuration(seconds: unknown): number {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return 30
  return Math.min(300, Math.max(5, Math.round(seconds)))
}

/** "0:07", "1:30", "10:00". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/** "45 s", "2 min", "2 min 30 s", "1 h 5 min". */
export function formatSpan(seconds: number): string {
  const s = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0))
  if (s < 60) return `${s} s`
  if (s < 3600) {
    const m = Math.floor(s / 60)
    const r = s % 60
    return r ? `${m} min ${r} s` : `${m} min`
  }
  const h = Math.floor(s / 3600)
  const m = Math.round((s % 3600) / 60)
  return m ? `${h} h ${m} min` : `${h} h`
}
