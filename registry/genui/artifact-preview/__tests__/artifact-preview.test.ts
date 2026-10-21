import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  cellNumber,
  codeLanguage,
  formatCell,
  moveColumn,
  nextSort,
  sortRows,
  tokenizeJson,
  tokenizeLines,
  tokenizeSql,
} from "../artifact-preview-utils"

const types = (tokens: { type: string; text: string }[]) =>
  tokens.filter((t) => t.text.trim()).map((t) => `${t.type}:${t.text.trim()}`)

describe("tokenizeSql", () => {
  it("colours keywords, functions, strings, numbers and literals", () => {
    const { tokens } = tokenizeSql("SELECT COALESCE(r.cents, 0) AS net FROM t WHERE s = 'paid' AND x IS NULL")
    const out = types(tokens)
    assert.ok(out.includes("keyword:SELECT"))
    assert.ok(out.includes("function:COALESCE"))
    assert.ok(out.includes("number:0"))
    assert.ok(out.includes("string:'paid'"))
    assert.ok(out.includes("literal:NULL"))
    assert.ok(out.includes("keyword:FROM"))
  })

  it("treats -- as a comment, but not inside a string", () => {
    assert.deepEqual(types(tokenizeSql("-- Monthly revenue").tokens), ["comment:-- Monthly revenue"])
    const { tokens } = tokenizeSql("SELECT '--not a comment' -- real")
    assert.deepEqual(types(tokens).slice(-2), ["string:'--not a comment'", "comment:-- real"])
  })

  it("carries a block comment across lines", () => {
    const lines = tokenizeLines(["SELECT 1 /* start", "still comment", "end */ FROM t"], "sql")
    assert.deepEqual(types(lines[1]), ["comment:still comment"])
    assert.equal(lines[2][0].type, "comment")
    assert.ok(types(lines[2]).includes("keyword:FROM"))
  })

  it("keeps every character", () => {
    const line = "  o.total_cents - COALESCE(r.refunded_cents, 0) AS net_cents,"
    assert.equal(tokenizeSql(line).tokens.map((t) => t.text).join(""), line)
  })
})

describe("tokenizeJson", () => {
  it("tells keys from string values", () => {
    const out = types(tokenizeJson('  "status": "fulfilled", "total": 129.5, "gift": false, "note": null'))
    assert.deepEqual(out, [
      'key:"status"',
      "punctuation::",
      'string:"fulfilled"',
      "punctuation:,",
      'key:"total"',
      "punctuation::",
      "number:129.5",
      "punctuation:,",
      'key:"gift"',
      "punctuation::",
      "literal:false",
      "punctuation:,",
      'key:"note"',
      "punctuation::",
      "literal:null",
    ])
  })
})

describe("codeLanguage", () => {
  it("picks the highlighter from kind, language or file name", () => {
    assert.equal(codeLanguage("json", undefined, "a.txt"), "json")
    assert.equal(codeLanguage("code", "SQL", "report"), "sql")
    assert.equal(codeLanguage("code", undefined, "report.sql"), "sql")
    assert.equal(codeLanguage("code", "Python", "x.py"), null)
  })
})

describe("CSV cells", () => {
  it("groups digits in plain numbers and keeps their decimals", () => {
    assert.equal(formatCell("121250"), new Intl.NumberFormat().format(121250))
    assert.equal(formatCell("12.50"), new Intl.NumberFormat(undefined, { minimumFractionDigits: 2 }).format(12.5))
    assert.equal(formatCell("D-3100"), "D-3100")
    assert.equal(formatCell("2026-07-01"), "2026-07-01")
  })

  it("reads sortable numbers through currency signs and grouping", () => {
    assert.equal(cellNumber("$1,250.5"), 1250.5)
    assert.equal(cellNumber("12%"), 12)
    assert.equal(cellNumber("n/a"), null)
  })
})

describe("sortRows", () => {
  const rows = [
    ["D-10", "300"],
    ["D-9", "1,200"],
    ["D-11", ""],
    ["D-2", "45"],
  ]

  it("sorts numbers by value, empty last", () => {
    assert.deepEqual(
      sortRows(rows, { column: 1, dir: "asc" }, true).map((r) => r[0]),
      ["D-2", "D-10", "D-9", "D-11"],
    )
    assert.deepEqual(
      sortRows(rows, { column: 1, dir: "desc" }, true).map((r) => r[0]),
      ["D-9", "D-10", "D-2", "D-11"],
    )
  })

  it("sorts text with numbers inside by value", () => {
    assert.deepEqual(
      sortRows(rows, { column: 0, dir: "asc" }, false).map((r) => r[0]),
      ["D-2", "D-9", "D-10", "D-11"],
    )
  })

  it("cycles ascending, descending, off", () => {
    const a = nextSort(null, 2)
    assert.deepEqual(a, { column: 2, dir: "asc" })
    const b = nextSort(a, 2)
    assert.deepEqual(b, { column: 2, dir: "desc" })
    assert.equal(nextSort(b, 2), null)
    assert.deepEqual(nextSort(b, 0), { column: 0, dir: "asc" })
  })
})

describe("moveColumn", () => {
  it("moves a column left or right", () => {
    assert.deepEqual(moveColumn([0, 1, 2, 3], 0, 2), [1, 2, 0, 3])
    assert.deepEqual(moveColumn([0, 1, 2, 3], 3, 0), [3, 0, 1, 2])
    assert.deepEqual(moveColumn([0, 1, 2], 1, 9), [0, 2, 1])
  })
})
