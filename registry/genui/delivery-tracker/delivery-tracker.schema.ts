import { z } from "zod"

/**
 * Delivery tracker: the agent's contract.
 *
 * Live tracking of one delivery: a food order, groceries, a parcel or a ride
 * on its way. Stages, times, the courier and any issue are DATA-BOUND: they
 * come from the merchant's or carrier's tracking data, never from model free
 * text. For live updates, the host re-renders with new props.
 */

const isoDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
    "ISO 8601 date-time, e.g. '2026-10-08T10:30:00+01:00'",
  )

export const deliveryKinds = ["food", "grocery", "parcel", "ride"] as const

export const deliveryActions = [
  "contact-courier",
  "contact-merchant",
  "change-instructions",
  "get-help",
] as const

export const deliveryStageSchema = z.object({
  id: z.string().describe("Stable identifier. Keep it as the stage updates."),
  label: z
    .string()
    .max(32)
    .describe(
      "In the source's words, e.g. 'Order received', 'Preparing', 'Baking', 'Quality check', 'Out for delivery', 'Delivered'.",
    ),
  state: z
    .enum(["done", "current", "upcoming"])
    .describe("At most one stage is current."),
  at: isoDateTime
    .optional()
    .describe(
      "When it happened (done) or is expected (upcoming), with the local UTC offset.",
    ),
})

export const deliveryTrackerSchema = z.object({
  kind: z
    .enum(deliveryKinds)
    .describe(
      "food: a restaurant order. grocery: a grocery order. parcel: a shipped package. ride: a car or taxi on its way to pick the user up.",
    ),
  merchant: z
    .object({
      name: z.string().max(40).describe("e.g. 'Green Bowl Kitchen'."),
      logo: z
        .object({
          src: z
            .string()
            .describe(
              "DATA-BOUND. The merchant's own app icon or logo: http(s), a same-origin path starting with a single slash, or data:image. Shown as a small rounded tile beside the title.",
            ),
          alt: z.string().optional().describe("What the logo shows."),
        })
        .optional()
        .describe("DATA-BOUND. Only when the merchant's data provides one."),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional()
        .describe(
          "DATA-BOUND. The merchant's brand colour as #rrggbb. Tints the progress bar; the finished state stays green.",
        ),
    })
    .optional()
    .describe(
      "DATA-BOUND. The restaurant, store, sender or ride service. Shown as text, with its logo and brand colour only when the data provides them.",
    ),
  orderNumber: z
    .string()
    .max(20)
    .optional()
    .describe("DATA-BOUND. e.g. '4821'."),
  stages: z
    .array(deliveryStageSchema)
    .min(3)
    .max(7)
    .describe(
      "DATA-BOUND. Every stage of this delivery in order, 3–7, exactly as the tracking source names them. A pizza tracker is just its stages.",
    ),
  eta: z
    .object({
      at: isoDateTime.describe(
        "Expected arrival, or the start of the window, with the delivery address's UTC offset.",
      ),
      windowEnd: isoDateTime
        .optional()
        .describe("End of the arrival window, e.g. 10:45 for '10:30–10:45'."),
    })
    .optional()
    .describe(
      "DATA-BOUND. Omit once delivered, or when the source gives none.",
    ),
  courier: z
    .object({
      name: z
        .string()
        .max(40)
        .describe("First name or as the source shows it."),
      initials: z.string().max(3).describe("e.g. 'RO'. Shown without a photo."),
      rating: z
        .number()
        .min(0)
        .max(5)
        .optional()
        .describe("Out of 5. Screen readers only."),
      vehicle: z
        .string()
        .max(40)
        .optional()
        .describe(
          "e.g. 'Scooter · 12-AB-34' or 'Grey Skoda Octavia · KX21 LMO'.",
        ),
      phoneAvailable: z
        .boolean()
        .optional()
        .describe(
          "The user can call the courier through the service. Adds a call button; the number is never shown.",
        ),
      photo: z
        .object({
          src: z
            .string()
            .describe(
              'http(s) or data:image URL, or a same-origin path starting with a single "/".',
            ),
          alt: z.string().max(80),
        })
        .optional(),
    })
    .optional()
    .describe("DATA-BOUND. Once someone is assigned. Omit before that."),
  items: z
    .array(
      z.object({
        name: z.string().max(60),
        quantity: z.number().int().min(1).max(99),
      }),
    )
    .max(8)
    .optional()
    .describe("DATA-BOUND. What's in the order, up to 8 lines."),
  address: z
    .string()
    .max(160)
    .optional()
    .describe(
      "DATA-BOUND. Delivery or pickup address. Screen readers only, street part (before the first comma).",
    ),
  issue: z
    .object({
      kind: z.enum(["delayed", "address-problem", "failed-attempt"]),
      message: z
        .string()
        .max(140)
        .describe(
          "In plain words, from the source: 'Running about 10 min late'.",
        ),
    })
    .optional()
    .describe(
      "DATA-BOUND. Something the user should know about. One at a time.",
    ),
  asOf: isoDateTime.describe("DATA-BOUND. When the tracking data was read."),
  actions: z
    .array(z.enum(deliveryActions))
    .max(4)
    .optional()
    .describe(
      "What the user can do, only what the service supports. Default by kind and stage: a call button when phoneAvailable, 'Contact restaurant' (food, grocery), 'Delivery instructions' (not rides) and 'Get help'. Once delivered, only 'Get help'.",
    ),
})

export type DeliveryStage = z.infer<typeof deliveryStageSchema>
export type DeliveryTrackerInput = z.input<typeof deliveryTrackerSchema>
export type DeliveryCourier = NonNullable<DeliveryTrackerInput["courier"]>

/**
 * Sent back when the user acts. The component never shows phone numbers or
 * contacts anyone itself: the host hands each action to the service.
 */
export type DeliveryTrackerResult =
  | { action: "contact-courier" }
  | { action: "contact-merchant" }
  | { action: "change-instructions"; text: string }
  | { action: "get-help" }

/** Usage guidance the agent reads before choosing this component. */
export const deliveryTrackerGuidance = {
  useWhen: [
    "The user asks where their order, groceries, parcel or ride is: 'Where's my food?', 'When will the pizza get here?', 'Track my parcel'.",
    "You have the stages and ETA from a tracking tool result.",
  ],
  avoidWhen: [
    "You don't have live tracking data. Never guess stages, times or couriers.",
    "The user wants to place, change or cancel an order. Use the ordering components.",
    "It's a flight. Use track_flight.",
  ],
  rules: [
    "Pass every stage of the delivery in order, in the source's words, with one current stage; mark finished ones done.",
    "Pass times with the delivery address's UTC offset, as the source gives them; the component works out the minutes left.",
    "Only add courier once someone is assigned, and phoneAvailable only when the service can connect a call.",
    "Only list actions the service supports. On a result, carry it out through the service and confirm in text; never show phone numbers.",
    "For live tracking, re-render the same component with new props rather than calling the tool again.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(deliveryTrackerSchema)`.
 */
export const deliveryTrackerTool = {
  name: "track_delivery",
  description: [
    "Show live tracking for one delivery: the current stage, a segmented progress bar, the arrival time and minutes left, the courier with a call button, any issue, and actions such as contacting the restaurant or changing delivery instructions.",
    `Use when: ${deliveryTrackerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${deliveryTrackerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${deliveryTrackerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: deliveryTrackerSchema,
} as const
