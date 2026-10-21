import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  ratingRecord,
  resolveReasons,
  toggleReason,
} from "../answer-feedback-utils"
import { defaultFeedbackReasons } from "../answer-feedback.schema"

const offered = [
  { id: "a", label: "Not accurate" },
  { id: "b", label: "Too long" },
  { id: "c", label: "Out of date" },
]

describe("resolveReasons", () => {
  it("falls back to the defaults for nothing, or for a partial list", () => {
    assert.equal(resolveReasons(undefined).length, defaultFeedbackReasons.length)
    assert.equal(resolveReasons([{ id: "a" }]).length, defaultFeedbackReasons.length)
    assert.equal(resolveReasons([{ id: "a", label: "x" }]).length, defaultFeedbackReasons.length)
  })

  it("uses the agent's reasons once there are at least two", () => {
    assert.deepEqual(
      resolveReasons([
        { id: "a", label: "Wrong source" },
        { id: "b", label: "Too long" },
        { id: "c" },
      ]).map((r) => r.id),
      ["a", "b"],
    )
  })
})

describe("toggleReason", () => {
  it("adds and removes, keeping the offered order", () => {
    assert.deepEqual(toggleReason(["c"], "a", offered), ["a", "c"])
    assert.deepEqual(toggleReason(["a", "c"], "a", offered), ["c"])
  })
})

describe("ratingRecord", () => {
  it("thanks for an up, and names the reasons for a down", () => {
    assert.equal(ratingRecord({ action: "rate", rating: "up" }, offered), "Thanks for the feedback.")
    assert.equal(
      ratingRecord({ action: "rate", rating: "down", reasons: ["b", "c"] }, offered),
      "Thanks. Too long, Out of date.",
    )
    assert.equal(
      ratingRecord({ action: "rate", rating: "down", reasons: [] }, offered),
      "Thanks for the feedback.",
    )
  })
})
