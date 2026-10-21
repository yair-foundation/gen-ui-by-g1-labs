import { z } from "zod";

/**
 * Map: the agent's contract.
 *
 * Places on a map with a list below it. Shows places and routes, lets the user
 * pick one of them, or lets them drop a pin as an input. The 'itinerary' mode
 * shows a multi-day trip: stops by day on a route, with a strip of place cards.
 * The 'nearby' mode shows places to stay around one place the user named: the
 * place itself, a few picks with a reason each, the rest of the search as
 * context, and every stay's distance to that place.
 */

// `.meta({ pattern: undefined })` keeps Zod's check but leaves its long ISO
// regex out of the JSON Schema the model reads (token cost only).
const isoDate = z.iso.date().meta({ pattern: undefined });
const count = z.number().int().min(0).meta({ maximum: undefined });

export const mapPlaceSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  name: z.string().describe("e.g. 'Hotel Miradouro'."),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  description: z
    .string()
    .optional()
    .describe("One line, e.g. '€145 a night · 6 min walk to the venue'."),
  category: z.string().max(24).optional().describe("e.g. 'Hotel'."),
  order: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Position in the route, from 1. Used when route is true."),
});

/** Stop kinds, each drawn with its own marker icon. A closed set. */
export const MAP_STOP_KINDS = [
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

export const mapStopSchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  name: z.string().describe("e.g. 'Cannon Beach'."),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  day: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe("Trip day, from 1. Drives the day filter."),
  kind: z
    .enum(MAP_STOP_KINDS)
    .optional()
    .describe("Marker icon. 'city' stops always show their name on the map."),
  image: z
    .object({
      src: z
        .string()
        .describe(
          'http(s) or data:image URL, or a same-origin path starting with a single "/".',
        ),
      alt: z.string(),
    })
    .optional()
    .describe("Square thumbnail on the stop's card."),
  rating: z.number().min(0).max(5).optional().describe("e.g. 4.8."),
  category: z
    .string()
    .max(32)
    .optional()
    .describe("e.g. 'Tourist attraction'."),
  hours: z
    .string()
    .max(32)
    .optional()
    .describe("Opening state, e.g. 'Open' or 'Closes 6 PM'."),
  url: z.string().optional().describe("http(s) page for the place."),
});

export const mapDaySchema = z.object({
  day: z.number().int().min(1).max(60),
  label: z.string().max(40).optional().describe("e.g. 'Olympic Peninsula'."),
});

export const mapRoutePathSchema = z.object({
  coordinates: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .max(5000)
    .optional()
    .describe(
      "DATA-BOUND. Detailed [lng, lat] path from a routing tool. Omit for straight lines between stops.",
    ),
});

/** What makes a stay a pick in 'nearby'. A closed set: the component writes the words. */
export const MAP_PICK_REASONS = [
  "closest",
  "lowest-price",
  "best-value",
  "top-rated",
] as const;

export const mapAnchorSchema = z.object({
  name: z.string().max(40).describe("e.g. 'Eiffel Tower'."),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const mapStaySchema = z.object({
  id: z.string().describe("Stable identifier. Returned in the result."),
  name: z.string().describe("e.g. 'Mercure Paris Centre Tour Eiffel'."),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  price: z
    .number()
    .min(0)
    .describe("DATA-BOUND. Price per night for the search's dates and party."),
  stars: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .describe("Official star class."),
  image: z
    .object({
      src: z
        .string()
        .describe(
          'http(s) or data:image URL, or a same-origin path starting with a single "/".',
        ),
      alt: z.string(),
    })
    .optional(),
  travel: z
    .object({
      minutes: z.number().int().min(1).max(600),
      mode: z.enum(["walk", "transit", "drive"]),
    })
    .optional()
    .describe(
      "DATA-BOUND. Travel time to the anchor from a routing tool. Omit to show the straight-line distance.",
    ),
  path: z
    .array(
      z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    )
    .max(500)
    .optional()
    .describe(
      "DATA-BOUND. [lng, lat] path from the stay to the anchor, from a routing tool. Omit for a straight line.",
    ),
  pick: z
    .enum(MAP_PICK_REASONS)
    .optional()
    .describe(
      "Marks one of the picks, with why. At most 5 picks; picks show in the order sent.",
    ),
});

export const mapSearchSchema = z.object({
  location: z.string().max(40).optional().describe("e.g. 'Paris'."),
  checkIn: isoDate.optional(),
  checkOut: isoDate.optional(),
  adults: z.number().int().min(1).max(16).optional(),
  total: count
    .optional()
    .describe("DATA-BOUND. How many stays the whole search found."),
});

export const mapRefinementSchema = z.object({
  id: z.string().describe("Returned in the result."),
  label: z.string().max(32).describe("e.g. 'Under £150 a night'."),
  count: count
    .optional()
    .describe("DATA-BOUND. Stays that match, from the search."),
});

export const mapCenterSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const mapSchema = z.object({
  title: z.string().describe("e.g. 'Saturday viewings'."),
  mode: z
    .enum(["view", "pick", "pin", "itinerary", "nearby"])
    .default("view")
    .describe(
      "'view': show places. 'pick': the user chooses one place. 'pin': the user drops a pin anywhere. 'itinerary': a multi-day trip from 'stops'. 'nearby': places to stay around 'anchor', from 'stays'.",
    ),
  places: z
    .array(mapPlaceSchema)
    .max(25)
    .default([])
    .describe(
      "DATA-BOUND. Places with coordinates from a tool result. Optional in 'pin' mode. Unused in 'itinerary' and 'nearby'.",
    ),
  route: z
    .union([z.boolean(), mapRoutePathSchema])
    .default(false)
    .describe(
      "true: draw a line through the places in 'order' and number the markers. In 'itinerary' the stops are always joined in order; pass { coordinates } to follow a real road path.",
    ),
  stops: z
    .array(mapStopSchema)
    .max(40)
    .optional()
    .describe(
      "DATA-BOUND. 'itinerary' only: the trip's stops in visiting order, from a tool result.",
    ),
  days: z
    .array(mapDaySchema)
    .max(60)
    .optional()
    .describe("'itinerary' only: optional labels for the day filter."),
  selectable: z
    .boolean()
    .default(false)
    .describe(
      "'itinerary' only: let the user choose one stop and send it back. Default false: display only.",
    ),
  anchor: mapAnchorSchema
    .optional()
    .describe(
      "DATA-BOUND. 'nearby' only: the place to stay near, with coordinates from a geocoder.",
    ),
  stays: z
    .array(mapStaySchema)
    .max(60)
    .optional()
    .describe(
      "DATA-BOUND. 'nearby' only: stays from a lodging search, picks first; the rest show as dots for context.",
    ),
  currency: z
    .string()
    .length(3)
    .optional()
    .describe("'nearby' only: ISO 4217 code for stay prices, e.g. 'GBP'."),
  search: mapSearchSchema
    .optional()
    .describe(
      "'nearby' only: the search behind the stays, for the line under the title.",
    ),
  refinements: z
    .array(mapRefinementSchema)
    .max(4)
    .optional()
    .describe(
      "'nearby' only: ways to narrow the search. Each sends its id back to you.",
    ),
  units: z
    .enum(["metric", "imperial"])
    .optional()
    .describe("'nearby' only: distances in km (default) or miles."),
  center: mapCenterSchema
    .optional()
    .describe("Initial center. Omit to fit the map to the places."),
  zoom: z
    .number()
    .min(1)
    .max(19)
    .optional()
    .describe("Initial zoom with center: 12 for a city, 16 for a street."),
  submitLabel: z
    .string()
    .optional()
    .describe(
      "Confirm button for 'pick' and 'pin', e.g. 'Book this hotel' or 'Report here'.",
    ),
});

export type MapPlace = z.infer<typeof mapPlaceSchema>;
export type MapCenter = z.infer<typeof mapCenterSchema>;
export type MapStop = z.infer<typeof mapStopSchema>;
export type MapStopKind = (typeof MAP_STOP_KINDS)[number];
export type MapDay = z.infer<typeof mapDaySchema>;
export type MapAnchor = z.infer<typeof mapAnchorSchema>;
export type MapStay = z.infer<typeof mapStaySchema>;
export type MapPickReason = (typeof MAP_PICK_REASONS)[number];
export type MapSearch = z.infer<typeof mapSearchSchema>;
export type MapRefinement = z.infer<typeof mapRefinementSchema>;
export type MapInput = z.input<typeof mapSchema>;
export type MapMode = NonNullable<MapInput["mode"]>;

/** What the component sends back to the agent. A closed set of actions. */
export type MapResult =
  | { action: "select"; placeId: string }
  | { action: "pin"; lat: number; lng: number }
  | { action: "select-stop"; stopId: string }
  | { action: "view-rooms"; stayId: string }
  | { action: "refine"; refinementId: string }
  | { action: "cancel" };

/** Usage guidance the agent reads before choosing this component. */
export const mapGuidance = {
  useWhen: [
    "Where things are matters to the decision: viewings across a city, hotels near a venue, a route between stops.",
    "The user needs to choose a place, or tell you a location by pointing at it (a pothole, a meeting point).",
    "A trip over several days: 'itinerary' shows the stops by day on a route with a card per place.",
    "The user wants somewhere to stay near a named place (a landmark, a venue, a station, an address) and you have a lodging search with coordinates and prices: 'nearby' shows which stays are actually close and what being closer costs.",
  ],
  avoidWhen: [
    "There is one address. Write it out.",
    "Location doesn't affect the decision. Use a list or a table.",
    "You don't have coordinates from a tool. Never guess latitude or longitude.",
    "Hotels with no place to stay near ('hotels in Paris'): show them as entity cards. A hotel already chosen: use book_hotel for its rooms.",
  ],
  rules: [
    "Take coordinates from a tool result, never from memory.",
    "Use 'pick' only when the user must choose one of the places, and 'pin' when they must point at a spot.",
    "With route, give every place an order starting at 1.",
    "In 'itinerary', send stops in visiting order with a day each, and a kind when one fits. Set selectable only when you need the user to choose a stop.",
    "Keep descriptions to the one fact that helps the choice: price, distance, time.",
    "In 'nearby', take the anchor from a geocoder and each stay's coordinates and price from the search. Mark up to 5 picks with the reason that is true in the data ('closest' and 'lowest-price' only on the stay that is), send them first, then other stays from the same search (up to 60 in all). Give travel or path only when a routing tool returned them. Offer refinements the search can run, with counts when you have them.",
    "On 'view-rooms', show that hotel's rooms and rates with book_hotel. On 'refine', run the search again with that filter.",
    "On 'cancel', do nothing and ask what they'd like instead.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(mapSchema)`.
 */
export const mapTool = {
  name: "show_map",
  description: [
    "Show places on an interactive map with a list, optionally as a numbered route. Can ask the user to pick a place or drop a pin, show a multi-day itinerary with place cards, or show places to stay near a place the user named, with picks and distances.",
    `Use when: ${mapGuidance.useWhen.join(" ")}`,
    `Avoid when: ${mapGuidance.avoidWhen.join(" ")}`,
    `Rules: ${mapGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: mapSchema,
} as const;
