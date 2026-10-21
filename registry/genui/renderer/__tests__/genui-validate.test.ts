import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { z } from "zod"

import { formatIssues, validateGenUIInput } from "../genui-validate"

const schema = z.object({
  title: z.string(),
  items: z.array(z.object({ price: z.number() })).min(1),
})

describe("validateGenUIInput", () => {
  it("returns the parsed value when the input is valid", () => {
    const v = validateGenUIInput(schema, { title: "x", items: [{ price: 1 }] })
    assert.equal(v.ok, true)
  })

  it("words problems for the model, one line each, paths first", () => {
    const v = validateGenUIInput(schema, { items: [{ price: "1" }] })
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.ok(v.issues.some((i) => i.startsWith("title:")))
    assert.ok(v.issues.some((i) => i.startsWith("items.0.price:")))
    assert.match(v.message, /^The interface wasn't shown/)
    assert.ok(v.message.includes("\n- items.0.price:"))
  })

  it("resolves refs first and reports the ones it couldn't find", () => {
    const v = validateGenUIInput(
      schema,
      { title: "x", items: [{ price: { $ref: "offers.0.price" } }, { price: { $ref: "offers.5.price" } }] },
      { offers: [{ price: 9 }] },
    )
    assert.equal(v.ok, false)
    if (v.ok) return
    assert.ok(v.issues.some((i) => i.includes('$ref "offers.5.price"')))
  })

  it("formatIssues deduplicates and caps", () => {
    const issues = Array.from({ length: 20 }, () => ({ path: ["a"], message: "bad" }))
    assert.deepEqual(formatIssues(issues), ["a: bad"])
    const many = Array.from({ length: 20 }, (_, i) => ({ path: [String(i)], message: "bad" }))
    assert.equal(formatIssues(many, 3).length, 3)
  })
})
