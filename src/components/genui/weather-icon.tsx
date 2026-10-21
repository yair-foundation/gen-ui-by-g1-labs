import { cn } from "@/lib/utils"

/**
 * The weather icon for a condition, in one place so every weather component
 * draws the same set and the set can be swapped here (other artwork, an icon
 * library) without touching the components.
 *
 * Used by Weather Outlook only. The illustrated set in /public/weather-icons:
 * PNGs with a transparent background, cut from a CC-licensed sheet. Each has a
 * light-mode file and a `-dark` one where the navy details are white; the page's
 * `.dark` class picks which is shown.
 */
const FILES: Record<string, [day: string, night?: string]> = {
  clear: ["clear-day", "clear-night"],
  "partly-cloudy": ["partly-cloudy-day", "partly-cloudy-night"],
  cloudy: ["cloud"],
  fog: ["fog"],
  drizzle: ["drizzle"],
  rain: ["rain"],
  "heavy-rain": ["heavy-rain"],
  thunderstorm: ["thunderstorm"],
  snow: ["snow"],
  sleet: ["sleet"],
  wind: ["wind"],
}

export function WeatherIcon({
  condition,
  isDay = true,
  className,
}: {
  condition?: string
  isDay?: boolean
  /** Sets the box the icon fits in, e.g. "size-9". */
  className?: string
}) {
  const [day, night] = FILES[condition ?? ""] ?? ["cloud"]
  const file = isDay ? day : (night ?? day)
  const img = "max-h-full max-w-full object-contain"
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center",
        className,
      )}
    >
      {/* biome-ignore lint/performance/noImgElement: static, decorative, already small */}
      <img
        src={`/weather-icons/${file}.png`}
        alt=""
        draggable={false}
        decoding="async"
        className={cn(img, "dark:hidden")}
      />
      {/* biome-ignore lint/performance/noImgElement: static, decorative, already small */}
      <img
        src={`/weather-icons/${file}-dark.png`}
        alt=""
        draggable={false}
        decoding="async"
        loading="lazy"
        className={cn(img, "hidden dark:block")}
      />
    </span>
  )
}
