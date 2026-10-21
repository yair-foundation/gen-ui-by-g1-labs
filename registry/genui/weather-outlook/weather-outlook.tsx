"use client"

import type * as React from "react"
import { MotionConfig, motion } from "motion/react"

import { cn } from "@/lib/utils"
import {
  genuiMotion,
  genuiType,
  Skeleton,
  Surface,
  SurfaceDescription,
  SurfaceHeader,
  SurfaceTitle,
  surfaceInset,
} from "@/components/genui/surface"
import { WeatherIcon } from "@/components/genui/weather-icon"
import { useGenUILocale } from "@/components/genui/locale"

import {
  conditionLabel,
  dayLabel,
  degrees,
  isToday,
} from "./weather-outlook-utils"
import type {
  WeatherOutlookDay,
  WeatherOutlookInput,
} from "./weather-outlook.schema"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export type WeatherOutlookProps = Partial<
  Omit<WeatherOutlookInput, "location" | "days">
> & {
  /** Every nested field may be partial while the tool call streams. */
  location?: Partial<WeatherOutlookInput["location"]>
  days?: Partial<WeatherOutlookDay>[]
  /** Lifecycle, controlled by the host. */
  status?: "streaming" | "ready"
  className?: string
}

type ReadyDay = WeatherOutlookDay

export function WeatherOutlook({
  location,
  asOf,
  timezone,
  units = "metric",
  days = [],
  summary,
  status = "ready",
  className,
}: WeatherOutlookProps) {
  const locale = useGenUILocale()
  const streaming = status === "streaming"
  const ready = days.filter(
    (d): d is ReadyDay =>
      typeof d.date === "string" &&
      typeof d.min === "number" &&
      typeof d.max === "number" &&
      typeof d.condition === "string",
  )
  const unit = units === "imperial" ? "°F" : "°C"
  const count = ready.length

  return (
    <MotionConfig reducedMotion="user">
      <Surface
        data-slot="weather-outlook"
        data-status={status}
        aria-busy={streaming}
        aria-label={
          location?.name
            ? `${location.name} weather outlook`
            : "Weather outlook"
        }
        className={className}
      >
        <SurfaceHeader className="pb-3">
          <SurfaceTitle>{location?.name}</SurfaceTitle>
          <SurfaceDescription>
            {count > 0 ? `${count}-day forecast · ${unit}` : undefined}
          </SurfaceDescription>
        </SurfaceHeader>

        {/* Rows on a narrow card, one column per day on a wide one. */}
        <div
          className={cn("@container border-t border-border py-3", surfaceInset)}
        >
          <ul
            style={{ "--days": count || 5 } as React.CSSProperties}
            className="grid gap-1 @md:grid-cols-[repeat(var(--days),minmax(0,1fr))]"
          >
            {ready.map((day) => {
              const today = isToday(day.date, asOf, timezone)
              const rain = day.precipChance ?? 0
              return (
                <motion.li
                  key={day.date}
                  aria-hidden
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={genuiMotion.fade}
                  className={cn(
                    "flex items-center gap-3 rounded-[10px] px-3 py-2 @md:flex-col @md:gap-2 @md:px-1 @md:py-3.5",
                    today &&
                      "bg-transparent ring-1 ring-foreground/30 ring-inset dark:ring-border",
                  )}
                >
                  <span
                    className={cn(
                      genuiType.label,
                      "w-20 text-foreground @md:order-1 @md:w-auto",
                    )}
                  >
                    {dayLabel(day.date, asOf, timezone, "short", locale)}
                  </span>
                  <span
                    className={cn(
                      genuiType.meta,
                      "ml-auto w-9 text-right tabular-nums @md:order-4 @md:ml-0 @md:w-auto @md:min-h-[1.25rem]",
                      rain < 20 && "invisible",
                    )}
                  >
                    {rain}%
                  </span>
                  <Tooltip>
                    <TooltipTrigger
                      render={<span className="flex shrink-0 @md:order-2" />}
                    >
                      <WeatherIcon
                        condition={day.condition}
                        className="size-12 @md:size-14 @xl:size-16"
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {conditionLabel(day.condition)}
                    </TooltipContent>
                  </Tooltip>
                  <span className="flex w-14 items-baseline justify-end gap-2 tabular-nums @md:order-3 @md:w-auto @md:flex-col @md:items-center @md:gap-0.5">
                    <span className="text-[14px] font-medium leading-[1.6]">
                      {degrees(day.max)}
                    </span>
                    <span className="text-[13px] leading-[1.6] text-muted-foreground">
                      {degrees(day.min)}
                    </span>
                  </span>
                </motion.li>
              )
            })}
            {streaming &&
              Array.from({ length: Math.max(0, 5 - count) }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: placeholders are positional
                <li key={i} aria-hidden>
                  <Skeleton className="h-12 w-full @md:h-32" />
                </li>
              ))}
          </ul>
        </div>

        {summary && (
          <p
            className={cn(
              genuiType.body,
              "border-t border-border py-3 text-muted-foreground",
              surfaceInset,
            )}
          >
            {summary}
          </p>
        )}

        {/* The visual rows are decorative; this carries the same reading. */}
        {count > 0 && (
          <ul className="sr-only">
            {ready.map((day) => (
              <li key={day.date}>
                {`${dayLabel(day.date, asOf, timezone, "long", locale)}: ${conditionLabel(day.condition)}, high ${degrees(day.max)}, low ${degrees(day.min)}${
                  (day.precipChance ?? 0) >= 20
                    ? `, ${day.precipChance}% chance of precipitation`
                    : ""
                }`}
              </li>
            ))}
          </ul>
        )}
      </Surface>
    </MotionConfig>
  )
}
