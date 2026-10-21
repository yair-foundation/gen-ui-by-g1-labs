import { z } from "zod";

/**
 * Inline Editor: the agent's contract.
 *
 * Generated output the user edits in place: text section by section, or
 * structured fields. They can also ask you to rework one section or one
 * passage instead of asking for a whole new draft.
 */

export const inlineEditorSectionSchema = z.object({
  id: z
    .string()
    .describe(
      "Stable identifier. Returned in the result; keep it on rewrites.",
    ),
  heading: z
    .string()
    .optional()
    .describe("Optional section heading, e.g. 'Experience'. Not editable."),
  text: z
    .string()
    .describe(
      "Plain text with simple markdown: **bold**, *italic*, and lists as lines starting with '- '. Blank lines separate paragraphs.",
    ),
});

export const inlineEditorFieldValueSchema = z.union([
  z.string(),
  z.number(),
  z.array(z.string()),
  z.null(),
]);

export const inlineEditorFieldSchema = z.object({
  id: z.string().describe("Stable identifier. Key in the result's `fields`."),
  label: z.string().describe("e.g. 'Tagline'."),
  type: z
    .enum(["text", "textarea", "number", "select", "tags"])
    .describe("Controls the input."),
  value: inlineEditorFieldValueSchema.describe(
    "The generated value: a string (text, textarea, select), a number or null (number), or a string array (tags).",
  ),
  options: z
    .array(z.string())
    .optional()
    .describe(
      "Required for 'select'. For 'tags', suggestions the user can pick from.",
    ),
  maxLength: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Characters for text and textarea; number of tags for tags. A counter appears near the limit.",
    ),
  required: z.boolean().optional(),
  help: z
    .string()
    .optional()
    .describe(
      "One short line on the field, e.g. 'Used in search results'. Screen readers only.",
    ),
});

export const inlineEditorSchema = z
  .object({
    title: z
      .string()
      .describe("What is being edited, e.g. 'Cover letter: Product designer'."),
    mode: z
      .enum(["text", "fields"])
      .describe(
        "'text': a document in sections. 'fields': structured values, e.g. a product listing.",
      ),
    sections: z
      .array(inlineEditorSectionSchema)
      .min(1)
      .max(20)
      .optional()
      .describe("Text mode. The document, in reading order."),
    fields: z
      .array(inlineEditorFieldSchema)
      .min(1)
      .max(30)
      .optional()
      .describe("Fields mode. In form order."),
    allowAiRewrite: z
      .boolean()
      .default(true)
      .describe(
        "Text mode: lets the user ask you to rewrite a section or a selected passage.",
      ),
    instructions: z
      .array(z.string().max(32))
      .max(6)
      .optional()
      .describe(
        "Quick rewrite buttons in the rewrite panel, e.g. ['Shorter', 'More confident', 'Fix grammar']. Default: Shorter, More formal, Fix grammar.",
      ),
    focusSectionId: z
      .string()
      .optional()
      .describe(
        "Text mode: a section to highlight with its rewrite panel open, when the user asked to change only that part.",
      ),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "text" && !v.sections?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["sections"],
        message: "Text mode needs sections.",
      });
    }
    if (v.mode === "fields" && !v.fields?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: "Fields mode needs fields.",
      });
    }
  });

export type InlineEditorSection = z.infer<typeof inlineEditorSectionSchema>;
export type InlineEditorField = z.infer<typeof inlineEditorFieldSchema>;
export type InlineEditorFieldValue = z.infer<
  typeof inlineEditorFieldValueSchema
>;
export type InlineEditorInput = z.input<typeof inlineEditorSchema>;

/** What the component sends back to the agent. A closed set of actions. */
export type InlineEditorResult =
  | {
      action: "save";
      /** Text mode: every section with its final text, in order. */
      sections?: { id: string; text: string }[];
      /** Fields mode: every field's final value, by id. */
      fields?: Record<string, InlineEditorFieldValue>;
      /** Ids of the sections or fields the user changed. */
      edited: string[];
    }
  | {
      /** Rework one section, or one passage of it. Nothing is locked. */
      action: "rewrite";
      sectionId: string;
      /** The section's current text (with the user's edits): what `selection` indexes into. */
      text: string;
      /** The passage to rework: offsets into `text`, end exclusive. Markdown markers stay balanced. */
      selection?: { start: number; end: number; text: string };
      instruction: string;
      /** Sections the user has edited so far, so a new call can keep them. */
      edits: { id: string; text: string }[];
    }
  | { action: "discard" };

/** Usage guidance the agent reads before choosing this component. */
export const inlineEditorGuidance = {
  useWhen: [
    "The user wants to tweak something you generated (a cover letter, an announcement, a product listing) rather than get a whole new draft.",
    "The user asks to change only one part: 'rewrite only the second paragraph', 'fix the tagline'.",
    "The output is long enough that small edits beat regenerating it.",
  ],
  avoidWhen: [
    "The user wants alternatives to choose from. Use draft options.",
    "The text is a sentence or two. Offer drafts or just rewrite it.",
    "You are proposing changes to a live record in another system. Use a change preview with before/after values.",
    "You need new input the user hasn't given yet. Use a form.",
  ],
  rules: [
    "Split text into sections the user would edit separately: paragraphs, or headed sections. Keep ids stable across calls.",
    "Use only **bold**, *italic* and '- ' lists in section text.",
    "Set focusSectionId when the user named the part to change.",
    "On 'rewrite', change only that section (only the selection, when given) and follow the instruction. Keep every other section, including the user's `edits`, exactly as it is.",
    "On 'save', use the returned text and values verbatim. On 'discard', keep the previous version.",
  ],
} as const;

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(inlineEditorSchema)`.
 */
export const inlineEditorTool = {
  name: "edit_output",
  description: [
    "Let the user edit generated output in place, section by section or field by field, and ask you to rework one part.",
    `Use when: ${inlineEditorGuidance.useWhen.join(" ")}`,
    `Avoid when: ${inlineEditorGuidance.avoidWhen.join(" ")}`,
    `Rules: ${inlineEditorGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: inlineEditorSchema,
} as const;
