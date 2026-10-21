import { z } from "zod"

/**
 * Music Player: the agent's contract.
 *
 * Music in the chat: what's playing on the user's music app, or a playlist
 * the agent built for them to review and save. Tracks, artwork, previews and
 * playback state come from the user's music provider, never from the model.
 */

export const musicTrackSchema = z.object({
  id: z
    .string()
    .describe("DATA-BOUND. The provider's track id. Returned in results."),
  title: z.string().describe("DATA-BOUND. Track title."),
  artists: z
    .array(z.string())
    .min(1)
    .describe("DATA-BOUND. Artist names, main artist first."),
  album: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. Album title. Screen readers and the cover's alt text.",
    ),
  durationSeconds: z
    .number()
    .positive()
    .describe("DATA-BOUND. Track length in seconds."),
  artwork: z
    .object({
      src: z.string().describe("http(s) URL, same-origin path (single leading '/') or data:image URL from the provider."),
      alt: z.string().describe("e.g. 'Cover of Slow Current'."),
    })
    .optional()
    .describe("DATA-BOUND. Album artwork."),
  previewUrl: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. A short preview clip (about 30 s) from the provider: http(s), blob: or data:audio. Played in the chat.",
    ),
  explicit: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. The provider marks the track explicit."),
  liked: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. The track is in the user's liked songs."),
  url: z
    .string()
    .optional()
    .describe("DATA-BOUND. http(s) link that opens the track in the provider."),
})

export const musicNowPlayingSchema = z.object({
  trackId: z
    .string()
    .describe("DATA-BOUND. Id of the track playing now (one of `tracks`)."),
  positionSeconds: z
    .number()
    .min(0)
    .optional()
    .describe("DATA-BOUND. Playback position reported by the provider."),
  isPlaying: z
    .boolean()
    .optional()
    .describe("DATA-BOUND. Playing (true) or paused (false)."),
  device: z
    .string()
    .max(40)
    .optional()
    .describe("DATA-BOUND. Where it plays, e.g. 'Kitchen speaker'."),
  shuffle: z.boolean().optional().describe("DATA-BOUND. Shuffle is on."),
  repeat: z
    .enum(["off", "all", "one"])
    .optional()
    .describe("DATA-BOUND. The provider's repeat setting."),
})

export const musicPlayerSchema = z.object({
  mode: z
    .enum(["now-playing", "playlist"])
    .describe(
      "'now-playing': what the user's music app is playing, with remote controls. 'playlist': tracks you gathered for the user to review, reorder and save.",
    ),
  title: z
    .string()
    .optional()
    .describe("Playlist name, e.g. 'Deep focus'. Playlist mode."),
  description: z
    .string()
    .optional()
    .describe(
      "One line about the playlist, e.g. 'Instrumental, low tempo'. Screen readers only.",
    ),
  provider: z
    .object({
      name: z
        .string()
        .max(40)
        .describe("The user's music app, as text, e.g. 'Music app'."),
    })
    .optional()
    .describe("DATA-BOUND. The provider the tracks come from."),
  tracks: z
    .array(musicTrackSchema)
    .min(1)
    .max(50)
    .describe(
      "DATA-BOUND. From the provider's search or library, never invented. Now-playing: the current track and what's up next, in queue order. Playlist: in your proposed order.",
    ),
  nowPlaying: musicNowPlayingSchema
    .optional()
    .describe(
      "DATA-BOUND. Playback state reported by the provider. Now-playing mode.",
    ),
  editable: z
    .boolean()
    .default(true)
    .describe(
      "Playlist mode: the user may reorder and remove tracks before saving.",
    ),
  totalDurationSeconds: z
    .number()
    .positive()
    .optional()
    .describe(
      "DATA-BOUND. Playlist length from the provider. Computed when absent.",
    ),
})

export type MusicTrack = z.infer<typeof musicTrackSchema>
export type MusicNowPlaying = z.infer<typeof musicNowPlayingSchema>
export type MusicPlayerInput = z.input<typeof musicPlayerSchema>

/** What the component sends back to the agent. A closed set of actions. */
export type MusicPlayerResult =
  // Now-playing: remote-control requests for the provider. Never locks.
  | {
      action:
        | "play"
        | "pause"
        | "next"
        | "previous"
        | "like"
        | "unlike"
        | "shuffle-on"
        | "shuffle-off"
      /** The track on screen when the control was used. */
      trackId: string
    }
  | { action: "repeat"; value: "off" | "all" | "one"; trackId: string }
  /** Sent once the user releases the progress slider. */
  | { action: "seek"; positionSeconds: number; trackId: string }
  // Playlist.
  | {
      action: "save-playlist"
      title: string
      /** Track ids in the user's final order. */
      trackIds: string[]
      /** Ids the user removed. */
      removed: string[]
    }
  | { action: "open-in-provider" }
  | { action: "dismiss" }

/** Usage guidance the agent reads before choosing this component. */
export const musicPlayerGuidance = {
  useWhen: [
    "The user asks what's playing, or to control playback on their music app: mode 'now-playing' with the provider's reported state.",
    "You built a playlist or found tracks to add to one: mode 'playlist', so the user can preview, reorder, remove and save.",
  ],
  avoidWhen: [
    "You don't have the tracks from the user's music provider. Never invent tracks, artwork or preview URLs.",
    "It's a recording, podcast clip or voice note. Use the audio player.",
    "The user only wants a name or two. Say them in text.",
  ],
  rules: [
    "Pass tracks, artwork, previewUrl, url and nowPlaying exactly as the provider returns them.",
    "Now-playing: put the current track first in tracks, then what's up next. Each control returns a request (play, pause, next, seek…); carry it out with the provider, then show the new state.",
    "Playlist: save nothing until you receive 'save-playlist', then save exactly trackIds in that order under that title.",
    "On 'open-in-provider', hand off to the user's music app; on 'dismiss', save nothing.",
    "Set provider.name to the app's name as plain text.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(musicPlayerSchema)`.
 */
export const musicPlayerTool = {
  name: "show_music",
  description: [
    "Show music from the user's music app: what's playing now, with remote controls, or a playlist to preview, reorder and save.",
    `Use when: ${musicPlayerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${musicPlayerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${musicPlayerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: musicPlayerSchema,
} as const
