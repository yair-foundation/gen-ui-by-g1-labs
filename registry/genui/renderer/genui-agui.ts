import type { GenUICall } from "./genui-renderer"

/*
 * AG-UI adapter: turns an AG-UI event stream (or a restored message history)
 * into GenUICalls. Structural types only, so `@ag-ui/*` is not a dependency.
 *
 * Protocol facts this follows (AG-UI 1.0):
 * - Event `type` values are SCREAMING_SNAKE strings: TOOL_CALL_START
 *   { toolCallId, toolCallName, parentMessageId? }, TOOL_CALL_ARGS
 *   { toolCallId, delta } (fragments that concatenate into JSON text),
 *   TOOL_CALL_END { toolCallId }, TOOL_CALL_RESULT { messageId, toolCallId,
 *   content: string | ContentPart[], role?: "tool" }, TOOL_CALL_CHUNK (a
 *   shorthand for start/args/end; a chunk without an id continues the open
 *   call), RUN_ERROR { message, code? }, MESSAGES_SNAPSHOT { messages }.
 * - Assistant messages carry `toolCalls: { id, type: "function", function:
 *   { name, arguments } }[]`, where `arguments` is a JSON string. Tool
 *   messages are `{ id, role: "tool", content, toolCallId, error? }`.
 * - Frontend tools are answered with a tool message in the next run's
 *   RunAgentInput.messages.
 * Sources:
 *   https://docs.ag-ui.com/concepts/events
 *   https://docs.ag-ui.com/sdk/js/core/events
 *   https://docs.ag-ui.com/concepts/messages
 *   https://docs.ag-ui.com/concepts/tools
 *   https://github.com/ag-ui-protocol/ag-ui/blob/main/sdks/typescript/packages/core/src/generated/types.ts
 */

// ---- Structural AG-UI types ---------------------------------------------

/** Any AG-UI event. Only `type` is read until the type is known. */
export type AGUIEvent = { type: string; [key: string]: unknown }

/** A tool call on an AG-UI assistant message. */
export type AGUIToolCall = {
  id: string
  type?: string
  function: { name: string; arguments: string }
}

/** The parts of an AG-UI message the adapter reads. */
export type AGUIMessage = {
  id?: string
  role: string
  content?: unknown
  toolCalls?: AGUIToolCall[]
  toolCallId?: string
  error?: string
}

/** An AG-UI tool message, as appended to the next run's input. */
export type AGUIToolMessage = {
  id: string
  role: "tool"
  toolCallId: string
  content: string
}

// ---- Reducer ----------------------------------------------------------------

export type AGUIState = {
  /** The calls in the order they started. */
  calls: GenUICall[]
  /** Raw argument text per tracked call, as streamed so far. */
  args: Record<string, string>
  /** Only these tool names are tracked. Undefined tracks every tool. */
  names?: string[]
  /** The call a TOOL_CALL_CHUNK without an id continues. */
  openChunk?: string
  /** The last RUN_ERROR message, cleared when the next run starts. */
  runError?: string
}

/**
 * The initial state. Pass `names` (usually `Object.keys(catalog)`) so tool
 * calls that aren't generated UI, like a search tool, are ignored.
 */
export function createAGUIState({
  names,
}: { names?: string[] } = {}): AGUIState {
  return { calls: [], args: {}, names }
}

/** The incomplete-arguments message for calls cut off mid-stream. */
const CUT_OFF = "This part of the response arrived incomplete."

// Events that don't close a call opened by TOOL_CALL_CHUNK. Every other event
// closes it, which is what the AG-UI client's chunk transform does. (The
// transform also keeps one open call per subagent; this keeps one in total.)
const KEEPS_CHUNK_OPEN = new Set([
  "TOOL_CALL_CHUNK",
  "RAW",
  "ACTIVITY_SNAPSHOT",
  "ACTIVITY_DELTA",
  "REASONING_ENCRYPTED_VALUE",
  "SUBAGENT_STARTED",
  "SUBAGENT_FINISHED",
  "SUBAGENT_ERROR",
])

/**
 * Applies one AG-UI event. Pure: returns a new state when something changed
 * and the same state otherwise, so it works directly with `useReducer`.
 *
 * - TOOL_CALL_START adds a streaming call; TOOL_CALL_ARGS re-parses the
 *   arguments so far (see `parsePartialJson`), so the component fills in as
 *   the agent writes; TOOL_CALL_END makes it ready.
 * - TOOL_CALL_RESULT stores the result (JSON-parsed), which restores an
 *   interactive component's final state.
 * - RUN_ERROR fails the calls that were still streaming. RUN_FINISHED closes
 *   any call the agent never ended.
 * - MESSAGES_SNAPSHOT rebuilds the calls from the conversation.
 */
export function reduceAGUI(state: AGUIState, event: AGUIEvent): AGUIState {
  let next = state
  if (next.openChunk && !KEEPS_CHUNK_OPEN.has(event.type)) {
    next = endCall({ ...next, openChunk: undefined }, next.openChunk)
  }

  switch (event.type) {
    case "TOOL_CALL_START":
      return startCall(next, str(event.toolCallId), str(event.toolCallName))

    case "TOOL_CALL_ARGS":
      return appendArgs(next, str(event.toolCallId), str(event.delta))

    case "TOOL_CALL_END":
      return endCall(next, str(event.toolCallId))

    case "TOOL_CALL_CHUNK": {
      const id = typeof event.toolCallId === "string" ? event.toolCallId : ""
      if (id && id !== next.openChunk) {
        // A new call: close the open one, then start this one.
        if (next.openChunk) next = endCall(next, next.openChunk)
        next = {
          ...startCall(next, id, str(event.toolCallName)),
          openChunk: id,
        }
      }
      const target = id || next.openChunk
      return target ? appendArgs(next, target, str(event.delta)) : next
    }

    case "TOOL_CALL_RESULT": {
      const id = str(event.toolCallId)
      if (!Object.hasOwn(next.args, id)) return next
      const ended = endCall(next, id)
      return updateCall(ended, id, (c) => ({
        ...c,
        result: parseContent(event.content),
      }))
    }

    case "RUN_STARTED":
      return next.runError === undefined
        ? next
        : { ...next, runError: undefined }

    case "RUN_FINISHED":
      return endAll(next)

    case "RUN_ERROR": {
      const message =
        typeof event.message === "string" && event.message
          ? event.message
          : "The agent stopped with an error."
      const calls = next.calls.map((c) =>
        c.status === "streaming"
          ? { ...c, status: "failed" as const, error: message }
          : c,
      )
      return { ...next, calls, runError: message }
    }

    case "MESSAGES_SNAPSHOT": {
      if (!Array.isArray(event.messages)) return next
      const restored = callsFromAGUIMessages(event.messages as AGUIMessage[], {
        names: next.names,
      })
      const known = new Set(restored.map((c) => c.id))
      // Keep calls still streaming that the snapshot doesn't include yet.
      const inFlight = next.calls.filter(
        (c) => c.status === "streaming" && !known.has(c.id),
      )
      const calls = [...restored, ...inFlight]
      const entries: [string, string][] = []
      for (const m of event.messages as AGUIMessage[]) {
        for (const tc of toolCallsOf(m)) {
          if (known.has(tc.id))
            entries.push([tc.id, str(tc.function.arguments)])
        }
      }
      for (const c of inFlight) entries.push([c.id, next.args[c.id] ?? ""])
      return { ...next, calls, args: Object.fromEntries(entries) }
    }

    default:
      return next
  }
}

/** The calls to render, in order. */
export function callsFromAGUI(state: AGUIState): GenUICall[] {
  return state.calls
}

function tracks(state: AGUIState, name: string) {
  return !state.names || state.names.includes(name)
}

function startCall(state: AGUIState, id: string, name: string): AGUIState {
  if (!id || !name || Object.hasOwn(state.args, id) || !tracks(state, name))
    return state
  return {
    ...state,
    calls: [...state.calls, { id, name, props: {}, status: "streaming" }],
    args: { ...state.args, [id]: "" },
  }
}

function appendArgs(state: AGUIState, id: string, delta: string): AGUIState {
  if (!Object.hasOwn(state.args, id) || !delta) return state
  const text = state.args[id] + delta
  const next = { ...state, args: { ...state.args, [id]: text } }
  const parsed = parsePartialJson(text)
  // Keep the last good props if this fragment doesn't parse yet.
  if (!isRecord(parsed)) return next
  return updateCall(next, id, (c) =>
    c.status === "streaming" ? { ...c, props: parsed } : c,
  )
}

function endCall(state: AGUIState, id: string): AGUIState {
  if (!Object.hasOwn(state.args, id)) return state
  return updateCall(state, id, (c) =>
    c.status === "streaming" ? finish(c, state.args[id]) : c,
  )
}

function endAll(state: AGUIState): AGUIState {
  if (!state.calls.some((c) => c.status === "streaming")) return state
  return {
    ...state,
    calls: state.calls.map((c) =>
      c.status === "streaming" ? finish(c, state.args[c.id] ?? "") : c,
    ),
  }
}

/** The arguments are complete: parse strictly, or fail the call. */
function finish(call: GenUICall, text: string): GenUICall {
  if (text.trim() === "") return { ...call, props: {}, status: "ready" }
  const parsed = parseJSON(text)
  return isRecord(parsed)
    ? { ...call, props: parsed, status: "ready" }
    : { ...call, status: "failed", error: CUT_OFF }
}

function updateCall(
  state: AGUIState,
  id: string,
  update: (call: GenUICall) => GenUICall,
): AGUIState {
  let changed = false
  const calls = state.calls.map((c) => {
    if (c.id !== id) return c
    const next = update(c)
    if (next !== c) changed = true
    return next
  })
  return changed ? { ...state, calls } : state
}

// ---- History ----------------------------------------------------------------

/**
 * Builds calls from AG-UI messages: a MESSAGES_SNAPSHOT, or a conversation
 * you stored. Tool messages answering a call restore its result, so a
 * reloaded conversation shows each component's final state.
 */
export function callsFromAGUIMessages(
  messages: AGUIMessage[],
  { names }: { names?: string[] } = {},
): GenUICall[] {
  const replies = new Map<string, AGUIMessage>()
  for (const m of messages) {
    if (m.role === "tool" && typeof m.toolCallId === "string") {
      replies.set(m.toolCallId, m)
    }
  }

  const calls: GenUICall[] = []
  const seen = new Set<string>()
  for (const m of messages) {
    for (const tc of toolCallsOf(m)) {
      const name = tc.function.name
      if (seen.has(tc.id) || (names && !names.includes(name))) continue
      seen.add(tc.id)
      const call = finish(
        { id: tc.id, name, props: {}, status: "streaming" },
        str(tc.function.arguments),
      )
      const reply = replies.get(tc.id)
      if (reply?.error) {
        calls.push({ ...call, status: "failed", error: reply.error })
      } else if (reply) {
        calls.push({ ...call, result: parseContent(reply.content) })
      } else {
        calls.push(call)
      }
    }
  }
  return calls
}

function toolCallsOf(m: AGUIMessage): AGUIToolCall[] {
  if (m.role !== "assistant" || !Array.isArray(m.toolCalls)) return []
  return m.toolCalls.filter(
    (tc) => typeof tc?.id === "string" && typeof tc.function?.name === "string",
  )
}

/**
 * The tool message answering a call. Append it to the agent's messages and
 * start the next run, so the agent reads the user's decision as the tool's
 * result. The id is derived from the call, so sending twice is idempotent.
 */
export function toAGUIToolMessage(
  call: GenUICall,
  result: unknown,
  { id = `tool-result-${call.id}` }: { id?: string } = {},
): AGUIToolMessage {
  return {
    id,
    role: "tool",
    toolCallId: call.id,
    content: JSON.stringify(result),
  }
}

// ---- Partial JSON -----------------------------------------------------------

/**
 * Parses JSON that may be cut off anywhere, returning the best-effort value
 * so far: unclosed strings, objects and arrays are closed, a trailing comma
 * is ignored, partial literals (`tru`) complete, and partial numbers (`1.`,
 * `2e`) keep their digits. An object key that isn't finished, or has no value
 * yet, is left out, so keys only appear once their value has started.
 *
 * Returns undefined for empty input or text that isn't JSON. Never throws.
 */
export function parsePartialJson(text: string): unknown {
  const p: Parser = { s: text, i: 0 }
  try {
    const v = parseValue(p)
    return v === NONE ? undefined : v
  } catch {
    return undefined
  }
}

type Parser = { s: string; i: number }

/** The text ended before a value started. */
const NONE: unique symbol = Symbol("none")

const NUMBER = /-?(?:0|[1-9]\d*)?(?:\.\d*)?(?:[eE][+-]?\d*)?/y
const LITERALS: [string, unknown][] = [
  ["true", true],
  ["false", false],
  ["null", null],
]
const ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
}

function skipSpace(p: Parser) {
  while (p.i < p.s.length && " \t\n\r".includes(p.s[p.i])) p.i++
}

function parseValue(p: Parser): unknown {
  skipSpace(p)
  if (p.i >= p.s.length) return NONE
  const c = p.s[p.i]
  if (c === "{") return parseObject(p)
  if (c === "[") return parseArray(p)
  if (c === '"') return parseString(p).value
  if (c === "-" || (c >= "0" && c <= "9")) return parseNumber(p)
  return parseLiteral(p)
}

function parseObject(p: Parser): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  p.i++
  for (;;) {
    skipSpace(p)
    if (p.i >= p.s.length) return out
    const c = p.s[p.i]
    if (c === "}") {
      p.i++
      return out
    }
    if (c === ",") {
      p.i++
      continue
    }
    if (c !== '"') throw new SyntaxError("Expected a key")
    const key = parseString(p)
    if (!key.complete) return out
    skipSpace(p)
    if (p.i >= p.s.length) return out
    if (p.s[p.i] !== ":") throw new SyntaxError("Expected a colon")
    p.i++
    const value = parseValue(p)
    if (value === NONE) return out
    // An own property, as JSON.parse makes, even for "__proto__".
    Object.defineProperty(out, key.value, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
}

function parseArray(p: Parser): unknown[] {
  const out: unknown[] = []
  p.i++
  for (;;) {
    skipSpace(p)
    if (p.i >= p.s.length) return out
    const c = p.s[p.i]
    if (c === "]") {
      p.i++
      return out
    }
    if (c === ",") {
      p.i++
      continue
    }
    const value = parseValue(p)
    if (value === NONE) return out
    out.push(value)
  }
}

function parseString(p: Parser): { value: string; complete: boolean } {
  const { s } = p
  let value = ""
  let start = ++p.i
  while (p.i < s.length) {
    const c = s[p.i]
    if (c === '"') {
      value += s.slice(start, p.i)
      p.i++
      return { value, complete: true }
    }
    if (c !== "\\") {
      p.i++
      continue
    }
    value += s.slice(start, p.i)
    const e = s[p.i + 1]
    // A cut-off escape is dropped until the rest of it arrives.
    if (e === undefined) {
      p.i = s.length
      return { value, complete: false }
    }
    if (e === "u") {
      const hex = s.slice(p.i + 2, p.i + 6)
      if (hex.length < 4) {
        if (!/^[0-9a-fA-F]*$/.test(hex)) throw new SyntaxError("Bad escape")
        p.i = s.length
        return { value, complete: false }
      }
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw new SyntaxError("Bad escape")
      value += String.fromCharCode(Number.parseInt(hex, 16))
      p.i += 6
    } else {
      const ch = ESCAPES[e]
      if (ch === undefined) throw new SyntaxError("Bad escape")
      value += ch
      p.i += 2
    }
    start = p.i
  }
  value += s.slice(start)
  return { value, complete: false }
}

function parseNumber(p: Parser): number | typeof NONE {
  NUMBER.lastIndex = p.i
  const match = NUMBER.exec(p.s)
  let token = match ? match[0] : ""
  p.i += token.length
  const atEnd = p.i >= p.s.length
  // Trim a cut-off exponent or fraction: "1e-" and "1." both read as 1.
  if (atEnd) token = token.replace(/[eE][+-]?$/, "").replace(/\.$/, "")
  if (token === "" || token === "-") {
    if (atEnd) return NONE
    throw new SyntaxError("Bad number")
  }
  const n = Number(token)
  if (Number.isNaN(n)) throw new SyntaxError("Bad number")
  return n
}

function parseLiteral(p: Parser): unknown {
  const rest = p.s.slice(p.i, p.i + 5)
  for (const [word, value] of LITERALS) {
    if (rest.startsWith(word)) {
      p.i += word.length
      return value
    }
    // Cut off mid-word: "tru" can only become true.
    if (p.i + rest.length === p.s.length && word.startsWith(rest)) {
      p.i = p.s.length
      return value
    }
  }
  throw new SyntaxError("Unexpected token")
}

// ---- helpers ----------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * A tool result's content: a string (usually JSON) or, since AG-UI 1.0, a
 * list of content parts, whose text parts are joined. Non-JSON text (a
 * backend tool's "Done") gives no result, like the LangGraph adapter.
 */
function parseContent(content: unknown): unknown {
  if (typeof content === "string") return parseJSON(content)
  if (Array.isArray(content)) {
    const text = content
      .map((part) =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("")
    return parseJSON(text)
  }
  return undefined
}
