import { DEFAULT_LOCALE } from "@/components/genui/locale"

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

const LABELS: Record<string, string> = {
  clear: "Clear",
  "partly-cloudy": "Partly cloudy",
  cloudy: "Cloudy",
  fog: "Fog",
  drizzle: "Drizzle",
  rain: "Rain",
  "heavy-rain": "Heavy rain",
  thunderstorm: "Thunderstorms",
  snow: "Snow",
  sleet: "Sleet",
  wind: "Windy",
}

export const conditionLabel = (condition: string | undefined) =>
  (condition && LABELS[condition]) ?? "Unknown"

/** The calendar date ("2026-11-14") of an instant in a time zone. */
function localDay(value: string, timeZone: string | undefined): string | null {
  if (DATE_ONLY.test(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  try {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date)
  } catch {
    return new Intl.DateTimeFormat("en-CA").format(date)
  }
}

/** "Today", "Tomorrow" or the short weekday, relative to `asOf` in the time zone. */
export function dayLabel(
  date: string,
  asOf: string | undefined,
  timeZone: string | undefined,
  style: "short" | "long" = "short",
  locale: string = DEFAULT_LOCALE,
): string {
  const day = localDay(date, timeZone)
  if (!day) return date
  const today = asOf ? localDay(asOf, timeZone) : null
  if (today) {
    const diff = Math.round(
      (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
        86_400_000,
    )
    if (diff === 0) return "Today"
    if (diff === 1 && style === "long") return "Tomorrow"
  }
  // Calendar dates are read at noon UTC, so the weekday doesn't slip.
  return new Intl.DateTimeFormat(locale, {
    weekday: style,
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`))
}

export const isToday = (
  date: string,
  asOf: string | undefined,
  timeZone: string | undefined,
) => {
  const day = localDay(date, timeZone)
  const today = asOf ? localDay(asOf, timeZone) : null
  return !!day && day === today
}

export const degrees = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value)}°`
    : "–"
