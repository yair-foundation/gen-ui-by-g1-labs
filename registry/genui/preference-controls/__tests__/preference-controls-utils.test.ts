import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { formatDateRange } from "../preference-controls-utils"

describe("formatDateRange", () => {
  it("closes the dash between single terms", () => {
    const r = { start: "2026-11-14", end: "2026-11-19" }
    assert.equal(formatDateRange(r, "en-US", 2026), "Nov 14–19")
    assert.equal(formatDateRange(r, "en-GB", 2026), "14–19 Nov")
    assert.equal(formatDateRange(r, "de-DE", 2026), "14.–19. Nov.")
  })

  it("spaces the dash when a term has a space", () => {
    const r = { start: "2026-11-28", end: "2026-12-03" }
    assert.equal(formatDateRange(r, "en-US", 2026), "Nov 28 – Dec 3")
    assert.equal(formatDateRange(r, "en-GB", 2026), "28 Nov – 3 Dec")
  })

  it("shows the year when it is not the current one", () => {
    assert.equal(
      formatDateRange({ start: "2026-11-14", end: "2026-11-19" }, "en-US", 2027),
      "Nov 14–19, 2026",
    )
  })

  it("is one date for a single day", () => {
    assert.equal(
      formatDateRange({ start: "2026-11-14", end: "2026-11-14" }, "en-GB", 2026),
      "14 Nov",
    )
  })

  it("never leaves a thin space in the output", () => {
    for (const locale of ["en-US", "en-GB", "de-DE", "fr-FR"]) {
      assert.doesNotMatch(
        formatDateRange({ start: "2026-11-28", end: "2026-12-03" }, locale, 2026),
        / /,
      )
    }
  })
})
