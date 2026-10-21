import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  checkSummary,
  decisionMeta,
  formatDay,
  safeColor,
  safeImageSrc,
  textBlocks,
} from "../design-review-utils"

describe("textBlocks", () => {
  it("groups '- ' lines into one list and keeps other lines as paragraphs", () => {
    assert.deepEqual(textBlocks("Intro\n- one\n- two\n\nOutro"), [
      { type: "p", text: "Intro" },
      { type: "list", items: ["one", "two"] },
      { type: "p", text: "Outro" },
    ])
  })
})

describe("safeColor", () => {
  it("accepts hex and colour functions", () => {
    assert.equal(safeColor("#2b2b2b"), "#2b2b2b")
    assert.equal(safeColor("oklch(0.7 0.1 250)"), "oklch(0.7 0.1 250)")
  })
  it("rejects anything that could escape the style value", () => {
    assert.equal(safeColor("red; background: url(x)"), null)
    assert.equal(safeColor("url(javascript:alert(1))"), null)
  })
})

describe("safeImageSrc", () => {
  it("allows https and same-site paths only", () => {
    assert.equal(safeImageSrc("/img/a.png"), "/img/a.png")
    assert.equal(
      safeImageSrc("https://x.example/a.png"),
      "https://x.example/a.png",
    )
    assert.equal(safeImageSrc("//evil.example/a.png"), null)
    assert.equal(safeImageSrc("javascript:alert(1)"), null)
  })
})

describe("formatDay", () => {
  it("formats in UTC and ignores bad dates", () => {
    assert.equal(formatDay("2026-10-13T23:30:00Z"), "Oct 13, 2026")
    assert.equal(formatDay("nope"), null)
  })
})

describe("decisionMeta and checkSummary", () => {
  it("names each decision", () => {
    assert.equal(decisionMeta({ action: "approve" }).badge, "Approved")
    assert.equal(decisionMeta({ action: "decline" }).tone, "destructive")
    assert.equal(
      decisionMeta({ action: "modify", feedback: "x" }).badge,
      "Changes requested",
    )
  })
  it("counts check results", () => {
    assert.deepEqual(
      checkSummary([
        { status: "pass" },
        { status: "fail" },
        { status: "pass" },
      ]),
      { pass: 2, warn: 0, fail: 1 },
    )
  })
})
