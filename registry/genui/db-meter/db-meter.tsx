"use client"

import * as React from "react"
import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  BellIcon,
  CheckIcon,
  ClockIcon,
  type LucideIcon,
  MegaphoneIcon,
  MicIcon,
  MicOffIcon,
  OctagonAlertIcon,
  SigmaIcon,
  SquareIcon,
  TriangleAlertIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  genuiType,
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiMotion,
} from "@/components/genui/surface"

import {
  BAND_EDGES,
  BAND_OPACITY,
  BANDS,
  type BandId,
  bandFor,
  decayPeak,
  extent,
  filledSegments,
  formatClock,
  formatSpan,
  GAUGE_MAX,
  GAUGE_MIN,
  gaugeFraction,
  isLevel,
  meanSquare,
  meanSquareToDbfs,
  normalizeDuration,
  normalizeOffset,
  PURPOSE_THRESHOLD,
  type Peak,
  type Purpose,
  peakValueAt,
  purposeGuidance,
  purposeVerdict,
  round1,
  SEGMENTS,
  segmentBandIndex,
  sparklineDomain,
  sparklinePoints,
  timeWeight,
  toApproxDb,
} from "./db-meter-utils"
import type {
  DbMeterHistoryPoint,
  DbMeterInput,
  DbMeterReading,
  DbMeterResult,
} from "./db-meter.schema"
import { WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export type DbMeterStatus = "streaming" | "ready" | "measured" | "alert-set"

export type DbMeterProps = Partial<Omit<DbMeterInput, "reading">> & {
  /** May be partial while the tool call streams. */
  reading?: Partial<Omit<DbMeterReading, "history">> & {
    history?: Partial<DbMeterHistoryPoint>[]
  }
  /** Lifecycle, controlled by the host. */
  status?: DbMeterStatus
  /**
   * Live: called once, when a session stops. Reading: called when the user
   * sets an alert.
   */
  onResult?: (result: DbMeterResult) => void
  /** A result from history. Restores the finished state; never calls onResult. */
  result?: DbMeterResult
  className?: string
}

type Phase =
  | "idle"
  | "requesting"
  | "measuring"
  | "blocked"
  | "no-mic"
  | "error"
  | "unsupported"

type Summary = Extract<DbMeterResult, { action: "measurement" }>

/** What the live loop shows. Updated every frame (every second with reduced motion). */
type LiveView = {
  level: number | null
  /** The big digits: refreshed 4× a second (1× with reduced motion). */
  digits: number | null
  peak: number | null
  measuredMs: number
  /** The last 60 s of 250 ms block levels, for the sparkline. */
  blocks: number[]
  /** Over the whole session so far. */
  stats: { min: number; max: number; average: number; count: number } | null
}

/** The running microphone session. Lives in a ref, never in state. */
type Session = {
  ctx: AudioContext
  stream: MediaStream
  analyser: AnalyserNode
  buffer: Float32Array<ArrayBuffer>
  raf: number | null
  lastT: number | null
  /** Time-weighted ("Fast") mean square. */
  ms: number | null
  blockSum: number
  blockFrames: number
  blockStart: number
  measuredMs: number
  /** One level per 250 ms block, for min, max, Leq and the sparkline. */
  levels: number[]
  /** Running sums, so stats stay cheap on long sessions. */
  energy: number
  min: number
  max: number
  peak: Peak | null
  lastUiAt: number
  lastDigitsAt: number
  digits: number | null
}

const EMPTY_VIEW: LiveView = {
  level: null,
  digits: null,
  peak: null,
  measuredMs: 0,
  blocks: [],
  stats: null,
}

const BLOCK_MS = 250
/** The live sparkline shows the last 60 s of 250 ms blocks. */
const SPARK_BLOCKS = 240

const BAND_ICONS: Record<BandId, LucideIcon> = {
  quiet: VolumeIcon,
  moderate: Volume1Icon,
  conversation: Volume2Icon,
  loud: MegaphoneIcon,
  "very-loud": TriangleAlertIcon,
  harmful: OctagonAlertIcon,
}

/** The single chart token, per theme (same scale as the KPI card). */
const FILL_BG = "bg-chart-5 dark:bg-chart-1"
const FILL_TEXT = "text-chart-5 dark:text-chart-1"

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: genuiMotion.fade,
} as const

type AudioContextCtor = typeof AudioContext

function audioContextCtor(): AudioContextCtor | undefined {
  if (typeof window === "undefined") return undefined
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext
  )
}

function liveSupported() {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    audioContextCtor() !== undefined &&
    window.isSecureContext !== false
  )
}

/** Adds one block level to the session and its running stats. */
function pushBlock(s: Session, level: number) {
  s.levels.push(level)
  s.energy += 10 ** (level / 10)
  if (level < s.min) s.min = level
  if (level > s.max) s.max = level
}

function sessionStats(s: Session): LiveView["stats"] {
  const count = s.levels.length
  if (count === 0) return null
  return {
    min: s.min,
    max: s.max,
    average: 10 * Math.log10(s.energy / count),
    count,
  }
}

/** Stops the microphone and closes the audio graph. */
function release(s: Session) {
  if (s.raf !== null) cancelAnimationFrame(s.raf)
  s.raf = null
  for (const track of s.stream.getTracks()) track.stop()
  if (s.ctx.state !== "closed") void s.ctx.close()
}

function formatAsOf(iso: string, locale: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  const d = new Date(t)
  const sameDay = d.toDateString() === new Date().toDateString()
  return new Intl.DateTimeFormat(
    locale,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
  ).format(d)
}

const db = (n: number) => `${Math.round(n)} dB`

// ---------------------------------------------------------------------------
// Gauge
// ---------------------------------------------------------------------------

/**
 * Segmented meter from 20 to 120 dB. Decorative: the readout carries the
 * value and the band in text.
 */
function Gauge({ level, peak }: { level: number | null; peak: number | null }) {
  const lit = level === null ? 0 : filledSegments(level)
  const ticks = [GAUGE_MIN, ...BAND_EDGES, GAUGE_MAX]
  return (
    <div aria-hidden className="flex flex-col gap-1">
      <div className="relative flex h-3 gap-px">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const band = segmentBandIndex(i)
          const on = i < lit
          const warn = BANDS[band].warning
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed set of segments
              key={i}
              className={cn(
                "h-full min-w-0 flex-1 rounded-[1px]",
                on
                  ? warn
                    ? "bg-destructive"
                    : FILL_BG
                  : "bg-muted dark:bg-white/10",
              )}
              style={on && !warn ? { opacity: BAND_OPACITY[band] } : undefined}
            />
          )
        })}
        {peak !== null && peak > GAUGE_MIN && (
          <span
            className="absolute -inset-y-0.5 w-0.5 rounded-full bg-foreground"
            style={{ left: `calc(${gaugeFraction(peak) * 100}% - 1px)` }}
          />
        )}
      </div>
      <div className="relative h-4 text-[13px] leading-4 tabular-nums text-muted-foreground">
        {ticks.map((v, i) => (
          <span
            key={v}
            className={cn(
              "absolute top-0 flex flex-col",
              i === 0
                ? "items-start"
                : i === ticks.length - 1
                  ? "-translate-x-full items-end"
                  : "-translate-x-1/2 items-center",
            )}
            style={{ left: `${gaugeFraction(v) * 100}%` }}
          >
            {v}
          </span>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

function Sparkline({
  values,
  caption,
  label,
  threshold,
}: {
  values: number[]
  caption: string
  label: string
  threshold: number | null
}) {
  const W = 300
  const H = 48
  const domain = sparklineDomain(values)
  const points = sparklinePoints(values, W, H, domain)
  const thresholdY =
    threshold !== null && threshold > domain[0] && threshold < domain[1]
      ? H - ((threshold - domain[0]) / (domain[1] - domain[0])) * H
      : null
  return (
    <figure className="flex flex-col gap-1.5 border-t border-border px-3 py-3">
      <figcaption
        className={cn(
          "flex items-baseline justify-between gap-3",
          genuiType.meta,
        )}
      >
        <span>{caption}</span>
        {thresholdY !== null && (
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="w-3 border-t border-dashed border-foreground/60"
            />
            {db(threshold ?? 0)} guide
          </span>
        )}
      </figcaption>
      <div className="flex gap-2">
        <div
          aria-hidden
          className="flex w-8 shrink-0 flex-col justify-between text-right text-[13px] leading-none tabular-nums text-muted-foreground"
        >
          <span>{domain[1]}</span>
          <span>{domain[0]}</span>
        </div>
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-12 min-w-0 flex-1 overflow-visible"
        >
          <line
            x1={0}
            x2={W}
            y1={H}
            y2={H}
            stroke="var(--border)"
            vectorEffect="non-scaling-stroke"
          />
          {thresholdY !== null && (
            <line
              x1={0}
              x2={W}
              y1={thresholdY}
              y2={thresholdY}
              stroke="currentColor"
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
              className="text-foreground/60"
            />
          )}
          {points && (
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              className={FILL_TEXT}
            />
          )}
        </svg>
      </div>
    </figure>
  )
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** A whole-dB value whose digits roll as it changes. */
function DbRoll({ value }: { value: number }) {
  return (
    <>
      <span className="sr-only">{db(value)}</span>
      <span aria-hidden className="inline-flex items-baseline">
        <SlidingNumber number={Math.round(value)} initiallyStable />
        &nbsp;dB
      </span>
    </>
  )
}

function Stat({
  label,
  icon: Icon,
  value,
}: {
  label: string
  icon: LucideIcon
  value: React.ReactNode | null
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className={cn(genuiType.label, "flex items-center gap-1.5")}>
        <Icon aria-hidden className="size-3.5 shrink-0" />
        {label}
      </dt>
      <dd className="text-[13px] font-medium tabular-nums">
        {value ?? (
          <>
            <span aria-hidden>–</span>
            <span className="sr-only">Not measured yet</span>
          </>
        )}
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DbMeter({
  source,
  title,
  reading,
  purpose = "general",
  calibrationOffset,
  durationSeconds,
  allowAlert = false,
  status: statusProp,
  onResult,
  result,
  className,
}: DbMeterProps) {
  const locale = useGenUILocale()
  const [decision, setDecision] = React.useState<
    "measured" | "alert-set" | null
  >(
    result === undefined
      ? null
      : result.action === "measurement"
        ? "measured"
        : "alert-set",
  )
  const [summary, setSummary] = React.useState<Summary | null>(
    result?.action === "measurement" ? result : null,
  )
  const [alertSet, setAlertSet] = React.useState<number | null>(
    result?.action === "alert" ? result.threshold : null,
  )
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [paused, setPaused] = React.useState(false)
  const [view, setView] = React.useState<LiveView>(EMPTY_VIEW)
  const [srLevel, setSrLevel] = React.useState<number | null>(null)
  const [announcement, setAnnouncement] = React.useState("")
  // Null until mounted, so server and client render the same markup.
  const [mounted, setMounted] = React.useState(false)
  const [alertDraft, setAlertDraft] = React.useState<string | null>(null)

  const sessionRef = React.useRef<Session | null>(null)
  const sentRef = React.useRef(result !== undefined)
  const readoutRef = React.useRef<HTMLDivElement>(null)
  const toggleRef = React.useRef<HTMLButtonElement>(null)
  const alertDoneRef = React.useRef<HTMLParagraphElement>(null)
  const prevBandRef = React.useRef<BandId | null>(null)
  const alertInputId = React.useId()
  const reducedMotion = useReducedMotion()

  const status: DbMeterStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const isLive = source === "live"
  const isReading = source === "reading"
  const offset = normalizeOffset(calibrationOffset)
  const duration = normalizeDuration(durationSeconds)

  // Latest values for the animation loop, without re-subscribing.
  const latest = React.useRef({ offset, duration, reducedMotion, onResult })
  React.useLayoutEffect(() => {
    latest.current = { offset, duration, reducedMotion, onResult }
  })

  const aliveRef = React.useRef(true)
  React.useEffect(() => {
    aliveRef.current = true
    setMounted(true)
    if (!liveSupported()) setPhase("unsupported")
    return () => {
      // Leaving mid-session releases the microphone; nothing is sent.
      aliveRef.current = false
      const s = sessionRef.current
      sessionRef.current = null
      if (s) release(s)
    }
  }, [])

  const send = React.useCallback((r: DbMeterResult) => {
    if (sentRef.current) return
    sentRef.current = true
    latest.current.onResult?.(r)
  }, [])

  /** Ends the session: releases the mic and reports the summary once. */
  const stopSession = React.useCallback(() => {
    const s = sessionRef.current
    if (!s) return
    sessionRef.current = null
    // Keep a final partial block if it's long enough to mean something.
    if (s.blockFrames > 0 && s.measuredMs - s.blockStart >= 100) {
      pushBlock(
        s,
        toApproxDb(
          meanSquareToDbfs(s.blockSum / s.blockFrames),
          latest.current.offset,
        ),
      )
    }
    const hadFocus =
      typeof document !== "undefined" &&
      document.activeElement === toggleRef.current
    release(s)
    setPaused(false)
    setPhase("idle")
    const stats = sessionStats(s)
    if (stats === null) {
      // Stopped before anything was measured: back to the start, nothing sent.
      setView(EMPTY_VIEW)
      return
    }
    const r: Summary = {
      action: "measurement",
      average: round1(stats.average),
      min: round1(stats.min),
      max: round1(stats.max),
      durationSeconds: round1(s.measuredMs / 1000),
      approximate: true,
    }
    setView({
      level: stats.average,
      digits: stats.average,
      peak: stats.max,
      measuredMs: s.measuredMs,
      blocks: s.levels.slice(-SPARK_BLOCKS),
      stats,
    })
    setSummary(r)
    setDecision("measured")
    send(r)
    // The Stop button goes away; keep focus inside the meter.
    if (hadFocus) requestAnimationFrame(() => readoutRef.current?.focus())
  }, [send])

  /** One animation frame: sample the analyser, update stats and the view. */
  const frame = React.useCallback(
    (t: number) => {
      const s = sessionRef.current
      if (!s) return
      const {
        offset: off,
        duration: dur,
        reducedMotion: reduce,
      } = latest.current
      const dt = s.lastT === null ? 0 : Math.min(250, t - s.lastT)
      s.lastT = t
      s.analyser.getFloatTimeDomainData(s.buffer)
      const ms = meanSquare(s.buffer)
      s.ms = s.ms === null ? ms : timeWeight(s.ms, ms, dt)
      s.measuredMs += dt
      s.blockSum += ms
      s.blockFrames += 1
      if (s.measuredMs - s.blockStart >= BLOCK_MS) {
        pushBlock(
          s,
          toApproxDb(meanSquareToDbfs(s.blockSum / s.blockFrames), off),
        )
        s.blockSum = 0
        s.blockFrames = 0
        s.blockStart = s.measuredMs
      }
      const level = toApproxDb(meanSquareToDbfs(s.ms), off)
      s.peak = decayPeak(s.peak, level, t)

      const uiEvery = reduce ? 1000 : 0
      if (t - s.lastUiAt >= uiEvery) {
        s.lastUiAt = t
        if (t - s.lastDigitsAt >= (reduce ? 1000 : BLOCK_MS)) {
          s.lastDigitsAt = t
          s.digits = level
        }
        setView({
          level,
          digits: s.digits,
          peak: s.peak ? peakValueAt(s.peak, t) : null,
          measuredMs: s.measuredMs,
          blocks: s.levels.slice(-SPARK_BLOCKS),
          stats: sessionStats(s),
        })
      }

      if (s.measuredMs >= dur * 1000) {
        stopSession()
        return
      }
      s.raf = requestAnimationFrame(frame)
    },
    [stopSession],
  )

  const startSession = async () => {
    if (sessionRef.current || phase === "requesting") return
    const Ctor = audioContextCtor()
    if (!Ctor || !liveSupported()) {
      setPhase("unsupported")
      return
    }
    // Create the context inside the click, so it may start.
    let ctx: AudioContext
    try {
      ctx = new Ctor()
    } catch {
      setPhase("unsupported")
      return
    }
    setPhase("requesting")
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
    } catch (err) {
      void ctx.close()
      if (!aliveRef.current) return
      const name =
        typeof err === "object" && err !== null && "name" in err
          ? String(err.name)
          : ""
      setPhase(
        name === "NotAllowedError" || name === "SecurityError"
          ? "blocked"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "no-mic"
            : "error",
      )
      return
    }
    const stopStream = () => {
      for (const track of stream.getTracks()) track.stop()
      void ctx.close()
    }
    // Unmounted while the permission prompt was open.
    if (!aliveRef.current) return stopStream()
    let analyser: AnalyserNode
    try {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      // Analysed only: never connected to the speakers, never recorded.
      ctx.createMediaStreamSource(stream).connect(analyser)
    } catch {
      stopStream()
      setPhase("error")
      return
    }
    void ctx.resume()
    const s: Session = {
      ctx,
      stream,
      analyser,
      buffer: new Float32Array(new ArrayBuffer(analyser.fftSize * 4)),
      raf: null,
      lastT: null,
      ms: null,
      blockSum: 0,
      blockFrames: 0,
      blockStart: 0,
      measuredMs: 0,
      levels: [],
      energy: 0,
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
      peak: null,
      lastUiAt: Number.NEGATIVE_INFINITY,
      lastDigitsAt: Number.NEGATIVE_INFINITY,
      digits: null,
    }
    for (const track of stream.getAudioTracks()) {
      // Unplugged or permission revoked mid-session.
      track.addEventListener("ended", () => stopSession())
    }
    sessionRef.current = s
    setView(EMPTY_VIEW)
    setSrLevel(null)
    prevBandRef.current = null
    setPhase("measuring")
    if (document.hidden) {
      void ctx.suspend()
      setPaused(true)
    } else {
      s.raf = requestAnimationFrame(frame)
    }
  }

  // Pause the analyser loop (and the session clock) while the tab is hidden.
  React.useEffect(() => {
    if (phase !== "measuring") return
    const onVisibility = () => {
      const s = sessionRef.current
      if (!s) return
      if (document.hidden) {
        if (s.raf !== null) cancelAnimationFrame(s.raf)
        s.raf = null
        void s.ctx.suspend()
        setPaused(true)
      } else {
        void s.ctx.resume()
        s.lastT = null
        if (s.raf === null) s.raf = requestAnimationFrame(frame)
        setPaused(false)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [phase, frame])

  // Screen readers: the level at most once a second.
  const viewRef = React.useRef(view)
  React.useLayoutEffect(() => {
    viewRef.current = view
  })
  React.useEffect(() => {
    if (phase !== "measuring" || paused) return
    const id = window.setInterval(() => {
      const v = viewRef.current.level
      if (v !== null) setSrLevel(Math.round(v))
    }, 1000)
    return () => window.clearInterval(id)
  }, [phase, paused])

  // Reading ------------------------------------------------------------------
  const current = isLevel(reading?.current) ? reading.current : null
  const history = (reading?.history ?? []).filter(
    (p): p is DbMeterHistoryPoint =>
      typeof p.t === "string" && isLevel(p.value),
  )
  const historySpan =
    history.length > 1
      ? (Date.parse(history[history.length - 1].t) - Date.parse(history[0].t)) /
        1000
      : null
  const span =
    historySpan !== null && Number.isFinite(historySpan) && historySpan > 0
      ? historySpan
      : null

  // What the readout shows -------------------------------------------------
  const measured = status === "measured" && summary !== null
  const digits = isReading ? current : measured ? summary.average : view.digits
  const shown = digits === null ? null : Math.round(digits)
  const band = shown === null ? null : bandFor(shown)
  const BandIcon = band ? BAND_ICONS[band.id] : null
  const approx = isLive

  // Announce only when the band changes, checked at most once a second.
  const spokenLevel = isReading
    ? current === null
      ? null
      : Math.round(current)
    : measured
      ? Math.round(summary.average)
      : srLevel
  const spokenBand = spokenLevel === null ? null : bandFor(spokenLevel)
  const firstReadingRef = React.useRef(true)
  React.useEffect(() => {
    if (!spokenBand || spokenLevel === null) return
    if (isReading && firstReadingRef.current) {
      // A sensor reading is on screen from the start; announce changes only.
      firstReadingRef.current = false
      prevBandRef.current = spokenBand.id
      return
    }
    if (prevBandRef.current === spokenBand.id) return
    prevBandRef.current = spokenBand.id
    if (measured) return
    setAnnouncement(
      `${spokenBand.label}, ${approx ? "about " : ""}${spokenLevel} dB`,
    )
  }, [spokenBand, spokenLevel, isReading, measured, approx])

  const srReadout =
    spokenLevel === null || !spokenBand
      ? isLive && !measured
        ? "No level yet"
        : ""
      : `${measured ? "Average " : ""}${spokenLevel} dB${approx ? ", approximate" : ""}, ${spokenBand.label}`

  // Stats --------------------------------------------------------------------
  const liveStats = isLive && !measured ? view.stats : null
  const stats = isReading
    ? {
        min: isLevel(reading?.min) ? reading.min : null,
        max: isLevel(reading?.max) ? reading.max : null,
        average: isLevel(reading?.average) ? reading.average : null,
        seconds: span,
      }
    : measured
      ? {
          min: summary.min,
          max: summary.max,
          average: summary.average,
          seconds: summary.durationSeconds,
        }
      : {
          min: liveStats?.min ?? null,
          max: liveStats?.max ?? null,
          average: liveStats?.average ?? null,
          seconds: phase === "measuring" ? view.measuredMs / 1000 : null,
        }

  // Verdict: live judges the average (the instant level jumps around).
  const verdictLevel = isReading
    ? current
    : measured
      ? summary.average
      : liveStats && liveStats.count >= 4
        ? liveStats.average
        : null
  const verdict = purposeVerdict(purpose as Purpose, verdictLevel)
  const guidance = purposeGuidance(purpose as Purpose)
  const threshold =
    purpose === "general"
      ? null
      : PURPOSE_THRESHOLD[purpose as Exclude<Purpose, "general">]

  // Gauge --------------------------------------------------------------------
  const gaugeLevel = isReading
    ? current
    : measured
      ? summary.average
      : view.level
  const gaugePeak = isReading
    ? isLevel(reading?.max)
      ? reading.max
      : null
    : measured
      ? summary.max
      : view.peak

  // Sparkline ----------------------------------------------------------------
  // Live: the 250 ms blocks plus the current level at the end, every frame
  // (with reduced motion the view, and so the line, updates once a second).
  const sparkValues = isReading
    ? history.map((p) => p.value)
    : phase === "measuring" && view.level !== null && !reducedMotion
      ? [...view.blocks, view.level]
      : view.blocks
  const sparkRange = extent(sparkValues)
  const sparkSeconds = isReading
    ? span
    : Math.min(60, (view.blocks.length * BLOCK_MS) / 1000)
  const sparkCaption = isReading
    ? span !== null
      ? `Last ${formatSpan(span)}`
      : "Recent levels"
    : `Last ${formatSpan(Math.max(1, Math.round(sparkSeconds ?? 0)))}`
  const sparkLabel = sparkRange
    ? `Level over the ${sparkCaption.toLowerCase()}: ${db(sparkRange.min)} to ${db(sparkRange.max)}${approx ? ", approximate" : ""}`
    : ""
  const showSpark = sparkValues.length > 1

  // Alert --------------------------------------------------------------------
  const defaultThreshold = (() => {
    const base = threshold ?? 85
    if (current !== null && current >= base) {
      return Math.ceil((current + 1) / 5) * 5
    }
    return base
  })()
  const alertText = alertDraft ?? String(defaultThreshold)
  const alertValue = Number(alertText)
  const alertValid =
    alertText.trim() !== "" &&
    Number.isInteger(alertValue) &&
    alertValue >= 30 &&
    alertValue <= 130
  const submitAlert = (e: React.FormEvent) => {
    e.preventDefault()
    if (!alertValid || streaming || status !== "ready") return
    setAlertSet(alertValue)
    setDecision("alert-set")
    send({ action: "alert", threshold: alertValue })
    requestAnimationFrame(() => alertDoneRef.current?.focus())
  }

  // Header -----------------------------------------------------------------
  const displayTitle = title ?? (streaming ? undefined : "Sound level")
  const asOf = mounted && reading?.asOf ? formatAsOf(reading.asOf, locale) : null
  // One quiet line: where and when. Live says "approx." by the number instead.
  const description = isReading
    ? [
        reading?.location && reading.location !== title
          ? reading.location
          : null,
        asOf ? `As of ${asOf}` : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : ""

  const statCount =
    2 + (measured ? 0 : 1) + (!isReading || stats.seconds !== null ? 1 : 0)

  const measuring = phase === "measuring"
  const remaining = Math.max(0, duration - view.measuredMs / 1000)
  const canStart =
    isLive && status === "ready" && phase !== "unsupported" && !streaming

  const statusLine = (() => {
    if (streaming) return null
    if (isLive) {
      if (measured) return null
      switch (phase) {
        case "requesting":
          return "Waiting for microphone permission…"
        case "measuring":
          return paused
            ? "Paused while this tab is in the background"
            : "Measuring"
        case "blocked":
          return "Microphone access was blocked. Allow it in your browser's site settings to measure."
        case "no-mic":
          return "No microphone was found. Connect one and try again."
        case "error":
          return "The microphone couldn't be started. Try again."
        case "unsupported":
          return "This browser can't measure sound here. It needs microphone access on a secure (HTTPS) page."
        default:
          return "Not started"
      }
    }
    return null
  })()
  const problem =
    phase === "blocked" ||
    phase === "no-mic" ||
    phase === "error" ||
    phase === "unsupported"

  const readoutLabel = isReading
    ? "Current"
    : measured
      ? "Average"
      : measuring
        ? "Now"
        : "Level"

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="db-meter"
        data-status={status}
        data-source={source}
        aria-busy={streaming}
        aria-label={displayTitle ?? "Sound level"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{displayTitle}</SurfaceTitle>
          {description ? (
            <SurfaceDescription>{description}</SurfaceDescription>
          ) : (
            streaming && <Skeleton className="h-3.5 w-40" />
          )}
        </SurfaceHeader>

        {/* Readout, verdict and gauge */}
        {source === undefined || (isReading && current === null) ? (
          <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
            <Skeleton className="h-3 w-14" />
            <div className="flex items-end justify-between gap-4">
              <Skeleton className="h-10 w-28" />
              <Skeleton className="h-4 w-40" />
            </div>
            <Skeleton className="h-3 w-full" />
            {!streaming && isReading && (
              <p className="text-[13px] text-muted-foreground">
                No reading provided.
              </p>
            )}
          </div>
        ) : (
          <motion.div
            {...enter}
            className="flex flex-col gap-4 border-t border-border px-3 py-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
              <div className="flex flex-col gap-1.5">
                <span className={genuiType.label}>{readoutLabel}</span>
                <div
                  ref={readoutRef}
                  tabIndex={-1}
                  className="flex w-fit items-baseline gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className="sr-only">{srReadout}</span>
                  <span
                    aria-hidden
                    className={cn(
                      "font-figure lining-nums text-[44px] leading-none font-normal tracking-tight tabular-nums",
                      shown === null && "text-muted-foreground",
                    )}
                  >
                    {shown === null ? (
                      "––"
                    ) : (
                      <SlidingNumber number={shown} initiallyStable />
                    )}
                  </span>
                  <span
                    aria-hidden
                    className="text-[16px] text-muted-foreground"
                  >
                    dB
                  </span>
                  {approx && (
                    <span aria-hidden className={genuiType.meta}>
                      approx.
                    </span>
                  )}
                </div>
              </div>
              {band && BandIcon && (
                <span
                  className={cn(
                    "flex items-center gap-1.5 pb-0.5 text-[13px] font-semibold",
                    band.warning && "text-destructive",
                  )}
                >
                  <BandIcon aria-hidden className="size-4 shrink-0" />
                  {band.label}
                </span>
              )}
            </div>

            {verdict ? (
              <div className="flex flex-col gap-1">
                <p
                  className={cn(
                    "flex items-start gap-1.5 text-[13px] font-semibold",
                    !verdict.ok &&
                      verdict.threshold >= 85 &&
                      "text-destructive",
                  )}
                >
                  {verdict.ok ? (
                    <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                  ) : (
                    <TriangleAlertIcon
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0"
                    />
                  )}
                  <span>{verdict.text}</span>
                </p>
                {purpose === "workplace" && (
                  <p className={cn("pl-5.5", genuiType.meta)}>
                    Not medical advice.
                  </p>
                )}
              </div>
            ) : (
              guidance && (
                <p className={genuiType.meta}>
                  {guidance}
                  {purpose === "workplace" && " Not medical advice."}
                </p>
              )
            )}

            <Gauge level={gaugeLevel} peak={gaugePeak} />
          </motion.div>
        )}

        {/* Stats */}
        {source !== undefined && (!isReading || current !== null) && (
          <motion.dl
            {...enter}
            className={cn(
              "grid gap-x-10 gap-y-3 border-t border-border px-3 py-3",
              statCount === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3",
            )}
          >
            <Stat
              label="Min"
              icon={ArrowDownToLineIcon}
              value={stats.min === null ? null : <DbRoll value={stats.min} />}
            />
            <Stat
              label="Max"
              icon={ArrowUpToLineIcon}
              value={stats.max === null ? null : <DbRoll value={stats.max} />}
            />
            {/* After a session the average is the big number already. */}
            {!measured && (
              <Stat
                label="Average"
                icon={SigmaIcon}
                value={
                  stats.average === null ? null : (
                    <DbRoll value={stats.average} />
                  )
                }
              />
            )}
            {(!isReading || stats.seconds !== null) && (
              <Stat
                label={isReading ? "Period" : "Measured"}
                icon={ClockIcon}
                value={
                  stats.seconds === null
                    ? null
                    : isReading
                      ? formatSpan(stats.seconds)
                      : formatClock(stats.seconds)
                }
              />
            )}
          </motion.dl>
        )}

        {showSpark && (
          <Sparkline
            values={sparkValues}
            caption={sparkCaption}
            label={sparkLabel}
            threshold={threshold}
          />
        )}

        {/* Live controls */}
        {isLive && !measured && !streaming && (
          <SurfaceFooter className="flex-col items-stretch gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <WhyDisabled when={!canStart} reason="Microphone isn’t available">
                <Button
                  ref={toggleRef}
                  size="sm"
                  disabled={!canStart}
                  aria-disabled={phase === "requesting" || undefined}
                  onClick={() => {
                    if (measuring) stopSession()
                    else if (phase !== "requesting") void startSession()
                  }}
                >
                  {measuring ? (
                    <SquareIcon aria-hidden />
                  ) : (
                    <MicIcon aria-hidden />
                  )}
                  {measuring ? "Stop" : "Start measuring"}
                </Button>
              </WhyDisabled>
              <span className={cn(genuiType.meta, "tabular-nums")}>
                {measuring
                  ? `Stops in ${formatClock(Math.ceil(remaining))}`
                  : "Nothing is recorded or sent."}
              </span>
            </div>
            {/* "Not started" and "Measuring" are what the button already says. */}
            <p
              aria-live="polite"
              className={cn(
                "flex min-w-0 items-start gap-1.5 text-[13px]",
                !problem &&
                  phase !== "requesting" &&
                  !(measuring && paused) &&
                  "sr-only",
              )}
            >
              {problem && (
                <MicOffIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
              )}
              {statusLine}
            </p>
          </SurfaceFooter>
        )}

        {/* Reading: optional alert */}
        {isReading && allowAlert && status === "ready" && (
          <SurfaceFooter>
            <form
              onSubmit={submitAlert}
              className="flex w-full flex-wrap items-center gap-2"
            >
              <label htmlFor={alertInputId} className={genuiType.body}>
                Alert above
              </label>
              <Input
                id={alertInputId}
                type="number"
                inputMode="numeric"
                min={30}
                max={130}
                step={1}
                value={alertText}
                aria-invalid={!alertValid || undefined}
                disabled={streaming}
                onChange={(e) => setAlertDraft(e.target.value)}
                className="w-20 tabular-nums"
              />
              <span className="text-[13px] text-muted-foreground">dB</span>
              <WhyDisabled
                className="inline-flex ml-auto"
                when={streaming || current === null || !alertValid}
                reason="Enter a valid alert level"
              >
                <Button
                  type="submit"
                  size="sm"
                  className="ml-auto"
                  disabled={streaming || current === null || !alertValid}
                >
                  <BellIcon aria-hidden />
                  Set alert
                </Button>
              </WhyDisabled>
            </form>
          </SurfaceFooter>
        )}

        {/* Status line */}
        {(streaming ||
          measured ||
          (status === "alert-set" && alertSet !== null)) && (
          <SurfaceFooter>
            <p
              ref={alertDoneRef}
              tabIndex={-1}
              aria-live="polite"
              className="flex min-w-0 items-start gap-1.5 text-[13px] text-muted-foreground outline-none"
            >
              {streaming ? (
                <ShimmeringText
                  text="Setting up the meter…"
                  color="var(--muted-foreground)"
                  shimmeringColor="var(--foreground)"
                />
              ) : measured ? (
                <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                  <CheckIcon aria-hidden className="size-4 shrink-0" />
                  {`Sent: average ${db(summary.average)} over ${formatSpan(summary.durationSeconds)}`}
                </span>
              ) : status === "alert-set" && alertSet !== null ? (
                <span className="flex items-center gap-1.5 text-[13px] text-foreground">
                  <BellIcon aria-hidden className="size-4 shrink-0" />
                  {`Alert requested above ${alertSet} dB`}
                </span>
              ) : null}
            </p>
          </SurfaceFooter>
        )}

        {/* Band changes, at most once a second. */}
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
      </Surface>
    </MotionConfig>
  )
}
