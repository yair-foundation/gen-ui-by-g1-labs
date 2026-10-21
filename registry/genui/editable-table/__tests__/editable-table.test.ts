import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  applyResult,
  cellAddress,
  changeCount,
  columnLetter,
  describeChanges,
  diffRows,
  formatValue,
  homeEndCell,
  optionTone,
  PAGE_ROWS,
  parseInput,
  parseIsoDay,
  sortRows,
  stepCell,
  type TableRow,
  urlHref,
  urlLabel,
} from "../editable-table-utils"
import { editableTableSchema } from "../editable-table.schema"

const original: TableRow[] = [
  {
    id: "a",
    cells: { tool: "Figma", category: "Design", renews: "2026-03-12" },
  },
  { id: "b", cells: { tool: "Vercel", category: "Hosting", renews: null } },
  { id: "c", cells: { tool: "Loom", category: "Video", renews: "2026-11-18" } },
]
const keys = ["tool", "category", "renews"]

describe("columnLetter and cellAddress", () => {
  it("counts like a spreadsheet", () => {
    assert.equal(columnLetter(0), "A")
    assert.equal(columnLetter(25), "Z")
    assert.equal(columnLetter(26), "AA")
    assert.equal(columnLetter(27), "AB")
    assert.equal(cellAddress(1, 2), "B3")
  })
})

describe("stepCell", () => {
  // A 3 × 4 grid: rows 0–2, columns 0–3.
  it("wraps right past the last column to the next row", () => {
    assert.deepEqual(stepCell(0, 3, 0, 1, 3, 4), [1, 0])
    assert.deepEqual(stepCell(1, 1, 0, 1, 3, 4), [1, 2])
  })

  it("wraps left before the first column to the previous row", () => {
    assert.deepEqual(stepCell(2, 0, 0, -1, 3, 4), [1, 3])
  })

  it("stops at the table's corners", () => {
    assert.deepEqual(stepCell(0, 0, 0, -1, 3, 4), [0, 0])
    assert.deepEqual(stepCell(2, 3, 0, 1, 3, 4), [2, 3])
  })

  it("moves up and down without wrapping", () => {
    assert.deepEqual(stepCell(0, 2, -1, 0, 3, 4), [0, 2])
    assert.deepEqual(stepCell(2, 2, 1, 0, 3, 4), [2, 2])
    assert.deepEqual(stepCell(1, 2, 1, 0, 3, 4), [2, 2])
  })

  it("handles an empty grid", () => {
    assert.deepEqual(stepCell(0, 0, 0, 1, 0, 4), [0, 0])
  })

  it("jumps a page of rows in the same column, stopping at the ends", () => {
    // 12 rows × 4 columns.
    assert.deepEqual(stepCell(0, 2, PAGE_ROWS, 0, 12, 4), [5, 2])
    assert.deepEqual(stepCell(9, 2, PAGE_ROWS, 0, 12, 4), [11, 2])
    assert.deepEqual(stepCell(7, 1, -PAGE_ROWS, 0, 12, 4), [2, 1])
    assert.deepEqual(stepCell(3, 1, -PAGE_ROWS, 0, 12, 4), [0, 1])
  })
})

describe("homeEndCell", () => {
  // A 3 × 4 grid: rows 0–2, columns 0–3.
  it("goes to the row's first or last cell", () => {
    assert.deepEqual(homeEndCell(1, 2, "Home", false, 3, 4), [1, 0])
    assert.deepEqual(homeEndCell(1, 1, "End", false, 3, 4), [1, 3])
  })

  it("wraps to the previous or next row when already at that end", () => {
    assert.deepEqual(homeEndCell(1, 0, "Home", false, 3, 4), [0, 0])
    assert.deepEqual(homeEndCell(1, 3, "End", false, 3, 4), [2, 3])
  })

  it("stops at the table's corners", () => {
    assert.deepEqual(homeEndCell(0, 0, "Home", false, 3, 4), [0, 0])
    assert.deepEqual(homeEndCell(2, 3, "End", false, 3, 4), [2, 3])
  })

  it("goes straight to a corner with Ctrl or Cmd", () => {
    assert.deepEqual(homeEndCell(1, 2, "Home", true, 3, 4), [0, 0])
    assert.deepEqual(homeEndCell(1, 2, "End", true, 3, 4), [2, 3])
  })
})

describe("parseIsoDay", () => {
  it("reads strict ISO days and rejects impossible ones", () => {
    assert.equal(parseIsoDay("2026-03-12"), Date.UTC(2026, 2, 12))
    assert.equal(parseIsoDay("2026-02-31"), null)
    assert.equal(parseIsoDay("12 Mar"), null)
    assert.equal(parseIsoDay(20260312), null)
  })
})

describe("urls", () => {
  it("labels with the domain, without scheme or www", () => {
    assert.equal(urlLabel("https://www.figma.com/"), "figma.com")
    assert.equal(urlLabel("linear.app"), "linear.app")
    assert.equal(urlLabel("https://vercel.com/docs/"), "vercel.com/docs")
  })

  it("links only to http(s) addresses with a domain", () => {
    assert.equal(urlHref("figma.com"), "https://figma.com/")
    assert.equal(urlHref("javascript:alert(1)"), null)
    assert.equal(urlHref("not a url"), null)
    assert.equal(urlHref("localhost"), null)
  })
})

describe("formatValue", () => {
  it("formats by column type in the given locale", () => {
    assert.equal(
      formatValue("2026-03-12", { key: "d", type: "date" }),
      "Mar 12, 2026",
    )
    assert.equal(
      formatValue(1234.5, { key: "n", type: "number" }, "de-DE"),
      "1.234,5",
    )
    assert.equal(
      formatValue("https://loom.com", { key: "u", type: "url" }),
      "loom.com",
    )
    assert.equal(formatValue(null, { key: "t" }), "")
  })
})

describe("parseInput", () => {
  it("clears on blank input", () => {
    assert.deepEqual(parseInput("  ", { key: "t" }), { ok: true, value: null })
  })

  it("validates by type", () => {
    assert.deepEqual(parseInput("1,200", { key: "n", type: "number" }), {
      ok: true,
      value: 1200,
    })
    assert.equal(parseInput("ten", { key: "n", type: "number" }).ok, false)
    assert.equal(parseInput("2026-02-31", { key: "d", type: "date" }).ok, false)
    assert.equal(parseInput("figma", { key: "u", type: "url" }).ok, false)
    assert.deepEqual(parseInput("figma.com", { key: "u", type: "url" }), {
      ok: true,
      value: "figma.com",
    })
  })

  it("matches select options case-insensitively and rejects others", () => {
    const col = {
      key: "c",
      type: "select" as const,
      options: ["Design", "Hosting"],
    }
    assert.deepEqual(parseInput("design", col), { ok: true, value: "Design" })
    assert.equal(parseInput("Video", col).ok, false)
  })
})

describe("optionTone", () => {
  const col = {
    key: "c",
    type: "select" as const,
    options: ["A", "B", "C", "D", "E", "F"],
  }

  it("colours by position in the options, not in the rows", () => {
    assert.equal(optionTone("A", col), 0)
    assert.equal(optionTone("E", col), 4)
  })

  it("leaves options past the fifth, unknown values and other types blue", () => {
    assert.equal(optionTone("F", col), null)
    assert.equal(optionTone("Z", col), null)
    assert.equal(optionTone(null, col), null)
    assert.equal(optionTone("A", { key: "t", type: "text" }), null)
    assert.equal(optionTone("A", { key: "c", type: "select" }), null)
  })
})

describe("sortRows", () => {
  it("keeps empty cells last in both directions and ties in order", () => {
    const asc = sortRows(original, { key: "renews", direction: "asc" })
    assert.deepEqual(
      asc.map((r) => r.id),
      ["a", "c", "b"],
    )
    const desc = sortRows(original, { key: "renews", direction: "desc" })
    assert.deepEqual(
      desc.map((r) => r.id),
      ["c", "a", "b"],
    )
    assert.equal(sortRows(original, undefined), original)
  })
})

describe("diffRows and applyResult", () => {
  it("returns no changes for an untouched table", () => {
    const r = diffRows(original, original, keys)
    assert.equal(changeCount(r), 0)
    assert.equal(describeChanges(r), "No changes")
  })

  it("reports only edited cells, added rows and deleted ids", () => {
    const current: TableRow[] = [
      { id: "a", cells: { ...original[0].cells, category: "Video" } },
      { id: "c", cells: original[2].cells },
      { id: "new-1", cells: { tool: "Linear", category: null }, isNew: true },
      { id: "new-2", cells: {}, isNew: true },
    ]
    const r = diffRows(original, current, keys)
    assert.deepEqual(r, {
      action: "save",
      updated: [{ id: "a", cells: { category: "Video" } }],
      added: [{ cells: { tool: "Linear" } }],
      deleted: ["b"],
    })
    assert.equal(describeChanges(r), "1 edited, 1 added, 1 deleted")

    const replayed = applyResult(original, r)
    assert.deepEqual(
      replayed.map((row) => row.cells.tool),
      ["Figma", "Loom", "Linear"],
    )
    assert.equal(replayed[0].cells.category, "Video")
  })

  it("treats clearing an empty cell as no change", () => {
    const current = [{ id: "b", cells: { ...original[1].cells, renews: "" } }]
    const r = diffRows([original[1]], current, keys)
    assert.equal(changeCount(r), 0)
  })
})

describe("editableTableSchema", () => {
  it("accepts a typical payload and fills defaults", () => {
    const parsed = editableTableSchema.parse({
      title: "Design stack",
      columns: [
        { key: "tool", label: "Tool" },
        {
          key: "category",
          label: "Category",
          type: "select",
          options: ["Design"],
        },
      ],
      rows: [{ id: "a", cells: { tool: "Figma", category: "Design" } }],
    })
    assert.equal(parsed.allowAdd, true)
    assert.equal(parsed.columns[0].type, "text")
  })

  it("rejects more than six columns", () => {
    const columns = Array.from({ length: 7 }, (_, i) => ({
      key: `k${i}`,
      label: `C${i}`,
    }))
    assert.equal(
      editableTableSchema.safeParse({ title: "T", columns, rows: [] }).success,
      false,
    )
  })
})
