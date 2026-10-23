import { toJSONSchema } from "zod"

import { parsePartialJson } from "./genui-agui"
import { bindsRule } from "./genui-context"
import { type GenUIEntry, shortDescription } from "./genui-prompt"
import type { GenUICall } from "./genui-renderer"

/*
 * A2UI adapter, both directions. Catalog out: GenUI entries become an A2UI
 * component catalog the agent writes surfaces from. Messages in: the agent's
 * A2UI messages become GenUICalls, one per surface, and the user's result
 * goes back as an A2UI `action`. Structural types only, so `@a2ui/*` is not a
 * dependency.
 *
 * Protocol facts this follows (A2UI v0.9.1, the current production release;
 * v1.0 is a release candidate and v0.8 is legacy):
 * - Agent → renderer messages are JSON objects with `version` ("v0.9" or
 *   "v0.9.1") and exactly one of: createSurface { surfaceId, catalogId,
 *   theme?, sendDataModel? }, updateComponents { surfaceId, components },
 *   updateDataModel { surfaceId, path?, value? }, deleteSurface { surfaceId }.
 *   They usually arrive as JSONL, one message per line.
 * - Components are a flat adjacency list: `{ id, component, ...props }`, and
 *   containers reference children by id (`ComponentId`, or a `ChildList`:
 *   an id array or a template `{ componentId, path }` repeated per item of a
 *   data-model array, with relative paths resolved per item). The tree
 *   renders from the component with id "root"; children may arrive later,
 *   and the renderer shows what it has. Updating an existing id replaces its
 *   properties; `component` may be left out to keep its type.
 * - A prop may be a DataBinding `{ path }`, a JSON Pointer into the
 *   surface's data model. updateDataModel replaces the value at `path` (or
 *   the whole model), and removes it when `value` is left out.
 * - Renderer → agent: `{ version, action: { name, surfaceId,
 *   sourceComponentId, timestamp, context } }`, and `{ version, error: {
 *   code: "VALIDATION_FAILED", surfaceId, path, message } }` for an agent
 *   message that failed validation, so the agent can fix it.
 * - A catalog is `{ catalogId, components: { Name: JSON Schema } }`; a child
 *   reference must use common_types' ComponentId / ChildList so validators
 *   can check the tree. The renderer advertises catalogs in
 *   `a2uiClientCapabilities` (`{ "v0.9": { supportedCatalogIds,
 *   inlineCatalogs? } }`) and, for surfaces created with `sendDataModel`,
 *   sends `a2uiClientDataModel` with every message.
 * Sources:
 *   https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/docs/a2ui_protocol.md
 *   https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/json/server_to_client.json
 *   https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/json/client_to_server.json
 *   https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/json/common_types.json
 *   https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/json/client_capabilities.json
 *   https://github.com/a2ui-project/a2ui/blob/main/specification/v0_9_1/catalogs/basic/catalog.json
 *   Reference renderer: typescript/core/web_core/src/processing/message-processor.ts
 *   (@a2ui/web_core 0.14.0, checked 2026-10-23)
 *
 * Usage:
 *
 *   const catalog = toA2UICatalog({ entries })        // give it to the agent
 *   let state = createA2UIState({ tools: Object.keys(genuiCatalog), catalogId: catalog.catalogId })
 *   state = reduceA2UI(state, message)               // per agent message
 *   state = finishA2UI(state)                        // when the agent's turn ends
 *   callsFromA2UI(state)                             // → <GenUIRenderer call={…}>
 *   onResult={(call, result) => send(toA2UIAction(call, result))}
 *
 * Layouts: the agent composes with A2UI containers, which become GenUI
 * layouts. Column is stack, Row is columns, Tabs is tabs (the three that line
 * up with A2UI's basic catalog); Grid, Split and Steps have no basic-catalog
 * equivalent and are added in A2UI's style, children by id. Card is unwrapped
 * (GenUI components draw their own card) and List reads as Column or Row.
 */

export const A2UI_VERSION = "v0.9.1"

/** Where the common types the catalog references live. */
export const A2UI_COMMON_TYPES =
  "https://a2ui.org/specification/v0_9/common_types.json"

/** The default catalog id. Use your own when your catalog is a subset. */
export const GENUI_A2UI_CATALOG_ID =
  "https://gen-ui-kit.vercel.app/a2ui/v0_9/catalog.json"

// ---- Structural A2UI types ----------------------------------------------

/** Any agent → renderer (or, from history, renderer → agent) message. */
export type A2UIMessage = { version?: string; [key: string]: unknown }

/** One component in an updateComponents list. */
export type A2UIComponent = {
  id: string
  component: string
  [key: string]: unknown
}

/** A JSON Schema node, as A2UI catalogs hold them. */
export type A2UIJSONSchema = Record<string, unknown>

/** An A2UI catalog: what `inlineCatalogs` holds, and what the agent's prompt carries. */
export type A2UICatalog = {
  catalogId: string
  components: Record<string, A2UIJSONSchema>
}

/** The renderer's `action` message, sent when the user acts. */
export type A2UIActionMessage = {
  version: string
  action: {
    name: string
    surfaceId: string
    sourceComponentId: string
    timestamp: string
    context: Record<string, unknown>
  }
}

/** The renderer's `error` message for an agent message that failed validation. */
export type A2UIErrorMessage = {
  version: string
  error: {
    code: "VALIDATION_FAILED"
    surfaceId: string
    path: string
    message: string
  }
}

// ---- Catalog out --------------------------------------------------------

const ID = { $ref: `${A2UI_COMMON_TYPES}#/$defs/ComponentId` }
const CHILD_LIST = { $ref: `${A2UI_COMMON_TYPES}#/$defs/ChildList` }
const DATA_BINDING = { $ref: `${A2UI_COMMON_TYPES}#/$defs/DataBinding` }
const BIND = {
  type: "object",
  properties: { $bind: { type: "string" }, default: {} },
  required: ["$bind"],
  additionalProperties: false,
}

/** A2UI layout name → the GenUI layout tool it becomes. */
const LAYOUTS: Record<string, string> = {
  Column: "show_stack",
  Row: "show_columns",
  Tabs: "show_tabs",
  Grid: "show_grid",
  Split: "show_split",
  Steps: "show_steps",
}
const LAYOUT_TOOLS = new Set(Object.values(LAYOUTS))

const pascalCase = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")

/** The A2UI component name for a GenUI tool: "pick_slot" → "PickSlot". */
export function a2uiName(
  toolName: string,
  names?: Readonly<Record<string, string>>,
): string {
  const name = names?.[toolName] ?? pascalCase(toolName)
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(
      `[genui-a2ui] "${name}" (for "${toolName}") isn't a PascalCase component name.`,
    )
  }
  return name
}

/** What the component is, then when to use it and when not to. Rules go to `a2uiRules`. */
export function a2uiDescription(entry: GenUIEntry): string {
  const { useWhen, avoidWhen } = entry.guidance
  return [
    shortDescription(entry.tool.description),
    useWhen.length ? `Use when: ${useWhen.join(" ")}` : "",
    avoidWhen.length ? `Avoid when: ${avoidWhen.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

/** A prop that may also be written as a data binding or a sibling bind. */
function dynamic(schema: unknown): A2UIJSONSchema {
  const { description, ...rest } = schema as A2UIJSONSchema
  return {
    ...(description !== undefined ? { description } : {}),
    anyOf: [rest, DATA_BINDING, BIND],
  }
}

/** Points `#/$defs/…` refs at the component's own `$defs` inside the catalog. */
function rebaseRefs(node: unknown, base: string, depth = 0): unknown {
  if (depth > 64 || typeof node !== "object" || node === null) return node
  if (Array.isArray(node)) return node.map((n) => rebaseRefs(n, base, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node)) {
    out[k] =
      k === "$ref" && typeof v === "string" && v.startsWith("#/$defs/")
        ? `${base}${v.slice("#/$defs/".length)}`
        : rebaseRefs(v, base, depth + 1)
  }
  return out
}

/** One GenUI component as an A2UI catalog component. */
export function a2uiComponentSchema(
  entry: GenUIEntry,
  { name = a2uiName(entry.tool.name), dataBindings = true } = {},
): A2UIJSONSchema {
  // "input": what the agent writes, so fields with defaults stay optional.
  const json = toJSONSchema(entry.tool.inputSchema, { io: "input" }) as A2UIJSONSchema
  if (json.type !== "object" || !isRecord(json.properties)) {
    throw new Error(
      `[genui-a2ui] A2UI needs a z.object schema for each component ("${entry.tool.name}").`,
    )
  }
  const base = `#/components/${name}/$defs/`
  const properties = rebaseRefs(json.properties, base) as A2UIJSONSchema
  const required = Array.isArray(json.required) ? (json.required as string[]) : []
  return {
    type: "object",
    description: a2uiDescription(entry),
    properties: {
      id: ID,
      component: { const: name },
      ...(dataBindings
        ? Object.fromEntries(
            Object.entries(properties).map(([k, v]) => [k, dynamic(v)]),
          )
        : properties),
    },
    required: ["id", "component", ...required],
    additionalProperties: false,
    ...(json.$defs ? { $defs: rebaseRefs(json.$defs, base) } : {}),
  }
}

function layoutSchema(
  name: string,
  description: string,
  properties: A2UIJSONSchema,
  required: string[],
): A2UIJSONSchema {
  return {
    type: "object",
    description: `${description} A layout may hold one more layout, no deeper.`,
    properties: { id: ID, component: { const: name }, ...properties },
    required: ["id", "component", ...required],
    additionalProperties: false,
  }
}

const label = (description: string, maxLength: number, dataBindings: boolean) => {
  const text = { type: "string", maxLength, description }
  return dataBindings ? dynamic(text) : text
}

/** The A2UI layout components, by A2UI name. */
function layoutSchemas(dataBindings: boolean): Record<string, A2UIJSONSchema> {
  return {
    Column: layoutSchema(
      "Column",
      "2–6 components one under the other, as one piece: a summary over a table, a picker over its confirmation. Put the main answer first. Not for independent answers (send separate surfaces) or for parallel views (use Tabs).",
      {
        children: { ...CHILD_LIST, description: "2–6 component ids, or a template over a data-model list." },
        gap: {
          type: "string",
          enum: ["tight", "normal"],
          description: "'tight' for parts of one thing, 'normal' between separate parts.",
        },
      },
      ["children"],
    ),
    Row: layoutSchema(
      "Row",
      "2–6 components side by side for comparison (two plans, three flights), stacked on phones. Give every child the same component with the same fields. Not for long content.",
      { children: { ...CHILD_LIST, description: "2–6 component ids, or a template over a data-model list." } },
      ["children"],
    ),
    Tabs: layoutSchema(
      "Tabs",
      "2–5 parallel views of one subject the user switches between, e.g. Overview / Itinerary / Budget. The first tab holds the main answer. Never put Tabs in Tabs.",
      {
        tabs: {
          type: "array",
          minItems: 2,
          maxItems: 5,
          items: {
            type: "object",
            properties: {
              title: label("One or two words, e.g. 'Budget'.", 24, dataBindings),
              child: { ...ID, description: "The tab's component, or a Column of up to 3." },
            },
            required: ["title", "child"],
            additionalProperties: false,
          },
        },
      },
      ["tabs"],
    ),
    Grid: layoutSchema(
      "Grid",
      "A dashboard of 2–9 small, different components (KPIs, a chart, a short table), the first one the headline. Use span 'full' for at most two wide items.",
      {
        columns: { enum: [2, 3], description: "Columns on wide screens; always one on phones." },
        items: {
          type: "array",
          minItems: 2,
          maxItems: 9,
          items: {
            type: "object",
            properties: {
              child: ID,
              span: { enum: [1, 2, "full"], description: "Columns this item takes on wide screens." },
            },
            required: ["child"],
            additionalProperties: false,
          },
        },
      },
      ["items"],
    ),
    Split: layoutSchema(
      "Split",
      "A main component with a narrower aside that goes with it: a map and its places, a chart and the controls that drive it. The aside must read well at a third of the width.",
      {
        main: { ...ID, description: "The larger side: the answer itself." },
        aside: { ...ID, description: "The narrower side: a list, a summary, controls." },
        asideWidth: { type: "string", enum: ["narrow", "wide"] },
        asidePosition: { type: "string", enum: ["end", "start"] },
      },
      ["main", "aside"],
    ),
    Steps: layoutSchema(
      "Steps",
      "A numbered procedure of 2–6 steps, each its own component: pick, then confirm. Title each step with a verb; the last step is the one that commits.",
      {
        title: label("What the steps achieve.", 60, dataBindings),
        steps: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              title: label("The step, imperative: 'Pick a time'.", 60, dataBindings),
              description: label("One line, only when the title isn't enough.", 120, dataBindings),
              child: ID,
            },
            required: ["title", "child"],
            additionalProperties: false,
          },
        },
      },
      ["steps"],
    ),
  }
}

export type ToA2UICatalogOptions = {
  entries: readonly GenUIEntry[]
  /** Defaults to GENUI_A2UI_CATALOG_ID. Use your own when you send a subset. */
  catalogId?: string
  /** A2UI component names by tool name. Defaults to PascalCase ("pick_slot" → "PickSlot"). */
  names?: Readonly<Record<string, string>>
  /**
   * Let each top-level prop be a data binding `{ path }` (or a sibling
   * `{ $bind }`) as well as a value. Default true: data can then stream in
   * with updateDataModel, the A2UI way.
   */
  dataBindings?: boolean
}

/**
 * The A2UI catalog for a set of components: put it in the agent's prompt, or
 * send it as an inline catalog (`toA2UIClientCapabilities`). The layout
 * entries in `entries` decide which A2UI layouts it has: show_stack adds
 * Column, show_columns Row, show_tabs Tabs, and so on.
 */
export function toA2UICatalog({
  entries,
  catalogId = GENUI_A2UI_CATALOG_ID,
  names,
  dataBindings = true,
}: ToA2UICatalogOptions): A2UICatalog {
  const components: Record<string, A2UIJSONSchema> = {}
  const add = (name: string, schema: A2UIJSONSchema) => {
    if (components[name]) {
      throw new Error(`[genui-a2ui] Two components are named "${name}".`)
    }
    components[name] = schema
  }
  const tools = new Set(entries.map((e) => e.tool.name))
  for (const entry of entries) {
    if (LAYOUT_TOOLS.has(entry.tool.name)) continue
    const name = a2uiName(entry.tool.name, names)
    add(name, a2uiComponentSchema(entry, { name, dataBindings }))
  }
  for (const [name, schema] of Object.entries(layoutSchemas(dataBindings))) {
    if (tools.has(LAYOUTS[name])) add(name, schema)
  }
  return { catalogId, components }
}

/**
 * The catalog as a schema file, for validators that load it in place of
 * `catalog.json` next to A2UI's server_to_client.json: adds `$id`, the
 * `anyComponent` union the envelope references, and an open `theme`.
 */
export function toA2UICatalogDocument(catalog: A2UICatalog): A2UIJSONSchema {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: catalog.catalogId,
    title: "Gen UI by G1 Labs",
    ...catalog,
    $defs: {
      anyComponent: {
        oneOf: Object.keys(catalog.components).map((name) => ({
          $ref: `#/components/${name}`,
        })),
        discriminator: { propertyName: "component" },
      },
      theme: { type: "object", additionalProperties: true },
    },
  }
}

/**
 * Rules to add to the agent's prompt next to the catalog: GenUI's data rule,
 * how surfaces and layouts compose, binds, then each component's rules
 * prefixed with its A2UI name.
 */
export function a2uiRules(
  entries: readonly GenUIEntry[],
  { names, dataBindings = true }: Pick<ToA2UICatalogOptions, "names" | "dataBindings"> = {},
): string[] {
  const layouts = Object.keys(LAYOUTS).filter((name) =>
    entries.some((e) => e.tool.name === LAYOUTS[name]),
  )
  return [
    "Never invent DATA-BOUND fields. Fill them only from tool results, the data model, or what the user said.",
    layouts.length
      ? `Each surface is one answer. Its root is one component, or a layout (${layouts.join(", ")}) holding components. A layout may hold one more layout, no deeper.`
      : "Each surface is one answer: its root is one component.",
    "Keep component ids short (at most 24 characters), e.g. 'slot'.",
    ...(layouts.length ? [bindsRule.replace("give the sibling an id and write", "write")] : []),
    ...(dataBindings
      ? [
          'A top-level property may be { "path": "/pointer" } into the surface\'s data model, filled by updateDataModel. Use it for data you send separately; otherwise write the value inline.',
        ]
      : []),
    ...entries
      .filter((entry) => !LAYOUT_TOOLS.has(entry.tool.name))
      .flatMap((entry) => {
        const name = a2uiName(entry.tool.name, names)
        return entry.guidance.rules.map((rule) => `${name}: ${rule}`)
      }),
  ]
}

/**
 * The renderer's `a2uiClientCapabilities`, for the transport's metadata.
 * Pass `inline: true` to send the catalog itself, for agents that accept
 * inline catalogs.
 */
export function toA2UIClientCapabilities(
  catalog: A2UICatalog,
  { inline = false }: { inline?: boolean } = {},
) {
  return {
    "v0.9": {
      supportedCatalogIds: [catalog.catalogId],
      ...(inline ? { inlineCatalogs: [catalog] } : {}),
    },
  }
}

// ---- Messages in --------------------------------------------------------

export type A2UISurface = {
  id: string
  catalogId: string
  sendDataModel: boolean
  components: Record<string, A2UIComponent>
  dataModel: Record<string, unknown>
  /** The agent's turn ended: render what arrived. */
  finished: boolean
  /** A result restored from an `action` message. */
  action?: { sourceComponentId: string; result: unknown }
  /** The surface as a call, once its root has arrived. */
  call?: GenUICall
}

export type A2UIState = {
  /** In the order they were created. */
  surfaces: A2UISurface[]
  /** The calls to render, one per surface with a root. */
  calls: GenUICall[]
  /** A2UI component name → GenUI tool name, for the non-layout components. */
  tools: Record<string, string>
  /** Only surfaces created with this catalog are tracked. */
  catalogId?: string
  dataBindings: boolean
  /** Built from a cut-off line (`previewA2UI`): unknown names are still arriving. */
  preview?: boolean
}

/**
 * The initial state. `tools` are the GenUI tool names you can render (usually
 * `Object.keys(catalog)`); pass the same `names` as `toA2UICatalog`. With
 * `catalogId`, surfaces for other catalogs (say, A2UI's basic catalog, which
 * another renderer draws) are ignored.
 */
export function createA2UIState({
  tools,
  names,
  catalogId,
  dataBindings = true,
}: {
  tools: readonly string[]
  names?: Readonly<Record<string, string>>
  catalogId?: string
  dataBindings?: boolean
}): A2UIState {
  const map: Record<string, string> = {}
  for (const tool of tools) {
    if (!LAYOUT_TOOLS.has(tool)) map[a2uiName(tool, names)] = tool
  }
  return { surfaces: [], calls: [], tools: map, catalogId, dataBindings }
}

const VERSIONS = new Set(["v0.9", "v0.9.1"])

/**
 * Applies one A2UI message (or a list of them). Pure: returns a new state
 * when something changed and the same state otherwise, so it works directly
 * with `useReducer`.
 *
 * - A surface becomes a call once its "root" component arrives, and fills in
 *   as more components and data arrive. It stays "streaming" while a child
 *   or a bound value it references is missing, until `finishA2UI`.
 * - A component this catalog doesn't have fails the call: the catalog is an
 *   allow-list.
 * - deleteSurface removes the call.
 * - An `action` message (the renderer's own, from history) restores the
 *   result it carried, so a reloaded conversation shows the final state.
 * - Other versions (v0.8, v1.0) and messages for unknown surfaces are ignored.
 */
export function reduceA2UI(
  state: A2UIState,
  message: A2UIMessage | readonly A2UIMessage[],
): A2UIState {
  if (Array.isArray(message)) {
    return (message as readonly A2UIMessage[]).reduce(reduceA2UI, state)
  }
  const m = message as A2UIMessage
  if (!isRecord(m) || (m.version !== undefined && !VERSIONS.has(str(m.version)))) {
    return state
  }

  if (isRecord(m.createSurface)) {
    const { surfaceId, catalogId, sendDataModel } = m.createSurface
    const id = str(surfaceId)
    // Creating an existing surface is an error in A2UI; keep the first.
    if (!id || state.surfaces.some((s) => s.id === id)) return state
    if (state.catalogId && str(catalogId) !== state.catalogId) return state
    const surface: A2UISurface = {
      id,
      catalogId: str(catalogId),
      sendDataModel: sendDataModel === true,
      components: {},
      dataModel: {},
      finished: false,
    }
    return { ...state, surfaces: [...state.surfaces, surface] }
  }

  if (isRecord(m.updateComponents)) {
    const { surfaceId, components } = m.updateComponents
    if (!Array.isArray(components)) return state
    return updateSurface(state, str(surfaceId), (s) => {
      const next = { ...s.components }
      for (const c of components) {
        if (!isRecord(c) || !str(c.id)) continue
        const id = str(c.id)
        // An update may leave out `component` to keep the type.
        const type = str(c.component) || next[id]?.component
        if (!type) continue
        next[id] = { ...c, id, component: type }
      }
      return { ...s, components: next }
    })
  }

  if (isRecord(m.updateDataModel)) {
    const { surfaceId, path, value } = m.updateDataModel
    const remove = !Object.hasOwn(m.updateDataModel, "value") || value === undefined
    return updateSurface(state, str(surfaceId), (s) => {
      const model = setPointer(s.dataModel, pointer(str(path)), value, remove)
      return { ...s, dataModel: isRecord(model) ? model : {} }
    })
  }

  if (isRecord(m.deleteSurface)) {
    const id = str(m.deleteSurface.surfaceId)
    if (!state.surfaces.some((s) => s.id === id)) return state
    return withCalls({ ...state, surfaces: state.surfaces.filter((s) => s.id !== id) })
  }

  if (isRecord(m.action)) {
    const { surfaceId, sourceComponentId, context } = m.action
    return updateSurface(state, str(surfaceId), (s) => ({
      ...s,
      action: {
        sourceComponentId: str(sourceComponentId) || "root",
        result: isRecord(context) ? context.result : undefined,
      },
    }))
  }

  return state
}

/** The calls to render, in order. */
export function callsFromA2UI(state: A2UIState): GenUICall[] {
  return state.calls
}

/**
 * The agent's turn ended (the A2A task finished, the stream closed): every
 * surface, or just `surfaceId`, renders what arrived. Missing children are
 * left out and unbound values stay empty, as A2UI renderers do.
 */
export function finishA2UI(state: A2UIState, surfaceId?: string): A2UIState {
  let next = state
  for (const s of state.surfaces) {
    if (s.finished || (surfaceId !== undefined && s.id !== surfaceId)) continue
    next = updateSurface(next, s.id, (x) => ({ ...x, finished: true }))
  }
  return next
}

/**
 * Builds calls from stored A2UI messages: the agent's, and the `action`
 * messages you sent, which restore each component's final state.
 */
export function callsFromA2UIMessages(
  messages: readonly A2UIMessage[],
  options: Parameters<typeof createA2UIState>[0],
): GenUICall[] {
  return callsFromA2UI(finishA2UI(reduceA2UI(createA2UIState(options), messages)))
}

/**
 * Splits a JSONL stream into whole messages and the text after the last
 * newline. Keep `rest` and prepend it to the next chunk; lines that aren't
 * JSON are returned in `invalid`.
 */
export function readA2UIJsonl(text: string): {
  messages: A2UIMessage[]
  rest: string
  invalid: string[]
} {
  const lines = text.split("\n")
  const rest = lines.pop() ?? ""
  const messages: A2UIMessage[] = []
  const invalid: string[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    const parsed = parseJSON(line)
    if (isRecord(parsed)) messages.push(parsed)
    else invalid.push(line)
  }
  return { messages, rest, invalid }
}

/**
 * The state with a cut-off line applied, so a long updateComponents line
 * fills in as the agent writes it. For rendering only: keep reducing whole
 * lines into the state you store. A component name still being written
 * counts as missing, not unknown.
 */
export function previewA2UI(state: A2UIState, rest: string): A2UIState {
  const partial = parsePartialJson(rest)
  if (!isRecord(partial)) return state
  return reduceA2UI({ ...state, preview: true }, partial)
}

function updateSurface(
  state: A2UIState,
  id: string,
  update: (s: A2UISurface) => A2UISurface,
): A2UIState {
  const i = state.surfaces.findIndex((s) => s.id === id)
  if (i < 0) return state
  const surfaces = [...state.surfaces]
  surfaces[i] = build(state, update(surfaces[i]))
  return withCalls({ ...state, surfaces })
}

function withCalls(state: A2UIState): A2UIState {
  return {
    ...state,
    calls: state.surfaces.flatMap((s) => (s.call ? [s.call] : [])),
  }
}

// ---- Building a surface's call ------------------------------------------

/** Where each layout child sits: the Renderer's key path → A2UI id and tool. */
type ChildKeys = Record<string, { id: string; tool: string }>

/** The key paths of each call built here, for `toA2UIAction`. */
const callKeys = new WeakMap<GenUICall, ChildKeys>()

const CUT_OFF = "This part of the response arrived incomplete."
const MAX_DEPTH = 16

type Build = {
  state: A2UIState
  s: A2UISurface
  /** Something referenced hasn't arrived yet. */
  pending: boolean
  error?: string
  keys: ChildKeys
  stack: string[]
}

type Node = { component: string; props: Record<string, unknown>; id?: string }

function build(state: A2UIState, s: A2UISurface): A2UISurface {
  if (!s.components.root) return s.call ? { ...s, call: undefined } : s
  const b: Build = { state, s, pending: false, keys: {}, stack: [] }
  const root = node(b, "root", "", "")
  let call: GenUICall
  if (b.error || (!root && s.finished)) {
    call = {
      id: s.id,
      name: root?.component ?? s.components.root.component,
      props: {},
      status: "failed",
      error: b.error ?? CUT_OFF,
    }
  } else if (!root) {
    return s.call ? { ...s, call: undefined } : s
  } else {
    call = {
      id: s.id,
      name: root.component,
      props: root.props,
      status: b.pending && !s.finished ? "streaming" : "ready",
    }
    const result = restoredResult(s, b.keys)
    if (result !== undefined) call.result = result
  }
  callKeys.set(call, b.keys)
  return { ...s, call }
}

/** A component and everything under it, as a GenUI child. */
function node(b: Build, id: string, scope: string, key: string): Node | undefined {
  const c = b.s.components[id]
  if (!c) {
    b.pending = true
    return undefined
  }
  if (b.stack.includes(id) || b.stack.length >= MAX_DEPTH) {
    b.error = "This part of the response refers to itself and couldn't be shown."
    return undefined
  }
  b.stack.push(id)
  try {
    const out = shape(b, c, scope, key)
    // A Card is unwrapped: its child already took the key.
    if (out && c.component !== "Card") b.keys[key] = { id, tool: out.component }
    return out
  } finally {
    b.stack.pop()
  }
}

function shape(b: Build, c: A2UIComponent, scope: string, key: string): Node | undefined {
  switch (c.component) {
    case "Card":
      return node(b, str(c.child), scope, key)
    case "Column":
      return layout(c, "show_stack", {
        items: kids(b, c.children, scope, key),
        ...(c.gap === "tight" || c.gap === "normal" ? { gap: c.gap } : {}),
      })
    case "Row":
      return columns(b, c, scope, key)
    case "List":
      return c.direction === "horizontal"
        ? columns(b, c, scope, key)
        : layout(c, "show_stack", { items: kids(b, c.children, scope, key) })
    case "Tabs":
      return layout(c, "show_tabs", { tabs: tabs(b, c, scope, key) })
    case "Grid":
      return layout(c, "show_grid", {
        ...(c.columns === 2 || c.columns === 3 ? { columns: c.columns } : {}),
        items: slots(b, c.items, scope, key, (item) =>
          item.span === undefined ? {} : { span: item.span },
        ),
      })
    case "Split": {
      const side = (name: "main" | "aside") =>
        node(b, str(c[name]), scope, join(key, name))
      const main = side("main")
      const aside = side("aside")
      return layout(c, "show_split", {
        ...(main ? { main: child(main) } : {}),
        ...(aside ? { aside: child(aside) } : {}),
        ...pick(c, ["asideWidth", "asidePosition"]),
      })
    }
    case "Steps":
      return layout(c, "show_steps", {
        ...text(b, "title", c.title, scope),
        steps: slots(b, c.steps, scope, key, (step) => ({
          ...text(b, "title", step.title, scope),
          ...text(b, "description", step.description, scope),
        })),
      })
    default: {
      const tool = b.state.tools[c.component]
      if (!tool) {
        if (b.state.preview) b.pending = true
        else
          b.error = `This part of the response used a component this app doesn't have (${c.component}).`
        return undefined
      }
      return { component: tool, props: leafProps(b, c, scope), id: c.id }
    }
  }
}

function layout(c: A2UIComponent, tool: string, props: Record<string, unknown>): Node {
  return { component: tool, props, id: c.id }
}

function columns(b: Build, c: A2UIComponent, scope: string, key: string): Node {
  const items = kids(b, c.children, scope, key)
  // Two per row for 2 or 4 items, three otherwise.
  return layout(c, "show_columns", {
    columns: items.length === 2 || items.length === 4 ? 2 : 3,
    items,
  })
}

/** A built node as a layout child. Binds name it by id, so keep ids the schema takes. */
function child(n: Node): Record<string, unknown> {
  return {
    component: n.component,
    props: n.props,
    ...(n.id && n.id.length <= 24 ? { id: n.id } : {}),
  }
}

/** The ids a ChildList names: a static list, or a template per data-model item. */
function childRefs(b: Build, list: unknown, scope: string): { id: string; scope: string }[] {
  if (Array.isArray(list)) {
    return list.filter((id) => typeof id === "string").map((id) => ({ id, scope }))
  }
  if (isRecord(list) && typeof list.componentId === "string" && typeof list.path === "string") {
    const path = absolute(scope, list.path)
    const items = readPointer(b.s.dataModel, path)
    if (items === undefined) b.pending = true
    if (!Array.isArray(items)) return []
    return items.map((_, i) => ({ id: list.componentId as string, scope: `${path}/${i}` }))
  }
  return []
}

/** A container's children, keyed "0", "1"… in the order they render. */
function kids(b: Build, list: unknown, scope: string, key: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const ref of childRefs(b, list, scope)) {
    const n = node(b, ref.id, ref.scope, join(key, String(out.length)))
    if (n) out.push(child(n))
  }
  return out
}

/** Items that each hold one child by id plus fields of their own (Grid, Steps). */
function slots(
  b: Build,
  list: unknown,
  scope: string,
  key: string,
  extra: (item: Record<string, unknown>) => Record<string, unknown>,
): Record<string, unknown>[] {
  if (!Array.isArray(list)) return []
  const out: Record<string, unknown>[] = []
  for (const item of list) {
    if (!isRecord(item)) continue
    const n = node(b, str(item.child), scope, join(key, String(out.length)))
    if (n) out.push({ ...child(n), ...extra(item) })
  }
  return out
}

function tabs(b: Build, c: A2UIComponent, scope: string, key: string) {
  if (!Array.isArray(c.tabs)) return []
  const out: Record<string, unknown>[] = []
  for (const tab of c.tabs) {
    if (!isRecord(tab)) continue
    const id = str(tab.child) || `tab-${out.length}`
    const target = b.s.components[str(tab.child)]
    let children: Record<string, unknown>[]
    if (
      target?.component === "Column" &&
      Array.isArray(target.children) &&
      target.children.length <= 3
    ) {
      // A tab already holds up to 3 components: flatten the Column into it.
      children = []
      for (const ref of childRefs(b, target.children, scope)) {
        const n = node(b, ref.id, ref.scope, join(key, `${id}.${children.length}`))
        if (n) children.push(child(n))
      }
    } else {
      const n = node(b, str(tab.child), scope, join(key, `${id}.0`))
      children = n ? [child(n)] : []
    }
    out.push({ id, ...text(b, "label", tab.title, scope), children })
  }
  return out
}

/** A text field that may be a literal or a data binding; left out until it resolves. */
function text(b: Build, field: string, value: unknown, scope: string): Record<string, unknown> {
  const v = b.state.dataBindings ? bound(b, value, scope) : value
  return typeof v === "string" ? { [field]: v } : {}
}

/** A leaf's props: everything but A2UI's own fields, with data bindings resolved. */
function leafProps(b: Build, c: A2UIComponent, scope: string): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(c)) {
    if (k === "id" || k === "component") continue
    const value = b.state.dataBindings ? bound(b, v, scope) : v
    if (value !== undefined) props[k] = value
  }
  return props
}

/** A value, or what its `{ path }` binding points to (pending until it arrives). */
function bound(b: Build, value: unknown, scope: string): unknown {
  if (!isDataBinding(value)) return value
  const v = readPointer(b.s.dataModel, absolute(scope, value.path))
  if (v === undefined) b.pending = true
  return v
}

function isDataBinding(v: unknown): v is { path: string } {
  return isRecord(v) && Object.keys(v).length === 1 && typeof v.path === "string"
}

// ---- Results back -------------------------------------------------------

type LayoutResult = { child: string; result: unknown }

function isLayoutResult(v: unknown): v is LayoutResult {
  return isRecord(v) && typeof v.child === "string" && "result" in v
}

/**
 * The `action` message for the user's result. Send it to the agent (it
 * carries the result in `context`), and reduce it into your state as well,
 * so the surface keeps its final state. Inside a layout, the action comes
 * from the child that acted, by its A2UI id. Pass the call object the state
 * gave you: that's how the child's id is found.
 *
 * `name` defaults to the result's own `action` ("confirm"), else the tool.
 */
export function toA2UIAction(
  call: GenUICall,
  result: unknown,
  {
    name,
    timestamp = new Date().toISOString(),
  }: { name?: string; timestamp?: string } = {},
): A2UIActionMessage {
  const keys = callKeys.get(call) ?? {}
  let path = ""
  let inner = result
  while (isLayoutResult(inner)) {
    const next = join(path, inner.child)
    if (!keys[next]) break
    path = next
    inner = inner.result
  }
  const source = keys[path] ?? { id: "root", tool: call.name }
  const action =
    isRecord(inner) && typeof inner.action === "string" ? inner.action : source.tool
  return {
    version: A2UI_VERSION,
    action: {
      name: name ?? action,
      surfaceId: call.id,
      sourceComponentId: source.id,
      timestamp,
      context: { component: source.tool, result: inner },
    },
  }
}

/** The call's result from a restored action: re-wrapped for the layout child that sent it. */
function restoredResult(s: A2UISurface, keys: ChildKeys): unknown {
  if (!s.action) return undefined
  const { sourceComponentId, result } = s.action
  const path = Object.keys(keys).find((k) => keys[k].id === sourceComponentId)
  if (!path) return result
  return path
    .split("/")
    .reduceRight<unknown>((inner, child) => ({ child, result: inner }), result)
}

/**
 * The `error` message telling the agent a surface failed validation, e.g.
 * with `validateGenUIInput(schema, call.props).message`. `path` points into
 * the agent's message, when you know where.
 */
export function toA2UIValidationError(
  call: GenUICall,
  message: string,
  { path = "/" }: { path?: string } = {},
): A2UIErrorMessage {
  return {
    version: A2UI_VERSION,
    error: { code: "VALIDATION_FAILED", surfaceId: call.id, path, message },
  }
}

/**
 * The `a2uiClientDataModel` metadata for the next message to the agent: the
 * data model of every surface created with `sendDataModel`. Undefined when
 * there are none.
 */
export function toA2UIClientDataModel(state: A2UIState) {
  const surfaces = state.surfaces.filter((s) => s.sendDataModel)
  if (!surfaces.length) return undefined
  return {
    version: A2UI_VERSION,
    surfaces: Object.fromEntries(surfaces.map((s) => [s.id, s.dataModel])),
  }
}

// ---- JSON Pointer -------------------------------------------------------

const BLOCKED = new Set(["__proto__", "prototype", "constructor"])

/** "/a/b~1c" → ["a", "b/c"]. "" and "/" are the whole model. */
function pointer(path: string): string[] {
  if (path === "" || path === "/") return []
  return path
    .replace(/^\//, "")
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"))
}

/** A path from a component: absolute, or relative to a template item. */
function absolute(scope: string, path: string): string {
  if (path.startsWith("/")) return path
  return `${scope}/${path}`
}

function readPointer(root: unknown, path: string): unknown {
  let current = root
  for (const segment of pointer(path)) {
    if (BLOCKED.has(segment)) return undefined
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(segment)) return undefined
      current = current[Number(segment)]
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

/** Sets (or removes) the value at a path, copying what it changes. */
function setPointer(
  root: unknown,
  segments: string[],
  value: unknown,
  remove: boolean,
): unknown {
  if (segments.length === 0) return remove ? {} : value
  const [head, ...tail] = segments
  if (BLOCKED.has(head)) return root
  if (Array.isArray(root) && /^\d+$/.test(head)) {
    const next = [...root]
    const i = Number(head)
    // Removing from an array leaves a hole, so later indexes keep their place.
    next[i] = tail.length === 0 && remove ? undefined : setPointer(root[i], tail, value, remove)
    return next
  }
  const base = isRecord(root) ? root : {}
  if (tail.length === 0 && remove) {
    const { [head]: _, ...rest } = base
    return rest
  }
  const existing = Object.hasOwn(base, head) ? base[head] : undefined
  const container =
    existing === undefined && tail.length > 0 && /^\d+$/.test(tail[0]) ? [] : existing
  return { ...base, [head]: setPointer(container, tail, value, remove) }
}

// ---- helpers ------------------------------------------------------------

function join(path: string, key: string): string {
  return path ? `${path}/${key}` : key
}

function pick(c: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) if (typeof c[f] === "string") out[f] = c[f]
  return out
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
