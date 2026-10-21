import * as React from "react"
import { z } from "zod"

import { cleanOpenUIProps } from "./genui-openui"

/*
 * Use GenUI components inside json-render (https://json-render.dev,
 * Apache-2.0, by Vercel Labs).
 *
 * json-render has the model write one flat JSON spec, `{ root, elements,
 * state }`, using only the components in a catalog you define, and renders
 * it with a registry of React components. This file turns GenUI components
 * into catalog entries and registry components:
 *
 *   import { defineCatalog } from "@json-render/core"
 *   import { schema } from "@json-render/react/schema"
 *   import { defineRegistry, useStateStore } from "@json-render/react"
 *
 *   const catalog = defineCatalog(schema, {
 *     components: { ...yourComponents, ...toJsonRenderCatalog({ entries }).components },
 *   })
 *   const { registry } = defineRegistry(catalog, {
 *     components: {
 *       ...yourComponents,
 *       ...toJsonRenderComponents({ entries, components, jsonRender: { useStateStore } }),
 *     },
 *   })
 *
 * There is no dependency on @json-render/*: the types below are structural,
 * and you pass in the one hook this needs.
 *
 * The json-render API used here, checked against @json-render/core and
 * @json-render/react 0.21.0 (2026-10-10):
 *
 * - `defineCatalog(schema, { components: { Name: { props, description,
 *   slots } }, actions })`. `props` is a Zod schema; `slots` lists the named
 *   child slots (`[]` for a leaf). `catalog.prompt({ customRules })` builds
 *   the system prompt.
 *   Source: packages/react/src/schema.ts, packages/core/src/schema.ts
 * - `defineRegistry(catalog, { components })`: each component receives
 *   `{ props, children, slots, emit, on, bindings, loading }`. A prop written
 *   as `{ "$bindState": "/path" }` arrives resolved in `props`, with its path
 *   in `bindings[prop]`. `emit(event)` fires the element's `on[event]`
 *   action bindings; it carries no payload.
 *   Source: packages/react/src/catalog-types.ts, packages/react/src/renderer.tsx
 * - `useStateStore()` returns `{ state, get, set(path, value), ... }` inside
 *   the renderer's state provider.
 *   Source: packages/react/src/contexts/state.tsx
 *
 * How a GenUI result reaches the rest of the spec: each component gets an
 * extra `result` prop. When the model writes `"result": { "$bindState":
 * "/booking/slot" }`, the user's result is written to that path, and any
 * other element can read it with `{ "$state": "/booking/slot/label" }`. This
 * is json-render's equivalent of GenUI's `$bind`. The result also reaches
 * `GenUIJsonRenderResults` (for your app) and fires the element's `result`
 * event (for spec-defined actions).
 *
 * GenUI's own layouts (stack, grid, split, steps, tabs, columns) are left
 * out by default: in json-render the spec tree is the layout, built from
 * your container components.
 */

/** Same shape as the guidance each GenUI schema file exports. */
export type JsonRenderGuidance = {
  readonly useWhen: readonly string[]
  readonly avoidWhen: readonly string[]
  readonly rules: readonly string[]
}

/** One GenUI component, as its schema file exports it. */
export type JsonRenderEntry = {
  readonly tool: {
    readonly name: string
    readonly description: string
    readonly inputSchema: z.ZodType
  }
  readonly guidance: JsonRenderGuidance
}

/** What a json-render catalog entry needs. */
export type JsonRenderCatalogComponent = {
  props: z.ZodType
  description: string
  slots: string[]
}

/** What json-render passes a registry component (the fields used here). */
export type JsonRenderComponentContext = {
  props: unknown
  bindings?: Record<string, string>
  emit: (event: string) => void
  loading?: boolean
}

/** The json-render hook this needs, passed in so there's no hard dependency. */
export type JsonRenderBindings = {
  useStateStore: () => { set: (path: string, value: unknown) => void }
}

/** The tool names of GenUI's layout components. */
export const GENUI_LAYOUT_TOOLS: ReadonlySet<string> = new Set([
  "show_stack",
  "show_grid",
  "show_split",
  "show_steps",
  "show_tabs",
  "show_columns",
])

/** A GenUI result, as it reaches `GenUIJsonRenderResults`. */
export type GenUIJsonRenderResult = {
  /** The GenUI tool name, e.g. "pick_slot". */
  tool: string
  /** The json-render component name, e.g. "PickSlot". */
  component: string
  /** What the component returned through `onResult`. */
  result: unknown
}

/** Receives every GenUI result inside a json-render spec. Provide it around `<Renderer>`. */
export const GenUIJsonRenderResults = React.createContext<
  ((event: GenUIJsonRenderResult) => void) | undefined
>(undefined)

const pascalCase = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")

/** The json-render component name for a GenUI tool: "pick_slot" → "PickSlot". */
export function jsonRenderName(
  toolName: string,
  names?: Readonly<Record<string, string>>,
): string {
  const name = names?.[toolName] ?? pascalCase(toolName)
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(
      `[genui-json-render] "${name}" (for "${toolName}") isn't a PascalCase component name.`,
    )
  }
  return name
}

const guidanceLabel = /^(Use when|Avoid when|Rules):/

/** What the component is, then when to use it and when not to. Rules go to `catalog.prompt({ customRules })`. */
export function jsonRenderDescription(entry: JsonRenderEntry): string {
  const what = entry.tool.description
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !guidanceLabel.test(line))
    .join(" ")
  const { useWhen, avoidWhen } = entry.guidance
  return [
    what,
    useWhen.length ? `Use when: ${useWhen.join(" ")}` : "",
    avoidWhen.length ? `Avoid when: ${avoidWhen.join(" ")}` : "",
  ]
    .filter(Boolean)
    .join(" ")
}

/** The `result` prop each GenUI component gets in the catalog. */
export const resultPropSchema = z
  .unknown()
  .optional()
  .describe(
    'Write { "$bindState": "/some/path" } to store the user\'s result in state, so other elements can read it with { "$state": "/some/path/<field>" }.',
  )

/** The component's props for the catalog: its own schema plus `result`. */
export function jsonRenderPropsSchema(schema: z.ZodType): z.ZodType {
  if (!(schema instanceof z.ZodObject)) {
    throw new Error(
      "[genui-json-render] json-render needs a z.object schema for each component.",
    )
  }
  return schema.extend({ result: resultPropSchema })
}

/**
 * Rules for `catalog.prompt({ customRules })`: GenUI's data rule, how to use
 * a result elsewhere, then each component's rules prefixed with its name.
 */
export function jsonRenderRules(
  entries: readonly JsonRenderEntry[],
  names?: Readonly<Record<string, string>>,
): string[] {
  return [
    "Never invent DATA-BOUND fields. Fill them only from tool results, state you were given, or what the user said.",
    'To show what the user chose in one component inside another (e.g. the picked time in a confirmation), write the first one\'s result prop as { "$bindState": "/path" } and read a display-ready field from it with { "$state": "/path/label" }. Only copy values; never compute them.',
    ...entries.flatMap((entry) => {
      const name = jsonRenderName(entry.tool.name, names)
      return entry.guidance.rules.map((rule) => `${name}: ${rule}`)
    }),
  ]
}

export type ToJsonRenderOptions = {
  entries: readonly JsonRenderEntry[]
  /** json-render component names by tool name. Defaults to PascalCase ("pick_slot" → "PickSlot"). */
  names?: Readonly<Record<string, string>>
  /** Include GenUI's layout components. Default false: the spec tree is the layout. */
  includeLayouts?: boolean
}

const included = (entries: readonly JsonRenderEntry[], includeLayouts = false) =>
  entries.filter((e) => includeLayouts || !GENUI_LAYOUT_TOOLS.has(e.tool.name))

/** Catalog entries for `defineCatalog(schema, { components })`. Every GenUI component is a leaf. */
export function toJsonRenderCatalog({
  entries,
  names,
  includeLayouts,
}: ToJsonRenderOptions): {
  components: Record<string, JsonRenderCatalogComponent>
} {
  const components: Record<string, JsonRenderCatalogComponent> = {}
  for (const entry of included(entries, includeLayouts)) {
    const name = jsonRenderName(entry.tool.name, names)
    if (components[name]) {
      throw new Error(`[genui-json-render] Two components are named "${name}".`)
    }
    components[name] = {
      props: jsonRenderPropsSchema(entry.tool.inputSchema),
      description: jsonRenderDescription(entry),
      slots: [],
    }
  }
  return { components }
}

/**
 * Wraps a GenUI component as a json-render registry component: json-render's
 * props become the component's props, `loading` becomes `status:
 * "streaming"`, and `onResult` writes the result to the `result` prop's
 * bound state path, tells `GenUIJsonRenderResults`, and fires `result`.
 */
export function wrapForJsonRender({
  Component,
  tool,
  name,
  schema,
  jsonRender,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: any GenUI component
  Component: React.ComponentType<any>
  tool: string
  name: string
  schema: z.ZodType
  jsonRender: JsonRenderBindings
}) {
  function GenUIJsonRenderComponent({
    props,
    bindings,
    emit,
    loading,
  }: JsonRenderComponentContext) {
    const store = jsonRender.useStateStore()
    const report = React.useContext(GenUIJsonRenderResults)
    const all = (typeof props === "object" && props !== null ? props : {}) as Record<
      string,
      unknown
    >
    const { result: bound, ...rest } = all
    // A result already in state when the element mounts restores the
    // component's final state (a reloaded conversation). Later writes are the
    // component's own and must not flip it into a restored record. Only a
    // real result counts (every GenUI result has an `action`), so state can
    // hold a placeholder such as { label: "Pick a time" } for other elements.
    const [restored] = React.useState(() =>
      isGenUIResult(bound) ? bound : undefined,
    )
    const resultPath = bindings?.result

    return React.createElement(Component, {
      ...cleanOpenUIProps(rest, schema),
      status: loading ? "streaming" : undefined,
      result: restored,
      onResult: (value: unknown) => {
        if (resultPath) store.set(resultPath, value)
        report?.({ tool, component: name, result: value })
        emit("result")
      },
    })
  }
  GenUIJsonRenderComponent.displayName = `JsonRender(${name})`
  return GenUIJsonRenderComponent
}

/** True for a value shaped like a GenUI result: an object with a string `action`. */
export function isGenUIResult(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { action?: unknown }).action === "string"
  )
}

/** Registry components for `defineRegistry(catalog, { components })`, by json-render name. */
export function toJsonRenderComponents({
  entries,
  components,
  jsonRender,
  names,
  includeLayouts,
}: ToJsonRenderOptions & {
  /** GenUI tool name → component, e.g. `{ pick_slot: SlotPicker }`. */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous component map
  components: Readonly<Record<string, React.ComponentType<any>>>
  jsonRender: JsonRenderBindings
}): Record<string, (ctx: JsonRenderComponentContext) => React.ReactNode> {
  const out: Record<string, (ctx: JsonRenderComponentContext) => React.ReactNode> = {}
  for (const entry of included(entries, includeLayouts)) {
    const Component = components[entry.tool.name]
    if (!Component) continue
    const name = jsonRenderName(entry.tool.name, names)
    const Wrapped = wrapForJsonRender({
      Component,
      tool: entry.tool.name,
      name,
      schema: entry.tool.inputSchema,
      jsonRender,
    })
    out[name] = (ctx) => React.createElement(Wrapped, ctx)
  }
  return out
}
