"use client"

import type * as React from "react"

import { cn } from "@/lib/utils"
import { genuiType, Skeleton } from "@/components/genui/surface"

import type { LayoutStackInput, LayoutStackItem } from "./layout-stack.schema"

export type LayoutStackProps = Partial<Omit<LayoutStackInput, "items">> & {
  /** Items may be partial while the tool call streams. */
  items?: Partial<LayoutStackItem>[]
  status?: "streaming" | "ready"
  /** Injected by GenUIRenderer: renders a child component from the catalog. */
  renderChild?: (child: LayoutStackItem, key: string) => React.ReactNode
  className?: string
}

/** Components one under the other, as one tool call. */
export function LayoutStack({
  items = [],
  gap = "normal",
  status = "ready",
  renderChild,
  className,
}: LayoutStackProps) {
  const ready = items.filter(
    (i): i is LayoutStackItem => typeof i.component === "string",
  )
  const streaming = status === "streaming"

  return (
    <div
      data-genui=""
      data-slot="layout-stack"
      data-status={status}
      aria-busy={streaming}
      className={cn(
        "flex flex-col",
        gap === "tight" ? "gap-2" : "gap-4",
        className,
      )}
    >
      {ready.map((item, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: positional layout slots
          key={i}
          className="flex flex-col gap-1.5"
        >
          {item.label && (
            <p className={cn(genuiType.label, "px-3")}>{item.label}</p>
          )}
          {renderChild ? (
            renderChild(item, String(i))
          ) : (
            <p className="text-sm text-muted-foreground">Needs GenUIRenderer</p>
          )}
        </div>
      ))}
      {streaming && ready.length < 2 && (
        <Skeleton className="h-32 rounded-[14px]" />
      )}
    </div>
  )
}

/** Tells GenUIRenderer to pass `renderChild`. */
LayoutStack.genuiLayout = true
