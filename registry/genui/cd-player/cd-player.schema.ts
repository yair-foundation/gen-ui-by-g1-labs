import { z } from "zod"

/**
 * CD Player: the agent's contract.
 *
 * A handful of albums from the user's music app, shown as CDs under a player.
 * The user drops one in (a click, a drag or the keyboard), it spins and plays
 * its preview, and the agent hears which one they picked. Albums, artwork and
 * previews come from the user's music provider, never from the model.
 */

export const cdAlbumSchema = z.object({
  id: z
    .string()
    .describe("DATA-BOUND. The provider's album id. Returned in results."),
  title: z.string().max(80).describe("DATA-BOUND. Album title."),
  artist: z
    .string()
    .max(80)
    .describe("DATA-BOUND. Artist name, as the provider spells it."),
  artwork: z
    .object({
      src: z
        .string()
        .describe(
          "http(s) URL, same-origin path (single leading '/') or data:image URL from the provider.",
        ),
      alt: z.string().describe("e.g. 'Cover of Gold Hour'."),
    })
    .optional()
    .describe(
      "DATA-BOUND. Album artwork, printed on the disc. Without it the disc is plain silver with the title written on it.",
    ),
  previewUrl: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. A short preview clip from the provider: http(s), blob: or data:audio. Plays in the chat, on repeat, while the disc spins.",
    ),
})

export const cdPlayerSchema = z.object({
  title: z
    .string()
    .max(60)
    .optional()
    .describe(
      "A short heading, e.g. 'Tonight's picks'. Leave it out when your reply already asks the question.",
    ),
  albums: z
    .array(cdAlbumSchema)
    .min(2)
    .max(8)
    .describe(
      "DATA-BOUND. 2–8 albums from the provider's search or the user's library, never invented. In the order you'd suggest them.",
    ),
  nowPlayingId: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. Id of the album (one of `albums`) the provider reports playing now. It starts in the player, spinning.",
    ),
})

export type CdAlbum = z.infer<typeof cdAlbumSchema>
export type CdPlayerInput = z.input<typeof cdPlayerSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type CdPlayerResult =
  /** The user put this disc in, or started it again after pausing. */
  | { action: "play"; albumId: string }
  /** The user stopped the disc in the player. */
  | { action: "pause"; albumId: string }

/** Usage guidance the agent reads before choosing this component. */
export const cdPlayerGuidance = {
  useWhen: [
    "The user wants you to put something on, or asks what to play for a moment or a mood (dinner, a party, winding down), and you have a few albums from their music app to offer.",
    "The user would rather pick by feel from a handful of albums than read a list.",
  ],
  avoidWhen: [
    "The user asks what's playing now, or wants to control playback on their music app (skip, shuffle, seek). Use the music player.",
    "You'd offer single tracks or build a playlist. Use the music player.",
    "You don't have the albums from the user's music provider. Never invent albums, artwork or preview URLs.",
    "There's only one album to offer. Say it in text, or play it.",
  ],
  rules: [
    "Pass albums, artwork and previewUrl exactly as the provider returns them. Put the one you'd suggest first.",
    "Each disc the user puts in returns 'play' with its albumId, and its preview plays in the chat. Start the full album on the user's device only when they asked you to play it there.",
    "'pause' means the user stopped the disc; pause the device if you started it there.",
    "Set nowPlayingId only when the provider reports that album playing.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(cdPlayerSchema)`.
 */
export const cdPlayerTool = {
  name: "show_cd_player",
  description: [
    "Show a few albums from the user's music app as CDs under a player. The user drops one in to play it.",
    `Use when: ${cdPlayerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${cdPlayerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${cdPlayerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: cdPlayerSchema,
} as const
