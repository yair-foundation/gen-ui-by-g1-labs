import { z } from "zod"

/**
 * Doctor Appointment: the agent's contract.
 *
 * A clinic's real availability: the user picks a provider (or any), a visit
 * type, a day and a time, their insurance plan and an optional reason, and
 * hands off to the host's booking flow. Also shows an upcoming appointment.
 * Fields marked DATA-BOUND must come from a tool result (the clinic's
 * scheduling API), never from model free text. This component never triages,
 * diagnoses or advises, and never books or cancels by itself.
 */

const instant = z.iso
  .datetime({ offset: true })
  .describe("ISO 8601 with offset.")

export const clinicSchema = z.object({
  name: z.string(),
  address: z.string().optional().describe("Full street address."),
  phone: z.string().optional(),
  timeZone: z.string().describe("IANA, e.g. 'America/New_York'."),
})

export const providerSchema = z.object({
  id: z.string(),
  name: z.string(),
  specialty: z.string().max(60).describe("e.g. 'Family medicine'."),
  languages: z
    .array(z.string().max(30))
    .max(6)
    .optional()
    .describe("Languages spoken."),
  acceptingNew: z.boolean().optional().describe("Omit if unknown."),
  gender: z
    .string()
    .max(20)
    .optional()
    .describe("Only when the user asked to filter by it."),
})

export const visitTypeSchema = z.object({
  id: z.string(),
  label: z.string().max(24).describe("e.g. 'Video'."),
  durationMin: z
    .number()
    .int()
    .positive()
    .max(480)
    .optional()
    .describe("Minutes."),
})

export const appointmentSlotSchema = z.object({
  providerId: z.string().describe("A `providers` id."),
  visitTypeId: z.string().describe("A `visitTypes` id."),
  start: instant,
})

export const insuranceSchema = z.object({
  accepted: z
    .array(z.string().max(60))
    .max(30)
    .describe("As the source names them."),
  selected: z
    .string()
    .max(60)
    .optional()
    .describe("The user's plan, if known."),
  coverageNote: z
    .string()
    .max(160)
    .optional()
    .describe("From the source. Never your own estimate."),
})

export const intakeFormSchema = z.object({
  label: z.string().max(60),
  url: z.string().describe("http(s) only."),
})

export const appointmentSchema = z.object({
  number: z.string().describe("Confirmation number."),
  bookingState: z.enum(["confirmed", "pending", "cancelled"]),
  providerId: z.string().describe("A `providers` id."),
  visitTypeId: z.string().describe("A `visitTypes` id."),
  start: instant,
  location: z
    .string()
    .optional()
    .describe("Where to go. Default: the clinic address."),
  videoUrl: z.string().optional().describe("Video join link. http(s) only."),
  checkInOpensMinutesBefore: z
    .number()
    .int()
    .min(0)
    .max(1440)
    .optional()
    .describe("Minutes before start the join link opens."),
})

export const doctorAppointmentSchema = z.object({
  mode: z
    .enum(["select", "confirmation"])
    .describe("'confirmation': an upcoming appointment."),
  clinic: clinicSchema.optional().describe("DATA-BOUND."),
  providers: z
    .array(providerSchema)
    .min(1)
    .max(6)
    .describe("DATA-BOUND. Confirmation mode: at least the booked one."),
  visitTypes: z.array(visitTypeSchema).min(1).max(4).describe("DATA-BOUND."),
  slots: z
    .array(appointmentSlotSchema)
    .max(60)
    .default([])
    .describe("DATA-BOUND. Select mode only. Never invent slots."),
  insurance: insuranceSchema.optional().describe("DATA-BOUND."),
  reasons: z
    .array(z.string().max(32))
    .max(8)
    .optional()
    .describe("Common reasons, e.g. 'Check-up'. Never symptoms or diagnoses."),
  forms: z
    .array(intakeFormSchema)
    .max(6)
    .optional()
    .describe("DATA-BOUND. Intake forms."),
  confirmation: appointmentSchema.optional().describe("DATA-BOUND."),
})

export type Clinic = z.infer<typeof clinicSchema>
export type Provider = z.infer<typeof providerSchema>
export type VisitType = z.infer<typeof visitTypeSchema>
export type AppointmentSlot = z.infer<typeof appointmentSlotSchema>
export type Insurance = z.infer<typeof insuranceSchema>
export type IntakeForm = z.infer<typeof intakeFormSchema>
export type Appointment = z.infer<typeof appointmentSchema>
export type DoctorAppointmentInput = z.input<typeof doctorAppointmentSchema>

/** What the component sends back. A closed set of actions. */
export type DoctorAppointmentResult =
  /**
   * Hand off to the host's booking flow. Nothing is booked yet. `reason` and
   * `note` are health details: send them to the clinic only.
   */
  | {
      action: "book"
      providerId: string
      visitTypeId: string
      start: string
      insurance?: string
      reason?: string
      note?: string
    }
  | { action: "dismiss" }
  /**
   * Confirmation mode. cancel-appointment is only sent after a second,
   * explicit click. add-to-calendar is sent after the .ics file is saved.
   */
  | { action: "reschedule" | "cancel-appointment" | "add-to-calendar" }

/** Usage guidance the agent reads before choosing this component. */
export const doctorAppointmentGuidance = {
  useWhen: [
    "The user wants to book a medical, dental or therapy appointment and you have the clinic's real availability: 'book a GP appointment this week', 'find a dermatologist who takes my insurance'.",
    "The user asks about an upcoming appointment (mode 'confirmation'): 'when is my dentist appointment?'.",
  ],
  avoidWhen: [
    "The user describes urgent symptoms (chest pain, trouble breathing, severe bleeding, thoughts of self-harm). Tell them to call their local emergency number or go to the nearest emergency department; don't show a booking card.",
    "The user asks what's wrong or what to do about a symptom. Don't triage, diagnose or advise; suggest they talk to a clinician.",
    "You haven't fetched availability. Never invent providers or times.",
    "It's a generic meeting, not a clinic. Use the slot picker.",
  ],
  rules: [
    "Pass providers, visit types and slots exactly as the scheduling API returned them, with each slot's start as an ISO instant with offset.",
    "Only include gender when the user asked to filter by it.",
    "Set insurance.selected only when you know the user's plan; pass coverageNote only as the source states it.",
    "reasons are neutral visit types ('Check-up', 'Follow-up'), never symptoms or conditions.",
    "On book, start the host's booking flow with exactly the returned providerId, visitTypeId and start. Never treat it as booked until the clinic confirms.",
    "reason and note are health details: send them only to the clinic. Never repeat them in chat summaries, titles, calendar events or URLs.",
    "On reschedule, fetch fresh availability and show select mode again. On cancel-appointment, cancel through the scheduling tool and confirm in one line. On dismiss, do nothing.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(doctorAppointmentSchema)`.
 */
export const doctorAppointmentTool = {
  name: "book_doctor_appointment",
  description: [
    "Show a clinic's real open appointment times by provider and visit type and hand off to booking; or show an upcoming appointment.",
    `Use when: ${doctorAppointmentGuidance.useWhen.join(" ")}`,
    `Avoid when: ${doctorAppointmentGuidance.avoidWhen.join(" ")}`,
    `Rules: ${doctorAppointmentGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: doctorAppointmentSchema,
} as const
