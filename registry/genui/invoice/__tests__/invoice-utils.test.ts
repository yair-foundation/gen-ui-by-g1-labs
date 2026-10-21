import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatPeriod } from "../invoice-utils";

describe("formatPeriod", () => {
  it("closes the dash between single terms", () => {
    assert.equal(formatPeriod("2026-11-14", "2026-11-19", "en-US"), "Nov 14–19, 2026");
    assert.equal(formatPeriod("2026-11-14", "2026-11-19", "en-GB"), "14–19 Nov 2026");
  });

  it("spaces the dash when a term has a space", () => {
    assert.equal(formatPeriod("2026-11-28", "2026-12-03", "en-US"), "Nov 28 – Dec 3, 2026");
    assert.equal(formatPeriod("2026-11-28", "2026-12-03", "en-GB"), "28 Nov – 3 Dec 2026");
    assert.equal(formatPeriod("2026-12-28", "2027-01-03", "en-GB"), "28 Dec 2026 – 3 Jan 2027");
  });

  it("reads the same on every ICU version", () => {
    for (const locale of ["en-US", "en-GB", "de-DE", "fr-FR"]) {
      assert.doesNotMatch(formatPeriod("2026-11-28", "2026-12-03", locale) ?? "", / /);
    }
  });

  it("is null without both dates", () => {
    assert.equal(formatPeriod(undefined, "2026-11-19"), null);
    assert.equal(formatPeriod("2026-11-14", "not a date"), null);
  });

  it("defaults to en-US", () => {
    assert.equal(formatPeriod("2026-11-14", "2026-11-19"), "Nov 14–19, 2026");
  });
});
