import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { type MechanismPart, mechanismSchema } from "../mechanism.schema"
import {
  buildScene,
  defaultTeeth,
  describePart,
  extremesOf,
  extrude,
  figureHeight,
  fitView,
  frameOf,
  gearRing,
  hasMotion,
  iso,
  latheGeometry,
  motionOf,
  normalizeAngle,
  type Projection,
  partItem,
  projectionFor,
  readyParts,
  readyProfile,
  roundedRect,
  slideOffset,
  spinAngle,
  viewLabel,
} from "../mechanism-utils"

const P: Projection = { origin: [0, 0], scale: 1, azimuth: 45, elevation: 30 }

const plate: MechanismPart = {
  id: "plate",
  label: "Base plate",
  shape: { type: "box", x: 0, y: 0, w: 200, d: 120, h: 8, r: 6 },
}
const gear: MechanismPart = {
  id: "gear",
  label: "Drive gear",
  shape: { type: "gear", x: -40, y: 0, z: 8, r: 30, h: 10 },
  motion: { type: "spin", speed: 1 },
}
const pipe: MechanismPart = {
  id: "pipe",
  label: "Water line",
  shape: {
    type: "pipe",
    points: [
      [0, 0, 20],
      [40, 0, 20],
      [40, 30, 60],
    ],
    r: 3,
  },
  motion: { type: "flow" },
  accent: true,
}

describe("camera", () => {
  it("projects the origin to the projection origin", () => {
    assert.deepEqual(iso([0, 0, 0], { ...P, origin: [100, 50] }), [100, 50])
  })

  it("draws higher points higher on screen", () => {
    assert.ok(iso([0, 0, 10], P)[1] < iso([0, 0, 0], P)[1])
  })

  it("normalizes angles", () => {
    assert.equal(normalizeAngle(-45), 315)
    assert.equal(normalizeAngle(405), 45)
  })
})

describe("outlines", () => {
  it("builds a rectangle around its centre", () => {
    const ring = roundedRect(10, 20, 40, 20)
    const xs = ring.map(([x]) => x)
    const ys = ring.map(([, y]) => y)
    assert.equal(Math.min(...xs), -10)
    assert.equal(Math.max(...xs), 30)
    assert.equal(Math.min(...ys), 10)
    assert.equal(Math.max(...ys), 30)
  })

  it("gives a gear four points per tooth and keeps tips at the radius", () => {
    const ring = gearRing(0, 0, 30, 12)
    assert.equal(ring.length, 48)
    const reach = Math.max(...ring.map(([x, y]) => Math.hypot(x, y)))
    assert.ok(Math.abs(reach - 30) < 1e-9)
  })

  it("scales the default tooth count with radius, within bounds", () => {
    assert.equal(defaultTeeth(12), 6)
    assert.equal(defaultTeeth(60), 10)
    assert.equal(defaultTeeth(1000), 60)
  })

  it("extrudes a box into fill, outline, top and shaded sides", () => {
    const paths = extrude(roundedRect(0, 0, 40, 40), 0, 20, P)
    assert.ok(paths.fill.startsWith("M"))
    assert.ok(paths.outline.length > 0)
    assert.ok(paths.top.endsWith("Z"))
    assert.equal(paths.shades.length, 4)
    assert.ok(paths.shades.some(Boolean))
  })

  it("draws a flat plate without sides", () => {
    const paths = extrude(roundedRect(0, 0, 40, 40), 0, 0, P)
    assert.ok(paths.shades.every((s) => s === ""))
  })
})

describe("readiness and motion", () => {
  it("keeps complete parts, first of each id", () => {
    const parts = readyParts([
      plate,
      { id: "half", label: "No shape yet" },
      { ...gear, shape: { type: "gear", x: 0, y: 0, r: -1, h: 4 } },
      { ...plate, label: "Duplicate" },
      {
        id: "p",
        label: "Short pipe",
        shape: { type: "pipe", points: [[0, 0, 0]] },
      },
      pipe,
    ])
    assert.deepEqual(
      parts.map((p) => p.id),
      ["plate", "pipe"],
    )
  })

  it("plays only motions that fit the shape", () => {
    assert.equal(motionOf(gear)?.type, "spin")
    assert.equal(motionOf(pipe)?.type, "flow")
    assert.equal(motionOf({ ...plate, motion: { type: "flow" } }), null)
    assert.equal(
      motionOf({ ...pipe, motion: { type: "spin", speed: 1 } }),
      null,
    )
    assert.equal(
      motionOf({ ...gear, motion: { type: "spin", speed: 0 } }),
      null,
    )
    assert.equal(hasMotion([plate]), false)
    assert.equal(hasMotion([plate, gear]), true)
  })

  it("slides out and back, starting at rest", () => {
    assert.deepEqual(slideOffset([0, 0, 20], 2, 0), [0, 0, 0])
    assert.deepEqual(slideOffset([0, 0, 20], 2, 1), [0, 0, 20])
    const back = slideOffset([0, 0, 20], 2, 2)
    assert.ok(Math.abs(back[2]) < 1e-9)
  })

  it("spins a full turn per second at speed 1", () => {
    assert.equal(spinAngle(1, 1), 2 * Math.PI)
    assert.equal(spinAngle(-0.5, 1), -Math.PI)
  })
})

describe("view and scene", () => {
  const parts = [plate, gear, pipe]
  const points = parts.flatMap(extremesOf)
  const view = fitView(points, 640, 360)

  it("fits every camera angle in the box", () => {
    assert.ok(view)
    if (!view) return
    for (const azimuth of [0, 45, 100, 200, 315]) {
      const proj = projectionFor(view, azimuth, 640, 360)
      for (const p of points) {
        const [x, y] = iso(p, proj)
        assert.ok(
          x >= 0 && x <= 640 && y >= 0 && y <= 360,
          `${azimuth}: ${x}, ${y}`,
        )
      }
    }
  })

  it("paints what rests on the plate after the plate, at every angle", () => {
    if (!view) return
    for (const azimuth of [0, 45, 135, 225, 315]) {
      const ids: string[] = buildScene(
        parts,
        projectionFor(view, azimuth, 640, 360),
        0,
      ).map((item) => item.id)
      assert.equal(ids[0], "plate", `${azimuth}: ${ids.join(",")}`)
    }
  })

  it("paints a part behind another one first", () => {
    if (!view) return
    const back: MechanismPart = {
      id: "back",
      label: "Back",
      shape: { type: "box", x: -60, y: -60, w: 20, d: 20, h: 40 },
    }
    const front: MechanismPart = {
      id: "front",
      label: "Front",
      shape: { type: "box", x: 60, y: 60, w: 20, d: 20, h: 40 },
    }
    // At 45° the viewer looks from +x +y, so "front" is nearer.
    const ids = buildScene(
      [front, back],
      projectionFor(view, 45, 640, 360),
      0,
    ).map((i) => i.id)
    assert.deepEqual(ids, ["back", "front"])
    const turned = buildScene(
      [front, back],
      projectionFor(view, 225, 640, 360),
      0,
    ).map((i) => i.id)
    assert.deepEqual(turned, ["front", "back"])
  })

  it("turns a spinning gear's outline over time", () => {
    if (!view) return
    const proj = projectionFor(view, 45, 640, 360)
    const a = partItem(gear, proj, 0)
    const b = partItem(gear, proj, 0.1)
    assert.equal(a.kind, "solid")
    assert.notEqual(
      a.kind === "solid" && a.paths.fill,
      b.kind === "solid" && b.paths.fill,
    )
  })

  it("gives a flowing pipe its speed", () => {
    if (!view) return
    const item = partItem(pipe, projectionFor(view, 45, 640, 360), 0)
    assert.equal(item.kind, "pipe")
    assert.equal(item.kind === "pipe" && item.flow, 1)
  })

  it("has no view without points", () => {
    assert.equal(fitView([], 640, 360), null)
  })
})

describe("round parts", () => {
  const nacelle: MechanismPart = {
    id: "nacelle",
    label: "Nacelle",
    shape: {
      type: "lathe",
      x: -100,
      y: 0,
      z: 40,
      axis: "x",
      profile: [
        [0, 20],
        [80, 36],
        [200, 30],
      ],
      rings: [100],
    },
  }

  it("orders a profile by position and drops bad pairs", () => {
    assert.deepEqual(
      readyProfile([
        [50, 10],
        [0, 5],
        [10, -1],
        ["x", 2],
        [20, 8],
      ]),
      [
        [0, 5],
        [20, 8],
        [50, 10],
      ],
    )
  })

  it("turns a lathe along its axis", () => {
    const xs = extremesOf(nacelle).map((p) => p[0])
    assert.equal(Math.min(...xs), -100)
    assert.equal(Math.max(...xs), 100)
    for (const [, , z] of extremesOf(nacelle))
      assert.ok(z >= 40 - 36 - 1e-6 && z <= 40 + 36 + 1e-6)
  })

  it("draws facets, an outline and its seams", () => {
    const g = latheGeometry(
      frameOf([0, 0, 0], "x"),
      [
        [0, 20],
        [80, 36],
        [200, 30],
      ],
      P,
      { rings: [100] },
    )
    assert.ok(g.facets.length > 0)
    assert.ok(
      g.facets.every(
        (f) => f.shade >= 0 && f.shade <= 4 && f.d.startsWith("M"),
      ),
    )
    assert.ok(g.outline.startsWith("M"))
    assert.ok(g.detail.length > 0)
  })

  it("draws blades on the end face the viewer sees", () => {
    // At 45° the viewer looks from +x, so a fan on an x axis shows its far face.
    const g = latheGeometry(
      frameOf([0, 0, 0], "x"),
      [
        [0, 30],
        [3, 30],
      ],
      P,
      { blades: 12 },
    )
    assert.ok(g.marks.length > 0)
    const hidden = latheGeometry(
      frameOf([0, 0, 0], "x"),
      [
        [0, 30],
        [3, 30],
      ],
      { ...P, azimuth: 225 },
      { blades: 12 },
    )
    assert.equal(hidden.marks, "")
  })

  it("gives a cylinder facets in the scene", () => {
    const can: MechanismPart = {
      id: "can",
      label: "Can",
      shape: { type: "cylinder", x: 0, y: 0, r: 20, h: 40 },
    }
    const item = partItem(can, P, 0)
    assert.equal(item.kind, "solid")
    assert.ok(item.kind === "solid" && item.facets && item.facets.length > 0)
  })

  it("draws a stream as flow only", () => {
    const air: MechanismPart = {
      ...pipe,
      id: "air",
      shape: {
        type: "pipe",
        points: [
          [0, 0, 0],
          [60, 0, 0],
        ],
        stream: true,
      },
    }
    const item = partItem(air, P, 0)
    assert.equal(item.kind === "pipe" && item.stream, true)
  })

  it("draws windows on a box", () => {
    const tower: MechanismPart = {
      id: "t",
      label: "Tower",
      shape: {
        type: "box",
        x: 0,
        y: 0,
        w: 40,
        d: 40,
        h: 120,
        pattern: "windows",
      },
    }
    const item = partItem(tower, P, 0)
    assert.ok(item.kind === "solid" && item.detail.length > 0)
    const bare = partItem(plate, P, 0)
    assert.equal(bare.kind === "solid" && bare.detail, "")
  })

  it("sizes the figure to its shape", () => {
    const tall = figureHeight(
      [
        [0, 0, 0],
        [20, 20, 0],
        [0, 0, 300],
      ],
      640,
    )
    const wide = figureHeight(
      [
        [-150, 0, 0],
        [150, 0, 0],
        [0, 0, 20],
      ],
      640,
    )
    assert.ok(tall > wide, `${tall} vs ${wide}`)
    assert.equal(tall, 520)
    assert.ok(wide < 400, `${wide}`)
    assert.equal(figureHeight([], 640), 300)
  })
})

describe("words", () => {
  it("describes a part with its motion", () => {
    assert.equal(
      describePart({ ...gear, description: "Turns the big gear." }),
      "Drive gear, turns counter-clockwise. Turns the big gear.",
    )
    assert.equal(describePart(plate), "Base plate")
  })

  it("names the view angle", () => {
    assert.equal(viewLabel(45), "Front view")
    assert.equal(viewLabel(90), "Turned 45° left")
    assert.equal(viewLabel(0), "Turned 45° right")
  })
})

describe("schema", () => {
  it("accepts a small machine and defaults askable", () => {
    const parsed = mechanismSchema.parse({
      title: "Gears",
      parts: [plate, gear, pipe],
    })
    assert.equal(parsed.askable, false)
  })

  it("rejects a pipe with one point", () => {
    const r = mechanismSchema.safeParse({
      title: "x",
      parts: [
        { id: "p", label: "p", shape: { type: "pipe", points: [[0, 0, 0]] } },
      ],
    })
    assert.equal(r.success, false)
  })
})
