import { z } from "zod";

/**
 * Itinerary: the agent's contract.
 *
 * An ordered route or day plan as a list of stops. The list companion to the
 * map's 'itinerary' mode: a stop has the same shape (id, name, lat, lng, kind,
 * image, url), so a host can pass the same stops to both.
 */

/**
 * Stop kinds, each drawn with its own icon. A closed set, with the same values
 * (and icons) as the map's stop kinds.
 */
export const ITINERARY_STOP_KINDS = [
  "beach",
  "mountain",
  "city",
  "forest",
  "lake",
  "waterfall",
  "harbor",
  "museum",
  "food",
  "hotel",
  "viewpoint",
  "activity",
] as const;

export const itineraryStopSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  name: z.string().describe("e.g. 'Coit Tower'."),
  time: z
    .string()
    .max(16)
    .optional()
    .describe("Arrival time, shown above the name, e.g. '9:00 AM'."),
  duration: z
    .string()
    .max(16)
    .optional()
    .describe("Time spent there, e.g. '1 hr'."),
  description: z
    .string()
    .max(120)
    .optional()
    .describe("One line, e.g. 'Market hall on the Embarcadero'."),
  image: z
    .object({
      src: z
        .string()
        .describe('http(s), same-origin path ("/...") or data:image URL.'),
      alt: z.string(),
    })
    .optional()
    .describe("Square thumbnail. Without one, the kind's icon is shown."),
  kind: z.enum(ITINERARY_STOP_KINDS).optional().describe("Icon for the stop."),
  lat: z
    .number()
    .min(-90)
    .max(90)
    .optional()
    .describe("Not shown. Lets the same stop be passed to the map."),
  lng: z
    .number()
    .min(-180)
    .max(180)
    .optional()
    .describe("Not shown. Lets the same stop be passed to the map."),
  url: z
    .string()
    .optional()
    .describe("http(s) page for the place. The name becomes a link."),
  added: z
    .boolean()
    .optional()
    .describe("The user asked for this stop. Shows an 'Added' tag."),
});

export const itinerarySchema = z.object({
  title: z.string().describe("e.g. 'Your route'."),
  stops: z
    .array(itineraryStopSchema)
    .min(1)
    .max(30)
    .describe("DATA-BOUND. The stops in visiting order, from a tool result."),
  editable: z
    .boolean()
    .default(false)
    .describe(
      "Let the user remove stops and add them back. Default false: display only.",
    ),
});

export type ItineraryStop = z.infer<typeof itineraryStopSchema>;
export type ItineraryStopKind = (typeof ITINERARY_STOP_KINDS)[number];
export type ItineraryInput = z.input<typeof itinerarySchema>;

/**
 * What the component sends back. A closed set of actions. `change` is sent on
 * every remove or add-back (the list never locks); `open` when the user opens
 * a stop's link.
 */
export type ItineraryResult =
  | { action: "change"; removed: string[] }
  | { action: "open"; stopId: string };

/** Usage guidance the agent reads before choosing this component. */
export const itineraryGuidance = {
  useWhen: [
    "A day plan or route in order: a day in a city, a museum afternoon, a food crawl.",
    "The user may want to trim the plan: set editable so they can drop stops and add them back.",
  ],
  avoidWhen: [
    "Where the stops are matters more than their order. Use the map, or both with the same stops.",
    "A trip over several days. Use the map's 'itinerary' mode.",
    "Steps the user carries out and ticks off. Use a checklist.",
  ],
  rules: [
    "Send stops in visiting order, with a time each when the plan has a schedule.",
    "Take places, coordinates and links from a tool result, never from memory.",
    "Keep description to one plain fact. No ratings, prices or opening hours you haven't fetched.",
    "Mark stops the user asked for with added.",
    "On 'change', treat the removed stops as dropped and re-plan times if needed.",
  ],
} as const;

/* Pure helpers, shared by the component and its tests. */

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
 * http(s), a same-origin path starting with a single "/", or a data:image
 * URL; anything else (protocol-relative, javascript:, blob:) is dropped.
 */
export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== "string") return null;
  const s = src.trim();
  if (DATA_IMAGE.test(s)) return s;
  if (/^\/(?![/\\])/.test(s)) return s;
  return safeHttpUrl(s);
}

/** Stops that have arrived far enough to render (an id and a name). */
export function readyStops<T extends { id?: unknown; name?: unknown }>(
  stops: T[],
): (T & { id: string; name: string })[] {
  const seen = new Set<string>();
  const out: (T & { id: string; name: string })[] = [];
  for (const s of stops) {
    if (typeof s.id !== "string" || typeof s.name !== "string") continue;
    if (!s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s as T & { id: string; name: string });
  }
  return out;
}

/**
 * Toggles `id` in `removed`. The result lists ids in visiting order; ids the
 * list doesn't know (e.g. from a host) are kept, after them.
 */
export function toggleRemoved(
  removed: readonly string[],
  id: string,
  order: readonly string[],
): string[] {
  const set = new Set(removed);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  const known = order.filter((s) => set.has(s));
  const knownSet = new Set(order);
  const unknown = [...set].filter((s) => !knownSet.has(s));
  return [...known, ...unknown];
}

/** The quiet line under a stop's name: "1 hr · Market hall". */
export function stopMetaLine(stop: {
  duration?: string;
  description?: string;
}): string {
  return [stop.duration?.trim(), stop.description?.trim()]
    .filter(Boolean)
    .join(" · ");
}

/** Footer count, only for stops in the list: "2 removed". */
export function removedCountText(count: number): string {
  return `${count} removed`;
}

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(itinerarySchema)`.
 */
export const itineraryTool = {
  name: "show_itinerary",
  description: [
    "Show an ordered day plan or route as a list of stops with times and thumbnails. Optionally lets the user remove stops and add them back.",
    `Use when: ${itineraryGuidance.useWhen.join(" ")}`,
    `Avoid when: ${itineraryGuidance.avoidWhen.join(" ")}`,
    `Rules: ${itineraryGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: itinerarySchema,
} as const;
