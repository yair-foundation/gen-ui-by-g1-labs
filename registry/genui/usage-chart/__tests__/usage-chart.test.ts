import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  buildPoints,
  formatPeriod,
  formatUsage,
  indexAt,
  parseDay,
  rangeStat,
  stepPath,
} from "../usage-chart-utils"
import { usageChartSchema } from "../usage-chart.schema"

const rows: Record<string, string | number>[] = [
  { date: "2026-09-21", tokens: 4_000_000, cached: 1_000_000, cost: 12 },
  { date: "2026-09-19", tokens: 2_000_000, cached: 0, cost: 6 },
  { date: "2026-09-20", tokens: 3_000_000, cost: 9 },
]

describe("parseDay", () => {
  it("reads the date part as UTC midnight", () => {
    assert.equal(parseDay("2026-09-22"), Date.UTC(2026, 8, 22))
    assert.equal(parseDay("2026-09-22T23:30:00-08:00"), Date.UTC(2026, 8, 22))
  })

  it("rejects text, impossible days and non-strings", () => {
    assert.equal(parseDay("22 Sep"), null)
    assert.equal(parseDay("2026-02-31"), null)
    assert.equal(parseDay(20260922), null)
  })
})

describe("buildPoints", () => {
  it("sorts by day and keeps a missing overlay as null", () => {
    const points = buildPoints(rows, "date", "tokens", "cached")
    assert.deepEqual(
      points.map((p) => [p.value, p.overlay]),
      [
        [2_000_000, 0],
        [3_000_000, null],
        [4_000_000, 1_000_000],
      ],
    )
  })

  it("drops rows with a bad date or value, and keeps the last of a repeated day", () => {
    const points = buildPoints(
      [
        { date: "2026-09-19", tokens: 1 },
        { date: "soon", tokens: 2 },
        { date: "2026-09-20", tokens: "n/a" },
        { date: "2026-09-19", tokens: 5 },
      ],
      "date",
      "tokens",
    )
    assert.deepEqual(points.map((p) => p.value), [5])
  })

  it("clamps the overlay to the value, since it is a part of it", () => {
    const [p] = buildPoints([{ date: "2026-09-19", tokens: 10, cached: 40 }], "date", "tokens", "cached")
    assert.equal(p.overlay, 10)
  })

  it("is empty until the keys arrive", () => {
    assert.deepEqual(buildPoints(rows, undefined, "tokens"), [])
    assert.deepEqual(buildPoints(rows, "date", undefined), [])
  })
})

describe("rangeStat", () => {
  const points = buildPoints(rows, "date", "tokens")

  it("combines the days from the start up to the scrubbed one", () => {
    assert.equal(rangeStat(points, 2, { key: "tokens", op: "sum" }), 9_000_000)
    assert.equal(rangeStat(points, 1, { key: "tokens", op: "sum" }), 5_000_000)
    assert.equal(rangeStat(points, 1, { key: "tokens", op: "average" }), 2_500_000)
    assert.equal(rangeStat(points, 2, { key: "tokens", op: "max" }), 4_000_000)
    assert.equal(rangeStat(points, 2, { key: "tokens", op: "min" }), 2_000_000)
    assert.equal(rangeStat(points, 1, { key: "tokens", op: "latest" }), 3_000_000)
  })

  it("averages only the days that have the field", () => {
    assert.equal(rangeStat(points, 2, { key: "cached", op: "average" }), 500_000)
  })

  it("is null when no day has the field", () => {
    assert.equal(rangeStat(points, 2, { key: "nope", op: "sum" }), null)
  })
})

describe("indexAt", () => {
  it("maps a position to its band and clamps to the plot", () => {
    assert.equal(indexAt(0, 0, 10, 5), 0)
    assert.equal(indexAt(25, 0, 10, 5), 2)
    assert.equal(indexAt(-30, 0, 10, 5), 0)
    assert.equal(indexAt(500, 0, 10, 5), 4)
  })
})

describe("stepPath", () => {
  const y = (v: number) => 100 - v

  it("holds each value across its band", () => {
    assert.equal(stepPath([10, 30, 20], 0, 5, y), "M0 90H5V70H10V80H15")
  })

  it("closes down to the baseline for an area", () => {
    assert.equal(stepPath([10, 30], 0, 5, y, 100), "M0 90H5V70H10V100H0Z")
  })

  it("draws nothing for no values", () => {
    assert.equal(stepPath([], 0, 5, y), "")
  })
})

describe("formatUsage", () => {
  it("abbreviates from four digits up and keeps small numbers whole", () => {
    assert.equal(formatUsage(5_650_000, {}), "5.65M")
    assert.equal(formatUsage(511_200, {}), "511.2K")
    assert.equal(formatUsage(9_999, {}), "9,999")
    assert.equal(formatUsage(12.4, { unit: "kWh" }), "12.4 kWh")
  })

  it("keeps money exact under 100,000 and abbreviates above", () => {
    const usd = { format: "currency", currency: "USD" } as const
    assert.equal(formatUsage(1543.86, usd), "$1,543.86")
    assert.equal(formatUsage(1200, usd), "$1,200")
    assert.equal(formatUsage(2_400_000, usd), "$2.4M")
  })

  it("shows a dash for a missing value", () => {
    assert.equal(formatUsage(null, {}), "—")
  })
})

describe("formatPeriod", () => {
  const a = Date.UTC(2026, 5, 27)
  const b = Date.UTC(2026, 8, 22)

  it("writes a period without the year, and one day alone", () => {
    assert.equal(formatPeriod(a, b, "en-GB"), "27 Jun – 22 Sept")
    assert.equal(formatPeriod(b, b, "en-GB"), "22 Sept")
  })

  it("adds the year when the period crosses one", () => {
    assert.match(formatPeriod(Date.UTC(2025, 11, 30), Date.UTC(2026, 0, 2), "en-GB"), /2025.*2026/)
  })
})

describe("usageChartSchema", () => {
  const valid = {
    title: "Token usage",
    dateKey: "date",
    value: { key: "tokens", label: "Tokens" },
    stats: [{ label: "Total", key: "tokens", op: "sum" }],
    data: rows,
  }

  it("accepts a complete call and defaults the formats", () => {
    const parsed = usageChartSchema.parse(valid)
    assert.equal(parsed.value.format, "number")
    assert.equal(parsed.stats[0].format, "number")
  })

  it("needs two days and at least one stat", () => {
    assert.equal(usageChartSchema.safeParse({ ...valid, data: [rows[0]] }).success, false)
    assert.equal(usageChartSchema.safeParse({ ...valid, stats: [] }).success, false)
  })
})
