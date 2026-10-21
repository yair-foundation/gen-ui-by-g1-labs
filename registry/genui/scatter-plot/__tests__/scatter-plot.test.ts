import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  describeCorrelation,
  formatMeasure,
  groupSlots,
  linearFit,
  OTHER,
  toNumber,
} from "../scatter-plot-utils"
import { scatterPlotSchema } from "../scatter-plot.schema"

describe("linearFit", () => {
  it("finds an exact line and r = 1", () => {
    const fit = linearFit([1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 })))
    assert.ok(fit)
    assert.equal(fit.slope, 2)
    assert.equal(fit.intercept, 1)
    assert.equal(fit.r, 1)
  })

  it("gives a negative r for a falling cloud", () => {
    const fit = linearFit([
      { x: 1, y: 9 },
      { x: 2, y: 7 },
      { x: 3, y: 8 },
      { x: 4, y: 4 },
      { x: 5, y: 3 },
    ])
    assert.ok(fit && fit.r < -0.8)
  })

  it("returns null when there's nothing to fit", () => {
    assert.equal(linearFit([{ x: 1, y: 1 }, { x: 2, y: 2 }]), null)
    assert.equal(linearFit([1, 1, 1].map((x, i) => ({ x, y: i }))), null)
  })
})

describe("describeCorrelation", () => {
  it("words the strength and direction", () => {
    assert.equal(describeCorrelation(0.82), "Strong positive")
    assert.equal(describeCorrelation(-0.5), "Moderate negative")
    assert.equal(describeCorrelation(0.25), "Weak positive")
    assert.equal(describeCorrelation(0.05), "No clear relationship")
  })
})

describe("groupSlots", () => {
  it("keeps up to three groups in first-seen order", () => {
    const { groups, slotOf } = groupSlots(["b", "a", "b", "c"])
    assert.deepEqual(groups, ["b", "a", "c"])
    assert.equal(slotOf("c"), 2)
  })

  it("folds a fourth group and beyond into Other", () => {
    const { groups, slotOf } = groupSlots(["a", "b", "c", "d", "e"])
    assert.deepEqual(groups, ["a", "b", "c", OTHER])
    assert.equal(slotOf("d"), 3)
    assert.equal(slotOf("e"), 3)
  })
})

describe("formatting", () => {
  it("reads numeric strings and drops the rest", () => {
    assert.equal(toNumber("12.5"), 12.5)
    assert.equal(toNumber(""), null)
    assert.equal(toNumber("n/a"), null)
  })

  it("adds the unit in full, not on the axis", () => {
    assert.equal(formatMeasure(12, { unit: "km" }, "full"), "12 km")
    assert.equal(formatMeasure(12, { unit: "km" }, "axis"), "12")
  })
})

describe("schema", () => {
  it("needs at least three points", () => {
    const parsed = scatterPlotSchema.safeParse({
      title: "Spend vs signups",
      x: { key: "spend", label: "Spend" },
      y: { key: "signups", label: "Signups" },
      data: [{ spend: 1, signups: 2 }],
    })
    assert.equal(parsed.success, false)
  })
})
