"use client"

import * as React from "react"
import {
  Building2Icon,
  CheckIcon,
  DollarSignIcon,
  FactoryIcon,
  type LucideIcon,
  MapPinIcon,
  StoreIcon,
  SunIcon,
  UsersIcon,
  WindIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"
import type { GeometryCollection, Topology } from "topojson-specification"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import {
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
  surfaceInset,
} from "@/components/genui/surface"
import { SERIES_VARS, seriesColor } from "@/components/genui/series-colors"
import { useGenUILocale } from "@/components/genui/locale"

import {
  bucketLabels,
  bucketOf,
  bucketStrength,
  estimateLabelWidth,
  featureKey,
  formatValue,
  type Geography,
  HIGHLIGHT_STRENGTH,
  layoutPins,
  quantize,
  regionName,
  resolveRegionId,
  type ScaleFormat,
  summarize,
} from "./region-map-utils"
import type {
  RegionMapIcon,
  RegionMapInput,
  RegionMapPin,
  RegionMapRegion,
  RegionMapResult,
  RegionMapScale,
} from "./region-map.schema"

export type RegionMapStatus = "streaming" | "ready" | "submitted"

export type RegionMapProps = Partial<
  Omit<RegionMapInput, "regions" | "pins" | "scale">
> & {
  /** Regions and pins may be partial while the tool call streams. */
  regions?: Partial<RegionMapRegion>[]
  pins?: Partial<RegionMapPin>[]
  scale?: Partial<RegionMapScale>
  /** Lifecycle, controlled by the host. */
  status?: RegionMapStatus
  /** Called once when the user chooses a region or pin (only when selectable). */
  onResult?: (result: RegionMapResult) => void
  /** A choice from history. Restores the selection and locks; never calls onResult. */
  result?: RegionMapResult
  className?: string
}

const ICONS: Record<RegionMapIcon, LucideIcon> = {
  wind: WindIcon,
  solar: SunIcon,
  building: Building2Icon,
  factory: FactoryIcon,
  store: StoreIcon,
  users: UsersIcon,
  dollar: DollarSignIcon,
  pin: MapPinIcon,
}

const PILL_HEIGHT = 24
// Placeholder aspect ratios until the geometry loads.
const ASPECT: Record<Geography, string> = {
  "us-states": "975 / 610",
  world: "960 / 424",
}

// ---------------------------------------------------------------------------
// Geometry: loaded on demand so ~100 KB of atlas JSON stays out of the page.

type Shape = { key: string; name: string; d: string; cx: number; cy: number }

type MapGeometry = {
  width: number
  height: number
  shapes: Shape[]
  /** [lng, lat] to viewBox coordinates; null when off the map. */
  project: (lng: number, lat: number) => [number, number] | null
}

type Named = { name?: string }

const geometryCache = new Map<Geography, Promise<MapGeometry>>()

function loadGeometry(geography: Geography): Promise<MapGeometry> {
  let promise = geometryCache.get(geography)
  if (!promise) {
    promise = buildGeometry(geography)
    // Let a failed load (e.g. offline) retry on the next mount.
    promise.catch(() => geometryCache.delete(geography))
    geometryCache.set(geography, promise)
  }
  return promise
}

async function buildGeometry(geography: Geography): Promise<MapGeometry> {
  const [{ geoAlbersUsa, geoEqualEarth, geoPath }, { feature }] =
    await Promise.all([import("d3-geo"), import("topojson-client")])

  const toShape = (
    id: string | number | undefined,
    name: string | undefined,
    d: string | null,
    [cx, cy]: [number, number],
  ): Shape[] => {
    const key = featureKey(geography, id, name)
    return key && d
      ? [{ key, name: regionName(geography, key), d, cx, cy }]
      : []
  }

  if (geography === "us-states") {
    // Pre-projected to a 975×610 Albers USA viewport; this projection matches it.
    const topo = (await import("us-atlas/states-albers-10m.json"))
      .default as unknown as Topology<{ states: GeometryCollection<Named> }>
    const path = geoPath()
    const projection = geoAlbersUsa().scale(1300).translate([487.5, 305])
    return {
      width: 975,
      height: 610,
      shapes: feature(topo, topo.objects.states).features.flatMap((f) =>
        toShape(f.id, f.properties?.name, path(f), path.centroid(f)),
      ),
      project: (lng, lat) => projection([lng, lat]),
    }
  }

  const topo = (await import("world-atlas/countries-110m.json"))
    .default as unknown as Topology<{ countries: GeometryCollection<Named> }>
  // Antarctica takes a fifth of the height and rarely carries data.
  const features = feature(topo, topo.objects.countries).features.filter(
    (f) => f.id !== "010",
  )
  const collection = { type: "FeatureCollection" as const, features }
  const width = 960
  const margin = 2
  const projection = geoEqualEarth().fitWidth(width - margin * 2, collection)
  const [tx, ty] = projection.translate()
  projection.translate([tx + margin, ty + margin])
  const path = geoPath(projection)
  const [, [, bottom]] = path.bounds(collection)
  return {
    width,
    height: Math.ceil(bottom + margin),
    shapes: features.flatMap((f) =>
      toShape(f.id, f.properties?.name, path(f), path.centroid(f)),
    ),
    project: (lng, lat) => projection([lng, lat]),
  }
}

// ---------------------------------------------------------------------------

type Valued = {
  id: string
  key: string
  name: string
  value: number
  /** Short text for the map and legend. */
  text: string
  /** Full text for assistive tech. */
  full: string
}

type Tip = { kind: "region" | "pin"; key: string; x: number; y: number }

const isPin = (p: Partial<RegionMapPin>): p is RegionMapPin =>
  typeof p.id === "string" &&
  typeof p.label === "string" &&
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lat as number) <= 90 &&
  Math.abs(p.lng as number) <= 180

/** The strong ink mixed into the neutral base: one hue, light to strong. */
const mix = (strength: number, ink = "var(--region-ink)") =>
  `color-mix(in srgb, ${ink} ${strength}%, var(--muted))`

/** Highlighted regions (a territory, a coverage area) take their own hue. */
const HIGHLIGHT_INK = "var(--region-highlight)"

/**
 * Highlighted regions: each gets its own tint of the highlight hue, picked by
 * a hash of its key so a state keeps its tint between renders.
 */
const HIGHLIGHT_TINTS = [34, 46, 58, 70, 82]
const tintOf = (key: string) => {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return HIGHLIGHT_TINTS[h % HIGHLIGHT_TINTS.length]
}

/** Pin colour by what the pin is: the shared categorical hues. */
const PIN_HUE: Record<RegionMapIcon, number> = {
  wind: 1, // cool blue
  solar: 0, // vermilion
  building: 2, // berry
  factory: 4, // chartreuse
  store: 4, // chartreuse
  users: 1,
  dollar: 3,
  pin: 2,
}
const pinColor = (icon?: RegionMapIcon) => seriesColor(PIN_HUE[icon ?? "pin"])

const pct = (value: number, total: number) =>
  total > 0 ? `${(value / total) * 100}%` : "0%"

export function RegionMap({
  title,
  description,
  geography,
  regions = [],
  scale = {},
  pins = [],
  highlight = [],
  highlightLabel,
  selectable = "none",
  status: statusProp,
  onResult,
  result,
  className,
}: RegionMapProps) {
  const locale = useGenUILocale()
  const [decision, setDecision] = React.useState<RegionMapResult | null>(
    result ?? null,
  )
  const [loaded, setLoaded] = React.useState<{
    geography: Geography
    data: MapGeometry
  } | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [width, setWidth] = React.useState(0)
  const [hoverTip, setHoverTip] = React.useState<Tip | null>(null)
  const [focusKey, setFocusKey] = React.useState<string | null>(null)
  const [pillWidths, setPillWidths] = React.useState<Record<string, number>>({})
  const frameRef = React.useRef<HTMLDivElement>(null)
  const pillRefs = React.useRef(new Map<string, HTMLElement>())
  const titleId = React.useId()

  // A host-provided "ready" (or nothing) yields to the user's choice.
  const status: RegionMapStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"

  React.useEffect(() => {
    if (!geography) return
    let cancelled = false
    setFailed(false)
    loadGeometry(geography).then(
      (data) => {
        if (!cancelled) setLoaded({ geography, data })
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [geography])

  React.useEffect(() => {
    const el = frameRef.current
    if (!el) return
    setWidth(el.getBoundingClientRect().width)
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Lay pins out with their real widths once they've rendered.
  React.useLayoutEffect(() => {
    let changed = false
    const next = { ...pillWidths }
    for (const [id, el] of pillRefs.current) {
      const w = el.offsetWidth
      if (w > 0 && Math.abs((next[id] ?? 0) - w) > 0.5) {
        next[id] = w
        changed = true
      }
    }
    if (changed) setPillWidths(next)
  })

  const geo = geography && loaded?.geography === geography ? loaded.data : null
  const area: Geography = geography ?? "us-states"
  const height = geo ? (width * geo.height) / geo.width : 0
  const fmt: ScaleFormat = { format: scale.format, currency: scale.currency }
  const regionNoun = area === "world" ? "country" : "state"

  // Regions with values, keyed by canonical id. The first value for a key wins.
  const valued = new Map<string, Valued>()
  const notShown: string[] = []
  if (geography) {
    for (const r of regions) {
      if (typeof r.id !== "string" || !Number.isFinite(r.value)) continue
      const key = resolveRegionId(area, r.id)
      if (!key) {
        notShown.push(r.id)
        continue
      }
      if (valued.has(key)) continue
      const value = r.value as number
      valued.set(key, {
        id: r.id,
        key,
        name: regionName(area, key),
        value,
        text: r.label ?? formatValue(value, fmt, "compact", locale),
        full: r.label ?? formatValue(value, fmt, "full", locale),
      })
    }
  }
  const highlighted = new Set<string>()
  if (geography) {
    for (const id of highlight) {
      if (typeof id !== "string") continue
      const key = resolveRegionId(area, id)
      if (key) highlighted.add(key)
      else notShown.push(id)
    }
  }
  const sorted = [...valued.values()].sort((a, b) => b.value - a.value)
  const buckets = quantize(
    sorted.map((r) => r.value),
    scale.steps ?? 5,
  )
  const legend = buckets ? bucketLabels(buckets, fmt, locale) : []

  const fillOf = (key: string) => {
    const r = valued.get(key)
    if (r && buckets) {
      return mix(bucketStrength(bucketOf(r.value, buckets), buckets.count))
    }
    if (highlighted.has(key)) return mix(tintOf(key), HIGHLIGHT_INK)
    return "var(--muted)"
  }

  // Pins: projected to the map, then labels laid out in pixels.
  const readyPins = pins.filter(isPin).slice(0, 12)
  const projected = geo
    ? readyPins.map((p) => ({ p, pt: geo.project(p.lng, p.lat) }))
    : []
  const onMap = projected.flatMap(({ p, pt }) => (pt ? [{ p, pt }] : []))
  for (const { p, pt } of projected) if (!pt) notShown.push(p.title ?? p.label)
  const placements =
    geo && width > 0
      ? layoutPins(
          onMap.map(({ p, pt }) => ({
            id: p.id,
            x: (pt[0] / geo.width) * width,
            y: (pt[1] / geo.height) * height,
            w: pillWidths[p.id] ?? estimateLabelWidth(p.label),
            h: PILL_HEIGHT,
            priority: p.emphasis ? 1 : 0,
          })),
          width,
          height,
        )
      : []
  const pinById = new Map(readyPins.map((p) => [p.id, p]))

  const selectedRegion =
    decision?.action === "select-region"
      ? resolveRegionId(area, decision.id)
      : null
  const selectedPin = decision?.action === "select-pin" ? decision.id : null

  const selectRegion = (r: Valued) => {
    if (selectable !== "region" || locked) return
    const next: RegionMapResult = { action: "select-region", id: r.id }
    setDecision(next)
    onResult?.(next)
  }
  const selectPin = (id: string) => {
    if (selectable !== "pin" || locked) return
    const next: RegionMapResult = { action: "select-pin", id }
    setDecision(next)
    onResult?.(next)
  }

  // Tooltip: the hovered region or pin, else the region focused from the list.
  const focusShape = focusKey && geo?.shapes.find((s) => s.key === focusKey)
  const tip: Tip | null =
    hoverTip ??
    (focusShape && geo
      ? {
          kind: "region",
          key: focusShape.key,
          x: (focusShape.cx / geo.width) * width,
          y: (focusShape.cy / geo.height) * height,
        }
      : null)
  const activeRegion = tip?.kind === "region" ? tip.key : null
  const outlined = new Set<string>(
    [
      // With values on the map, highlighted regions are outlined, not tinted.
      ...(buckets ? highlighted : []),
      activeRegion,
      selectedRegion,
    ].filter((k): k is string => !!k),
  )

  const pointIn = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = frameRef.current?.getBoundingClientRect()
    return rect
      ? { x: e.clientX - rect.left, y: e.clientY - rect.top }
      : { x: 0, y: 0 }
  }
  const keyAt = (e: React.SyntheticEvent) =>
    (e.target as Element).getAttribute?.("data-key") ?? null

  const summary = summarize({
    title,
    geography: area,
    regions: sorted,
    highlightCount: highlighted.size,
    pinCount: onMap.length,
  })

  const pinsOnly = valued.size === 0 && readyPins.length > 0
  const chosenName =
    decision?.action === "select-region"
      ? (valued.get(selectedRegion ?? "")?.name ?? decision.id)
      : decision?.action === "select-pin"
        ? (() => {
            const p = pinById.get(decision.id)
            return p ? (p.title ?? p.label) : decision.id
          })()
        : null

  const tipContent = (() => {
    if (!tip) return null
    if (tip.kind === "pin") {
      const p = pinById.get(tip.key)
      return p
        ? { name: p.title ?? p.label, value: p.title ? p.label : "" }
        : null
    }
    const r = valued.get(tip.key)
    return {
      name: regionName(area, tip.key),
      value: r
        ? r.text
        : highlighted.has(tip.key)
          ? (highlightLabel ?? "Highlighted")
          : buckets
            ? "No data"
            : "",
    }
  })()

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="region-map"
        data-status={status}
        aria-busy={streaming}
        aria-labelledby={title ? titleId : undefined}
        aria-label={title ? undefined : "Map"}
        className={cn(
          // On the card, so the legend below the map sees the same colours.
          // Choropleth: a blue ramp. Highlighted territory: the theme's soft sage (#6fbf95). Pins: their own hues.
          "[--region-highlight:#6fbf95] [--region-ink:var(--series-2)]",
          SERIES_VARS,
          className,
        )}
      >
        {(title || description || streaming) && (
          <SurfaceHeader className="pb-3">
            {(title || streaming) && (
              <SurfaceTitle id={titleId}>{title}</SurfaceTitle>
            )}
            {description && (
              <SurfaceDescription>{description}</SurfaceDescription>
            )}
          </SurfaceHeader>
        )}

        <figure
          aria-label={summary}
          className={cn("m-0 border-t border-border py-3", surfaceInset)}
        >
          <div
            ref={frameRef}
            className="relative mx-auto w-full max-w-[39rem]"
            style={{
              aspectRatio: geo ? `${geo.width} / ${geo.height}` : ASPECT[area],
            }}
          >
            {geo ? (
              <>
                {/* Visual only; the table below carries every value. */}
                <motion.svg
                  aria-hidden
                  viewBox={`0 0 ${geo.width} ${geo.height}`}
                  className="absolute inset-0 size-full"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2 }}
                  onPointerMove={(e) => {
                    const key = keyAt(e)
                    setHoverTip(
                      key ? { kind: "region", key, ...pointIn(e) } : null,
                    )
                  }}
                  onPointerLeave={() => setHoverTip(null)}
                  onClick={(e) => {
                    const key = keyAt(e)
                    const r = key ? valued.get(key) : undefined
                    if (r && selectable === "region") selectRegion(r)
                    else if (key)
                      setHoverTip({ kind: "region", key, ...pointIn(e) })
                  }}
                >
                  {geo.shapes.map((s) => (
                    <path
                      key={s.key}
                      data-key={s.key}
                      d={s.d}
                      style={{ fill: fillOf(s.key) }}
                      stroke="var(--border)"
                      strokeWidth={0.75}
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                      className={cn(
                        "transition-[fill] duration-300 motion-reduce:transition-none",
                        selectable === "region" &&
                          !locked &&
                          valued.has(s.key) &&
                          "cursor-pointer",
                      )}
                    />
                  ))}
                  {geo.shapes
                    .filter((s) => outlined.has(s.key))
                    .map((s) => (
                      <path
                        key={`outline-${s.key}`}
                        d={s.d}
                        fill="none"
                        // The chosen region takes the selection accent.
                        stroke={
                          s.key === selectedRegion
                            ? "var(--choice)"
                            : "var(--foreground)"
                        }
                        strokeOpacity={
                          s.key === activeRegion || s.key === selectedRegion
                            ? 1
                            : 0.5
                        }
                        strokeWidth={
                          s.key === activeRegion || s.key === selectedRegion
                            ? 1.75
                            : 1
                        }
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    ))}
                </motion.svg>

                {/* Leader lines, in percentages so they scale with the map. */}
                <svg
                  aria-hidden
                  className="pointer-events-none absolute inset-0 size-full overflow-visible"
                >
                  {placements.map((pl) => (
                    <motion.line
                      key={pl.id}
                      x1={pct(pl.leader.x1, width)}
                      y1={pct(pl.leader.y1, height)}
                      x2={pct(pl.leader.x2, width)}
                      y2={pct(pl.leader.y2, height)}
                      stroke="var(--foreground)"
                      strokeOpacity={0.5}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.25 }}
                    />
                  ))}
                </svg>

                {placements.map((pl) => {
                  const p = pinById.get(pl.id)
                  if (!p) return null
                  return (
                    <span
                      key={pl.id}
                      aria-hidden
                      className="pointer-events-none absolute"
                      style={{
                        left: pct(pl.leader.x1, width),
                        top: pct(pl.leader.y1, height),
                        transform: "translate(-50%, -50%)",
                      }}
                    >
                      <motion.span
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                        className={cn(
                          "flex items-center justify-center rounded-full",
                          p.emphasis ? "size-6" : "size-5",
                        )}
                        style={{
                          background: `color-mix(in srgb, ${pinColor(p.icon)} 30%, transparent)`,
                        }}
                      >
                        <span
                          className={cn(
                            "rounded-full ring-2 ring-card",
                            p.emphasis ? "size-3" : "size-2.5",
                          )}
                          style={{ background: pinColor(p.icon) }}
                        />
                      </motion.span>
                    </span>
                  )
                })}

                {placements.map((pl) => {
                  const p = pinById.get(pl.id)
                  if (!p) return null
                  const Icon = ICONS[p.icon ?? "pin"]
                  const interactive = selectable === "pin" || !!p.title
                  const selected = selectedPin === p.id
                  const ref = (el: HTMLElement | null) => {
                    if (el) pillRefs.current.set(p.id, el)
                    else pillRefs.current.delete(p.id)
                  }
                  const pinTip: Tip = {
                    kind: "pin",
                    key: p.id,
                    x: pl.box.x + pl.box.w / 2,
                    y: pl.box.y,
                  }
                  const pillClass = cn(
                    "inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full border px-2 text-[13px] leading-4 font-medium tabular-nums shadow-sm dark:shadow-none",
                    p.emphasis
                      ? "border-foreground bg-foreground text-background"
                      : "bg-card text-foreground",
                    selected &&
                      "ring-2 ring-choice ring-offset-2 ring-offset-card",
                  )
                  const content = (
                    <>
                      <Icon
                        aria-hidden
                        className="size-3.5 shrink-0"
                        style={{ color: pinColor(p.icon) }}
                      />
                      {p.label}
                    </>
                  )
                  return (
                    <div
                      key={pl.id}
                      className={cn(
                        // Only buttons take the pointer; plain labels let hover reach the map.
                        "pointer-events-none absolute",
                        p.emphasis || selected ? "z-10" : undefined,
                      )}
                      style={{
                        left: pct(pl.box.x + pl.box.w / 2, width),
                        top: pct(pl.box.y, height),
                        transform: "translateX(-50%)",
                      }}
                    >
                      <motion.div
                        initial={{ opacity: 0, y: -6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25, ease: "easeOut" }}
                      >
                        {interactive ? (
                          <button
                            ref={ref}
                            type="button"
                            aria-label={
                              selectable === "pin"
                                ? `Select ${p.title ? `${p.title}, ${p.label}` : p.label}`
                                : `${p.title}: ${p.label}`
                            }
                            aria-pressed={
                              selectable === "pin" ? selected : undefined
                            }
                            aria-disabled={
                              selectable === "pin" && locked ? true : undefined
                            }
                            onClick={() => {
                              if (selectable === "pin") selectPin(p.id)
                              else
                                setHoverTip((t) =>
                                  t?.key === p.id ? null : pinTip,
                                )
                            }}
                            onPointerEnter={() => setHoverTip(pinTip)}
                            onPointerLeave={() => setHoverTip(null)}
                            onFocus={() => setHoverTip(pinTip)}
                            onBlur={() => setHoverTip(null)}
                            className={cn(
                              pillClass,
                              "pointer-events-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                              selectable === "pin" &&
                                locked &&
                                !selected &&
                                "cursor-default",
                            )}
                          >
                            {content}
                          </button>
                        ) : (
                          <span ref={ref} aria-hidden className={pillClass}>
                            {content}
                          </span>
                        )}
                      </motion.div>
                    </div>
                  )
                })}
              </>
            ) : failed ? (
              <div className="absolute inset-0 flex items-center justify-center rounded-[10px] border border-border bg-transparent text-[13px] leading-5 text-muted-foreground">
                The map couldn't load.
              </div>
            ) : (
              <Skeleton className="absolute inset-0 size-full rounded-[10px]" />
            )}

            {tip && tipContent && (
              <div
                aria-hidden
                className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg border bg-popover px-2.5 py-1 text-[13px] leading-4 text-popover-foreground shadow-sm dark:shadow-none"
                style={{
                  left: Math.min(Math.max(tip.x, 64), Math.max(64, width - 64)),
                  top: tip.y < 48 ? tip.y + 16 : tip.y - 8,
                  transform:
                    tip.y < 48 ? "translateX(-50%)" : "translate(-50%, -100%)",
                }}
              >
                <span className="font-medium">{tipContent.name}</span>
                {tipContent.value && (
                  <span className="ml-1.5 tabular-nums text-muted-foreground">
                    {tipContent.value}
                  </span>
                )}
              </div>
            )}
          </div>
        </figure>

        {(buckets || highlighted.size > 0 || notShown.length > 0) && (
          <div
            className={cn(
              "flex flex-col gap-3 border-t border-border py-3",
              surfaceInset,
            )}
          >
            {(buckets || highlighted.size > 0) && (
              // One compact row; the legend label lives in the sr-only caption.
              <ul
                aria-label={scale.legendLabel ?? "Legend"}
                className={cn(
                  "flex flex-wrap gap-x-3 gap-y-1.5 tabular-nums",
                  genuiType.meta,
                )}
              >
                {buckets &&
                  legend.map((label, i) => (
                    <li key={label} className="flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-3 rounded-sm"
                        style={{
                          background: mix(bucketStrength(i, buckets.count)),
                        }}
                      />
                      {label}
                    </li>
                  ))}
                {highlighted.size > 0 && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className={cn(
                        "size-3 rounded-sm",
                        buckets && "border border-foreground/50",
                      )}
                      style={{
                        background: buckets
                          ? "var(--muted)"
                          : mix(HIGHLIGHT_STRENGTH, HIGHLIGHT_INK),
                      }}
                    />
                    {highlightLabel ?? "Highlighted"}
                  </li>
                )}
                {buckets && (
                  <li className="flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-3 rounded-sm border bg-muted"
                    />
                    No data
                  </li>
                )}
              </ul>
            )}

            {!streaming && notShown.length > 0 && (
              <p className={genuiType.meta}>
                Not on this map: {notShown.join(", ")}
              </p>
            )}
          </div>
        )}

        {sorted.length > 0 && (
          <table className="sr-only">
            <caption>
              {scale.legendLabel ?? title ?? "Values by region"}
            </caption>
            <thead>
              <tr>
                <th scope="col">{area === "world" ? "Country" : "State"}</th>
                <th scope="col">Value</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    {selectable === "region" ? (
                      <button
                        type="button"
                        aria-pressed={selectedRegion === r.key}
                        aria-disabled={locked ? true : undefined}
                        onFocus={() => setFocusKey(r.key)}
                        onBlur={() => setFocusKey(null)}
                        onClick={() => selectRegion(r)}
                      >
                        {`Select ${r.name}`}
                      </button>
                    ) : (
                      r.name
                    )}
                  </th>
                  <td>{r.full}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {highlighted.size > 0 && (
          <p className="sr-only">
            {`${highlightLabel ?? "Highlighted"}: ${[...highlighted]
              .map((k) => regionName(area, k))
              .join(", ")}`}
          </p>
        )}
        {!pinsOnly && readyPins.length > 0 && (
          <ul className="sr-only" aria-label="Marked locations">
            {readyPins.map((p) => (
              <li key={p.id}>{p.title ? `${p.title}: ${p.label}` : p.label}</li>
            ))}
          </ul>
        )}

        {selectable !== "none" && (
          // The live region stays mounted; the footer shows only real state.
          <div aria-live="polite">
            {status === "submitted" ? (
              <SurfaceFooter>
                <p className="flex items-center gap-1.5 text-[13px] leading-5">
                  <CheckIcon aria-hidden className="size-4" />
                  {chosenName ? `Selected ${chosenName}` : "Selection sent"}
                </p>
              </SurfaceFooter>
            ) : streaming ? (
              <SurfaceFooter>
                <p className={genuiType.meta}>
                  <ShimmeringText
                    text="Loading map…"
                    color="var(--muted-foreground)"
                    shimmeringColor="var(--foreground)"
                  />
                </p>
              </SurfaceFooter>
            ) : (
              <p className="sr-only">
                {selectable === "region"
                  ? `Choose a ${regionNoun} with a value on the map.`
                  : "Choose a location on the map."}
              </p>
            )}
          </div>
        )}
      </Surface>
    </MotionConfig>
  )
}
