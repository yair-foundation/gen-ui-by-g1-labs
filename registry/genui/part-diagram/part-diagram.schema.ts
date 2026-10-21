import { z } from "zod"

import { isValidPathD, PATH_D_CHARS, PATH_D_MAX } from "./part-diagram-utils"

/**
 * Part Diagram: the agent's contract.
 *
 * An exploded view of an object or system: line-art parts grouped into
 * systems. The user drags a slider to pull the parts apart, picks a system
 * to highlight it, and reads a short explanation of that system.
 */

const shapeStyle = {
  strokeWidth: z
    .number()
    .min(0.25)
    .max(6)
    .optional()
    .describe(
      "Line weight in screen pixels. Default 1.5; use 2.5–3 for tires or main tubes, 0.75 for spokes.",
    ),
  fill: z
    .boolean()
    .optional()
    .describe(
      "Adds a light tint inside closed shapes, e.g. a saddle or a keycap.",
    ),
}

export const partShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("circle"),
    cx: z.number(),
    cy: z.number(),
    r: z.number().positive(),
    ...shapeStyle,
  }),
  z.object({
    type: z.literal("rect"),
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    rx: z.number().nonnegative().optional(),
    ...shapeStyle,
  }),
  z.object({
    type: z.literal("line"),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
    ...shapeStyle,
  }),
  z.object({
    type: z.literal("polyline"),
    points: z
      .array(z.tuple([z.number(), z.number()]))
      .min(2)
      .describe("[x, y] pairs. Repeat the first point to close the outline."),
    ...shapeStyle,
  }),
  z.object({
    type: z.literal("path"),
    d: z
      .string()
      .max(PATH_D_MAX)
      .regex(PATH_D_CHARS)
      .refine(
        isValidPathD,
        "Only SVG path commands (M L H V C S Q T A Z) and numbers.",
      )
      .describe(
        "SVG path data: commands M L H V C S Q T A Z (and lowercase) and numbers only. Anything else is rejected.",
      ),
    ...shapeStyle,
  }),
])

export const diagramSystemSchema = z.object({
  id: z
    .string()
    .describe("Stable id, used by parts and returned in the result."),
  label: z.string().max(24).describe("Chip label, e.g. 'Drivetrain'."),
  summary: z
    .string()
    .max(200)
    .describe(
      "One or two sentences on what this system does, shown when it's selected.",
    ),
})

export const diagramPartSchema = z.object({
  id: z.string().describe("Stable id, returned in the result."),
  label: z
    .string()
    .max(32)
    .describe("Shown on hover and focus, e.g. 'Rear derailleur'."),
  system: z.string().describe("The id of the system this part belongs to."),
  shapes: z
    .array(partShapeSchema)
    .min(1)
    .max(12)
    .describe(
      "Line art for the part, in viewBox units, drawn where it sits when assembled.",
    ),
  explode: z
    .object({ dx: z.number(), dy: z.number() })
    .describe(
      "Where the part moves at full explode, in viewBox units. Point it away from the centre of the object; stacked parts use dy only.",
    ),
  labelAt: z
    .object({ x: z.number(), y: z.number() })
    .optional()
    .describe(
      "Where the label points, assembled. Defaults to the centre of the part.",
    ),
})

export const partDiagramSchema = z.object({
  title: z.string().describe("The object, e.g. '7-speed bicycle'."),
  viewBox: z
    .object({ width: z.number().positive(), height: z.number().positive() })
    .optional()
    .describe(
      "Drawing coordinates. Default 400 × 260. Leave room around the object for the exploded parts.",
    ),
  systems: z
    .array(diagramSystemSchema)
    .min(2)
    .max(8)
    .describe(
      "The systems the parts group into, in reading order. Each becomes a filter chip.",
    ),
  parts: z
    .array(diagramPartSchema)
    .min(2)
    .max(40)
    .describe("Every part, drawn in order (later parts on top)."),
  overview: z
    .object({
      heading: z.string().max(48),
      summary: z
        .string()
        .max(200)
        .describe("One or two sentences, 200 characters at most."),
    })
    .optional()
    .describe(
      "Shown while 'All' is selected, e.g. 'Five connected systems' and how they work together.",
    ),
  askable: z
    .boolean()
    .default(false)
    .describe(
      "Adds 'Ask about this' so the user can ask you to explain a part or system. Leave off for display only.",
    ),
})

export type PartShape = z.infer<typeof partShapeSchema>
export type DiagramSystem = z.infer<typeof diagramSystemSchema>
export type DiagramPart = z.infer<typeof diagramPartSchema>
export type PartDiagramInput = z.input<typeof partDiagramSchema>

/** Sent back when the user asks about a part or a system (only when askable). */
export type PartDiagramResult =
  /** Explain this part: what it does and how it connects. */
  | { action: "explain"; partId: string }
  /** Explain this system in more depth. */
  | { action: "explain"; systemId: string }

/** Usage guidance the agent reads before choosing this component. */
export const partDiagramGuidance = {
  useWhen: [
    "The user asks how a physical object or machine is built or works: 'break down a bike', 'how does a coffee grinder work?', 'parts of a keyboard'.",
    "The answer is parts and how they group into systems, and seeing them in place helps.",
  ],
  avoidWhen: [
    "The parts are abstract (software services, teams). Use a relationship graph.",
    "Steps in order matter more than parts. Use a timeline or steps.",
    "How it moves matters more than what it's made of. Use show_mechanism.",
    "You can't draw it recognisably with simple lines and circles. Use a list.",
  ],
  rules: [
    "Draw simple, recognisable line art: circles, rects, lines and polylines; paths only for curves.",
    "Draw every part where it sits assembled, inside the viewBox, and leave margin for the exploded positions.",
    "Explode vectors point outward from the object's centre so parts don't land on each other; stacked objects explode along dy.",
    "Use 2 to 8 systems and give every part one. Keep labels short and summaries to one or two plain sentences.",
    "Set overview for the 'All' view: a short heading and how the systems work together.",
    "Only set askable when you'll follow up; on 'explain', explain that part or system.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(partDiagramSchema)`.
 */
export const partDiagramTool = {
  name: "show_part_diagram",
  description: [
    "Show an interactive exploded view that breaks an object into its parts, grouped into systems the user can highlight.",
    `Use when: ${partDiagramGuidance.useWhen.join(" ")}`,
    `Avoid when: ${partDiagramGuidance.avoidWhen.join(" ")}`,
    `Rules: ${partDiagramGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: partDiagramSchema,
} as const
