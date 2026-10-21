import { z } from "zod"

/**
 * Social Post: the agent's contract.
 *
 * Two jobs, chosen by `mode`:
 * - "posts": real posts you found (mentions, a competitor's launch, top
 *   posts), shown in a neutral feed. Display-only.
 * - "draft": a post you wrote for one or more networks, previewed so the user
 *   can edit and approve it before anything is published or scheduled.
 *
 * Networks are generic: shown by name with a neutral icon, never a logo.
 * Fields marked DATA-BOUND must come from a tool result, never from model
 * free text.
 */

export const socialNetworkSchema = z.object({
  id: z.string().describe("e.g. 'x'."),
  name: z.string().describe("e.g. 'LinkedIn'."),
  kind: z
    .enum(["short", "professional", "photo", "video", "community", "other"])
    .optional(),
  maxChars: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Characters per post."),
  linkLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Fixed length each link counts as, e.g. 23."),
  supportsThreads: z.boolean().optional(),
  maxImages: z.number().int().positive().optional(),
})

export const socialAccountSchema = z.object({
  name: z.string().describe("DATA-BOUND."),
  handle: z.string().describe("DATA-BOUND. e.g. '@acme'."),
})

export const socialMediaSchema = z.object({
  src: z.string().describe("DATA-BOUND. http(s), same-origin path (\"/...\") or data:image URI."),
  alt: z.string().describe("Alt text. Empty string when unknown."),
})

export const socialAuthorSchema = z.object({
  name: z.string().describe("DATA-BOUND."),
  handle: z.string().describe("DATA-BOUND. e.g. '@rinabuilds'."),
  verified: z.boolean().optional().describe("DATA-BOUND."),
})

export const socialFoundPostSchema = z.object({
  id: z.string().describe("DATA-BOUND."),
  network: z.string().describe("A `networks` id."),
  author: socialAuthorSchema,
  text: z.string().describe("DATA-BOUND. Verbatim, plain text."),
  postedAt: z.string().describe("DATA-BOUND. ISO 8601 with offset."),
  media: z.array(socialMediaSchema).max(4).optional().describe("DATA-BOUND."),
  stats: z
    .object({
      likes: z.number().int().min(0).optional(),
      replies: z.number().int().min(0).optional(),
      reposts: z.number().int().min(0).optional(),
      views: z.number().int().min(0).optional(),
    })
    .optional()
    .describe("DATA-BOUND."),
  url: z.string().optional().describe("DATA-BOUND. http(s)."),
  sentiment: z
    .enum(["positive", "neutral", "negative"])
    .optional()
    .describe("DATA-BOUND. From the source, never your guess."),
})

export const socialVariantSchema = z.object({
  networkId: z.string().describe("A `networks` id."),
  text: z.string().describe("Plain text."),
  thread: z
    .array(z.string())
    .max(24)
    .optional()
    .describe("Follow-up posts. Only where threads are allowed."),
  media: z
    .array(socialMediaSchema)
    .max(10)
    .optional()
    .describe("Only files the user gave you."),
  hashtags: z
    .array(z.string())
    .max(10)
    .optional()
    .describe("Without spaces, e.g. 'webinar'."),
  link: z.string().optional().describe("http(s)."),
})

export const socialDraftSchema = z.object({
  variants: z
    .array(socialVariantSchema)
    .min(1)
    .max(6)
    .describe("One per network, fitted to its audience and limit."),
  scheduleAt: z
    .string()
    .optional()
    .describe("Only when the user asked for a time. Omit: post now."),
  timeZone: z.string().optional().describe("IANA. Default: the viewer's."),
})

export const socialBestTimeSchema = z.object({
  networkId: z.string(),
  at: z.string().describe("DATA-BOUND. ISO 8601 with offset."),
  reason: z
    .string()
    .max(40)
    .optional()
    .describe("e.g. 'highest engagement'. Tooltip."),
})

export const socialPostSchema = z
  .object({
    mode: z
      .enum(["posts", "draft"])
      .describe(
        "'posts': posts you found. 'draft': a post you wrote, for approval.",
      ),
    title: z.string().optional().describe("e.g. 'Webinar announcement'."),
    networks: z
      .array(socialNetworkSchema)
      .max(10)
      .optional()
      .describe("Every network referenced by posts or variants."),
    account: socialAccountSchema
      .optional()
      .describe("DATA-BOUND. The posting account."),
    posts: z
      .array(socialFoundPostSchema)
      .max(30)
      .optional()
      .describe("DATA-BOUND. Required in 'posts' mode."),
    summary: z
      .string()
      .optional()
      .describe("'posts' mode: one sentence across the posts."),
    draft: socialDraftSchema.optional().describe("Required in 'draft' mode."),
    bestTimes: z
      .array(socialBestTimeSchema)
      .max(6)
      .optional()
      .describe("DATA-BOUND. From an analytics tool."),
    approvalRequired: z
      .boolean()
      .optional()
      .describe("A teammate signs off before posting."),
  })
  .superRefine((value, ctx) => {
    if (value.mode === "posts" && !value.posts?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["posts"],
        message: "'posts' mode needs at least one post.",
      })
    }
    if (value.mode === "draft" && !value.draft) {
      ctx.addIssue({
        code: "custom",
        path: ["draft"],
        message: "'draft' mode needs a draft.",
      })
    }
  })

export type SocialNetwork = z.infer<typeof socialNetworkSchema>
export type SocialAccount = z.infer<typeof socialAccountSchema>
export type SocialMedia = z.infer<typeof socialMediaSchema>
export type SocialAuthor = z.infer<typeof socialAuthorSchema>
export type SocialFoundPost = z.infer<typeof socialFoundPostSchema>
export type SocialVariant = z.infer<typeof socialVariantSchema>
export type SocialDraft = z.infer<typeof socialDraftSchema>
export type SocialBestTime = z.infer<typeof socialBestTimeSchema>
export type SocialPostInput = z.input<typeof socialPostSchema>

/** What the component sends back, in 'draft' mode only. A closed set. */
export type SocialPostResult =
  /**
   * Publish exactly these posts. `text` is the full first post (hashtags and
   * link included); `thread` holds the follow-ups. `when` is "now" or an ISO
   * time with offset. `edited` is true when the user changed anything.
   */
  | {
      action: "approve"
      variants: {
        networkId: string
        text: string
        thread?: string[]
        media?: SocialMedia[]
      }[]
      when: "now" | string
      edited: boolean
    }
  /** The user wants a different draft. Rewrite it and show it again. */
  | { action: "revise"; feedback: string }
  /** Drop the draft. Publish nothing. */
  | { action: "discard" }

/** Usage guidance the agent reads before choosing this component. */
export const socialPostGuidance = {
  useWhen: [
    "posts: the user asks what people are saying, or to see specific posts: mentions, a competitor's launch post, top posts this week.",
    "draft: the user asks you to write, announce, cross-post or schedule a social post. Show it for review before anything is published.",
  ],
  avoidWhen: [
    "You couldn't fetch the posts. Never invent posts, authors or numbers.",
    "The user wants metrics over time, not posts. Use a chart or KPI card.",
    "The text isn't for a social network (an email, a blog post). Use the matching component.",
  ],
  rules: [
    "posts: pass text, authors, stats and times verbatim from the source. Set sentiment only from the source's analysis.",
    "posts: keep summary to one sentence that reflects only the posts shown.",
    "draft: write one variant per network, within its maxChars where you can. Use thread for longer stories only where supportsThreads is true.",
    "draft: give every image real alt text. Use an empty string if you can't describe it, so the user is asked.",
    "draft: set scheduleAt only when the user asked for a time; bestTimes must come from an analytics tool.",
    "Never publish or schedule until you receive action 'approve', then publish exactly the returned variants at the returned time through the host's integration.",
    "On 'revise', publish nothing: rewrite from the feedback and show a new draft. On 'discard', publish nothing.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(socialPostSchema)`.
 */
export const socialPostTool = {
  name: "show_social_post",
  description: [
    "Show social posts you found in a neutral feed, or preview a post you drafted for one or more networks so the user can edit, schedule and approve it before anything is published.",
    `Use when: ${socialPostGuidance.useWhen.join(" ")}`,
    `Avoid when: ${socialPostGuidance.avoidWhen.join(" ")}`,
    `Rules: ${socialPostGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: socialPostSchema,
} as const
