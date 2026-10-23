import { callToMarkdown, type MarkdownOptions } from "./genui-markdown"
import {
  buildGenUIPrompt,
  defaultGenUIPreamble,
  type GenUIEntry,
} from "./genui-prompt"
import { validateGenUIInput } from "./genui-validate"

/*
 * MCP Apps adapter, server side: serves catalog components from an MCP server
 * as interactive UI. A tool names a `ui://` resource, the host renders that
 * resource's HTML in a sandboxed iframe, and the two talk JSON-RPC over
 * postMessage (genui-mcp-app.tsx is the iframe side). Structural types only,
 * so neither the MCP SDK nor `@modelcontextprotocol/ext-apps` is a dependency.
 *
 * Protocol facts this follows (MCP Apps 2026-01-26, extension
 * `io.modelcontextprotocol/ui`):
 * - Hosts advertise support in `initialize` under
 *   `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes`, which
 *   includes "text/html;profile=mcp-app". Servers should check it and keep a
 *   text-only fallback.
 * - Tool `_meta.ui`: { resourceUri, visibility?: ("model" | "app")[] }. The
 *   flat `_meta["ui/resourceUri"]` is deprecated but still read by older hosts.
 * - Resources use the `ui://` scheme, mimeType "text/html;profile=mcp-app" and
 *   a complete HTML document as `text`. Resource `_meta.ui`: { csp?,
 *   permissions?, domain?, prefersBorder? }; without `csp` the host applies a
 *   restrictive default (no network).
 * - A tool result's `content` is what the model and text-only hosts see;
 *   `structuredContent` is for the UI and isn't added to the model's context.
 *   Tools must return meaningful `content` even when UI is shown.
 * Sources:
 *   https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
 *   https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts
 *
 * Usage, with the MCP TypeScript SDK's low-level Server. `html` is the view
 * (a page that renders <GenUIMcpApp>) bundled into one file, e.g. with Vite
 * and vite-plugin-singlefile:
 *
 *   const app = toMcpApp(entries, { html: readFileSync("dist/view.html", "utf8") })
 *   new Server(info, { capabilities: { tools: {}, resources: {} }, instructions: app.instructions })
 *   // tools/list     → { tools: app.tools }   (when supportsMcpApps(client capabilities))
 *   // resources/list → { resources: app.resources }
 *   // resources/read → app.readResource(uri)
 *   // tools/call     → app.callTool(name, args) ?? your other tools
 */

export const MCP_APPS_EXTENSION = "io.modelcontextprotocol/ui"
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
export const MCP_APPS_PROTOCOL_VERSION = "2026-01-26"

// ---- Structural MCP types -------------------------------------------------

/** A content block. Only text is written; any type may be read. */
export type McpContentBlock = { type: string; text?: string; [key: string]: unknown }

/** An MCP `CallToolResult`. */
export type McpCallToolResult = {
  content: McpContentBlock[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
  _meta?: Record<string, unknown>
}

/** Resource `_meta.ui`. Omit `csp` to keep the host's no-network default. */
export type McpAppResourceMeta = {
  csp?: {
    connectDomains?: string[]
    resourceDomains?: string[]
    frameDomains?: string[]
    baseUriDomains?: string[]
  }
  /** camera, microphone, geolocation, clipboardWrite. Hosts may refuse. */
  permissions?: Record<string, unknown>
  domain?: string
  prefersBorder?: boolean
}

/** A tool as listed in `tools/list`. */
export type McpAppTool = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  _meta: {
    ui: { resourceUri: string; visibility?: ("model" | "app")[] }
    /** The deprecated flat key, for older hosts (the official SDK writes both). */
    "ui/resourceUri": string
  }
}

/** A resource as listed in `resources/list`. */
export type McpAppResource = {
  uri: string
  name: string
  mimeType: string
  _meta?: { ui: McpAppResourceMeta }
}

/** The result of `resources/read`. */
export type McpAppResourceContents = {
  contents: {
    uri: string
    mimeType: string
    text: string
    _meta?: { ui: McpAppResourceMeta }
  }[]
}

// ---- Capability check --------------------------------------------------------

/**
 * Whether the client renders MCP Apps. Pass the client's capabilities from
 * `initialize` (the SDK's `server.getClientCapabilities()`). When it doesn't,
 * register the components as plain tools: `callTool` still answers in text.
 */
export function supportsMcpApps(capabilities: unknown): boolean {
  if (!isRecord(capabilities) || !isRecord(capabilities.extensions)) {
    return false
  }
  const ui = capabilities.extensions[MCP_APPS_EXTENSION]
  return (
    isRecord(ui) &&
    Array.isArray(ui.mimeTypes) &&
    ui.mimeTypes.includes(MCP_APP_MIME_TYPE)
  )
}

// ---- Tools, resources, results --------------------------------------------

/** The default resource for a tool: `ui://genui/<tool name>`. */
export function mcpAppResourceUri(name: string): string {
  return `ui://genui/${encodeURIComponent(name)}`
}

/**
 * The view's HTML with the tool's name in a `<meta name="genui-tool">`, so the
 * view knows which component to render even when the host doesn't send
 * `toolInfo` in its host context.
 */
export function withToolName(html: string, name: string): string {
  const meta = `<meta name="genui-tool" content="${escapeAttribute(name)}">`
  const head = /<head(\s[^>]*)?>/i.exec(html)
  if (!head) return `${meta}${html}`
  const at = head.index + head[0].length
  return `${html.slice(0, at)}${meta}${html.slice(at)}`
}

/** Added to the preamble: how the user's actions come back. */
export const mcpAppsRule =
  "When the user acts on a component, their choice arrives as a user message that starts with \"Result of <tool name>\". Continue from it."

/**
 * Text to send the model when the user acts on a component. The view sends
 * it as a user message (`ui/message`) or as model context
 * (`ui/update-model-context`).
 */
export function mcpAppResultText(
  call: { id: string; name: string },
  result: unknown,
): string {
  return `Result of ${call.name} (tool call ${call.id}): ${JSON.stringify(result) ?? "null"}`
}

/**
 * The tool's answer to `tools/call`. Invalid input is an error result worded
 * for the model (see genui-validate.ts), so it fixes the call. Valid input is
 * the component as Markdown in `content`, for the model and text-only hosts,
 * and the parsed props (defaults applied) in `structuredContent.props`, which
 * the view renders.
 */
export function toMcpToolResult(
  entry: GenUIEntry,
  input: unknown,
  markdown?: MarkdownOptions,
): McpCallToolResult {
  const { name, inputSchema } = entry.tool
  const checked = validateGenUIInput(inputSchema, input)
  if (!checked.ok) {
    return { isError: true, content: [{ type: "text", text: checked.message }] }
  }
  const props = isRecord(checked.value) ? checked.value : {}
  const text = callToMarkdown({ name, props }, markdown) || `Showed ${name}.`
  return {
    content: [{ type: "text", text }],
    structuredContent: { props },
  }
}

export type McpAppOptions = {
  /**
   * The view: one complete HTML document, scripts and styles inlined, that
   * renders <GenUIMcpApp> with the same catalog.
   */
  html: string
  /** Where each tool's resource lives. Default `ui://genui/<tool name>`. */
  resourceUri?: (name: string) => string
  /** Resource `_meta.ui` (csp, permissions, domain, prefersBorder). */
  resourceMeta?: McpAppResourceMeta
  /** Rewrite input schemas for strict tool use (see `toStrictJSONSchema`). */
  strict?: boolean
  /** Wording of the Markdown the model sees (see `callToMarkdown`). */
  markdown?: MarkdownOptions
  /** Server instructions. Defaults to the generative-UI preamble; false leaves them out. */
  preamble?: string | false
}

export type McpApp = {
  /** For the server's `instructions`. Undefined when `preamble` is false. */
  instructions?: string
  tools: McpAppTool[]
  resources: McpAppResource[]
  /** Answers `resources/read`, or null for a URI this app doesn't serve. */
  readResource: (uri: string) => McpAppResourceContents | null
  /** Answers `tools/call`, or null for a tool that isn't in the catalog. */
  callTool: (name: string, args: unknown) => McpCallToolResult | null
}

/**
 * Serves the components as MCP Apps: one tool and one `ui://` resource per
 * component, all resources the same view. Each tool's description is written
 * in full, with its guidance, since an MCP server has no system prompt of its
 * own; the preamble goes in the server's instructions.
 */
export function toMcpApp(
  entries: readonly GenUIEntry[],
  options: McpAppOptions,
): McpApp {
  const uriOf = options.resourceUri ?? mcpAppResourceUri
  const meta = options.resourceMeta ? { ui: options.resourceMeta } : undefined
  const { tools: built } = buildGenUIPrompt(entries, {
    preamble: false,
    toolDescription: "full",
    strict: options.strict,
  })

  const byName = new Map<string, GenUIEntry>()
  const byUri = new Map<string, string>()
  const tools: McpAppTool[] = []
  const resources: McpAppResource[] = []
  for (const entry of entries) {
    const { name } = entry.tool
    const tool = built[name]
    if (!tool || byName.has(name)) continue
    const uri = uriOf(name)
    byName.set(name, entry)
    byUri.set(uri, name)
    tools.push({
      name,
      description: tool.description,
      inputSchema: tool.jsonSchema,
      _meta: { ui: { resourceUri: uri }, "ui/resourceUri": uri },
    })
    resources.push({
      uri,
      name,
      mimeType: MCP_APP_MIME_TYPE,
      ...(meta && { _meta: meta }),
    })
  }

  const preamble =
    options.preamble === false
      ? undefined
      : `${options.preamble ?? defaultGenUIPreamble}\n- ${mcpAppsRule}`

  return {
    instructions: preamble,
    tools,
    resources,
    readResource(uri) {
      const name = byUri.get(uri)
      if (name === undefined) return null
      return {
        contents: [
          {
            uri,
            mimeType: MCP_APP_MIME_TYPE,
            text: withToolName(options.html, name),
            ...(meta && { _meta: meta }),
          },
        ],
      }
    },
    callTool(name, args) {
      const entry = byName.get(name)
      return entry ? toMcpToolResult(entry, args, options.markdown) : null
    },
  }
}

// ---- helpers --------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function escapeAttribute(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}
