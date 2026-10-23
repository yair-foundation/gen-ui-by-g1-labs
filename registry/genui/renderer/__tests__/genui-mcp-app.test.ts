import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  connectMcpApp,
  createMcpAppState,
  type McpAppState,
  type McpAppWindow,
  mcpHostThemeVars,
  reduceMcpApp,
  toMcpAppMessage,
  toMcpAppModelContext,
} from "../genui-mcp-app"

const apply = (state: McpAppState, ...messages: [string, unknown?][]) =>
  messages.reduce((s, [method, params]) => reduceMcpApp(s, { method, params }), state)

const withTool = apply(createMcpAppState(), [
  "ui/notifications/host-context-changed",
  { toolInfo: { id: 3, tool: { name: "show_callout" } }, locale: "de-DE" },
])

describe("reduceMcpApp", () => {
  it("streams partial input, then makes the call ready", () => {
    const streaming = apply(withTool, [
      "ui/notifications/tool-input-partial",
      { arguments: { text: "Coo" } },
    ])
    assert.deepEqual(streaming.call, {
      id: "3",
      name: "show_callout",
      props: { text: "Coo" },
      status: "streaming",
    })
    const ready = apply(
      streaming,
      ["ui/notifications/tool-input", { arguments: { text: "Cook it" } }],
      // A late partial doesn't undo the complete input.
      ["ui/notifications/tool-input-partial", { arguments: { text: "C" } }],
    )
    assert.equal(ready.call?.status, "ready")
    assert.deepEqual(ready.call?.props, { text: "Cook it" })
  })

  it("takes the server's props and a recorded result from the tool result", () => {
    const state = apply(
      withTool,
      ["ui/notifications/tool-input", { arguments: { text: "x" } }],
      [
        "ui/notifications/tool-result",
        {
          content: [{ type: "text", text: "x" }],
          structuredContent: { props: { tone: "note", text: "x" }, result: { ok: true } },
        },
      ],
    )
    assert.deepEqual(state.call?.props, { tone: "note", text: "x" })
    assert.deepEqual(state.call?.result, { ok: true })
  })

  it("fails on an error result without showing the model's error text", () => {
    const state = apply(
      withTool,
      ["ui/notifications/tool-input", { arguments: {} }],
      ["ui/notifications/tool-result", { isError: true, content: [{ type: "text", text: "Fix these" }] }],
    )
    assert.equal(state.call?.status, "failed")
    assert.equal(state.call?.error, undefined)
  })

  it("cancels only calls the user hasn't acted on", () => {
    const cancelled = apply(withTool, ["ui/notifications/tool-cancelled", { reason: "stop" }])
    assert.equal(cancelled.call?.status, "cancelled")
    const done = apply(
      withTool,
      ["ui/notifications/tool-result", { content: [], structuredContent: { result: 1 } }],
    )
    assert.equal(apply(done, ["ui/notifications/tool-cancelled"]), done)
  })

  it("falls back to the page's tool name without toolInfo", () => {
    const state = apply(createMcpAppState({ toolName: "show_chart" }), [
      "ui/notifications/tool-input",
      { arguments: {} },
    ])
    assert.equal(state.call?.name, "show_chart")
    assert.equal(state.call?.id, "mcp-app")
  })

  it("ignores methods it doesn't know", () => {
    assert.equal(apply(withTool, ["ui/notifications/other"]), withTool)
  })
})

describe("results", () => {
  const call = { id: "3", name: "approve" }

  it("sends a decision as a user message", () => {
    assert.deepEqual(toMcpAppMessage(call, { action: "approve" }), {
      role: "user",
      content: [{ type: "text", text: 'Result of approve (tool call 3): {"action":"approve"}' }],
    })
  })

  it("sends state as model context, structured too", () => {
    const context = toMcpAppModelContext(call, { rows: 2 })
    assert.deepEqual(context.structuredContent, {
      toolCallId: "3",
      name: "approve",
      result: { rows: 2 },
    })
  })
})

describe("mcpHostThemeVars", () => {
  it("maps the host's variables onto the component tokens it sends", () => {
    const vars = mcpHostThemeVars({
      styles: {
        variables: {
          "--color-background-primary": "#fff",
          "--color-text-secondary": "#666",
          "--color-border-primary": " ",
        },
      },
    })
    assert.equal(vars["--card"], "#fff")
    assert.equal(vars["--background"], "#fff")
    assert.equal(vars["--muted-foreground"], "#666")
    assert.equal(vars["--border"], undefined)
  })
})

/** A window whose parent records what the view posts. */
function fakeWindow() {
  const posted: Record<string, unknown>[] = []
  const listeners = new Set<(event: MessageEvent) => void>()
  const parent = { postMessage: (m: unknown) => posted.push(m as Record<string, unknown>) }
  const w: McpAppWindow = {
    parent,
    addEventListener: (_type, l) => listeners.add(l),
    removeEventListener: (_type, l) => listeners.delete(l),
  }
  const fromHost = (data: unknown, source: unknown = parent) => {
    for (const l of listeners) l({ data, source } as MessageEvent)
  }
  return { w, posted, fromHost, listeners }
}

describe("connectMcpApp", () => {
  it("initializes, tracks the call and sends the user's decision", async () => {
    const { w, posted, fromHost, listeners } = fakeWindow()
    const states: McpAppState[] = []
    const bridge = connectMcpApp({
      appInfo: { name: "test", version: "1.0.0" },
      onState: (s) => states.push(s),
      window: w,
    })

    assert.deepEqual(posted[0], {
      jsonrpc: "2.0",
      id: 1,
      method: "ui/initialize",
      params: {
        appInfo: { name: "test", version: "1.0.0" },
        appCapabilities: { availableDisplayModes: ["inline"] },
        protocolVersion: "2026-01-26",
      },
    })
    fromHost({
      jsonrpc: "2.0",
      id: 1,
      result: { protocolVersion: "2026-01-26", hostContext: { toolInfo: { id: "c1", tool: { name: "approve" } } } },
    })
    await bridge.ready
    assert.deepEqual(posted[1], { jsonrpc: "2.0", method: "ui/notifications/initialized" })

    // Messages from anywhere but the host are ignored.
    fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { a: 1 } } }, {})
    assert.equal(bridge.state().call, undefined)
    fromHost({ jsonrpc: "2.0", method: "ui/notifications/tool-input", params: { arguments: { a: 1 } } })
    const call = bridge.state().call
    assert.ok(call)
    assert.equal(call.id, "c1")
    assert.equal(states.at(-1), bridge.state())

    const sent = bridge.sendResult(call, { action: "approve" })
    assert.deepEqual(bridge.state().call?.result, { action: "approve" })
    assert.deepEqual(posted[2], {
      jsonrpc: "2.0",
      id: 2,
      method: "ui/message",
      params: toMcpAppMessage(call, { action: "approve" }),
    })
    fromHost({ jsonrpc: "2.0", id: 2, result: {} })
    await sent

    // A refused message takes the result back, so the user can act again.
    const refused = bridge.sendResult(call, { action: "reject" }, "context")
    assert.equal(posted[3].method, "ui/update-model-context")
    fromHost({ jsonrpc: "2.0", id: 3, error: { code: -1, message: "Declined" } })
    await assert.rejects(refused, /Declined/)
    assert.deepEqual(bridge.state().call?.result, { action: "approve" })

    // Host requests are answered.
    fromHost({ jsonrpc: "2.0", id: 9, method: "ui/resource-teardown", params: {} })
    fromHost({ jsonrpc: "2.0", id: 10, method: "ui/unknown" })
    await new Promise((r) => setTimeout(r, 0))
    const answer = (id: number) => posted.find((m) => m.id === id && !("method" in m))
    assert.deepEqual(answer(9), { jsonrpc: "2.0", id: 9, result: {} })
    assert.deepEqual(answer(10)?.error, {
      code: -32601,
      message: "Method not found: ui/unknown",
    })

    bridge.close()
    assert.equal(listeners.size, 0)
  })
})
