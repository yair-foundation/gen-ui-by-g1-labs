import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { z } from "zod"

import { fileBrowserGuidance, fileBrowserTool } from "../../file-browser/file-browser.schema"
import {
  layoutColumnsGuidance,
  layoutColumnsSchema,
  layoutColumnsTool,
} from "../../layout-columns/layout-columns.schema"
import { layoutGridGuidance, layoutGridSchema, layoutGridTool } from "../../layout-grid/layout-grid.schema"
import { layoutSplitGuidance, layoutSplitSchema, layoutSplitTool } from "../../layout-split/layout-split.schema"
import { layoutStackGuidance, layoutStackSchema, layoutStackTool } from "../../layout-stack/layout-stack.schema"
import { layoutStepsGuidance, layoutStepsSchema, layoutStepsTool } from "../../layout-steps/layout-steps.schema"
import { layoutTabsGuidance, layoutTabsSchema, layoutTabsTool } from "../../layout-tabs/layout-tabs.schema"
import {
  A2UI_COMMON_TYPES,
  type A2UIMessage,
  a2uiRules,
  callsFromA2UI,
  callsFromA2UIMessages,
  createA2UIState,
  finishA2UI,
  previewA2UI,
  readA2UIJsonl,
  reduceA2UI,
  toA2UIAction,
  toA2UICatalog,
  toA2UICatalogDocument,
  toA2UIClientCapabilities,
  toA2UIClientDataModel,
  toA2UIValidationError,
} from "../genui-a2ui"

const guidance = { useWhen: ["A thing is needed."], avoidWhen: ["It isn't."], rules: ["Be exact."] }
const leaves = [
  {
    tool: {
      name: "show_note",
      description: "Show a note.\nUse when: A thing is needed.",
      inputSchema: z.object({ text: z.string(), tone: z.enum(["calm", "loud"]).default("calm") }),
    },
    guidance,
  },
  {
    tool: {
      name: "pick_one",
      description: "Pick one.",
      inputSchema: z.object({ options: z.array(z.string()) }),
    },
    guidance: { useWhen: [], avoidWhen: [], rules: [] },
  },
]
const layouts = [
  { tool: layoutStackTool, guidance: layoutStackGuidance },
  { tool: layoutColumnsTool, guidance: layoutColumnsGuidance },
  { tool: layoutTabsTool, guidance: layoutTabsGuidance },
  { tool: layoutGridTool, guidance: layoutGridGuidance },
  { tool: layoutSplitTool, guidance: layoutSplitGuidance },
  { tool: layoutStepsTool, guidance: layoutStepsGuidance },
]
const entries = [...leaves, ...layouts]
const CATALOG = "https://example.com/genui/catalog.json"
const tools = entries.map((e) => e.tool.name)

// biome-ignore lint/suspicious/noExplicitAny: loose JSON Schema in a test
type Loose = Record<string, any>

const v = "v0.9.1"
const create = (surfaceId = "s1", extra: Record<string, unknown> = {}): A2UIMessage => ({
  version: v,
  createSurface: { surfaceId, catalogId: CATALOG, ...extra },
})
const update = (components: Record<string, unknown>[], surfaceId = "s1"): A2UIMessage => ({
  version: v,
  updateComponents: { surfaceId, components },
})
const data = (path: string | undefined, value?: unknown, surfaceId = "s1"): A2UIMessage => ({
  version: v,
  updateDataModel: {
    surfaceId,
    ...(path === undefined ? {} : { path }),
    ...(value === undefined ? {} : { value }),
  },
})
const start = () => createA2UIState({ tools, catalogId: CATALOG })
const run = (...messages: A2UIMessage[]) => reduceA2UI(start(), messages)

describe("toA2UICatalog", () => {
  const catalog = toA2UICatalog({ entries, catalogId: CATALOG })
  const note = catalog.components.ShowNote as Loose

  it("names components in PascalCase and pins `component` to the name", () => {
    assert.equal(catalog.catalogId, CATALOG)
    assert.deepEqual(Object.keys(catalog.components), [
      "ShowNote",
      "PickOne",
      "Column",
      "Row",
      "Tabs",
      "Grid",
      "Split",
      "Steps",
    ])
    assert.deepEqual(note.properties.component, { const: "ShowNote" })
    assert.deepEqual(note.properties.id, { $ref: `${A2UI_COMMON_TYPES}#/$defs/ComponentId` })
    assert.equal(note.additionalProperties, false)
  })

  it("requires id, component and the props the agent must write", () => {
    // `tone` has a default, so the agent may leave it out.
    assert.deepEqual(note.required, ["id", "component", "text"])
  })

  it("describes what the component is and when to use it", () => {
    assert.equal(note.description, "Show a note. Use when: A thing is needed. Avoid when: It isn't.")
  })

  it("lets each top-level prop be a data binding or a bind", () => {
    const [value, binding, bind] = note.properties.text.anyOf
    assert.equal(value.type, "string")
    assert.deepEqual(binding, { $ref: `${A2UI_COMMON_TYPES}#/$defs/DataBinding` })
    assert.deepEqual(bind.required, ["$bind"])
    const plain = toA2UICatalog({ entries: leaves, dataBindings: false }).components.ShowNote as Loose
    assert.equal(plain.properties.text.type, "string")
  })

  it("references children by id, the way A2UI validators expect", () => {
    const column = catalog.components.Column as Loose
    assert.deepEqual(column.properties.children.$ref, `${A2UI_COMMON_TYPES}#/$defs/ChildList`)
    const tabs = catalog.components.Tabs as Loose
    assert.equal(tabs.properties.tabs.items.properties.child.$ref, `${A2UI_COMMON_TYPES}#/$defs/ComponentId`)
    const split = catalog.components.Split as Loose
    assert.deepEqual(split.required, ["id", "component", "main", "aside"])
  })

  it("only has the layouts whose GenUI layout is in the entries", () => {
    const some = toA2UICatalog({ entries: [...leaves, layouts[0], layouts[2]] })
    assert.deepEqual(Object.keys(some.components), ["ShowNote", "PickOne", "Column", "Tabs"])
  })

  it("points a component's $defs refs at its place in the catalog", () => {
    const files = toA2UICatalog({ entries: [{ tool: fileBrowserTool, guidance: fileBrowserGuidance }] })
    const schema = files.components.BrowseFiles as Loose
    assert.ok(schema.$defs)
    const refs = JSON.stringify(schema).match(/"\$ref":"#[^"]*"/g) ?? []
    assert.ok(refs.length > 0)
    for (const ref of refs) assert.match(ref, /"#\/components\/BrowseFiles\/\$defs\//)
  })

  it("throws on two components with one name", () => {
    assert.throws(() => toA2UICatalog({ entries: leaves, names: { pick_one: "ShowNote" } }), /Two components/)
  })
})

describe("toA2UICatalogDocument", () => {
  it("adds the anyComponent union the A2UI envelope references", () => {
    const catalog = toA2UICatalog({ entries: [...leaves, layouts[0]], catalogId: CATALOG })
    const doc = toA2UICatalogDocument(catalog) as Loose
    assert.equal(doc.$id, CATALOG)
    assert.equal(doc.catalogId, CATALOG)
    assert.deepEqual(doc.$defs.anyComponent.oneOf, [
      { $ref: "#/components/ShowNote" },
      { $ref: "#/components/PickOne" },
      { $ref: "#/components/Column" },
    ])
    assert.equal(doc.$defs.anyComponent.discriminator.propertyName, "component")
  })
})

describe("a2uiRules", () => {
  it("lists the layouts, binds, data bindings and each component's rules", () => {
    const rules = a2uiRules(entries)
    assert.match(rules[1], /Column, Row, Tabs, Grid, Split, Steps/)
    assert.ok(rules.some((r) => r.includes('"$bind"')))
    assert.ok(rules.some((r) => r.includes('{ "path": "/pointer" }')))
    assert.ok(rules.includes("ShowNote: Be exact."))
    assert.ok(!rules.some((r) => r.startsWith("ShowStack")))
  })
})

describe("toA2UIClientCapabilities", () => {
  it("advertises the catalog id, and the catalog itself when inline", () => {
    const catalog = toA2UICatalog({ entries: leaves, catalogId: CATALOG })
    assert.deepEqual(toA2UIClientCapabilities(catalog), { "v0.9": { supportedCatalogIds: [CATALOG] } })
    assert.deepEqual(toA2UIClientCapabilities(catalog, { inline: true })["v0.9"].inlineCatalogs, [catalog])
  })
})

describe("reduceA2UI: one component", () => {
  it("makes a call once the root arrives", () => {
    const created = run(create())
    assert.deepEqual(callsFromA2UI(created), [])
    const state = reduceA2UI(created, update([{ id: "root", component: "ShowNote", text: "Hi" }]))
    assert.deepEqual(callsFromA2UI(state), [
      { id: "s1", name: "show_note", props: { text: "Hi" }, status: "ready" },
    ])
  })

  it("streams while a bound value is missing, then fills it in", () => {
    let state = run(create(), update([{ id: "root", component: "ShowNote", text: { path: "/note/text" } }]))
    assert.equal(callsFromA2UI(state)[0].status, "streaming")
    assert.deepEqual(callsFromA2UI(state)[0].props, {})
    state = reduceA2UI(state, data("/note", { text: "Ready" }))
    assert.equal(callsFromA2UI(state)[0].status, "ready")
    assert.deepEqual(callsFromA2UI(state)[0].props, { text: "Ready" })
  })

  it("replaces a component's props on update, keeping its type when left out", () => {
    const state = run(
      create(),
      update([{ id: "root", component: "ShowNote", text: "One", tone: "loud" }]),
      update([{ id: "root", text: "Two" }]),
    )
    assert.deepEqual(callsFromA2UI(state)[0], { id: "s1", name: "show_note", props: { text: "Two" }, status: "ready" })
  })

  it("replaces and removes data model values", () => {
    let state = run(create(), update([{ id: "root", component: "ShowNote", text: { path: "/t" } }]), data(undefined, { t: "A" }))
    assert.deepEqual(callsFromA2UI(state)[0].props, { text: "A" })
    state = reduceA2UI(state, data("/t"))
    assert.equal(callsFromA2UI(state)[0].status, "streaming")
    assert.deepEqual(state.surfaces[0].dataModel, {})
  })

  it("fails a component the catalog doesn't have", () => {
    const [call] = callsFromA2UI(run(create(), update([{ id: "root", component: "Text", text: "Hi" }])))
    assert.equal(call.status, "failed")
    assert.match(call.error ?? "", /doesn't have \(Text\)/)
  })

  it("fails a tree that refers to itself", () => {
    const [call] = callsFromA2UI(
      run(create(), update([{ id: "root", component: "Column", children: ["a"] }, { id: "a", component: "Card", child: "root" }])),
    )
    assert.equal(call.status, "failed")
  })

  it("ignores surfaces for other catalogs, other versions and unknown surfaces", () => {
    const state = start()
    const basic = reduceA2UI(state, {
      version: v,
      createSurface: { surfaceId: "b", catalogId: "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json" },
    })
    assert.equal(basic, state)
    assert.equal(reduceA2UI(state, { version: "v0.8", surfaceUpdate: { surfaceId: "s1", components: [] } }), state)
    assert.equal(reduceA2UI(state, update([{ id: "root", component: "ShowNote", text: "Hi" }], "nope")), state)
  })

  it("keeps the first surface when one is created twice, and removes it on delete", () => {
    let state = run(create(), update([{ id: "root", component: "ShowNote", text: "Hi" }]))
    assert.equal(reduceA2UI(state, create()), state)
    state = reduceA2UI(state, { version: v, deleteSurface: { surfaceId: "s1" } })
    assert.deepEqual(callsFromA2UI(state), [])
    assert.deepEqual(state.surfaces, [])
  })

  it("keeps the order surfaces were created in", () => {
    const state = run(
      create("a"),
      create("b"),
      update([{ id: "root", component: "ShowNote", text: "B" }], "b"),
      update([{ id: "root", component: "ShowNote", text: "A" }], "a"),
    )
    assert.deepEqual(callsFromA2UI(state).map((c) => c.id), ["a", "b"])
  })
})

describe("reduceA2UI: layouts", () => {
  it("renders a Column as a stack, streaming until every child arrives", () => {
    let state = run(
      create(),
      update([
        { id: "root", component: "Column", children: ["note", "pick"] },
        { id: "note", component: "ShowNote", text: "Pick one" },
      ]),
    )
    let [call] = callsFromA2UI(state)
    assert.equal(call.name, "show_stack")
    assert.equal(call.status, "streaming")
    assert.equal((call.props.items as unknown[]).length, 1)

    state = reduceA2UI(state, update([{ id: "pick", component: "PickOne", options: ["A", "B"] }]))
    ;[call] = callsFromA2UI(state)
    assert.equal(call.status, "ready")
    assert.deepEqual(call.props, {
      items: [
        { component: "show_note", props: { text: "Pick one" }, id: "note" },
        { component: "pick_one", props: { options: ["A", "B"] }, id: "pick" },
      ],
    })
    assert.ok(layoutStackSchema.safeParse(call.props).success)
  })

  it("renders a Row as columns, unwrapping Cards", () => {
    const [call] = callsFromA2UI(
      run(
        create(),
        update([
          { id: "root", component: "Card", child: "row" },
          { id: "row", component: "Row", children: ["c1", "c2", "c3"] },
          { id: "c1", component: "Card", child: "n1" },
          { id: "n1", component: "ShowNote", text: "1" },
          { id: "c2", component: "ShowNote", text: "2" },
          { id: "c3", component: "ShowNote", text: "3" },
        ]),
      ),
    )
    assert.equal(call.name, "show_columns")
    assert.equal(call.props.columns, 3)
    assert.deepEqual((call.props.items as Loose[]).map((i) => i.id), ["n1", "c2", "c3"])
    assert.ok(layoutColumnsSchema.safeParse(call.props).success)
  })

  it("renders Tabs, flattening a tab's Column into the tab", () => {
    const [call] = callsFromA2UI(
      run(
        create(),
        update([
          {
            id: "root",
            component: "Tabs",
            tabs: [
              { title: "Overview", child: "over" },
              { title: { path: "/label" }, child: "more" },
            ],
          },
          { id: "over", component: "Column", children: ["a", "b"] },
          { id: "a", component: "ShowNote", text: "A" },
          { id: "b", component: "ShowNote", text: "B" },
          { id: "more", component: "ShowNote", text: "C" },
        ]),
        data("/label", "Details"),
      ),
    )
    assert.equal(call.name, "show_tabs")
    const tabs = call.props.tabs as Loose[]
    assert.deepEqual(tabs.map((t) => [t.id, t.label, t.children.length]), [
      ["over", "Overview", 2],
      ["more", "Details", 1],
    ])
    assert.ok(layoutTabsSchema.safeParse(call.props).success)
  })

  it("renders Grid, Split and Steps as their GenUI layouts", () => {
    const leaf = (id: string) => ({ id, component: "ShowNote", text: id })
    const grid = callsFromA2UI(
      run(create(), update([
        { id: "root", component: "Grid", columns: 3, items: [{ child: "a" }, { child: "b", span: "full" }] },
        leaf("a"),
        leaf("b"),
      ])),
    )[0]
    assert.equal(grid.name, "show_grid")
    assert.equal((grid.props.items as Loose[])[1].span, "full")
    assert.ok(layoutGridSchema.safeParse(grid.props).success)

    const split = callsFromA2UI(
      run(create(), update([
        { id: "root", component: "Split", main: "a", aside: "b", asideWidth: "wide" },
        leaf("a"),
        leaf("b"),
      ])),
    )[0]
    assert.equal(split.name, "show_split")
    assert.equal((split.props.main as Loose).id, "a")
    assert.ok(layoutSplitSchema.safeParse(split.props).success)

    const steps = callsFromA2UI(
      run(create(), update([
        {
          id: "root",
          component: "Steps",
          title: "Book it",
          steps: [{ title: "Pick", child: "a" }, { title: "Confirm", description: "Check it.", child: "b" }],
        },
        leaf("a"),
        leaf("b"),
      ])),
    )[0]
    assert.equal(steps.name, "show_steps")
    assert.deepEqual((steps.props.steps as Loose[]).map((s) => s.title), ["Pick", "Confirm"])
    assert.ok(layoutStepsSchema.safeParse(steps.props).success)
  })

  it("repeats a template child per data-model item, with relative paths", () => {
    let state = run(
      create(),
      update([
        { id: "root", component: "Row", children: { componentId: "card", path: "/plans" } },
        { id: "card", component: "ShowNote", text: { path: "name" } },
      ]),
    )
    assert.equal(callsFromA2UI(state)[0].status, "streaming")
    state = reduceA2UI(state, data("/plans", [{ name: "Basic" }, { name: "Pro" }]))
    const [call] = callsFromA2UI(state)
    assert.equal(call.status, "ready")
    assert.deepEqual((call.props.items as Loose[]).map((i) => i.props.text), ["Basic", "Pro"])
  })

  it("keeps binds between siblings for the Renderer to resolve", () => {
    const [call] = callsFromA2UI(
      run(
        create(),
        update([
          { id: "root", component: "Column", children: ["slot", "sum"] },
          { id: "slot", component: "PickOne", options: ["9:00"] },
          { id: "sum", component: "ShowNote", text: { $bind: "slot.label", default: "Not picked" } },
        ]),
      ),
    )
    assert.deepEqual((call.props.items as Loose[])[1].props.text, { $bind: "slot.label", default: "Not picked" })
  })
})

describe("finishA2UI", () => {
  it("renders what arrived: missing children are left out", () => {
    let state = run(create(), update([
      { id: "root", component: "Column", children: ["a", "gone"] },
      { id: "a", component: "ShowNote", text: "A" },
    ]))
    state = finishA2UI(state)
    const [call] = callsFromA2UI(state)
    assert.equal(call.status, "ready")
    assert.equal((call.props.items as unknown[]).length, 1)
  })

  it("fails a surface whose root never resolved", () => {
    const state = finishA2UI(run(create(), update([{ id: "root", component: "Card", child: "gone" }])))
    assert.equal(callsFromA2UI(state)[0].status, "failed")
  })
})

describe("streaming JSONL", () => {
  it("splits whole lines from the rest", () => {
    const { messages, rest, invalid } = readA2UIJsonl(
      `${JSON.stringify(create())}\nnot json\n\n{"version":"v0.9.1","updateCom`,
    )
    assert.equal(messages.length, 1)
    assert.deepEqual(invalid, ["not json"])
    assert.equal(rest, '{"version":"v0.9.1","updateCom')
  })

  it("previews a cut-off line without failing on a half-written name", () => {
    const state = run(create())
    const line = JSON.stringify(update([{ id: "root", component: "ShowNote", text: "Hello there" }]))
    const half = previewA2UI(state, line.slice(0, line.indexOf("ShowNote") + 4))
    assert.deepEqual(callsFromA2UI(half), [])
    const most = previewA2UI(state, line.slice(0, line.indexOf("there")))
    const [call] = callsFromA2UI(most)
    assert.equal(call.name, "show_note")
    assert.deepEqual(call.props, { text: "Hello " })
    assert.deepEqual(callsFromA2UI(state), [])
  })
})

describe("results", () => {
  const at = "2026-10-23T10:00:00.000Z"

  it("sends a result as an action, and restores it when reduced back", () => {
    const state = run(create(), update([{ id: "root", component: "Card", child: "pick" }, { id: "pick", component: "PickOne", options: ["A"] }]))
    const [call] = callsFromA2UI(state)
    const result = { action: "select", value: "A", label: "A" }
    const message = toA2UIAction(call, result, { timestamp: at })
    assert.deepEqual(message, {
      version: "v0.9.1",
      action: {
        name: "select",
        surfaceId: "s1",
        sourceComponentId: "pick",
        timestamp: at,
        context: { component: "pick_one", result },
      },
    })
    const restored = callsFromA2UI(reduceA2UI(state, message))[0]
    assert.deepEqual(restored.result, result)
  })

  it("reports a layout child's result from that child, and round-trips it", () => {
    const state = run(
      create(),
      update([
        { id: "root", component: "Tabs", tabs: [{ title: "One", child: "one" }, { title: "Two", child: "col" }] },
        { id: "one", component: "ShowNote", text: "1" },
        { id: "col", component: "Column", children: ["n", "row"] },
        { id: "n", component: "ShowNote", text: "2" },
        { id: "row", component: "Row", children: ["x", "pick"] },
        { id: "x", component: "ShowNote", text: "3" },
        { id: "pick", component: "PickOne", options: ["A"] },
      ]),
    )
    const [call] = callsFromA2UI(state)
    // What the Renderer sends for the picker: tabs key, then the row's key.
    const result = { child: "col.1", result: { child: "1", result: { action: "select", value: "A" } } }
    const message = toA2UIAction(call, result, { timestamp: at })
    assert.equal(message.action.sourceComponentId, "pick")
    assert.deepEqual(message.action.context, { component: "pick_one", result: { action: "select", value: "A" } })
    assert.deepEqual(callsFromA2UI(reduceA2UI(state, message))[0].result, result)
  })

  it("falls back to the root for a call it didn't build", () => {
    const message = toA2UIAction({ id: "s9", name: "pick_one", props: {}, status: "ready" }, { value: 1 }, { timestamp: at })
    assert.equal(message.action.sourceComponentId, "root")
    assert.equal(message.action.name, "pick_one")
  })

  it("restores results from stored messages", () => {
    const history = [create(), update([{ id: "root", component: "PickOne", options: ["A"] }])]
    const call = callsFromA2UIMessages(history, { tools, catalogId: CATALOG })[0]
    const action = toA2UIAction(call, { action: "select", value: "A" }, { timestamp: at })
    const [restored] = callsFromA2UIMessages([...history, action], { tools, catalogId: CATALOG })
    assert.deepEqual(restored.result, { action: "select", value: "A" })
    assert.equal(restored.status, "ready")
  })

  it("words a validation error for the agent", () => {
    const call = { id: "s1", name: "show_note", props: {}, status: "ready" as const }
    assert.deepEqual(toA2UIValidationError(call, "text: Required", { path: "/components/0/text" }), {
      version: "v0.9.1",
      error: { code: "VALIDATION_FAILED", surfaceId: "s1", path: "/components/0/text", message: "text: Required" },
    })
  })

  it("sends the data model of surfaces that ask for it", () => {
    const state = run(create("a", { sendDataModel: true }), create("b"), data("/x", 1, "a"), data("/y", 2, "b"))
    assert.deepEqual(toA2UIClientDataModel(state), { version: "v0.9.1", surfaces: { a: { x: 1 } } })
    assert.equal(toA2UIClientDataModel(run(create())), undefined)
  })
})
