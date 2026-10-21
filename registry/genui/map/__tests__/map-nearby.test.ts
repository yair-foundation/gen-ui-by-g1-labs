import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  boundsOf,
  cycle,
  describeStay,
  distanceLine,
  distanceMeters,
  formatDistance,
  formatPrice,
  formatStayDates,
  picksOf,
  readyStays,
  reasonLabel,
  safeImageSrc,
  searchLine,
  stepIndex,
  stripOrder,
  validPath,
} from "../map-utils"
import { mapSchema } from "../map.schema"

const eiffel = { name: "Eiffel Tower", lat: 48.8584, lng: 2.2945 }

const stay = (id: string, lat: number, lng: number, extra = {}) => ({
  id,
  name: `Hotel ${id}`,
  lat,
  lng,
  price: 120,
  ...extra,
})

describe("readyStays", () => {
  it("keeps complete stays, first of each id, in order", () => {
    const out = readyStays([
      stay("a", 48.85, 2.29),
      { id: "b", name: "No price", lat: 48.85, lng: 2.29 },
      stay("a", 48.86, 2.3),
      { id: "c", name: "Bad lat", lat: 120, lng: 2.3, price: 90 },
      undefined,
      stay("d", 48.84, 2.31),
    ])
    assert.deepEqual(
      out.map((s) => s.id),
      ["a", "d"],
    )
  })

  it("rejects a negative or non-finite price", () => {
    assert.equal(readyStays([stay("a", 1, 1, { price: -1 })]).length, 0)
    assert.equal(readyStays([stay("a", 1, 1, { price: Number.NaN })]).length, 0)
  })
})

describe("picks and strip order", () => {
  const stays = readyStays([
    stay("far", 48.87, 2.35),
    stay("p1", 48.856, 2.298, { pick: "closest" }),
    stay("near", 48.857, 2.296),
    stay("p2", 48.85, 2.28, { pick: "lowest-price" }),
  ])

  it("lists picks in the order sent", () => {
    assert.deepEqual(
      picksOf(stays).map((s) => s.id),
      ["p1", "p2"],
    )
  })

  it("caps picks at five", () => {
    const many = readyStays(
      Array.from({ length: 7 }, (_, i) =>
        stay(`s${i}`, 48.85, 2.29, { pick: "best-value" }),
      ),
    )
    assert.equal(picksOf(many).length, 5)
  })

  it("puts picks first, then the rest nearest first", () => {
    assert.deepEqual(
      stripOrder(stays, eiffel).map((s) => s.id),
      ["p1", "p2", "near", "far"],
    )
  })

  it("keeps the rest in order without an anchor", () => {
    assert.deepEqual(
      stripOrder(stays, null).map((s) => s.id),
      ["p1", "p2", "far", "near"],
    )
  })
})

describe("cycle and stepIndex", () => {
  it("wraps both ways", () => {
    assert.equal(cycle(4, 1, 5), 0)
    assert.equal(cycle(0, -1, 5), 4)
    assert.equal(cycle(0, 1, 0), -1)
  })

  it("moves and clamps with the keys", () => {
    assert.equal(stepIndex(0, "ArrowRight", 3), 1)
    assert.equal(stepIndex(2, "ArrowRight", 3), 2)
    assert.equal(stepIndex(0, "ArrowLeft", 3), 0)
    assert.equal(stepIndex(1, "End", 3), 2)
    assert.equal(stepIndex(1, "Home", 3), 0)
    assert.equal(stepIndex(1, "a", 3), 1)
    assert.equal(stepIndex(0, "ArrowRight", 0), -1)
  })
})

describe("distance", () => {
  it("measures great-circle metres", () => {
    // Eiffel Tower to the Arc de Triomphe is about 1.7 km as the crow flies.
    const d = distanceMeters(eiffel, { lat: 48.8738, lng: 2.295 })
    assert.ok(d > 1650 && d < 1800, `got ${d}`)
    assert.equal(distanceMeters(eiffel, eiffel), 0)
  })

  it("words metric distances", () => {
    assert.equal(formatDistance(12), "50 m")
    assert.equal(formatDistance(337), "350 m")
    assert.equal(formatDistance(1000), "1 km")
    assert.equal(formatDistance(1640), "1.6 km")
    assert.equal(formatDistance(12_400), "12 km")
    assert.equal(formatDistance(-1), "")
  })

  it("words imperial distances", () => {
    assert.equal(formatDistance(100, "imperial"), "300 ft")
    assert.equal(formatDistance(650, "imperial"), "0.4 mi")
    assert.equal(formatDistance(20_000, "imperial"), "12 mi")
  })

  it("prefers a routed travel time", () => {
    const s = { lat: 48.856, lng: 2.298 }
    assert.equal(
      distanceLine({ ...s, travel: { minutes: 7, mode: "walk" } }, eiffel),
      "7 min walk to Eiffel Tower",
    )
    assert.equal(
      distanceLine({ ...s, travel: { minutes: 12, mode: "transit" } }, eiffel),
      "12 min by transit to Eiffel Tower",
    )
    assert.match(distanceLine(s, eiffel), /^\d+ m to Eiffel Tower$/)
  })
})

describe("copy", () => {
  it("words pick reasons", () => {
    assert.equal(reasonLabel("closest", "Eiffel Tower"), "Closest to Eiffel Tower")
    assert.equal(reasonLabel("best-value", "Eiffel Tower"), "Best value")
    assert.equal(reasonLabel(undefined, "Eiffel Tower"), "In this search")
  })

  it("formats prices, whole on pins", () => {
    assert.equal(formatPrice(148.1, "GBP", { locale: "en-GB" }), "£148.10")
    assert.equal(formatPrice(148, "GBP", { locale: "en-GB" }), "£148")
    assert.equal(formatPrice(148.6, "GBP", { whole: true, locale: "en-GB" }), "£149")
    assert.equal(formatPrice(12, "NOPE", { locale: "en-GB" }), "12 NOPE")
  })

  // ICU 78 (Node 26) puts thin spaces around the range dash; older ICU doesn't.
  const tightDash = (s: string) => s.replace(/\s*–\s*/g, "–")

  it("formats the stay's dates as a range", () => {
    assert.equal(tightDash(formatStayDates("2026-11-14", "2026-11-19", "en-GB")), "14–19 Nov")
    assert.equal(formatStayDates("2026-11-19", "2026-11-14", "en-GB"), "")
    assert.equal(formatStayDates("2026-02-30", "2026-03-02", "en-GB"), "")
  })

  it("builds the search line from what it has", () => {
    assert.equal(
      tightDash(
        searchLine(
          { location: "Paris", total: 1624, checkIn: "2026-11-14", checkOut: "2026-11-19", adults: 2 },
          "en-GB",
        ),
      ),
      "1,624 stays in Paris · 14–19 Nov · 5 nights · 2 adults",
    )
    assert.equal(searchLine({ location: "Paris", adults: 1 }), "Paris · 1 adult")
    assert.equal(searchLine(undefined), "")
  })

  it("describes a stay for screen readers", () => {
    const [s] = readyStays([stay("a", 48.856, 2.298, { stars: 4, pick: "closest", price: 148.1 })])
    const text = describeStay(s, eiffel, "GBP")
    assert.match(text, /^Hotel a, 4 stars, Closest to Eiffel Tower, .*148\.10 a night, .* to Eiffel Tower$/)
  })
})

describe("geometry and safety", () => {
  it("keeps only valid path pairs", () => {
    assert.deepEqual(validPath([[2.29, 48.85], ["x", 1], [2.3, 48.86]]), [
      [2.29, 48.85],
      [2.3, 48.86],
    ])
    assert.equal(validPath([[2.29, 48.85]]), null)
    assert.equal(validPath("nope"), null)
  })

  it("bounds some points", () => {
    assert.deepEqual(
      boundsOf([
        [2.3, 48.86],
        [2.28, 48.85],
      ]),
      [
        [2.28, 48.85],
        [2.3, 48.86],
      ],
    )
    assert.equal(boundsOf([]), null)
  })

  it("allows only safe image sources", () => {
    assert.equal(safeImageSrc("/gen/a.jpg"), "/gen/a.jpg")
    assert.equal(safeImageSrc("//evil.example/a.jpg"), null)
    assert.equal(safeImageSrc("javascript:alert(1)"), null)
    assert.equal(safeImageSrc("https://example.com/a.jpg"), "https://example.com/a.jpg")
  })
})

describe("nearby schema", () => {
  it("accepts a nearby call", () => {
    const parsed = mapSchema.parse({
      title: "Hotels near the Eiffel Tower",
      mode: "nearby",
      anchor: eiffel,
      currency: "GBP",
      stays: [stay("a", 48.85, 2.29, { pick: "closest" })],
    })
    assert.equal(parsed.mode, "nearby")
    assert.equal(parsed.stays?.length, 1)
  })

  it("rejects an unknown pick reason", () => {
    const r = mapSchema.safeParse({
      title: "x",
      mode: "nearby",
      anchor: eiffel,
      currency: "GBP",
      stays: [stay("a", 48.85, 2.29, { pick: "cheapest" })],
    })
    assert.equal(r.success, false)
  })
})
