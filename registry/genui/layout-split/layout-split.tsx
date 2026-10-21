"use client"

import type * as React from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/genui/surface"

import type { LayoutSplitInput } from "./layout-split.schema"

type Child = LayoutSplitInput["main"]

export type LayoutSplitProps = Partial<
  Omit<LayoutSplitInput, "main" | "aside">
> & {
  /** Sides may be partial while the tool call streams. */
  main?: Partial<Child>
  aside?: Partial<Child>
  status?: "streaming" | "ready"
  /** Injected by GenUIRenderer: renders a child component from the catalog. */
  renderChild?: (child: Child, key: string) => React.ReactNode
  className?: string
}

const isReady = (c?: Partial<Child>): c is Child =>
  typeof c?.component === "string"

/** A main component with a narrower aside; they stack on phones. */
export function LayoutSplit({
  main,
  aside,
  asideWidth = "narrow",
  asidePosition = "end",
  status = "ready",
  renderChild,
  className,
}: LayoutSplitProps) {
  const streaming = status === "streaming"
  const side = (child: Partial<Child> | undefined, key: "main" | "aside") =>
    isReady(child) ? (
      renderChild ? (
        renderChild(child, key)
      ) : (
        <p className="text-sm text-muted-foreground">Needs GenUIRenderer</p>
      )
    ) : streaming ? (
      <Skeleton className="h-32 rounded-[14px]" />
    ) : null

  return (
    <div
      data-genui=""
      data-slot="layout-split"
      data-status={status}
      aria-busy={streaming}
      // Side by side when there is room, stacked (main first) when there is not;
      // either way the pair fills the width. `row-reverse` puts the aside on
      // the left without changing the stacked order.
      className={cn(
        "flex flex-wrap items-stretch gap-4",
        asidePosition === "start" && "flex-row-reverse",
        className,
      )}
    >
      <div
        className="flex min-w-0 flex-col [&>*]:flex-1 [&>.contents>*]:flex-1"
        style={{ flex: `${asideWidth === "wide" ? 3 : 2} 1 min(100%, 28rem)` }}
      >
        {side(main, "main")}
      </div>
      <div
        className="flex min-w-0 flex-col [&>*]:flex-1 [&>.contents>*]:flex-1"
        style={{ flex: `${asideWidth === "wide" ? 2 : 1} 1 min(100%, 22rem)` }}
      >
        {side(aside, "aside")}
      </div>
    </div>
  )
}

/** Tells GenUIRenderer to pass `renderChild`. */
LayoutSplit.genuiLayout = true
