import { toJSONSchema, type ZodType } from "zod"

import { bindsRule, refsRule, withRefs } from "./genui-context"

/*
 * Builds the system prompt and tool set for an agent from the components you
 * installed. Every component's schema file exports a tool and its guidance:
 *
 *   import { checklistGuidance, checklistTool } from "@/components/genui/checklist.schema"
 *   const { system, tools } = buildGenUIPrompt([
 *     { tool: checklistTool, guidance: checklistGuidance },
 *   ])
 *
 * The types are structural, so no component is imported here.
 */

export type GenUIGuidance = {
  readonly useWhen: readonly string[]
  readonly avoidWhen: readonly string[]
  readonly rules: readonly string[]
}

export type GenUIToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: ZodType
}

export type GenUIEntry = {
  readonly tool: GenUIToolDefinition
  readonly guidance: GenUIGuidance
  /** Optional, for `pickEntries`. */
  readonly meta?: {
    readonly category?: string
    readonly level?: string
    /**
     * What a visualisation is for, after the Data Viz Project's functions:
     * comparison, concept, correlation, distribution, geolocation,
     * part-to-whole, trend-over-time.
     */
    readonly functions?: readonly string[]
  }
}

export type GenUIPromptOptions = {
  /** Replace the generative-UI preamble, or `false` to leave it out. */
  preamble?: string | false
  /** "markdown" (default) uses headings and bullets; "plain" uses neither. */
  format?: "markdown" | "plain"
  /** Keep at most this many rules per tool. */
  maxRulesPerTool?: number
  /**
   * Tool descriptions repeat the guidance, which the system prompt already
   * carries. "short" (default) keeps only the first line, so you don't pay
   * for it twice. "full" keeps the description as written.
   */
  toolDescription?: "short" | "full"
  /**
   * Let the model point at tool-result values with `{ $ref }` instead of
   * retyping them: adds the rule to the preamble and lets every scalar field
   * of `jsonSchema` take a ref. Resolve with `resolveRefs` before validating.
   */
  refs?: boolean
  /**
   * Rewrite `jsonSchema` into the subset the Claude API accepts with
   * `strict: true` on a tool (the API then guarantees the input matches the
   * schema). Constraints strict mode can't express (lengths, ranges, item
   * counts, patterns) move into the field's description, and `validateGenUIInput`
   * still checks them. See `toStrictJSONSchema`.
   */
  strict?: boolean
}

export type GenUITool = {
  description: string
  /** The Zod schema, for the AI SDK `tool({ description, inputSchema })`. */
  inputSchema: ZodType
  /** JSON Schema, for other frameworks and provider APIs. */
  jsonSchema: Record<string, unknown>
}

export type GenUIPrompt = {
  system: string
  tools: Record<string, GenUITool>
}

export const defaultGenUIPreamble = [
  "You can show interface components by calling the tools below. Each call renders in the chat.",
  "- Answer in text when a sentence or two is enough. Show a component when the user needs to see, compare, choose, or act.",
  "- Never invent DATA-BOUND fields. Fill them only from tool results or what the user said. If you don't have the data, get it or ask.",
  "- One component per need. Don't repeat its content in text; a one-line lead-in is enough.",
  "- Use layout components (stack, grid, split, steps, tabs, columns) only to compose parts that belong together as one piece. A layout may hold one more layout, no deeper.",
  `- ${bindsRule}`,
  "- Actions are a closed set defined by each component. Don't promise anything a component can't do.",
].join("\n")

const guidanceLabel = /^(Use when|Avoid when|Rules):/

/** The description without the guidance lines the schema files append. */
export function shortDescription(description: string): string {
  const lines = description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !guidanceLabel.test(line))
  return lines.join(" ")
}

/** One tool's section of the system prompt. */
export function formatToolSection(
  entry: GenUIEntry,
  options: Pick<GenUIPromptOptions, "format" | "maxRulesPerTool"> = {},
): string {
  const { tool, guidance } = entry
  const markdown = (options.format ?? "markdown") === "markdown"
  const rules =
    options.maxRulesPerTool === undefined
      ? guidance.rules
      : guidance.rules.slice(0, Math.max(0, options.maxRulesPerTool))

  const lines = [
    markdown ? `### ${tool.name}` : `[${tool.name}]`,
    shortDescription(tool.description),
  ]
  const group = (label: string, items: readonly string[]) => {
    if (items.length === 0) return
    if (markdown) {
      lines.push(`${label}:`)
      for (const item of items) lines.push(`- ${item}`)
    } else {
      lines.push(`${label}: ${items.join(" ")}`)
    }
  }
  group("Use when", guidance.useWhen)
  group("Avoid when", guidance.avoidWhen)
  group("Rules", rules)
  return lines.join("\n")
}

/** The system prompt and tool set for a set of components. */
export function buildGenUIPrompt(
  entries: readonly GenUIEntry[],
  options: GenUIPromptOptions = {},
): GenUIPrompt {
  const markdown = (options.format ?? "markdown") === "markdown"
  const basePreamble =
    options.preamble === false ? "" : (options.preamble ?? defaultGenUIPreamble)
  const preamble =
    options.refs && basePreamble
      ? `${basePreamble}\n- ${refsRule}`
      : basePreamble

  const parts: string[] = []
  if (preamble) {
    parts.push(markdown ? `## Generative UI\n${preamble}` : preamble)
  }
  const seen = new Set<string>()
  const tools: Record<string, GenUITool> = {}
  for (const entry of entries) {
    const { tool } = entry
    if (seen.has(tool.name)) continue
    seen.add(tool.name)
    parts.push(formatToolSection(entry, options))
    tools[tool.name] = {
      description:
        options.toolDescription === "full"
          ? tool.description
          : shortDescription(tool.description),
      inputSchema: tool.inputSchema,
      jsonSchema: strictify(
        options.refs
          ? withRefs(toJSONSchema(tool.inputSchema))
          : toJSONSchema(tool.inputSchema),
        options.strict,
      ),
    }
  }
  return { system: parts.join("\n\n"), tools }
}

function strictify(schema: unknown, strict?: boolean): Record<string, unknown> {
  return (strict ? toStrictJSONSchema(schema) : schema) as Record<string, unknown>
}

/** String formats strict mode knows; any other `format` is dropped. */
const STRICT_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
])

const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
])
const SCHEMA_VALUE_KEYS = new Set([
  "items",
  "prefixItems",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
])

/**
 * The JSON Schema the Claude API accepts for a tool with `strict: true`:
 * no numeric or length constraints, `minItems` at most 1, no `maxItems`, no
 * patterns, only the known string formats, and objects closed with
 * `additionalProperties: false`. What's removed is appended to the field's
 * description, so the model still reads it; validate the input with the Zod
 * schema afterwards, which keeps every constraint.
 *
 * Strict mode has no open objects at all, so an open record (a layout
 * child's `props`) becomes a string holding the same JSON; the layout
 * schemas and the Renderer parse it back.
 */
export function toStrictJSONSchema(schema: unknown, depth = 0): unknown {
  if (depth > 32 || typeof schema !== "object" || schema === null) {
    return schema
  }
  if (Array.isArray(schema)) {
    return schema.map((s) => toStrictJSONSchema(s, depth + 1))
  }
  const node = { ...(schema as Record<string, unknown>) }
  const notes: string[] = []
  const take = (key: string, note: (v: unknown) => string) => {
    if (node[key] !== undefined) {
      notes.push(note(node[key]))
      delete node[key]
    }
  }
  take("minimum", (v) => `min ${v}`)
  take("maximum", (v) => `max ${v}`)
  take("exclusiveMinimum", (v) => `more than ${v}`)
  take("exclusiveMaximum", (v) => `less than ${v}`)
  take("multipleOf", (v) => `a multiple of ${v}`)
  take("minLength", (v) => `at least ${v} characters`)
  take("maxLength", (v) => `at most ${v} characters`)
  take("maxItems", (v) => `at most ${v} items`)
  take("pattern", (v) => `matching ${v}`)
  if (Array.isArray(node.prefixItems)) {
    // A tuple: strict mode has no prefixItems. Describe the shape instead.
    const parts = node.prefixItems as unknown[]
    const same = parts.every((p) => JSON.stringify(p) === JSON.stringify(parts[0]))
    node.items = same ? parts[0] : { anyOf: parts }
    notes.push(`exactly ${parts.length} items, in order`)
    delete node.prefixItems
  }
  if (typeof node.items === "boolean") delete node.items
  if (Array.isArray(node.oneOf)) {
    // Discriminated unions come out as oneOf; strict mode only knows anyOf.
    node.anyOf = node.oneOf
    delete node.oneOf
  }
  delete node.not
  delete node.uniqueItems
  if (typeof node.minItems === "number" && node.minItems > 1) {
    notes.push(`at least ${node.minItems} items`)
    node.minItems = 1
  }
  if (typeof node.format === "string" && !STRICT_FORMATS.has(node.format)) {
    notes.push(`format ${node.format}`)
    delete node.format
  }
  delete node.propertyNames
  delete node.$schema

  if (node.type === "object") {
    const open =
      node.additionalProperties !== undefined &&
      node.additionalProperties !== false
    if (open && !node.properties) {
      // An open record: strict mode can't describe it. Carry it as JSON text.
      const base = typeof node.description === "string" ? node.description : ""
      return {
        type: "string",
        description: `${base}${base && !base.endsWith(".") ? "." : ""} Write it as a JSON string.`.trim(),
      }
    }
    node.additionalProperties = false
  }

  for (const [k, v] of Object.entries(node)) {
    if (SCHEMA_MAP_KEYS.has(k) && typeof v === "object" && v !== null) {
      node[k] = Object.fromEntries(
        Object.entries(v).map(([p, s]) => [p, toStrictJSONSchema(s, depth + 1)]),
      )
    } else if (SCHEMA_VALUE_KEYS.has(k)) {
      node[k] = toStrictJSONSchema(v, depth + 1)
    }
  }
  if (notes.length) {
    const base = typeof node.description === "string" ? node.description : ""
    node.description = `${base}${base && !base.endsWith(".") ? "." : ""} (${notes.join(", ")})`.trim()
  }
  return node
}

export type PickFilter = {
  /** Tool names (e.g. "show_checklist") or, when entries carry one, slugs. */
  names?: readonly string[]
  categories?: readonly string[]
  levels?: readonly string[]
  /** Visualisation functions, e.g. ["correlation"]; matches entries tagged with any of them. */
  functions?: readonly string[]
}

/**
 * Filters entries. Every filter you pass must match (they combine with AND);
 * within one filter, any value matches. Category, level and function filters
 * read `entry.meta`, so entries without it are left out by those filters.
 */
export function pickEntries<T extends GenUIEntry & { slug?: string }>(
  entries: readonly T[],
  filter: PickFilter = {},
): T[] {
  const lower = (values?: readonly string[]) =>
    values && values.length > 0
      ? new Set(values.map((v) => v.toLowerCase()))
      : undefined
  const names = lower(filter.names)
  const categories = lower(filter.categories)
  const levels = lower(filter.levels)
  const functions = lower(filter.functions)
  return entries.filter((entry) => {
    if (
      names &&
      !names.has(entry.tool.name.toLowerCase()) &&
      !(entry.slug && names.has(entry.slug.toLowerCase()))
    ) {
      return false
    }
    if (
      categories &&
      !categories.has(entry.meta?.category?.toLowerCase() ?? "")
    ) {
      return false
    }
    if (levels && !levels.has(entry.meta?.level?.toLowerCase() ?? "")) {
      return false
    }
    if (
      functions &&
      !(entry.meta?.functions ?? []).some((f) => functions.has(f.toLowerCase()))
    ) {
      return false
    }
    return true
  })
}

/**
 * A rough token estimate with no tokenizer: about 3.6 characters per token
 * for JSON, 4 for prose. Real counts vary by model tokenizer.
 */
export function estimateTokens(
  text: string,
  kind: "json" | "prose" = "prose",
): number {
  if (!text) return 0
  return Math.ceil(text.length / (kind === "json" ? 3.6 : 4))
}

/** The JSON a provider receives for one tool: name, description, parameters. */
export function toolDefinitionJSON(name: string, tool: GenUITool): string {
  return JSON.stringify({
    name,
    description: tool.description,
    parameters: tool.jsonSchema,
  })
}
