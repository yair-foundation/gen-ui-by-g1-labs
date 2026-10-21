import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { toJSONSchema, z } from "zod"

import { buildGenUIPrompt, pickEntries, toStrictJSONSchema } from "../genui-prompt"

const schema = z.object({
  title: z.string().max(40).describe("The heading"),
  count: z.number().min(1).max(10),
  items: z.array(z.object({ id: z.string().regex(/^[a-z]+$/) })).min(2).max(6),
  props: z.record(z.string(), z.unknown()),
  when: z.string().optional(),
})

describe("toStrictJSONSchema", () => {
  // biome-ignore lint/suspicious/noExplicitAny: loose JSON Schema in a test
  const out = toStrictJSONSchema(toJSONSchema(schema)) as Record<string, any>

  it("closes objects and drops the constraints strict mode rejects", () => {
    assert.equal(out.additionalProperties, false)
    assert.equal(out.properties.title.maxLength, undefined)
    assert.equal(out.properties.count.minimum, undefined)
    assert.equal(out.properties.items.maxItems, undefined)
    assert.equal(out.properties.items.minItems, 1)
    assert.equal(out.properties.items.items.properties.id.pattern, undefined)
    assert.equal(out.properties.items.items.additionalProperties, false)
    assert.equal(out.$schema, undefined)
  })

  it("moves what it removed into descriptions", () => {
    assert.equal(out.properties.title.description, "The heading. (at most 40 characters)")
    assert.match(out.properties.count.description, /min 1, max 10/)
    assert.match(out.properties.items.description, /at most 6 items, at least 2 items/)
  })

  it("turns an open record into a JSON string field", () => {
    assert.equal(out.properties.props.type, "string")
    assert.match(out.properties.props.description, /JSON string/)
  })

  it("keeps required as is", () => {
    assert.deepEqual(out.required, ["title", "count", "items", "props"])
  })
})

describe("buildGenUIPrompt strict option", () => {
  it("rewrites every tool's jsonSchema", () => {
    const { tools } = buildGenUIPrompt(
      [{ tool: { name: "t", description: "d", inputSchema: schema }, guidance: { useWhen: [], avoidWhen: [], rules: [] } }],
      { strict: true },
    )
    // biome-ignore lint/suspicious/noExplicitAny: loose JSON Schema in a test
    assert.equal((tools.t.jsonSchema as any).properties.title.maxLength, undefined)
  })
})

describe("pickEntries functions filter", () => {
  const tool = (name: string) => ({
    name,
    description: "",
    inputSchema: z.object({}),
  })
  const guidance = { useWhen: [], avoidWhen: [], rules: [] }
  const kit = [
    { tool: tool("show_scatter"), guidance, meta: { category: "visualize", functions: ["correlation", "distribution"] } },
    { tool: tool("show_chart"), guidance, meta: { category: "visualize", functions: ["trend-over-time", "comparison"] } },
    { tool: tool("show_summary"), guidance, meta: { category: "compose" } },
  ]
  const names = (entries: { tool: { name: string } }[]) => entries.map((e) => e.tool.name)

  it("keeps entries tagged with any of the functions", () => {
    assert.deepEqual(names(pickEntries(kit, { functions: ["correlation"] })), ["show_scatter"])
    assert.deepEqual(names(pickEntries(kit, { functions: ["Comparison", "distribution"] })), [
      "show_scatter",
      "show_chart",
    ])
  })

  it("leaves out untagged entries and combines with other filters", () => {
    assert.deepEqual(names(pickEntries(kit, { functions: ["trend-over-time"], categories: ["compose"] })), [])
  })
})
