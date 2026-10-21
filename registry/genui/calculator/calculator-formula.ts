/**
 * A small, safe formula language for agent-written calculators.
 *
 * No `eval`, no property access, no strings: only numbers, named values,
 * arithmetic, comparisons and a fixed set of functions. A model cannot run
 * code through a formula.
 *
 *   round(people * 0.4, 1)
 *   if(total > 100, total * 0.9, total)
 *
 * Operators: + - * / % ^ and < > <= >= == != (comparisons give 1 or 0).
 * Functions: min, max, round(x, digits?), floor, ceil, abs, sqrt, pow,
 * clamp(x, lo, hi), if(condition, then, else).
 */

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
