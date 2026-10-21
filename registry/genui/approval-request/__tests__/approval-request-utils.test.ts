import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  HOLD_MS,
  matchesConfirmPhrase,
  needsHold,
} from "../approval-request-utils"

describe("needsHold", () => {
  it("is on for high risk and off otherwise", () => {
    assert.equal(needsHold({ risk: "high" }), true)
    assert.equal(needsHold({ risk: "medium" }), false)
    assert.equal(needsHold({}), false)
  })

  it("leaves a confirm phrase as the only hurdle", () => {
    assert.equal(
      needsHold({ risk: "high", confirmPhrase: "production" }),
      false,
    )
    assert.equal(needsHold({ risk: "high", confirmPhrase: "  " }), true)
  })

  it("lets an explicit value win either way", () => {
    assert.equal(needsHold({ hold: false, risk: "high" }), false)
    assert.equal(needsHold({ hold: true, risk: "low" }), true)
    assert.equal(
      needsHold({ hold: true, risk: "high", confirmPhrase: "x" }),
      true,
    )
  })

  it("holds for about a second", () => {
    assert.ok(HOLD_MS >= 800 && HOLD_MS <= 2000)
  })
})

describe("matchesConfirmPhrase", () => {
  it("trims and ignores case", () => {
    assert.equal(matchesConfirmPhrase("  Production ", "production"), true)
    assert.equal(matchesConfirmPhrase("prod", "production"), false)
    assert.equal(matchesConfirmPhrase("", undefined), true)
  })
})

describe("reversible as the model wrote it", () => {
  it("reads string booleans like booleans, and the schema accepts them", async () => {
    const { readReversible } = await import("../approval-request-utils")
    const { approvalRequestSchema } = await import("../approval-request.schema")
    assert.equal(readReversible("false"), false)
    assert.equal(readReversible(true), true)
    assert.equal(readReversible("partially"), "partially")
    assert.equal(readReversible("maybe"), undefined)
    const parsed = approvalRequestSchema.shape.reversible.safeParse("false")
    assert.deepEqual(parsed, { success: true, data: false })
  })
})
