import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { calloutGuidance, calloutTool } from "../../callout/callout.schema"
import {
  MCP_APP_MIME_TYPE,
  mcpAppResultText,
  supportsMcpApps,
  toMcpApp,
  withToolName,
} from "../genui-mcp-apps"

const entries = [{ tool: calloutTool, guidance: calloutGuidance }]
const html = "<!doctype html><html><head><title>View</title></head><body></body></html>"

describe("supportsMcpApps", () => {
  it("reads the extension's mime types from the client capabilities", () => {
    assert.equal(
      supportsMcpApps({
        extensions: { "io.modelcontextprotocol/ui": { mimeTypes: [MCP_APP_MIME_TYPE] } },
      }),
      true,
    )
    assert.equal(supportsMcpApps({ extensions: { "io.modelcontextprotocol/ui": {} } }), false)
    assert.equal(supportsMcpApps({ tools: {} }), false)
    assert.equal(supportsMcpApps(undefined), false)
  })
})

describe("toMcpApp", () => {
  const app = toMcpApp(entries, { html, resourceMeta: { prefersBorder: false } })

  it("lists one tool per component, pointing at its ui:// resource", () => {
    assert.equal(app.tools.length, 1)
    const [tool] = app.tools
    assert.equal(tool.name, "show_callout")
    assert.equal(tool._meta.ui.resourceUri, "ui://genui/show_callout")
    assert.equal(tool._meta["ui/resourceUri"], "ui://genui/show_callout")
    assert.equal(tool.inputSchema.type, "object")
    // No system prompt in MCP, so the guidance stays in the description.
    assert.match(tool.description, /Use when:/)
  })

  it("puts the preamble and how results come back in the instructions", () => {
    assert.match(app.instructions ?? "", /Result of <tool name>/)
    assert.equal(toMcpApp(entries, { html, preamble: false }).instructions, undefined)
  })

  it("serves the view as an MCP App resource that names its tool", () => {
    assert.deepEqual(app.resources, [
      {
        uri: "ui://genui/show_callout",
        name: "show_callout",
        mimeType: MCP_APP_MIME_TYPE,
        _meta: { ui: { prefersBorder: false } },
      },
    ])
    const read = app.readResource("ui://genui/show_callout")
    assert.ok(read)
    const [content] = read.contents
    assert.equal(content.mimeType, MCP_APP_MIME_TYPE)
    assert.ok(content.text.includes('<head><meta name="genui-tool" content="show_callout">'))
    assert.equal(app.readResource("ui://genui/other"), null)
  })

  it("answers valid calls with Markdown for the model and props for the view", () => {
    const result = app.callTool("show_callout", { text: "Cook chicken to 74 °C." })
    assert.ok(result)
    assert.equal(result.isError, undefined)
    assert.match(result.content[0].text ?? "", /Cook chicken to 74 °C\./)
    // Defaults are applied, so the view renders what the schema means.
    assert.deepEqual(result.structuredContent, {
      props: { tone: "note", text: "Cook chicken to 74 °C." },
    })
  })

  it("answers invalid calls with an error worded for the model", () => {
    const result = app.callTool("show_callout", { tone: "loud" })
    assert.ok(result)
    assert.equal(result.isError, true)
    assert.match(result.content[0].text ?? "", /Fix these and call again/)
    assert.equal(app.callTool("search", {}), null)
  })
})

describe("withToolName", () => {
  it("escapes the name and works without a head", () => {
    assert.equal(
      withToolName("<p>x</p>", 'a"b'),
      '<meta name="genui-tool" content="a&quot;b"><p>x</p>',
    )
  })
})

describe("mcpAppResultText", () => {
  it("names the tool and call, and carries the result as JSON", () => {
    assert.equal(
      mcpAppResultText({ id: "7", name: "approve" }, { action: "approve" }),
      'Result of approve (tool call 7): {"action":"approve"}',
    )
  })
})
