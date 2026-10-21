import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

import {
  GENUI_MAX_LAYOUT_DEPTH,
  type GenUICatalog,
  type GenUIChild,
  GenUIRenderer,
  markCancelled,
  markSuperseded,
  resolveCallState,
} from "../genui-renderer"

/** A minimal layout: renders every item through renderChild. */
function Stack({
  items = [],
  renderChild,
}: {
  items?: GenUIChild[]
  renderChild?: (child: GenUIChild, key: string) => React.ReactNode
}) {
  return <div data-stack="">{items.map((c, i) => renderChild?.(c, String(i)))}</div>
}
Stack.genuiLayout = true

function Leaf({ text }: { text?: string }) {
  return <span data-leaf="">{text}</span>
}

const catalog: GenUICatalog = { show_stack: Stack, leaf: Leaf }

const render = (props: Record<string, unknown>) =>
  renderToStaticMarkup(
    <GenUIRenderer
      call={{ id: "c1", name: "show_stack", props, status: "ready" }}
      catalog={catalog}
    />,
  )

describe("GenUIRenderer layouts", () => {
  it("renders children through the catalog", () => {
    const html = render({ items: [{ component: "leaf", props: { text: "hi" } }] })
    assert.ok(html.includes('<span data-leaf="">hi</span>'))
  })

  it("allows one nested layout and refuses a second", () => {
    assert.equal(GENUI_MAX_LAYOUT_DEPTH, 2)
    const two = render({
      items: [{ component: "show_stack", props: { items: [{ component: "leaf", props: { text: "deep" } }] } }],
    })
    assert.ok(two.includes("deep"))
    const three = render({
      items: [
        {
          component: "show_stack",
          props: { items: [{ component: "show_stack", props: { items: [{ component: "leaf", props: { text: "x" } }] } }] },
        },
      ],
    })
    assert.ok(three.includes("nested layouts too deeply"))
    assert.equal(three.includes('data-leaf="">x'), false)
  })

  it("accepts a child's props as a JSON string", () => {
    const html = render({ items: [{ component: "leaf", props: '{"text":"parsed"}' }] })
    assert.ok(html.includes('<span data-leaf="">parsed</span>'))
  })

  it("names an unknown child instead of dropping it", () => {
    const html = render({ items: [{ component: "nope", props: {} }] })
    assert.ok(html.includes("nope"))
  })

  it("applies a bind's default before the sibling answers", () => {
    const html = render({
      items: [
        { id: "a", component: "leaf", props: { text: "first" } },
        { component: "leaf", props: { text: { $bind: "a.value", default: "waiting" } } },
      ],
    })
    assert.ok(html.includes("waiting"))
  })
})

describe("call state", () => {
  it("resolves lifecycle states in order", () => {
    const base = { id: "x", name: "t", props: {}, status: "ready" as const }
    assert.equal(resolveCallState({ ...base, status: "failed" }, null), "failed")
    assert.equal(resolveCallState({ ...base, status: "cancelled" }, null), "cancelled")
    assert.equal(resolveCallState({ ...base, result: 1, supersededBy: "y" }, null), "ready")
    assert.equal(resolveCallState({ ...base, supersededBy: "y" }, null), "superseded")
    assert.equal(resolveCallState({ ...base, empty: "none" }, null), "empty")
    assert.equal(resolveCallState({ ...base, expiresAt: 10 }, 20), "expired")
    assert.equal(resolveCallState({ ...base, fetchedAt: 0, staleAfterMs: 5 }, 20), "stale")
    assert.equal(resolveCallState({ ...base, partial: "some" }, null), "partial")
  })

  it("markSuperseded points older calls at the newest of the same name", () => {
    const calls = markSuperseded([
      { id: "a", name: "offer", props: {}, status: "ready" },
      { id: "b", name: "offer", props: {}, status: "ready" },
    ])
    assert.equal(calls[0].supersededBy, "b")
    assert.equal(calls[1].supersededBy, undefined)
  })
})

describe("cancelled calls", () => {
  it("markCancelled stops only what was still streaming", () => {
    const calls = markCancelled([
      { id: "a", name: "t", props: {}, status: "streaming" },
      { id: "b", name: "t", props: {}, status: "ready" },
      { id: "c", name: "t", props: {}, status: "failed", error: "x" },
    ])
    assert.deepEqual(calls.map((c) => c.status), ["cancelled", "ready", "failed"])
  })

  it("renders a stopped notice with a retry, not the component", () => {
    const html = renderToStaticMarkup(
      <GenUIRenderer
        call={{ id: "c1", name: "leaf", props: { text: "half" }, status: "cancelled" }}
        catalog={catalog}
        onRetry={() => {}}
      />,
    )
    assert.ok(html.includes('data-genui-state="cancelled"'))
    assert.ok(html.includes("Stopped before it finished"))
    assert.ok(html.includes("Try again"))
    assert.equal(html.includes("half"), false)
  })
})
