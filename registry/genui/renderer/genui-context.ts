/**
 * What crosses between the model and the interface, in both directions:
 *
 * - Refs: the model points at a value in a tool result instead of retyping
 *   it, `{ "$ref": "flights.offers.0.price" }`, and the host fills it in. Prices,
 *   image URLs, IDs and names arrive exactly as the tool returned them.
 * - Binds: inside a layout, a child points at a sibling's latest result,
 *   `{ "$bind": "slot.label" }`, and the Renderer copies the value in each
 *   time it changes. One component drives another with no model call.
 * - UI state: what the user changed in the interface since the last message,
 *   as a short note the host adds to the next turn, so the model knows the
 *   current state instead of guessing it.
 */

/** A pointer into a tool result: the source id, then a dot path. */
export type GenUIRef = { $ref: string }

/** Tool results the model may point into, keyed by the id it sees. */
export type GenUIRefSources = Record<string, unknown>

const BLOCKED = new Set(["__proto__", "prototype", "constructor"])

export function isRef(value: unknown): value is GenUIRef {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    typeof (value as GenUIRef).$ref === "string"
  )
}

/** "offers[0].price" → ["offers", "0", "price"]. */
export function refPath(ref: string): string[] {
  return ref
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Reads one ref from the sources, own properties only. */
export function readRef(
  ref: string,
  sources: GenUIRefSources,
): { found: boolean; value?: unknown } {
  const path = refPath(ref)
  if (path.length === 0 || path.some((s) => BLOCKED.has(s))) {
    return { found: false }
  }
  let current: unknown = sources
  for (const segment of path) {
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.hasOwn(current, segment)
    ) {
      return { found: false }
    }
    current = (current as Record<string, unknown>)[segment]
  }
  return { found: true, value: current }
}

/**
 * Replaces every `{ $ref }` in a value with what it points to. Unresolved refs
 * are dropped (left `undefined`), so a component shows its loading state for
 * them while streaming and nothing invented once ready; check `missing`.
 */
export function resolveRefs<T>(
  value: T,
  sources: GenUIRefSources,
): { value: T; missing: string[] } {
  const missing: string[] = []
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 32) return node
    if (isRef(node)) {
      const hit = readRef(node.$ref, sources)
      if (!hit.found) missing.push(node.$ref)
      return hit.value
    }
    if (Array.isArray(node)) {
      return node.map((n) => walk(n, depth + 1)).filter((n) => n !== undefined)
    }
    if (typeof node === "object" && node !== null) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) {
        const next = walk(v, depth + 1)
        if (next !== undefined) out[k] = next
      }
      return out
    }
    return node
  }
  return { value: walk(value, 0) as T, missing }
}

const REF_JSON_SCHEMA = {
  type: "object",
  properties: { $ref: { type: "string" } },
  required: ["$ref"],
  additionalProperties: false,
} as const

/** Keywords whose value maps names to schemas. */
const SCHEMA_MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
])
/** Keywords whose value is a schema, or a list of them. */
const SCHEMA_VALUES = new Set([
  "items",
  "additionalProperties",
  "prefixItems",
  "anyOf",
  "oneOf",
  "allOf",
])

const LEAF_TYPES = new Set(["string", "number", "integer", "boolean"])

/**
 * Lets every scalar field of a tool's JSON Schema take a ref instead of a
 * value, so provider-side validation accepts `{ $ref }`. Resolve with
 * `resolveRefs`, then validate the result with the component's Zod schema.
 */
export function withRefs(schema: unknown, depth = 0): unknown {
  if (depth > 32 || typeof schema !== "object" || schema === null) {
    return schema
  }
  if (Array.isArray(schema)) return schema.map((s) => withRefs(s, depth + 1))
  const node = schema as Record<string, unknown>
  const isLeaf =
    (typeof node.type === "string" && LEAF_TYPES.has(node.type)) ||
    (node.enum !== undefined && node.type === undefined)
  if (isLeaf) {
    const { description, ...rest } = node
    return {
      ...(description !== undefined ? { description } : {}),
      anyOf: [rest, REF_JSON_SCHEMA],
    }
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    if (SCHEMA_MAPS.has(k) && typeof v === "object" && v !== null) {
      out[k] = Object.fromEntries(
        Object.entries(v).map(([p, s]) => [p, withRefs(s, depth + 1)]),
      )
    } else if (SCHEMA_VALUES.has(k)) {
      out[k] = withRefs(v, depth + 1)
    } else {
      out[k] = v
    }
  }
  return out
}

/**
 * A pointer at a sibling's result inside a layout: the sibling's `id`, then a
 * dot path into its latest result. `default` is used until the sibling has
 * sent one.
 */
export type GenUIBind = { $bind: string; default?: unknown }

/** The latest result of each child in a layout, keyed by the child's id. */
export type GenUIBindSources = Record<string, unknown>

export function isBind(value: unknown): value is GenUIBind {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false
  }
  const keys = Object.keys(value)
  return (
    typeof (value as GenUIBind).$bind === "string" &&
    keys.every((k) => k === "$bind" || k === "default")
  )
}

/**
 * Replaces every `{ $bind }` in a value with the bound sibling's value. A bind
 * whose sibling hasn't sent a result yet takes its `default`, or is dropped
 * (left `undefined`) so the component shows its own default for the field.
 * Only copies values: no arithmetic, no expressions.
 */
export function resolveBinds<T>(
  value: T,
  sources: GenUIBindSources,
): { value: T; pending: string[] } {
  const pending: string[] = []
  const walk = (node: unknown, depth: number): unknown => {
    if (depth > 32) return node
    if (isBind(node)) {
      const hit = readRef(node.$bind, sources)
      if (hit.found) return hit.value
      pending.push(node.$bind)
      return node.default
    }
    if (isRef(node)) return node
    if (Array.isArray(node)) {
      return node.map((n) => walk(n, depth + 1)).filter((n) => n !== undefined)
    }
    if (typeof node === "object" && node !== null) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(node)) {
        const next = walk(v, depth + 1)
        if (next !== undefined) out[k] = next
      }
      return out
    }
    return node
  }
  return { value: walk(value, 0) as T, pending }
}

/** True when a value contains at least one `{ $bind }`. */
export function hasBinds(value: unknown, depth = 0): boolean {
  if (depth > 32) return false
  if (isBind(value)) return true
  if (Array.isArray(value)) return value.some((v) => hasBinds(v, depth + 1))
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some((v) => hasBinds(v, depth + 1))
  }
  return false
}

/** The layout rule that goes with binds. */
export const bindsRule =
  'Inside a layout, a child may take a value from a sibling\'s result instead of a literal: give the sibling an id and write { "$bind": "<id>.<path into its result>", "default": <value until then> }, e.g. { "$bind": "slot.label", "default": "Not picked yet" }. The app copies the value in each time the sibling\'s result changes, with no call to you. Binds only copy values, unformatted, so bind to a display-ready field (a label) when the result has one; put any calculation in a calculator or a tool.'

/** The system-prompt rule that goes with refs. */
export const refsRule =
  'When a value (a URL, price, ID or name) comes from a tool result, don\'t retype it: write { "$ref": "<source>.<path>" } in its place, e.g. { "$ref": "search.results.0.image" }. <source> is the ref id the tool result carries. The app fills it in.'

/** One finished or in-progress interaction, as the host stores it. */
export type GenUIStateEntry = {
  /** The call id the model knows. */
  id: string
  /** Tool name. */
  name: string
  /** The latest result the component sent. */
  result: unknown
}

export type DescribeOptions = {
  /** Per-tool wording, e.g. show_itinerary → "Removed: Coit Tower". */
  formatters?: Record<string, (result: unknown) => string | null>
  /** Cap on the note's length. Default 1200 characters. */
  maxChars?: number
}

/**
 * A short note of what the user changed in the interface, for the next turn:
 * add it to the user's message (or as a system note) so the model works from
 * the current state. Returns "" when nothing changed.
 */
export function describeUIState(
  entries: readonly GenUIStateEntry[],
  { formatters = {}, maxChars = 1200 }: DescribeOptions = {},
): string {
  const lines: string[] = []
  for (const e of entries) {
    if (e.result === undefined) continue
    const custom = formatters[e.name]?.(e.result)
    if (custom === null) continue
    const text = custom ?? JSON.stringify(e.result)
    lines.push(`- ${e.name} (${e.id}): ${text}`)
  }
  if (lines.length === 0) return ""
  const note = ["Interface state the user set:", ...lines].join("\n")
  return note.length > maxChars ? `${note.slice(0, maxChars - 1)}…` : note
}
