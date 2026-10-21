import { z } from "zod"

/**
 * QR Code: the agent's contract.
 *
 * A scannable code for something the agent prepared: a link, guest Wi-Fi,
 * a contact card, an event, an email, a phone number or plain text. Links,
 * credentials and payment links are DATA-BOUND: they come from the user or a
 * tool result, never from model free text.
 */

const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => {
    try {
      const { protocol } = new URL(u)
      return protocol === "http:" || protocol === "https:"
    } catch {
      return false
    }
  }, "Use a full http(s) URL, e.g. 'https://acme.example/menu'")

/** A date ('2026-11-05') or a date-time with an offset ('2026-11-05T18:00:00+01:00'). */
const isoDateOrDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/,
    "ISO 8601 date, or date-time with an offset, e.g. '2026-11-05T18:00:00+01:00'",
  )
  .refine((s) => !Number.isNaN(Date.parse(s)), "Not a real date")

const isDateOnly = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)

export const qrUrlContentSchema = z.object({
  type: z.literal("url"),
  url: httpUrl.describe(
    "DATA-BOUND. The exact link, http(s) only. A payment request link must come from the host's payment tool; never build or guess one.",
  ),
})

export const qrTextContentSchema = z.object({
  type: z.literal("text"),
  text: z
    .string()
    .min(1)
    .max(900)
    .describe("Plain text, up to 900 characters."),
})

export const qrWifiContentSchema = z
  .object({
    type: z.literal("wifi"),
    ssid: z
      .string()
      .min(1)
      .max(32)
      .describe("DATA-BOUND. The network name exactly as the user gave it."),
    password: z
      .string()
      .max(63)
      .optional()
      .describe(
        "DATA-BOUND. From the user or a tool result; never invent one. Omit for open networks.",
      ),
    security: z
      .enum(["WPA", "WEP", "nopass"])
      .describe("'WPA' covers WPA, WPA2 and WPA3. 'nopass' for open networks."),
    hidden: z
      .boolean()
      .optional()
      .describe("True when the network doesn't broadcast its name."),
  })
  .refine((w) => w.security === "nopass" || Boolean(w.password), {
    message: "A secured network needs its password",
    path: ["password"],
  })

export const qrContactContentSchema = z.object({
  type: z.literal("contact"),
  name: z
    .string()
    .min(1)
    .max(80)
    .describe("Full name, given name first, e.g. 'Dana Levi'."),
  phone: z
    .string()
    .max(32)
    .optional()
    .describe("DATA-BOUND. International format, e.g. '+1 555 0100'."),
  email: z.email().max(254).optional().describe("DATA-BOUND."),
  org: z.string().max(80).optional().describe("Company or organization."),
  title: z.string().max(80).optional().describe("Job title."),
  url: httpUrl.optional().describe("DATA-BOUND. A website, http(s) only."),
})

export const qrEventContentSchema = z
  .object({
    type: z.literal("event"),
    title: z.string().min(1).max(120).describe("e.g. 'Team offsite'."),
    start: isoDateOrDateTime.describe(
      "A date-time with its UTC offset ('2026-11-05T18:00:00+01:00'), or a date ('2026-11-05') for an all-day event.",
    ),
    end: isoDateOrDateTime
      .optional()
      .describe(
        "Same form as start. For all-day events, the last day (inclusive).",
      ),
    location: z.string().max(120).optional(),
  })
  .refine((e) => !e.end || isDateOnly(e.end) === isDateOnly(e.start), {
    message: "Start and end must both be dates or both be date-times",
    path: ["end"],
  })
  .refine((e) => !e.end || Date.parse(e.end) >= Date.parse(e.start), {
    message: "The event ends before it starts",
    path: ["end"],
  })

export const qrEmailContentSchema = z.object({
  type: z.literal("email"),
  to: z.email().max(254).describe("DATA-BOUND. One address."),
  subject: z.string().max(120).optional(),
  body: z.string().max(600).optional(),
})

export const qrPhoneContentSchema = z.object({
  type: z.literal("phone"),
  number: z
    .string()
    .max(32)
    .refine(
      (n) => n.replace(/\D/g, "").length >= 3,
      "Use a phone number, e.g. '+1 555 0100'",
    )
    .describe("DATA-BOUND. International format, e.g. '+1 555 0100'."),
})

export const qrContentSchema = z.discriminatedUnion("type", [
  qrUrlContentSchema,
  qrTextContentSchema,
  qrWifiContentSchema,
  qrContactContentSchema,
  qrEventContentSchema,
  qrEmailContentSchema,
  qrPhoneContentSchema,
])

export const qrErrorCorrectionLevels = ["L", "M", "Q", "H"] as const

export const qrCodeSchema = z.object({
  title: z
    .string()
    .max(80)
    .optional()
    .describe(
      "e.g. 'Guest Wi-Fi'. Defaults to the network, name, event or site.",
    ),
  content: qrContentSchema.describe("What the code encodes."),
  errorCorrection: z
    .enum(qrErrorCorrectionLevels)
    .default("M")
    .describe(
      "How much damage the code survives: L 7%, M 15%, Q 25%, H 30%. Higher levels hold less data.",
    ),
  caption: z
    .string()
    .max(120)
    .optional()
    .describe("One line under the code, e.g. 'Scan to see today's menu'."),
  size: z
    .enum(["sm", "md", "lg"])
    .default("md")
    .describe("160, 220 or 280 px. Use lg for long content or printing."),
})

export type QrContent = z.infer<typeof qrContentSchema>
export type QrContentInput = z.input<typeof qrContentSchema>
export type QrContentType = QrContent["type"]
export type QrErrorCorrection = (typeof qrErrorCorrectionLevels)[number]
export type QrCodeInput = z.input<typeof qrCodeSchema>

/** Fired when the user uses a footer action. For analytics; nothing locks. */
export type QrCodeResult = {
  action: "download-png" | "download-svg" | "copy"
}

/** Usage guidance the agent reads before choosing this component. */
export const qrCodeGuidance = {
  useWhen: [
    "The user wants something to scan with another device or to print: a menu or sign-up link, guest Wi-Fi, a contact card for a badge, an event to add to calendars.",
    "The host's payment tool returned a payment request link and the user wants it as a code.",
  ],
  avoidWhen: [
    "The user only needs the link on the device they're using. Send it as a link.",
    "You don't have the link, password, number or payment link from the user or a tool result. Ask; never invent them.",
    "The content is long (more than a few hundred characters). Share a file or a link instead.",
    "The content is a secret beyond guest Wi-Fi: account passwords, API keys, recovery codes.",
  ],
  rules: [
    "Pick the most specific type: wifi, contact, event, email or phone rather than text, so phones offer the right action.",
    "Pass links, Wi-Fi credentials, phone numbers and email addresses exactly as given. Payment requests are only ever a url the host's payment tool returned.",
    "Give event date-times with their UTC offset; use a plain date for all-day events.",
    "Leave errorCorrection at M. Use Q or H for printed codes that may get scuffed, L when the content is long.",
    "Add a caption that says what scanning does, e.g. 'Scan to join the guest Wi-Fi'.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(qrCodeSchema)`.
 */
export const qrCodeTool = {
  name: "show_qr_code",
  description: [
    "Show a scannable QR code for a link, guest Wi-Fi, a contact card, an event, an email, a phone number or plain text, with a readable summary and PNG/SVG download.",
    `Use when: ${qrCodeGuidance.useWhen.join(" ")}`,
    `Avoid when: ${qrCodeGuidance.avoidWhen.join(" ")}`,
    `Rules: ${qrCodeGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: qrCodeSchema,
} as const
