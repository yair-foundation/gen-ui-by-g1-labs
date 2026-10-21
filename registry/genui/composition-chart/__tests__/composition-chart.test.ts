import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  arcAngles,
  donutSlice,
  formatShare,
  OTHER,
  rankParts,
  squarify,
  waffleCounts,
} from "../composition-chart-utils"
import { compositionChartSchema } from "../composition-chart.schema"

describe("rankParts", () => {
  const totals = new Map([
    ["Rent", 1850],
    ["Gifts", 140],
    ["Groceries", 620],
    ["Transport", 230],
    ["Eating out", 410],
    ["Subscriptions", 95],
  ])

  it("orders parts largest first", () => {
    const { parts } = rankParts(totals)
    assert.deepEqual(
      parts.map((p) => p.label),
      ["Rent", "Groceries", "Eating out", "Transport", "Gifts", "Subscriptions"],
    )
  })

  it("folds the smallest into Other past the kept count", () => {
    const { parts, partOf } = rankParts(totals, 4)
    assert.deepEqual(
      parts.map((p) => p.label),
      ["Rent", "Groceries", "Eating out", "Transport", OTHER],
    )
    assert.equal(parts[4].total, 235)
    assert.equal(partOf("Gifts"), 4)
    assert.equal(partOf("Rent"), 0)
  })

  it("doesn't fold a single part into Other", () => {
    const five = new Map([...totals].slice(0, 5))
    assert.equal(rankParts(five, 4).parts.length, 5)
    assert.ok(!rankParts(five, 4).parts.some((p) => p.other))
  })
})

describe("waffleCounts", () => {
  it("always fills exactly 100 squares", () => {
    const counts = waffleCounts([1, 1, 1])
    assert.equal(counts.reduce((a, b) => a + b, 0), 100)
    assert.deepEqual(counts, [34, 33, 33])
  })

  it("gives no squares to nothing", () => {
    assert.deepEqual(waffleCounts([0, 0]), [0, 0])
  })
})

describe("squarify", () => {
  it("covers the area with one tile per positive value", () => {
    const rects = squarify([6, 6, 4, 3, 2, 2, 1], 600, 400)
    assert.equal(rects.length, 7)
    const area = rects.reduce((a, r) => a + r.w * r.h, 0)
    assert.ok(Math.abs(area - 600 * 400) < 1e-6)
    // Areas are proportional to the values.
    const six = rects.find((r) => r.index === 0)
    const one = rects.find((r) => r.index === 6)
    assert.ok(six && one)
    assert.ok(Math.abs((six.w * six.h) / (one.w * one.h) - 6) < 1e-6)
  })

  it("keeps tiles inside the box", () => {
    for (const r of squarify([5, 3, 2, 1, 1], 300, 200)) {
      assert.ok(r.x >= -1e-9 && r.y >= -1e-9)
      assert.ok(r.x + r.w <= 300 + 1e-6 && r.y + r.h <= 200 + 1e-6)
    }
  })
})

describe("donut geometry", () => {
  it("splits the circle by share", () => {
    const arcs = arcAngles([1, 3])
    assert.equal(arcs[0].start, 0)
    assert.ok(Math.abs(arcs[0].end - Math.PI / 2) < 1e-9)
    assert.ok(Math.abs(arcs[1].end - Math.PI * 2) < 1e-9)
  })

  it("draws a path, or nothing when the slice is smaller than its gap", () => {
    assert.ok(donutSlice(50, 50, 30, 45, 0, 1).startsWith("M"))
    assert.equal(donutSlice(50, 50, 30, 45, 0, 0.01, 4), "")
  })
})

describe("formatShare", () => {
  it("rounds to whole percents, with a decimal under 1%", () => {
    assert.equal(formatShare(1, 3), "33%")
    assert.equal(formatShare(1, 400), "0.3%")
  })
})

describe("schema", () => {
  it("needs a type, part, value and data", () => {
    const parsed = compositionChartSchema.safeParse({
      title: "Spend",
      part: { key: "category" },
      value: { key: "amount", label: "Spend" },
      data: [{ category: "Rent", amount: 1 }],
    })
    assert.equal(parsed.success, false)
  })
})
