"use client"

import "maplibre-gl/dist/maplibre-gl.css"

import * as React from "react"
import { createPortal } from "react-dom"
import {
  AnchorIcon,
  BedDoubleIcon,
  BinocularsIcon,
  Building2Icon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CompassIcon,
  CrosshairIcon,
  DropletsIcon,
  ExternalLinkIcon,
  LandmarkIcon,
  ListFilterIcon,
  LocateFixedIcon,
  type LucideIcon,
  MapPinIcon,
  Maximize2Icon,
  Minimize2Icon,
  MountainIcon,
  SailboatIcon,
  StarIcon,
  TreesIcon,
  UtensilsIcon,
  WavesIcon,
  XIcon,
} from "lucide-react"
import { MotionConfig, motion, useReducedMotion } from "motion/react"
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker,
  Popup,
} from "maplibre-gl"

import { cn } from "@/lib/utils"
import { ShimmeringText } from "@/components/animate-ui/primitives/texts/shimmering"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
  SurfaceFooter,
  SurfaceHeader,
  SurfaceTitle,
  genuiHit,
  genuiType,
  genuiMotion,
} from "@/components/genui/surface"

import type {
  MapAnchor,
  MapCenter,
  MapDay,
  MapInput,
  MapPlace,
  MapRefinement,
  MapResult,
  MapSearch,
  MapStay,
  MapStop,
  MapStopKind,
} from "./map.schema"
import {
  type LatLng,
  type LngLat,
  boundsOf,
  cycle,
  dayLabel,
  dayLeg,
  describeStay,
  distanceLine,
  formatCoords,
  formatPrice,
  formatRating,
  groupByDay,
  isAnchor,
  isPlace,
  picksOf,
  readyStays,
  readyStops,
  reasonLabel,
  routeLine,
  safeHttpUrl,
  safeImageSrc,
  searchLine,
  showsLabel,
  sortByOrder,
  statusLine,
  stepIndex,
  stopDays,
  stopsForDay,
  stripOrder,
  validPath,
} from "./map-utils"
import { IconTip, WhyDisabled } from "@/components/genui/hint"
import { useGenUILocale } from "@/components/genui/locale"

export { formatCoords, sortByOrder }

export type MapStatus = "streaming" | "ready" | "submitted" | "cancelled"

export type MapViewProps = Partial<
  Omit<
    MapInput,
    "places" | "center" | "stops" | "days" | "anchor" | "stays" | "search" | "refinements"
  >
> & {
  /** Places may be partial while the tool call streams. */
  places?: Partial<MapPlace>[]
  center?: Partial<MapCenter>
  /** 'itinerary' stops; partial while streaming. */
  stops?: Partial<MapStop>[]
  days?: Partial<MapDay>[]
  /** 'nearby': the anchor, stays, search and refinements; partial while streaming. */
  anchor?: Partial<MapAnchor>
  stays?: Partial<MapStay>[]
  search?: Partial<MapSearch>
  refinements?: Partial<MapRefinement>[]
  /** Lifecycle, controlled by the host. */
  status?: MapStatus
  /** Called once with the user's choice in 'pick', 'pin', selectable 'itinerary' and 'nearby'. */
  onResult?: (result: MapResult) => void
  /** A choice from history. Restores the selection or pin and locks; never calls onResult. */
  result?: MapResult
  className?: string
}

type MapLibre = typeof import("maplibre-gl")

const STYLES = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  // A friendlier light map (soft water and parks) for maps that stay light
  // in either theme.
  voyager: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
}
/** Light-theme colours for what sits on the light map (markers, popups). */
const LIGHT_MAP_TOKENS = {
  "--foreground": "#262626",
  "--background": "#ffffff",
  "--popover": "#ffffff",
  "--popover-foreground": "#3d3d3d",
  "--muted-foreground": "#5d5d5d",
} as React.CSSProperties

const ROUTE_ID = "genui-map-route"
const DAY_ROUTE_ID = "genui-map-route-day"
const PIN_STEP = 10

const isDark = () => document.documentElement.classList.contains("dark")

/** Resolves a CSS color variable to rgba(), which WebGL paint properties accept. */
function resolveColor(name: string, fallback: string) {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim()
    const ctx = document.createElement("canvas").getContext("2d")
    if (!raw || !ctx) return fallback
    ctx.fillStyle = fallback
    ctx.fillStyle = raw
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
    return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`
  } catch {
    return fallback
  }
}

/** Vertices where the path turns by more than ~28 degrees. */
function turnPoints(coordinates: LngLat[]): LngLat[] {
  const out: LngLat[] = []
  for (let i = 1; i < coordinates.length - 1; i++) {
    const [ax, ay] = coordinates[i - 1]
    const [bx, by] = coordinates[i]
    const [cx, cy] = coordinates[i + 1]
    const a1 = Math.atan2(by - ay, bx - ax)
    const a2 = Math.atan2(cy - by, cx - bx)
    let d = Math.abs(a2 - a1)
    if (d > Math.PI) d = 2 * Math.PI - d
    if (d > 0.49) out.push(coordinates[i])
  }
  return out
}

type LinePaint = {
  color: string
  width: number
  opacity: number
  /** A wider outline under the line, and white dots where the path turns. */
  casing?: string
  /** Dashes say "as the crow flies"; a routed path is solid. */
  dashed?: boolean
}

/** Draws or updates one line layer. Empty coordinates clear it. */
function setLine(
  map: MapLibreMap,
  id: string,
  coordinates: LngLat[],
  paint: LinePaint,
) {
  const data = {
    type: "FeatureCollection" as const,
    features:
      coordinates.length > 1
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "LineString" as const, coordinates },
            },
          ]
        : [],
  }
  const turns = {
    type: "FeatureCollection" as const,
    features: paint.casing
      ? turnPoints(coordinates).map((c) => ({
          type: "Feature" as const,
          properties: {},
          geometry: { type: "Point" as const, coordinates: c },
        }))
      : [],
  }
  const turnsId = `${id}-turns`
  try {
    const source = map.getSource(id) as GeoJSONSource | undefined
    if (source) {
      source.setData(data)
      map.setPaintProperty(id, "line-color", paint.color)
      map.setPaintProperty(id, "line-opacity", paint.opacity)
      const dots = map.getSource(turnsId) as GeoJSONSource | undefined
      dots?.setData(turns)
      return
    }
    map.addSource(id, { type: "geojson", data })
    if (paint.casing) {
      map.addLayer({
        id: `${id}-casing`,
        type: "line",
        source: id,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": paint.casing,
          "line-width": paint.width + 3.5,
          "line-opacity": paint.opacity,
        },
      })
    }
    map.addLayer({
      id,
      type: "line",
      source: id,
      layout: {
        "line-join": "round",
        "line-cap": paint.dashed ? "butt" : "round",
      },
      paint: {
        "line-color": paint.color,
        "line-width": paint.width,
        "line-opacity": paint.opacity,
        ...(paint.dashed ? { "line-dasharray": [2, 1.5] } : {}),
      },
    })
    if (paint.casing) {
      map.addSource(turnsId, { type: "geojson", data: turns })
      map.addLayer({
        id: turnsId,
        type: "circle",
        source: turnsId,
        paint: {
          "circle-radius": 4.5,
          "circle-color": "#ffffff",
          "circle-stroke-color": paint.casing,
          "circle-stroke-width": 2,
        },
      })
    }
  } catch {
    // The style is mid-swap; 'style.load' calls this again.
  }
}

/**
 * Creates one MapLibre map on the client, following the page's `.dark` class.
 * The map's container is created here and appended to `hostRef`, so a view
 * can move it (e.g. into a fullscreen layer) without recreating the map.
 */
function useMapLibre({
  label,
  onStyleLoad,
  onClick,
  controlsTop,
  light,
}: {
  label: string
  onStyleLoad?: () => void
  onClick?: (e: MapMouseEvent) => void
  /** Push the zoom buttons down, clear of controls drawn over the map. */
  controlsTop?: number
  /**
   * Always use a light map, even when the page is dark: 'voyager' (soft water
   * and parks) or 'positron' (the plain light map).
   */
  light?: "voyager" | "positron"
}) {
  const hostRef = React.useRef<HTMLDivElement>(null)
  const elRef = React.useRef<HTMLDivElement | null>(null)
  const libRef = React.useRef<MapLibre | null>(null)
  const styleReadyRef = React.useRef(false)
  const userMovedRef = React.useRef(false)
  const [map, setMap] = React.useState<MapLibreMap | null>(null)
  const [mapState, setMapState] = React.useState<"loading" | "ready" | "error">(
    "loading",
  )
  // Read once, when the map is created.
  const optionsRef = React.useRef({ controlsTop, light })
  const styleLoaded = React.useEffectEvent(() => onStyleLoad?.())
  const clicked = React.useEffectEvent((e: MapMouseEvent) => onClick?.(e))

  // maplibre touches window, so it loads on the client only.
  React.useEffect(() => {
    const host = hostRef.current
    if (!host || typeof window === "undefined") return
    let cancelled = false
    let instance: MapLibreMap | null = null
    let observer: MutationObserver | null = null
    let fallback: number | undefined

    // Inline: maplibre's own CSS sets .maplibregl-map { position: relative },
    // which beats Tailwind's layered utilities and collapses the map.
    const container = document.createElement("div")
    container.style.position = "absolute"
    container.style.inset = "0"
    host.append(container)
    elRef.current = container

    import("maplibre-gl")
      .then((lib) => {
        if (cancelled) return
        libRef.current = lib
        // Bundlers rewrite the worker's default location, so point it at the
        // matching published build unless the host app already set one.
        if (!lib.getWorkerUrl()) {
          lib.setWorkerUrl(
            `https://cdn.jsdelivr.net/npm/maplibre-gl@${lib.getVersion()}/dist/maplibre-gl-worker.mjs`,
          )
        }
        const wantsDark = () => !optionsRef.current.light && isDark()
        const styleUrl = (dark: boolean) =>
          dark
            ? STYLES.dark
            : optionsRef.current.light === "voyager"
              ? STYLES.voyager
              : STYLES.light
        let dark = wantsDark()
        try {
          instance = new lib.Map({
            container,
            style: styleUrl(dark),
            center: [0, 20],
            zoom: 1,
            attributionControl: { compact: false },
            cooperativeGestures: true,
            dragRotate: false,
            pitchWithRotate: false,
            touchPitch: false,
          })
        } catch {
          setMapState("error")
          return
        }
        const m = instance
        m.touchZoomRotate.disableRotation()
        m.keyboard.disableRotation()
        m.addControl(
          new lib.NavigationControl({ showCompass: false }),
          "top-right",
        )
        // Inline, for the same reason as the container: maplibre's CSS is
        // unlayered and wins over Tailwind utilities.
        const corner = container.querySelector<HTMLElement>(
          ".maplibregl-ctrl-top-right",
        )
        const top = optionsRef.current.controlsTop
        if (corner && top) corner.style.top = `${top}px`
        m.on("style.load", () => {
          styleReadyRef.current = true
          styleLoaded()
        })
        m.on("load", () => setMapState("ready"))
        // Don't leave the placeholder up if tiles are slow or blocked.
        fallback = window.setTimeout(() => setMapState("ready"), 8000)
        m.on("click", (e) => clicked(e))
        m.on("movestart", (e) => {
          if (e.originalEvent) userMovedRef.current = true
        })
        observer = new MutationObserver(() => {
          if (wantsDark() === dark) return
          dark = wantsDark()
          styleReadyRef.current = false
          m.setStyle(styleUrl(dark), { diff: false })
        })
        observer.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class"],
        })
        setMap(m)
      })
      .catch(() => {
        if (!cancelled) setMapState("error")
      })

    return () => {
      cancelled = true
      window.clearTimeout(fallback)
      observer?.disconnect()
      styleReadyRef.current = false
      instance?.remove()
      container.remove()
      elRef.current = null
    }
  }, [])

  // Name the canvas after the map, for screen readers that reach it.
  React.useEffect(() => {
    map?.getCanvas().setAttribute("aria-label", label)
  }, [map, label])

  return { hostRef, elRef, libRef, styleReadyRef, userMovedRef, map, mapState }
}

function MapStateOverlay({ state }: { state: "loading" | "ready" | "error" }) {
  if (state === "loading") {
    return (
      <Skeleton className="pointer-events-none absolute inset-0 rounded-none" />
    )
  }
  if (state === "error") {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-transparent p-3 text-center text-[13px] text-muted-foreground">
        Map couldn't load.
      </div>
    )
  }
  return null
}

/** One map: three modes of places, the itinerary view and stays nearby. */
export function MapView(props: MapViewProps) {
  if (props.mode === "itinerary") return <ItineraryMap {...props} />
  if (props.mode === "nearby") return <NearbyMap {...props} />
  return <PlacesMap {...props} />
}

// ---------------------------------------------------------------------------
// Places: view, pick, pin

// `maplibregl-marker` carries `position: absolute`; assigning className would drop it.
const markerBase =
  "maplibregl-marker flex size-6 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"

// One colour per number, shared by the pin on the map and the row in the list.
const NUMBER_TONES = [
  "bg-sky-500 text-white",
  "bg-emerald-500 text-white",
  "bg-orange-500 text-white",
  "bg-pink-500 text-white",
  "bg-teal-500 text-white",
  "bg-amber-500 text-white",
  "bg-rose-500 text-white",
  "bg-slate-700 text-white",
]

function numberTone(n: number) {
  return NUMBER_TONES[(n - 1) % NUMBER_TONES.length]
}

function markerClass(n: number | undefined, selected: boolean) {
  if (n !== undefined) {
    return cn(
      markerBase,
      numberTone(n),
      "text-[13px] font-semibold tabular-nums shadow-sm dark:shadow-none ring-2 ring-background",
      selected && "outline-2 outline-offset-2 outline-choice",
    )
  }
  return cn(markerBase, selected && "outline-2 outline-choice")
}

function dotClass(selected: boolean) {
  return cn(
    "block rounded-full bg-foreground shadow-sm dark:shadow-none ring-2 ring-background transition-[width,height]",
    selected ? "size-4" : "size-3",
  )
}

function PlacesMap({
  title,
  mode = "view",
  places = [],
  route = false,
  center,
  zoom,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: MapViewProps) {
  const [selected, setSelected] = React.useState<string | null>(() =>
    result?.action === "select" ? result.placeId : null,
  )
  const [pin, setPin] = React.useState<LatLng | null>(() =>
    result?.action === "pin" ? { lat: result.lat, lng: result.lng } : null,
  )
  const [decision, setDecision] = React.useState<
    "submitted" | "cancelled" | null
  >(() =>
    result ? (result.action === "cancel" ? "cancelled" : "submitted") : null,
  )

  const markersRef = React.useRef(
    new globalThis.Map<string, { marker: Marker; el: HTMLButtonElement }>(),
  )
  const pinRef = React.useRef<{ marker: Marker; el: HTMLButtonElement } | null>(
    null,
  )
  const popupRef = React.useRef<Popup | null>(null)
  const reduceMotion = useReducedMotion()

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: MapStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const locked = status !== "ready"
  const interactive = mode === "pick" || mode === "pin"

  // `route` is true, or a detailed path to follow instead of straight lines.
  const routeOn = Boolean(route)
  const path =
    typeof route === "object" && route ? validPath(route.coordinates) : null

  const ready = places.filter(isPlace)
  const listed = routeOn ? sortByOrder(ready) : ready
  const numberOf = new globalThis.Map(
    routeOn ? listed.map((p, i) => [p.id, i + 1] as const) : [],
  )
  const selectedPlace = ready.find((p) => p.id === selected)

  // Keys that change only when what's drawn on the map changes.
  const placesKey = ready
    .map((p) => `${p.id}:${p.lat}:${p.lng}:${p.order ?? ""}`)
    .join("|")
  const labelsKey = ready.map((p) => p.name).join("|")
  const viewKey = `${center?.lat ?? ""}:${center?.lng ?? ""}:${zoom ?? ""}`
  const routeKey = `${routeOn}:${path ? `${path.length}:${path[0]}:${path[path.length - 1]}` : ""}`

  const duration = reduceMotion ? 0 : 400

  const label = (p: MapPlace) => {
    const n = numberOf.get(p.id)
    return n ? `${n}. ${p.name}` : p.name
  }

  const onMapClick = (e: MapMouseEvent) => {
    const target = e.originalEvent?.target
    // Clicks on markers belong to the marker, not the map.
    if (target instanceof Element && target.closest(".maplibregl-marker")) {
      return
    }
    if (mode !== "pin" || locked) return
    const { lat, lng } = e.lngLat.wrap()
    setPin({ lat, lng })
  }

  const { hostRef, libRef, styleReadyRef, userMovedRef, map, mapState } =
    useMapLibre({
      label: `Map: ${title ?? "places"}`,
      onStyleLoad: () => syncRoute(),
      onClick: onMapClick,
      light: "voyager",
    })

  // Markers, pin and popup go with the map; drop the references on unmount.
  React.useEffect(() => {
    const markers = markersRef.current
    return () => {
      markers.clear()
      pinRef.current = null
      popupRef.current = null
    }
  }, [])

  const showPopup = (p: MapPlace) => {
    const lib = libRef.current
    if (!map || !lib) return
    const content = document.createElement("div")
    const name = document.createElement("p")
    name.className = "text-[13px] font-semibold"
    name.textContent = label(p)
    content.append(name)
    if (p.description) {
      const desc = document.createElement("p")
      desc.className = genuiType.meta
      desc.textContent = p.description
      content.append(desc)
    }
    popupRef.current?.remove()
    popupRef.current = new lib.Popup({
      offset: 16,
      maxWidth: "240px",
      focusAfterOpen: false,
    })
      .setLngLat([p.lng, p.lat])
      .setDOMContent(content)
      .addTo(map)
  }

  /** From the list: center the place and open its popup. */
  const focusPlace = (p: MapPlace) => {
    if (!map) return
    userMovedRef.current = true
    map.easeTo({ center: [p.lng, p.lat], duration })
    showPopup(p)
  }

  const choose = (p: MapPlace) => {
    if (locked) return
    setSelected(p.id)
    focusPlace(p)
  }

  const onMarkerClick = React.useEffectEvent((id: string) => {
    const p = ready.find((r) => r.id === id)
    if (!p) return
    showPopup(p)
    if (mode === "pick" && !locked) setSelected(id)
  })

  /** Arrow keys nudge the focused pin; Shift moves it further. */
  const onPinKeyDown = React.useEffectEvent((e: KeyboardEvent) => {
    const step = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }[e.key]
    if (!step || !map || !pin || locked) return
    e.preventDefault()
    e.stopPropagation()
    const size = e.shiftKey ? PIN_STEP * 5 : PIN_STEP
    const point = map.project([pin.lng, pin.lat])
    const next = map
      .unproject([point.x + step[0] * size, point.y + step[1] * size])
      .wrap()
    setPin({ lat: next.lat, lng: next.lng })
  })

  // `_trigger` is unused: effects pass what changed so their deps stay honest.
  const syncRoute = React.useEffectEvent((_trigger?: string) => {
    if (!map || !styleReadyRef.current) return
    const coords: LngLat[] = routeOn
      ? (path ?? listed.map((p) => [p.lng, p.lat]))
      : []
    setLine(map, ROUTE_ID, coords, {
      // The map is light in both themes: a thick indigo line with a darker
      // outline and white dots where it turns.
      color: "#4f46e5",
      casing: "#1e1b8f",
      width: 5,
      opacity: 1,
    })
  })

  /** Place markers: created once per place, updated in place. */
  const syncMarkers = React.useEffectEvent(
    (map: MapLibreMap, _trigger: string) => {
      const lib = libRef.current
      if (!lib) return
      const markers = markersRef.current
      const seen = new Set<string>()
      for (const p of ready) {
        seen.add(p.id)
        let entry = markers.get(p.id)
        if (!entry) {
          const el = document.createElement("button")
          el.type = "button"
          const id = p.id
          el.addEventListener("click", (e) => {
            e.stopPropagation()
            onMarkerClick(id)
          })
          const marker = new lib.Marker({ element: el, anchor: "center" })
            .setLngLat([p.lng, p.lat])
            .addTo(map)
          entry = { marker, el }
          markers.set(p.id, entry)
        } else {
          entry.marker.setLngLat([p.lng, p.lat])
        }
        const n = numberOf.get(p.id)
        const isSelected = mode === "pick" && selected === p.id
        entry.el.className = markerClass(n, isSelected)
        entry.el.setAttribute("aria-label", label(p))
        if (mode === "pick") {
          entry.el.setAttribute("aria-pressed", String(isSelected))
        } else {
          entry.el.removeAttribute("aria-pressed")
        }
        if (n !== undefined) {
          entry.el.textContent = String(n)
        } else {
          const dot = document.createElement("span")
          dot.className = dotClass(isSelected)
          entry.el.replaceChildren(dot)
        }
      }
      for (const [id, entry] of markers) {
        if (!seen.has(id)) {
          entry.marker.remove()
          markers.delete(id)
        }
      }
    },
  )

  /** Initial view: the given center, else fit to the places, until the user moves the map. */
  const syncView = React.useEffectEvent(
    (map: MapLibreMap, _trigger: string) => {
      const lib = libRef.current
      if (!lib || userMovedRef.current) return
      try {
        if (
          center &&
          Number.isFinite(center.lat) &&
          Number.isFinite(center.lng)
        ) {
          map.jumpTo({
            center: [center.lng as number, center.lat as number],
            zoom: zoom ?? 14,
          })
        } else if (ready.length === 1) {
          map.jumpTo({
            center: [ready[0].lng, ready[0].lat],
            zoom: zoom ?? 14,
          })
        } else if (ready.length > 1) {
          const bounds = new lib.LngLatBounds()
          for (const p of ready) bounds.extend([p.lng, p.lat])
          map.fitBounds(bounds, {
            padding: 48,
            maxZoom: 15,
            duration: streaming ? 0 : duration,
          })
        } else if (pin) {
          map.jumpTo({ center: [pin.lng, pin.lat], zoom: zoom ?? 16 })
        }
      } catch {
        // A zero-size container can't fit bounds; the next change retries.
      }
    },
  )

  // Each sync runs when the inputs it draws change; the keys stand in for them.
  React.useEffect(() => {
    if (map)
      syncMarkers(
        map,
        `${placesKey}#${labelsKey}#${routeKey}#${mode}#${selected}`,
      )
  }, [map, placesKey, labelsKey, routeKey, mode, selected])

  React.useEffect(() => {
    if (map) syncRoute(`${placesKey}#${routeKey}`)
  }, [map, placesKey, routeKey])

  React.useEffect(() => {
    if (map) syncView(map, `${placesKey}#${viewKey}`)
  }, [map, placesKey, viewKey])

  // The dropped pin: draggable until the choice is sent.
  React.useEffect(() => {
    const lib = libRef.current
    if (!map || !lib) return
    if (mode !== "pin" || !pin) {
      pinRef.current?.marker.remove()
      pinRef.current = null
      return
    }
    let entry = pinRef.current
    if (!entry) {
      const el = document.createElement("button")
      el.type = "button"
      el.className = cn(
        markerBase,
        "border-2 border-foreground bg-background shadow-sm dark:shadow-none",
      )
      const dot = document.createElement("span")
      dot.className = "block size-2 rounded-full bg-foreground"
      el.append(dot)
      el.addEventListener("keydown", (e) => onPinKeyDown(e))
      el.addEventListener("click", (e) => e.stopPropagation())
      const marker = new lib.Marker({ element: el, anchor: "center" })
        .setLngLat([pin.lng, pin.lat])
        .addTo(map)
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat().wrap()
        setPin({ lat, lng })
      })
      entry = { marker, el }
      pinRef.current = entry
    } else {
      entry.marker.setLngLat([pin.lng, pin.lat])
    }
    entry.marker.setDraggable(!locked)
    entry.el.setAttribute(
      "aria-label",
      locked
        ? `Pin at ${formatCoords(pin)}`
        : `Pin at ${formatCoords(pin)}. Drag it or use the arrow keys to move it.`,
    )
  }, [map, libRef, mode, pin, locked])

  const dropAtCenter = () => {
    if (!map || locked) return
    const { lat, lng } = map.getCenter().wrap()
    setPin({ lat, lng })
  }

  const submit = () => {
    if (locked) return
    if (mode === "pick" && selectedPlace) {
      setDecision("submitted")
      onResult?.({ action: "select", placeId: selectedPlace.id })
    } else if (mode === "pin" && pin) {
      setDecision("submitted")
      // Six decimals (about 10 cm): no floating-point noise in the result.
      const round = (n: number) => Math.round(n * 1e6) / 1e6
      onResult?.({ action: "pin", lat: round(pin.lat), lng: round(pin.lng) })
    }
  }

  const cancel = () => {
    if (locked) return
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  const canSubmit = mode === "pick" ? Boolean(selectedPlace) : Boolean(pin)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="map"
        data-status={status}
        data-mode={mode}
        aria-busy={streaming}
        aria-label={title ?? "Map"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
          {mode === "pin" && !locked && (
            <p className="sr-only">
              Click the map to drop a pin, then drag it to adjust.
            </p>
          )}
        </SurfaceHeader>

        <div className="border-t border-border">
          {/* A rounded box inside the card's padding. The map stays light in
              both themes, so its markers and popups use light-theme colours. */}
          <div className="px-3 py-3">
            <div
              style={LIGHT_MAP_TOKENS}
              className={cn(
                "relative h-[240px] overflow-hidden rounded-lg",
                // Popups follow the theme instead of maplibre's white default.
                "[&_.maplibregl-popup-content]:rounded-lg [&_.maplibregl-popup-content]:bg-popover [&_.maplibregl-popup-content]:py-2.5 [&_.maplibregl-popup-content]:pr-8 [&_.maplibregl-popup-content]:pl-3.5 [&_.maplibregl-popup-content]:text-popover-foreground [&_.maplibregl-popup-content]:shadow-md dark:[&_.maplibregl-popup-content]:shadow-none [&_.maplibregl-popup-tip]:hidden [&_.maplibregl-popup-close-button]:size-6 [&_.maplibregl-popup-close-button]:text-muted-foreground",
              )}
            >
              <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
              <MapStateOverlay state={mapState} />
            </div>
          </div>

          {mode === "pin" && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3">
              <p className={cn(genuiType.body, "tabular-nums")}>
                {pin ? (
                  <>
                    <span className="sr-only">Pin: </span>
                    {formatCoords(pin)}
                  </>
                ) : (
                  <span className="text-muted-foreground">No pin yet</span>
                )}
              </p>
              {!locked && (
                <WhyDisabled when={!map} reason="The map is still loading">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={dropAtCenter}
                    disabled={!map}
                  >
                    <CrosshairIcon aria-hidden />
                    {pin ? "Move pin to map center" : "Drop pin at map center"}
                  </Button>
                </WhyDisabled>
              )}
            </div>
          )}
        </div>

        {(listed.length > 0 || (streaming && mode !== "pin")) && (
          <ul
            aria-label="Places"
            className="flex flex-col border-t border-border px-1.5 py-1.5"
          >
            {listed.map((p) => {
              const n = numberOf.get(p.id)
              const isSelected = mode === "pick" && selected === p.id
              return (
                <motion.li
                  key={p.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className={cn(
                    "flex items-center gap-3 rounded-[10px] px-3 py-3 transition-colors hover:bg-muted dark:hover:bg-white/5",
                    isSelected &&
                      "ring-2 ring-choice ring-inset border-choice hover:bg-transparent dark:hover:bg-transparent",
                  )}
                >
                  <span
                    aria-hidden
                    className="flex size-8 shrink-0 items-center justify-center"
                  >
                    {n ? (
                      <span
                        className={cn(
                          "flex size-8 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums",
                          numberTone(n),
                        )}
                      >
                        {n}
                      </span>
                    ) : (
                      <span className="size-2.5 rounded-full bg-foreground" />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn(genuiType.body, "font-semibold")}>
                        {n && <span className="sr-only">{`${n}. `}</span>}
                        {p.name}
                      </span>
                      {p.category && (
                        <Badge variant="info" className="h-5 self-center">
                          {p.category}
                        </Badge>
                      )}
                    </div>
                    {p.description && (
                      <p className={genuiType.meta}>{p.description}</p>
                    )}
                  </div>
                  {mode === "pick" ? (
                    <WhyDisabled when={locked} reason="Already answered">
                      <Button
                        size="sm"
                        variant={isSelected ? "default" : "outline"}
                        aria-pressed={isSelected}
                        aria-label={`Select ${p.name}`}
                        disabled={locked}
                        onClick={() => choose(p)}
                        className="shrink-0"
                      >
                        {isSelected && <CheckIcon aria-hidden />}
                        {isSelected ? "Selected" : "Select"}
                      </Button>
                    </WhyDisabled>
                  ) : (
                    <WhyDisabled when={!map} reason="The map is still loading">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Show ${p.name} on the map`}
                        disabled={!map}
                        onClick={() => focusPlace(p)}
                        className="shrink-0"
                      >
                        Show
                      </Button>
                    </WhyDisabled>
                  )}
                </motion.li>
              )
            })}
            {streaming && (
              <li
                aria-hidden
                className="flex items-center gap-3 rounded-[10px] px-3 py-3"
              >
                <Skeleton className="size-5 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-40 max-w-full" />
                  <Skeleton className="h-3 w-56 max-w-full" />
                </div>
              </li>
            )}
          </ul>
        )}

        {interactive && (
          <SurfaceFooter
            aria-live="polite"
            className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {status === "submitted" ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {mode === "pick"
                  ? `Chose ${selectedPlace?.name ?? "a place"}`
                  : `Pin sent: ${pin ? formatCoords(pin) : ""}`}
              </p>
            ) : status === "cancelled" ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <XIcon aria-hidden className="size-4 shrink-0" />
                Cancelled. Nothing was sent.
              </p>
            ) : (
              <>
                {streaming ? (
                  <p className={genuiType.meta}>
                    <ShimmeringText
                      text="Loading places…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  </p>
                ) : (
                  // The selected row already shows the choice; announce it only.
                  <p className="sr-only">
                    {mode === "pick" && selectedPlace
                      ? `Selected: ${selectedPlace.name}`
                      : ""}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 sm:ml-auto sm:shrink-0">
                  <WhyDisabled className="flex flex-1 sm:flex-none" when={locked} reason="Already answered">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancel}
                      disabled={locked}
                      className="flex-1 sm:flex-none"
                    >
                      Cancel
                    </Button>
                  </WhyDisabled>
                  <WhyDisabled
                    className="flex flex-1 sm:flex-none"
                    when={locked || !canSubmit}
                    reason="Pick a place first"
                  >
                    <Button
                      size="sm"
                      onClick={submit}
                      disabled={locked || !canSubmit}
                      className="flex-1 sm:flex-none"
                    >
                      {submitLabel ??
                        (mode === "pick"
                          ? "Choose this place"
                          : "Use this spot")}
                    </Button>
                  </WhyDisabled>
                </div>
              </>
            )}
          </SurfaceFooter>
        )}
      </Surface>
    </MotionConfig>
  )
}

// ---------------------------------------------------------------------------
// Itinerary

const KIND_ICONS: Record<MapStopKind, LucideIcon> = {
  beach: WavesIcon,
  mountain: MountainIcon,
  city: Building2Icon,
  forest: TreesIcon,
  lake: SailboatIcon,
  waterfall: DropletsIcon,
  harbor: AnchorIcon,
  museum: LandmarkIcon,
  food: UtensilsIcon,
  hotel: BedDoubleIcon,
  viewpoint: BinocularsIcon,
  activity: CompassIcon,
}

const kindIcon = (kind: MapStop["kind"]) =>
  (kind && KIND_ICONS[kind]) || MapPinIcon

/** Floating controls on the map: translucent so the map reads through. */
const floating =
  "bg-background/85 text-foreground shadow-md dark:shadow-none ring-1 ring-foreground/10 backdrop-blur-sm transition-colors hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

/** Space under the card strip, so the tile attribution stays visible. */
const ATTRIBUTION_GAP = 28
const TOP_CONTROLS = 56

/** Zoom buttons sit under the Expand pill, not behind it. */
const ZOOM_TOP = 46

/** Keeps maplibre's own z-indexes (markers, controls) under the overlays. */
const hostStyle = {
  position: "absolute",
  inset: 0,
  isolation: "isolate",
} as const

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const LABEL_HALO =
  "[text-shadow:0_0_2px_var(--background),0_0_4px_var(--background),0_0_6px_var(--background)]"

function StopMarker({
  stop,
  selected,
  dimmed,
  labelled,
}: {
  stop: MapStop
  selected: boolean
  dimmed: boolean
  labelled: boolean
}) {
  const Icon = kindIcon(stop.kind)
  return (
    <>
      <span
        className={cn(
          "flex size-7 cursor-pointer items-center justify-center rounded-full border-2 border-foreground bg-background text-foreground shadow-md dark:shadow-none transition-[scale,opacity,background-color,color] duration-200 motion-reduce:transition-none",
          selected && "scale-125 bg-foreground text-background",
          dimmed && "opacity-40",
        )}
      >
        <Icon className="size-3.5" strokeWidth={2.25} />
      </span>
      {labelled && (
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 left-full ml-2 -translate-y-1/2 font-sans text-[13px] font-semibold whitespace-nowrap text-foreground",
            LABEL_HALO,
          )}
        >
          {stop.name}
        </span>
      )}
    </>
  )
}

function StopThumb({ stop }: { stop: MapStop }) {
  const src = safeImageSrc(stop.image?.src)
  const [failed, setFailed] = React.useState<string | null>(null)
  const Icon = kindIcon(stop.kind)
  return (
    <span className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-transparent">
      {src && failed !== src ? (
        // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
        <img
          src={src}
          alt={stop.image?.alt ?? ""}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(src)}
          className="size-full object-cover select-none"
        />
      ) : (
        <Icon aria-hidden className="size-6 text-muted-foreground" />
      )}
    </span>
  )
}

function describeStop(stop: MapStop) {
  const rating = formatRating(stop.rating)
  return [
    stop.name,
    stop.category,
    rating && `rated ${rating} out of 5`,
    stop.hours,
  ]
    .filter(Boolean)
    .join(", ")
}

function StopCard({
  stop,
  selected,
  showDay,
  onSelect,
  onKeyDown,
  cardRef,
}: {
  stop: MapStop
  selected: boolean
  showDay: boolean
  onSelect: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  cardRef: (el: HTMLDivElement | null) => void
}) {
  const rating = formatRating(stop.rating)
  const line = statusLine(stop, showDay)
  const href = safeHttpUrl(stop.url)
  return (
    <motion.div
      ref={cardRef}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className="relative w-64 shrink-0 snap-start"
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={[
          describeStop(stop),
          showDay && stop.day ? `day ${stop.day}` : "",
        ]
          .filter(Boolean)
          .join(", ")}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-full items-center gap-3 rounded-[10px] p-2 text-left",
          floating,
          href ? "pr-9" : "pr-3",
          selected && "bg-background ring-2 ring-choice",
        )}
      >
        <StopThumb stop={stop} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px] font-semibold">
            {stop.name}
          </span>
          {(rating || stop.category) && (
            <span className="flex min-w-0 items-center gap-1 text-[13px] leading-4 text-muted-foreground">
              {rating && (
                <>
                  <StarIcon
                    aria-hidden
                    className="size-3 shrink-0 fill-current text-foreground"
                  />
                  <span className="font-medium text-foreground tabular-nums">
                    {rating}
                  </span>
                </>
              )}
              {rating && stop.category && <span aria-hidden>·</span>}
              {stop.category && (
                <span className="truncate">{stop.category}</span>
              )}
            </span>
          )}
          {line && (
            <span className="truncate text-[13px] leading-4">{line}</span>
          )}
        </span>
      </button>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ExternalLinkIcon aria-hidden className="size-3.5" />
          <span className="sr-only">{`${stop.name} (opens in a new tab)`}</span>
        </a>
      )}
    </motion.div>
  )
}

function ItineraryMap({
  title,
  stops = [],
  days = [],
  route,
  selectable = false,
  submitLabel,
  status: statusProp,
  onResult,
  result,
  className,
}: MapViewProps) {
  const [selectedId, setSelectedId] = React.useState<string | null>(() =>
    result?.action === "select-stop" ? result.stopId : null,
  )
  const [decision, setDecision] = React.useState<
    "submitted" | "cancelled" | null
  >(() =>
    result ? (result.action === "cancel" ? "cancelled" : "submitted") : null,
  )
  const [day, setDay] = React.useState<number | null>(null)
  const [expanded, setExpanded] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState("")
  const [markerEls, setMarkerEls] = React.useState<
    ReadonlyMap<string, HTMLElement>
  >(() => new globalThis.Map())

  const markersRef = React.useRef(new globalThis.Map<string, Marker>())
  const cardRefs = React.useRef(new globalThis.Map<string, HTMLDivElement>())
  const stripRef = React.useRef<HTMLDivElement>(null)
  const fullHostRef = React.useRef<HTMLDivElement>(null)
  const layerRef = React.useRef<HTMLDivElement>(null)
  const expandRef = React.useRef<HTMLButtonElement>(null)
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const returnFocusRef = React.useRef(false)
  const reduceMotion = useReducedMotion()

  // A host-provided "ready" (or nothing) yields to the user's decision.
  const status: MapStatus =
    decision && (statusProp === undefined || statusProp === "ready")
      ? decision
      : (statusProp ?? "ready")
  const streaming = status === "streaming"
  const decided = status === "submitted" || status === "cancelled"
  // Display-only maps keep selection local; a sent choice stays put.
  const selectionLocked = selectable && decided

  const ready = readyStops(stops)
  const dayList = stopDays(ready, days)
  const currentDay = dayList.find((d) => d.day === day) ?? null
  const path = typeof route === "object" && route ? route.coordinates : null
  const visible = stopsForDay(ready, day)
  const selected = ready.find((s) => s.id === selectedId) ?? null

  const stopsKey = ready.map((s) => `${s.id}:${s.lat}:${s.lng}`).join("|")
  const valid = validPath(path)
  const pathKey = valid
    ? `${valid.length}:${valid[0]}:${valid[valid.length - 1]}`
    : ""
  const duration = reduceMotion ? 0 : 500

  const { hostRef, elRef, libRef, styleReadyRef, userMovedRef, map, mapState } =
    useMapLibre({
      label: `Map: ${title ?? "itinerary"}`,
      onStyleLoad: () => syncRoute(),
      controlsTop: ZOOM_TOP,
    })

  React.useEffect(() => {
    const markers = markersRef.current
    return () => markers.clear()
  }, [])

  /** Room taken by the controls on top and the cards at the bottom. */
  const insets = () => {
    const strip = stripRef.current?.offsetHeight ?? 0
    return { top: TOP_CONTROLS, bottom: strip + ATTRIBUTION_GAP + 12 }
  }

  /** Fit the map to some stops, clear of the controls and the cards. */
  const fit = (list: MapStop[], animate: boolean) => {
    if (!map || !list.length) return
    const { top, bottom } = insets()
    const height = map.getContainer().clientHeight
    const roomy = height > top + bottom + 120
    try {
      if (list.length === 1) {
        map.easeTo({
          center: [list[0].lng, list[0].lat],
          zoom: Math.max(map.getZoom(), 10),
          offset: roomy ? [0, (top - bottom) / 2] : [0, 0],
          duration: animate ? duration : 0,
        })
        return
      }
      const b = boundsOf(list.map((s) => [s.lng, s.lat]))
      if (!b) return
      map.fitBounds(b, {
        padding: roomy
          ? { top, bottom, left: 40, right: 40 }
          : { top: 24, bottom: 24, left: 24, right: 24 },
        maxZoom: 12,
        duration: animate ? duration : 0,
      })
    } catch {
      // A zero-size container can't fit bounds; the next change retries.
    }
  }

  const select = (stop: MapStop) => {
    if (!selectionLocked) setSelectedId(stop.id)
    // A dimmed stop from another day switches the filter to its day.
    if (day !== null && stop.day !== day) setDay(stop.day ?? null)
    if (!map) return
    userMovedRef.current = true
    const { top, bottom } = insets()
    map.easeTo({
      center: [stop.lng, stop.lat],
      zoom: Math.max(map.getZoom(), 9),
      offset: [0, (top - bottom) / 2],
      duration,
    })
  }

  const chooseDay = (value: string) => {
    const next = value === "all" ? null : Number(value)
    if (next !== null && !dayList.some((d) => d.day === next)) return
    setDay(next)
    if (!selectionLocked && selected && next !== null && selected.day !== next)
      setSelectedId(null)
    const list = stopsForDay(ready, next)
    const nextDay = dayList.find((d) => d.day === next)
    const which = nextDay ? dayLabel(nextDay) : "All locations"
    setAnnouncement(
      `${which}: ${list.length} ${list.length === 1 ? "stop" : "stops"}`,
    )
    userMovedRef.current = true
    fit(list, true)
  }

  const fitAll = () => {
    userMovedRef.current = true
    fit(ready, true)
  }

  const onMarkerClick = React.useEffectEvent((id: string) => {
    const stop = ready.find((s) => s.id === id)
    if (stop) select(stop)
  })

  /** Arrow keys move between cards; Home and End jump to the ends. */
  const onCardKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const next = stepIndex(index, e.key, visible.length)
    if (next === index || next < 0) return
    e.preventDefault()
    const card = cardRefs.current.get(visible[next].id)
    card?.querySelector("button")?.focus({ preventScroll: true })
    scrollToCard(visible[next].id)
  }

  const scrollToCard = (id: string) => {
    const strip = stripRef.current
    const card = cardRefs.current.get(id)
    if (!strip || !card) return
    const left = card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2
    strip.scrollTo({
      left: Math.max(0, left),
      behavior: reduceMotion ? "auto" : "smooth",
    })
  }

  // `_trigger` is unused: effects pass what changed so their deps stay honest.
  const syncRoute = React.useEffectEvent((_trigger?: string) => {
    if (!map || !styleReadyRef.current) return
    const color = resolveColor("--foreground", "#f5f5f5")
    setLine(map, ROUTE_ID, routeLine(ready, path), {
      color,
      width: 3,
      opacity: day === null ? 0.9 : 0.3,
    })
    setLine(map, DAY_ROUTE_ID, dayLeg(ready, day, path), {
      color,
      width: 3.5,
      opacity: 1,
    })
  })

  /** Markers: one element per stop, filled by React through portals. */
  const syncMarkers = React.useEffectEvent(
    (m: MapLibreMap, _trigger: string) => {
      const lib = libRef.current
      if (!lib) return
      const markers = markersRef.current
      const seen = new Set<string>()
      let changed = false
      for (const s of ready) {
        seen.add(s.id)
        const existing = markers.get(s.id)
        if (existing) {
          existing.setLngLat([s.lng, s.lat])
          continue
        }
        const el = document.createElement("div")
        // The list and the cards are the accessible path; markers are visual.
        el.setAttribute("aria-hidden", "true")
        const id = s.id
        el.addEventListener("click", (e) => {
          e.stopPropagation()
          onMarkerClick(id)
        })
        markers.set(
          s.id,
          new lib.Marker({ element: el, anchor: "center" })
            .setLngLat([s.lng, s.lat])
            .addTo(m),
        )
        changed = true
      }
      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove()
          markers.delete(id)
          changed = true
        }
      }
      if (changed) {
        setMarkerEls(
          new globalThis.Map(
            [...markers].map(([id, mk]) => [id, mk.getElement()] as const),
          ),
        )
      }
    },
  )

  /** Fit to all stops as they stream in, until the user takes over. */
  const syncView = React.useEffectEvent((_trigger: string) => {
    if (!map || userMovedRef.current) return
    fit(ready, !streaming)
  })

  React.useEffect(() => {
    if (map) syncMarkers(map, stopsKey)
  }, [map, stopsKey])

  React.useEffect(() => {
    if (map) syncRoute(`${stopsKey}#${pathKey}#${day}`)
  }, [map, stopsKey, pathKey, day])

  React.useEffect(() => {
    if (map) syncView(stopsKey)
  }, [map, stopsKey])

  // The selected marker draws above its neighbours.
  React.useEffect(() => {
    for (const [id, el] of markerEls) {
      el.style.zIndex = id === selectedId ? "2" : ""
    }
  }, [markerEls, selectedId])

  // Keep the selected card in view, including after a day switch.
  const revealSelected = React.useEffectEvent((_trigger: string) => {
    if (selectedId) scrollToCard(selectedId)
  })
  React.useEffect(() => {
    revealSelected(`${selectedId}#${day}#${expanded}`)
  }, [selectedId, day, expanded])

  // Move the one map between the card and the fullscreen layer.
  const refit = React.useEffectEvent(() => {
    if (!map) return
    map.resize()
    if (selected) select(selected)
    else fit(visible, false)
  })
  React.useLayoutEffect(() => {
    const el = elRef.current
    const target = expanded ? fullHostRef.current : hostRef.current
    if (!el || !target || el.parentElement === target) return
    target.append(el)
    refit()
  }, [expanded, elRef, hostRef])

  // Fullscreen: Escape closes, Tab stays inside, focus returns to Expand.
  React.useEffect(() => {
    if (!expanded) {
      if (returnFocusRef.current) {
        returnFocusRef.current = false
        expandRef.current?.focus()
      }
      return
    }
    const layer = layerRef.current
    closeRef.current?.focus()
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        returnFocusRef.current = true
        setExpanded(false)
        return
      }
      if (e.key !== "Tab" || !layer) return
      const items = [...layer.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.getClientRects().length > 0,
      )
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === layer)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    layer?.addEventListener("keydown", onKeyDown)
    return () => {
      layer?.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = overflow
    }
  }, [expanded])

  const toggleExpanded = () => {
    if (expanded) returnFocusRef.current = true
    setExpanded(!expanded)
  }

  const submit = () => {
    if (status !== "ready" || !selected) return
    setDecision("submitted")
    onResult?.({ action: "select-stop", stopId: selected.id })
  }

  const cancel = () => {
    if (status !== "ready") return
    setDecision("cancelled")
    onResult?.({ action: "cancel" })
  }

  const overlay = (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2">
          {dayList.length > 0 && (
            <Select
              value={day === null ? "all" : String(day)}
              onValueChange={(v) => chooseDay(String(v ?? "all"))}
              items={[
                { value: "all", label: "All locations" },
                ...dayList.map((d) => ({
                  value: String(d.day),
                  label: dayLabel(d),
                })),
              ]}
            >
              <SelectTrigger
                aria-label="Show stops for"
                className={cn(
                  "h-9 max-w-52 rounded-full border-0 pr-2.5 pl-3.5 font-medium dark:bg-background/85 dark:hover:bg-background",
                  floating,
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectItem value="all">All locations</SelectItem>
                {dayList.map((d) => (
                  <SelectItem key={d.day} value={String(d.day)}>
                    {dayLabel(d)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <button
            type="button"
            onClick={fitAll}
            disabled={!map || !ready.length}
            aria-label="Fit all stops"
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full disabled:opacity-50",
              floating,
            )}
          >
            <LocateFixedIcon aria-hidden className="size-4" />
          </button>
        </div>
        <button
          ref={expanded ? closeRef : expandRef}
          type="button"
          onClick={toggleExpanded}
          aria-haspopup={expanded ? undefined : "dialog"}
          className={cn(
            "pointer-events-auto flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium",
            floating,
          )}
        >
          {expanded ? (
            <Minimize2Icon aria-hidden className="size-3.5" />
          ) : (
            <Maximize2Icon aria-hidden className="size-3.5" />
          )}
          {expanded ? "Close" : "Expand"}
        </button>
      </div>

      {(visible.length > 0 || streaming) && (
        <section
          aria-label={currentDay ? `${dayLabel(currentDay)} stops` : "Stops"}
          className="pointer-events-none absolute inset-x-0"
          style={{ bottom: ATTRIBUTION_GAP }}
        >
          <div
            ref={stripRef}
            className="pointer-events-auto relative flex snap-x snap-mandatory scroll-px-3 gap-2 overflow-x-auto px-3 py-1 [scrollbar-width:none]"
          >
            {visible.map((s, i) => (
              <StopCard
                key={s.id}
                stop={s}
                selected={s.id === selectedId}
                showDay={day === null}
                onSelect={() => select(s)}
                onKeyDown={(e) => onCardKeyDown(e, i)}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(s.id, el)
                  else cardRefs.current.delete(s.id)
                }}
              />
            ))}
            {streaming && (
              <div
                aria-hidden
                className="flex w-64 shrink-0 items-center gap-3 rounded-[10px] bg-background/85 p-2 shadow-md dark:shadow-none ring-1 ring-foreground/10"
              >
                <Skeleton className="size-16 rounded-lg" />
                <span className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </span>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )

  const groups = groupByDay(ready, dayList)

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="map"
        data-status={status}
        data-mode="itinerary"
        aria-busy={streaming}
        aria-label={title ?? "Itinerary"}
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{title}</SurfaceTitle>
        </SurfaceHeader>

        {/* Full-bleed: the map fills the card, with controls and cards on it. */}
        <div className="relative h-[440px] overflow-hidden border-t border-border">
          <div ref={hostRef} style={hostStyle} />
          <MapStateOverlay state={mapState} />
          {!expanded && overlay}
        </div>

        {/* The accessible path: every stop, by day, in visiting order. */}
        <div className="sr-only">
          {dayList.length > 0 ? (
            <ol aria-label="Stops by day">
              {groups.map((g) => (
                <li key={g.day?.day ?? "other"}>
                  {g.day ? dayLabel(g.day) : "Other stops"}
                  <ol>
                    {g.stops.map((s) => (
                      <li key={s.id}>{describeStop(s)}</li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          ) : (
            <ol aria-label="Stops">
              {ready.map((s) => (
                <li key={s.id}>{describeStop(s)}</li>
              ))}
            </ol>
          )}
          <p aria-live="polite">{announcement}</p>
        </div>

        {selectable && (
          <SurfaceFooter
            aria-live="polite"
            className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            {status === "submitted" ? (
              <p className="flex items-center gap-1.5 text-[13px]">
                <CheckIcon aria-hidden className="size-4 shrink-0" />
                {`Chose ${selected?.name ?? "a stop"}`}
              </p>
            ) : status === "cancelled" ? (
              <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <XIcon aria-hidden className="size-4 shrink-0" />
                Cancelled. Nothing was sent.
              </p>
            ) : (
              <>
                {streaming ? (
                  <p className={genuiType.meta}>
                    <ShimmeringText
                      text="Loading stops…"
                      color="var(--muted-foreground)"
                      shimmeringColor="var(--foreground)"
                    />
                  </p>
                ) : (
                  <p className={cn(genuiType.body, "min-w-0 truncate")}>
                    {selected ? (
                      <>
                        <span className="sr-only">Selected: </span>
                        {selected.name}
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        No stop chosen
                      </span>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 sm:ml-auto sm:shrink-0">
                  <WhyDisabled
                    className="flex flex-1 sm:flex-none"
                    when={status !== "ready"}
                    reason="The map is still loading"
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={cancel}
                      disabled={status !== "ready"}
                      className="flex-1 sm:flex-none"
                    >
                      Cancel
                    </Button>
                  </WhyDisabled>
                  <WhyDisabled
                    className="flex flex-1 sm:flex-none"
                    when={status !== "ready" || !selected}
                    reason="Pick a stop first"
                  >
                    <Button
                      size="sm"
                      onClick={submit}
                      disabled={status !== "ready" || !selected}
                      className="flex-1 sm:flex-none"
                    >
                      {submitLabel ?? "Choose this stop"}
                    </Button>
                  </WhyDisabled>
                </div>
              </>
            )}
          </SurfaceFooter>
        )}
      </Surface>

      {[...markerEls].map(([id, el]) => {
        const stop = ready.find((s) => s.id === id)
        if (!stop) return null
        const index = ready.indexOf(stop)
        const dimmed = day !== null && stop.day !== day
        return createPortal(
          <StopMarker
            stop={stop}
            selected={id === selectedId}
            dimmed={dimmed}
            labelled={
              id === selectedId ||
              (!dimmed && showsLabel(stop, index, ready.length, selectedId))
            }
          />,
          el,
          id,
        )
      })}

      {expanded &&
        createPortal(
          <div
            ref={layerRef}
            role="dialog"
            aria-modal="true"
            aria-label={title ?? "Itinerary"}
            tabIndex={-1}
            data-slot="map-fullscreen"
            className="fixed inset-0 z-50 bg-background text-foreground outline-none"
          >
            <div ref={fullHostRef} style={hostStyle} />
            <MapStateOverlay state={mapState} />
            {overlay}
          </div>,
          document.body,
        )}
    </MotionConfig>
  )
}

// ---------------------------------------------------------------------------
// Nearby: stays around an anchor

/** Height of the nearby map; the stay card sits on its bottom edge. */
const NEARBY_MAP_HEIGHT = 340
const TILE_WIDTH = 144
const NEARBY_ROUTE_ID = "genui-map-nearby-route"
const NEARBY_LINE_ID = "genui-map-nearby-line"

/** Light-theme colours for the pins on the light map, plus the hover fill. */
const NEARBY_MAP_TOKENS = {
  ...LIGHT_MAP_TOKENS,
  "--muted": "rgb(0 0 0 / 0.06)",
} as React.CSSProperties

// Markers are visual only; the strip is the accessible path.

function AnchorMarker({ name }: { name: string }) {
  return (
    <span className="flex h-7 cursor-default items-center gap-1.5 rounded-full bg-sky-600 pr-3 pl-2.5 text-[13px] font-semibold whitespace-nowrap text-white shadow-md dark:shadow-none">
      <LandmarkIcon aria-hidden className="size-3.5" />
      {name}
    </span>
  )
}

function StayMarker({
  stay,
  selected,
  pick,
  currency,
}: {
  stay: MapStay
  selected: boolean
  pick: boolean
  currency: string | undefined
}) {
  const locale = useGenUILocale()
  const price = formatPrice(stay.price, currency, { whole: true, locale })
  if (selected) {
    return (
      <span className="flex h-7 cursor-pointer items-center gap-2 rounded-full bg-foreground pr-3 pl-2.5 text-[13px] font-semibold whitespace-nowrap text-background shadow-md dark:shadow-none">
        {pick && (
          <span className="size-1.5 shrink-0 rounded-full bg-sky-400" />
        )}
        <span className="max-w-40 truncate">{stay.name}</span>
        <span className="font-medium tabular-nums opacity-60">{price}</span>
      </span>
    )
  }
  if (pick) {
    return (
      <span
        className={cn(
          "flex h-7 cursor-pointer items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[13px] font-semibold whitespace-nowrap tabular-nums transition-colors hover:bg-muted",
          floating,
        )}
      >
        <span className="size-1.5 shrink-0 rounded-full bg-sky-500" />
        {price}
      </span>
    )
  }
  // Other stays from the search: context dots with a generous hit area.
  return (
    <span className="flex size-5 cursor-pointer items-center justify-center">
      <span className="size-2.5 rounded-full bg-foreground/70 ring-2 ring-background transition-transform hover:scale-125" />
    </span>
  )
}

// ---------------------------------------------------------------------------
// Pieces

function StayImage({
  stay,
  className,
}: {
  stay: Pick<MapStay, "image">
  className?: string
}) {
  const src = safeImageSrc(stay.image?.src)
  const [failed, setFailed] = React.useState<string | null>(null)
  return (
    <span
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden bg-muted",
        className,
      )}
    >
      {src && failed !== src ? (
        // biome-ignore lint/performance/noImgElement: agent-provided remote URLs; next/image would need every host configured
        <img
          src={src}
          alt={stay.image?.alt ?? ""}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailed(src)}
          className="size-full object-cover select-none"
        />
      ) : (
        <BedDoubleIcon aria-hidden className="size-6 text-muted-foreground" />
      )}
    </span>
  )
}

function Stars({ stars }: { stars: number | undefined }) {
  if (!stars) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-medium text-foreground tabular-nums">
      <StarIcon aria-hidden className="size-3 fill-current" />
      {stars}
      <span className="sr-only">{` star${stars === 1 ? "" : "s"}`}</span>
    </span>
  )
}

function NearbyMap({
  title,
  anchor: anchorProp,
  currency,
  stays = [],
  search,
  refinements = [],
  units = "metric",
  status: statusProp,
  onResult,
  result,
  className,
}: MapViewProps) {
  const [decision, setDecision] = React.useState<MapResult | null>(
    result ?? null,
  )
  const [selectedId, setSelectedId] = React.useState<string | null>(() =>
    result?.action === "view-rooms" ? result.stayId : null,
  )
  const [announcement, setAnnouncement] = React.useState("")
  const [markerEls, setMarkerEls] = React.useState<
    ReadonlyMap<string, HTMLElement>
  >(() => new globalThis.Map())
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null)
  const [edges, setEdges] = React.useState({ prev: false, next: false })

  const markersRef = React.useRef(new globalThis.Map<string, Marker>())
  const anchorMarkerRef = React.useRef<Marker | null>(null)
  const cardRef = React.useRef<HTMLDivElement>(null)
  const stripRef = React.useRef<HTMLUListElement>(null)
  const tileRefs = React.useRef(new globalThis.Map<string, HTMLButtonElement>())
  const lastPickRef = React.useRef<string | null>(null)
  const reduceMotion = useReducedMotion()

  const decided = decision !== null
  const status: MapStatus =
    decided && (statusProp === undefined || statusProp === "ready")
      ? "submitted"
      : (statusProp ?? "ready")
  const streaming = status === "streaming"

  const anchor = isAnchor(anchorProp) ? anchorProp : null
  const ready = readyStays(stays)
  const picks = picksOf(ready)
  const ordered = stripOrder(ready, anchor)
  const pickIds = new Set(picks.map((s) => s.id))
  const selected =
    ready.find((s) => s.id === selectedId) ?? picks[0] ?? ordered[0] ?? null
  const pickIndex = selected ? picks.findIndex((s) => s.id === selected.id) : -1
  const chips = refinements.filter(
    (r): r is MapRefinement =>
      typeof r?.id === "string" && typeof r.label === "string",
  )
  const locale = useGenUILocale()
  const meta = searchLine(search, locale)
  const viewed =
    decision?.action === "view-rooms"
      ? (ready.find((s) => s.id === decision.stayId) ?? null)
      : null
  const refined =
    decision?.action === "refine"
      ? (chips.find((r) => r.id === decision.refinementId) ?? null)
      : null

  const selectedKey = selected?.id ?? ""
  const staysKey = ready.map((s) => `${s.id}:${s.lat}:${s.lng}`).join("|")
  const anchorKey = anchor ? `${anchor.name}:${anchor.lat}:${anchor.lng}` : ""
  const duration = reduceMotion ? 0 : 600

  const { hostRef, libRef, styleReadyRef, userMovedRef, map, mapState } =
    useMapLibre({
      label: `Map: ${title ?? "stays"}`,
      onStyleLoad: () => syncLine(),
      light: "positron",
    })

  React.useEffect(() => {
    const markers = markersRef.current
    return () => {
      markers.clear()
      anchorMarkerRef.current = null
    }
  }, [])

  /** Room taken by the stay card at the bottom of the map. */
  const padding = () => {
    const card = cardRef.current?.offsetHeight ?? 0
    const height = map?.getContainer().clientHeight ?? NEARBY_MAP_HEIGHT
    const side = Math.min(
      120,
      Math.round((map?.getContainer().clientWidth ?? 400) * 0.2),
    )
    const bottom = card + ATTRIBUTION_GAP + 24
    return height > bottom + 140
      ? // Wide enough for a selected pin's name to stay on the map.
        { top: 48, bottom, left: side, right: side }
      : { top: 24, bottom: 24, left: 24, right: 24 }
  }

  const fit = (points: LngLat[], animate: boolean, maxZoom: number) => {
    if (!map) return
    const b = boundsOf(points)
    if (!b) return
    try {
      map.fitBounds(b, {
        padding: padding(),
        maxZoom,
        duration: animate ? duration : 0,
      })
    } catch {
      // A zero-size container can't fit bounds; the next change retries.
    }
  }

  /** The stay, the anchor and the way between them, all in view. */
  const focusStay = (stay: MapStay) => {
    if (!anchor) {
      fit([[stay.lng, stay.lat]], true, 15)
      return
    }
    fit(
      [
        [stay.lng, stay.lat],
        [anchor.lng, anchor.lat],
        ...(validPath(stay.path) ?? []),
      ],
      true,
      15,
    )
  }

  const select = (stay: MapStay, from: "map" | "strip" | "pager") => {
    setSelectedId(stay.id)
    userMovedRef.current = true
    focusStay(stay)
    if (from !== "strip") scrollToTile(stay.id)
    const i = picks.findIndex((s) => s.id === stay.id)
    setAnnouncement(
      `${stay.name}${i >= 0 ? `, pick ${i + 1} of ${picks.length}` : ""}`,
    )
  }

  const stepPick = (step: 1 | -1) => {
    if (!picks.length) return
    const next = picks[cycle(Math.max(pickIndex, 0), step, picks.length)]
    if (next) select(next, "pager")
  }

  const backToPicks = () => {
    const back =
      picks.find((s) => s.id === lastPickRef.current) ?? picks[0] ?? null
    if (back) select(back, "pager")
  }

  const onMarkerClick = React.useEffectEvent((id: string) => {
    const stay = ready.find((s) => s.id === id)
    if (stay) select(stay, "map")
  })

  // ---- strip ----

  const updateEdges = React.useCallback(() => {
    const el = stripRef.current
    if (!el) return
    const prev = el.scrollLeft > 4
    const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
    setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
  }, [])

  // Re-measure when stays stream in or the card resizes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stay count changes the scroll width
  React.useEffect(() => {
    updateEdges()
    const el = stripRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(updateEdges)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateEdges, ordered.length])

  const scrollToTile = (id: string) => {
    const strip = stripRef.current
    const tile = tileRefs.current.get(id)
    if (!strip || !tile) return
    const left = tile.offsetLeft - (strip.clientWidth - tile.offsetWidth) / 2
    strip.scrollTo({
      left: Math.max(0, left),
      behavior: reduceMotion ? "auto" : "smooth",
    })
  }

  const page = (direction: 1 | -1) => {
    const el = stripRef.current
    if (!el) return
    el.scrollBy({
      left: direction * Math.max(TILE_WIDTH, el.clientWidth * 0.8),
      behavior: reduceMotion ? "auto" : "smooth",
    })
  }

  /** Arrow keys move between tiles; Home and End jump to the ends. */
  const onTileKeyDown = (e: React.KeyboardEvent, index: number) => {
    const next = stepIndex(index, e.key, ordered.length)
    if (next === index || next < 0) return
    e.preventDefault()
    const stay = ordered[next]
    tileRefs.current.get(stay.id)?.focus({ preventScroll: true })
    scrollToTile(stay.id)
  }

  // ---- map sync ----

  /** Selected stay to anchor: the routed path when given, else a dashed straight line. */
  // `_trigger` is unused: effects pass what changed so their deps stay honest.
  const syncLine = React.useEffectEvent((_trigger?: string) => {
    if (!map || !styleReadyRef.current) return
    const path = selected ? validPath(selected.path) : null
    const straight: LngLat[] =
      selected && anchor && !path
        ? [
            [selected.lng, selected.lat],
            [anchor.lng, anchor.lat],
          ]
        : []
    // The map is light in both themes: the routed path is Map's indigo
    // line; a straight line is dashed, in the light theme's foreground.
    setLine(map, NEARBY_ROUTE_ID, path ?? [], {
      color: "#4f46e5",
      casing: "#1e1b8f",
      width: 5,
      opacity: 1,
    })
    setLine(map, NEARBY_LINE_ID, straight, {
      color: "#262626",
      width: 2,
      opacity: 1,
      dashed: true,
    })
  })

  /** One marker element per stay (and one for the anchor), filled through portals. */
  const syncMarkers = React.useEffectEvent((m: MapLibreMap, _trigger: string) => {
    const lib = libRef.current
    if (!lib) return
    const markers = markersRef.current
    const seen = new Set<string>()
    let changed = false
    for (const s of ready) {
      seen.add(s.id)
      const existing = markers.get(s.id)
      if (existing) {
        existing.setLngLat([s.lng, s.lat])
        continue
      }
      const el = document.createElement("div")
      // The strip is the accessible path; markers are visual.
      el.setAttribute("aria-hidden", "true")
      const id = s.id
      el.addEventListener("click", (e) => {
        e.stopPropagation()
        onMarkerClick(id)
      })
      markers.set(
        s.id,
        new lib.Marker({ element: el, anchor: "center" })
          .setLngLat([s.lng, s.lat])
          .addTo(m),
      )
      changed = true
    }
    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove()
        markers.delete(id)
        changed = true
      }
    }
    if (changed) {
      setMarkerEls(
        new globalThis.Map(
          [...markers].map(([id, mk]) => [id, mk.getElement()] as const),
        ),
      )
    }
    if (anchor) {
      if (anchorMarkerRef.current) {
        anchorMarkerRef.current.setLngLat([anchor.lng, anchor.lat])
      } else {
        const el = document.createElement("div")
        el.setAttribute("aria-hidden", "true")
        el.style.zIndex = "2"
        anchorMarkerRef.current = new lib.Marker({
          element: el,
          anchor: "center",
        })
          .setLngLat([anchor.lng, anchor.lat])
          .addTo(m)
        setAnchorEl(el)
      }
    }
  })

  /** Fit to the anchor and the picks as they stream in, until the user takes over. */
  const syncView = React.useEffectEvent((_trigger: string) => {
    if (!map || userMovedRef.current) return
    const focus = picks.length ? picks : ready
    const points: LngLat[] = focus.map((s) => [s.lng, s.lat])
    if (anchor) points.push([anchor.lng, anchor.lat])
    if (points.length === 1) {
      try {
        map.jumpTo({ center: points[0], zoom: 14 })
      } catch {
        // Not sized yet; the next change retries.
      }
      return
    }
    fit(points, !streaming, 15)
  })

  React.useEffect(() => {
    if (map) syncMarkers(map, `${staysKey}#${anchorKey}`)
  }, [map, staysKey, anchorKey])

  React.useEffect(() => {
    if (map) syncView(`${staysKey}#${anchorKey}`)
  }, [map, staysKey, anchorKey])

  React.useEffect(() => {
    if (map) syncLine(`${selectedKey}#${staysKey}#${anchorKey}`)
  }, [map, selectedKey, staysKey, anchorKey])

  // "Back to picks" returns to the last pick the user was on.
  React.useEffect(() => {
    if (pickIndex >= 0 && selected) lastPickRef.current = selected.id
  }, [pickIndex, selected])

  // The selected marker draws above the picks, the picks above the dots.
  const picksKey = picks.map((s) => s.id).join("|")
  React.useEffect(() => {
    const ids = new Set(picksKey.split("|"))
    for (const [id, el] of markerEls) {
      el.style.zIndex = id === selectedKey ? "3" : ids.has(id) ? "1" : ""
    }
  }, [markerEls, selectedKey, picksKey])

  // ---- results ----

  const decide = (next: MapResult) => {
    if (status !== "ready") return
    setDecision(next)
    onResult?.(next)
  }

  const viewRooms = () => {
    if (!selected) return
    decide({ action: "view-rooms", stayId: selected.id })
  }

  const busyReason = streaming ? "Still loading stays" : undefined
  const roomsReason =
    busyReason ??
    (viewed
      ? viewed.id === selected?.id
        ? "Already opened"
        : `Already opened ${viewed.name}`
      : refined
        ? `Already asked for “${refined.label}”`
        : undefined)

  // ---- render ----

  const card = selected && anchor && (
    <motion.div
      ref={cardRef}
      key="card"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={genuiMotion.fade}
      className={cn(
        "pointer-events-auto absolute inset-x-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] p-2",
        floating,
      )}
      style={{ bottom: ATTRIBUTION_GAP }}
    >
      <StayImage stay={selected} className="size-16 rounded-[10px]" />
      <div className="flex min-w-0 flex-1 basis-40 flex-col">
        <p className="flex min-w-0 items-center gap-2">
          <span className={cn(genuiType.title, "truncate")}>
            {selected.name}
          </span>
          <Stars stars={selected.stars} />
        </p>
        {/* The reason gives way before the price does. */}
        <p className={cn(genuiType.meta, "flex min-w-0 whitespace-nowrap")}>
          <span className="truncate">
            {reasonLabel(
              pickIds.has(selected.id) ? selected.pick : undefined,
              anchor.name,
            )}
          </span>
          <span aria-hidden className="shrink-0">
            &nbsp;·&nbsp;
          </span>
          <span className="shrink-0">
            <span className="text-foreground tabular-nums">
              {formatPrice(selected.price, currency, { locale })}
            </span>{" "}
            a night
          </span>
        </p>
        <p className={cn(genuiType.meta, "flex min-w-0 items-center gap-1.5")}>
          <LandmarkIcon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{distanceLine(selected, anchor, units)}</span>
        </p>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {pickIndex >= 0 && picks.length > 1 ? (
          <div className="flex items-center">
            <IconTip label="Previous pick">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Previous pick"
                onClick={() => stepPick(-1)}
              >
                <ChevronLeftIcon />
              </Button>
            </IconTip>
            <span className="min-w-8 text-center text-[13px] text-muted-foreground tabular-nums">
              <span className="sr-only">Pick </span>
              {pickIndex + 1}/{picks.length}
            </span>
            <IconTip label="Next pick">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Next pick"
                onClick={() => stepPick(1)}
              >
                <ChevronRightIcon />
              </Button>
            </IconTip>
          </div>
        ) : pickIndex < 0 && picks.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={backToPicks}>
            <ChevronLeftIcon aria-hidden />
            Back to picks
          </Button>
        ) : null}
        <WhyDisabled reason={roomsReason}>
          <Button
            size="sm"
            variant={viewed?.id === selected.id ? "outline" : "default"}
            onClick={viewRooms}
            disabled={Boolean(roomsReason)}
          >
            {viewed?.id === selected.id && <CheckIcon aria-hidden />}
            {viewed?.id === selected.id ? "Rooms opened" : "View rooms"}
          </Button>
        </WhyDisabled>
      </div>
    </motion.div>
  )

  const cardSkeleton = streaming && !card && (
    <div
      aria-hidden
      className={cn(
        "absolute inset-x-3 flex items-center gap-3 rounded-[14px] p-2",
        floating,
      )}
      style={{ bottom: ATTRIBUTION_GAP }}
    >
      <Skeleton className="size-16 rounded-[10px]" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-36" />
      </span>
    </div>
  )

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="map"
        data-mode="nearby"
        data-status={status}
        aria-busy={streaming}
        aria-label={title ?? "Nearby stays"}
        className={className}
      >
        <SurfaceHeader className="gap-0.5 pb-3">
          {title ? (
            <SurfaceTitle>{title}</SurfaceTitle>
          ) : (
            <Skeleton className="h-5 w-56" />
          )}
          {meta ? (
            <p className={cn(genuiType.meta, "truncate")}>{meta}</p>
          ) : streaming ? (
            <Skeleton className="mt-1 h-3.5 w-72 max-w-full" />
          ) : null}
        </SurfaceHeader>

        {/* Full-bleed map with the selected stay's card on it. */}
        <div
          className="relative overflow-hidden border-t border-border"
          style={{ height: NEARBY_MAP_HEIGHT }}
        >
          {/* Pins live inside the map, so they take light-theme colours. */}
          <div
            ref={hostRef}
            style={{
              position: "absolute",
              inset: 0,
              isolation: "isolate",
              ...NEARBY_MAP_TOKENS,
            }}
          />
          <MapStateOverlay state={mapState} />
          <div className="pointer-events-none absolute inset-0 z-10">
            {card}
            {cardSkeleton}
          </div>
        </div>

        {/* Every stay: picks first, then the rest nearest first. */}
        {(ordered.length > 0 || streaming) && (
          <div className="relative border-t border-border">
            <ul
              ref={stripRef}
              aria-label="Stays"
              onScroll={updateEdges}
              className="flex snap-x snap-mandatory scroll-px-3 gap-3 overflow-x-auto overscroll-x-contain p-3 [scrollbar-width:none]"
            >
              {ordered.map((s, i) => {
                const isSelected = s.id === selected?.id
                return (
                  <motion.li
                    key={s.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={genuiMotion.fade}
                    className="flex shrink-0 snap-start"
                    style={{ width: TILE_WIDTH }}
                  >
                    <button
                      ref={(el) => {
                        if (el) tileRefs.current.set(s.id, el)
                        else tileRefs.current.delete(s.id)
                      }}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={describeStay(s, anchor, currency, units, locale)}
                      onClick={() => select(s, "strip")}
                      onKeyDown={(e) => onTileKeyDown(e, i)}
                      className="group flex w-full flex-col gap-1.5 rounded-[10px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                    >
                      <StayImage
                        stay={s}
                        className={cn(
                          "aspect-[4/3] w-full rounded-[10px] transition-shadow",
                          isSelected
                            ? "ring-2 ring-choice"
                            : "group-hover:ring-1 group-hover:ring-foreground/20",
                        )}
                      />
                      <span className="flex min-w-0 flex-col px-0.5">
                        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                          {pickIds.has(s.id) && (
                            <span
                              aria-hidden
                              className="size-1.5 shrink-0 rounded-full bg-sky-500"
                            />
                          )}
                          <span className="truncate">{s.name}</span>
                        </span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
                          <span className="truncate">
                            <span className="text-foreground tabular-nums">
                              {formatPrice(s.price, currency, { locale })}
                            </span>{" "}
                            a night
                          </span>
                          <Stars stars={s.stars} />
                        </span>
                      </span>
                    </button>
                  </motion.li>
                )
              })}
              {streaming && (
                <li
                  aria-hidden
                  className="flex shrink-0 flex-col gap-1.5"
                  style={{ width: TILE_WIDTH }}
                >
                  <Skeleton className="aspect-[4/3] w-full rounded-[10px]" />
                  <Skeleton className="h-3.5 w-28" />
                  <Skeleton className="h-3 w-20" />
                </li>
              )}
            </ul>
            {/* Edge fades say the strip goes on in that direction. */}
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
            {(edges.prev || edges.next) && (
              <>
                <div
                  className="absolute left-2 hidden items-center sm:flex"
                  style={{ top: 12, height: (TILE_WIDTH * 3) / 4 }}
                >
                  <WhyDisabled reason={!edges.prev ? "Already at the start" : undefined}>
                    <IconTip label="Previous stays">
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Previous stays"
                        disabled={!edges.prev}
                        onClick={() => page(-1)}
                        className={cn("rounded-full", floating)}
                      >
                        <ChevronLeftIcon />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                </div>
                <div
                  className="absolute right-2 hidden items-center sm:flex"
                  style={{ top: 12, height: (TILE_WIDTH * 3) / 4 }}
                >
                  <WhyDisabled reason={!edges.next ? "Already at the end" : undefined}>
                    <IconTip label="Next stays">
                      <Button
                        size="icon-sm"
                        variant="secondary"
                        aria-label="Next stays"
                        disabled={!edges.next}
                        onClick={() => page(1)}
                        className={cn("rounded-full", floating)}
                      >
                        <ChevronRightIcon />
                      </Button>
                    </IconTip>
                  </WhyDisabled>
                </div>
              </>
            )}
          </div>
        )}

        {!streaming && ready.length === 0 && (
          <p className={cn(genuiType.meta, "border-t border-border px-3 py-3")}>
            {anchor ? `No stays found near ${anchor.name}.` : "No stays found."}
          </p>
        )}

        {/* Narrow the search: each chip goes back to the agent. */}
        {chips.length > 0 && (
          <div className="border-t border-border px-3 py-3">
            <ul aria-label="Narrow the search" className="flex flex-wrap gap-2">
              {chips.map((r) => {
                const chosen = refined?.id === r.id
                const reason =
                  busyReason ??
                  (decided && !chosen
                    ? refined
                      ? `Already asked for “${refined.label}”`
                      : `Already opened ${viewed?.name ?? "a stay"}`
                    : undefined)
                return (
                  <li key={r.id} className="flex max-w-full">
                    <WhyDisabled reason={reason} className="max-w-full">
                      <button
                        type="button"
                        aria-pressed={decided ? chosen : undefined}
                        disabled={Boolean(reason) || chosen}
                        onClick={() =>
                          decide({ action: "refine", refinementId: r.id })
                        }
                        className={cn(
                          "relative inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-left text-[13px] transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-white/5",
                          genuiHit,
                          chosen && "ring-2 ring-choice ring-inset",
                          decided && !chosen && "text-muted-foreground",
                        )}
                      >
                        <ListFilterIcon
                          aria-hidden
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                        <span className="min-w-0 truncate">{r.label}</span>
                        {typeof r.count === "number" && (
                          <span className="text-muted-foreground tabular-nums">
                            <span className="sr-only">, </span>
                            {r.count.toLocaleString(locale)}
                            <span className="sr-only"> stays</span>
                          </span>
                        )}
                        {chosen && (
                          <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                        )}
                      </button>
                    </WhyDisabled>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        <div className="sr-only" aria-live="polite">
          {viewed
            ? `Opening rooms at ${viewed.name}.`
            : refined
              ? `Asked for ${refined.label}.`
              : announcement}
        </div>
      </Surface>

      {anchor &&
        anchorEl &&
        createPortal(<AnchorMarker name={anchor.name} />, anchorEl, "anchor")}

      {[...markerEls].map(([id, el]) => {
        const stay = ready.find((s) => s.id === id)
        if (!stay) return null
        return createPortal(
          <StayMarker
            stay={stay}
            selected={id === selected?.id}
            pick={pickIds.has(id)}
            currency={currency}
          />,
          el,
          id,
        )
      })}
    </MotionConfig>
  )
}
