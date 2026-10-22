import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  applyProposals,
  eventInterval,
  findConflicts,
  formatDuration,
  formatHour,
  formatTimeShort,
  layoutColumns,
  monthGrid,
  segmentOnDay,
} from "../calendar-utils"

const TZ = "America/New_York"

describe("formatHour", () => {
  it("shortens AM / PM to one letter", () => {
    assert.equal(formatHour(9, "en-US"), "9A")
    assert.equal(formatHour(12, "en-US"), "12P")
    assert.equal(formatHour(16, "en-US"), "4P")
  })

  it("keeps 24-hour locales as they are", () => {
    assert.equal(formatHour(9, "en-GB"), "09")
    assert.equal(formatHour(16, "de-DE"), "16")
  })

  it("never shortens a non-Latin day period", () => {
    assert.notEqual(
      formatHour(9, "ja-JP-u-hc-h12"),
      formatHour(21, "ja-JP-u-hc-h12"),
    )
  })
})

describe("formatDuration", () => {
  it("says minutes, hours, or both", () => {
    assert.equal(formatDuration(15, "en-US"), "15 min")
    assert.equal(formatDuration(60, "en-US"), "1 hr")
    assert.equal(formatDuration(90, "en-US"), "1 hr 30 min")
  })

  it("is null for nothing", () => {
    assert.equal(formatDuration(0), null)
    assert.equal(formatDuration(-5), null)
  })
})

describe("eventInterval", () => {
  it("keeps all-day ends exclusive", () => {
    const iv = eventInterval({ start: "2026-10-15", end: "2026-10-17" }, TZ)
    assert.equal(iv?.allDay, true)
    assert.equal(iv?.startKey, "2026-10-15")
    assert.equal(iv?.endKey, "2026-10-17")
  })

  it("reads a time without an offset in the timezone", () => {
    const a = eventInterval(
      { start: "2026-10-15T15:00", end: "2026-10-15T16:00" },
      TZ,
    )
    const b = eventInterval(
      { start: "2026-10-15T15:00:00-04:00", end: "2026-10-15T16:00:00-04:00" },
      TZ,
    )
    assert.equal(a?.start, b?.start)
  })

  it("keeps wall-clock days across a DST change", () => {
    // New York leaves DST on 2026-11-01.
    const iv = eventInterval(
      { start: "2026-11-02T09:00:00-05:00", end: "2026-11-02T10:00:00-05:00" },
      TZ,
    )
    const seg = iv && segmentOnDay(iv, "2026-11-02", TZ)
    assert.deepEqual(seg, { startMin: 540, endMin: 600 })
  })
})

describe("proposals", () => {
  const events = [
    {
      id: "a",
      title: "Investor call",
      start: "2026-10-15T15:00:00-04:00",
      end: "2026-10-15T16:00:00-04:00",
    },
    {
      id: "b",
      title: "Team lunch",
      start: "2026-10-16T11:00:00-04:00",
      end: "2026-10-16T12:30:00-04:00",
    },
  ]
  const move = {
    id: "p1",
    kind: "move" as const,
    eventId: "a",
    title: "Investor call",
    start: "2026-10-16T12:00:00-04:00",
    end: "2026-10-16T13:00:00-04:00",
  }

  it("applies only accepted proposals", () => {
    assert.equal(applyProposals(events, [move], [])[0].start, events[0].start)
    const moved = applyProposals(events, [move])[0]
    assert.equal(moved.change, "moved")
    assert.equal(moved.start, move.start)
  })

  it("flags busy events a change overlaps, never itself", () => {
    const hits = findConflicts(events, [move], TZ)
    assert.deepEqual(
      hits.get("p1")?.map((e) => e.title),
      ["Team lunch"],
    )
  })
})

describe("layoutColumns", () => {
  it("puts overlapping blocks side by side", () => {
    const out = layoutColumns([
      { key: "a", startMin: 600, endMin: 660 },
      { key: "b", startMin: 630, endMin: 690 },
      { key: "c", startMin: 720, endMin: 780 },
    ])
    assert.deepEqual(out.get("a"), { col: 0, cols: 2 })
    assert.deepEqual(out.get("b"), { col: 1, cols: 2 })
    assert.deepEqual(out.get("c"), { col: 0, cols: 1 })
  })
})

describe("monthGrid", () => {
  it("covers the month in whole weeks", () => {
    const weeks = monthGrid("2026-10-01", 0)
    assert.equal(weeks[0][0], "2026-09-27")
    assert.ok(weeks.every((w) => w.length === 7))
    assert.ok(weeks.flat().includes("2026-10-31"))
  })
})

describe("formatTimeShort", () => {
  const t = (iso: string) => Date.parse(iso)

  it("drops :00 and shortens the day period", () => {
    assert.equal(
      formatTimeShort(t("2026-10-15T10:00:00-04:00"), TZ, "en-US"),
      "10A",
    )
    assert.equal(
      formatTimeShort(t("2026-10-15T13:30:00-04:00"), TZ, "en-US"),
      "1:30P",
    )
  })

  it("keeps hours and minutes in 24-hour locales", () => {
    assert.equal(
      formatTimeShort(t("2026-10-15T13:30:00-04:00"), TZ, "en-GB"),
      "13:30",
    )
  })
})
