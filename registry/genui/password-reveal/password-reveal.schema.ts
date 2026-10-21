import { z } from "zod"

/**
 * Password Reveal: the agent's contract.
 *
 * Shows a secret the user is entitled to see (a shared Wi-Fi password, a
 * recovery code, a new API key, a door code) masked by default, or generates
 * a strong password locally. The secret never travels back in a result.
 */

export const secretKinds = [
  "password",
  "code",
  "codes",
  "api-key",
  "pin",
  "generated",
] as const

export const passwordGenerateSchema = z.object({
  length: z
    .number()
    .int()
    .min(12)
    .max(64)
    .default(20)
    .describe("Characters, 12–64. The user can change it."),
  symbols: z.boolean().default(true),
  numbers: z.boolean().default(true),
  uppercase: z.boolean().default(true),
  exclude: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Characters the target system rejects or that look alike, e.g. '0O1lI'.",
    ),
})

export const passwordRevealSchema = z.object({
  label: z
    .string()
    .max(80)
    .describe("What the secret is: 'Guest Wi-Fi password', 'Recovery codes'."),
  kind: z
    .enum(secretKinds)
    .describe(
      "'codes' is a list (shown as a grid). 'generated' makes a password in the browser; omit value.",
    ),
  value: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1).max(24)])
    .optional()
    .describe(
      "DATA-BOUND. The secret exactly as the tool returned it; a list for 'codes'. Never invent, guess or repeat it in text. Omit for 'generated'.",
    ),
  hint: z
    .string()
    .max(140)
    .optional()
    .describe("Where to use it, e.g. 'Network: Acme Guest'. Never the secret."),
  revealSeconds: z
    .number()
    .int()
    .min(5)
    .max(300)
    .default(30)
    .describe("Seconds before a revealed secret hides again."),
  oneTime: z
    .boolean()
    .default(false)
    .describe(
      "Show once: after the first reveal ends, the component forgets the value.",
    ),
  clearClipboardAfter: z
    .number()
    .int()
    .min(0)
    .max(600)
    .default(60)
    .describe(
      "Seconds after a copy to clear the clipboard if it still holds the secret (best effort). 0 turns it off.",
    ),
  generate: passwordGenerateSchema
    .optional()
    .describe("Options for kind 'generated'."),
  rotatable: z
    .boolean()
    .default(false)
    .describe("Offer 'Request a new one' when you can issue a replacement."),
  expiresAt: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. ISO 8601 time the secret stops working. Shown as 'Expires in 23 h'.",
    ),
})

export type SecretKind = (typeof secretKinds)[number]
export type PasswordGenerateInput = z.input<typeof passwordGenerateSchema>
export type PasswordRevealInput = z.input<typeof passwordRevealSchema>

/**
 * What the component reports. Actions only: the secret (given or generated)
 * is never part of a result.
 */
export type PasswordRevealResult = {
  action: "revealed" | "copied" | "rotated-request" | "dismiss"
}

/** Usage guidance the agent reads before choosing this component. */
export const passwordRevealGuidance = {
  useWhen: [
    "The user asks for a secret they're entitled to see and a tool returned it: a shared Wi-Fi password, backup codes, an API key they just created, a door code.",
    "The user wants a new strong password: use kind 'generated' so it's made in their browser and you never see it.",
  ],
  avoidWhen: [
    "You haven't verified the user may see the secret. Check access first; never reveal someone else's credentials.",
    "You don't have the secret from a tool result. Never invent, guess or reconstruct one.",
    "The value isn't secret (a booking reference, an order number). Show it as text.",
    "The user wants a guest network as a scannable code. Use the QR code.",
  ],
  rules: [
    "Pass the value exactly as the tool returned it, and never repeat it in your reply, a summary or another tool call.",
    "For a new password, use kind 'generated' with generate options; don't put a password you made up in value.",
    "Set oneTime for recovery and one-time codes, rotatable when you can issue a replacement, and expiresAt when the secret lapses.",
    "Put where to use it in hint (the network, the door, the service), never the secret.",
    "Results only say what the user did ('revealed', 'copied', 'rotated-request', 'dismiss'). On 'rotated-request', issue a new secret and show a new card.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(passwordRevealSchema)`.
 */
export const passwordRevealTool = {
  name: "reveal_secret",
  description: [
    "Show the user a secret safely: masked until they reveal it, auto-hiding, with copy and best-effort clipboard clearing. Or generate a strong password in their browser.",
    `Use when: ${passwordRevealGuidance.useWhen.join(" ")}`,
    `Avoid when: ${passwordRevealGuidance.avoidWhen.join(" ")}`,
    `Rules: ${passwordRevealGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: passwordRevealSchema,
} as const
