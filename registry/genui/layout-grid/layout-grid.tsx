"use client"

import type * as React from "react"

import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/genui/surface"

import type { LayoutGridInput, LayoutGridItem } from "./layout-grid.schema"

export type LayoutGridProps = Partial<Omit<LayoutGridInput, "items">> & {
  /** Items may be partial while the tool call streams. */
  items?: Partial<LayoutGridItem>[]
  status?: "streaming" | "ready"
  /** Injected by GenUIRenderer: renders a child component from the catalog. */
  renderChild?: (child: LayoutGridItem, key: string) => React.ReactNode
  className?: string
}

/** Mixed components in a 2–3 column grid; one column on phones. */
export function LayoutGrid({
  columns = 2,
  items = [],
  status = "ready",
  renderChild,
  className,
}: LayoutGridProps) {
  const ready = items.filter(
    (i): i is LayoutGridItem => typeof i.component === "string",
  )
  const streaming = status === "streaming"

  return (
    <div
      data-genui=""
      data-slot="layout-grid"
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
            // One cell wraps by the width available and grows to fill its row;
            // a wide cell takes two cells' room, a full one the whole row.
            flex:
              item.span === "full"
                ? "1 1 100%"
                : item.span === 2
                  ? `2 1 min(100%, calc(${columns === 3 ? "24rem" : "32rem"} + 1rem))`
                  : `1 1 min(100%, ${columns === 3 ? "12rem" : "16rem"})`,
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
        <Skeleton className="h-32 flex-1 basis-64 rounded-[14px]" />
      )}
    </div>
  )
}

/** Tells GenUIRenderer to pass `renderChild`. */
LayoutGrid.genuiLayout = true
