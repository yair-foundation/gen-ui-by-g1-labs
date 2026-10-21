/**
 * The simulation engine: compiles an agent-declared model once and runs it
 * step by step. Pure logic, no React.
 *
 * Formulas use a small, safe language (the same one as the Calculator): no
 * `eval`, no property access, no strings. Only numbers, named values,
 * arithmetic, comparisons and a fixed set of functions.
 *
 * Operators: + - * / % ^ and < > <= >= == != (comparisons give 1 or 0).
 * Functions: min, max, round(x, digits?), floor, ceil, abs, sqrt, pow,
 * clamp(x, lo, hi), if(condition, then, else).
 *
 * How a run works:
 *   step 0  state = initial formulas (inputs, earlier state, t = 0)
 *           outputs = output formulas (inputs, state, earlier outputs, t)
 *   step t  each state's next value = its step formula, evaluated on the
 *           previous step's state and outputs, the inputs, and t (1, 2, …)
 *   Every step: stop at the first non-finite value, mark the first step each
 *   milestone is true, and stop after the first step where stopWhen is true.
 */

export const MAX_STEPS = 1000

// ---------------------------------------------------------------------------
// Formula language (copied from calculator-formula.ts so this file stands
// alone when installed)

export type Node =
  | { type: "num"; value: number }
  | { type: "var"; name: string }
  | { type: "unary"; arg: Node }
  | { type: "binary"; op: string; left: Node; right: Node }
  | { type: "call"; name: string; args: Node[] }

type Token =
  | { kind: "num"; value: number }
  | { kind: "id"; value: string }
  | { kind: "op"; value: string }

const FUNCTIONS: Record<
  string,
  { arity: [number, number]; fn: (...a: number[]) => number }
> = {
  min: { arity: [1, 20], fn: Math.min },
  max: { arity: [1, 20], fn: Math.max },
  round: {
    arity: [1, 2],
    fn: (x, digits = 0) => {
      const f = 10 ** Math.max(0, Math.min(10, Math.trunc(digits)))
      return Math.round(x * f) / f
    },
  },
  floor: { arity: [1, 1], fn: Math.floor },
  ceil: { arity: [1, 1], fn: Math.ceil },
  abs: { arity: [1, 1], fn: Math.abs },
  sqrt: { arity: [1, 1], fn: Math.sqrt },
  pow: { arity: [2, 2], fn: Math.pow },
  clamp: { arity: [3, 3], fn: (x, lo, hi) => Math.min(Math.max(x, lo), hi) },
  // Both branches are evaluated; fine for pure arithmetic.
  if: { arity: [3, 3], fn: (c, a, b) => (c ? a : b) },
}

export class FormulaError extends Error {}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i))
      if (!m) throw new FormulaError(`Bad number at ${i + 1}`)
      tokens.push({ kind: "num", value: Number(m[0]) })
      i += m[0].length
    } else if (/[A-Za-z_]/.test(ch)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray
      tokens.push({ kind: "id", value: m[0] })
      i += m[0].length
    } else {
      const two = src.slice(i, i + 2)
      if (["<=", ">=", "==", "!="].includes(two)) {
        tokens.push({ kind: "op", value: two })
        i += 2
      } else if ("+-*/%^()<>,".includes(ch)) {
        tokens.push({ kind: "op", value: ch })
        i++
      } else {
        throw new FormulaError(`Unexpected "${ch}"`)
      }
    }
  }
  return tokens
}

/** Parses a formula into a tree. Throws FormulaError on bad syntax. */
export function parseFormula(src: string): Node {
  if (src.length > 500) throw new FormulaError("Formula is too long")
  const tokens = tokenize(src)
  let pos = 0
  const peek = () => tokens[pos]
  const isOp = (v: string) => peek()?.kind === "op" && peek()?.value === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`)
    pos++
  }

  const comparison = (): Node => {
    let left = additive()
    while (["<", ">", "<=", ">=", "==", "!="].some(isOp)) {
      const op = tokens[pos++].value as string
      left = { type: "binary", op, left, right: additive() }
    }
    return left
  }
  const additive = (): Node => {
    let left = term()
    while (isOp("+") || isOp("-")) {
      const op = tokens[pos++].value as string
      left = { type: "binary", op, left, right: term() }
    }
    return left
  }
  const term = (): Node => {
    let left = unary()
    while (isOp("*") || isOp("/") || isOp("%")) {
      const op = tokens[pos++].value as string
      left = { type: "binary", op, left, right: unary() }
    }
    return left
  }
  // Unary minus binds looser than ^, so -2^2 is -(2^2).
  const unary = (): Node => {
    if (isOp("-")) {
      pos++
      return { type: "unary", arg: unary() }
    }
    if (isOp("+")) {
      pos++
      return unary()
    }
    return power()
  }
  const power = (): Node => {
    const base = primary()
    if (isOp("^")) {
      pos++
      return { type: "binary", op: "^", left: base, right: unary() }
    }
    return base
  }
  const primary = (): Node => {
    const t = peek()
    if (!t) throw new FormulaError("Formula ended early")
    if (t.kind === "num") {
      pos++
      return { type: "num", value: t.value }
    }
    if (t.kind === "id") {
      pos++
      if (!isOp("(")) return { type: "var", name: t.value }
      const spec = FUNCTIONS[t.value]
      if (!spec) throw new FormulaError(`Unknown function "${t.value}"`)
      pos++
      const args: Node[] = []
      if (!isOp(")")) {
        args.push(comparison())
        while (isOp(",")) {
          pos++
          args.push(comparison())
        }
      }
      expect(")")
      if (args.length < spec.arity[0] || args.length > spec.arity[1]) {
        throw new FormulaError(`Wrong number of arguments to ${t.value}()`)
      }
      return { type: "call", name: t.value, args }
    }
    if (isOp("(")) {
      pos++
      const inner = comparison()
      expect(")")
      return inner
    }
    throw new FormulaError(`Unexpected "${t.value}"`)
  }

  const tree = comparison()
  if (pos < tokens.length)
    throw new FormulaError(`Unexpected "${tokens[pos].value}"`)
  return tree
}

/** Names a formula reads, for dependency checks. */
export function variablesOf(node: Node, out = new Set<string>()): Set<string> {
  if (node.type === "var") out.add(node.name)
  else if (node.type === "unary") variablesOf(node.arg, out)
  else if (node.type === "binary") {
    variablesOf(node.left, out)
    variablesOf(node.right, out)
  } else if (node.type === "call")
    for (const a of node.args) variablesOf(a, out)
  return out
}

/** Evaluates a parsed formula. Returns NaN for undefined maths (e.g. 0/0). */
export function evaluate(node: Node, scope: Record<string, number>): number {
  switch (node.type) {
    case "num":
      return node.value
    case "var": {
      if (!Object.hasOwn(scope, node.name))
        throw new FormulaError(`Unknown value "${node.name}"`)
      return scope[node.name]
    }
    case "unary":
      return -evaluate(node.arg, scope)
    case "call":
      return FUNCTIONS[node.name].fn(
        ...node.args.map((a) => evaluate(a, scope)),
      )
    case "binary": {
      const a = evaluate(node.left, scope)
      const b = evaluate(node.right, scope)
      switch (node.op) {
        case "+":
          return a + b
        case "-":
          return a - b
        case "*":
          return a * b
        case "/":
          return a / b
        case "%":
          return a % b
        case "^":
          return a ** b
        case "<":
          return Number(a < b)
        case ">":
          return Number(a > b)
        case "<=":
          return Number(a <= b)
        case ">=":
          return Number(a >= b)
        case "==":
          return Number(a === b)
        case "!=":
          return Number(a !== b)
      }
    }
  }
  throw new FormulaError("Unsupported expression")
}

// ---------------------------------------------------------------------------
// Models

/** The parts of the tool input the engine needs. */
export type ModelSpec = {
  inputs: { id: string; default?: number; min?: number; max?: number }[]
  state: { id: string; initial: string }[]
  step: { id: string; formula: string }[]
  steps: number
  outputs?: { id: string; formula: string }[]
  stopWhen?: string
  milestones?: { label: string; when: string }[]
  plot?: string[]
}

type Compiled = { id: string; tree: Node }

export type CompiledModel = {
  inputIds: string[]
  state: Compiled[]
  step: Map<string, Node>
  outputs: Compiled[]
  stopWhen: Node | null
  milestones: { label: string; tree: Node }[]
  steps: number
}

/** One row per step: `t` plus every state and output value. */
export type SimRow = Record<string, number> & { t: number }

export type SimRun = {
  rows: SimRow[]
  /** The step where stopWhen first held, or null if the run went the distance. */
  stoppedAt: number | null
  /** First step each milestone held, in milestone order (null: never). */
  milestones: (number | null)[]
  /** The first non-finite value; the run stops before that step. */
  invalid: { step: number; id: string } | null
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
/** Reserved: the step counter. */
export const STEP_VAR = "t"

/**
 * Checks a model without running it: formulas parse, names are unique and
 * every formula reads only names it may see. Returns readable issues; an
 * empty list means the model is valid.
 */
export function validateModel(spec: ModelSpec): string[] {
  const issues: string[] = []
  const outputs = spec.outputs ?? []
  const seen = new Set<string>()
  for (const { id } of [...spec.inputs, ...spec.state, ...outputs]) {
    if (!IDENT.test(id)) issues.push(`"${id}" isn't a valid name`)
    else if (id === STEP_VAR)
      issues.push(`"${STEP_VAR}" is reserved for the step`)
    else if (FUNCTIONS[id]) issues.push(`"${id}" is a function name`)
    else if (seen.has(id)) issues.push(`"${id}" is used twice`)
    seen.add(id)
  }

  const check = (where: string, src: string, allowed: Set<string>) => {
    try {
      const unknown = [...variablesOf(parseFormula(src))].filter(
        (v) => !allowed.has(v),
      )
      if (unknown.length) issues.push(`${where}: unknown name "${unknown[0]}"`)
    } catch (e) {
      issues.push(
        `${where}: ${e instanceof FormulaError ? e.message : "invalid formula"}`,
      )
    }
  }

  const inputIds = spec.inputs.map((i) => i.id)
  const stateIds = spec.state.map((s) => s.id)
  const outputIds = outputs.map((o) => o.id)

  // Initial values see inputs, earlier state and t.
  spec.state.forEach((s, i) => {
    check(
      `Initial value of "${s.id}"`,
      s.initial,
      new Set([STEP_VAR, ...inputIds, ...stateIds.slice(0, i)]),
    )
  })
  // Outputs see inputs, all state, earlier outputs and t.
  outputs.forEach((o, i) => {
    check(
      `Output "${o.id}"`,
      o.formula,
      new Set([STEP_VAR, ...inputIds, ...stateIds, ...outputIds.slice(0, i)]),
    )
  })
  const everything = new Set([STEP_VAR, ...inputIds, ...stateIds, ...outputIds])
  const stepIds = new Set<string>()
  for (const s of spec.step) {
    if (!stateIds.includes(s.id))
      issues.push(`Step "${s.id}" doesn't match a state value`)
    else if (stepIds.has(s.id)) issues.push(`Step "${s.id}" is defined twice`)
    stepIds.add(s.id)
    check(`Step "${s.id}"`, s.formula, everything)
  }
  for (const id of stateIds)
    if (!stepIds.has(id)) issues.push(`State "${id}" has no step formula`)
  if (spec.stopWhen !== undefined) check("stopWhen", spec.stopWhen, everything)
  for (const m of spec.milestones ?? [])
    check(`Milestone "${m.label}"`, m.when, everything)
  for (const id of spec.plot ?? [])
    if (!stateIds.includes(id) && !outputIds.includes(id))
      issues.push(`plot: "${id}" isn't a state or output`)

  for (const input of spec.inputs) {
    if (
      input.min !== undefined &&
      input.max !== undefined &&
      input.min >= input.max
    )
      issues.push(`Input "${input.id}": min must be below max`)
    if (
      input.default !== undefined &&
      ((input.min !== undefined && input.default < input.min) ||
        (input.max !== undefined && input.default > input.max))
    )
      issues.push(`Input "${input.id}": default is outside min–max`)
  }
  if (!Number.isInteger(spec.steps) || spec.steps < 1 || spec.steps > MAX_STEPS)
    issues.push(`steps must be a whole number from 1 to ${MAX_STEPS}`)
  return issues
}

/** Validates and parses every formula once. Throws FormulaError when invalid. */
export function compileModel(spec: ModelSpec): CompiledModel {
  const issues = validateModel(spec)
  if (issues.length) throw new FormulaError(issues[0])
  return {
    inputIds: spec.inputs.map((i) => i.id),
    state: spec.state.map((s) => ({ id: s.id, tree: parseFormula(s.initial) })),
    step: new Map(spec.step.map((s) => [s.id, parseFormula(s.formula)])),
    outputs: (spec.outputs ?? []).map((o) => ({
      id: o.id,
      tree: parseFormula(o.formula),
    })),
    stopWhen: spec.stopWhen ? parseFormula(spec.stopWhen) : null,
    milestones: (spec.milestones ?? []).map((m) => ({
      label: m.label,
      tree: parseFormula(m.when),
    })),
    steps: Math.min(MAX_STEPS, Math.max(1, Math.trunc(spec.steps))),
  }
}

/** Runs a compiled model. Never throws; bad values end the run early. */
export function runModel(
  model: CompiledModel,
  inputs: Record<string, number>,
): SimRun {
  const run: SimRun = {
    rows: [],
    stoppedAt: null,
    milestones: model.milestones.map(() => null),
    invalid: null,
  }
  const base: Record<string, number> = {}
  for (const id of model.inputIds) base[id] = inputs[id] ?? 0

  const safe = (tree: Node, scope: Record<string, number>) => {
    try {
      return evaluate(tree, scope)
    } catch {
      return Number.NaN
    }
  }

  // Fills outputs on top of a scope holding inputs, state and t. Returns the
  // first non-finite id, if any.
  const finish = (scope: Record<string, number>): string | null => {
    for (const s of model.state) if (!Number.isFinite(scope[s.id])) return s.id
    for (const o of model.outputs) {
      scope[o.id] = safe(o.tree, scope)
      if (!Number.isFinite(scope[o.id])) return o.id
    }
    return null
  }

  // Records the row and checks milestones and stopWhen. True means stop.
  const record = (scope: Record<string, number>, t: number): boolean => {
    const row = { t } as SimRow
    for (const s of model.state) row[s.id] = scope[s.id]
    for (const o of model.outputs) row[o.id] = scope[o.id]
    run.rows.push(row)
    model.milestones.forEach((m, i) => {
      if (run.milestones[i] === null && safe(m.tree, scope)) {
        run.milestones[i] = t
      }
    })
    if (model.stopWhen && safe(model.stopWhen, scope)) {
      run.stoppedAt = t
      return true
    }
    return false
  }

  let scope: Record<string, number> = { ...base, [STEP_VAR]: 0 }
  for (const s of model.state) scope[s.id] = safe(s.tree, scope)
  const bad0 = finish(scope)
  if (bad0) {
    run.invalid = { step: 0, id: bad0 }
    return run
  }
  if (record(scope, 0)) return run

  for (let t = 1; t <= model.steps; t++) {
    const prev = { ...scope, [STEP_VAR]: t }
    const next: Record<string, number> = { ...base, [STEP_VAR]: t }
    for (const s of model.state) {
      next[s.id] = safe(model.step.get(s.id) as Node, prev)
    }
    const bad = finish(next)
    if (bad) {
      run.invalid = { step: t, id: bad }
      return run
    }
    scope = next
    if (record(scope, t)) return run
  }
  return run
}

/** Final value of each id in a run (NaN when the run is empty). */
export function finalValues(run: SimRun, ids: string[]) {
  const last = run.rows[run.rows.length - 1]
  return Object.fromEntries(ids.map((id) => [id, last ? last[id] : Number.NaN]))
}

export type SimDiff = {
  id: string
  value: number
  baseline: number
  /** value − baseline */
  delta: number
}

/** Final values compared with the baseline run. */
export function diffRuns(run: SimRun, baseline: SimRun, ids: string[]) {
  const a = finalValues(run, ids)
  const b = finalValues(baseline, ids)
  return ids.map(
    (id): SimDiff => ({
      id,
      value: a[id],
      baseline: b[id],
      delta: a[id] - b[id],
    }),
  )
}

/** Row indexes to list in an accessible table: every row up to `max`, else an even sample that keeps the last row. */
export function sampleIndexes(length: number, max = 60): number[] {
  if (length <= max) return Array.from({ length }, (_, i) => i)
  const every = Math.ceil((length - 1) / (max - 1))
  const out: number[] = []
  for (let i = 0; i < length - 1; i += every) out.push(i)
  out.push(length - 1)
  return out
}
