import { z } from "zod"

/**
 * Relationship Explorer: the agent's contract.
 *
 * Nodes and the links between them, laid out as a tree (hierarchies), a flow
 * (dependencies, cause and effect) or a network (connections). The user pans,
 * zooms and selects a node to see what it connects to.
 */

export const relationshipEdgeKinds = [
  "depends-on",
  "reports-to",
  "causes",
  "related",
  "blocks",
] as const

export const relationshipHealthValues = [
  "ok",
  "warning",
  "critical",
  "unknown",
] as const

export const relationshipNodeSchema = z.object({
  id: z
    .string()
    .describe("Stable identifier, used by edges. Returned in the result."),
  label: z
    .string()
    .describe("DATA-BOUND. The name, e.g. 'Auth service' or 'Dana Reyes'."),
  sublabel: z
    .string()
    .optional()
    .describe("DATA-BOUND. One short line, e.g. a job title or owner team."),
  kind: z
    .string()
    .max(24)
    .optional()
    .describe(
      "A free-text category shown on the node, e.g. 'service', 'team', 'cause'.",
    ),
  health: z
    .enum(relationshipHealthValues)
    .optional()
    .describe(
      "DATA-BOUND. Current health, shown as an icon and a word. Only set it when it comes from a tool result.",
    ),
  detail: z
    .string()
    .max(400)
    .optional()
    .describe("DATA-BOUND. A sentence or two shown when the node is selected."),
  url: z
    .string()
    .optional()
    .describe("DATA-BOUND. An http(s) link to the record, shown as 'Open'."),
})

export const relationshipEdgeSchema = z.object({
  from: z.string().describe("Node id the link starts at."),
  to: z.string().describe("Node id the link points to."),
  label: z
    .string()
    .max(48)
    .optional()
    .describe(
      "DATA-BOUND. Short text on the link, e.g. '+38% checkout errors'.",
    ),
  kind: z
    .enum(relationshipEdgeKinds)
    .optional()
    .describe(
      "'depends-on': from depends on to. 'reports-to': from reports to to (to is the manager). 'causes': from causes to. 'blocks': from blocks to. 'related': no direction. Omit for a plain arrow.",
    ),
  strength: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe("DATA-BOUND. 0–1; stronger links are drawn thicker."),
})

export const relationshipExplorerSchema = z.object({
  title: z.string().optional().describe("e.g. 'Services that depend on auth'."),
  layout: z
    .enum(["tree", "flow", "network"])
    .describe(
      "'tree': a hierarchy with one parent per node (org charts, folders). 'flow': a directed graph left to right (dependencies, cause and effect, pipelines). 'network': connections without a direction (up to 40 nodes).",
    ),
  nodes: z
    .array(relationshipNodeSchema)
    .min(1)
    .max(60)
    .describe("DATA-BOUND. Every node, from a tool result."),
  edges: z
    .array(relationshipEdgeSchema)
    .max(200)
    .describe(
      "DATA-BOUND. Links between node ids. Unknown ids are listed under the graph.",
    ),
  rootId: z
    .string()
    .optional()
    .describe(
      "Tree: the node at the top. Flow: where to start reading, which decides which link in a loop is drawn backwards.",
    ),
  focusId: z
    .string()
    .optional()
    .describe("The node selected at first, e.g. the one the user asked about."),
  direction: z
    .enum(["down", "right"])
    .optional()
    .describe(
      "Tree and flow: which way the graph grows. Omit it: trees and flows grow right, and a flow in a narrow card switches to down when that shows it larger.",
    ),
  selectable: z
    .boolean()
    .default(false)
    .describe(
      "Lets the user send a node back: 'Choose' or 'Explain this'. Leave off for display only.",
    ),
})

export type RelationshipNode = z.infer<typeof relationshipNodeSchema>
export type RelationshipEdge = z.infer<typeof relationshipEdgeSchema>
export type RelationshipEdgeKind = (typeof relationshipEdgeKinds)[number]
export type RelationshipHealth = (typeof relationshipHealthValues)[number]
export type RelationshipExplorerInput = z.input<
  typeof relationshipExplorerSchema
>

/** Sent back when the user chooses a node or asks about it (only when selectable). */
export type RelationshipExplorerResult =
  /** The user picked this node; act on it. */
  | { action: "select"; nodeId: string }
  /** The user wants you to explain this node and its links. */
  | { action: "explain"; nodeId: string }

/** Usage guidance the agent reads before choosing this component. */
export const relationshipExplorerGuidance = {
  useWhen: [
    "The answer is how things connect: an org chart, what depends on a service, what caused a metric to move, how companies or people are linked.",
    "There are more links than a sentence or a list can carry, roughly 5 to 60 nodes.",
  ],
  avoidWhen: [
    "Things happen in order over time. Use a timeline.",
    "It's a plain list or a ranking with no links between items. Use a list or a data table.",
    "There are only two or three nodes. Say it in a sentence.",
    "The links are guesses. Only draw relationships that come from data.",
  ],
  rules: [
    "Take nodes, links and health from tool results; never invent a link.",
    "Pick the layout for the shape: tree for one parent per node, flow for direction (dependencies, causes), network for undirected connections.",
    "Use edge kinds so arrows read right: 'depends-on' points at the dependency, 'reports-to' points at the manager, 'causes' points at the effect.",
    "Set focusId to the node the user asked about, and rootId to the top of a tree.",
    "Label cause-and-effect links with the evidence, e.g. '+38% errors'. Keep labels short.",
    "Only set selectable when the user's choice changes what you do next; on 'explain', explain that node and its links.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(relationshipExplorerSchema)`.
 */
export const relationshipExplorerTool = {
  name: "show_relationships",
  description: [
    "Show how things connect as an interactive graph: a hierarchy, dependencies, cause and effect, or a network.",
    `Use when: ${relationshipExplorerGuidance.useWhen.join(" ")}`,
    `Avoid when: ${relationshipExplorerGuidance.avoidWhen.join(" ")}`,
    `Rules: ${relationshipExplorerGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: relationshipExplorerSchema,
} as const
