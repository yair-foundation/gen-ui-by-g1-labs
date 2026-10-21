"use client"

import * as React from "react"
import { useId, useState } from "react"
import {
  ArrowUpIcon,
  CloudDrizzleIcon,
  CloudFogIcon,
  CloudHailIcon,
  CloudIcon,
  CloudLightningIcon,
  CloudMoonIcon,
  CloudRainIcon,
  CloudRainWindIcon,
  CloudSunIcon,
  InfoIcon,
  type LucideIcon,
  MoonIcon,
  OctagonAlertIcon,
  SnowflakeIcon,
  SunIcon,
  TriangleAlertIcon,
  WindIcon,
} from "lucide-react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import { SlidingNumber } from "@/components/animate-ui/primitives/texts/sliding-number"
import {
  Skeleton,
  Surface,
  SurfaceHeader,
  SurfaceTitle,
  genuiType,
} from "@/components/genui/surface"
import { Segmented } from "@/components/genui/segmented"
import { useGenUILocale } from "@/components/genui/locale"

import type {
  WeatherAlert,
  WeatherCurrent,
  WeatherDay,
  WeatherHour,
  WeatherInput,
} from "./weather.schema"
import {
  type IconKey,
  type TempUnit,
  compass,
  conditionIcon,
  conditionLabel,
  dayName,
  displayTemp,
  formatClock,
  formatDayTime,
  formatHour,
  formatUpdated,
  localDate,
  rangeBar,
  safeUrl,
  sameHour,
  unitOf,
} from "./weather-utils"

export type WeatherProps = Partial<
  Omit<
    WeatherInput,
    | "location"
    | "current"
    | "hourly"
    | "daily"
    | "alerts"
    | "highlight"
    | "source"
  >
> & {
  /** Every nested field may be partial while the tool call streams. */
  location?: Partial<WeatherInput["location"]>
  current?: Partial<WeatherCurrent>
  hourly?: Partial<WeatherHour>[]
  daily?: Partial<WeatherDay>[]
  alerts?: Partial<WeatherAlert>[]
  highlight?: Partial<NonNullable<WeatherInput["highlight"]>>
  source?: Partial<WeatherInput["source"]>
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

const ICONS: Record<IconKey, LucideIcon> = {
  sun: SunIcon,
  moon: MoonIcon,
  "cloud-sun": CloudSunIcon,
  "cloud-moon": CloudMoonIcon,
  cloud: CloudIcon,
  "cloud-fog": CloudFogIcon,
  "cloud-drizzle": CloudDrizzleIcon,
  "cloud-rain": CloudRainIcon,
  "cloud-rain-wind": CloudRainWindIcon,
  "cloud-lightning": CloudLightningIcon,
  snowflake: SnowflakeIcon,
  "cloud-hail": CloudHailIcon,
  wind: WindIcon,
}

const SEVERITY = {
  warning: {
    label: "Warning",
    icon: OctagonAlertIcon,
    className: "text-destructive",
  },
  watch: {
    label: "Watch",
    icon: TriangleAlertIcon,
    className: "text-foreground",
  },
  advisory: { label: "Advisory", icon: InfoIcon, className: "text-foreground" },
} as const

const enter = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: "easeOut" as const },
}

type Hour = WeatherHour
type Day = WeatherDay
type Alert = WeatherAlert

function ConditionIcon({
  condition,
  isDay,
  className,
}: {
  condition?: Day["condition"]
  isDay?: boolean
  className?: string
}) {
  const Icon = ICONS[conditionIcon(condition, isDay)]
  return (
    <Icon
      aria-hidden
      className={cn("shrink-0 text-muted-foreground", className)}
    />
  )
}

export function Weather({
  location,
  asOf,
  timezone,
  units,
  current,
  alerts = [],
  highlight,
  hourly = [],
  daily = [],
  source,
  status: lifecycle = "ready",
  className,
}: WeatherProps) {
  const locale = useGenUILocale()
  const streaming = lifecycle === "streaming"
  const titleId = useId()
  const hourlyId = useId()
  const dailyId = useId()
  const [unitChoice, setUnitChoice] = useState<TempUnit | null>(null)
  const from = units ?? "metric"
  const unit: TempUnit = unitChoice ?? unitOf(units)
  const tz = timezone

  /** Temperature in the chosen unit: "18°" visible, "18 °C" to screen readers. */
  const temp = (v: number) => displayTemp(v, from, unit)
  const tempNode = (value: number) => (
    <>
      <span aria-hidden>{`${temp(value)}°`}</span>
      <span className="sr-only">{`${temp(value)} °${unit}`}</span>
    </>
  )
  const spoken = (v: number) => `${temp(v)} °${unit}`

  const hours = hourly.filter(
    (h): h is Hour =>
      typeof h.t === "string" &&
      typeof h.temp === "number" &&
      typeof h.condition === "string",
  )
  const days = daily.filter(
    (d): d is Day =>
      typeof d.date === "string" &&
      typeof d.min === "number" &&
      typeof d.max === "number" &&
      typeof d.condition === "string",
  )
  const readyAlerts = alerts.filter(
    (a): a is Alert =>
      typeof a.title === "string" &&
      typeof a.severity === "string" &&
      typeof a.starts === "string" &&
      typeof a.ends === "string",
  )

  const todayKey = asOf ? localDate(asOf, tz) : null
  // Only a row for the observation date counts as today; no fallback.
  const today = days.find((d) => d.date === todayKey)
  const scaleMin = Math.min(...days.map((d) => temp(d.min)))
  const scaleMax = Math.max(...days.map((d) => temp(d.max)))

  const hasCurrent =
    typeof current?.temp === "number" && typeof current.condition === "string"
  const windUnit = from === "imperial" ? "mph" : "km/h"
  const wind =
    typeof current?.windDir === "number" ? compass(current.windDir) : null
  const sourceUrl = safeUrl(source?.url)

  // Wind and precipitation are shown; the rest is read to screen readers only.
  const details: {
    key: string
    label: string
    value: React.ReactNode
    spoken?: string
    visible?: boolean
  }[] = []
  if (hasCurrent && current) {
    if (typeof current.windSpeed === "number") {
      const speed = `${Math.round(current.windSpeed)} ${windUnit}`
      details.push({
        key: "wind",
        label: "Wind",
        visible: true,
        value: (
          <span className="inline-flex items-center gap-1">
            {wind && typeof current.windDir === "number" && (
              // Points where the wind blows to: opposite its origin.
              <ArrowUpIcon
                aria-hidden
                className="size-3.5 text-muted-foreground"
                style={{ transform: `rotate(${current.windDir + 180}deg)` }}
              />
            )}
            {wind ? `${speed} ${wind.short}` : speed}
          </span>
        ),
        spoken: wind ? `${speed} from the ${wind.long}` : speed,
      })
    }
    if (typeof current.precipChance === "number")
      details.push({
        key: "precip",
        label: "Chance of precipitation",
        visible: true,
        value: (
          <span className="inline-flex items-center gap-1">
            <CloudRainIcon
              aria-hidden
              className="size-3.5 text-muted-foreground"
            />
            {`${Math.round(current.precipChance)}%`}
          </span>
        ),
        spoken: `${Math.round(current.precipChance)}%`,
      })
    if (typeof current.humidity === "number")
      details.push({
        key: "humidity",
        label: "Humidity",
        value: `${Math.round(current.humidity)}%`,
      })
    if (typeof current.uvIndex === "number")
      details.push({
        key: "uv",
        label: "UV index",
        value: `${Math.round(current.uvIndex)}`,
      })
    if (today?.sunrise)
      details.push({
        key: "sunrise",
        label: "Sunrise",
        value: formatClock(today.sunrise, tz, locale),
      })
    if (today?.sunset)
      details.push({
        key: "sunset",
        label: "Sunset",
        value: formatClock(today.sunset, tz, locale),
      })
  }

  const place = location?.name
    ? location.region
      ? `${location.name}, ${location.region}`
      : location.name
    : undefined
  // "Feels like" only when it differs enough to matter.
  const feels =
    hasCurrent &&
    typeof current?.feelsLike === "number" &&
    Math.abs(temp(current.feelsLike) - temp(current.temp as number)) >= 2
      ? current.feelsLike
      : null

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="weather"
        data-status={lifecycle}
        aria-busy={streaming}
        aria-labelledby={place ? titleId : undefined}
        aria-label={place ? undefined : "Weather"}
        className={className}
      >
        <SurfaceHeader className="flex-row items-center gap-3 pb-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <SurfaceTitle id={titleId} className="truncate">
              {location?.name && (
                <>
                  {location.name}
                  {location.region && (
                    <span className="font-normal text-muted-foreground">
                      {`, ${location.region}`}
                    </span>
                  )}
                </>
              )}
            </SurfaceTitle>
            {asOf ? (
              <p className={cn(genuiType.meta, "truncate")}>
                {`Updated ${formatUpdated(asOf, tz, locale)}`}
                {source?.label && (
                  <>
                    <span aria-hidden>{" · "}</span>
                    {sourceUrl ? (
                      <a
                        href={sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="rounded-sm underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                      >
                        {source.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      source.label
                    )}
                  </>
                )}
              </p>
            ) : (
              <Skeleton className="h-3 w-28" />
            )}
          </div>
          <Segmented
            label="Temperature unit"
            value={unit}
            onChange={setUnitChoice}
            fit
            options={(["C", "F"] as const).map((u) => ({
              value: u,
              label: (
                <>
                  <span aria-hidden>{`°${u}`}</span>
                  <span className="sr-only">
                    {u === "C" ? "Celsius" : "Fahrenheit"}
                  </span>
                </>
              ),
            }))}
          />
        </SurfaceHeader>

        <div className="flex flex-col">
          {/* Current conditions */}
          <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
            {hasCurrent && current ? (
              <motion.div
                {...enter}
                className="flex flex-wrap items-center gap-x-4 gap-y-2"
              >
                <div className="flex items-center gap-3">
                  {/* The temperature is the component: 40px, rolling on a unit switch. */}
                  <p className={cn(genuiType.display, "text-[40px]")}>
                    <span aria-hidden className="inline-flex items-baseline">
                      <SlidingNumber
                        number={temp(current.temp as number)}
                        initiallyStable
                      />
                      °
                    </span>
                    <span className="sr-only">
                      {spoken(current.temp as number)}
                    </span>
                  </p>
                  <ConditionIcon
                    condition={current.condition}
                    isDay={current.isDay ?? true}
                    className="size-9"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <p className={cn(genuiType.body, "font-medium")}>
                    {conditionLabel(current.condition)}
                  </p>
                  {(feels !== null || today) && (
                    <p className={cn(genuiType.meta, "tabular-nums")}>
                      {feels !== null && <>Feels like {tempNode(feels)}</>}
                      {feels !== null && today && (
                        <span aria-hidden>{" · "}</span>
                      )}
                      {today && (
                        <>
                          <span aria-hidden>
                            {`H ${temp(today.max)}° L ${temp(today.min)}°`}
                          </span>
                          <span className="sr-only">{`High ${spoken(today.max)}, low ${spoken(today.min)} today`}</span>
                        </>
                      )}
                    </p>
                  )}
                </div>
              </motion.div>
            ) : (
              <div className="flex items-center gap-4">
                <Skeleton className="h-12 w-24" />
                <div className="flex flex-col gap-1.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            )}

            {details.length > 0 && (
              <motion.dl
                {...enter}
                className={cn(
                  genuiType.body,
                  "flex flex-wrap gap-x-5 gap-y-1 tabular-nums",
                )}
              >
                {details.map((d) => (
                  <div
                    key={d.key}
                    className={d.visible ? "flex items-center" : "sr-only"}
                  >
                    <dt className="sr-only">{d.label}</dt>
                    <dd>
                      {d.spoken ? (
                        <>
                          <span aria-hidden>{d.value}</span>
                          <span className="sr-only">{d.spoken}</span>
                        </>
                      ) : (
                        d.value
                      )}
                    </dd>
                  </div>
                ))}
              </motion.dl>
            )}

            {highlight?.note && (
              <motion.p
                {...enter}
                className={cn(genuiType.body, "font-medium text-pretty")}
              >
                {highlight.note}
              </motion.p>
            )}
          </div>

          {readyAlerts.length > 0 && (
            <section aria-label="Weather alerts" className="border-t border-border px-3 py-3">
              <ul className="flex flex-col gap-3">
                {readyAlerts.map((a) => {
                  const s = SEVERITY[a.severity]
                  return (
                    <motion.li
                      key={`${a.severity}-${a.title}-${a.starts}`}
                      {...enter}
                      className="flex gap-2.5"
                    >
                      <s.icon
                        aria-hidden
                        className={cn("mt-0.5 size-4 shrink-0", s.className)}
                      />
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className={cn(genuiType.body, "font-medium")}>
                          <span className="sr-only">{`${s.label}: `}</span>
                          <span className={s.className}>{a.title}</span>
                        </p>
                        {a.description && (
                          <p className={cn(genuiType.body, "text-pretty")}>
                            {a.description}
                          </p>
                        )}
                        <p className={cn(genuiType.meta, "tabular-nums")}>
                          {`${formatDayTime(a.starts, tz, locale)} – ${formatDayTime(a.ends, tz, locale)}`}
                        </p>
                      </div>
                    </motion.li>
                  )
                })}
              </ul>
            </section>
          )}

          {(hours.length > 0 || (streaming && hasCurrent)) && (
            <div className="border-t border-border py-3">
              <h4 id={hourlyId} className="sr-only">
                Hourly forecast
              </h4>
              <FadeRow
                as="section"
                aria-labelledby={hourlyId}
                tabIndex={0}
                className="snap-x snap-mandatory scroll-px-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <ol className="flex w-max gap-1 px-3">
                  {hours.map((h) => {
                    const now = asOf ? sameHour(h.t, asOf, tz) : false
                    const label = now ? "Now" : formatHour(h.t, tz, locale)
                    const rain =
                      typeof h.precipChance === "number" && h.precipChance >= 20
                        ? Math.round(h.precipChance)
                        : null
                    return (
                      <motion.li
                        key={h.t}
                        {...enter}
                        className="flex w-12 shrink-0 snap-start flex-col items-center gap-1.5 py-1 text-[13px] leading-4 tabular-nums"
                      >
                        <span className="sr-only">
                          {`${label}: ${conditionLabel(h.condition)}, ${spoken(h.temp)}${typeof h.precipChance === "number" ? `, ${Math.round(h.precipChance)}% chance of precipitation` : ""}`}
                        </span>
                        <span aria-hidden className="text-muted-foreground">
                          {label}
                        </span>
                        <ConditionIcon
                          condition={h.condition}
                          isDay={h.isDay ?? true}
                          className="size-5"
                        />
                        <span
                          aria-hidden
                          className="text-[13px] leading-5 font-medium"
                        >
                          {`${temp(h.temp)}°`}
                        </span>
                        <span aria-hidden className="h-4 text-muted-foreground">
                          {rain !== null ? `${rain}%` : ""}
                        </span>
                      </motion.li>
                    )
                  })}
                  {streaming && hours.length < 24 && (
                    <li
                      aria-hidden
                      className="flex w-12 shrink-0 flex-col items-center gap-1.5 py-1"
                    >
                      <Skeleton className="h-3 w-8" />
                      <Skeleton className="size-5" />
                      <Skeleton className="h-4 w-6" />
                    </li>
                  )}
                </ol>
              </FadeRow>
            </div>
          )}

          {(days.length > 0 || (streaming && hasCurrent)) && (
            <section aria-labelledby={dailyId} className="border-t border-border px-3 py-3">
              <h4 id={dailyId} className="sr-only">
                {days.length > 0
                  ? `${days.length}-day forecast`
                  : "Daily forecast"}
              </h4>
              <ol className="-mx-2.5 flex flex-col">
                {days.map((d) => {
                  const bar = rangeBar(
                    temp(d.min),
                    temp(d.max),
                    scaleMin,
                    scaleMax,
                  )
                  const marked = !!highlight?.date && highlight.date === d.date
                  const name = dayName(d.date, asOf, tz, {
                    locale,
                    tomorrow: false,
                  })
                  const longName = dayName(d.date, asOf, tz, {
                    locale,
                    style: "long",
                    tomorrow: false,
                  })
                  const rain =
                    typeof d.precipChance === "number" && d.precipChance >= 20
                      ? Math.round(d.precipChance)
                      : null
                  const extras = [
                    typeof d.precipChance === "number"
                      ? `${Math.round(d.precipChance)}% chance of precipitation`
                      : null,
                    d.sunrise
                      ? `sunrise ${formatClock(d.sunrise, tz, locale)}`
                      : null,
                    d.sunset
                      ? `sunset ${formatClock(d.sunset, tz, locale)}`
                      : null,
                  ].filter(Boolean)
                  return (
                    <motion.li
                      key={d.date}
                      {...enter}
                      aria-current={marked ? "date" : undefined}
                      className={cn(
                        genuiType.body,
                        "grid grid-cols-[3rem_1.25rem_2.25rem_2rem_1fr_2rem] items-center gap-3 rounded-lg px-2.5 py-2 tabular-nums",
                        marked && "bg-transparent ring-1 ring-foreground/30 ring-inset dark:ring-border",
                      )}
                    >
                      <span className="sr-only">
                        {`${longName}: ${conditionLabel(d.condition)}, low ${spoken(d.min)}, high ${spoken(d.max)}${extras.length ? `, ${extras.join(", ")}` : ""}`}
                      </span>
                      <span
                        aria-hidden
                        className={cn(marked && "font-medium")}
                      >
                        {name}
                      </span>
                      <ConditionIcon
                        condition={d.condition}
                        className="size-5"
                      />
                      <span
                        aria-hidden
                        className="text-[13px] leading-4 text-muted-foreground"
                      >
                        {rain !== null ? `${rain}%` : ""}
                      </span>
                      <span
                        aria-hidden
                        className="text-right text-muted-foreground"
                      >
                        {`${temp(d.min)}°`}
                      </span>
                      <span
                        aria-hidden
                        className="relative h-1.5 rounded-full bg-muted dark:bg-white/15"
                      >
                        <span
                          className="absolute inset-y-0 rounded-full bg-choice"
                          style={{
                            left: `${bar.left}%`,
                            width: `${bar.width}%`,
                          }}
                        />
                      </span>
                      <span aria-hidden className="font-medium">
                        {`${temp(d.max)}°`}
                      </span>
                    </motion.li>
                  )
                })}
                {streaming &&
                  Array.from({ length: days.length ? 1 : 3 }, (_, i) => (
                    <li
                      // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                      key={i}
                      aria-hidden
                      className="flex items-center gap-3 px-2.5 py-2"
                    >
                      <Skeleton className="h-4 w-10" />
                      <Skeleton className="size-5" />
                      <Skeleton className="h-1.5 flex-1" />
                    </li>
                  ))}
              </ol>
            </section>
          )}
        </div>
      </Surface>
    </MotionConfig>
  )
}

/** Which sides of a horizontal scroller have more content past the edge. */
function useScrollEdges(
  ref: React.RefObject<HTMLElement | null>,
  dep?: unknown,
) {
  const [edges, setEdges] = React.useState({ prev: false, next: false })
  // biome-ignore lint/correctness/useExhaustiveDependencies: dep re-measures when the content changes
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const prev = el.scrollLeft > 4
      const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4
      setEdges((e) => (e.prev === prev && e.next === next ? e : { prev, next }))
    }
    update()
    el.addEventListener("scroll", update, { passive: true })
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update)
    resize?.observe(el)
    const mutation = new MutationObserver(update)
    mutation.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", update)
      resize?.disconnect()
      mutation.disconnect()
    }
  }, [ref, dep])
  return edges
}

/** Edge fades that say the row goes on; each shows only on its side. */
function ScrollFades({ edges }: { edges: { prev: boolean; next: boolean } }) {
  return (
    <>
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
    </>
  )
}

/** A horizontal scroller wrapped with edge fades. */
function FadeRow({
  as: Tag = "div",
  wrapperClassName,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "ref"> & {
  as?: React.ElementType
  wrapperClassName?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(ref)
  return (
    <div className={cn("relative", wrapperClassName)}>
      <Tag ref={ref} className={cn("overflow-x-auto", className)} {...props}>
        {children}
      </Tag>
      <ScrollFades edges={edges} />
    </div>
  )
}
