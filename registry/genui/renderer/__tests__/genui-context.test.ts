import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  describeUIState,
  hasBinds,
  isBind,
  resolveBinds,
  resolveRefs,
} from "../genui-context"

describe("resolveRefs", () => {
  it("fills refs from the sources and drops unresolved ones", () => {
    const { value, missing } = resolveRefs(
      { price: { $ref: "offers.0.price" }, image: { $ref: "offers.9.image" } },
      { offers: [{ price: 142 }] },
    )
    assert.deepEqual(value, { price: 142 })
    assert.deepEqual(missing, ["offers.9.image"])
  })

  it("rejects prototype paths", () => {
    const { value, missing } = resolveRefs({ x: { $ref: "a.__proto__.y" } }, { a: {} })
    assert.deepEqual(value, {})
    assert.deepEqual(missing, ["a.__proto__.y"])
  })
})

describe("binds", () => {
  it("recognises a bind with or without a default", () => {
    assert.equal(isBind({ $bind: "slot.start" }), true)
    assert.equal(isBind({ $bind: "slot.start", default: "—" }), true)
    assert.equal(isBind({ $bind: "slot.start", extra: 1 }), false)
    assert.equal(isBind({ $ref: "x" }), false)
  })

  it("copies a sibling's value, or the default until it answers", () => {
    const props = {
      scope: [{ label: "When", value: { $bind: "slot.start", default: "Pick a time" } }],
      title: "Book",
    }
    const before = resolveBinds(props, {})
    assert.deepEqual(before.value.scope[0].value, "Pick a time")
    assert.deepEqual(before.pending, ["slot.start"])

    const after = resolveBinds(props, { slot: { action: "select", start: "08:00" } })
    assert.equal(after.value.scope[0].value, "08:00")
    assert.deepEqual(after.pending, [])
  })

  it("drops a bind with no default and no answer", () => {
    const { value } = resolveBinds({ a: { $bind: "x.y" }, b: 1 }, {})
    assert.deepEqual(value, { b: 1 })
  })

  it("leaves refs alone", () => {
    const { value } = resolveBinds({ a: { $ref: "search.0" } }, {})
    assert.deepEqual(value, { a: { $ref: "search.0" } })
  })

  it("hasBinds finds nested binds", () => {
    assert.equal(hasBinds({ a: [{ b: { $bind: "x" } }] }), true)
    assert.equal(hasBinds({ a: [{ b: { $ref: "x" } }] }), false)
  })
})

describe("describeUIState", () => {
  it("writes one line per result and caps the length", () => {
    const note = describeUIState([
      { id: "c1", name: "show_itinerary", result: { removed: ["Coit Tower"] } },
      { id: "c2", name: "pick_slot", result: undefined },
    ])
    assert.match(note, /^Interface state the user set:\n- show_itinerary \(c1\)/)
    assert.equal(note.includes("pick_slot"), false)
    assert.equal(describeUIState([], {}), "")
    assert.equal(describeUIState([{ id: "a", name: "t", result: "x".repeat(50) }], { maxChars: 30 }).length, 30)
  })
})
