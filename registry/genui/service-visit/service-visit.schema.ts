import { z } from "zod"

/**
 * Service Visit: the agent's contract.
 *
 * Schedule a technician or service person at home (a plumber, an electrician,
 * appliance repair, an internet installation, cleaning, pest control, moving
 * help) from one provider's real arrival windows and prices. The user
 * describes the problem, answers a few triage questions, picks a window,
 * adds access details and photos, and hands off a visit request. Also shows
 * an existing visit. Fields marked DATA-BOUND must come from a tool result
 * (the provider's API), never from model free text. This component never
 * books, charges or cancels by itself.
 */

// `.meta({ pattern: undefined })` and `.meta({ maximum: undefined })` keep
// Zod's checks but leave its long ISO regex and 2^53 integer bound out of the
// JSON Schema the model reads (token cost only; `format` still says date).
const isoDate = z.iso.date().meta({ pattern: undefined })
const localTime = z
  .string()
  .regex(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  .describe("HH:mm, local.")

export const visitProviderSchema = z.object({
  name: z.string(),
  rating: z
    .object({
      score: z.number().min(0),
      outOf: z.number().positive(),
      count: z.number().int().min(0).meta({ maximum: undefined }),
    })
    .optional(),
  licensed: z
    .boolean()
    .optional()
    .describe(
      "true only if the source says so. Same for insured. Screen readers only.",
    ),
  insured: z.boolean().optional().describe("Screen readers only."),
})

export const visitServiceSchema = z.object({
  type: z.string().max(40).describe("e.g. 'Plumbing'."),
  description: z
    .string()
    .max(80)
    .optional()
    .describe("What it's for, e.g. 'Dishwasher'."),
})

export const triageQuestionSchema = z.object({
  id: z.string(),
  label: z.string().max(80),
  type: z.enum(["select", "text", "boolean"]),
  options: z
    .array(z.string().max(40))
    .max(8)
    .optional()
    .describe("Select only."),
  required: z.boolean().optional(),
})

export const visitIssueSchema = z.object({
  summary: z
    .string()
    .max(500)
    .optional()
    .describe("What the user said is wrong, in their words."),
  questions: z
    .array(triageQuestionSchema)
    .max(4)
    .optional()
    .describe("DATA-BOUND. The provider's triage questions."),
})

export const visitAddressSchema = z.object({
  line1: z.string().describe("Street and number."),
  city: z.string(),
  postcode: z.string().max(12).optional(),
  accessNotes: z.string().max(300).optional().describe("e.g. 'Buzzer 3B'."),
})

export const visitWindowSchema = z.object({
  id: z.string(),
  start: localTime,
  end: localTime,
  fee: z.number().min(0).optional().describe("Extra charge for this window."),
  urgent: z.boolean().optional().describe("Urgent or same-day window."),
})

export const visitDaySchema = z.object({
  date: isoDate,
  slots: z.array(visitWindowSchema).max(8).describe("Empty: the day is full."),
})

export const visitPricingSchema = z.object({
  callOutFee: z.number().min(0).optional(),
  hourlyRate: z.number().min(0).optional(),
  estimate: z
    .object({ low: z.number().min(0), high: z.number().min(0) })
    .optional()
    .describe("Typical total for this job."),
  currency: z.string().length(3).describe("ISO 4217."),
  note: z.string().max(120).optional(),
})

export const visitTechnicianSchema = z.object({
  name: z.string().describe("As the provider shares it."),
  rating: z.number().min(0).max(5).optional().describe("Screen readers only."),
})

export const visitConfirmationSchema = z.object({
  number: z.string().describe("Booking reference."),
  bookingState: z.enum([
    "confirmed",
    "pending",
    "technician-assigned",
    "cancelled",
  ]),
  windowId: z.string().describe("Must also be listed in `windows`."),
  technician: visitTechnicianSchema.optional(),
  eta: z.iso.datetime({ offset: true }).meta({ pattern: undefined }).optional(),
})

export const serviceVisitSchema = z.object({
  mode: z.enum(["select", "confirmation"]),
  provider: visitProviderSchema.describe("DATA-BOUND."),
  service: visitServiceSchema.describe("DATA-BOUND."),
  issue: visitIssueSchema.optional(),
  address: visitAddressSchema
    .optional()
    .describe("DATA-BOUND. The address on file."),
  windows: z
    .array(visitDaySchema)
    .max(7)
    .default([])
    .describe(
      "DATA-BOUND. Per day. Confirmation mode: include the booked window.",
    ),
  timeZone: z.string().describe("IANA, e.g. 'Europe/Amsterdam'."),
  pricing: visitPricingSchema.optional().describe("DATA-BOUND."),
  photos: z
    .object({
      allowed: z.boolean(),
      max: z.number().int().min(1).max(10).optional().describe("Default 4."),
    })
    .optional()
    .describe("Whether the provider accepts photos."),
  contactPreference: z
    .boolean()
    .optional()
    .describe("Ask whether to call or text."),
  confirmation: visitConfirmationSchema.optional().describe("DATA-BOUND."),
})

export type VisitProvider = z.infer<typeof visitProviderSchema>
export type VisitService = z.infer<typeof visitServiceSchema>
export type TriageQuestion = z.infer<typeof triageQuestionSchema>
export type VisitIssue = z.infer<typeof visitIssueSchema>
export type VisitAddress = z.infer<typeof visitAddressSchema>
export type VisitWindow = z.infer<typeof visitWindowSchema>
export type VisitDay = z.infer<typeof visitDaySchema>
export type VisitPricing = z.infer<typeof visitPricingSchema>
export type VisitTechnician = z.infer<typeof visitTechnicianSchema>
export type VisitConfirmation = z.infer<typeof visitConfirmationSchema>
export type ServiceVisitInput = z.input<typeof serviceVisitSchema>

/** What the component sends back. A closed set of actions. */
export type ServiceVisitResult =
  /**
   * Hand off a visit request to the provider. Nothing is booked or charged
   * yet. The photos themselves go to the host's `onFiles`, never here.
   */
  | {
      action: "request"
      windowId: string
      date: string
      /** The issue as the user left it (prefilled from `issue.summary`). */
      summary: string
      /** Answered triage questions only, by question id. */
      answers: Record<string, string | boolean>
      /**
       * Access details the user added. `gateCode` is for the provider only:
       * never repeat it in chat.
       */
      address: {
        unit?: string
        floor?: string
        gateCode?: string
        accessNotes?: string
      }
      photoCount: number
      contact?: "call" | "text"
      notes?: string
    }
  | { action: "dismiss" }
  /** Confirmation mode. cancel-visit is only sent after a second, explicit click. */
  | {
      action:
        | "reschedule"
        | "cancel-visit"
        | "add-to-calendar"
        | "contact-provider"
    }

/** Usage guidance the agent reads before choosing this component. */
export const serviceVisitGuidance = {
  useWhen: [
    "The user wants someone to come to their home: a plumber, an electrician, appliance repair, an internet installation, cleaning, pest control, moving help.",
    "You have one provider's real arrival windows for the service.",
    "The user asks about a visit that's already booked (mode 'confirmation').",
  ],
  avoidWhen: [
    "The user is still choosing a provider. Compare them first.",
    "You haven't fetched availability from the provider. Never invent windows or prices.",
    "It's an appointment the user goes to (a haircut, a doctor). Use the slot picker.",
    "It's a restaurant table. Use the restaurant reservation.",
  ],
  rules: [
    "Pass windows, fees, prices and triage questions exactly as the provider returned them. Include fully booked days with empty slots.",
    "Prefill issue.summary with what the user said, in their words. Ask at most 4 triage questions, only ones the provider needs.",
    "Pass the address on file; the card only shows the street.",
    "On request, send exactly the returned window, answers and access details to the provider's booking tool, with the photos the host received. Never treat it as booked until the provider confirms.",
    "Never repeat a gate code in chat. Never ask for card details: the provider is paid on site.",
    "On cancel-visit, cancel through the provider's tool and confirm in one line. On reschedule, fetch new windows and show this component again. On dismiss, do nothing.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(serviceVisitSchema)`.
 */
export const serviceVisitTool = {
  name: "schedule_service_visit",
  description: [
    "Schedule a technician at the user's home from one provider's real arrival windows and prices; or show a booked visit.",
    `Use when: ${serviceVisitGuidance.useWhen.join(" ")}`,
    `Avoid when: ${serviceVisitGuidance.avoidWhen.join(" ")}`,
    `Rules: ${serviceVisitGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: serviceVisitSchema,
} as const
