import * as React from "react"
import { z } from "zod"

/*
 * Use GenUI components inside OpenUI (https://www.openui.com, MIT, by Thesys).
 *
 * OpenUI has the model write "OpenUI Lang" instead of tool calls, and renders
 * it with components you register in a library. This file turns GenUI
 * components into OpenUI components:
 *
 *   import * as openui from "@openuidev/react-lang"
 *   const library = toOpenUILibrary({ entries, components, openui })
 *
 * There is no dependency on @openuidev/*: the types below are structural, and
 * you pass in the OpenUI functions you already installed.
 *
 * The OpenUI API used here, as documented (checked 2026-10-08):
 *
 * - `defineComponent({ name, props, description, component })`: `props` is a
 *   `z.object(...)` whose key order sets positional argument order; the
 *   renderer receives `{ props, renderNode }`; each defined component exposes
 *   `.ref` for use in parent schemas, e.g. `z.array(Child.ref)`.
 *   https://www.openui.com/docs/openui-lang/defining-components
 *   Source: https://github.com/thesysdev/openui/blob/main/packages/react-lang/src/library.ts
 *   (`ComponentRenderProps` also carries `statementId`, the variable name of
 *   the statement: packages/lang-core/src/library.ts)
 * - `createLibrary({ components, root?, componentGroups? })`; `root` is the
 *   entry point the model must use (`root = Root(...)`).
 *   https://www.openui.com/docs/openui-lang/defining-components
 * - `library.prompt({ preamble?, additionalRules?, examples? })` builds the
 *   system prompt from each component's signature and `description`.
 *   https://www.openui.com/docs/openui-lang/system-prompts
 * - `useIsStreaming(): boolean` (the whole response is still streaming) and
 *   `useTriggerAction()`, which returns
 *   `triggerAction(userMessage, formName?, action?)`. An `action` of
 *   `{ type, params }` reaches `<Renderer onAction>` as the `ActionEvent`
 *   `{ type, params, humanFriendlyMessage, formState?, formName? }`.
 *   https://www.openui.com/docs/openui-lang/interactivity
 *   https://www.openui.com/docs/api-reference/react-lang
 *   Source: https://github.com/thesysdev/openui/blob/main/packages/react-lang/src/hooks/useOpenUIState.ts
 */

/** Same shape as the guidance each GenUI schema file exports. */
export type OpenUIGuidance = {
  readonly useWhen: readonly string[]
  readonly avoidWhen: readonly string[]
  readonly rules: readonly string[]
}

/** A GenUI schema file's tool and guidance, e.g. `{ tool: checklistTool, guidance: checklistGuidance }`. */
export type OpenUIEntry = {
  readonly tool: {
    readonly name: string
    readonly description: string
    readonly inputSchema: z.ZodType
  }
  readonly guidance: OpenUIGuidance
}

/** What OpenUI passes to a component renderer (`ComponentRenderProps`). */
export type OpenUIRenderProps = {
  props: Record<string, unknown>
  renderNode: (value: unknown) => React.ReactNode
  statementId?: string
}

/** A component returned by OpenUI's `defineComponent`. */
export type OpenUIDefinedComponent = { name: string; ref: unknown }

/** The config OpenUI's `defineComponent` takes. */
export type OpenUIComponentConfig = {
  name: string
  // biome-ignore lint/suspicious/noExplicitAny: OpenUI expects a Zod 4 object schema
  props: any
  description: string
  component: (renderProps: OpenUIRenderProps) => React.ReactNode
}

/** The parts of `@openuidev/react-lang` this file uses. Pass the module itself. */
export type OpenUIBindings<D extends OpenUIDefinedComponent> = {
  // biome-ignore lint/suspicious/noExplicitAny: matches OpenUI's generic signature
  defineComponent: (config: any) => D
  useIsStreaming: () => boolean
  useTriggerAction: () => (
    userMessage: string,
    formName?: string,
    action?: { type?: string; params?: Record<string, unknown> },
  ) => void | Promise<void>
}

/** The `ActionEvent.type` a GenUI result is sent with. */
export const GENUI_RESULT_ACTION = "genui_result"

/** `ActionEvent.params` for a GenUI result. */
export type GenUIResultParams = {
  /** The GenUI tool name, e.g. "propose_changes". */
  tool: string
  /** The OpenUI component name, e.g. "ProposeChanges". */
  component: string
  /** The OpenUI statement the component came from, when it has one. */
  statementId?: string
  /** What the component returned through `onResult`. */
  result: unknown
}

/** True when an OpenUI `ActionEvent` carries a GenUI result. */
export function isGenUIResultEvent(event: {
  type: string
  params: Record<string, unknown>
}): event is { type: typeof GENUI_RESULT_ACTION; params: GenUIResultParams } {
  return event.type === GENUI_RESULT_ACTION && "result" in event.params
}

/**
 * Stored results, keyed by OpenUI statement id, so finished components
 * restore their final state when a conversation is reloaded. Wrap each
 * message's `<Renderer>` in its own provider (statement ids repeat across
 * messages).
 */
export const GenUIOpenUIResults = React.createContext<
  Readonly<Record<string, unknown>> | undefined
>(undefined)

export type ToOpenUIOptions<D extends OpenUIDefinedComponent> = {
  entries: readonly OpenUIEntry[]
  /** GenUI tool name → component, e.g. `{ propose_changes: ChangePreview }`. */
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous component map
  components: Readonly<Record<string, React.ComponentType<any>>>
  openui: OpenUIBindings<D>
  /**
   * OpenUI component names by tool name. Defaults to PascalCase of the tool
   * name ("propose_changes" → "ProposeChanges"): OpenUI Lang reads PascalCase
   * identifiers as components.
   */
  names?: Readonly<Record<string, string>>
  /**
   * Put required props before optional ones, as OpenUI recommends (the model
   * writes arguments by position). Schemas with object-level refinements keep
   * their order. Default true.
   */
  requiredFirst?: boolean
  /** The chat message shown for a result. Defaults to "ProposeChanges: confirm". */
  describeResult?: (name: string, result: unknown) => string
}

const pascalCase = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("")

/** The OpenUI component name for a GenUI tool. */
export function openUIName(
  toolName: string,
  names?: Readonly<Record<string, string>>,
): string {
  const name = names?.[toolName] ?? pascalCase(toolName)
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) {
    throw new Error(
      `[genui-openui] "${name}" (for "${toolName}") isn't a PascalCase component name.`,
    )
  }
  return name
}

const guidanceLabel = /^(Use when|Avoid when|Rules):/

/**
 * The description OpenUI puts next to the component's signature in its
 * prompt: what it is, then when to use it and when not to. Rules go into
 * `library.prompt({ additionalRules })` instead (see `openUIRules`).
 */
export function openUIDescription(entry: OpenUIEntry): string {
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

/**
 * Rules for `library.prompt({ additionalRules })`: GenUI's data rule, then
 * each component's rules prefixed with its OpenUI name.
 */
export function openUIRules(
  entries: readonly OpenUIEntry[],
  names?: Readonly<Record<string, string>>,
): string[] {
  return [
    "Never invent DATA-BOUND fields. Fill them only from tool results or what the user said.",
    ...entries.flatMap((entry) => {
      const name = openUIName(entry.tool.name, names)
      return entry.guidance.rules.map((rule) => `${name}: ${rule}`)
    }),
  ]
}

// Zod 4 internals, read the same way OpenUI reads them
// (packages/lang-core/src/library.ts: optional, default and nullable fields
// count as optional).
type ZodInternals = {
  _zod?: {
    def?: { type?: string; shape?: Record<string, unknown>; checks?: unknown[] }
  }
  safeParse?: (value: unknown) => { success: boolean }
}

const zodDef = (schema: unknown) => (schema as ZodInternals)?._zod?.def

function isOptionalField(field: unknown) {
  const type = zodDef(field)?.type
  return type === "optional" || type === "default" || type === "nullable"
}

/** The tool's object schema, required keys first unless it has refinements. */
export function openUIPropsSchema(
  schema: z.ZodType,
  requiredFirst = true,
): z.ZodType {
  const def = zodDef(schema)
  if (def?.type !== "object" || !def.shape) {
    throw new Error(
      "[genui-openui] OpenUI needs a z.object schema for each component.",
    )
  }
  if (!requiredFirst || def.checks?.length) return schema
  const keys = Object.keys(def.shape)
  const required = keys.filter((k) => !isOptionalField(def.shape?.[k]))
  const optional = keys.filter((k) => isOptionalField(def.shape?.[k]))
  const ordered = [...required, ...optional]
  if (ordered.every((k, i) => k === keys[i])) return schema
  return z.object(
    Object.fromEntries(
      ordered.map((k) => [k, def.shape?.[k] as z.ZodType]),
    ) as Record<string, z.ZodType>,
  )
}

/**
 * The model skips an optional argument by writing `null` in its place.
 * GenUI components expect such props to be absent, so drop top-level nulls
 * unless the field accepts null.
 */
export function cleanOpenUIProps(
  props: Record<string, unknown>,
  schema: z.ZodType,
): Record<string, unknown> {
  const shape = zodDef(schema)?.shape ?? {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (value === null) {
      const field = shape[key] as ZodInternals | undefined
      if (!field?.safeParse?.(null).success) continue
    }
    out[key] = value
  }
  return out
}

const defaultDescribeResult = (name: string, result: unknown) => {
  const action =
    typeof result === "object" &&
    result !== null &&
    typeof (result as { action?: unknown }).action === "string"
      ? (result as { action: string }).action
      : "submitted"
  return `${name}: ${action}`
}

/**
 * Wraps a GenUI component as an OpenUI renderer: OpenUI's props become the
 * component's props, the response's streaming state becomes
 * `status: "streaming"`, and `onResult` fires an OpenUI action of type
 * `GENUI_RESULT_ACTION` that reaches `<Renderer onAction>`.
 */
export function wrapForOpenUI({
  Component,
  tool,
  name,
  schema,
  openui,
  describeResult = defaultDescribeResult,
}: {
  // biome-ignore lint/suspicious/noExplicitAny: any GenUI component
  Component: React.ComponentType<any>
  tool: string
  name: string
  schema: z.ZodType
  openui: Pick<
    OpenUIBindings<OpenUIDefinedComponent>,
    "useIsStreaming" | "useTriggerAction"
  >
  describeResult?: (name: string, result: unknown) => string
}) {
  function GenUIOpenUIComponent({ props, statementId }: OpenUIRenderProps) {
    const isStreaming = openui.useIsStreaming()
    const triggerAction = openui.useTriggerAction()
    const results = React.useContext(GenUIOpenUIResults)
    const result = statementId ? results?.[statementId] : undefined
    return React.createElement(Component, {
      ...cleanOpenUIProps(props, schema),
      // Like GenUIRenderer: when ready, the component tracks the decision.
      status: isStreaming ? "streaming" : undefined,
      result,
      onResult: (value: unknown) => {
        const params: GenUIResultParams = {
          tool,
          component: name,
          statementId,
          result: value,
        }
        void triggerAction(describeResult(name, value), undefined, {
          type: GENUI_RESULT_ACTION,
          params,
        })
      },
    })
  }
  GenUIOpenUIComponent.displayName = `OpenUI(${name})`
  return GenUIOpenUIComponent
}

/** One OpenUI component per entry, ready for `createLibrary({ components })`. */
export function toOpenUIComponents<D extends OpenUIDefinedComponent>({
  entries,
  components,
  openui,
  names,
  requiredFirst = true,
  describeResult,
}: ToOpenUIOptions<D>): D[] {
  return entries.map((entry) => {
    const tool = entry.tool.name
    const Component = components[tool]
    if (!Component) {
      throw new Error(`[genui-openui] No component given for "${tool}".`)
    }
    if ((Component as { genuiLayout?: boolean }).genuiLayout) {
      throw new Error(
        `[genui-openui] "${tool}" is a GenUI layout. In OpenUI, compose with OpenUI's own layout components instead.`,
      )
    }
    const name = openUIName(tool, names)
    const schema = openUIPropsSchema(entry.tool.inputSchema, requiredFirst)
    return openui.defineComponent({
      name,
      props: schema,
      description: openUIDescription(entry),
      component: wrapForOpenUI({
        Component,
        tool,
        name,
        schema,
        openui,
        describeResult,
      }),
    } satisfies OpenUIComponentConfig)
  })
}

/** Name of the root `toOpenUILibrary` adds when you don't pass one. */
export const GENUI_OPENUI_ROOT = "GenUIStack"

/**
 * A complete OpenUI library: the GenUI components, plus a `GenUIStack` root
 * that stacks them (OpenUI responses always start with `root = Root(...)`).
 * Pass `root` and `extraComponents` to use your own root instead.
 */
export function toOpenUILibrary<D extends OpenUIDefinedComponent, L>({
  openui,
  root,
  extraComponents = [],
  componentGroups,
  ...options
}: Omit<ToOpenUIOptions<D>, "openui"> & {
  openui: OpenUIBindings<D> & {
    createLibrary: (input: {
      components: D[]
      root?: string
      componentGroups?: {
        name: string
        components: string[]
        notes?: string[]
      }[]
    }) => L
  }
  /** Your own root component's name (it must be in `extraComponents`). */
  root?: string
  /** More OpenUI components, e.g. your own layout components. */
  extraComponents?: D[]
  componentGroups?: { name: string; components: string[]; notes?: string[] }[]
}): L {
  const genui = toOpenUIComponents({ ...options, openui })
  if (root) {
    return openui.createLibrary({
      components: [...extraComponents, ...genui],
      root,
      componentGroups,
    })
  }
  const children = [...extraComponents, ...genui].map((c) => c.ref as z.ZodType)
  const child =
    children.length === 1
      ? children[0]
      : z.union(children as [z.ZodType, z.ZodType, ...z.ZodType[]])
  const stack = openui.defineComponent({
    name: GENUI_OPENUI_ROOT,
    props: z.object({
      children: z
        .array(child)
        .describe("The components of the response, in reading order."),
    }),
    description:
      "The response: stacks its children vertically, in order. Always the root.",
    component: ({ props, renderNode }) =>
      React.createElement(
        "div",
        {
          "data-slot": "genui-openui-stack",
          className: "flex flex-col gap-3 [&>[data-genui]+[data-genui]]:mt-3",
        },
        renderNode(props.children),
      ),
  } satisfies OpenUIComponentConfig)
  return openui.createLibrary({
    components: [stack, ...extraComponents, ...genui],
    root: GENUI_OPENUI_ROOT,
    componentGroups,
  })
}
