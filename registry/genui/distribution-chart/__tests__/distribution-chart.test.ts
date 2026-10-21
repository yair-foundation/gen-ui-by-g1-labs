import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  makeBins,
  niceStep,
  niceTicks,
  precisionOf,
  quantile,
  splitGroups,
  stackDots,
  summarize,
} from "../distribution-chart-utils"
import { distributionChartSchema } from "../distribution-chart.schema"

describe("quantile and summarize", () => {
  it("interpolates quartiles", () => {
    const s = [1, 2, 3, 4, 5, 6, 7, 8]
    assert.equal(quantile(s, 0.5), 4.5)
    assert.equal(quantile(s, 0.25), 2.75)
  })

  it("flags values beyond 1.5 × IQR as outliers and stops whiskers inside", () => {
    const s = summarize([10, 11, 12, 12, 13, 14, 15, 40])
    assert.ok(s)
    assert.deepEqual(s.outliers, [40])
    assert.equal(s.high, 15)
    assert.equal(s.low, 10)
    assert.equal(s.n, 8)
  })

  it("is null for no values", () => {
    assert.equal(summarize([]), null)
  })
})

describe("niceStep and niceTicks", () => {
  it("rounds steps to 1, 2, 2.5 or 5 × 10ⁿ", () => {
    assert.equal(niceStep(3.7), 5)
    assert.equal(niceStep(0.18), 0.2)
    assert.equal(niceStep(23), 25)
  })

  it("covers the range with round ticks", () => {
    assert.deepEqual(niceTicks(12, 58, 5), [10, 20, 30, 40, 50, 60])
  })
})

describe("makeBins", () => {
  it("starts on a round edge and counts every value once", () => {
    const values = [12, 14, 19, 21, 22, 28, 33, 35, 41, 58]
    const bins = makeBins(values, 5)
    assert.equal(bins.width, 10)
    assert.equal(bins.start, 10)
    assert.equal(bins.counts.reduce((a, b) => a + b, 0), values.length)
    assert.deepEqual(bins.counts, [3, 3, 2, 1, 1])
  })
})

describe("splitGroups", () => {
  it("keeps groups in first-seen order and counts the hidden ones", () => {
    const items = ["a", "b", "a", "c", "d"].map((g) => ({ g }))
    const { groups, hidden } = splitGroups(items, (i) => i.g, 2)
    assert.deepEqual(
      groups.map((g) => [g.name, g.items.length]),
      [
        ["a", 2],
        ["b", 1],
      ],
    )
    assert.equal(hidden, 2)
  })
})

describe("stackDots", () => {
  it("stacks equal values outward from the centre line", () => {
    const { positions, tallest } = stackDots([5, 5, 5, 9], 0, 2)
    assert.deepEqual(
      positions.map((p) => p.offset),
      [0, 1, -1, 0],
    )
    assert.equal(positions[0].x, 5)
    assert.equal(tallest, 3)
  })
})

describe("schema", () => {
  it("needs individual values, at least five", () => {
    const parsed = distributionChartSchema.safeParse({
      title: "Delivery times",
      type: "histogram",
      measure: { key: "min", label: "Delivery time" },
      data: [{ min: 30 }, { min: 31 }],
    })
    assert.equal(parsed.success, false)
  })
})

describe("precisionOf", () => {
  it("matches the data's decimal places, up to 2", () => {
    assert.equal(precisionOf([27, 31, 40]), 0)
    assert.equal(precisionOf([27.3, 26.85]), 2)
    assert.equal(precisionOf([1.5, 2]), 1)
    assert.equal(precisionOf([0.12345]), 2)
  })
})
