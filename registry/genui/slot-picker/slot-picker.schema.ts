import { z } from "zod"
import { DEFAULT_LOCALE } from "@/components/genui/locale"

/**
 * Slot Picker: the agent's contract.
 *
 * The user picks a date and time from real availability: a call, a table, an
 * appointment. Fields marked DATA-BOUND must come from a tool result, never
 * from model free text.
 */

export const timeSlotSchema = z.object({
  id: z
    .string()
    .describe(
      "DATA-BOUND. The slot's id in the booking system. Returned in the result.",
    ),
  start: z
    .string()
    .describe(
      "DATA-BOUND. 'HH:mm' wall-clock time in the picker's timezone, or a full ISO date-time with offset.",
    ),
  end: z.string().optional().describe("DATA-BOUND. Same format as start."),
  label: z
    .string()
    .optional()
    .describe("Overrides the formatted time, e.g. 'Bar seating · 7:30'."),
  available: z
    .boolean()
    .default(true)
    .describe("DATA-BOUND. false shows the slot as taken."),
})

export const slotDaySchema = z.object({
  date: z.string().describe("DATA-BOUND. Calendar date, 'YYYY-MM-DD'."),
  slots: z.array(timeSlotSchema).describe("DATA-BOUND. In time order."),
})

/** The kinds of booking the title icon may show. */
export const slotKinds = [
  "call",
  "table",
  "service",
  "meeting",
  "other",
] as const

export type SlotKind = (typeof slotKinds)[number]

export const slotPickerSchema = z.object({
  kind: z
    .enum(slotKinds)
    .optional()
    .describe(
      "What is being booked: call, table, service, meeting or other. Shown as a coloured icon beside the title.",
    ),
  title: z
    .string()
    .describe("What is being booked, e.g. 'Book a follow-up call'."),
  description: z.string().optional(),
  timezone: z
    .string()
    .describe(
      "IANA timezone the times are in, e.g. 'America/New_York'. Shown to the user.",
    ),
  days: z
    .array(slotDaySchema)
    .min(1)
    .max(366)
    .describe(
      "DATA-BOUND. Availability from the calendar or booking system, up to a year ahead. Include only days with times; the picker shows a 12-month calendar from the first day, with the rest faded.",
    ),
  durationLabel: z
    .string()
    .optional()
    .describe("e.g. '30 min' or 'Party of 4 · 2 hours'."),
  submitLabel: z
    .string()
    .optional()
    .describe("Verb for the confirm button, e.g. 'Book call'."),
})

export type TimeSlot = z.input<typeof timeSlotSchema>
export type SlotDay = z.input<typeof slotDaySchema>
export type SlotPickerInput = z.input<typeof slotPickerSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type SlotPickerResult =
  | {
      action: "select"
      slotId: string
      /** The day, 'YYYY-MM-DD'. */
      date: string
      /** The slot's start, exactly as it was given. */
      start: string
      /**
       * The choice as shown, e.g. "Monday, October 12 at 9:30 AM". For
       * display (a bind into a confirmation); use date and start for logic.
       */
      label?: string
    }
  /** The user closed the picker. Ask in text what works for them instead. */
  | { action: "cancel" }

/** Usage guidance the agent reads before choosing this component. */
export const slotPickerGuidance = {
  useWhen: [
    "The user needs to pick a time for something with real availability: a call, a table, a service appointment.",
    "You fetched open slots from a calendar or booking system.",
  ],
  avoidWhen: [
    "You have not checked availability. Fetch it first; never offer invented times.",
    "There is exactly one possible time. Ask for a yes or no in text.",
    "The user already named a time that is free. Book it, or confirm it with a change preview.",
  ],
  rules: [
    "Every slot must come from a tool result, with its real id.",
    "Always set timezone to the zone the times are in, and use the user's zone when you can.",
    "Include taken slots as available: false when it helps the user see the shape of the day; drop days with nothing at all.",
    "Book only the slotId returned with action 'select', and re-check it is still free before booking.",
    "For a single booking the slot picker is the whole interaction: don't wrap it in a guided flow with a review step; confirm the chosen time in text, or with a change preview when the booking needs approval.",
    "To show the chosen time in another component (a bind), bind to the result's label, which reads like 'Monday, October 12 at 9:30 AM'; start is the raw value.",
  ],
} as const

const hhmm = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** 'YYYY-MM-DD' (or the date part of an ISO string) as a UTC timestamp. */
function parseDay(date: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)
}

/**
 * Formats a slot time for display. 'HH:mm' is already wall-clock time in the
 * picker's timezone; ISO date-times are converted into it.
 */
export function formatSlotTime(
  start: string,
  timeZone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  }
  const m = hhmm.exec(start.trim())
  if (m) {
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "UTC",
    }).format(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])))
  }
  const t = Date.parse(start)
  if (Number.isNaN(t)) return start
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(t)
  } catch {
    // Unknown timezone: show UTC rather than failing.
    return new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: "UTC",
    }).format(t)
  }
}

/** A calendar date for display, never shifted by the viewer's timezone. */
export function formatDay(
  date: string,
  style: "weekday" | "date" | "long",
  locale: string = DEFAULT_LOCALE,
): string {
  const t = parseDay(date)
  if (t === null) return date
  const options: Intl.DateTimeFormatOptions =
    style === "weekday"
      ? { weekday: "short" }
      : style === "date"
        ? { month: "short", day: "numeric" }
        : { weekday: "long", month: "long", day: "numeric" }
  return new Intl.DateTimeFormat(locale, {
    ...options,
    timeZone: "UTC",
  }).format(t)
}

/**
 * The timezone as shown to the user: the IANA name with spaces, plus its
 * offset on the given date (e.g. 'GMT-4') when the runtime knows it.
 */
export function formatTimeZone(
  timeZone: string,
  date?: string,
  locale: string = DEFAULT_LOCALE,
) {
  const name = timeZone.replace(/_/g, " ")
  try {
    const at = (date && parseDay(date)) || Date.now()
    const offset = new Intl.DateTimeFormat(locale, {
      timeZone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value
    // Node's ICU says "GMT" where browsers say "GMT+0"; pick one so server
    // and client render the same text.
    return offset ? `${name} (${offset === "GMT" ? "GMT+0" : offset})` : name
  } catch {
    return name
  }
}

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(slotPickerSchema)`.
 */
export const slotPickerTool = {
  name: "pick_slot",
  description: [
    "Let the user pick a date and time from real availability, and wait for their choice.",
    `Use when: ${slotPickerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${slotPickerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${slotPickerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: slotPickerSchema,
} as const
