"use client"

import type * as React from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/genui/surface"

import type { LayoutColumnsInput } from "./layout-columns.schema"

type Item = LayoutColumnsInput["items"][number]

export type LayoutColumnsProps = Partial<Omit<LayoutColumnsInput, "items">> & {
  /** Items may be partial while the tool call streams. */
  items?: Partial<Item>[]
  status?: "streaming" | "ready"
  /** Injected by GenUIRenderer: renders a child component from the catalog. */
  renderChild?: (child: Item, key: string) => React.ReactNode
  className?: string
}

/**
 * Components side by side. They wrap by the width available (not the window's),
 * and grow to fill each row, so a lone item or a short last row never leaves
 * the right side empty.
 */
export function LayoutColumns({
  columns = 2,
  items = [],
  status = "ready",
  renderChild,
  className,
}: LayoutColumnsProps) {
  const ready = items.filter((i): i is Item => typeof i.component === "string")
  const streaming = status === "streaming"

  return (
    <div
      data-genui=""
      data-slot="layout-columns"
      data-status={status}
      aria-busy={streaming}
      className={cn("flex flex-wrap items-stretch gap-4", className)}
    >
      {ready.map((item, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: positional layout slots
          key={i}
          className="flex min-w-0 flex-col [&>*]:flex-1 [&>.contents>*]:flex-1"
          style={{
            flex: `1 1 min(100%, ${columns === 3 ? "12rem" : "16rem"})`,
          }}
        >
          {renderChild ? (
            renderChild(item, String(i))
          ) : (
            <p className="text-sm text-muted-foreground">Needs GenUIRenderer</p>
          )}
        </div>
      ))}
      {streaming && ready.length < 2 && (
        <Skeleton className="h-40 flex-1 basis-64 rounded-[14px]" />
      )}
    </div>
  )
}

/** Tells GenUIRenderer to pass `renderChild`. */
LayoutColumns.genuiLayout = true
