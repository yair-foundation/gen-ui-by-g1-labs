import { z } from "zod"

/**
 * Mechanism: the agent's contract.
 *
 * A machine, device or building drawn as an isometric figure, assembled from
 * solids (boxes, cylinders, turned lathe profiles on any axis, faceted or as
 * open lattice, rotors, gears, pipes)
 * with surface detail (windows, vents, blades, ribs, seams, bolts) and parts
 * that move: gears and rotors spin, flow runs along pipes, parts slide. The
 * user turns the view, pauses the motion and inspects each part. Inspired by
 * Anatomy (MIT, https://github.com/wheresryan22/anatomy); the component
 * draws, the agent only describes the parts.
 *
 * World units: x and y on the floor, z up, about 1 unit per pixel. The
 * component fits the whole machine to the card.
 */

const coord = z.number().min(-400).max(400)
const size = z.number().positive().max(400)
const height = z.number().min(0).max(400)

/** Round parts (cylinder, lathe) lie along an axis and carry their own detail. */
const axis = z
  .enum(["x", "y", "z"])
  .optional()
  .describe(
    "The axis the round part turns around. Default z (standing up); x or y lays it down, e.g. an engine or a pipe run.",
  )

const roundDetail = {
  ribs: z
    .number()
    .int()
    .min(0)
    .max(64)
    .optional()
    .describe(
      "Lines along the body at even angles: fins, flutes, a knurl, cooling ribs. 3 to 64; 0 or none for no ribs.",
    ),
  rings: z
    .array(z.number().min(-800).max(800))
    .max(12)
    .optional()
    .describe(
      "Seams around the body at these distances along the axis: bands, weld lines, joints between sections.",
    ),
  blades: z
    .number()
    .int()
    .min(2)
    .max(48)
    .optional()
    .describe(
      "Vanes drawn on the end face at the far end of the axis (a cylinder's top, a lathe's last profile point): a fan inside its duct, a turbine wheel, wheel spokes. Spin turns them. For blades with open air between them (windmill sails, a propeller, a wind turbine, a helicopter rotor) use a rotor part.",
    ),
  bolts: z
    .number()
    .int()
    .min(3)
    .max(36)
    .optional()
    .describe("A bolt circle on that same end face: a flange, a cap, a hub."),
  sides: z
    .number()
    .int()
    .min(3)
    .max(12)
    .optional()
    .describe(
      "Flat sides instead of a round body: 4 for a square tower, obelisk or pyramid (a square lathe tapering to r 0), 6 for a hex nut or pencil.",
    ),
  lattice: z
    .boolean()
    .optional()
    .describe(
      "Draw the body as an open iron truss you see through: legs at the corners (sides, default 4), a ring at each profile point and X-bracing on every face. The Eiffel Tower, an electricity pylon, a crane's mast or jib, a radio mast.",
    ),
}

const base = {
  x: coord.describe("Centre on the floor, x."),
  y: coord.describe("Centre on the floor, y."),
  z: height
    .optional()
    .describe("Height of the bottom face above the floor. Default 0."),
}

export const mechanismShapeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("box"),
    ...base,
    w: size.describe("Width along x."),
    d: size.describe("Depth along y."),
    h: height.describe("Height along z. 0 draws a flat plate."),
    r: z
      .number()
      .min(0)
      .max(60)
      .optional()
      .describe("Corner radius on the floor outline. Default 0."),
    pattern: z
      .enum(["windows", "vents", "panels"])
      .optional()
      .describe(
        "Detail drawn on the visible sides: windows (a grid, for buildings), vents (slots, for cases and grilles) or panels (an inset outline).",
      ),
  }),
  z.object({
    type: z.literal("cylinder"),
    x: coord.describe("Centre of the starting face, x."),
    y: coord.describe("Centre of the starting face, y."),
    z: height
      .optional()
      .describe(
        "Centre of the starting face, z. Default 0. Standing up (axis z) that is the bottom centre.",
      ),
    r: size.describe("Radius."),
    h: height.describe("Length along the axis."),
    axis,
    bore: size
      .optional()
      .describe(
        "Radius of a hole through the centre, so the ends are rings and you see into it: a tube, a rim or hoop, a tyre, a fan cage, a flange, a cup. Use it wherever the real part is open in the middle, not a solid disc.",
      ),
    ...roundDetail,
  }),
  z.object({
    type: z.literal("lathe"),
    x: coord.describe("Where the axis starts (s = 0), x."),
    y: coord.describe("Where the axis starts (s = 0), y."),
    z: height
      .optional()
      .describe("Where the axis starts (s = 0), z. Default 0."),
    axis,
    profile: z
      .array(
        z.tuple([z.number().min(-800).max(800), z.number().min(0).max(400)]),
      )
      .min(2)
      .max(24)
      .describe(
        "The half-section, [s, r] from one end to the other: distance along the axis and radius there. Two points at the same s make a step (a shoulder); several points make a curve (a dome, a bell, a nozzle); r 0 at an end closes it to a point.",
      ),
    open: z
      .boolean()
      .optional()
      .describe(
        "Hollow with no end faces, so you see into it: a bell, horn, nozzle, intake or speaker cone.",
      ),
    ...roundDetail,
  }),
  z.object({
    type: z.literal("rotor"),
    x: coord.describe("Hub centre, x."),
    y: coord.describe("Hub centre, y."),
    z: height.optional().describe("Hub centre, z. Default 0."),
    axis: axis.describe(
      "The axis the rotor turns around. x or y for windmill sails, a propeller or a wind turbine facing that way; z (default) for a helicopter rotor or ceiling fan.",
    ),
    r: size.describe("Radius to the blade tips."),
    blades: z
      .number()
      .int()
      .min(2)
      .max(12)
      .describe("Number of blades or sails."),
    chord: z
      .number()
      .min(0.04)
      .max(0.6)
      .optional()
      .describe(
        "Blade width as a fraction of the radius. Default 0.15; about 0.3 for windmill sails, 0.08 for a wind turbine or helicopter rotor.",
      ),
  }),
  z.object({
    type: z.literal("gear"),
    ...base,
    r: size.describe("Radius to the tooth tips."),
    h: height.describe("Thickness along z."),
    teeth: z
      .number()
      .int()
      .min(6)
      .max(60)
      .optional()
      .describe(
        "Tooth count. Default about one tooth per 6 units of radius. Meshing gears share a tooth size, so teeth scale with radius.",
      ),
  }),
  z.object({
    type: z.literal("pipe"),
    points: z
      .array(z.tuple([coord, coord, height]))
      .min(2)
      .max(24)
      .describe(
        "[x, y, z] points along the pipe's centre line, in the direction anything flows. Also any slender member that isn't along an axis (a connecting rod, strut, boom, brace, arm or cable): leave out motion and flow, and it draws as a solid rod.",
      ),
    r: z
      .number()
      .min(0.1)
      .max(20)
      .optional()
      .describe("Pipe radius. Default 3. Thin cables and wires can be 0.2."),
    stream: z
      .boolean()
      .optional()
      .describe(
        "Draw only the flow, no tube: air into an intake, exhaust, light or a signal crossing open space.",
      ),
  }),
])

export const mechanismMotionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("spin"),
    speed: z
      .number()
      .min(-3)
      .max(3)
      .describe(
        "Turns per second about the part's own axis (vertical for boxes and gears, the axis of a cylinder or lathe); positive is counter-clockwise looking back down the axis. Meshing gears turn opposite ways, their speeds in inverse ratio to their radii. A round part shows its spin through its blades, ribs or bolts.",
      ),
  }),
  z.object({
    type: z.literal("flow"),
    speed: z
      .number()
      .min(0.1)
      .max(3)
      .optional()
      .describe("Pipes only: relative flow speed. Default 1."),
  }),
  z.object({
    type: z.literal("slide"),
    by: z
      .tuple([coord, coord, coord])
      .describe("[dx, dy, dz]: how far the part travels and back."),
    seconds: z
      .number()
      .min(0.4)
      .max(12)
      .optional()
      .describe("One full stroke out and back. Default 2."),
  }),
])

export const mechanismPartSchema = z.object({
  id: z.string().describe("Stable id, returned in the result."),
  label: z
    .string()
    .max(32)
    .describe("The part's name, shown when it's inspected, e.g. 'Drive gear'."),
  description: z
    .string()
    .max(160)
    .optional()
    .describe("One sentence on what the part does, shown when it's inspected."),
  shape: mechanismShapeSchema,
  motion: mechanismMotionSchema
    .optional()
    .describe("How the part moves. Omit for parts that stay still."),
  ghost: z
    .boolean()
    .optional()
    .describe(
      "Draws the part as a see-through shell, so the parts inside it show: a casing, housing, cabinet, tank wall or glass cover. Use it on whatever hides the workings, instead of leaving walls off.",
    ),
  accent: z
    .boolean()
    .optional()
    .describe(
      "Draws the part in the accent colour: the one thing the figure is about, like the water in a pipe. At most one or two parts.",
    ),
})

export const mechanismSchema = z.object({
  title: z
    .string()
    .describe("The machine or object, e.g. 'Two-stage gear reduction'."),
  caption: z
    .string()
    .max(140)
    .optional()
    .describe(
      "One short line under the title, up to about 80 characters, on how it works, e.g. 'A small gear drives a big one: slower, with more torque.'",
    ),
  parts: z
    .array(mechanismPartSchema)
    .min(1)
    .max(60)
    .describe(
      "Every part, positioned as assembled. The component paints them back to front, so order doesn't matter.",
    ),
  askable: z
    .boolean()
    .default(false)
    .describe(
      "Adds 'Ask about' so the user can ask you to explain a part. Leave off for display only.",
    ),
})

export type MechanismShape = z.infer<typeof mechanismShapeSchema>
export type MechanismMotion = z.infer<typeof mechanismMotionSchema>
export type MechanismPart = z.infer<typeof mechanismPartSchema>
export type MechanismInput = z.input<typeof mechanismSchema>

/** Sent back when the user asks about a part (only when askable). */
export type MechanismResult = { action: "explain"; partId: string }

/** Usage guidance the agent reads before choosing this component. */
export const mechanismGuidance = {
  useWhen: [
    "The user asks how a machine or mechanism works and seeing it move helps: 'how does a jet engine work?', 'how does a drip coffee maker work?', 'show me how a gearbox reduces speed'.",
    "The user wants a 3D figure of a physical object, device or building they'd recognise: 'show me the Empire State Building in 3D', 'a 3D model of an active speaker'.",
  ],
  avoidWhen: [
    "What it's made of matters more than how it moves: use show_part_diagram (an exploded view by system).",
    "The parts are abstract (services, teams, steps). Use show_relationships or show_timeline.",
    "A sentence answers it, or the user wants a photo. Text or an image is better than a figure.",
    "Its shape is organic (a person, an animal, a plant): this figure is built from machined solids.",
  ],
  rules: [
    "Shape first: the object must be recognisable from its outline alone. Use its real proportions: recall the real dimensions, scale the longest side to about 200 to 260 units, and derive every other size from the real ratios, so tall things stay tall (the Empire State Building is 3 times taller than its base is wide, the Eiffel Tower 2.6 times; a bus is 4 times longer than it is wide) and its real orientation: an engine lies along x, a speaker stands with its cones facing +x, a tower stands up along z. Turn the side people recognise toward +x, the default view: an engine's intake and fan, a speaker's cones, a machine's controls and door, a vehicle's cab or front.",
    "Round bodies are cylinders or lathes on their real axis, never stood up when the real thing lies down: a nacelle, nozzle, cone, dome, bell, horn or speaker cone is a lathe profile [s, r]; two points at the same s make a shoulder, so collars, flanges and bands on a body are steps in its own profile, not extra parts; open: true is a hollow you see into.",
    "When the user asks how something works or what is inside it, keep its outside and show the workings through it: set ghost: true on the one casing, cabinet, housing or glass cover that hides them, and place the parts inside it. Don't leave walls off, which makes the object unrecognisable. When the user just wants a 3D model or picture of the thing, draw it closed and solid, with no ghost; and never ghost a building, tower, mill, vehicle body or anything else you look at from outside. A ghost is only for what is really enclosed (a drum in a cabinet, an impeller in a casing): a speaker's cones, a door, a dial or a screen sit on the outside face of a solid body. At most one or two ghosts. Anything open in the middle (a rim, hoop, tyre, fan cage, tube, flange or cup) is a cylinder with a bore, never a solid disc, which would hide what's behind it.",
    "Make it look real with the detail fields, not extra parts: windows on buildings, vents or panels on cases, blades on fans, turbines and wheels, ribs for fins, rings for seams between sections, bolts on flanges and hubs.",
    "Start from the recipe for its kind, then add what makes this one recognisable. Buildings and towers: stacked boxes with windows, each setback narrower, crowned by a cylinder or lathe spire or mast on z; a tapering square tower is a lathe with sides 4; an iron tower, pylon or crane mast is a lattice lathe whose profile tapers continuously from the base to the top (in one or more sections, each starting where the last ended), with floors as thin boxes. Vehicles: the body as boxes or a lathe along x (fuselage, hull, boiler, tank), wheels as y-axis cylinders with blades for spokes, propellers and rotors as rotor parts that spin. Appliances and devices: a box body with panels or vents, controls as small ribbed cylinders, screens and doors as thin boxes or flat cylinders on the face. Fans: a motor and stand behind, a rotor with hub in front, a cage of bored rings front and back, never solid discs. Engines, pumps and turbines: a ghost casing (a lathe along the shaft) with the rotor, impeller or fan inside it, and an intake with a visible fan facing +x; enclosed rotors as cylinders with blades, open ones (windmills, wind turbines) as rotor parts, flanges as profile steps with bolts, flow as pipes or streams. Washing machines, ovens and other cabinets: the closed cabinet as a ghost box with its door and controls on the +x face and the drum or workings inside. Rods, struts, arms and braces that run at an angle (a connecting rod, a crane jib): pipes with no flow. Instruments and tools: base, column, arm and working head, with tubes and lenses as lathes on their real axis. Bridges and frames: decks and towers as boxes or lattice lathes, cables as pipes.",
    "Use 8 to 40 parts, each resting on or joined to another (set z so parts sit on what's under them). No base plate unless the real thing stands on one.",
    "Move only what moves in the real machine, at believable relative speeds: rotors and fans spin about their own axis, meshing gears turn opposite ways at speeds in inverse ratio to their radii, flow runs from a pipe's first point to its last (stream: true for air or exhaust in open space). A building or other still object has no motion.",
    "Mark one or two parts as accent: the thing the figure is about.",
    "Give every part a short label and, for the parts that matter, one sentence on what it does.",
    "Set askable only when you want the user to ask about a part; on 'explain', answer about that part in text.",
  ],
} as const

/**
 * Tool definition. Shape-compatible with the Vercel AI SDK `tool()` helper and
 * convertible to JSON Schema with `z.toJSONSchema(mechanismSchema)`.
 */
export const mechanismTool = {
  name: "show_mechanism",
  description: [
    "Show a machine, device or building as an animated isometric 3D figure built from boxes, cylinders, turned lathe profiles on any axis (round, faceted or open lattice), rotors, gears and pipes, with surface detail (windows, vents, blades, ribs, seams, bolts): rotors and gears spin, flow runs along pipes, parts slide. The user can turn the view, pause and inspect each part.",
    `Use when: ${mechanismGuidance.useWhen.join(" ")}`,
    `Avoid when: ${mechanismGuidance.avoidWhen.join(" ")}`,
    `Rules: ${mechanismGuidance.rules.join(" ")}`,
  ].join("\n"),
  inputSchema: mechanismSchema,
} as const
