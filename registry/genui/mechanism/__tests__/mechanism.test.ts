import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { type MechanismPart, mechanismSchema } from "../mechanism.schema"
import { lookMessage, mechanismSvg } from "../mechanism-svg"
import {
  boredProfile,
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
  latticeGeometry,
  motionOf,
  normalizeAngle,
  type Projection,
  partItem,
  projectionFor,
  readyParts,
  readyProfile,
  reviewMechanism,
  reviewMessage,
  roundedRect,
  rotorGeometry,
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

describe("review", () => {
  const box = (
    id: string,
    x: number,
    y: number,
    z: number,
    w: number,
    d: number,
    h: number,
    extra = {},
  ): MechanismPart => ({
    id,
    label: id,
    shape: { type: "box", x, y, z, w, d, h, ...extra },
  })
  // A small tower: base, shaft, crown, mast, all stacked, with windows.
  const tower: MechanismPart[] = [
    box("base", 0, 0, 0, 80, 60, 30, { pattern: "windows" }),
    box("shaft", 0, 0, 30, 50, 40, 150, { pattern: "windows" }),
    box("crown", 0, 0, 180, 30, 24, 20),
    box("roof", 0, 0, 200, 20, 16, 10),
    {
      id: "mast",
      label: "mast",
      shape: { type: "cylinder", x: 0, y: 0, z: 210, r: 3, h: 40 },
    },
    box("ledge", 0, 0, 120, 54, 44, 2),
  ]
  const kinds = (parts: MechanismPart[]) =>
    reviewMechanism(parts).map((n) => n.kind)

  it("passes a well-built figure", () => {
    assert.deepEqual(kinds(tower), [])
    assert.equal(reviewMessage(reviewMechanism(tower)), null)
  })

  it("names parts that float apart from the object", () => {
    const notes = reviewMechanism([
      ...tower,
      box("cloud", 0, 0, 300, 20, 20, 10),
    ])
    assert.deepEqual(
      notes.map((n) => n.kind),
      ["floating"],
    )
    assert.match(notes[0].message, /'cloud' touches nothing/)
  })

  it("lets a stream cross open space", () => {
    const air: MechanismPart = {
      id: "air",
      label: "Air",
      shape: {
        type: "pipe",
        points: [
          [100, 0, 300],
          [140, 0, 300],
        ],
        stream: true,
      },
    }
    assert.deepEqual(kinds([...tower, air]), [])
  })

  it("names a part hidden inside a solid, but not one flush with a face", () => {
    const core = box("core", 0, 0, 60, 20, 20, 40)
    assert.deepEqual(kinds([...tower, core]), ["buried"])
    const plaque = box("plaque", 0, 20, 60, 10, 1, 10)
    assert.deepEqual(kinds([...tower, plaque]), [])
    const inCan: MechanismPart = {
      id: "pin",
      label: "pin",
      shape: { type: "cylinder", x: 0, y: 0, z: 215, r: 1, h: 10 },
    }
    assert.deepEqual(kinds([...tower, inCan]), ["buried"])
  })

  it("asks for the size the drawing is tuned for", () => {
    const tiny = tower
      .map((p) =>
        p.shape.type === "box"
          ? {
              ...p,
              shape: {
                ...p.shape,
                x: 0,
                y: 0,
                z: (p.shape.z ?? 0) / 4,
                w: p.shape.w / 4,
                d: p.shape.d / 4,
                h: p.shape.h / 4,
              },
            }
          : p,
      )
      .slice(0, 4)
    assert.ok(kinds(tiny).includes("scale"))
  })

  it("asks for detail, more parts and fewer accents", () => {
    const plain = [
      box("a", 0, 0, 0, 200, 100, 40),
      box("b", 0, 0, 40, 100, 60, 40),
      box("c", 0, 0, 80, 40, 40, 40),
    ]
    assert.deepEqual(kinds(plain), ["plain", "sparse"])
    const loud = tower.map((p) => ({ ...p, accent: true }))
    assert.deepEqual(kinds(loud), ["accent"])
  })

  it("words the notes for the model", () => {
    const message = reviewMessage(
      reviewMechanism([...tower, box("cloud", 0, 0, 300, 20, 20, 10)]),
    )
    assert.ok(message?.startsWith("The figure was shown"))
    assert.match(message ?? "", /^- 'cloud'/m)
  })
})

describe("svg", () => {
  it("draws one view per angle, side by side, on the card", () => {
    const svg = mechanismSvg([plate, gear, pipe])
    assert.ok(
      svg?.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="1280"'),
    )
    assert.equal(svg?.match(/<g transform="translate\(/g)?.length, 2)
    assert.match(svg ?? "", /fill="#ffffff"/)
    // The accent pipe and its flow use the sky.
    assert.match(svg ?? "", /stroke="#0284c7"/)
    assert.match(svg ?? "", /stroke-dasharray="6 9"/)
    const one = mechanismSvg([plate], { azimuths: [45] })
    assert.ok(one?.includes('width="640"'))
  })

  it("draws nothing without a drawable part", () => {
    assert.equal(mechanismSvg([]), null)
    assert.equal(mechanismSvg([{ id: "x", label: "x" }]), null)
  })

  it("asks the model to compare with the real thing, with the notes", () => {
    const text = lookMessage("Lighthouse", [
      { message: "'Lamp' touches nothing." },
    ])
    assert.match(text, /Compare it with the real Lighthouse/)
    assert.match(text, /^- 'Lamp' touches nothing\.$/m)
    assert.match(lookMessage(undefined), /the real object/)
    assert.doesNotMatch(lookMessage("Fan"), /structure check/)
  })
})

describe("faceted, lattice and rotor parts", () => {
  const F = frameOf([0, 0, 0], "z")
  const square: [number, number][] = [
    [0, 40],
    [100, 20],
  ]

  it("draws a faceted body with straight corners and no round limbs", () => {
    const g = latheGeometry(F, square, P, { sides: 4 })
    // Two side faces and the top show from 45°: one facet each, merged by shade.
    assert.ok(g.facets.length >= 2 && g.facets.length <= 3)
    // Every outline piece is a straight edge between two corners.
    for (const piece of g.outline.split("M").filter(Boolean))
      assert.equal(piece.split("L").length, 2)
  })

  it("draws a lattice as legs, rings and braces with no fill", () => {
    const g = latticeGeometry(F, square, P, 4)
    assert.equal(g.facets.length, 0)
    assert.ok(g.outline.length > 0)
    assert.ok(g.marks.length > 0, "near braces")
    assert.ok(g.detail.length > 0, "far members")
  })

  it("draws a rotor's blades as separate facets around a hub", () => {
    const g = rotorGeometry(frameOf([0, 0, 50], "x"), 80, 4, 0.25, P)
    assert.ok(g.facets.length >= 5, "four blades and the hub")
    const turned = rotorGeometry(frameOf([0, 0, 50], "x"), 80, 4, 0.25, P, 0.3)
    assert.notEqual(g.facets[0].d, turned.facets[0].d)
  })

  it("accepts the new shapes and keeps a rotor's sweep in the view", () => {
    const sails: MechanismPart = {
      id: "sails",
      label: "Sails",
      shape: { type: "rotor", x: 0, y: 0, z: 100, axis: "x", r: 90, blades: 4 },
      motion: { type: "spin", speed: 0.3 },
    }
    assert.ok(
      mechanismSchema.safeParse({ title: "Mill", parts: [sails] }).success,
    )
    const zs = extremesOf(sails).map((p) => p[2])
    assert.equal(Math.round(Math.max(...zs)), 190)
    assert.equal(Math.round(Math.min(...zs)), 10)
    const item = partItem(sails, P, 0)
    assert.ok(item.kind === "solid" && item.facets && item.facets.length > 0)
    const tower: MechanismPart = {
      id: "t",
      label: "Tower",
      shape: {
        type: "lathe",
        x: 0,
        y: 0,
        lattice: true,
        sides: 4,
        profile: [
          [0, 60],
          [200, 4],
        ],
      },
    }
    const lattice = partItem(tower, P, 0)
    assert.ok(lattice.kind === "solid" && lattice.facets?.length === 0)
  })

  it("paints sails after the tower in front and before it from behind", () => {
    const tower: MechanismPart = {
      id: "tower",
      label: "Tower",
      shape: {
        type: "lathe",
        x: 0,
        y: 0,
        sides: 8,
        profile: [
          [0, 50],
          [120, 30],
        ],
      },
    }
    const sails: MechanismPart = {
      id: "sails",
      label: "Sails",
      shape: {
        type: "rotor",
        x: 40,
        y: 0,
        z: 110,
        axis: "x",
        r: 100,
        blades: 4,
      },
    }
    const points = [tower, sails].flatMap(extremesOf)
    const v = fitView(points, 640, 400)
    if (!v) throw new Error("no view")
    const order = (azimuth: number) =>
      buildScene([sails, tower], projectionFor(v, azimuth, 640, 400), 0).map(
        (i) => i.id,
      )
    assert.deepEqual(order(45), ["tower", "sails"])
    assert.deepEqual(order(135), ["sails", "tower"])
  })
})

describe("bore and ghost", () => {
  const ring: MechanismPart = {
    id: "ring",
    label: "Guard ring",
    shape: {
      type: "cylinder",
      x: 0,
      y: 0,
      z: 50,
      axis: "x",
      r: 60,
      h: 5,
      bore: 52,
    },
  }

  it("goes out along the start face, along the outside, back in and down the bore", () => {
    assert.deepEqual(
      boredProfile(
        [
          [0, 60],
          [5, 60],
        ],
        52,
      ),
      [
        [0, 52],
        [0, 60],
        [5, 60],
        [5, 52],
        [0, 52],
      ],
    )
    // A bore wider than the body is held just inside it; none leaves the profile alone.
    assert.equal(
      boredProfile(
        [
          [0, 10],
          [5, 10],
        ],
        40,
      )[0][1],
      9.8,
    )
    assert.deepEqual(
      boredProfile(
        [
          [0, 10],
          [5, 10],
        ],
        0,
      ),
      [
        [0, 10],
        [5, 10],
      ],
    )
  })

  it("draws a ring: facets, and the same reach as a solid cylinder", () => {
    const solid: MechanismPart = {
      ...ring,
      shape: { ...ring.shape, bore: undefined } as MechanismPart["shape"],
    }
    const item = partItem(ring, P, 0)
    assert.ok(item.kind === "solid" && item.facets && item.facets.length > 0)
    assert.deepEqual(extremesOf(ring), extremesOf(solid))
    assert.ok(mechanismSchema.safeParse({ title: "x", parts: [ring] }).success)
  })

  it("shows what is behind the hole", () => {
    // From the front, a solid disc's cap covers the middle; a ring's hole leaves it bare.
    const face = (part: MechanismPart) => {
      const item = partItem(part, P, 0)
      return item.kind === "solid"
        ? (item.facets?.map((f) => f.d).join("") ?? "")
        : ""
    }
    const solid: MechanismPart = {
      ...ring,
      shape: { ...ring.shape, bore: undefined } as MechanismPart["shape"],
    }
    assert.notEqual(face(ring), face(solid))
  })

  it("flags a solid disc over blades, but not a ring, a ghost or a far one", () => {
    const blades: MechanismPart = {
      id: "blades",
      label: "Blades",
      shape: { type: "rotor", x: 20, y: 0, z: 50, axis: "x", r: 55, blades: 5 },
    }
    const motor: MechanismPart = {
      id: "motor",
      label: "Motor",
      shape: {
        type: "cylinder",
        x: -40,
        y: 0,
        z: 50,
        axis: "x",
        r: 20,
        h: 40,
        ribs: 10,
      },
    }
    const base: MechanismPart = {
      id: "base",
      label: "Base",
      shape: {
        type: "box",
        x: 0,
        y: 0,
        z: 0,
        w: 120,
        d: 120,
        h: 6,
        pattern: "panels",
      },
    }
    const stand: MechanismPart = {
      id: "stand",
      label: "Stand",
      shape: {
        type: "box",
        x: 0,
        y: 0,
        z: 6,
        w: 10,
        d: 10,
        h: 40,
        pattern: "panels",
      },
    }
    const arm: MechanismPart = {
      id: "arm",
      label: "Arm",
      shape: {
        type: "box",
        x: 0,
        y: 0,
        z: 46,
        w: 10,
        d: 60,
        h: 8,
        pattern: "panels",
      },
    }
    const disc: MechanismPart = {
      id: "disc",
      label: "Front disc",
      shape: {
        type: "cylinder",
        x: 40,
        y: 0,
        z: 50,
        axis: "x",
        r: 60,
        h: 4,
        ribs: 12,
      },
    }
    const rest = [base, stand, arm, motor, blades]
    const kinds = (parts: MechanismPart[]) =>
      reviewMechanism(parts).map((n) => n.kind)
    assert.ok(kinds([...rest, disc]).includes("hidden"))
    assert.match(
      reviewMechanism([...rest, disc]).find((n) => n.kind === "hidden")
        ?.message ?? "",
      /'Front disc' is a solid disc over 'Blades'.*bore/,
    )
    assert.ok(
      !kinds([
        ...rest,
        {
          ...disc,
          shape: { ...disc.shape, bore: 52 } as MechanismPart["shape"],
        },
      ]).includes("hidden"),
    )
    assert.ok(!kinds([...rest, { ...disc, ghost: true }]).includes("hidden"))
    assert.ok(
      !kinds([
        ...rest,
        { ...disc, shape: { ...disc.shape, x: 200 } as MechanismPart["shape"] },
      ]).includes("hidden"),
    )
  })

  it("only flags a disc in front of blades on an end face, not one underneath", () => {
    const label: MechanismPart = {
      id: "label",
      label: "Record label",
      shape: { type: "cylinder", x: 0, y: 0, z: 32, r: 22, h: 0.6, blades: 3 },
    }
    const plate = (z: number): MechanismPart => ({
      id: "plate",
      label: "Platter",
      shape: { type: "cylinder", x: 0, y: 0, z, r: 70, h: 8 },
    })
    const kinds = (parts: MechanismPart[]) =>
      reviewMechanism(parts).map((n) => n.kind)
    const base: MechanismPart = {
      id: "base",
      label: "Base",
      shape: {
        type: "box",
        x: 0,
        y: 0,
        z: 0,
        w: 180,
        d: 180,
        h: 20,
        pattern: "panels",
      },
    }
    assert.ok(!kinds([base, plate(24), label]).includes("hidden"))
    assert.ok(kinds([base, plate(32), label]).includes("hidden"))
  })

  it("marks a ghost on its scene item, and paints it after what is inside", () => {
    const shell: MechanismPart = {
      id: "shell",
      label: "Cabinet",
      ghost: true,
      shape: {
        type: "box",
        x: 0,
        y: 0,
        z: 0,
        w: 100,
        d: 100,
        h: 100,
        pattern: "panels",
      },
    }
    const inner: MechanismPart = {
      id: "inner",
      label: "Drum",
      shape: {
        type: "cylinder",
        x: 0,
        y: 0,
        z: 20,
        axis: "x",
        r: 20,
        h: 40,
        ribs: 8,
      },
    }
    const points = [shell, inner].flatMap(extremesOf)
    const v = fitView(points, 640, 400)
    if (!v) throw new Error("no view")
    for (const azimuth of [45, 135, 225, 315]) {
      const ids: string[] = buildScene(
        [shell, inner],
        projectionFor(v, azimuth, 640, 400),
        0,
      ).map((i) => i.id)
      assert.deepEqual(ids, ["inner", "shell"], String(azimuth))
    }
    assert.equal((partItem(shell, P, 0) as { ghost: boolean }).ghost, true)
    assert.equal((partItem(inner, P, 0) as { ghost: boolean }).ghost, false)
  })

  it("buries nothing inside a ghost or a bored body", () => {
    const inner: MechanismPart = {
      id: "inner",
      label: "Drum",
      shape: {
        type: "cylinder",
        x: 0,
        y: 0,
        z: 40,
        axis: "x",
        r: 10,
        h: 20,
        ribs: 8,
      },
    }
    const box = (extra: Partial<MechanismPart>): MechanismPart => ({
      id: "cab",
      label: "Cabinet",
      shape: {
        type: "box",
        x: 0,
        y: 0,
        z: 0,
        w: 100,
        d: 100,
        h: 100,
        pattern: "panels",
      },
      ...extra,
    })
    const kinds = (parts: MechanismPart[]) =>
      reviewMechanism(parts).map((n) => n.kind)
    assert.ok(kinds([box({}), inner]).includes("buried"))
    assert.ok(!kinds([box({ ghost: true }), inner]).includes("buried"))
  })

  it("asks for solid parts when too many are ghosts", () => {
    const shell = (id: string, x: number): MechanismPart => ({
      id,
      label: id,
      ghost: true,
      shape: {
        type: "box",
        x,
        y: 0,
        z: 0,
        w: 50,
        d: 50,
        h: 50,
        pattern: "panels",
      },
    })
    const some = [shell("a", 0), shell("b", 50), shell("c", 100)]
    const kinds = (parts: MechanismPart[]) =>
      reviewMechanism(parts).map((n) => n.kind)
    assert.ok(kinds(some).includes("ghosts"))
    assert.ok(!kinds(some.slice(0, 2)).includes("ghosts"))
  })

  it("writes bolt positions and pipe widths to hundredths", () => {
    // These go to the page as they are; the server's and the browser's last bits of trig must not reach them.
    const flange: MechanismPart = {
      id: "flange",
      label: "Flange",
      shape: {
        type: "cylinder",
        x: 3.3,
        y: 1.7,
        z: 20,
        axis: "x",
        r: 31.3,
        h: 6,
        bolts: 9,
      },
    }
    const item = partItem(flange, P, 0)
    assert.ok(item.kind === "solid" && item.dots.length === 9)
    const hundredth = (v: number) => Math.round(v * 100) / 100
    if (item.kind === "solid")
      for (const [x, y] of item.dots)
        assert.ok(x === hundredth(x) && y === hundredth(y), `${x}, ${y}`)
    const tube: MechanismPart = {
      id: "tube",
      label: "Tube",
      shape: {
        type: "pipe",
        points: [
          [0, 0, 0],
          [50, 0, 0],
        ],
        r: 3.37,
      },
    }
    const pipe = partItem(tube, P, 0)
    assert.ok(pipe.kind === "pipe" && pipe.width === hundredth(pipe.width))
  })

  it("draws a ghost faintly in the svg export", () => {
    const shell: MechanismPart = {
      id: "shell",
      label: "Cabinet",
      ghost: true,
      shape: { type: "box", x: 0, y: 0, z: 0, w: 100, d: 100, h: 100 },
    }
    const solid: MechanismPart = { ...shell, ghost: false }
    assert.match(mechanismSvg([shell]) ?? "", /<g opacity="0.3">/)
    assert.doesNotMatch(mechanismSvg([solid]) ?? "", /<g opacity="0.3">/)
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

  it("is forgiving where a limit only guards decoration", () => {
    // These once discarded a whole figure: a long caption, a hair-thin cable, a profile that starts before the origin, ribs of 0.
    const ok = mechanismSchema.safeParse({
      title: "Bridge",
      caption:
        "A long suspension span hung from two tall towers by thick cables, with a roadway slung beneath.",
      parts: [
        {
          id: "cable",
          label: "Cable",
          shape: {
            type: "pipe",
            points: [
              [0, 0, 0],
              [50, 0, 20],
            ],
            r: 0.2,
          },
        },
        {
          id: "nose",
          label: "Nose",
          shape: {
            type: "lathe",
            x: 0,
            y: 0,
            ribs: 0,
            rings: [-5],
            profile: [
              [-10, 4],
              [20, 8],
            ],
          },
        },
      ],
    })
    assert.ok(ok.success, ok.success ? "" : JSON.stringify(ok.error.issues))
    // A real limit still holds.
    assert.equal(
      mechanismSchema.safeParse({
        title: "x",
        caption: "x".repeat(200),
        parts: [],
      }).success,
      false,
    )
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
