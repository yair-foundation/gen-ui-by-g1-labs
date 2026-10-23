"use client"

import * as React from "react"

import {
  MCP_APPS_PROTOCOL_VERSION,
  type McpCallToolResult,
  mcpAppResultText,
} from "./genui-mcp-apps"
import { type GenUICall, type GenUICatalog, GenUIRenderer } from "./genui-renderer"

/*
 * MCP Apps adapter, view side: the page the host runs in its sandboxed
 * iframe. It speaks the MCP Apps protocol to the host over postMessage,
 * turns the tool's input and result into a GenUICall, renders it, and sends
 * the user's decision back to the model. genui-mcp-apps.ts is the server side.
 *
 * Protocol facts this follows (MCP Apps 2026-01-26):
 * - JSON-RPC 2.0 over `window.parent.postMessage`. The view opens with the
 *   request `ui/initialize` { appInfo, appCapabilities, protocolVersion },
 *   which returns { protocolVersion, hostInfo, hostCapabilities, hostContext },
 *   then sends the notification `ui/notifications/initialized`. The host sends
 *   nothing before that.
 * - Host → view notifications: `ui/notifications/tool-input-partial`
 *   { arguments } (zero or more, best-effort JSON while the model streams),
 *   `ui/notifications/tool-input` { arguments } (once, complete),
 *   `ui/notifications/tool-result` (a CallToolResult),
 *   `ui/notifications/tool-cancelled` { reason? } and
 *   `ui/notifications/host-context-changed` (a partial host context, merged).
 *   Host → view requests: `ui/resource-teardown` (answer before the host
 *   removes the frame) and `ping`.
 * - View → host: `ui/message` { role: "user", content: ContentBlock[] } adds a
 *   message to the conversation, which the model answers;
 *   `ui/update-model-context` { content?, structuredContent? } replaces the
 *   context the model gets on the next turn without starting one;
 *   `ui/notifications/size-changed` { width?, height? }.
 * - Host context: toolInfo { id, tool }, theme "light" | "dark",
 *   styles { variables, css { fonts } }, locale, timeZone, displayMode, ...
 * Sources:
 *   https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
 *   https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts
 *
 * Usage, the view's entry:
 *
 *   createRoot(document.getElementById("root")!).render(
 *     <GenUIMcpApp catalog={catalog} appInfo={{ name: "genui", version: "1.0.0" }} />,
 *   )
 *
 * The user's decision isn't part of the tool result, so a view the host
 * reloads shows the component ready again. A server that records decisions
 * can restore them by returning `structuredContent.result`.
 */

const PARTIAL = "ui/notifications/tool-input-partial"
const INPUT = "ui/notifications/tool-input"
const RESULT = "ui/notifications/tool-result"
const CANCELLED = "ui/notifications/tool-cancelled"
const HOST_CONTEXT = "ui/notifications/host-context-changed"

// ---- Structural host context ---------------------------------------------

/** The host context fields the view reads. Hosts may send more. */
export type McpAppHostContext = {
  /** The tools/call this view belongs to. */
  toolInfo?: { id?: string | number; tool?: { name?: string } }
  theme?: "light" | "dark"
  styles?: {
    variables?: Record<string, string | undefined>
    css?: { fonts?: string }
  }
  locale?: string
  timeZone?: string
  displayMode?: string
  platform?: string
  [key: string]: unknown
}

// ---- Reducer ----------------------------------------------------------------

export type McpAppState = {
  hostContext: McpAppHostContext
  /** Undefined until the host sends the tool's input. */
  call?: GenUICall
  /** The tool's name from the page, when the host context has no toolInfo. */
  toolName?: string
}

export type McpAppMessage = { method: string; params?: unknown }

export function createMcpAppState({
  toolName,
}: { toolName?: string } = {}): McpAppState {
  return { hostContext: {}, toolName }
}

/**
 * Applies one host notification. Pure: returns a new state when something
 * changed and the same state otherwise, so it works with `useReducer`.
 *
 * - tool-input-partial streams props in; it's ignored once the input is complete.
 * - tool-input makes the call ready.
 * - tool-result: an error result fails the call (its text is for the model,
 *   so it isn't shown). Otherwise `structuredContent.props` replaces the props
 *   (the server's parsed input, defaults applied) and `structuredContent.result`
 *   restores a decision the server recorded.
 * - tool-cancelled cancels a call the user hasn't acted on.
 * - host-context-changed merges into the host context.
 */
export function reduceMcpApp(
  state: McpAppState,
  message: McpAppMessage,
): McpAppState {
  const params = isRecord(message.params) ? message.params : {}
  switch (message.method) {
    case PARTIAL: {
      if (state.call && state.call.status !== "streaming") return state
      return {
        ...state,
        call: { ...identity(state), props: record(params.arguments), status: "streaming" },
      }
    }
    case INPUT: {
      return {
        ...state,
        call: {
          ...state.call,
          ...identity(state),
          props: record(params.arguments),
          status: "ready",
        },
      }
    }
    case RESULT: {
      const result = params as Partial<McpCallToolResult>
      const base: GenUICall = state.call ?? {
        ...identity(state),
        props: {},
        status: "ready",
      }
      if (result.isError) {
        return { ...state, call: { ...base, status: "failed" } }
      }
      const structured = record(result.structuredContent)
      return {
        ...state,
        call: {
          ...base,
          status: "ready",
          props: isRecord(structured.props) ? structured.props : base.props,
          result: "result" in structured ? structured.result : base.result,
        },
      }
    }
    case CANCELLED: {
      if (state.call?.result !== undefined) return state
      return {
        ...state,
        call: {
          ...identity(state),
          props: {},
          ...state.call,
          status: "cancelled",
        },
      }
    }
    case HOST_CONTEXT: {
      const next = { ...state, hostContext: { ...state.hostContext, ...params } }
      if (!state.call || !isRecord(params.toolInfo)) return next
      return { ...next, call: { ...state.call, ...identity(next) } }
    }
    default:
      return state
  }
}

/** The call's id and name, from the host's toolInfo or the page. */
function identity(state: McpAppState): Pick<GenUICall, "id" | "name"> {
  const info = state.hostContext.toolInfo
  return {
    id: info?.id !== undefined ? String(info.id) : "mcp-app",
    name: info?.tool?.name ?? state.toolName ?? "",
  }
}

// ---- Results back to the model ----------------------------------------------

/**
 * `ui/message` params: the user's decision as a user message, so the model
 * answers it now. Use for decisions the agent should act on.
 */
export function toMcpAppMessage(
  call: Pick<GenUICall, "id" | "name">,
  result: unknown,
) {
  return {
    role: "user" as const,
    content: [{ type: "text" as const, text: mcpAppResultText(call, result) }],
  }
}

/**
 * `ui/update-model-context` params: the decision as context the model reads
 * on the user's next turn, without starting one. Use for state the user is
 * still adjusting (filters, edits). Each update replaces the previous one.
 */
export function toMcpAppModelContext(
  call: Pick<GenUICall, "id" | "name">,
  result: unknown,
) {
  return {
    content: [{ type: "text" as const, text: mcpAppResultText(call, result) }],
    structuredContent: { toolCallId: call.id, name: call.name, result },
  }
}

// ---- Theme ------------------------------------------------------------------

/** shadcn tokens the components use, and the host variables that fill them. */
const HOST_TOKENS: readonly (readonly [string, string])[] = [
  ["--background", "--color-background-primary"],
  ["--card", "--color-background-primary"],
  ["--popover", "--color-background-primary"],
  ["--foreground", "--color-text-primary"],
  ["--card-foreground", "--color-text-primary"],
  ["--popover-foreground", "--color-text-primary"],
  ["--secondary", "--color-background-secondary"],
  ["--secondary-foreground", "--color-text-primary"],
  ["--muted", "--color-background-secondary"],
  ["--muted-foreground", "--color-text-secondary"],
  ["--accent", "--color-background-tertiary"],
  ["--accent-foreground", "--color-text-primary"],
  ["--primary", "--color-background-inverse"],
  ["--primary-foreground", "--color-text-inverse"],
  ["--destructive", "--color-text-danger"],
  ["--border", "--color-border-primary"],
  ["--input", "--color-border-primary"],
  ["--ring", "--color-ring-primary"],
  ["--radius", "--border-radius-lg"],
  ["--font-sans", "--font-sans"],
]

/**
 * The component tokens to set from the host's style variables, so the
 * component matches the host. Tokens the host doesn't send keep the theme's.
 */
export function mcpHostThemeVars(
  hostContext: McpAppHostContext,
): Record<string, string> {
  const variables = hostContext.styles?.variables ?? {}
  const vars: Record<string, string> = {}
  for (const [token, host] of HOST_TOKENS) {
    const value = variables[host]
    if (typeof value === "string" && value.trim()) vars[token] = value
  }
  return vars
}

/** Applies the host's theme, style variables and fonts to the page. */
export function applyMcpHostContext(
  root: HTMLElement,
  hostContext: McpAppHostContext,
) {
  for (const [token, value] of Object.entries(mcpHostThemeVars(hostContext))) {
    root.style.setProperty(token, value)
  }
  if (hostContext.theme) {
    root.classList.toggle("dark", hostContext.theme === "dark")
    root.style.colorScheme = hostContext.theme
  }
  const fonts = hostContext.styles?.css?.fonts
  if (fonts) {
    const doc = root.ownerDocument
    let style = doc.getElementById("genui-host-fonts")
    if (!style) {
      style = doc.createElement("style")
      style.id = "genui-host-fonts"
      doc.head.append(style)
    }
    if (style.textContent !== fonts) style.textContent = fonts
  }
}

// ---- Bridge -------------------------------------------------------------------

/** The parts of `window` the bridge uses. */
export type McpAppWindow = {
  parent: { postMessage: (message: unknown, targetOrigin: string) => void }
  addEventListener: (type: "message", listener: (event: MessageEvent) => void) => void
  removeEventListener: (type: "message", listener: (event: MessageEvent) => void) => void
}

export type McpAppBridgeOptions = {
  /** This view's name and version, sent to the host. */
  appInfo: { name: string; version: string }
  /** Called with each new state. */
  onState: (state: McpAppState) => void
  /** Called on `ui/resource-teardown`; the host waits for it to settle. */
  onTeardown?: () => void | Promise<void>
  /** Report the page's height to the host as it changes. Default true. */
  autoResize?: boolean
  /** The tool's name, when the host context has no toolInfo. Default: the page's `<meta name="genui-tool">`. */
  toolName?: string
  /** Default: the global window. */
  window?: McpAppWindow
}

export type McpAppBridge = {
  /** Settles once the host has answered `ui/initialize`. */
  ready: Promise<void>
  state: () => McpAppState
  /**
   * Shows the result on the call and sends it to the model: as a user message
   * ("message", the default) or as context for the next turn ("context").
   * The result is taken back if the host refuses.
   */
  sendResult: (
    call: GenUICall,
    result: unknown,
    how?: "message" | "context",
  ) => Promise<void>
  /** Any other request, e.g. `ui/open-link` { url } or `tools/call`. */
  request: (method: string, params?: unknown) => Promise<unknown>
  notify: (method: string, params?: unknown) => void
  close: () => void
}

/** Connects to the host: initializes, then tracks the call until `close`. */
export function connectMcpApp(options: McpAppBridgeOptions): McpAppBridge {
  const w = options.window ?? (globalThis.window as unknown as McpAppWindow)
  let state = createMcpAppState({
    toolName: options.toolName ?? toolNameFromPage(),
  })
  let nextId = 1
  const pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()

  const post = (message: Record<string, unknown>) =>
    w.parent.postMessage({ jsonrpc: "2.0", ...message }, "*")
  const set = (next: McpAppState) => {
    if (next === state) return
    state = next
    options.onState(state)
  }
  const request = (method: string, params?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve, reject })
      post({ id, method, ...(params !== undefined && { params }) })
    })
  const notify = (method: string, params?: unknown) =>
    post({ method, ...(params !== undefined && { params }) })

  const answer = async (id: unknown, method: string) => {
    if (method === "ui/resource-teardown") {
      try {
        await options.onTeardown?.()
      } catch {
        // The frame goes either way; still answer so the host doesn't wait.
      }
      post({ id, result: {} })
    } else if (method === "ping") {
      post({ id, result: {} })
    } else {
      post({ id, error: { code: -32601, message: `Method not found: ${method}` } })
    }
  }

  const onMessage = (event: MessageEvent) => {
    if (event.source !== (w.parent as unknown)) return
    const data: unknown = event.data
    if (!isRecord(data) || data.jsonrpc !== "2.0") return
    if (typeof data.method === "string") {
      if (data.id !== undefined && data.id !== null) {
        void answer(data.id, data.method)
      } else {
        set(reduceMcpApp(state, { method: data.method, params: data.params }))
      }
      return
    }
    if (typeof data.id !== "number") return
    const waiting = pending.get(data.id)
    if (!waiting) return
    pending.delete(data.id)
    if (isRecord(data.error)) {
      const text = typeof data.error.message === "string" ? data.error.message : ""
      waiting.reject(new Error(text || "The host refused the request."))
    } else {
      waiting.resolve(data.result)
    }
  }

  w.addEventListener("message", onMessage)

  let observer: ResizeObserver | undefined
  const ready = request("ui/initialize", {
    appInfo: options.appInfo,
    appCapabilities: { availableDisplayModes: ["inline"] },
    protocolVersion: MCP_APPS_PROTOCOL_VERSION,
  }).then((result) => {
    const hostContext =
      isRecord(result) && isRecord(result.hostContext) ? result.hostContext : {}
    set(reduceMcpApp(state, { method: HOST_CONTEXT, params: hostContext }))
    notify("ui/notifications/initialized")
    if (options.autoResize !== false) observer = observeHeight(notify)
  })

  return {
    ready,
    state: () => state,
    async sendResult(call, result, how = "message") {
      const withResult = (value: unknown) =>
        state.call?.id === call.id
          ? { ...state, call: { ...state.call, result: value } }
          : state
      const before = state.call?.result
      set(withResult(result))
      try {
        if (how === "context") {
          await request("ui/update-model-context", toMcpAppModelContext(call, result))
        } else {
          await request("ui/message", toMcpAppMessage(call, result))
        }
      } catch (error) {
        set(withResult(before))
        throw error
      }
    },
    request,
    notify,
    close() {
      w.removeEventListener("message", onMessage)
      observer?.disconnect()
      for (const { reject } of pending.values()) {
        reject(new Error("The view closed."))
      }
      pending.clear()
    },
  }
}

/** The page's `<meta name="genui-tool">`, set by `toMcpApp`. */
function toolNameFromPage(): string | undefined {
  if (typeof document === "undefined") return undefined
  const meta = document.querySelector<HTMLMetaElement>('meta[name="genui-tool"]')
  return meta?.content || undefined
}

/** Reports the page's height whenever it changes. */
function observeHeight(
  notify: (method: string, params?: unknown) => void,
): ResizeObserver | undefined {
  if (typeof ResizeObserver === "undefined" || typeof document === "undefined") {
    return undefined
  }
  const root = document.documentElement
  let last = -1
  const observer = new ResizeObserver(() => {
    const height = Math.ceil(root.getBoundingClientRect().height)
    if (height === last) return
    last = height
    notify("ui/notifications/size-changed", { height })
  })
  observer.observe(root)
  return observer
}

// ---- React ------------------------------------------------------------------

export type UseMcpAppOptions = Omit<McpAppBridgeOptions, "onState"> & {
  /** How results reach the model (see `sendResult`). Default "message". */
  resultMode?: "message" | "context"
  /** Apply the host's theme, style variables and fonts to the page. Default true. */
  applyTheme?: boolean
}

/**
 * Connects to the host on mount. Returns the call to render, the host
 * context, and `onResult` for the Renderer.
 */
export function useMcpApp(options: UseMcpAppOptions) {
  const [state, setState] = React.useState<McpAppState>(() =>
    createMcpAppState({ toolName: options.toolName }),
  )
  const bridge = React.useRef<McpAppBridge | null>(null)
  // Connect once; later option changes don't reconnect.
  const initial = React.useRef(options)

  React.useEffect(() => {
    const b = connectMcpApp({ ...initial.current, onState: setState })
    bridge.current = b
    b.ready.catch(() => {
      // No host answered: the page was opened outside an MCP Apps host.
    })
    return () => {
      b.close()
      bridge.current = null
    }
  }, [])

  const applyTheme = options.applyTheme !== false
  React.useEffect(() => {
    if (applyTheme) applyMcpHostContext(document.documentElement, state.hostContext)
  }, [applyTheme, state.hostContext])

  const resultMode = options.resultMode
  const onResult = React.useCallback(
    (call: GenUICall, result: unknown) => {
      bridge.current?.sendResult(call, result, resultMode).catch(() => {
        // The host refused (e.g. the user declined); the component is usable again.
      })
    },
    [resultMode],
  )

  return { call: state.call, hostContext: state.hostContext, onResult }
}

export type GenUIMcpAppProps = UseMcpAppOptions & {
  catalog: GenUICatalog
  /** Rendered for tools the catalog doesn't know. */
  fallback?: React.ReactNode
}

/**
 * The whole view: connects to the host and renders the tool's component in
 * the host's locale and theme. Nothing renders until the input starts.
 */
export function GenUIMcpApp({ catalog, fallback, ...options }: GenUIMcpAppProps) {
  const { call, hostContext, onResult } = useMcpApp(options)
  if (!call) return null
  return (
    <GenUIRenderer
      call={call}
      catalog={catalog}
      fallback={fallback}
      locale={hostContext.locale}
      onResult={onResult}
    />
  )
}

// ---- helpers ------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function record(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {}
}
