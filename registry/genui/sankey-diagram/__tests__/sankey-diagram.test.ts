import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { bandPath, cleanFlows, layoutSankey, spreadLabels, traceFrom } from "../sankey-diagram-utils"
import { sankeyDiagramSchema } from "../sankey-diagram.schema"

const income = [
  { source: "Salary", target: "Income", value: 5200 },
  { source: "Freelance", target: "Income", value: 800 },
  { source: "Income", target: "Housing", value: 2100 },
  { source: "Income", target: "Food", value: 950 },
  { source: "Income", target: "Savings", value: 2950 },
  { source: "Food", target: "Groceries", value: 610 },
  { source: "Food", target: "Eating out", value: 340 },
]

describe("cleanFlows", () => {
  it("merges duplicates and drops empty flows and self-links", () => {
    const { kept, dropped } = cleanFlows([
      { source: "A", target: "B", value: 2 },
      { source: "A", target: "B", value: 3 },
      { source: "A", target: "A", value: 1 },
      { source: "B", target: "C", value: 0 },
    ])
    assert.deepEqual(kept, [{ source: "A", target: "B", value: 5 }])
    assert.equal(dropped.length, 2)
  })

  it("drops a flow that would close a loop", () => {
    const { kept, dropped } = cleanFlows([
      { source: "A", target: "B", value: 1 },
      { source: "B", target: "C", value: 1 },
      { source: "C", target: "A", value: 1 },
    ])
    assert.equal(kept.length, 2)
    assert.deepEqual(dropped, [{ source: "C", target: "A", value: 1 }])
  })
})

describe("layoutSankey", () => {
  const layout = layoutSankey(income, 400, 300)
  const node = (name: string) => {
    const n = layout.nodes.find((x) => x.name === name)
    assert.ok(n, name)
    return n
  }

  it("puts nodes in stages by longest path, sinks in the last", () => {
    assert.equal(layout.columns, 4)
    assert.equal(node("Salary").column, 0)
    assert.equal(node("Income").column, 1)
    assert.equal(node("Food").column, 2)
    // Nothing flows out of Housing or Savings: they sit with the other ends.
    assert.equal(node("Housing").column, 3)
    assert.equal(node("Groceries").column, 3)
  })

  it("sizes nodes by what flows through them, on one scale", () => {
    const income = node("Income")
    const food = node("Food")
    assert.equal(income.value, 6000)
    const ratio = (income.y1 - income.y0) / (food.y1 - food.y0)
    assert.ok(Math.abs(ratio - 6000 / 950) < 1e-6)
  })

  it("keeps everything inside the box", () => {
    for (const n of layout.nodes) {
      assert.ok(n.x0 >= 0 && n.x1 <= 400 + 1e-6)
      assert.ok(n.y0 >= -1e-6 && n.y1 <= 300 + 1e-6)
    }
  })

  it("stacks bands inside their nodes", () => {
    const food = layout.nodes.findIndex((n) => n.name === "Food")
    const out = layout.links.filter((l) => l.source === food)
    const n = layout.nodes[food]
    for (const l of out) {
      assert.ok(l.sy - l.width / 2 >= n.y0 - 1e-6 && l.sy + l.width / 2 <= n.y1 + 1e-6)
    }
  })
})

describe("traceFrom", () => {
  it("follows flows up and down from a node", () => {
    const { nodes, links } = layoutSankey(income, 400, 300)
    const food = nodes.findIndex((n) => n.name === "Food")
    const traced = traceFrom(food, links)
    const names = [...traced.nodes].map((i) => nodes[i].name).sort()
    assert.deepEqual(names, ["Eating out", "Food", "Freelance", "Groceries", "Income", "Salary"])
    assert.equal(traced.links.size, 5)
  })
})

describe("bandPath", () => {
  it("draws a horizontal S-curve", () => {
    assert.equal(bandPath(0, 10, 100, 50), "M0 10C50 10 50 50 100 50")
  })
})

describe("schema", () => {
  it("needs at least two flows", () => {
    const parsed = sankeyDiagramSchema.safeParse({
      title: "Income",
      source: "from",
      target: "to",
      value: { key: "amount", label: "Amount" },
      data: [{ from: "A", to: "B", amount: 1 }],
    })
    assert.equal(parsed.success, false)
  })
})

describe("spreadLabels", () => {
  it("leaves labels that don't collide where they are", () => {
    assert.deepEqual(spreadLabels([20, 80, 140], 30, 0, 200), [20, 80, 140])
  })

  it("pushes colliding labels apart and keeps them inside", () => {
    const ys = spreadLabels([150, 160, 170, 180], 30, 0, 200)
    for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= 30 - 1e-9)
    assert.ok(ys[ys.length - 1] <= 200 && ys[0] >= 0)
  })
})
