import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { defineCatalog } from "@json-render/core"
import { createRenderer, useStateStore } from "@json-render/react"
import { schema } from "@json-render/react/schema"
import type * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { z } from "zod"

import {
  GENUI_LAYOUT_TOOLS,
  jsonRenderDescription,
  jsonRenderName,
  jsonRenderRules,
  toJsonRenderCatalog,
  toJsonRenderComponents,
} from "../genui-json-render"

const guidance = { useWhen: ["A thing is needed."], avoidWhen: ["It isn't."], rules: ["Be exact."] }
const entries = [
  {
    tool: {
      name: "show_note",
      description: "Show a note.\nUse when: A thing is needed.",
      inputSchema: z.object({ text: z.string(), tone: z.string().optional() }),
    },
    guidance,
  },
  {
    tool: { name: "pick_one", description: "Pick one.", inputSchema: z.object({ options: z.array(z.string()) }) },
    guidance,
  },
  { tool: { name: "show_stack", description: "Layout.", inputSchema: z.object({ items: z.array(z.unknown()) }) }, guidance },
]

/** Renders its text and, during render, reports a result once (effects don't run in SSR). */
let reported = false
function Note({ text, tone, status }: { text?: string; tone?: string; status?: string }) {
  return <p data-tone={tone ?? "none"} data-status={status ?? "ready"}>{text}</p>
}
function PickOne({ options = [], onResult }: { options?: string[]; onResult?: (r: unknown) => void }) {
  if (!reported) {
    reported = true
    onResult?.({ action: "select", value: options[0], label: `Option ${options[0]}` })
  }
  return <ul>{options.map((o) => <li key={o}>{o}</li>)}</ul>
}

describe("catalog", () => {
  it("names components in PascalCase and leaves out GenUI layouts", () => {
    assert.equal(jsonRenderName("pick_slot"), "PickSlot")
    assert.throws(() => jsonRenderName("x", { x: "lowercase" }))
    const { components } = toJsonRenderCatalog({ entries })
    assert.deepEqual(Object.keys(components), ["ShowNote", "PickOne"])
    assert.ok(GENUI_LAYOUT_TOOLS.has("show_stack"))
    assert.deepEqual(Object.keys(toJsonRenderCatalog({ entries, includeLayouts: true }).components), [
      "ShowNote",
      "PickOne",
      "ShowStack",
    ])
  })

  it("adds an optional result prop and keeps the component's own", () => {
    const props = toJsonRenderCatalog({ entries }).components.ShowNote.props as z.ZodObject
    assert.deepEqual(Object.keys(props.shape), ["text", "tone", "result"])
    assert.equal(props.safeParse({ text: "hi" }).success, true)
  })

  it("puts guidance in the description and rules in customRules", () => {
    assert.equal(
      jsonRenderDescription(entries[0]),
      "Show a note. Use when: A thing is needed. Avoid when: It isn't.",
    )
    const rules = jsonRenderRules(entries)
    assert.ok(rules.includes("ShowNote: Be exact."))
    assert.ok(rules.some((r) => r.includes("$bindState")))
  })

  it("is accepted by json-render's defineCatalog and appears in its prompt", () => {
    const catalog = defineCatalog(schema, { ...toJsonRenderCatalog({ entries }), actions: {} })
    const prompt = catalog.prompt({ customRules: jsonRenderRules(entries) })
    assert.ok(prompt.includes("ShowNote"))
    assert.ok(prompt.includes("PickOne: Be exact."))
  })
})

describe("rendering through json-render", () => {
  const Stack = ({ children }: { children?: React.ReactNode }) => <div data-stack="">{children}</div>
  const catalog = defineCatalog(schema, {
    components: {
      Stack: { props: z.object({}), description: "A vertical stack", slots: ["default"] },
      ...toJsonRenderCatalog({ entries }).components,
    },
    actions: {},
  })
  const genui = toJsonRenderComponents({
    entries,
    components: { show_note: Note, pick_one: PickOne },
    jsonRender: { useStateStore },
  })
  const Renderer = createRenderer(catalog, {
    Stack: ({ children }: { children?: React.ReactNode }) => <Stack>{children}</Stack>,
    // json-render passes { element, ... } to createRenderer components; adapt to the registry shape.
    ...Object.fromEntries(
      Object.entries(genui).map(([name, fn]) => [
        name,
        (p: { element: { props: unknown }; bindings?: Record<string, string>; emit: (e: string) => void; loading?: boolean }) =>
          fn({ props: p.element.props, bindings: p.bindings, emit: p.emit, loading: p.loading }),
      ]),
    ),
  } as never)

  it("renders GenUI components inside a spec, with $state resolved and nulls dropped", () => {
    const html = renderToStaticMarkup(
      <Renderer
        spec={{
          root: "stack",
          elements: {
            stack: { type: "Stack", props: {}, children: ["note"] },
            note: { type: "ShowNote", props: { text: { $state: "/greeting" }, tone: null }, children: [] },
          },
        }}
        state={{ greeting: "Hello from state" }}
      />,
    )
    assert.ok(html.includes("data-stack"))
    assert.ok(html.includes(">Hello from state</p>"))
    assert.ok(html.includes('data-tone="none"'))
  })

  it("writes a result to the bound state path, so another element can read it", () => {
    reported = false
    const changes: { path: string; value: unknown }[] = []
    renderToStaticMarkup(
      <Renderer
        spec={{
          root: "stack",
          elements: {
            stack: { type: "Stack", props: {}, children: ["pick"] },
            pick: { type: "PickOne", props: { options: ["a", "b"], result: { $bindState: "/choice" } }, children: [] },
          },
        }}
        state={{}}
        onStateChange={(c) => changes.push(...c)}
      />,
    )
    assert.deepEqual(changes, [
      { path: "/choice", value: { action: "select", value: "a", label: "Option a" } },
    ])
  })

  it("passes loading through as the streaming status", () => {
    const html = renderToStaticMarkup(
      <Renderer
        spec={{ root: "note", elements: { note: { type: "ShowNote", props: { text: "…" }, children: [] } } }}
        loading
      />,
    )
    assert.ok(html.includes('data-status="streaming"'))
  })
})
