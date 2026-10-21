import type { GenUICall } from "./genui-renderer"

/*
 * Adapters turn framework-specific messages into GenUICalls. They are
 * structural, so neither the AI SDK nor LangGraph is a dependency.
 */

// ---- Vercel AI SDK -------------------------------------------------------

/** The shape of a tool part in an AI SDK UIMessage (`tool-${name}`). */
export type AISDKToolPart = {
  type: string
  toolCallId: string
  state: string
  input?: unknown
  output?: unknown
  errorText?: string
}

/** Returns a call for tool parts, or null for any other part (text, etc.). */
export function fromAISDK(part: { type: string }): GenUICall | null {
  if (!part.type.startsWith("tool-")) return null
  const p = part as AISDKToolPart
  return {
    id: p.toolCallId,
    name: p.type.slice("tool-".length),
    props: isRecord(p.input) ? p.input : {},
    status:
      p.state === "input-streaming"
        ? "streaming"
        : p.state === "output-error"
          ? "failed"
          : "ready",
    error: p.state === "output-error" ? p.errorText : undefined,
    // The stored output restores the component's final state on reload.
    result: p.state === "output-available" ? p.output : undefined,
  }
}

// ---- LangGraph ------------------------------------------------------------

/** A UI message produced on the server by `typedUi(config).push(...)`. */
export type LangGraphUIMessage = {
  id: string
  name: string
  props?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

/** The parts of a LangGraph message the adapter reads. */
export type LangGraphMessage = {
  type?: string
  tool_call_id?: string
  content?: unknown
}

/**
 * Returns a call for a UI message. Pass the thread's messages so results the
 * user already sent (as tool messages) restore the component's final state.
 *
 * Convention: push `toolCallId` in props so the result can be matched.
 */
export function fromLangGraph(
  ui: LangGraphUIMessage,
  messages: LangGraphMessage[] = [],
): GenUICall {
  const { toolCallId, ...props } = ui.props ?? {}
  const id = typeof toolCallId === "string" ? toolCallId : undefined
  const reply = id
    ? messages.find((m) => m.type === "tool" && m.tool_call_id === id)
    : undefined
  return {
    id: id ?? ui.id,
    name: ui.name,
    props,
    status: "ready",
    result: parseJSON(reply?.content),
  }
}

/** The tool message to submit to the thread when the user acts. */
export function toLangGraphToolMessage(call: GenUICall, result: unknown) {
  return {
    type: "tool" as const,
    tool_call_id: call.id,
    name: call.name,
    content: JSON.stringify(result),
  }
}

// ---- helpers --------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function parseJSON(content: unknown): unknown {
  if (typeof content !== "string") return undefined
  try {
    return JSON.parse(content)
  } catch {
    return undefined
  }
}
