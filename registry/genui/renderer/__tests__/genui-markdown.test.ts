import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { callToMarkdown } from "../genui-markdown"

describe("callToMarkdown", () => {
  it("writes a heading, scalar lines and a table for records", () => {
    const md = callToMarkdown({
      name: "show_chart",
      props: {
        title: "Revenue by region",
        type: "bar",
        data: [
          { region: "Europe", q2: 1210000, q3: 1462000 },
          { region: "APAC", q2: 865000, q3: 918000 },
        ],
      },
    })
    assert.match(md, /^### Revenue by region\n/)
    assert.ok(md.includes("- **Type:** bar"))
    assert.ok(md.includes("| Region | Q2 | Q3 |"))
    assert.ok(md.includes("| Europe | 1210000 | 1462000 |"))
  })

  it("uses a formatter when one is given, and skips on null", () => {
    const call = { name: "start_timer", props: { label: "Tea", seconds: 180 } }
    assert.equal(
      callToMarkdown(call, { formatters: { start_timer: (p) => `Timer: ${p.label}` } }),
      "Timer: Tea",
    )
    assert.equal(callToMarkdown(call, { formatters: { start_timer: () => null } }), "")
  })

  it("escapes pipes and caps the length", () => {
    const md = callToMarkdown({ name: "x", props: { note: "a | b" } })
    assert.ok(md.includes("a \\| b"))
    const long = callToMarkdown({ name: "x", props: { note: "y".repeat(100) } }, { maxChars: 20 })
    assert.equal(long.length, 20)
  })
})
