import { z } from "zod"

/**
 * Design Review: the agent's contract.
 *
 * An AI proposes a change to a design system (a rule, a component, a token,
 * a pattern or an artifact). A product designer reviews it before it enters
 * the system: approve it, decline it, or send it back with changes. Facts
 * marked DATA-BOUND must come from tool results (real counts, real check
 * results), never from model free text.
 */

/** What is being proposed. Shown as a badge beside the title. */
export const designReviewKinds = [
  "rule",
  "component",
  "pattern",
  "token",
  "artifact",
  "flow",
] as const

export type DesignReviewKind = (typeof designReviewKinds)[number]

export const designReviewSwatchSchema = z.object({
  name: z.string().describe("Token or role, e.g. 'border' or 'card'."),
  value: z
    .string()
    .describe("A CSS colour: hex (#2b2b2b), rgb(), hsl() or oklch()."),
})

/** One side of the comparison: words, a picture, or colour swatches. */
export const designReviewPaneSchema = z.object({
  text: z
    .string()
    .optional()
    .describe(
      "The rule text or spec. One item per line; lines starting with '- ' render as a list.",
    ),
  image: z
    .object({
      src: z
        .string()
        .describe("https URL or a same-site path like /img/a.png."),
      alt: z.string().describe("What the picture shows."),
    })
    .optional()
    .describe("A rendering or screenshot of the design."),
  swatches: z
    .array(designReviewSwatchSchema)
    .max(8)
    .optional()
    .describe("For token changes: the colours, by name."),
})

export const designReviewCheckSchema = z.object({
  label: z.string().describe("The check, e.g. 'Contrast AA in dark mode'."),
  status: z
    .enum(["pass", "warn", "fail"])
    .describe("DATA-BOUND. The real result of running the check."),
  detail: z
    .string()
    .optional()
    .describe("One short qualifier, e.g. '6 scenarios over 640px'."),
})

export const designReviewEvidenceSchema = z.object({
  title: z
    .string()
    .describe("Why this change, e.g. a review comment or an audit finding."),
  source: z
    .string()
    .optional()
    .describe("Where it came from, e.g. 'Design review, Oct 13'."),
  url: z.string().optional().describe("Link to the comment or report (https)."),
})

export const designReviewSchema = z.object({
  kind: z.enum(designReviewKinds).describe("What is being proposed."),
  title: z.string().describe("The change in a few words: 'No hollow badges'."),
  summary: z
    .string()
    .optional()
    .describe("One sentence on what changes and why. Shown under the title."),
  proposedBy: z
    .string()
    .optional()
    .describe("Who proposed it, e.g. 'Design agent'."),
  basis: z
    .string()
    .optional()
    .describe("What it is based on, e.g. 'From 14 review comments'."),
  proposedAt: z
    .string()
    .optional()
    .describe("ISO 8601 date the proposal was made."),
  risk: z
    .enum(["low", "medium", "high"])
    .optional()
    .describe(
      "How disruptive approving is: 'high' when it changes many components or shipped work.",
    ),
  current: designReviewPaneSchema
    .optional()
    .describe("What the system has today. Leave out for something new."),
  proposed: designReviewPaneSchema.describe("What the AI proposes."),
  checks: z
    .array(designReviewCheckSchema)
    .max(6)
    .optional()
    .describe("DATA-BOUND. Automated checks run on the proposal."),
  evidence: z
    .array(designReviewEvidenceSchema)
    .max(5)
    .optional()
    .describe("The comments, audits or research the proposal is based on."),
  editable: z
    .boolean()
    .optional()
    .describe(
      "Let the reviewer edit the proposed text directly when asking for changes. Default: true when the proposal has text.",
    ),
})

export type DesignReviewPane = z.infer<typeof designReviewPaneSchema>
export type DesignReviewCheck = z.infer<typeof designReviewCheckSchema>
export type DesignReviewEvidence = z.infer<typeof designReviewEvidenceSchema>
export type DesignReviewInput = z.input<typeof designReviewSchema>

/** What the component sends back to the agent. A closed set of decisions. */
export type DesignReviewResult =
  /** Add the proposal to the system as it is. */
  (
    | { action: "approve" }
    /** Drop the proposal. */
    | { action: "decline"; reason?: string }
    /**
     * Send it back. `feedback` says what to change; `proposal` is the reviewer's
     * own edit of the proposed text, when they made one.
     */
    | { action: "modify"; feedback: string; proposal?: string }
  ) & {
    /** When the reviewer decided (ISO 8601). For the record shown in the card. */
    decidedAt?: string
  }

/** Usage guidance the agent reads before choosing this component. */
export const designReviewGuidance = {
  useWhen: [
    "You produced a design-system change (a rule, component, token, pattern or artifact) and a designer must review it before it becomes part of the system.",
    "There is a before and after worth comparing, or a new thing worth seeing before it ships.",
  ],
  avoidWhen: [
    "The change is not to a design system or design artifact. Use the approval request or change preview.",
    "You have not run the checks yet. Run them first and report the real results.",
    "You only want an opinion on options. Use draft options.",
  ],
  rules: [
    "Wait for the result. Never add the change to the system before action 'approve'.",
    "On 'modify', apply the feedback (and the reviewer's own text in `proposal`, if any) and propose again with a new review.",
    "On 'decline', stop and do not re-propose the same change unless asked.",
    "Report checks from tool results; a failing check must be shown, not hidden.",
    "Keep the title short; put the full rule or spec in `proposed.text`.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(designReviewSchema)`.
 */
export const designReviewTool = {
  name: "review_design_change",
  description: [
    "Ask a designer to review a proposed design-system change (rule, component, token, pattern or artifact): compare now and proposed in a table, see checks and evidence, then approve, decline or send it back with changes.",
    `Use when: ${designReviewGuidance.useWhen.join(" ")}`,
    `Avoid when: ${designReviewGuidance.avoidWhen.join(" ")}`,
    `Rules: ${designReviewGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: designReviewSchema,
} as const
