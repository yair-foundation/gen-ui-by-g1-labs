/**
 * Map: pure helpers. No React, no Zod, no maplibre, so they run anywhere.
 *
 * - Places: readiness while streaming, route order, coordinate formatting.
 * - Itinerary: stop readiness, days, the route line and each day's leg,
 *   bounds, which stops get a label, the card's meta line.
 * - Nearby: stays ready to draw, picks, distance to the anchor in km or
 *   miles, and the copy (pick reasons, travel line, search line, prices).
 * - Safety: only http(s) links render; images may be http(s), a same-origin path starting with a single "/", or data:image.
 *
 * Inputs are typed loosely because the tool call may still be streaming.
 */

import { DEFAULT_LOCALE } from "@/components/genui/locale";
import type {
  MapAnchor,
  MapPickReason,
  MapPlace,
  MapSearch,
  MapStay,
  MapStop,
} from "./map.schema";

export type LngLat = [number, number];
export type LatLng = { lat: number; lng: number };

const inRange = (lat: unknown, lng: unknown) =>
  typeof lat === "number" &&
  typeof lng === "number" &&
  Number.isFinite(lat) &&
  Number.isFinite(lng) &&
  Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180;

// ---------------------------------------------------------------------------
// Places

export const isPlace = (p: Partial<MapPlace>): p is MapPlace =>
  typeof p.id === "string" &&
  typeof p.name === "string" &&
  inRange(p.lat, p.lng);

/** Route order: places with `order` first, ascending; the rest keep their position. */
export function sortByOrder(places: MapPlace[]): MapPlace[] {
  return places
    .map((p, i) => ({ p, i }))
    .sort(
      (a, b) =>
        (a.p.order ?? Number.POSITIVE_INFINITY) -
          (b.p.order ?? Number.POSITIVE_INFINITY) || a.i - b.i,
    )
    .map(({ p }) => p);
}

export function formatCoords({ lat, lng }: LatLng) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

/** A detailed path from agent data: only valid [lng, lat] pairs, or null under two. */
export function validPath(coords: unknown): LngLat[] | null {
  if (!Array.isArray(coords)) return null;
  const out: LngLat[] = [];
  for (const c of coords) {
    if (Array.isArray(c) && inRange(c[1], c[0])) out.push([c[0], c[1]]);
  }
  return out.length > 1 ? out : null;
}

// ---------------------------------------------------------------------------
// Itinerary

/** A stop is drawable once it has an id, a name and real coordinates. */
export const isStop = (s: Partial<MapStop> | undefined): s is MapStop =>
  !!s &&
  typeof s.id === "string" &&
  typeof s.name === "string" &&
  inRange(s.lat, s.lng);

/** Ready stops, first occurrence of each id, in the given order. */
export function readyStops(stops: (Partial<MapStop> | undefined)[]): MapStop[] {
  const seen = new Set<string>();
  const out: MapStop[] = [];
  for (const s of stops) {
    if (!isStop(s) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

const validDay = (d: unknown): d is number =>
  typeof d === "number" && Number.isInteger(d) && d >= 1;

export type ItineraryDay = { day: number; label?: string };

/** The days the stops use, ascending, with labels from `days` when given. */
export function stopDays(
  stops: MapStop[],
  days: (Partial<ItineraryDay> | undefined)[] = [],
): ItineraryDay[] {
  const labels = new Map<number, string>();
  for (const d of days) {
    if (d && validDay(d.day) && typeof d.label === "string" && d.label.trim()) {
      labels.set(d.day, d.label.trim());
    }
  }
  const used = [...new Set(stops.map((s) => s.day).filter(validDay))];
  return used
    .sort((a, b) => a - b)
    .map((day) => {
      const label = labels.get(day);
      return label ? { day, label } : { day };
    });
}

/** "Day 2", or "Day 2 · Olympic Peninsula". */
export function dayLabel(d: ItineraryDay) {
  return d.label ? `Day ${d.day} · ${d.label}` : `Day ${d.day}`;
}

/** The stops shown for a day filter; null means all of them. */
export function stopsForDay(stops: MapStop[], day: number | null) {
  return day === null ? stops : stops.filter((s) => s.day === day);
}

/** Stops grouped by day for the screen-reader list; stops without a day last. */
export function groupByDay(stops: MapStop[], days: ItineraryDay[]) {
  const groups: { day: ItineraryDay | null; stops: MapStop[] }[] = days.map(
    (day) => ({ day, stops: stops.filter((s) => s.day === day.day) }),
  );
  const rest = stops.filter((s) => !validDay(s.day));
  if (rest.length) groups.push({ day: null, stops: rest });
  return groups;
}

const toLngLat = (s: { lat: number; lng: number }): LngLat => [s.lng, s.lat];

/** The whole route: the detailed path if given, else straight legs between stops. */
export function routeLine(stops: MapStop[], path?: unknown): LngLat[] {
  return validPath(path) ?? stops.map(toLngLat);
}

/** Index of the path point closest to `p` (planar; fine at itinerary scale). */
export function nearestIndex(path: LngLat[], p: LngLat) {
  let best = 0;
  let bestD = Number.POSITIVE_INFINITY;
  path.forEach(([x, y], i) => {
    const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/** The part of a path between the points nearest `from` and `to`, inclusive. */
export function slicePath(path: LngLat[], from: LngLat, to: LngLat): LngLat[] {
  const a = nearestIndex(path, from);
  const b = nearestIndex(path, to);
  return path.slice(Math.min(a, b), Math.max(a, b) + 1);
}

/**
 * A day's leg: from the stop before the day's first stop (the drive in) through
 * the day's last stop. Follows the detailed path when given. Empty for "all",
 * for unknown days, and when there is nothing to connect.
 */
export function dayLeg(
  stops: MapStop[],
  day: number | null,
  path?: unknown,
): LngLat[] {
  if (day === null) return [];
  const first = stops.findIndex((s) => s.day === day);
  if (first < 0) return [];
  let last = first;
  stops.forEach((s, i) => {
    if (s.day === day) last = i;
  });
  const leg = stops.slice(Math.max(0, first - 1), last + 1);
  if (leg.length < 2) return [];
  const detailed = validPath(path);
  if (!detailed) return leg.map(toLngLat);
  const part = slicePath(
    detailed,
    toLngLat(leg[0]),
    toLngLat(leg[leg.length - 1]),
  );
  return part.length > 1 ? part : leg.map(toLngLat);
}

/** [[west, south], [east, north]] around the points, or null when there are none. */
export function boundsOf(points: LngLat[]): [LngLat, LngLat] | null {
  if (!points.length) return null;
  let w = Number.POSITIVE_INFINITY;
  let s = Number.POSITIVE_INFINITY;
  let e = Number.NEGATIVE_INFINITY;
  let n = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    w = Math.min(w, x);
    e = Math.max(e, x);
    s = Math.min(s, y);
    n = Math.max(n, y);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/**
 * Which markers carry a text label, to keep the map readable: the selected
 * stop, cities, and the first and last stop of the trip.
 */
export function showsLabel(
  stop: MapStop,
  index: number,
  total: number,
  selectedId: string | null,
) {
  return (
    stop.id === selectedId ||
    stop.kind === "city" ||
    index === 0 ||
    index === total - 1
  );
}

/** "4.8" for a 0–5 rating, else null. */
export function formatRating(rating: unknown) {
  return typeof rating === "number" &&
    Number.isFinite(rating) &&
    rating >= 0 &&
    rating <= 5
    ? rating.toFixed(1)
    : null;
}

/** The card's status line: "Day 2 · Open", without the day when a day is filtered. */
export function statusLine(stop: MapStop, showDay: boolean) {
  const parts: string[] = [];
  if (showDay && validDay(stop.day)) parts.push(`Day ${stop.day}`);
  if (stop.hours?.trim()) parts.push(stop.hours.trim());
  return parts.join(" · ");
}

/** Next selection for arrow keys in the card strip; stays put at the ends. */
export function stepIndex(index: number, key: string, count: number) {
  if (count < 1) return -1;
  if (key === "ArrowRight") return Math.min(count - 1, index + 1);
  if (key === "ArrowLeft") return Math.max(0, index - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return index;
}

// ---------------------------------------------------------------------------
// Nearby: stays around an anchor

export type Units = "metric" | "imperial";

/** At most this many picks; later ones show as ordinary stays. */
export const MAX_PICKS = 5;

export const isAnchor = (
  a: Partial<MapAnchor> | undefined,
): a is MapAnchor =>
  !!a && typeof a.name === "string" && inRange(a.lat, a.lng);

/** A stay is drawable once it has an id, a name, coordinates and a price. */
export const isStay = (s: Partial<MapStay> | undefined): s is MapStay =>
  !!s &&
  typeof s.id === "string" &&
  typeof s.name === "string" &&
  typeof s.price === "number" &&
  Number.isFinite(s.price) &&
  s.price >= 0 &&
  inRange(s.lat, s.lng);

/** Ready stays, first occurrence of each id, in the given order. */
export function readyStays(
  stays: (Partial<MapStay> | undefined)[] | undefined,
): MapStay[] {
  const seen = new Set<string>();
  const out: MapStay[] = [];
  for (const s of stays ?? []) {
    if (!isStay(s) || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** The picks, in the order sent, capped at MAX_PICKS. */
export function picksOf(stays: MapStay[]): MapStay[] {
  return stays.filter((s) => s.pick).slice(0, MAX_PICKS);
}

/**
 * The strip's order: picks first as sent, then every other stay nearest
 * first. Without an anchor the rest keep their order.
 */
export function stripOrder(
  stays: MapStay[],
  anchor: LatLng | null,
): MapStay[] {
  const picks = picksOf(stays);
  const pickIds = new Set(picks.map((s) => s.id));
  const rest = stays
    .map((s, i) => ({ s, i, d: anchor ? distanceMeters(s, anchor) : 0 }))
    .filter(({ s }) => !pickIds.has(s.id))
    .sort((a, b) => a.d - b.d || a.i - b.i)
    .map(({ s }) => s);
  return [...picks, ...rest];
}

/** Next index in a ring of `length`, stepping by `step` (±1). */
export function cycle(index: number, step: number, length: number): number {
  if (length <= 0) return -1;
  return (((index + step) % length) + length) % length;
}

// ---------------------------------------------------------------------------
// Distance

const EARTH_RADIUS_M = 6_371_008.8;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const trim = (n: number) => n.toFixed(1).replace(/\.0$/, "");

/**
 * A distance in words: "350 m", "1.6 km", "12 km"; imperial "600 ft",
 * "0.4 mi", "7 mi". Short distances round to 50 m or 100 ft.
 */
export function formatDistance(meters: number, units: Units = "metric") {
  if (!Number.isFinite(meters) || meters < 0) return "";
  if (units === "imperial") {
    const feet = meters / 0.3048;
    if (feet < 1000) return `${Math.max(100, Math.round(feet / 100) * 100)} ft`;
    const miles = meters / 1609.344;
    return miles < 10 ? `${trim(miles)} mi` : `${Math.round(miles)} mi`;
  }
  if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
  const km = meters / 1000;
  return km < 10 ? `${trim(km)} km` : `${Math.round(km)} km`;
}

const TRAVEL_VERB = {
  walk: "walk",
  transit: "by transit",
  drive: "drive",
} as const;

/**
 * How far a stay is from the anchor, in one line: the travel time when a
 * routing tool gave one ("7 min walk to Eiffel Tower"), else the straight-line
 * distance ("1.6 km to Eiffel Tower").
 */
export function distanceLine(
  stay: Pick<MapStay, "lat" | "lng" | "travel">,
  anchor: MapAnchor,
  units: Units = "metric",
): string {
  const t = stay.travel;
  if (t && Number.isFinite(t.minutes) && t.minutes > 0 && TRAVEL_VERB[t.mode]) {
    return `${Math.round(t.minutes)} min ${TRAVEL_VERB[t.mode]} to ${anchor.name}`;
  }
  return `${formatDistance(distanceMeters(stay, anchor), units)} to ${anchor.name}`;
}

// ---------------------------------------------------------------------------
// Copy

const REASON_LABELS: Record<Exclude<MapPickReason, "closest">, string> = {
  "lowest-price": "Lowest price",
  "best-value": "Best value",
  "top-rated": "Top rated",
};

/** "Closest to Eiffel Tower", "Best value", …; "In this search" for others. */
export function reasonLabel(
  reason: MapPickReason | undefined,
  anchorName: string | undefined,
): string {
  if (!reason) return "In this search";
  if (reason === "closest")
    return anchorName ? `Closest to ${anchorName}` : "Closest";
  return REASON_LABELS[reason] ?? "In this search";
}

/** "£148.10" or, with `whole`, "£148" for map pins. Bad currencies fall back to "148.10 XYZ". */
export function formatPrice(
  amount: number,
  currency: string | undefined,
  {
    whole = false,
    locale = DEFAULT_LOCALE,
  }: { whole?: boolean; locale?: string } = {},
): string {
  const integer = Number.isInteger(amount);
  const digits = whole || integer ? 0 : undefined;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      ...(digits === 0
        ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
        : {}),
    }).format(amount);
  } catch {
    const n = new Intl.NumberFormat(locale, {
      maximumFractionDigits: digits ?? 2,
    }).format(amount);
    return currency ? `${n} ${currency}` : n;
  }
}

const DAY_MS = 86_400_000;

function parseISODate(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(t).getUTCDate() === Number(m[3]) ? t : null;
}

/** Nights between check-in and check-out; 0 when either is missing or out of order. */
export function nightsBetween(checkIn?: string, checkOut?: string): number {
  const a = parseISODate(checkIn);
  const b = parseISODate(checkOut);
  if (a === null || b === null || b <= a) return 0;
  return Math.round((b - a) / DAY_MS);
}

/** "14–19 Nov" (en-GB), following the locale's own range format. */
export function formatStayDates(
  checkIn: string | undefined,
  checkOut: string | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  const a = parseISODate(checkIn);
  const b = parseISODate(checkOut);
  if (a === null || b === null || b <= a) return "";
  const fmt = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  return fmt.formatRange(new Date(a), new Date(b));
}

const plural = (n: number, one: string, many: string, locale: string) =>
  `${n.toLocaleString(locale)} ${n === 1 ? one : many}`;

/**
 * The line under the title: "1,624 stays in Paris · 14–19 Nov · 5 nights · 2 adults".
 * Missing parts are left out.
 */
export function searchLine(
  search: Partial<MapSearch> | undefined,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!search) return "";
  const parts: string[] = [];
  const where = search.location ? ` in ${search.location}` : "";
  if (typeof search.total === "number" && search.total >= 0) {
    parts.push(`${plural(search.total, "stay", "stays", locale)}${where}`);
  } else if (search.location) {
    parts.push(search.location);
  }
  const dates = formatStayDates(search.checkIn, search.checkOut, locale);
  if (dates) parts.push(dates);
  const nights = nightsBetween(search.checkIn, search.checkOut);
  if (nights) parts.push(plural(nights, "night", "nights", locale));
  if (typeof search.adults === "number" && search.adults > 0)
    parts.push(plural(search.adults, "adult", "adults", locale));
  return parts.join(" · ");
}

/** Everything a screen reader needs about one stay, in one sentence. */
export function describeStay(
  stay: MapStay,
  anchor: MapAnchor | null,
  currency: string | undefined,
  units: Units = "metric",
  locale: string = DEFAULT_LOCALE,
): string {
  return [
    stay.name,
    stay.stars ? `${stay.stars} star${stay.stars === 1 ? "" : "s"}` : "",
    stay.pick ? reasonLabel(stay.pick, anchor?.name) : "",
    `${formatPrice(stay.price, currency, { locale })} a night`,
    anchor ? distanceLine(stay, anchor, units) : "",
  ]
    .filter(Boolean)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Safety

/** An http(s) URL, else null. */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

const DATA_IMAGE =
  /^data:image\/(?:png|jpe?g|gif|webp|avif|svg\+xml)(?:;[\w=.+-]+)*(?:;base64)?,/i;

/**
 * An http(s) URL, a same-origin path that starts with a single "/", or an
 * inline data:image of a known type; otherwise null (protocol-relative URLs,
 * javascript:, blob: and other data: types are rejected).
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const s = src.trim();
  if (DATA_IMAGE.test(s)) return s;
  if (/^\/(?![/\\])/.test(s)) return s;
  return safeHttpUrl(s);
}
