import { z } from "zod"

/**
 * Audio Player: the agent's contract.
 *
 * Playback for a recording the agent found or produced, with a waveform,
 * markers and an optional transcript. The audio, its waveform and its
 * transcript come from tools, never from the model.
 */

/** The kinds of recording the title icon may show. */
export const audioKinds = [
  "call",
  "voice-note",
  "voiceover",
  "podcast",
  "other",
] as const

export type AudioKind = (typeof audioKinds)[number]

export const audioMarkerSchema = z.object({
  at: z.number().min(0).describe("Position in seconds."),
  label: z
    .string()
    .max(40)
    .describe("What happens there, e.g. 'Pricing agreed'."),
})

export const audioSegmentSchema = z.object({
  start: z.number().min(0).describe("Start in seconds."),
  end: z.number().min(0).describe("End in seconds."),
  speaker: z.string().max(40).optional().describe("e.g. 'Dana Levi'."),
  text: z.string().describe("What was said."),
})

export const audioSpeakerSchema = z.object({
  name: z.string().max(40).describe("Exactly as it appears in the segments."),
  avatar: z
    .string()
    .optional()
    .describe(
      "DATA-BOUND. A photo of the speaker: http(s), a same-origin path starting with a single slash, or data:image. Initials show when it is missing or fails.",
    ),
})

export const audioPlayerSchema = z.object({
  kind: z
    .enum(audioKinds)
    .optional()
    .describe(
      "What the recording is: call, voice-note, voiceover, podcast or other. Shown as a coloured icon beside the title. Omit when none fits.",
    ),
  title: z
    .string()
    .describe("What the recording is, e.g. 'Call with Northwind'."),
  subtitle: z
    .string()
    .optional()
    .describe("Context in a few words, e.g. 'Sales call · Oct 6'."),
  src: z
    .string()
    .describe(
      "DATA-BOUND. The audio URL from a tool result: http(s), or a blob:/data:audio URL for audio the host generated.",
    ),
  durationSeconds: z
    .number()
    .positive()
    .describe("DATA-BOUND. Length of the recording in seconds."),
  peaks: z
    .array(z.number().min(0).max(1))
    .min(64)
    .max(400)
    .optional()
    .describe(
      "DATA-BOUND. Waveform loudness, 0–1, precomputed by the host's audio tool. Drawn only for kind 'voice-note'; leave it out for other recordings. Never invent peaks.",
    ),
  markers: z
    .array(audioMarkerSchema)
    .max(20)
    .optional()
    .describe("Moments worth jumping to, with a short label."),
  speakers: z
    .array(audioSpeakerSchema)
    .max(8)
    .optional()
    .describe("Photos for the people in the transcript, matched by name."),
  segments: z
    .array(audioSegmentSchema)
    .max(500)
    .optional()
    .describe(
      "DATA-BOUND. The transcript, in order, from a transcription tool.",
    ),
  startAt: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Start of the part to play, in seconds. With endAt, plays only that clip and highlights it.",
    ),
  endAt: z
    .number()
    .min(0)
    .optional()
    .describe("End of the part to play, in seconds. Playback stops here."),
  downloadable: z
    .boolean()
    .default(false)
    .describe("Offer a download link. Only when the user may keep the file."),
})

export type AudioMarker = z.infer<typeof audioMarkerSchema>
export type AudioSpeaker = z.infer<typeof audioSpeakerSchema>
export type AudioSegment = z.infer<typeof audioSegmentSchema>
export type AudioPlayerInput = z.input<typeof audioPlayerSchema>

/** Usage guidance the agent reads before choosing this component. */
export const audioPlayerGuidance = {
  useWhen: [
    "You found or produced a recording the user should hear: a voice note, a call recording, a podcast clip, a generated voiceover.",
    "The user asks to play a specific part of a recording. Set startAt and endAt to that part.",
  ],
  avoidWhen: [
    "You don't have a real audio URL from a tool, or (for a voice note) its precomputed peaks. Never invent them.",
    "The user only needs what was said. Quote or summarize the transcript in text.",
    "It's a video. Use a video player.",
  ],
  rules: [
    "src, durationSeconds, peaks and segments must come from tool results. Peaks are only for kind 'voice-note', which shows a waveform.",
    "For 'the part where…', set startAt/endAt to the matching transcript segments and add a marker at the key moment.",
    "Keep marker labels to a few words.",
    "Only set downloadable when the user may keep the file.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(audioPlayerSchema)`.
 */
export const audioPlayerTool = {
  name: "show_audio",
  description: [
    "Play a recording with a waveform, markers and an optional transcript, or just one clip of it.",
    `Use when: ${audioPlayerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${audioPlayerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${audioPlayerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: audioPlayerSchema,
} as const
