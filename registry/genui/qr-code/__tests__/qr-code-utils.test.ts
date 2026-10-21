import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { formatWhen } from "../qr-code-utils"

// The timed cases read the viewer's time zone; pin it so they are repeatable.
process.env.TZ = "UTC"

describe("formatWhen", () => {
  it("is one date or time without an end", () => {
    assert.equal(formatWhen("2026-11-05", undefined, "en-US"), "Thursday, November 5, 2026")
    assert.equal(formatWhen("2026-11-05T18:00:00Z", undefined, "en-GB"), "5 Nov 2026, 18:00")
  })

  it("sets the dash of an all-day range", () => {
    assert.equal(
      formatWhen("2026-11-05", "2026-11-07", "en-US"),
      "Thursday, November 5 – Saturday, November 7, 2026",
    )
    assert.equal(
      formatWhen("2026-11-05", "2026-11-07", "en-GB"),
      "Thursday 5 November – Saturday 7 November 2026",
    )
    assert.equal(
      formatWhen("2026-11-05", "2026-11-07", "de-DE"),
      "Donnerstag, 5. – Samstag, 7. November 2026",
    )
  })

  it("closes the dash between two clock times", () => {
    assert.equal(
      formatWhen("2026-11-05T18:00:00Z", "2026-11-05T20:30:00Z", "en-GB"),
      "5 Nov 2026, 18:00–20:30",
    )
  })

  it("reads the same on every ICU version", () => {
    for (const locale of ["en-US", "en-GB", "de-DE", "fr-FR"]) {
      assert.doesNotMatch(
        formatWhen("2026-11-05T18:00:00Z", "2026-11-06T20:30:00Z", locale),
        / /,
      )
    }
  })
})
