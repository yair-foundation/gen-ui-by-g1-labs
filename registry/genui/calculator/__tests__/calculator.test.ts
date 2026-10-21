import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  bandIndex,
  bandPosition,
  calculatorSchema,
  sliderRange,
  statColumns,
} from "../calculator.schema"

const bmi = [
  { label: "Under", below: 18.5 },
  { label: "Healthy", below: 25 },
  { label: "Over", below: 30 },
  { label: "Obese" },
]

describe("statColumns", () => {
  it("never leaves one tile alone on a row", () => {
    for (let n = 1; n <= 8; n++) {
      for (const max of [2, 3, 4]) {
        const { columns, lead } = statColumns(n, max)
        const rest = lead ? n - 1 : n
        assert.ok(
          columns === 1 || rest % columns !== 1,
          `${n} tiles, max ${max}`,
        )
      }
    }
  })

  it("puts up to 4 tiles in one row, and splits more evenly", () => {
    assert.deepEqual(statColumns(4), { columns: 4, lead: false })
    assert.deepEqual(statColumns(3), { columns: 3, lead: false })
    assert.deepEqual(statColumns(5), { columns: 3, lead: false })
    assert.deepEqual(statColumns(6), { columns: 3, lead: false })
    assert.deepEqual(statColumns(7), { columns: 4, lead: false })
  })

  it("lets the primary tile lead when the count is odd on two columns", () => {
    assert.deepEqual(statColumns(3, 2), { columns: 2, lead: true })
  })
})

describe("bandIndex", () => {
  it("finds the band, with bounds exclusive", () => {
    assert.equal(bandIndex(17, bmi), 0)
    assert.equal(bandIndex(18.5, bmi), 1)
    assert.equal(bandIndex(24.9, bmi), 1)
    assert.equal(bandIndex(51.2, bmi), 3)
  })
})

describe("bandPosition", () => {
  it("places the value proportionally inside its band", () => {
    // Healthy is the second of four bands: 25–50%, and 21.75 is its middle.
    assert.equal(bandPosition(21.75, bmi), 37.5)
  })

  it("keeps the marker inside open-ended bands", () => {
    const high = bandPosition(51.2, bmi)
    assert.ok(high > 75 && high < 100)
    const low = bandPosition(5, bmi)
    assert.ok(low > 0 && low < 25)
  })
})

describe("output labels", () => {
  it("reject a legend in the label", () => {
    const parsed = calculatorSchema.safeParse({
      title: "BMI",
      inputs: [{ id: "w", label: "Weight", default: 70 }],
      outputs: [
        {
          id: "cat",
          label: "Category (1 under, 2 healthy, 3 over, 4 obese)",
          formula: "w",
        },
      ],
    })
    assert.equal(parsed.success, false)
  })
})

describe("sliderRange", () => {
  it("brackets the default when bounds are missing", () => {
    assert.deepEqual(sliderRange(175), { min: 0, max: 400 })
    assert.deepEqual(sliderRange(82), { min: 0, max: 200 })
    assert.deepEqual(sliderRange(-5), { min: -10, max: 100 })
  })

  it("keeps the agent's bounds", () => {
    assert.deepEqual(sliderRange(70, 30, 200), { min: 30, max: 200 })
  })
})
